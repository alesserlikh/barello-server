import path from 'path'
import crypto from 'crypto'
import fs from 'fs/promises'
import {
  CatalogImportRowValidationStatus,
  CatalogPublishBatchStatus,
  CatalogValidationIssueEntityType,
  FileAssetType,
  NameTranslationSource,
  OfferAvailabilityLevel,
  Prisma,
  PriceImportIssueSeverity,
  PriceImportIssueStatus,
  PriceImportRowMappingStatus,
  PriceImportSourceFormat,
  PriceImportStatus,
  ProductCatalogStatus,
  SupplierPriceImportKind,
  SupplierProductAliasType,
} from '../../generated/prisma'
import { prisma } from '../../lib/prisma'
import { normalizeUploadDisplayFileName } from './upload-file-name'
import { normalizeRawCategory, resolveCatalogCategoryMatch } from './category-mappings.service'
import {
  detectImportProfileFromFile,
  parseRowsFromFile,
  type ImportProfileRules,
  type ParsedPriceRow,
} from './price-import-parser.service'
import {
  isRussianProducedPayload,
  resolvePriceImportProductNames,
} from './price-import-name-resolution'
import { loadNameDictionaries, normalizeText } from './name-decomposer.service'

const PRICE_IMPORT_PARSER_VERSION = '2026-07-05.mapping-v1'
const CATALOG_TRANSLATED_NAME_CONFIDENCE_THRESHOLD = 0.95
const EMPTY_IDENTIFIER_VALUES = new Set([
  '-',
  '—',
  '–',
  'нет',
  'no',
  'n/a',
  'na',
  'null',
  'none',
])

export type SupplierPriceImportUploadType = 'ORIGINAL' | 'NORMALIZED'

const NORMALIZED_ADMIN_PROFILE: ImportProfileRules = {
  code: 'normalized-admin',
  name: 'Normalized admin price',
  parserKind: 'normalized',
  importKind: 'PRICE_WITH_OFFERS',
}

function toSupplierPriceImportKind(value: ImportProfileRules['importKind'] | null | undefined) {
  if (!value) return SupplierPriceImportKind.PRICE_WITH_OFFERS
  return SupplierPriceImportKind[value] ?? SupplierPriceImportKind.PRICE_WITH_OFFERS
}

function detectPriceImportSourceFormat(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()

  if (extension === '.csv') {
    return PriceImportSourceFormat.CSV
  }

  if (extension === '.xml') {
    return PriceImportSourceFormat.XML
  }

  return PriceImportSourceFormat.XLSX
}

async function ensureSupplierExists(supplierId: string) {
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: {
      id: true,
    },
  })

  if (!supplier) {
    throw new Error('Supplier not found')
  }

  return supplier
}

function normalizeProductName(value: string | null | undefined) {
  if (!value) {
    return null
  }

  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ё/g, 'е')
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeIdentifierValue(value: string | null | undefined) {
  const normalizedValue = value
    ?.normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalizedValue) {
    return null
  }

  if (EMPTY_IDENTIFIER_VALUES.has(normalizedValue.toLowerCase())) {
    return null
  }

  return normalizedValue
}

function derivePackagingType(unit: string | null, volumeMl: number | null): string | null {
  const normalized = normalizeProductName(unit)?.replace(/\s+/g, '') ?? null

  if (normalized) {
    if (normalized.includes('keg') || normalized.includes('кег')) return 'Кег'
    if (normalized.includes('can') || normalized.includes('банк')) return 'Банка'
    if (normalized.includes('baginbox') || normalized.includes('биб')) return 'Bag-in-box'
    if (normalized.includes('tetra') || normalized.includes('тетра')) return 'Тетра'
    if (normalized.includes('bottle') || normalized.includes('бутыл')) return 'Бутылка'
    if (normalized === 'pcs' || normalized.includes('шт')) return 'Другое'
  }

  return volumeMl !== null ? 'Бутылка' : null
}

function calculateNameSimilarity(left: string | null | undefined, right: string | null | undefined) {
  const normalizedLeft = normalizeProductName(left)
  const normalizedRight = normalizeProductName(right)

  if (!normalizedLeft || !normalizedRight) {
    return 0
  }

  if (normalizedLeft === normalizedRight) {
    return 1
  }

  const leftWords = normalizedLeft.split(' ').filter(Boolean)
  const rightWords = normalizedRight.split(' ').filter(Boolean)
  const intersection = leftWords.filter((word) => rightWords.includes(word)).length
  const union = new Set([...leftWords, ...rightWords]).size

  if (union === 0) {
    return 0
  }

  const overlap = intersection / union

  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    return Math.max(overlap, 0.85)
  }

  return overlap
}

async function resolveProductMatch(row: ParsedPriceRow) {
  const normalizedIdentityMatch = await findProductByNormalizedIdentity(row.normalizedPayload)
  if (normalizedIdentityMatch) {
    return {
      product: normalizedIdentityMatch,
      status: 'MATCHED' as const,
      confidence: 1,
    }
  }

  const barcode = normalizeIdentifierValue(row.barcode)
  const article = normalizeIdentifierValue(row.article)
  const normalizedName = row.normalizedName || normalizeProductName(row.rawName)

  if (barcode) {
    const productByBarcode = await prisma.product.findUnique({
      where: { barcode },
      select: {
        id: true,
        categoryId: true,
        rawCategory: true,
        name: true,
        translatedName: true,
      },
    })

    if (productByBarcode) {
      return {
        product: productByBarcode,
        status: 'MATCHED' as const,
        confidence: 1,
      }
    }
  }

  if (article) {
    const productByArticle = await prisma.product.findFirst({
      where: {
        article: {
          equals: article,
          mode: 'insensitive',
        },
      },
      select: {
        id: true,
        categoryId: true,
        rawCategory: true,
        name: true,
        translatedName: true,
      },
    })

    if (productByArticle) {
      return {
        product: productByArticle,
        status: 'MATCHED' as const,
        confidence: 0.98,
      }
    }
  }

  if (normalizedName) {
    const productCandidates = await prisma.product.findMany({
      where: {
        OR: [
          {
            name: {
              contains: row.rawName?.trim() || '',
              mode: 'insensitive',
            },
          },
          {
            translatedName: {
              contains: row.rawName?.trim() || '',
              mode: 'insensitive',
            },
          },
        ],
      },
      select: {
        id: true,
        categoryId: true,
        rawCategory: true,
        name: true,
        translatedName: true,
      },
      take: 50,
    })

    const bestMatch = productCandidates.reduce<{ product: (typeof productCandidates)[number] | null; confidence: number }>(
      (best, candidate) => {
        const candidateName = candidate.name || candidate.translatedName || ''
        const similarity = calculateNameSimilarity(normalizedName, candidateName)

        if (similarity > best.confidence) {
          return { product: candidate, confidence: similarity }
        }

        return best
      },
      { product: null, confidence: 0 },
    )

    if (bestMatch.product && bestMatch.confidence >= 0.9) {
      return {
        product: bestMatch.product,
        status: 'MATCHED' as const,
        confidence: bestMatch.confidence,
      }
    }

    if (bestMatch.product && bestMatch.confidence >= 0.6) {
      return {
        product: bestMatch.product,
        status: 'LOW_CONFIDENCE' as const,
        confidence: bestMatch.confidence,
      }
    }
  }

  return {
    product: null,
    status: 'UNMATCHED' as const,
    confidence: 0,
  }
}

export async function parsePriceExcel(filePath: string): Promise<ParsedPriceRow[]> {
  const sourceFormat = detectPriceImportSourceFormat(filePath)
  return parseRowsFromFile(filePath, sourceFormat)
}

function getStoredUploadPath(storageKey: string) {
  if (path.isAbsolute(storageKey)) {
    return storageKey
  }

  return path.resolve(process.cwd(), storageKey.replace(/^[/\\]+/, ''))
}

async function ensureUploadFileStored(params: { sourcePath: string; storageKey: string }) {
  const storagePath = getStoredUploadPath(params.storageKey)
  const sourcePath = path.resolve(params.sourcePath)

  if (sourcePath.toLowerCase() === storagePath.toLowerCase()) {
    await fs.access(storagePath)
    return storagePath
  }

  await fs.mkdir(path.dirname(storagePath), { recursive: true })
  await fs.copyFile(sourcePath, storagePath)
  return storagePath
}

function jsonObject(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {} as Record<string, unknown>
  }

  return value as Record<string, unknown>
}

function payloadNumber(payload: Record<string, unknown>, key: string) {
  const value = payload[key]
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function payloadString(payload: Record<string, unknown>, key: string) {
  const value = payload[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function payloadStringList(payload: Record<string, unknown>, key: string) {
  const value = payload[key]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : []
}

function payloadNestedObject(payload: Record<string, unknown>, key: string) {
  return payload[key] && typeof payload[key] === 'object' && !Array.isArray(payload[key])
    ? payload[key] as Record<string, unknown>
    : {}
}

function hasPayloadField(payload: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(payload, key)
}

function payloadNestedString(
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>,
  key: string,
) {
  return payloadString(primary, key) ?? payloadString(fallback, key)
}

function payloadNestedNumber(
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>,
  key: string,
) {
  return payloadNumber(primary, key) ?? payloadNumber(fallback, key)
}

function isNormalizedAdminPayload(payload: Record<string, unknown>) {
  const matchingPayload = payloadNestedObject(payload, 'matching')
  const identityPayload = payloadNestedObject(payload, 'identity')
  return (
    payloadString(matchingPayload, 'identityStrategy') === 'CANONICAL_NAME_VOLUME_OPTIONS' ||
    payloadString(identityPayload, 'matchBy') === 'CANONICAL_NAME_VOLUME_OPTIONS'
  )
}

function normalizePackagingOptions(values: string[]) {
  return [...new Set(values
    .map((item) => normalizeProductName(item))
    .filter((item): item is string => Boolean(item))
  )].sort()
}

function getPayloadPackagingOptions(payload: Record<string, unknown>) {
  const productPayload = payloadNestedObject(payload, 'product')
  const variantPayload = payloadNestedObject(payload, 'variant')
  return normalizePackagingOptions([
    ...payloadStringList(productPayload, 'packagingOptions'),
    ...payloadStringList(variantPayload, 'packagingOptions'),
  ])
}

function getStoredPackagingOptions(product: { attributesJson: Prisma.JsonValue | null }) {
  const attributes = jsonObject(product.attributesJson)
  return normalizePackagingOptions(payloadStringList(attributes, 'packagingOptions'))
}

function samePackagingOptions(left: string[], right: string[]) {
  if (left.length !== right.length) return false
  return left.every((item, index) => item === right[index])
}

function buildProductAttributesJson(
  productPayload: Record<string, unknown>,
  variantPayload: Record<string, unknown>,
) {
  const attributes: Record<string, unknown> = {}
  const packagingType = payloadNestedString(productPayload, variantPayload, 'packagingType')
  const packagingOptions = [
    ...payloadStringList(productPayload, 'packagingOptions'),
    ...payloadStringList(variantPayload, 'packagingOptions'),
  ]
  const rawMaterial = payloadString(productPayload, 'rawMaterial')
  const aging = payloadString(productPayload, 'aging')
  const sourceUrl = payloadString(payloadNestedObject(productPayload, 'source'), 'sourceUrl')

  if (packagingType) attributes.packagingType = packagingType
  if (packagingOptions.length) attributes.packagingOptions = [...new Set(packagingOptions)]
  if (rawMaterial) attributes.rawMaterial = rawMaterial
  if (aging) attributes.aging = aging
  if (sourceUrl) attributes.sourceUrl = sourceUrl

  return Object.keys(attributes).length ? attributes : null
}

async function findProductByNormalizedIdentity(payload: Record<string, unknown>) {
  if (!isNormalizedAdminPayload(payload)) return null

  const productPayload = payloadNestedObject(payload, 'product')
  const variantPayload = payloadNestedObject(payload, 'variant')
  const productName = getCatalogCanonicalName(payload)
  const volumeMl =
    payloadNestedNumber(variantPayload, payload, 'volumeMl') ??
    payloadNestedNumber(productPayload, payload, 'volumeMl')

  if (!productName || volumeMl === null) return null

  const expectedOptions = getPayloadPackagingOptions(payload)
  const candidates = await prisma.product.findMany({
    where: {
      name: {
        equals: productName,
        mode: 'insensitive',
      },
      packageVolume: decimalOrNull(volumeMl, 3),
    },
    select: PRODUCT_LOOKUP_SELECT,
    take: 50,
  })

  return candidates.find((product) => samePackagingOptions(expectedOptions, getStoredPackagingOptions(product))) ?? null
}

function decimalOrNull(value: number | null | undefined, precision = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  return new Prisma.Decimal(value.toFixed(precision))
}

function getProductNameParts(payload: Record<string, unknown>) {
  const productPayload = payloadNestedObject(payload, 'product')
  return payloadNestedObject(productPayload, 'nameParts')
}

function getRuNameForTranslation(payload: Record<string, unknown>) {
  if (isRussianProducedPayload(payload)) {
    return null
  }

  return resolvePriceImportProductNames(payload).russianName
}

function getEnNameForTranslation(payload: Record<string, unknown>) {
  if (isRussianProducedPayload(payload)) {
    return null
  }

  return resolvePriceImportProductNames(payload).canonicalName
}

function getNameEnSource(payload: Record<string, unknown>) {
  const nameParts = getProductNameParts(payload)
  return payloadString(nameParts, 'enSource')
}

function getNameEnConfidence(payload: Record<string, unknown>) {
  const nameParts = getProductNameParts(payload)
  return payloadNumber(nameParts, 'enConfidence')
}

function shouldReviewNameTranslation(payload: Record<string, unknown>) {
  const enSource = getNameEnSource(payload)
  if (!enSource) {
    return false
  }

  return (
    enSource === 'GENERATED' ||
    (getNameEnConfidence(payload) ?? 0) < CATALOG_TRANSLATED_NAME_CONFIDENCE_THRESHOLD
  )
}

function getCatalogCanonicalName(payload: Record<string, unknown>) {
  return resolvePriceImportProductNames(payload).canonicalName
}

function getCatalogRussianName(payload: Record<string, unknown>) {
  return resolvePriceImportProductNames(payload).russianName
}

function appendFeatureLabelsToDescription(
  description: string | null,
  featureLabels: string[],
) {
  const labels = Array.from(new Set(featureLabels.map((label) => label.trim()).filter(Boolean)))
  if (!labels.length) {
    return description
  }

  const base = description?.trim() ?? ''
  const missingLabels = labels.filter((label) => !base.toLowerCase().includes(label.toLowerCase()))
  if (!missingLabels.length) {
    return description
  }

  const featureText = `Особенности: ${missingLabels.join(', ')}.`
  return base ? `${base}\n\n${featureText}` : featureText
}

async function resolveFeatureLabels(featureCodes: string[]) {
  if (!featureCodes.length) {
    return []
  }

  const dictionaries = await loadNameDictionaries()
  const labelsByCode = new Map(
    dictionaries.features
      .filter((feature) => feature.label)
      .map((feature) => [feature.code, feature.label as string]),
  )

  return Array.from(new Set(
    featureCodes
      .map((code) => labelsByCode.get(code) ?? null)
      .filter((label): label is string => Boolean(label)),
  ))
}

async function upsertProductNameTranslation(params: {
  ruName: string | null
  enName: string | null
  source: NameTranslationSource
  confidence?: number | null
  confirmedAt?: Date | null
}) {
  const ruName = params.ruName?.trim()
  const enName = params.enName?.trim()
  const normalizedRu = normalizeText(ruName)

  if (!ruName || !enName || !normalizedRu) {
    return
  }

  const confidence = Math.max(0, Math.min(1, params.confidence ?? 1))
  await prisma.productNameTranslation.upsert({
    where: { normalizedRu },
    create: {
      normalizedRu,
      ruName,
      enName,
      source: params.source,
      confidence: new Prisma.Decimal(confidence.toFixed(2)),
      confirmedAt: params.confirmedAt ?? null,
    },
    update: {
      ruName,
      enName,
      source: params.source,
      confidence: new Prisma.Decimal(confidence.toFixed(2)),
      confirmedAt: params.confirmedAt ?? null,
    },
  })
}

async function upsertSupplierProvidedNameTranslation(payload: Record<string, unknown>) {
  if (getNameEnSource(payload) !== 'SUPPLIER_PROVIDED') {
    return
  }

  const nameParts = getProductNameParts(payload)
  await upsertProductNameTranslation({
    ruName: getRuNameForTranslation(payload),
    enName: getEnNameForTranslation(payload),
    source: NameTranslationSource.SUPPLIER_FILE,
    confidence: payloadNumber(nameParts, 'enConfidence') ?? 1,
    confirmedAt: null,
  })
}

function buildIdentityKey(params: {
  barcode?: string | null
  article?: string | null
  supplierSku?: string | null
  normalizedName?: string | null
}) {
  return [
    normalizeIdentifierValue(params.barcode),
    normalizeIdentifierValue(params.article) || normalizeIdentifierValue(params.supplierSku),
    params.normalizedName,
  ]
    .map((item) => item?.trim())
    .filter(Boolean)
    .join('|') || null
}

function buildRowHash(row: ParsedPriceRow) {
  const stableParts = [
    row.rawName,
    row.rawCategory,
    row.supplierSku,
    row.article,
    row.barcode,
    row.normalizedName,
    row.normalizedCategory,
    JSON.stringify(row.normalizedPayload ?? {}),
  ]

  return crypto
    .createHash('sha256')
    .update(stableParts.map((part) => part ?? '').join('\u001f'))
    .digest('hex')
}

function withCategoryMatchPayload(
  normalizedPayload: unknown,
  rawCategory: string | null,
  categoryMatch: Awaited<ReturnType<typeof resolveCatalogCategoryMatch>> | null,
) {
  const payload = jsonObject(normalizedPayload as Prisma.JsonValue | null | undefined)
  const productPayload = payloadNestedObject(payload, 'product')
  const mappingPayload = payloadNestedObject(payload, 'mapping')

  if (!categoryMatch) {
    return normalizedPayload as Prisma.InputJsonValue
  }

  return {
    ...payload,
    product: {
      ...productPayload,
      categoryRaw: payloadString(productPayload, 'categoryRaw') ?? rawCategory,
      categoryId: categoryMatch.category?.id ?? null,
      categoryName: categoryMatch.category?.name ?? null,
      categorySource: categoryMatch.source,
      categoryConfidence: categoryMatch.confidence,
      categoryReason: categoryMatch.reason,
    },
    mapping: {
      ...mappingPayload,
      categorySource: categoryMatch.source,
      categoryConfidence: categoryMatch.confidence,
      categoryReason: categoryMatch.reason,
    },
  } as Prisma.InputJsonValue
}

function firstNonEmptyString(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return null
}

function firstIdentifierValue(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalizedValue = normalizeIdentifierValue(value)
    if (normalizedValue) {
      return normalizedValue
    }
  }

  return null
}

function toCatalogRowStatus(params: {
  mappingStatus: PriceImportRowMappingStatus
  hasBlockingIssues: boolean
  hasName: boolean
  hasProductMatch: boolean
}) {
  if (params.mappingStatus === PriceImportRowMappingStatus.IGNORED) {
    return CatalogImportRowValidationStatus.IGNORED
  }

  if (params.mappingStatus === PriceImportRowMappingStatus.FAILED || !params.hasName) {
    return CatalogImportRowValidationStatus.FAILED
  }

  if (params.hasBlockingIssues) {
    return CatalogImportRowValidationStatus.CONFLICT
  }

  if (
    params.mappingStatus === PriceImportRowMappingStatus.MANUAL_MATCHED ||
    params.mappingStatus === PriceImportRowMappingStatus.MATCHED
  ) {
    return CatalogImportRowValidationStatus.READY_TO_PUBLISH
  }

  if (params.hasProductMatch) {
    return CatalogImportRowValidationStatus.MATCHED
  }

  return CatalogImportRowValidationStatus.NEEDS_REVIEW
}

function buildCatalogNormalizedData(params: {
  priceImport: { id: string; supplierId: string }
  row: Prisma.SupplierPriceImportRowGetPayload<Record<string, never>>
}) {
  const payload = jsonObject(params.row.normalizedPayload)
  const identityPayload = payloadNestedObject(payload, 'identity')
  const productPayload = payloadNestedObject(payload, 'product')
  const variantPayload = payloadNestedObject(payload, 'variant')
  const offerPayload = payloadNestedObject(payload, 'offer')

  const canonicalName = getCatalogCanonicalName(payload)
  const russianName = getCatalogRussianName(payload)
  const categoryId = payloadNestedString(productPayload, payload, 'categoryId')
  const categoryName = firstNonEmptyString(
    payloadNestedString(productPayload, payload, 'categoryName'),
    payloadNestedString(productPayload, payload, 'categoryRaw'),
    params.row.rawCategory,
  )
  const article = firstIdentifierValue(
    payloadNestedString(identityPayload, payload, 'article'),
    params.row.sourceArticle,
  )
  const supplierSku = firstIdentifierValue(
    payloadNestedString(identityPayload, payload, 'supplierSku'),
    params.row.sourceSku,
  )
  const barcode = firstIdentifierValue(
    payloadNestedString(identityPayload, payload, 'barcode'),
    params.row.sourceBarcode,
  )
  const volume =
    payloadNestedNumber(variantPayload, payload, 'volumeMl') ??
    payloadNestedNumber(productPayload, payload, 'volumeMl')
  const packageSize =
    payloadNestedNumber(variantPayload, payload, 'packageSize') ??
    payloadNestedNumber(variantPayload, payload, 'packQty')
  const alcoholPercent = payloadNestedNumber(productPayload, payload, 'alcoholPercent')
  const vintage =
    payloadNestedNumber(productPayload, payload, 'vintage') ??
    payloadNestedNumber(productPayload, payload, 'year')
  const price = payloadNestedNumber(offerPayload, payload, 'price')
  const stockAvailable =
    payloadNestedNumber(offerPayload, payload, 'stockAvailable') ??
    payloadNestedNumber(offerPayload, payload, 'stock')

  return {
    importId: params.priceImport.id,
    rawRowId: params.row.id,
    supplierId: params.priceImport.supplierId,
    normalizedName: params.row.normalizedName,
    canonicalName,
    russianName,
    categoryId,
    categoryName,
    article,
    supplierSku,
    barcode,
    brand: payloadNestedString(productPayload, payload, 'brand'),
    producer: payloadNestedString(productPayload, payload, 'producer'),
    manufacturer: payloadNestedString(productPayload, payload, 'manufacturer'),
    country: payloadNestedString(productPayload, payload, 'country'),
    region: payloadNestedString(productPayload, payload, 'region'),
    vintage: vintage !== null ? Math.round(vintage) : null,
    alcoholPercent: decimalOrNull(alcoholPercent, 2),
    volume: decimalOrNull(volume, 3),
    volumeUnit: volume !== null ? payloadNestedString(variantPayload, payload, 'volumeUnit') || 'ml' : null,
    packageSize: decimalOrNull(packageSize, 3),
    packageSizeUnit: packageSize !== null
      ? payloadNestedString(variantPayload, payload, 'packageSizeUnit') || payloadNestedString(variantPayload, payload, 'unit')
      : null,
    description: payloadNestedString(productPayload, payload, 'description'),
    price: decimalOrNull(price, 2),
    currency: payloadNestedString(offerPayload, payload, 'currency') || (price !== null ? 'RUB' : null),
    stockAvailable: decimalOrNull(stockAvailable, 3),
    availability: payloadNestedString(offerPayload, payload, 'availability'),
    matchedProductId: params.row.mappedProductId,
    matchedProductVariantId: params.row.mappedProductVariantId,
    matchedSupplierProductId: params.row.mappedSupplierProductId,
    confidence: params.row.mappingConfidence,
    normalizedPayload: params.row.normalizedPayload === null
      ? Prisma.JsonNull
      : params.row.normalizedPayload as Prisma.InputJsonValue,
    adminCorrectionPayload: params.row.adminCorrectionPayload === null
      ? Prisma.JsonNull
      : params.row.adminCorrectionPayload as Prisma.InputJsonValue,
    approvedAt: params.row.approvedAt,
    publishedAt: params.row.publishedAt,
  }
}

async function syncCatalogMatchCandidates(params: {
  importId: string
  row: Prisma.SupplierPriceImportRowGetPayload<Record<string, never>>
  normalizedRowId: string
  supplierId: string
}) {
  await prisma.catalogMatchCandidate.deleteMany({
    where: {
      importId: params.importId,
      rawRowId: params.row.id,
    },
  })

  const payload = jsonObject(params.row.normalizedPayload)
  const productPayload = payloadNestedObject(payload, 'product')
  const variantPayload = payloadNestedObject(payload, 'variant')
  const candidates = new Map<string, {
    productId: string
    productVariantId: string | null
    supplierProductId: string | null
    score: number
    reason: string
    selectedByAdmin?: boolean
    signals: Record<string, unknown>
  }>()

  const addCandidate = (candidate: {
    productId: string
    productVariantId?: string | null
    supplierProductId?: string | null
    score: number
    reason: string
    selectedByAdmin?: boolean
    signals?: Record<string, unknown>
  }) => {
    const key = [
      candidate.productId,
      candidate.productVariantId || '',
      candidate.supplierProductId || '',
    ].join(':')
    const existing = candidates.get(key)
    if (!existing || candidate.score > existing.score) {
      candidates.set(key, {
        productId: candidate.productId,
        productVariantId: candidate.productVariantId ?? null,
        supplierProductId: candidate.supplierProductId ?? null,
        score: candidate.score,
        reason: candidate.reason,
        selectedByAdmin: candidate.selectedByAdmin,
        signals: candidate.signals ?? {},
      })
    }
  }

  if (params.row.mappedProductId) {
    addCandidate({
      productId: params.row.mappedProductId,
      productVariantId: params.row.mappedProductVariantId,
      supplierProductId: params.row.mappedSupplierProductId,
      score: Number(params.row.mappingConfidence ?? 1),
      reason: params.row.mappingStatus === PriceImportRowMappingStatus.MANUAL_MATCHED
        ? 'manual mapping'
        : 'selected product mapping',
      selectedByAdmin: params.row.mappingStatus === PriceImportRowMappingStatus.MANUAL_MATCHED,
      signals: { source: 'mappedProductId' },
    })
  }

  const sourceBarcode = normalizeIdentifierValue(params.row.sourceBarcode)
  const sourceArticle = normalizeIdentifierValue(params.row.sourceArticle)
  const sourceSku = normalizeIdentifierValue(params.row.sourceSku)

  if (sourceBarcode) {
    const product = await prisma.product.findUnique({
      where: { barcode: sourceBarcode },
      select: { id: true },
    })
    if (product) {
      addCandidate({
        productId: product.id,
        score: 1,
        reason: 'barcode exact match',
        signals: { barcode: sourceBarcode },
      })
    }
  }

  const article = sourceArticle
  if (article) {
    const products = await prisma.product.findMany({
      where: { article: { equals: article, mode: 'insensitive' } },
      select: { id: true },
      take: 5,
    })
    for (const product of products) {
      addCandidate({
        productId: product.id,
        score: 0.98,
        reason: 'article/SKU exact match',
        signals: { article },
      })
    }
  }

  const aliasLookups: Array<{ rawValue: string | null; aliasTypes: SupplierProductAliasType[] }> = [
    { rawValue: sourceSku, aliasTypes: [SupplierProductAliasType.SUPPLIER_SKU] },
    {
      rawValue: sourceArticle,
      aliasTypes: [SupplierProductAliasType.SUPPLIER_ARTICLE, SupplierProductAliasType.LEGACY_ARTICLE],
    },
    { rawValue: sourceBarcode, aliasTypes: [SupplierProductAliasType.BARCODE] },
  ]

  for (const { rawValue, aliasTypes } of aliasLookups) {
    if (!rawValue) continue
    const aliases = await prisma.supplierProductAlias.findMany({
      where: {
        supplierId: params.supplierId,
        aliasType: { in: aliasTypes },
        normalizedValue: normalizeAliasValue(rawValue),
        isActive: true,
      },
      include: {
        supplierProduct: {
          select: { id: true, productId: true, productVariantId: true },
        },
      },
      take: 5,
    })
    for (const alias of aliases) {
      if (!alias.supplierProduct) continue
      addCandidate({
        productId: alias.supplierProduct.productId,
        productVariantId: alias.supplierProduct.productVariantId,
        supplierProductId: alias.supplierProduct.id,
        score: Number(alias.confidence ?? 0.95),
        reason: 'supplier alias match',
        signals: { aliasType: alias.aliasType, rawValue },
      })
    }
  }

  const rawName = params.row.rawName?.trim()
  const normalizedName = params.row.normalizedName || normalizeProductName(params.row.rawName)
  if (rawName || normalizedName) {
    const nameProbe = rawName || normalizedName || ''
    const products = await prisma.product.findMany({
      where: {
        OR: [
          { name: { contains: nameProbe, mode: 'insensitive' } },
          { translatedName: { contains: nameProbe, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, translatedName: true },
      take: 25,
    })
    for (const product of products) {
      const score = Math.max(
        calculateNameSimilarity(normalizedName, product.name),
        calculateNameSimilarity(normalizedName, product.translatedName),
      )
      if (score >= 0.6) {
        addCandidate({
          productId: product.id,
          score,
          reason: score >= 0.9 ? 'normalized name match' : 'normalized name candidate',
          signals: { normalizedName },
        })
      }
    }
  }

  const brand = payloadNestedString(productPayload, payload, 'brand') || payloadNestedString(productPayload, payload, 'producer')
  const volumeMl =
    payloadNestedNumber(variantPayload, payload, 'volumeMl') ??
    payloadNestedNumber(productPayload, payload, 'volumeMl')
  if (brand && volumeMl !== null) {
    const products = await prisma.product.findMany({
      where: {
        OR: [
          { brand: { equals: brand, mode: 'insensitive' } },
          { producer: { equals: brand, mode: 'insensitive' } },
        ],
        variants: {
          some: {
            volume: decimalOrNull(volumeMl, 3),
            volumeUnit: { in: ['ml', 'ML', 'мл'] },
          },
        },
      },
      select: {
        id: true,
        variants: {
          where: {
            volume: decimalOrNull(volumeMl, 3),
          },
          select: { id: true },
          take: 1,
        },
      },
      take: 5,
    })
    for (const product of products) {
      addCandidate({
        productId: product.id,
        productVariantId: product.variants[0]?.id ?? null,
        score: 0.75,
        reason: 'brand + volume candidate',
        signals: { brand, volumeMl },
      })
    }
  }

  if (candidates.size === 0) return

  await prisma.catalogMatchCandidate.createMany({
    data: [...candidates.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((candidate) => ({
        importId: params.importId,
        rawRowId: params.row.id,
        normalizedRowId: params.normalizedRowId,
        productId: candidate.productId,
        productVariantId: candidate.productVariantId,
        supplierProductId: candidate.supplierProductId,
        score: new Prisma.Decimal(Math.max(0, Math.min(1, candidate.score)).toFixed(2)),
        reason: candidate.reason,
        selectedByAdmin: candidate.selectedByAdmin ?? false,
        signalsJson: candidate.signals as Prisma.InputJsonValue,
      })),
  })
}

async function syncCatalogValidationForRow(params: {
  priceImport: { id: string; supplierId: string; importKind: SupplierPriceImportKind }
  row: Prisma.SupplierPriceImportRowGetPayload<Record<string, never>>
  normalizedRowId: string
}) {
  await prisma.catalogValidationIssue.deleteMany({
    where: {
      importId: params.priceImport.id,
      rawRowId: params.row.id,
      status: PriceImportIssueStatus.OPEN,
    },
  })

  const payload = jsonObject(params.row.normalizedPayload)
  const productPayload = payloadNestedObject(payload, 'product')
  const variantPayload = payloadNestedObject(payload, 'variant')
  const offerPayload = payloadNestedObject(payload, 'offer')
  const needsTranslationReview = shouldReviewNameTranslation(payload)
  const name = firstNonEmptyString(
    payloadNestedString(productPayload, payload, 'canonicalName'),
    payloadNestedString(productPayload, payload, 'displayName'),
    payloadNestedString(productPayload, payload, 'name'),
    params.row.rawName,
    params.row.normalizedName,
  )
  const barcode = firstIdentifierValue(
    payloadNestedString(payloadNestedObject(payload, 'identity'), payload, 'barcode'),
    params.row.sourceBarcode,
  )
  const article = firstIdentifierValue(
    payloadNestedString(payloadNestedObject(payload, 'identity'), payload, 'article'),
    params.row.sourceArticle,
  )
  const supplierSku = firstIdentifierValue(
    payloadNestedString(payloadNestedObject(payload, 'identity'), payload, 'supplierSku'),
    params.row.sourceSku,
  )
  const categoryId = payloadNestedString(productPayload, payload, 'categoryId')
  const price = payloadNestedNumber(offerPayload, payload, 'price')
  const volumeMl =
    payloadNestedNumber(variantPayload, payload, 'volumeMl') ??
    payloadNestedNumber(productPayload, payload, 'volumeMl')
  const rowType = getPublishRowType(params.row)
  const isProductMaster =
    params.priceImport.importKind === SupplierPriceImportKind.PRODUCT_MASTER ||
    rowType === 'PRODUCT_MASTER'

  const issues: Array<{
    type: string
    fieldName: string
    message: string
    sourceValue?: Prisma.InputJsonValue
    catalogValue?: Prisma.InputJsonValue
    productId?: string | null
    supplierProductId?: string | null
  }> = []

  if (!name) {
    issues.push({
      type: 'MISSING_NAME',
      fieldName: 'name',
      message: 'В строке прайса не указано название товара',
    })
  }

  const matchedProduct = params.row.mappedProductId
    ? await prisma.product.findUnique({
        where: { id: params.row.mappedProductId },
        select: { id: true, categoryId: true, barcode: true, article: true },
      })
    : null

  if (!categoryId && !matchedProduct?.categoryId) {
    issues.push({
      type: 'CATEGORY_UNRESOLVED',
      fieldName: 'category',
      message: 'Категория каталога не определена',
      sourceValue: params.row.rawCategory ?? undefined,
    })
  }

  if (!isProductMaster && price === null) {
    issues.push({
      type: 'PRICE_MISSING',
      fieldName: 'price',
      message: 'Для публикации предложения нужна цена',
    })
  }

  if (barcode) {
    const productByBarcode = await prisma.product.findUnique({
      where: { barcode },
      select: { id: true, name: true, barcode: true },
    })
    if (productByBarcode && productByBarcode.id !== params.row.mappedProductId) {
      issues.push({
        type: 'BARCODE_CONFLICT',
        fieldName: 'barcode',
        message: 'Штрихкод уже привязан к другому товару каталога',
        sourceValue: barcode,
        catalogValue: { productId: productByBarcode.id, barcode: productByBarcode.barcode } as Prisma.InputJsonValue,
        productId: productByBarcode.id,
      })
    }
  }

  if (article) {
    const productByArticle = await prisma.product.findFirst({
      where: {
        article: { equals: article, mode: 'insensitive' },
        ...(params.row.mappedProductId ? { id: { not: params.row.mappedProductId } } : {}),
      },
      select: { id: true, article: true },
    })
    if (productByArticle) {
      issues.push({
        type: 'ARTICLE_SKU_CONFLICT',
        fieldName: 'article',
        message: 'Артикул или SKU уже привязан к другому товару каталога',
        sourceValue: article,
        catalogValue: { productId: productByArticle.id, article: productByArticle.article } as Prisma.InputJsonValue,
        productId: productByArticle.id,
      })
    }
  }

  if (supplierSku) {
    const supplierProductBySku = await prisma.supplierProduct.findFirst({
      where: {
        supplierId: params.priceImport.supplierId,
        supplierSku,
        ...(params.row.mappedSupplierProductId ? { id: { not: params.row.mappedSupplierProductId } } : {}),
      },
      select: { id: true, supplierSku: true, productId: true },
    })
    if (
      supplierProductBySku &&
      (!params.row.mappedProductId || supplierProductBySku.productId !== params.row.mappedProductId)
    ) {
      issues.push({
        type: 'SUPPLIER_SKU_CONFLICT',
        fieldName: 'supplierSku',
        message: 'SKU поставщика уже привязан к другому товару поставщика',
        sourceValue: supplierSku,
        catalogValue: {
          supplierProductId: supplierProductBySku.id,
          productId: supplierProductBySku.productId,
          supplierSku: supplierProductBySku.supplierSku,
        } as Prisma.InputJsonValue,
        productId: supplierProductBySku.productId,
        supplierProductId: supplierProductBySku.id,
      })
    }
  }

  if (volumeMl !== null && params.row.mappedProductVariantId) {
    const variant = await prisma.productVariant.findUnique({
      where: { id: params.row.mappedProductVariantId },
      select: { volume: true, volumeUnit: true },
    })
    const variantVolume = variant?.volume ? Number(variant.volume) : null
    if (variantVolume !== null && Math.abs(variantVolume - volumeMl) > 0.001) {
      issues.push({
        type: 'VOLUME_CONFLICT',
        fieldName: 'volume',
        message: 'Объём строки не совпадает с объёмом выбранного варианта товара',
        sourceValue: volumeMl,
        catalogValue: { volume: variantVolume, volumeUnit: variant?.volumeUnit } as Prisma.InputJsonValue,
      })
    }
  }

  if (issues.length) {
    await prisma.catalogValidationIssue.createMany({
      data: issues.map((issue) => ({
        importId: params.priceImport.id,
        rawRowId: params.row.id,
        normalizedRowId: params.normalizedRowId,
        supplierId: params.priceImport.supplierId,
        productId: issue.productId ?? params.row.mappedProductId,
        supplierProductId: issue.supplierProductId ?? params.row.mappedSupplierProductId,
        entityType: CatalogValidationIssueEntityType.RAW_ROW,
        type: issue.type,
        severity: PriceImportIssueSeverity.ERROR,
        status: PriceImportIssueStatus.OPEN,
        fieldName: issue.fieldName,
        message: issue.message,
        sourceValue: issue.sourceValue,
        catalogValue: issue.catalogValue,
        suggestedAction: 'Проверьте и исправьте строку прайса перед публикацией.',
      })),
    })
  }

  const validatedStatus = toCatalogRowStatus({
    mappingStatus: params.row.mappingStatus,
    hasBlockingIssues: issues.length > 0,
    hasName: Boolean(name),
    hasProductMatch: Boolean(params.row.mappedProductId),
  })
  const nextStatus =
    issues.length === 0 &&
    (
      params.row.validationStatus === CatalogImportRowValidationStatus.APPROVED ||
      params.row.approvedAt
    )
      ? CatalogImportRowValidationStatus.APPROVED
      : issues.length === 0 && needsTranslationReview
        ? CatalogImportRowValidationStatus.NEEDS_REVIEW
      : validatedStatus

  await prisma.catalogNormalizedRow.update({
    where: {
      importId_rawRowId: {
        importId: params.priceImport.id,
        rawRowId: params.row.id,
      },
    },
    data: {
      status: nextStatus,
    },
  })
  await prisma.supplierPriceImportRow.update({
    where: { id: params.row.id },
    data: {
      validationStatus: nextStatus,
      approvedAt: nextStatus === CatalogImportRowValidationStatus.APPROVED ? (params.row.approvedAt ?? new Date()) : null,
    },
  })

  return { status: nextStatus, issuesCount: issues.length }
}

async function syncCatalogReviewState(importId: string) {
  const priceImport = await prisma.supplierPriceImport.findUnique({
    where: { id: importId },
    select: {
      id: true,
      supplierId: true,
      importKind: true,
    },
  })

  if (!priceImport) {
    throw new Error('Price import not found')
  }

  const rows = await prisma.supplierPriceImportRow.findMany({
    where: { importId },
    orderBy: [{ sheetName: 'asc' }, { rowIndex: 'asc' }, { createdAt: 'asc' }],
  })

  await prisma.catalogMatchCandidate.deleteMany({ where: { importId } })
  await prisma.catalogValidationIssue.deleteMany({
    where: {
      importId,
      status: PriceImportIssueStatus.OPEN,
    },
  })

  let reviewIssues = 0
  let readyRows = 0
  let failedRows = 0

  for (const row of rows) {
    const normalizedData = buildCatalogNormalizedData({ priceImport, row })
    const normalizedRow = await prisma.catalogNormalizedRow.upsert({
      where: {
        importId_rawRowId: {
          importId,
          rawRowId: row.id,
        },
      },
      create: {
        ...normalizedData,
        status: CatalogImportRowValidationStatus.NORMALIZED,
      },
      update: normalizedData,
      select: { id: true },
    })

    await syncCatalogMatchCandidates({
      importId,
      row,
      normalizedRowId: normalizedRow.id,
      supplierId: priceImport.supplierId,
    })
    const validation = await syncCatalogValidationForRow({
      priceImport,
      row,
      normalizedRowId: normalizedRow.id,
    })

    reviewIssues += validation.issuesCount
    if (
      validation.status === CatalogImportRowValidationStatus.READY_TO_PUBLISH ||
      validation.status === CatalogImportRowValidationStatus.APPROVED
    ) {
      readyRows += 1
    }
    if (
      validation.status === CatalogImportRowValidationStatus.CONFLICT ||
      validation.status === CatalogImportRowValidationStatus.FAILED
    ) {
      failedRows += 1
    }
  }

  const openLegacyIssues = await prisma.supplierPriceImportIssue.count({
    where: { importId, status: PriceImportIssueStatus.OPEN },
  })
  const openCatalogIssues = await prisma.catalogValidationIssue.count({
    where: { importId, status: PriceImportIssueStatus.OPEN },
  })

  await prisma.supplierPriceImport.update({
    where: { id: importId },
    data: {
      parsedRows: rows.length,
      processedRows: rows.length,
      matchedRows: readyRows,
      failedRows,
      issuesCount: openLegacyIssues + openCatalogIssues,
      criticalIssuesCount: await prisma.catalogValidationIssue.count({
        where: {
          importId,
          status: PriceImportIssueStatus.OPEN,
          severity: PriceImportIssueSeverity.CRITICAL,
        },
      }),
      status: rows.length === 0
        ? PriceImportStatus.PARSED
        : failedRows > 0 || reviewIssues > 0 || openLegacyIssues > 0
          ? PriceImportStatus.HAS_ISSUES
          : PriceImportStatus.READY_TO_PUBLISH,
    },
  })
}

function normalizeAliasValue(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function getDeliveryTerm(minDays: number | null, maxDays: number | null) {
  if (minDays === null && maxDays === null) return null
  if (minDays !== null && maxDays !== null && minDays !== maxDays) return `${minDays}-${maxDays} days`
  return `${minDays ?? maxDays} days`
}

async function upsertSupplierProductAlias(params: {
  supplierId: string
  supplierProductId: string
  aliasType: SupplierProductAliasType
  rawValue: string | null | undefined
  sourceImportId: string
  sourceImportRowId: string
  confidence?: number | null
}) {
  const rawValue = normalizeIdentifierValue(params.rawValue)
  if (!rawValue) return

  const normalizedValue = normalizeAliasValue(rawValue)

  await prisma.supplierProductAlias.upsert({
    where: {
      supplierId_aliasType_normalizedValue: {
        supplierId: params.supplierId,
        aliasType: params.aliasType,
        normalizedValue,
      },
    },
    update: {
      supplierProductId: params.supplierProductId,
      rawValue,
      sourceImportId: params.sourceImportId,
      sourceImportRowId: params.sourceImportRowId,
      confidence: params.confidence ? new Prisma.Decimal(params.confidence.toFixed(2)) : null,
      isActive: true,
    },
    create: {
      supplierId: params.supplierId,
      supplierProductId: params.supplierProductId,
      aliasType: params.aliasType,
      rawValue,
      normalizedValue,
      sourceImportId: params.sourceImportId,
      sourceImportRowId: params.sourceImportRowId,
      confidence: params.confidence ? new Prisma.Decimal(params.confidence.toFixed(2)) : null,
      isActive: true,
    },
  })
}

async function createPriceImportIssueOnce(params: {
  importId: string
  rowId: string
  supplierId: string
  type: string
  fieldName: string
  message: string
  severity?: PriceImportIssueSeverity
  supplierValue?: Prisma.InputJsonValue
  catalogValue?: Prisma.InputJsonValue
  detailsJson?: Prisma.InputJsonValue
  suggestedAction?: string
}) {
  const existingIssue = await prisma.supplierPriceImportIssue.findFirst({
    where: {
      importId: params.importId,
      rowId: params.rowId,
      type: params.type,
      fieldName: params.fieldName,
      message: params.message,
    },
    select: { id: true },
  })

  if (existingIssue) return

  await prisma.supplierPriceImportIssue.create({
    data: {
      importId: params.importId,
      rowId: params.rowId,
      supplierId: params.supplierId,
      type: params.type,
      severity: params.severity ?? PriceImportIssueSeverity.WARNING,
      status: PriceImportIssueStatus.OPEN,
      fieldName: params.fieldName,
      message: params.message,
      supplierValue: params.supplierValue,
      catalogValue: params.catalogValue,
      detailsJson: params.detailsJson,
      suggestedAction: params.suggestedAction,
    },
  })
}

async function createNameDecompositionIssues(params: {
  importId: string
  rowId: string
  supplierId: string
  rawName: string | null
  rawCategory: string | null
  normalizedPayload: Prisma.JsonValue | null
}) {
  const payload = jsonObject(params.normalizedPayload)
  const mappingPayload = payloadNestedObject(payload, 'mapping')
  const productPayload = payloadNestedObject(payload, 'product')
  const variantPayload = payloadNestedObject(payload, 'variant')
  const issues = payloadStringList(mappingPayload, 'issues')

  let createdIssues = 0

  for (const issue of issues) {
    if (issue === 'NAME_CATEGORY_MISMATCH') {
      await createPriceImportIssueOnce({
        importId: params.importId,
        rowId: params.rowId,
        supplierId: params.supplierId,
        type: issue,
        severity: PriceImportIssueSeverity.WARNING,
        fieldName: 'category',
        message: 'Категория из названия товара не совпадает с категорией в прайсе',
        supplierValue: params.rawCategory ?? undefined,
        catalogValue: payloadString(productPayload, 'categoryRaw') ?? undefined,
        detailsJson: {
          rawName: params.rawName,
          nameParts: payloadNestedObject(productPayload, 'nameParts'),
        } as Prisma.InputJsonValue,
        suggestedAction: 'Проверьте категорию из прайса и категорию, определённую по названию товара.',
      })
      createdIssues += 1
      continue
    }

    if (issue === 'CATEGORY_SUGGESTION_CONFLICT') {
      await createPriceImportIssueOnce({
        importId: params.importId,
        rowId: params.rowId,
        supplierId: params.supplierId,
        type: issue,
        severity: PriceImportIssueSeverity.WARNING,
        fieldName: 'category',
        message: 'Категория, предложенная по ключевым словам, не совпадает с категорией в прайсе',
        supplierValue: params.rawCategory ?? undefined,
        catalogValue: payloadString(productPayload, 'categoryRaw') ?? undefined,
        detailsJson: {
          rawName: params.rawName,
          nameParts: payloadNestedObject(productPayload, 'nameParts'),
          categorySignals: payloadNestedObject(productPayload, 'nameParts').categorySignals ?? null,
        } as Prisma.InputJsonValue,
        suggestedAction: 'Проверьте признаки категории перед применением маппинга.',
      })
      createdIssues += 1
      continue
    }

    if (issue === 'VOLUME_CONFLICT') {
      await createPriceImportIssueOnce({
        importId: params.importId,
        rowId: params.rowId,
        supplierId: params.supplierId,
        type: issue,
        severity: PriceImportIssueSeverity.ERROR,
        fieldName: 'volume',
        message: 'Объём из колонки прайса не совпадает с объёмом в названии товара',
        supplierValue: payloadNumber(variantPayload, 'volumeMl') ?? payloadNumber(productPayload, 'volumeMl') ?? undefined,
        detailsJson: {
          rawName: params.rawName,
          nameParts: payloadNestedObject(productPayload, 'nameParts'),
        } as Prisma.InputJsonValue,
        suggestedAction: 'Оставьте значение из колонки прайса и проверьте значение, найденное в названии товара.',
      })
      createdIssues += 1
      continue
    }

    if (issue === 'COUNTRY_CONFLICT') {
      await createPriceImportIssueOnce({
        importId: params.importId,
        rowId: params.rowId,
        supplierId: params.supplierId,
        type: issue,
        severity: PriceImportIssueSeverity.WARNING,
        fieldName: 'country',
        message: 'Страна из прайса не совпадает со страной, найденной в названии товара',
        supplierValue: payloadString(productPayload, 'country') ?? undefined,
        catalogValue: payloadString(payloadNestedObject(productPayload, 'nameParts'), 'country') ?? undefined,
        detailsJson: {
          rawName: params.rawName,
          nameParts: payloadNestedObject(productPayload, 'nameParts'),
        } as Prisma.InputJsonValue,
        suggestedAction: 'Оставьте страну из прайса, если модератор не подтвердил страну из названия.',
      })
      createdIssues += 1
      continue
    }

    if (issue === 'GEO_AMBIGUOUS') {
      await createPriceImportIssueOnce({
        importId: params.importId,
        rowId: params.rowId,
        supplierId: params.supplierId,
        type: issue,
        severity: PriceImportIssueSeverity.WARNING,
        fieldName: 'country',
        message: 'Название товара указывает на несколько стран или регионов',
        detailsJson: {
          rawName: params.rawName,
          nameParts: payloadNestedObject(productPayload, 'nameParts'),
          geoSignals: payloadNestedObject(productPayload, 'nameParts').geoSignals ?? null,
        } as Prisma.InputJsonValue,
        suggestedAction: 'Укажите страну вручную перед подтверждением строки.',
      })
      createdIssues += 1
      continue
    }

    if (issue === 'VINTAGE_CONFLICT') {
      await createPriceImportIssueOnce({
        importId: params.importId,
        rowId: params.rowId,
        supplierId: params.supplierId,
        type: issue,
        severity: PriceImportIssueSeverity.ERROR,
        fieldName: 'vintage',
        message: 'Год из колонки прайса не совпадает с годом в названии товара',
        supplierValue: payloadNumber(productPayload, 'vintage') ?? undefined,
        detailsJson: {
          rawName: params.rawName,
          nameParts: payloadNestedObject(productPayload, 'nameParts'),
        } as Prisma.InputJsonValue,
        suggestedAction: 'Оставьте значение из колонки прайса и проверьте значение, найденное в названии товара.',
      })
      createdIssues += 1
    }
  }

  return createdIssues
}

type ProductLookupResult = {
  id: string
  categoryId: string | null
  rawCategory: string | null
  description: string | null
  translatedName: string | null
  brand: string | null
  producer: string | null
  country: string | null
  region: string | null
  manufacturer: string | null
  alcoholPercentMax: Prisma.Decimal | null
  features: Prisma.JsonValue | null
  color: string | null
  sugar: string | null
  packageVolume: Prisma.Decimal | null
  attributesJson: Prisma.JsonValue | null
}

const PRODUCT_LOOKUP_SELECT = {
  id: true,
  categoryId: true,
  rawCategory: true,
  description: true,
  translatedName: true,
  brand: true,
  producer: true,
  country: true,
  region: true,
  manufacturer: true,
  alcoholPercentMax: true,
  features: true,
  color: true,
  sugar: true,
  packageVolume: true,
  attributesJson: true,
} as const

type ProductAttributeFields = {
  translatedName: string | null
  brand: string | null
  producer: string | null
  country: string | null
  region: string | null
  manufacturer: string | null
  alcoholPercentMax: number | null
  features: string[]
  featureLabels: string[]
  color: string | null
  sugar: string | null
}

async function applyCategoryToProductIfNeeded(
  product: ProductLookupResult,
  categoryMatch: Awaited<ReturnType<typeof resolveCatalogCategoryMatch>> | null,
  rawCategory: string | null,
  attributeFields: ProductAttributeFields,
) {
  const data: Prisma.ProductUncheckedUpdateInput = {}

  if (categoryMatch?.category?.id && product.categoryId !== categoryMatch.category.id) {
    data.categoryId = categoryMatch.category.id
    data.rawCategory = rawCategory
  }

  // Fill-only-if-null: never overwrite an already-set attribute with a newer import's value,
  // so a sparser supplier price list can't clobber richer data from an earlier import/moderation edit.
  for (const key of ['translatedName', 'brand', 'producer', 'country', 'region', 'manufacturer', 'color', 'sugar'] as const) {
    const incoming = attributeFields[key]
    if (product[key] === null && incoming) {
      data[key] = incoming
    }
  }

  if (product.alcoholPercentMax === null && attributeFields.alcoholPercentMax !== null) {
    data.alcoholPercentMax = decimalOrNull(attributeFields.alcoholPercentMax, 2)
  }

  if (product.features === null && attributeFields.features.length) {
    data.features = attributeFields.features as Prisma.InputJsonValue
  }

  const nextDescription = appendFeatureLabelsToDescription(product.description, attributeFields.featureLabels)
  if (nextDescription !== product.description) {
    data.description = nextDescription
  }

  if (Object.keys(data).length === 0) {
    return { productId: product.id, created: false, updated: false }
  }

  await prisma.product.update({
    where: { id: product.id },
    data,
  })

  return { productId: product.id, created: false, updated: true }
}

async function findProductBySupplierAlias(params: {
  supplierId: string
  rawValue: string | null
  aliasTypes: SupplierProductAliasType[]
}) {
  const rawValue = normalizeIdentifierValue(params.rawValue)
  if (!rawValue) return null

  const alias = await prisma.supplierProductAlias.findFirst({
    where: {
      supplierId: params.supplierId,
      aliasType: { in: params.aliasTypes },
      normalizedValue: normalizeAliasValue(rawValue),
      isActive: true,
      supplierProduct: { isNot: null },
    },
    select: {
      supplierProduct: {
        select: {
          product: {
            select: PRODUCT_LOOKUP_SELECT,
          },
        },
      },
    },
  })

  return alias?.supplierProduct?.product ?? null
}

async function findProductByArticle(article: string | null) {
  const rawArticle = normalizeIdentifierValue(article)
  if (!rawArticle) return null

  return prisma.product.findFirst({
    where: {
      article: {
        equals: rawArticle,
        mode: 'insensitive',
      },
    },
    select: PRODUCT_LOOKUP_SELECT,
  })
}

async function findProductByNormalizedName(params: {
  rawName: string | null
  normalizedName: string | null
}) {
  const normalizedName = params.normalizedName || normalizeProductName(params.rawName)
  const rawName = params.rawName?.trim()

  if (!normalizedName && !rawName) {
    return null
  }

  if (rawName) {
    const exactProduct = await prisma.product.findFirst({
      where: {
        OR: [
          { name: { equals: rawName, mode: 'insensitive' } },
          { translatedName: { equals: rawName, mode: 'insensitive' } },
        ],
      },
      select: {
        ...PRODUCT_LOOKUP_SELECT,
        name: true,
        translatedName: true,
      },
    })

    if (exactProduct) {
      return exactProduct
    }
  }

  const nameProbe = rawName || normalizedName || ''
  const products = await prisma.product.findMany({
    where: {
      OR: [
        { name: { contains: nameProbe, mode: 'insensitive' } },
        { translatedName: { contains: nameProbe, mode: 'insensitive' } },
      ],
    },
    select: {
      ...PRODUCT_LOOKUP_SELECT,
      name: true,
      translatedName: true,
    },
    take: 100,
  })

  const bestMatch = products.reduce<{ product: (typeof products)[number] | null; confidence: number }>(
    (best, product) => {
      const confidence = Math.max(
        calculateNameSimilarity(normalizedName, product.name),
        calculateNameSimilarity(normalizedName, product.translatedName),
      )

      return confidence > best.confidence ? { product, confidence } : best
    },
    { product: null, confidence: 0 },
  )

  return bestMatch.product && bestMatch.confidence >= 0.95 ? bestMatch.product : null
}

async function resolveOrCreateProduct(params: {
  row: {
    rawName: string
    normalizedName: string | null
    rawCategory: string | null
    sourceBarcode: string | null
    sourceArticle: string | null
    sourceSku: string | null
    normalizedPayload: Prisma.JsonValue | null
  }
  mappedProductId: string | null
  supplierId: string
}) {
  const payload = jsonObject(params.row.normalizedPayload)
  const productPayload = payloadNestedObject(payload, 'product')
  const variantPayload = payloadNestedObject(payload, 'variant')
  const volumeMl =
    payloadNestedNumber(variantPayload, payload, 'volumeMl') ??
    payloadNestedNumber(productPayload, payload, 'volumeMl')
  const vintage = payloadNestedNumber(productPayload, payload, 'vintage')
  const alcoholPercent = payloadNestedNumber(productPayload, payload, 'alcoholPercent')
  const alcoholPercentMax = payloadNestedNumber(productPayload, payload, 'alcoholPercentMax')
  const grapeSorts = payloadStringList(productPayload, 'grapeSorts')
  const features = payloadStringList(productPayload, 'features')
  const featureLabels = await resolveFeatureLabels(features)
  const attributeFields: ProductAttributeFields = {
    translatedName: getCatalogRussianName(payload),
    brand: payloadNestedString(productPayload, payload, 'brand'),
    producer: payloadNestedString(productPayload, payload, 'producer'),
    country: payloadNestedString(productPayload, payload, 'country'),
    region: payloadNestedString(productPayload, payload, 'region'),
    manufacturer: payloadNestedString(productPayload, payload, 'manufacturer'),
    alcoholPercentMax,
    features,
    featureLabels,
    color: payloadNestedString(productPayload, payload, 'color'),
    sugar: payloadNestedString(productPayload, payload, 'sugar'),
  }
  const categoryMatch = await resolveCatalogCategoryMatch({
    rawCategory: params.row.rawCategory,
    supplierId: params.supplierId,
  })
  const productName = getCatalogCanonicalName(payload)
  const sourceBarcode = normalizeIdentifierValue(params.row.sourceBarcode)
  const sourceArticle = normalizeIdentifierValue(params.row.sourceArticle)
  const sourceSku = normalizeIdentifierValue(params.row.sourceSku)
  const isNormalizedAdminRow = isNormalizedAdminPayload(payload)
  const normalizedIdentityProduct = await findProductByNormalizedIdentity(payload)

  if (params.mappedProductId) {
    const existingProduct = await prisma.product.findUnique({
      where: { id: params.mappedProductId },
      select: PRODUCT_LOOKUP_SELECT,
    })

    if (existingProduct) {
      return applyCategoryToProductIfNeeded(existingProduct, categoryMatch, params.row.rawCategory, attributeFields)
    }
  }

  if (normalizedIdentityProduct) {
    return applyCategoryToProductIfNeeded(normalizedIdentityProduct, categoryMatch, params.row.rawCategory, attributeFields)
  }

  if (isNormalizedAdminRow && !productName) {
    return { productId: null, created: false, updated: false }
  }

  if (isNormalizedAdminRow) {
    const product = await prisma.product.create({
      data: {
        name: productName!,
        categoryId: categoryMatch?.category?.id ?? null,
        rawCategory: params.row.rawCategory,
        status: ProductCatalogStatus.CONFIRMED,
        isConfirmed: true,
        confirmedAt: new Date(),
        translatedName: attributeFields.translatedName,
        brand: attributeFields.brand,
        producer: attributeFields.producer,
        country: attributeFields.country,
        region: attributeFields.region,
        manufacturer: attributeFields.manufacturer,
        description: appendFeatureLabelsToDescription(
          payloadNestedString(productPayload, payload, 'description'),
          featureLabels,
        ),
        color: attributeFields.color,
        sugar: attributeFields.sugar,
        vintage: vintage !== null ? Math.round(vintage) : null,
        alcoholPercent: decimalOrNull(alcoholPercent, 2),
        alcoholPercentMax: decimalOrNull(alcoholPercentMax, 2),
        grapeSorts: grapeSorts.length ? grapeSorts as Prisma.InputJsonValue : undefined,
        features: features.length ? features as Prisma.InputJsonValue : undefined,
        packageVolume: decimalOrNull(volumeMl, 3),
        packageVolumeUnit: volumeMl !== null ? 'ml' : null,
        attributesJson: (buildProductAttributesJson(productPayload, variantPayload) as Prisma.InputJsonValue | null) ?? undefined,
      },
      select: { id: true },
    })

    return { productId: product.id, created: true, updated: false }
  }

  if (sourceBarcode) {
    const productByBarcode = await prisma.product.findUnique({
      where: { barcode: sourceBarcode },
      select: PRODUCT_LOOKUP_SELECT,
    })

    if (productByBarcode) {
      return applyCategoryToProductIfNeeded(productByBarcode, categoryMatch, params.row.rawCategory, attributeFields)
    }
  }

  const productBySkuAlias = await findProductBySupplierAlias({
    supplierId: params.supplierId,
    rawValue: sourceSku,
    aliasTypes: [SupplierProductAliasType.SUPPLIER_SKU],
  })
  if (productBySkuAlias) {
    return applyCategoryToProductIfNeeded(productBySkuAlias, categoryMatch, params.row.rawCategory, attributeFields)
  }

  const productByArticleAlias = await findProductBySupplierAlias({
    supplierId: params.supplierId,
    rawValue: sourceArticle,
    aliasTypes: [SupplierProductAliasType.SUPPLIER_ARTICLE, SupplierProductAliasType.LEGACY_ARTICLE],
  })
  if (productByArticleAlias) {
    return applyCategoryToProductIfNeeded(productByArticleAlias, categoryMatch, params.row.rawCategory, attributeFields)
  }

  const productByBarcodeAlias = await findProductBySupplierAlias({
    supplierId: params.supplierId,
    rawValue: sourceBarcode,
    aliasTypes: [SupplierProductAliasType.BARCODE],
  })
  if (productByBarcodeAlias) {
    return applyCategoryToProductIfNeeded(productByBarcodeAlias, categoryMatch, params.row.rawCategory, attributeFields)
  }

  const productByArticle = await findProductByArticle(sourceArticle)
  if (productByArticle) {
    return applyCategoryToProductIfNeeded(productByArticle, categoryMatch, params.row.rawCategory, attributeFields)
  }

  const productByNormalizedName = await findProductByNormalizedName({
    rawName: params.row.rawName,
    normalizedName: params.row.normalizedName,
  })
  if (productByNormalizedName) {
    return applyCategoryToProductIfNeeded(productByNormalizedName, categoryMatch, params.row.rawCategory, attributeFields)
  }

  if (!productName) {
    return { productId: null, created: false, updated: false }
  }

  const product = await prisma.product.create({
    data: {
      name: productName,
      categoryId: categoryMatch?.category?.id ?? null,
      rawCategory: params.row.rawCategory,
      status: ProductCatalogStatus.CONFIRMED,
      isConfirmed: true,
      confirmedAt: new Date(),
      barcode: sourceBarcode,
      article: sourceArticle,
      translatedName: attributeFields.translatedName,
      brand: attributeFields.brand,
      producer: attributeFields.producer,
      country: attributeFields.country,
      region: attributeFields.region,
      manufacturer: attributeFields.manufacturer,
      description: appendFeatureLabelsToDescription(
        payloadNestedString(productPayload, payload, 'description'),
        featureLabels,
      ),
      color: attributeFields.color,
      sugar: attributeFields.sugar,
      vintage: vintage !== null ? Math.round(vintage) : null,
      alcoholPercent: decimalOrNull(alcoholPercent, 2),
      alcoholPercentMax: decimalOrNull(alcoholPercentMax, 2),
      grapeSorts: grapeSorts.length ? grapeSorts as Prisma.InputJsonValue : undefined,
      features: features.length ? features as Prisma.InputJsonValue : undefined,
      packageVolume: decimalOrNull(volumeMl, 3),
      packageVolumeUnit: volumeMl !== null ? 'ml' : null,
      attributesJson: (buildProductAttributesJson(productPayload, variantPayload) as Prisma.InputJsonValue | null) ?? undefined,
    },
    select: { id: true },
  })

  return { productId: product.id, created: true, updated: false }
}

async function resolveOrCreateVariant(productId: string, payload: Record<string, unknown>) {
  const productPayload = payloadNestedObject(payload, 'product')
  const variantPayload = payloadNestedObject(payload, 'variant')
  const volumeMl = payloadNestedNumber(variantPayload, payload, 'volumeMl')
  const packageSize =
    payloadNestedNumber(variantPayload, payload, 'packageSize') ??
    payloadNestedNumber(variantPayload, payload, 'packQty')
  const volume = decimalOrNull(volumeMl, 3)
  const volumeUnit = payloadNestedString(variantPayload, payload, 'volumeUnit') || (volumeMl !== null ? 'ml' : null)
  const packageSizeValue = decimalOrNull(packageSize, 3)
  const unit = payloadNestedString(variantPayload, payload, 'unit')
  const packageSizeUnit =
    packageSizeValue !== null
      ? payloadNestedString(variantPayload, payload, 'packageSizeUnit') || unit
      : null
  const packagingType =
    payloadNestedString(variantPayload, productPayload, 'packagingType') ??
    derivePackagingType(unit, volumeMl)

  const existingVariant = await prisma.productVariant.findFirst({
    where: {
      productId,
      volume,
      volumeUnit,
    },
    select: { id: true, packagingType: true },
  })

  if (existingVariant) {
    await prisma.productVariant.update({
      where: { id: existingVariant.id },
      data: {
        packageSize: packageSizeValue,
        packageSizeUnit,
        // Fill-only-if-null, matching the product attribute policy: don't let a later,
        // less specific import row erase a packaging type already inferred/set for this variant.
        packagingType: existingVariant.packagingType === null ? packagingType : undefined,
      },
    })

    return { variantId: existingVariant.id, created: false }
  }

  const hasAnyVariant = await prisma.productVariant.findFirst({
    where: { productId },
    select: { id: true },
  })

  const variant = await prisma.productVariant.create({
    data: {
      productId,
      volume,
      volumeUnit,
      packageSize: packageSizeValue,
      packageSizeUnit,
      packagingType,
      isDefault: !hasAnyVariant,
    },
    select: { id: true },
  })

  return { variantId: variant.id, created: true }
}

export async function createProductFromImportRow(
  importId: string,
  rowId: string,
  overrides?: { name?: unknown; categoryId?: unknown },
) {
  const priceImport = await prisma.supplierPriceImport.findUnique({ where: { id: importId } })
  if (!priceImport) {
    throw new Error('Price import not found')
  }
  assertImportCanChangePreview(priceImport.status)

  const row = await prisma.supplierPriceImportRow.findFirst({ where: { id: rowId, importId } })
  if (!row) {
    throw new Error(`Price import row not found: ${rowId}`)
  }

  const payload = jsonObject(row.normalizedPayload)
  const productPayload = payloadNestedObject(payload, 'product')
  const variantPayload = payloadNestedObject(payload, 'variant')
  const volumeMl =
    payloadNestedNumber(variantPayload, payload, 'volumeMl') ??
    payloadNestedNumber(productPayload, payload, 'volumeMl')
  const vintage = payloadNestedNumber(productPayload, payload, 'vintage')
  const alcoholPercent = payloadNestedNumber(productPayload, payload, 'alcoholPercent')
  const alcoholPercentMax = payloadNestedNumber(productPayload, payload, 'alcoholPercentMax')
  const grapeSorts = payloadStringList(productPayload, 'grapeSorts')
  const features = payloadStringList(productPayload, 'features')
  const featureLabels = await resolveFeatureLabels(features)
  const sourceBarcode = normalizeIdentifierValue(row.sourceBarcode)
  const sourceArticle = normalizeIdentifierValue(row.sourceArticle)
  const sourceSku = normalizeIdentifierValue(row.sourceSku)

  const overrideName = parseNullableString(overrides?.name)
  const productName =
    (typeof overrideName === 'string' ? overrideName : undefined) ||
    payloadNestedString(productPayload, payload, 'name') ||
    payloadNestedString(productPayload, payload, 'displayName') ||
    row.rawName?.trim() ||
    row.normalizedName?.trim() ||
    sourceArticle ||
    sourceSku ||
    sourceBarcode

  if (!productName) {
    throw new Error('Product name is required')
  }

  const overrideCategoryId = parseNullableString(overrides?.categoryId)
  let categoryId: string | null = null
  if (typeof overrideCategoryId === 'string') {
    const category = await prisma.catalogCategory.findUnique({
      where: { id: overrideCategoryId },
      select: { id: true },
    })
    if (!category) {
      throw new Error('Catalog category not found')
    }
    categoryId = category.id
  } else {
    categoryId = payloadString(productPayload, 'categoryId')
  }

  const product = await prisma.product.create({
    data: {
      name: productName,
      categoryId,
      rawCategory: row.rawCategory,
      barcode: sourceBarcode,
      article: sourceArticle,
      translatedName: getCatalogRussianName(payload),
      brand: payloadNestedString(productPayload, payload, 'brand'),
      producer: payloadNestedString(productPayload, payload, 'producer'),
      country: payloadNestedString(productPayload, payload, 'country'),
      region: payloadNestedString(productPayload, payload, 'region'),
      manufacturer: payloadNestedString(productPayload, payload, 'manufacturer'),
      description: appendFeatureLabelsToDescription(
        payloadNestedString(productPayload, payload, 'description'),
        featureLabels,
      ),
      vintage: vintage !== null ? Math.round(vintage) : null,
      alcoholPercent: decimalOrNull(alcoholPercent, 2),
      alcoholPercentMax: decimalOrNull(alcoholPercentMax, 2),
      color: payloadNestedString(productPayload, payload, 'color'),
      sugar: payloadNestedString(productPayload, payload, 'sugar'),
      grapeSorts: grapeSorts.length ? (grapeSorts as Prisma.InputJsonValue) : undefined,
      features: features.length ? (features as Prisma.InputJsonValue) : undefined,
      packageVolume: decimalOrNull(volumeMl, 3),
      packageVolumeUnit: volumeMl !== null ? 'ml' : null,
    },
    select: { id: true },
  })

  const { variantId } = await resolveOrCreateVariant(product.id, payload)

  await prisma.supplierPriceImportRow.update({
    where: { id: rowId },
    data: {
      mappedProduct: { connect: { id: product.id } },
      mappedProductVariant: { connect: { id: variantId } },
      mappingStatus: PriceImportRowMappingStatus.MANUAL_MATCHED,
      mappingConfidence: new Prisma.Decimal('1.00'),
    },
  })

  await prisma.supplierPriceImportIssue.updateMany({
    where: {
      importId,
      rowId,
      status: PriceImportIssueStatus.OPEN,
      OR: [
        { fieldName: 'product' },
        { message: 'Товар не удалось определить' },
        { message: 'Product could not be resolved' },
        { message: { startsWith: 'Возможное совпадение товара' } },
        { message: { startsWith: 'Possible product match' } },
      ],
    },
    data: {
      status: PriceImportIssueStatus.RESOLVED,
      resolvedAt: new Date(),
      resolutionJson: {
        source: 'MANUAL_PRODUCT_CREATE',
        productId: product.id,
      } as Prisma.InputJsonValue,
    },
  })

  await syncCatalogReviewState(importId)

  return prisma.supplierPriceImport.findUniqueOrThrow({
    where: { id: importId },
    include: { fileAsset: true },
  })
}

async function resolveOrCreateSupplierProduct(params: {
  supplierId: string
  productId: string
  productVariantId: string
  supplierSku: string | null
  supplierNameAlias?: string | null
  sourceImportId?: string | null
  sourceImportRowId?: string | null
}) {
  const supplierSku = normalizeIdentifierValue(params.supplierSku)

  if (supplierSku) {
    const existingBySku = await prisma.supplierProduct.findFirst({
      where: {
        supplierId: params.supplierId,
        supplierSku,
      },
      select: { id: true, productId: true, productVariantId: true },
    })

    if (
      existingBySku &&
      existingBySku.productId === params.productId &&
      existingBySku.productVariantId === params.productVariantId
    ) {
      await prisma.supplierProduct.update({
        where: { id: existingBySku.id },
        data: {
          supplierNameAlias: params.supplierNameAlias,
          sourceImportId: params.sourceImportId,
          sourceImportRowId: params.sourceImportRowId,
        },
      })
      return { supplierProductId: existingBySku.id, created: false }
    }
  }

  const existingSupplierProduct = await prisma.supplierProduct.findUnique({
    where: {
      supplierId_productId_productVariantId: {
        supplierId: params.supplierId,
        productId: params.productId,
        productVariantId: params.productVariantId,
      },
    },
    select: { id: true, supplierSku: true },
  })

  if (existingSupplierProduct) {
    await prisma.supplierProduct.update({
      where: { id: existingSupplierProduct.id },
      data: {
        supplierSku: supplierSku && existingSupplierProduct.supplierSku !== supplierSku
          ? supplierSku
          : existingSupplierProduct.supplierSku,
        supplierNameAlias: params.supplierNameAlias,
        sourceImportId: params.sourceImportId,
        sourceImportRowId: params.sourceImportRowId,
      },
    })

    return { supplierProductId: existingSupplierProduct.id, created: false }
  }

  const supplierProduct = await prisma.supplierProduct.create({
    data: {
      supplierId: params.supplierId,
      productId: params.productId,
      productVariantId: params.productVariantId,
      supplierSku,
      supplierNameAlias: params.supplierNameAlias,
      sourceImportId: params.sourceImportId,
      sourceImportRowId: params.sourceImportRowId,
    },
    select: { id: true },
  })

  return { supplierProductId: supplierProduct.id, created: true }
}

export async function importPriceFile(params: {
  supplierId: string
  file: {
    originalname: string
    mimetype: string
    size: number
    path: string
    filename: string
  }
  uploadType?: SupplierPriceImportUploadType
}) {
  await ensureSupplierExists(params.supplierId)

  const uploadType: SupplierPriceImportUploadType = params.uploadType === 'ORIGINAL' ? 'ORIGINAL' : 'NORMALIZED'
  const displayFileName = normalizeUploadDisplayFileName(params.file.originalname)
  const sourceFormat = detectPriceImportSourceFormat(displayFileName)
  const storageKey = `uploads/${params.file.filename}`
  await ensureUploadFileStored({
    sourcePath: params.file.path,
    storageKey,
  })

  const fileAsset = await prisma.fileAsset.create({
    data: {
      storageKey,
      fileName: displayFileName,
      mimeType: params.file.mimetype || 'application/octet-stream',
      fileSize: params.file.size,
      type: FileAssetType.SPREADSHEET,
      uploadedBySupplierId: params.supplierId,
    },
  })

  const priceImport = await prisma.supplierPriceImport.create({
    data: {
      supplierId: params.supplierId,
      fileAssetId: fileAsset.id,
      sourceFormat,
      status: uploadType === 'ORIGINAL' ? PriceImportStatus.UPLOADED : PriceImportStatus.PROCESSING,
      importKind: SupplierPriceImportKind.PRICE_WITH_OFFERS,
      originalFileName: displayFileName,
      parserVersion: PRICE_IMPORT_PARSER_VERSION,
      mappingConfigJson: {
        uploadType,
      } as Prisma.InputJsonValue,
      processedRows: 0,
      failedRows: 0,
    },
  })

  const processedImport = uploadType === 'ORIGINAL'
    ? priceImport
    : await processSupplierPriceImport(priceImport.id, { profileOverride: NORMALIZED_ADMIN_PROFILE })

  return {
    importId: processedImport.id,
    supplierId: processedImport.supplierId,
    sourceFormat: processedImport.sourceFormat,
    status: processedImport.status,
    rowsCount: processedImport.rowsCount,
    processedRows: processedImport.processedRows,
    failedRows: processedImport.failedRows,
    fileAssetId: processedImport.fileAssetId,
  }
}

export async function processSupplierPriceImport(
  importId: string,
  options: {
    profileOverride?: Record<string, unknown> | null
  } = {},
) {
  const priceImport = await prisma.supplierPriceImport.findUnique({
    where: { id: importId },
    include: { fileAsset: true, profile: true },
  })

  if (!priceImport) {
    throw new Error('Price import not found')
  }

  await ensureSupplierExists(priceImport.supplierId)

  const existingMappingConfig = jsonObject(priceImport.mappingConfigJson)
  const configuredUploadType = existingMappingConfig.uploadType === 'NORMALIZED' || existingMappingConfig.uploadType === 'ORIGINAL'
    ? existingMappingConfig.uploadType
    : null
  const configuredProfileOverride = options.profileOverride ?? (
    configuredUploadType === 'NORMALIZED' ? NORMALIZED_ADMIN_PROFILE : null
  )
  const filePath = getStoredUploadPath(priceImport.fileAsset.storageKey)
  const sourceFormat = priceImport.sourceFormat || detectPriceImportSourceFormat(priceImport.fileAsset.fileName)
  const parserOptions = {
    supplierId: priceImport.supplierId,
    profile: configuredProfileOverride ?? (priceImport.profile?.rulesJson &&
      typeof priceImport.profile.rulesJson === 'object' &&
      !Array.isArray(priceImport.profile.rulesJson)
      ? priceImport.profile.rulesJson as Record<string, unknown>
      : null),
  }
  const detectedProfile = detectImportProfileFromFile(filePath, sourceFormat, parserOptions)
  const effectiveImportKind = toSupplierPriceImportKind(detectedProfile.profile.importKind)
  const parsedRows = await parseRowsFromFile(filePath, sourceFormat, parserOptions)
  const noParsedRowsMessage = 'Price import parser returned 0 rows. Check sheet/header mapping or file structure.'

  await prisma.supplierPriceImport.update({
    where: { id: importId },
    data: {
      status: PriceImportStatus.PROCESSING,
      importKind: effectiveImportKind,
      parserVersion: PRICE_IMPORT_PARSER_VERSION,
      detectedProfileJson: {
        code: detectedProfile.profile.code ?? null,
        name: detectedProfile.profile.name ?? null,
        parserKind: detectedProfile.profile.parserKind ?? 'generic',
        importKind: detectedProfile.profile.importKind ?? 'PRICE_WITH_OFFERS',
        bestSheetName: detectedProfile.structure?.bestSheetName ?? null,
        sheets: detectedProfile.structure?.sheets.map((sheet) => ({
          name: sheet.name,
          rowCount: sheet.rowCount,
          columnCount: sheet.columnCount,
          headerRowIndex: sheet.headerRowIndex,
          headerConfidence: sheet.headerConfidence,
          headers: sheet.headers,
        })) ?? [],
      } as Prisma.InputJsonValue,
      mappingConfigJson: {
        sheets: detectedProfile.profile.sheets ?? null,
        header: detectedProfile.profile.header ?? null,
        columns: detectedProfile.profile.columns ?? null,
        contextRows: detectedProfile.profile.contextRows ?? null,
        mergeRows: detectedProfile.profile.mergeRows ?? null,
        rowClassification: detectedProfile.profile.rowClassification ?? null,
        publishing: detectedProfile.profile.publishing ?? null,
        uploadType: configuredUploadType,
      } as Prisma.InputJsonValue,
      rowsCount: parsedRows.length,
      parsedRows: 0,
      processedRows: 0,
      matchedRows: 0,
      failedRows: 0,
      issuesCount: 0,
      criticalIssuesCount: 0,
      errorText: null,
    },
  })

  await prisma.supplierPriceImportIssue.deleteMany({ where: { importId } })
  await prisma.productCandidate.deleteMany({ where: { importId } })
  await prisma.supplierPriceImportRow.deleteMany({ where: { importId } })

  if (parsedRows.length === 0) {
    await prisma.supplierPriceImport.update({
      where: { id: importId },
      data: {
        status: PriceImportStatus.FAILED,
        rowsCount: 0,
        parsedRows: 0,
        processedRows: 0,
        matchedRows: 0,
        failedRows: 0,
        issuesCount: 1,
        criticalIssuesCount: 1,
        errorText: noParsedRowsMessage,
      },
    })

    await prisma.supplierPriceImportIssue.create({
      data: {
        importId,
        supplierId: priceImport.supplierId,
        type: 'FILE_PARSE',
        severity: PriceImportIssueSeverity.CRITICAL,
        status: PriceImportIssueStatus.OPEN,
        fieldName: 'file',
        message: noParsedRowsMessage,
      },
    })

    throw new Error(noParsedRowsMessage)
  }

  let processedRows = 0
  let matchedRows = 0
  let failedRows = 0
  let issuesCount = 0

  try {
    for (const row of parsedRows) {
      const issueMessages: string[] = []
      let categoryMatch: Awaited<ReturnType<typeof resolveCatalogCategoryMatch>> | null = null
      let mappedProductId: string | null = null
      let mappingStatus: PriceImportRowMappingStatus = PriceImportRowMappingStatus.UNMATCHED
      let mappingConfidence: number | null = null
      let errorText: string | null = null

      try {
        categoryMatch = await resolveCatalogCategoryMatch({
          rawCategory: row.rawCategory,
          supplierId: priceImport.supplierId,
        })

        const productMatchResult = await resolveProductMatch(row)
        mappedProductId = productMatchResult.product?.id || null
        mappingConfidence = productMatchResult.confidence > 0 ? productMatchResult.confidence : null

        if (productMatchResult.status === 'LOW_CONFIDENCE') {
          issueMessages.push(`Возможное совпадение товара с уверенностью ${productMatchResult.confidence.toFixed(2)}`)
        }

        if (!categoryMatch.category) {
          issueMessages.push('Категория каталога не определена')
          if (!productMatchResult.product) {
            issueMessages.push('Товар не удалось определить')
          }
        }

        mappingStatus = productMatchResult.status === 'MATCHED'
          ? PriceImportRowMappingStatus.MATCHED
          : productMatchResult.status === 'LOW_CONFIDENCE'
            ? PriceImportRowMappingStatus.LOW_CONFIDENCE
            : categoryMatch.category
              ? PriceImportRowMappingStatus.CANDIDATE
              : PriceImportRowMappingStatus.UNMATCHED

      } catch (error) {
        mappingStatus = PriceImportRowMappingStatus.FAILED
        errorText = error instanceof Error ? error.message : 'Unknown row processing error'
        issueMessages.push(errorText)
      }

      const sourceBarcode = normalizeIdentifierValue(row.barcode)
      const sourceArticle = normalizeIdentifierValue(row.article)
      const sourceSku = normalizeIdentifierValue(row.supplierSku)
      const identityKey = buildIdentityKey({
        barcode: sourceBarcode,
        article: sourceArticle,
        supplierSku: sourceSku,
        normalizedName: row.normalizedName || normalizeProductName(row.rawName),
      })
      const rowHash = buildRowHash(row)
      const normalizedPayloadWithCategory = withCategoryMatchPayload(
        row.normalizedPayload,
        row.rawCategory,
        categoryMatch,
      )
      const isNormalizedAdminRow = isNormalizedAdminPayload(row.normalizedPayload)
      const validationStatus = isNormalizedAdminRow &&
        mappingStatus !== PriceImportRowMappingStatus.FAILED &&
        categoryMatch?.category &&
        row.price !== null
          ? CatalogImportRowValidationStatus.READY_TO_PUBLISH
          : undefined

      const createdRow = await prisma.supplierPriceImportRow.create({
        data: {
          importId,
          rowIndex: row.rowNumber,
          rawName: row.rawName || '(empty)',
          normalizedName: row.normalizedName,
          rawCategory: row.rawCategory,
          mappedProductId,
          mappingStatus,
          mappingConfidence: mappingConfidence ? new Prisma.Decimal(mappingConfidence.toFixed(2)) : null,
          identityKey,
          rowHash,
          rawPayload: row.rawPayload as Prisma.InputJsonValue,
          normalizedPayload: normalizedPayloadWithCategory,
          sourceBarcode,
          sourceArticle,
          sourceSku,
          validationStatus,
          errorText: errorText || (issueMessages.length ? issueMessages.join('. ') : null),
        },
        select: { id: true },
      })
      const parserIssuesCount = await createNameDecompositionIssues({
        importId,
        rowId: createdRow.id,
        supplierId: priceImport.supplierId,
        rawName: row.rawName,
        rawCategory: row.rawCategory,
        normalizedPayload: normalizedPayloadWithCategory as unknown as Prisma.JsonValue,
      })
      await upsertSupplierProvidedNameTranslation(jsonObject(normalizedPayloadWithCategory as unknown as Prisma.JsonValue))

      if (!mappedProductId) {
        const normalizedName = row.normalizedName || normalizeProductName(row.rawName)

        if (normalizedName) {
          await prisma.productCandidate.create({
            data: {
              supplierId: priceImport.supplierId,
              importId,
              importRowId: createdRow.id,
              normalizedName,
              categoryName: row.rawCategory,
              barcode: row.barcode,
              supplierArticle: row.article || row.supplierSku,
              volumeMl: row.volumeMl,
              confidence: mappingConfidence ? new Prisma.Decimal(mappingConfidence.toFixed(2)) : null,
              identityKey,
              payloadJson: row.rawPayload as Prisma.InputJsonValue,
              resolutionJson: {
                source: 'PRICE_IMPORT',
                categoryMatchSource: categoryMatch?.source || null,
                categoryMatchConfidence: categoryMatch?.confidence ?? null,
                categoryMatchReason: categoryMatch?.reason ?? null,
                categoryId: categoryMatch?.category?.id ?? null,
                rawCategory: row.rawCategory,
              } as Prisma.InputJsonValue,
            },
          })
        }
      }

      if (issueMessages.length) {
        await prisma.supplierPriceImportIssue.createMany({
          data: issueMessages.map((message) => ({
            importId,
            rowId: createdRow.id,
            supplierId: priceImport.supplierId,
            type: 'ROW_PARSE',
            severity: PriceImportIssueSeverity.WARNING,
            status: PriceImportIssueStatus.OPEN,
            fieldName: 'row',
            message,
          })),
        })
      }

      processedRows += 1
      if (mappingStatus === PriceImportRowMappingStatus.MATCHED) matchedRows += 1
      if (
        mappingStatus === PriceImportRowMappingStatus.FAILED ||
        mappingStatus === PriceImportRowMappingStatus.UNMATCHED
      ) {
        failedRows += 1
      }
      issuesCount += issueMessages.length + parserIssuesCount
    }

    await prisma.supplierPriceImport.update({
      where: { id: importId },
      data: {
        status: issuesCount > 0 || failedRows > 0
          ? PriceImportStatus.HAS_ISSUES
          : PriceImportStatus.READY_TO_PUBLISH,
        rowsCount: parsedRows.length,
        parsedRows: processedRows,
        processedRows,
        matchedRows,
        failedRows,
        issuesCount,
        criticalIssuesCount: 0,
      },
      include: { fileAsset: true },
    })

    await syncCatalogReviewState(importId)

    return prisma.supplierPriceImport.findUniqueOrThrow({
      where: { id: importId },
      include: { fileAsset: true },
    })
  } catch (error) {
    await prisma.supplierPriceImport.update({
      where: { id: importId },
      data: {
        status: PriceImportStatus.FAILED,
        errorText: error instanceof Error ? error.message : 'Unknown price import processing error',
      },
    })

    throw error
  }
}

function assertImportCanChangePreview(status: PriceImportStatus) {
  if (status === PriceImportStatus.PUBLISHED) {
    throw new Error('Published price import cannot be changed. Upload a new import instead.')
  }
}

function mergeJsonObjects(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base }

  for (const [key, value] of Object.entries(patch)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = mergeJsonObjects(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      )
      continue
    }

    result[key] = value
  }

  return result
}

const CATEGORY_REVIEW_ISSUES = [
  'CATEGORY_UNRESOLVED',
  'CATEGORY_SUGGESTION_CONFLICT',
  'NAME_CATEGORY_MISMATCH',
]

const COUNTRY_REVIEW_ISSUES = [
  'COUNTRY_CONFLICT',
  'GEO_AMBIGUOUS',
]

const VARIANT_REVIEW_ISSUES = [
  'VOLUME_CONFLICT',
]

const NAME_REVIEW_ISSUES = [
  'VINTAGE_CONFLICT',
]

function collectResolvedIssueHintsFromPatch(
  patch: Record<string, unknown> | null,
): { fields: Set<string>; issueTypes: Set<string> } {
  const fields = new Set<string>()
  const issueTypes = new Set<string>()
  if (!patch) return { fields, issueTypes }

  const productPatch = payloadNestedObject(patch, 'product')
  const variantPatch = payloadNestedObject(patch, 'variant')
  const mappingPatch = payloadNestedObject(patch, 'mapping')

  if (
    hasPayloadField(productPatch, 'categoryId') ||
    hasPayloadField(productPatch, 'categoryRaw') ||
    hasPayloadField(productPatch, 'categoryName') ||
    hasPayloadField(mappingPatch, 'categoryConfirmed') ||
    hasPayloadField(mappingPatch, 'categorySource')
  ) {
    fields.add('category')
    CATEGORY_REVIEW_ISSUES.forEach((issue) => issueTypes.add(issue))
  }

  if (
    hasPayloadField(productPatch, 'country') ||
    hasPayloadField(productPatch, 'region') ||
    hasPayloadField(mappingPatch, 'countryResolved')
  ) {
    fields.add('country')
    COUNTRY_REVIEW_ISSUES.forEach((issue) => issueTypes.add(issue))
  }

  if (
    hasPayloadField(variantPatch, 'volumeMl') ||
    hasPayloadField(variantPatch, 'packageSize') ||
    hasPayloadField(variantPatch, 'packageSizeUnit') ||
    hasPayloadField(productPatch, 'volumeMl')
  ) {
    fields.add('variant')
    fields.add('volume')
    VARIANT_REVIEW_ISSUES.forEach((issue) => issueTypes.add(issue))
  }

  if (
    hasPayloadField(productPatch, 'name') ||
    hasPayloadField(productPatch, 'canonicalName') ||
    hasPayloadField(productPatch, 'russianName') ||
    hasPayloadField(productPatch, 'translatedName') ||
    hasPayloadField(productPatch, 'vintage')
  ) {
    fields.add('name')
    NAME_REVIEW_ISSUES.forEach((issue) => issueTypes.add(issue))
  }

  return { fields, issueTypes }
}

function removeResolvedMappingIssues(
  payload: Prisma.JsonValue | null | undefined,
  issueTypes: Set<string>,
) {
  if (!issueTypes.size) return payload

  const payloadObject = jsonObject(payload)
  const mappingPayload = payloadNestedObject(payloadObject, 'mapping')
  const currentIssues = payloadStringList(mappingPayload, 'issues')
  if (!currentIssues.length) return payload

  const nextIssues = currentIssues.filter((issue) => !issueTypes.has(issue))
  if (nextIssues.length === currentIssues.length) return payload

  return mergeJsonObjects(payloadObject, {
    mapping: {
      ...mappingPayload,
      issues: nextIssues,
      resolvedIssues: [
        ...payloadStringList(mappingPayload, 'resolvedIssues'),
        ...currentIssues.filter((issue) => issueTypes.has(issue)),
      ],
    },
  }) as Prisma.InputJsonValue
}

async function resolveOpenRowIssues(params: {
  importId: string
  rowId: string
  fields: Set<string>
  issueTypes: Set<string>
  source: string
}) {
  const conditions: Prisma.SupplierPriceImportIssueWhereInput[] = []
  if (params.fields.size) {
    conditions.push({ fieldName: { in: [...params.fields] } })
  }
  if (params.issueTypes.size) {
    conditions.push({ type: { in: [...params.issueTypes] } })
  }
  if (!conditions.length) return

  await prisma.supplierPriceImportIssue.updateMany({
    where: {
      importId: params.importId,
      rowId: params.rowId,
      status: PriceImportIssueStatus.OPEN,
      OR: conditions,
    },
    data: {
      status: PriceImportIssueStatus.RESOLVED,
      resolvedAt: new Date(),
      resolutionJson: {
        source: params.source,
      } as Prisma.InputJsonValue,
    },
  })
}

async function resolveManualCategoryMapping(params: {
  importId: string
  supplierId: string
  rowId: string
  rawCategory: string | null
  categoryId: string
  normalizedPayload: Prisma.JsonValue | null
}) {
  const category = await prisma.catalogCategory.findUnique({
    where: { id: params.categoryId },
    select: {
      id: true,
      code: true,
      name: true,
      parentId: true,
    },
  })

  if (!category) {
    throw new Error('Catalog category not found')
  }

  const normalizedRawCategory = normalizeRawCategory(params.rawCategory)
  if (normalizedRawCategory) {
    const existingMapping = await prisma.catalogCategoryMapping.findFirst({
      where: {
        supplierId: params.supplierId,
        normalizedRawCategory,
      },
      select: { id: true },
    })

    if (existingMapping) {
      await prisma.catalogCategoryMapping.update({
        where: { id: existingMapping.id },
        data: {
          rawCategory: params.rawCategory ?? category.name,
          catalogCategoryId: category.id,
        },
      })
    } else {
      await prisma.catalogCategoryMapping.create({
        data: {
          supplierId: params.supplierId,
          rawCategory: params.rawCategory ?? category.name,
          normalizedRawCategory,
          catalogCategoryId: category.id,
        },
      })
    }
  }

  const payload = jsonObject(params.normalizedPayload)
  const productPayload = payloadNestedObject(payload, 'product')
  const mappingPayload = payloadNestedObject(payload, 'mapping')

  await prisma.supplierPriceImportIssue.updateMany({
    where: {
      importId: params.importId,
      rowId: params.rowId,
      status: PriceImportIssueStatus.OPEN,
      OR: [
        { fieldName: 'category' },
        { message: 'Категория каталога не определена' },
        { message: 'Catalog category could not be resolved' },
      ],
    },
    data: {
      status: PriceImportIssueStatus.RESOLVED,
      resolvedAt: new Date(),
      resolutionJson: {
        source: 'MANUAL_CATEGORY_MAPPING',
        categoryId: category.id,
      } as Prisma.InputJsonValue,
    },
  })

  return {
    normalizedPayload: {
      ...payload,
      product: {
        ...productPayload,
        categoryRaw: params.rawCategory,
        categoryId: category.id,
        categoryName: category.name,
        categorySource: 'EXACT_SUPPLIER_MAPPING',
        categoryConfidence: 1,
        categoryReason: 'Категория вручную подтверждена в mapping preview.',
      },
      mapping: {
        ...mappingPayload,
        categorySource: 'EXACT_SUPPLIER_MAPPING',
        categoryConfidence: 1,
        categoryReason: 'Категория вручную подтверждена в mapping preview.',
      },
    } as Prisma.InputJsonValue,
    category,
  }
}

const UNRESOLVED_ROW_STATUSES: PriceImportRowMappingStatus[] = [
  PriceImportRowMappingStatus.UNMATCHED,
  PriceImportRowMappingStatus.LOW_CONFIDENCE,
  PriceImportRowMappingStatus.CANDIDATE,
]

async function applyCategoryToSimilarRows(params: {
  importId: string
  exceptRowId: string
  rawCategory: string | null
  category: { id: string; name: string }
}) {
  const normalizedRawCategory = normalizeRawCategory(params.rawCategory)
  if (!normalizedRawCategory) return

  const siblingRows = await prisma.supplierPriceImportRow.findMany({
    where: {
      importId: params.importId,
      id: { not: params.exceptRowId },
      mappingStatus: { in: UNRESOLVED_ROW_STATUSES },
    },
    select: { id: true, rawCategory: true, normalizedPayload: true },
  })

  const matchingRows = siblingRows.filter(
    (row) => normalizeRawCategory(row.rawCategory) === normalizedRawCategory,
  )

  for (const row of matchingRows) {
    const payload = jsonObject(row.normalizedPayload as Prisma.JsonValue | null)
    const productPayload = payloadNestedObject(payload, 'product')
    const mappingPayload = payloadNestedObject(payload, 'mapping')

    await prisma.supplierPriceImportRow.update({
      where: { id: row.id },
      data: {
        mappingStatus: PriceImportRowMappingStatus.MANUAL_MATCHED,
        mappingConfidence: new Prisma.Decimal('1.00'),
        normalizedPayload: {
          ...payload,
          product: {
            ...productPayload,
            categoryId: params.category.id,
            categoryName: params.category.name,
            categorySource: 'EXACT_SUPPLIER_MAPPING',
            categoryConfidence: 1,
            categoryReason: 'Категория применена по правилу похожих строк.',
          },
          mapping: {
            ...mappingPayload,
            categorySource: 'EXACT_SUPPLIER_MAPPING',
            categoryConfidence: 1,
            categoryReason: 'Категория применена по правилу похожих строк.',
          },
        } as Prisma.InputJsonValue,
      },
    })

    await prisma.supplierPriceImportIssue.updateMany({
      where: {
        importId: params.importId,
        rowId: row.id,
        status: PriceImportIssueStatus.OPEN,
        OR: [
          { fieldName: 'category' },
          { message: 'Категория каталога не определена' },
          { message: 'Catalog category could not be resolved' },
        ],
      },
      data: {
        status: PriceImportIssueStatus.RESOLVED,
        resolvedAt: new Date(),
        resolutionJson: {
          source: 'MANUAL_CATEGORY_MAPPING_SIMILAR_ROWS',
          categoryId: params.category.id,
        } as Prisma.InputJsonValue,
      },
    })
  }
}

function parseManualMappingStatus(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  if (typeof value !== 'string') {
    throw new Error('mappingStatus must be a string')
  }

  if (!Object.values(PriceImportRowMappingStatus).includes(value as PriceImportRowMappingStatus)) {
    throw new Error('Invalid mappingStatus')
  }

  return value as PriceImportRowMappingStatus
}

function parseValidationStatus(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  if (typeof value !== 'string') {
    throw new Error('validationStatus must be a string')
  }

  if (!Object.values(CatalogImportRowValidationStatus).includes(value as CatalogImportRowValidationStatus)) {
    throw new Error('Invalid validationStatus')
  }

  return value as CatalogImportRowValidationStatus
}

function parseNullableString(value: unknown) {
  if (value === null) return null
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function parseNullableNumber(value: unknown) {
  if (value === null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function getPublishRowType(
  row: {
    rowType: string | null
    rawPayload: Prisma.JsonValue | null
    normalizedPayload: Prisma.JsonValue | null
  },
) {
  const rawPayload = jsonObject(row.rawPayload)
  const normalizedPayload = jsonObject(row.normalizedPayload)
  const mappingPayload = payloadNestedObject(normalizedPayload, 'mapping')

  return (
    row.rowType ||
    payloadString(rawPayload, 'rowType') ||
    payloadString(normalizedPayload, 'rowType') ||
    payloadString(mappingPayload, 'rowType')
  )
}

function parsePayloadPatch(value: unknown) {
  if (value === null || value === undefined) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('normalizedPayloadPatch must be an object')
  }
  return value as Record<string, unknown>
}

export async function updateSupplierPriceImportMapping(
  importId: string,
  input: {
    mappingConfig?: unknown
    rows?: unknown
  },
) {
  const priceImport = await prisma.supplierPriceImport.findUnique({
    where: { id: importId },
    include: { fileAsset: true },
  })

  if (!priceImport) {
    throw new Error('Price import not found')
  }

  assertImportCanChangePreview(priceImport.status)

  if (
    input.mappingConfig !== undefined &&
    input.mappingConfig !== null &&
    (
      typeof input.mappingConfig !== 'object' ||
      Array.isArray(input.mappingConfig)
    )
  ) {
    throw new Error('mappingConfig must be an object or null')
  }

  if (input.mappingConfig !== undefined) {
    await prisma.supplierPriceImport.update({
      where: { id: importId },
      data: {
        mappingConfigJson: input.mappingConfig === null
          ? Prisma.JsonNull
          : input.mappingConfig as Prisma.InputJsonValue,
      },
    })
  }

  if (input.rows !== undefined && !Array.isArray(input.rows)) {
    throw new Error('rows must be an array')
  }

  const rowPatches = Array.isArray(input.rows) ? input.rows : []

  for (const rawPatch of rowPatches) {
    if (!rawPatch || typeof rawPatch !== 'object' || Array.isArray(rawPatch)) {
      throw new Error('row patch must be an object')
    }

    const patch = rawPatch as Record<string, unknown>
    const rowId = typeof patch.rowId === 'string' && patch.rowId.trim()
      ? patch.rowId.trim()
      : ''

    if (!rowId) {
      throw new Error('rowId is required')
    }

    const row = await prisma.supplierPriceImportRow.findFirst({
      where: { id: rowId, importId },
    })

    if (!row) {
      throw new Error(`Price import row not found: ${rowId}`)
    }

    const updateData: Prisma.SupplierPriceImportRowUpdateInput = {}
    let normalizedPayload: unknown = row.normalizedPayload
    const resolvedIssueFields = new Set<string>()
    const resolvedIssueTypes = new Set<string>()

    const rawCategory = parseNullableString(patch.rawCategory)
    const nextRawCategory = rawCategory === undefined ? row.rawCategory : rawCategory
    if (rawCategory !== undefined) {
      updateData.rawCategory = rawCategory
    }

    const categoryId = parseNullableString(patch.categoryId)
    if (typeof categoryId === 'string') {
      const manualCategory = await resolveManualCategoryMapping({
        importId,
        supplierId: priceImport.supplierId,
        rowId,
        rawCategory: nextRawCategory,
        categoryId,
        normalizedPayload: normalizedPayload as Prisma.JsonValue | null,
      })
      normalizedPayload = manualCategory.normalizedPayload
      resolvedIssueFields.add('category')
      CATEGORY_REVIEW_ISSUES.forEach((issue) => resolvedIssueTypes.add(issue))

      if (patch.applyToSimilarRows === true) {
        await applyCategoryToSimilarRows({
          importId,
          exceptRowId: rowId,
          rawCategory: nextRawCategory,
          category: manualCategory.category,
        })
      }
    }

    const normalizedPayloadPatch = parsePayloadPatch(patch.normalizedPayloadPatch)
    if (normalizedPayloadPatch) {
      normalizedPayload = mergeJsonObjects(
        jsonObject(normalizedPayload as Prisma.JsonValue | null | undefined),
        normalizedPayloadPatch,
      ) as Prisma.InputJsonValue
      const resolvedHints = collectResolvedIssueHintsFromPatch(normalizedPayloadPatch)
      resolvedHints.fields.forEach((field) => resolvedIssueFields.add(field))
      resolvedHints.issueTypes.forEach((issue) => resolvedIssueTypes.add(issue))
      updateData.adminCorrectionPayload = mergeJsonObjects(
        jsonObject(row.adminCorrectionPayload as Prisma.JsonValue | null | undefined),
        normalizedPayloadPatch,
      ) as Prisma.InputJsonValue
    }
    const adminCorrectionPayload = parsePayloadPatch(patch.adminCorrectionPayload)
    if (adminCorrectionPayload) {
      updateData.adminCorrectionPayload = mergeJsonObjects(
        jsonObject(row.adminCorrectionPayload as Prisma.JsonValue | null | undefined),
        adminCorrectionPayload,
      ) as Prisma.InputJsonValue
    }
    if (normalizedPayload !== row.normalizedPayload) {
      updateData.normalizedPayload = normalizedPayload as Prisma.InputJsonValue
    }

    const mappedProductId = parseNullableString(patch.mappedProductId)
    if (mappedProductId !== undefined) {
      if (mappedProductId) {
        const product = await prisma.product.findUnique({
          where: { id: mappedProductId },
          select: { id: true },
        })
        if (!product) throw new Error('Mapped product not found')
      }
      updateData.mappedProduct = mappedProductId
        ? { connect: { id: mappedProductId } }
        : { disconnect: true }
      resolvedIssueFields.add('product')
    }

    const mappedProductVariantId = parseNullableString(patch.mappedProductVariantId)
    if (mappedProductVariantId !== undefined) {
      if (mappedProductVariantId) {
        const variant = await prisma.productVariant.findUnique({
          where: { id: mappedProductVariantId },
          select: { id: true },
        })
        if (!variant) throw new Error('Mapped product variant not found')
      }
      updateData.mappedProductVariant = mappedProductVariantId
        ? { connect: { id: mappedProductVariantId } }
        : { disconnect: true }
      resolvedIssueFields.add('variant')
      VARIANT_REVIEW_ISSUES.forEach((issue) => resolvedIssueTypes.add(issue))
    }

    const mappedSupplierProductId = parseNullableString(patch.mappedSupplierProductId)
    if (mappedSupplierProductId !== undefined) {
      if (mappedSupplierProductId) {
        const supplierProduct = await prisma.supplierProduct.findFirst({
          where: {
            id: mappedSupplierProductId,
            supplierId: priceImport.supplierId,
          },
          select: { id: true },
        })
        if (!supplierProduct) throw new Error('Mapped supplier product not found')
      }
      updateData.mappedSupplierProduct = mappedSupplierProductId
        ? { connect: { id: mappedSupplierProductId } }
        : { disconnect: true }
      resolvedIssueFields.add('product')
    }

    const mappedOfferId = parseNullableString(patch.mappedOfferId)
    if (mappedOfferId !== undefined) {
      if (mappedOfferId) {
        const offer = await prisma.offer.findFirst({
          where: {
            id: mappedOfferId,
            supplierProduct: {
              supplierId: priceImport.supplierId,
            },
          },
          select: { id: true },
        })
        if (!offer) throw new Error('Mapped offer not found')
      }
      updateData.mappedOffer = mappedOfferId
        ? { connect: { id: mappedOfferId } }
        : { disconnect: true }
      resolvedIssueFields.add('offer')
    }

    const requestedStatus = parseManualMappingStatus(patch.mappingStatus)
    const requestedValidationStatus = parseValidationStatus(patch.validationStatus)
    const mappingConfidence = parseNullableNumber(patch.mappingConfidence)
    const ignore = patch.ignore === true
    const approve = patch.approve === true

    if (ignore) {
      updateData.mappingStatus = PriceImportRowMappingStatus.IGNORED
      updateData.validationStatus = CatalogImportRowValidationStatus.IGNORED
      updateData.approvedAt = null
      updateData.mappingConfidence = null
      updateData.errorText = null
      await prisma.supplierPriceImportIssue.updateMany({
        where: {
          importId,
          rowId,
          status: PriceImportIssueStatus.OPEN,
        },
        data: {
          status: PriceImportIssueStatus.RESOLVED,
          resolvedAt: new Date(),
          resolutionJson: {
            source: 'MANUAL_IGNORE_ROW',
          } as Prisma.InputJsonValue,
        },
      })
    } else if (requestedStatus) {
      updateData.mappingStatus = requestedStatus
    } else if (
      mappedProductId !== undefined ||
      mappedProductVariantId !== undefined ||
      mappedSupplierProductId !== undefined
    ) {
      updateData.mappingStatus = PriceImportRowMappingStatus.MANUAL_MATCHED
    }

    if (!ignore && requestedValidationStatus) {
      updateData.validationStatus = requestedValidationStatus
      updateData.approvedAt =
        requestedValidationStatus === CatalogImportRowValidationStatus.APPROVED ||
        requestedValidationStatus === CatalogImportRowValidationStatus.READY_TO_PUBLISH
          ? new Date()
          : null
    }

    if (!ignore && approve) {
      updateData.validationStatus = CatalogImportRowValidationStatus.APPROVED
      updateData.approvedAt = new Date()
    }

    const shouldConfirmNameTranslation = !ignore && (
      Boolean(normalizedPayloadPatch) ||
      approve ||
      requestedValidationStatus === CatalogImportRowValidationStatus.APPROVED ||
      requestedValidationStatus === CatalogImportRowValidationStatus.READY_TO_PUBLISH
    )
    if (shouldConfirmNameTranslation) {
      const translationPayload = jsonObject(normalizedPayload as Prisma.JsonValue | null | undefined)
      const resolvedNames = resolvePriceImportProductNames(translationPayload)
      const ruName = resolvedNames.russianName
      const enName = resolvedNames.canonicalName

      if (!resolvedNames.isRussianProduced && ruName && enName) {
        await upsertProductNameTranslation({
          ruName,
          enName,
          source: NameTranslationSource.MODERATOR,
          confidence: 1,
          confirmedAt: new Date(),
        })

        const productPayload = payloadNestedObject(translationPayload, 'product')
        const nameParts = payloadNestedObject(productPayload, 'nameParts')
        normalizedPayload = mergeJsonObjects(translationPayload, {
          product: {
            name: enName,
            canonicalName: enName,
            russianName: ruName,
            displayName: ruName,
            translatedName: ruName,
            nameParts: {
              ...nameParts,
              ruName,
              enName,
              enSource: 'TRANSLATION_MEMORY',
              enConfidence: 1,
            },
          },
        }) as Prisma.InputJsonValue
        updateData.normalizedPayload = normalizedPayload as Prisma.InputJsonValue
        resolvedIssueFields.add('name')
      } else if (resolvedNames.isRussianProduced && enName) {
        const productPayload = payloadNestedObject(translationPayload, 'product')
        const nameParts = payloadNestedObject(productPayload, 'nameParts')
        normalizedPayload = mergeJsonObjects(translationPayload, {
          product: {
            name: enName,
            canonicalName: enName,
            russianName: null,
            displayName: null,
            translatedName: null,
            nameParts: {
              ...nameParts,
              ruName: enName,
              enName: null,
              enSource: null,
              enConfidence: null,
            },
          },
        }) as Prisma.InputJsonValue
        updateData.normalizedPayload = normalizedPayload as Prisma.InputJsonValue
        resolvedIssueFields.add('name')
      }
    }

    if (!ignore) {
      const payloadWithoutResolvedIssues = removeResolvedMappingIssues(
        normalizedPayload as Prisma.JsonValue | null | undefined,
        resolvedIssueTypes,
      )
      if (payloadWithoutResolvedIssues !== normalizedPayload) {
        normalizedPayload = payloadWithoutResolvedIssues
        updateData.normalizedPayload = payloadWithoutResolvedIssues as Prisma.InputJsonValue
      }
    }

    if (mappingConfidence !== undefined) {
      updateData.mappingConfidence = mappingConfidence === null
        ? null
        : new Prisma.Decimal(Math.max(0, Math.min(1, mappingConfidence)).toFixed(2))
    } else if (
      mappedProductId !== undefined ||
      mappedProductVariantId !== undefined ||
      mappedSupplierProductId !== undefined
    ) {
      updateData.mappingConfidence = new Prisma.Decimal('1.00')
    }

    if (
      mappedProductId !== undefined ||
      mappedProductVariantId !== undefined ||
      mappedSupplierProductId !== undefined
    ) {
      await prisma.supplierPriceImportIssue.updateMany({
        where: {
          importId,
          rowId,
          status: PriceImportIssueStatus.OPEN,
          OR: [
            { fieldName: 'product' },
            { message: 'Товар не удалось определить' },
            { message: 'Product could not be resolved' },
            { message: { startsWith: 'Возможное совпадение товара' } },
            { message: { startsWith: 'Possible product match' } },
          ],
        },
        data: {
          status: PriceImportIssueStatus.RESOLVED,
          resolvedAt: new Date(),
          resolutionJson: {
            source: 'MANUAL_PRODUCT_MAPPING',
          } as Prisma.InputJsonValue,
        },
      })
    }

    if (!ignore) {
      await resolveOpenRowIssues({
        importId,
        rowId,
        fields: resolvedIssueFields,
        issueTypes: resolvedIssueTypes,
        source: 'MANUAL_ROW_CORRECTION',
      })
    }

    if (Object.keys(updateData).length) {
      await prisma.supplierPriceImportRow.update({
        where: { id: rowId },
        data: updateData,
      })
    }
  }

  await syncCatalogReviewState(importId)

  return prisma.supplierPriceImport.findUniqueOrThrow({
    where: { id: importId },
    include: { fileAsset: true },
  })
}

export async function reprocessSupplierPriceImport(
  importId: string,
  input?: {
    mappingConfig?: unknown
    profileId?: unknown
  },
) {
  const priceImport = await prisma.supplierPriceImport.findUnique({
    where: { id: importId },
    select: {
      id: true,
      status: true,
      supplierId: true,
    },
  })

  if (!priceImport) {
    throw new Error('Price import not found')
  }

  assertImportCanChangePreview(priceImport.status)

  const updateData: Prisma.SupplierPriceImportUpdateInput = {}
  let profileOverride: Record<string, unknown> | null | undefined

  if (input?.mappingConfig !== undefined) {
    if (
      input.mappingConfig !== null &&
      (
        typeof input.mappingConfig !== 'object' ||
        Array.isArray(input.mappingConfig)
      )
    ) {
      throw new Error('mappingConfig must be an object or null')
    }

    updateData.mappingConfigJson = input.mappingConfig === null
      ? Prisma.JsonNull
      : input.mappingConfig as Prisma.InputJsonValue
    profileOverride = input.mappingConfig &&
      typeof input.mappingConfig === 'object' &&
      !Array.isArray(input.mappingConfig)
      ? input.mappingConfig as Record<string, unknown>
      : null
  }

  if (input?.profileId !== undefined) {
    const profileId = typeof input.profileId === 'string' && input.profileId.trim()
      ? input.profileId.trim()
      : null

    if (profileId) {
      const profile = await prisma.supplierImportProfile.findFirst({
        where: {
          id: profileId,
          isActive: true,
          OR: [{ supplierId: null }, { supplierId: priceImport.supplierId }],
        },
        select: {
          id: true,
          code: true,
          name: true,
          version: true,
          sourceFormat: true,
          rulesJson: true,
        },
      })

      if (!profile) {
        throw new Error('Import profile was not found or is not available for supplier')
      }

      updateData.profile = { connect: { id: profile.id } }
      updateData.profileSnapshotJson = {
        id: profile.id,
        code: profile.code,
        name: profile.name,
        version: profile.version,
        sourceFormat: profile.sourceFormat,
        rulesJson: profile.rulesJson,
      } as Prisma.InputJsonValue
    } else {
      updateData.profile = { disconnect: true }
      updateData.profileSnapshotJson = Prisma.JsonNull
    }
  }

  if (Object.keys(updateData).length) {
    await prisma.supplierPriceImport.update({
      where: { id: importId },
      data: updateData,
    })
  }

  return processSupplierPriceImport(importId, { profileOverride })
}

export async function publishSupplierPriceImport(importId: string) {
  const priceImport = await prisma.supplierPriceImport.findUnique({
    where: { id: importId },
    include: {
      fileAsset: true,
      rows: {
        orderBy: [{ sheetName: 'asc' }, { rowIndex: 'asc' }, { createdAt: 'asc' }],
      },
    },
  })

  if (!priceImport) {
    throw new Error('Price import not found')
  }

  if (priceImport.rows.length === 0) {
    throw new Error('Price import has no parsed rows. Run reprocess before publish.')
  }

  const summary = {
    createdProducts: 0,
    updatedProducts: 0,
    createdVariants: 0,
    createdSupplierProducts: 0,
    createdOffers: 0,
    updatedOffers: 0,
    skippedRows: 0,
    productMasterRows: 0,
    stockOnlyRows: 0,
    unresolvedRows: 0,
    categoryIssues: 0,
    imageMatches: 0,
  }
  const publishedOfferIds: string[] = []
  const publishableStatuses = new Set<CatalogImportRowValidationStatus>([
    CatalogImportRowValidationStatus.APPROVED,
    CatalogImportRowValidationStatus.NEEDS_REVIEW,
    CatalogImportRowValidationStatus.READY_TO_PUBLISH,
    CatalogImportRowValidationStatus.VALIDATED,
  ])
  const publishBatch = await prisma.catalogPublishBatch.create({
    data: {
      importId,
      supplierId: priceImport.supplierId,
      status: CatalogPublishBatchStatus.RUNNING,
      startedAt: new Date(),
    },
    select: { id: true },
  })

  try {
  for (const row of priceImport.rows) {
    const payload = jsonObject(row.normalizedPayload)
    const offerPayload = payloadNestedObject(payload, 'offer')
    const price = payloadNestedNumber(offerPayload, payload, 'price')
    const isNormalizedAdminRow = isNormalizedAdminPayload(payload)
    const rowType = getPublishRowType(row)
    const isProductMasterRow =
      priceImport.importKind === SupplierPriceImportKind.PRODUCT_MASTER ||
      rowType === 'PRODUCT_MASTER'
    const isStockOnlyRow =
      priceImport.importKind === SupplierPriceImportKind.STOCK_ONLY ||
      rowType === 'STOCK_ONLY'

    if (
      row.mappingStatus === PriceImportRowMappingStatus.FAILED ||
      row.mappingStatus === PriceImportRowMappingStatus.IGNORED ||
      (!isProductMasterRow && !publishableStatuses.has(row.validationStatus))
    ) {
      summary.skippedRows += 1
      continue
    }

    const blockingIssues = await prisma.catalogValidationIssue.count({
      where: {
        importId,
        rawRowId: row.id,
        status: PriceImportIssueStatus.OPEN,
        severity: { in: [PriceImportIssueSeverity.ERROR, PriceImportIssueSeverity.CRITICAL] },
      },
    })
    if (blockingIssues > 0) {
      summary.skippedRows += 1
      summary.unresolvedRows += 1
      continue
    }

    if (isStockOnlyRow) {
      summary.stockOnlyRows += 1
    }

    if (price === null && !isProductMasterRow) {
      summary.skippedRows += 1
      summary.unresolvedRows += 1
      await createPriceImportIssueOnce({
        importId,
        rowId: row.id,
        supplierId: priceImport.supplierId,
        type: 'OFFER_PUBLISH',
        fieldName: 'price',
        message: 'Предложение не опубликовано: не указана цена',
      })
      continue
    }

    const productResult = await resolveOrCreateProduct({
      row: {
        rawName: row.rawName,
        normalizedName: row.normalizedName,
        rawCategory: row.rawCategory,
        sourceBarcode: row.sourceBarcode,
        sourceArticle: row.sourceArticle,
        sourceSku: row.sourceSku,
        normalizedPayload: row.normalizedPayload,
      },
      mappedProductId: row.mappedProductId,
      supplierId: priceImport.supplierId,
    })

    if (!productResult.productId) {
      summary.skippedRows += 1
      summary.unresolvedRows += 1
      await createPriceImportIssueOnce({
        importId,
        rowId: row.id,
        supplierId: priceImport.supplierId,
        type: 'OFFER_PUBLISH',
        fieldName: 'product',
        message: 'Предложение не опубликовано: товар не удалось определить или создать',
      })
      continue
    }

    if (productResult.created) summary.createdProducts += 1
    if (productResult.updated) summary.updatedProducts += 1

    const variantResult = await resolveOrCreateVariant(productResult.productId, payload)
    if (variantResult.created) summary.createdVariants += 1

    const supplierProductResult = await resolveOrCreateSupplierProduct({
      supplierId: priceImport.supplierId,
      productId: productResult.productId,
      productVariantId: variantResult.variantId,
      supplierSku: isNormalizedAdminRow ? null : row.sourceSku,
      supplierNameAlias: row.rawName,
      sourceImportId: importId,
      sourceImportRowId: row.id,
    })
    if (supplierProductResult.created) {
      summary.createdSupplierProducts += 1
    }

    if (!isNormalizedAdminRow) {
      await Promise.all([
        upsertSupplierProductAlias({
          supplierId: priceImport.supplierId,
          supplierProductId: supplierProductResult.supplierProductId,
          aliasType: SupplierProductAliasType.SUPPLIER_SKU,
          rawValue: row.sourceSku,
          sourceImportId: importId,
          sourceImportRowId: row.id,
          confidence: row.mappingConfidence ? Number(row.mappingConfidence) : null,
        }),
        upsertSupplierProductAlias({
          supplierId: priceImport.supplierId,
          supplierProductId: supplierProductResult.supplierProductId,
          aliasType: SupplierProductAliasType.SUPPLIER_ARTICLE,
          rawValue: row.sourceArticle,
          sourceImportId: importId,
          sourceImportRowId: row.id,
          confidence: row.mappingConfidence ? Number(row.mappingConfidence) : null,
        }),
        upsertSupplierProductAlias({
          supplierId: priceImport.supplierId,
          supplierProductId: supplierProductResult.supplierProductId,
          aliasType: SupplierProductAliasType.BARCODE,
          rawValue: row.sourceBarcode,
          sourceImportId: importId,
          sourceImportRowId: row.id,
          confidence: row.mappingConfidence ? Number(row.mappingConfidence) : null,
        }),
      ])
    }

    if (isProductMasterRow) {
      summary.productMasterRows += 1
      await prisma.supplierPriceImportRow.update({
        where: { id: row.id },
        data: {
          mappedProductId: productResult.productId,
          mappedProductVariantId: variantResult.variantId,
          mappedSupplierProductId: supplierProductResult.supplierProductId,
          mappingStatus: PriceImportRowMappingStatus.MATCHED,
          validationStatus: CatalogImportRowValidationStatus.PUBLISHED,
          publishedAt: new Date(),
        },
      })
      await prisma.catalogNormalizedRow.updateMany({
        where: { importId, rawRowId: row.id },
        data: {
          matchedProductId: productResult.productId,
          matchedProductVariantId: variantResult.variantId,
          matchedSupplierProductId: supplierProductResult.supplierProductId,
          status: CatalogImportRowValidationStatus.PUBLISHED,
          publishedAt: new Date(),
        },
      })
      continue
    }

    if (price === null) {
      summary.skippedRows += 1
      summary.unresolvedRows += 1
      continue
    }

    const stockAvailable = payloadNestedNumber(offerPayload, payload, 'stockAvailable')
    const deliveryDaysMin = payloadNestedNumber(offerPayload, payload, 'deliveryDaysMin')
    const deliveryDaysMax = payloadNestedNumber(offerPayload, payload, 'deliveryDaysMax')
    const minOrderQty = payloadNestedNumber(offerPayload, payload, 'minOrderQty') ?? 1
    const packQty = payloadNestedNumber(offerPayload, payload, 'packQty')
    const currency = payloadNestedString(offerPayload, payload, 'currency') || 'RUB'
    const unit = payloadNestedString(offerPayload, payload, 'unit') || 'pcs'
    const hasKnownStock = stockAvailable !== null
    const isAvailable = stockAvailable === null || stockAvailable > 0
    const availabilityLevel = !isAvailable
      ? OfferAvailabilityLevel.OUT_OF_STOCK
      : stockAvailable !== null && stockAvailable <= 5
        ? OfferAvailabilityLevel.LOW_STOCK
        : OfferAvailabilityLevel.IN_STOCK
    const catalogAvailability = !isAvailable
      ? 'SOLD_OUT'
      : hasKnownStock
        ? 'ACTIVE'
        : 'ORDERABLE'

    const offerData = {
      supplierProductId: supplierProductResult.supplierProductId,
      sourceImportId: importId,
      sourceImportRowId: row.id,
      price: new Prisma.Decimal(price.toFixed(2)),
      effectivePrice: new Prisma.Decimal(price.toFixed(2)),
      currency,
      unit,
      minOrderQty: decimalOrNull(minOrderQty, 3),
      packQty: decimalOrNull(packQty, 3),
      stockTotal: decimalOrNull(stockAvailable, 3),
      stockAvailable: decimalOrNull(stockAvailable, 3),
      stockPayload: {
        stockKnown: hasKnownStock,
        sourceAvailability: payloadNestedString(offerPayload, payload, 'availability'),
        catalogAvailability,
      } as Prisma.InputJsonValue,
      deliveryDaysMin: deliveryDaysMin !== null ? Math.round(deliveryDaysMin) : null,
      deliveryDaysMax: deliveryDaysMax !== null ? Math.round(deliveryDaysMax) : null,
      deliveryTerm: getDeliveryTerm(
        deliveryDaysMin !== null ? Math.round(deliveryDaysMin) : null,
        deliveryDaysMax !== null ? Math.round(deliveryDaysMax) : null,
      ),
      availabilityLevel,
      isAvailable,
      isCurrent: true,
      missingFromLatestPrice: false,
      rawPayload: row.rawPayload as Prisma.InputJsonValue,
    }

    const existingOffer = row.mappedOfferId
      ? await prisma.offer.findUnique({ where: { id: row.mappedOfferId }, select: { id: true } })
      : await prisma.offer.findFirst({
          where: {
            supplierProductId: supplierProductResult.supplierProductId,
            sourceImportId: importId,
            sourceImportRowId: row.id,
          },
          select: { id: true },
        }) ?? await prisma.offer.findFirst({
          where: {
            supplierProductId: supplierProductResult.supplierProductId,
            isCurrent: true,
          },
          orderBy: { updatedAt: 'desc' },
          select: { id: true },
        })

    const offer = existingOffer
      ? await prisma.offer.update({
          where: { id: existingOffer.id },
          data: offerData,
          select: { id: true },
        })
      : await prisma.offer.create({
          data: offerData,
          select: { id: true },
        })

    if (existingOffer) {
      summary.updatedOffers += 1
    } else {
      summary.createdOffers += 1
    }
    publishedOfferIds.push(offer.id)

    await prisma.supplierPriceImportRow.update({
      where: { id: row.id },
      data: {
        mappedProductId: productResult.productId,
        mappedProductVariantId: variantResult.variantId,
        mappedSupplierProductId: supplierProductResult.supplierProductId,
        mappedOfferId: offer.id,
        mappingStatus: PriceImportRowMappingStatus.MATCHED,
        validationStatus: CatalogImportRowValidationStatus.PUBLISHED,
        publishedAt: new Date(),
      },
    })
    await prisma.catalogNormalizedRow.updateMany({
      where: { importId, rawRowId: row.id },
      data: {
        matchedProductId: productResult.productId,
        matchedProductVariantId: variantResult.variantId,
        matchedSupplierProductId: supplierProductResult.supplierProductId,
        status: CatalogImportRowValidationStatus.PUBLISHED,
        publishedAt: new Date(),
      },
    })

    const productAfterPublish = await prisma.product.findUnique({
      where: { id: productResult.productId },
      select: { categoryId: true },
    })

    await prisma.supplierPriceImportIssue.deleteMany({
      where: {
        importId,
        rowId: row.id,
        type: 'ROW_PARSE',
        OR: [
          { message: 'Товар не удалось определить' },
          { message: 'Product could not be resolved' },
          { message: { startsWith: 'Возможное совпадение товара' } },
          { message: { startsWith: 'Possible product match' } },
          ...(productAfterPublish?.categoryId
            ? [{ message: 'Категория каталога не определена' }, { message: 'Catalog category could not be resolved' }]
            : []),
        ],
      },
    })
  }
  } catch (error) {
    await prisma.catalogPublishBatch.update({
      where: { id: publishBatch.id },
      data: {
        status: CatalogPublishBatchStatus.FAILED,
        errorText: error instanceof Error ? error.message : 'Unknown publish error',
        completedAt: new Date(),
      },
    })
    throw error
  }

  if (publishedOfferIds.length > 0) {
    await prisma.offer.updateMany({
      where: {
        id: { notIn: publishedOfferIds },
        supplierProduct: {
          supplierId: priceImport.supplierId,
        },
        isCurrent: true,
        missingFromLatestPrice: false,
      },
      data: {
        missingFromLatestPrice: true,
      },
    })
  }

  const imageMatches = await prisma.supplierImportImageMatch.count({
    where: { importId },
  })
  const totalIssues = await prisma.supplierPriceImportIssue.count({
    where: {
      importId,
      status: PriceImportIssueStatus.OPEN,
    },
  })
  const catalogIssues = await prisma.catalogValidationIssue.count({
    where: {
      importId,
      status: PriceImportIssueStatus.OPEN,
    },
  })
  const categoryIssues = await prisma.supplierPriceImportIssue.count({
    where: {
      importId,
      status: PriceImportIssueStatus.OPEN,
      OR: [
        { fieldName: 'category' },
        { message: 'Категория каталога не определена' },
        { message: 'Catalog category could not be resolved' },
      ],
    },
  })
  summary.imageMatches = imageMatches
  summary.categoryIssues = categoryIssues + await prisma.catalogValidationIssue.count({
    where: {
      importId,
      status: PriceImportIssueStatus.OPEN,
      fieldName: 'category',
    },
  })

  const publishedRows = await prisma.supplierPriceImportRow.count({
    where: {
      importId,
      validationStatus: CatalogImportRowValidationStatus.PUBLISHED,
    },
  })
  const skippedRows = priceImport.rows.length - publishedRows
  const nextStatus = publishedRows > 0 && skippedRows > 0
    ? PriceImportStatus.PARTIALLY_PUBLISHED
    : PriceImportStatus.PUBLISHED

  await prisma.catalogPublishBatch.update({
    where: { id: publishBatch.id },
    data: {
      status: nextStatus === PriceImportStatus.PARTIALLY_PUBLISHED
        ? CatalogPublishBatchStatus.PARTIALLY_PUBLISHED
        : CatalogPublishBatchStatus.PUBLISHED,
      summaryJson: summary as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
  })

  const publishedImport = await prisma.supplierPriceImport.update({
    where: { id: importId },
    data: {
      status: nextStatus,
      publishedAt: new Date(),
      processedRows: priceImport.rows.length,
      matchedRows: publishedRows,
      failedRows: skippedRows,
      issuesCount: totalIssues + catalogIssues,
      summaryJson: summary as Prisma.InputJsonValue,
    },
    include: { fileAsset: true },
  })

  return {
    import: publishedImport,
    summary,
  }
}

export async function unpublishSupplierPriceImport(importId: string) {
  const priceImport = await prisma.supplierPriceImport.findUnique({
    where: { id: importId },
    include: {
      fileAsset: true,
      rows: {
        select: {
          id: true,
          mappingStatus: true,
          validationStatus: true,
        },
      },
    },
  })

  if (!priceImport) {
    throw new Error('Price import not found')
  }

  if (
    priceImport.status !== PriceImportStatus.PUBLISHED &&
    priceImport.status !== PriceImportStatus.PARTIALLY_PUBLISHED
  ) {
    throw new Error('Price import is not published')
  }

  const [openIssuesCount, openCatalogIssuesCount] = await prisma.$transaction([
    prisma.supplierPriceImportIssue.count({
      where: {
        importId,
        status: PriceImportIssueStatus.OPEN,
      },
    }),
    prisma.catalogValidationIssue.count({
      where: {
        importId,
        status: PriceImportIssueStatus.OPEN,
      },
    }),
  ])
  const failedRows = priceImport.rows.filter((row) =>
    row.mappingStatus === PriceImportRowMappingStatus.FAILED ||
    row.mappingStatus === PriceImportRowMappingStatus.UNMATCHED,
  ).length
  const publishedRows = priceImport.rows.filter(
    (row) => row.validationStatus === CatalogImportRowValidationStatus.PUBLISHED,
  ).length
  const nextStatus = openIssuesCount > 0 || openCatalogIssuesCount > 0 || failedRows > 0
    ? PriceImportStatus.HAS_ISSUES
    : PriceImportStatus.READY_TO_PUBLISH

  const summary = {
    unpublishedOffers: 0,
    resetRows: publishedRows,
  }

  const unpublishedImport = await prisma.$transaction(async (tx) => {
    const offers = await tx.offer.updateMany({
      where: { sourceImportId: importId },
      data: {
        isCurrent: false,
        isAvailable: false,
        missingFromLatestPrice: true,
        availabilityLevel: OfferAvailabilityLevel.OUT_OF_STOCK,
      },
    })
    summary.unpublishedOffers = offers.count

    await tx.supplierPriceImportRow.updateMany({
      where: {
        importId,
        validationStatus: CatalogImportRowValidationStatus.PUBLISHED,
      },
      data: {
        validationStatus: CatalogImportRowValidationStatus.READY_TO_PUBLISH,
        publishedAt: null,
      },
    })

    await tx.catalogNormalizedRow.updateMany({
      where: {
        importId,
        status: CatalogImportRowValidationStatus.PUBLISHED,
      },
      data: {
        status: CatalogImportRowValidationStatus.READY_TO_PUBLISH,
        publishedAt: null,
      },
    })

    await tx.catalogPublishBatch.create({
      data: {
        importId,
        supplierId: priceImport.supplierId,
        status: CatalogPublishBatchStatus.CANCELLED,
        summaryJson: summary as Prisma.InputJsonValue,
        startedAt: new Date(),
        completedAt: new Date(),
      },
    })

    return tx.supplierPriceImport.update({
      where: { id: importId },
      data: {
        status: nextStatus,
        publishedAt: null,
        failedRows,
        issuesCount: openIssuesCount + openCatalogIssuesCount,
        summaryJson: summary as Prisma.InputJsonValue,
      },
      include: { fileAsset: true },
    })
  })

  return {
    import: unpublishedImport,
    summary,
  }
}

export async function createSupplierImportProfile(input: {
  supplierId?: unknown
  code: unknown
  name: unknown
  sourceFormat?: unknown
  rulesJson: unknown
}) {
  const supplierId = parseNullableString(input.supplierId) || null
  const code = typeof input.code === 'string' ? input.code.trim() : ''
  const name = typeof input.name === 'string' ? input.name.trim() : ''

  if (!code) {
    throw new Error('code is required')
  }
  if (!name) {
    throw new Error('name is required')
  }
  if (!input.rulesJson || typeof input.rulesJson !== 'object' || Array.isArray(input.rulesJson)) {
    throw new Error('rulesJson must be an object')
  }

  const sourceFormat =
    typeof input.sourceFormat === 'string' &&
    Object.values(PriceImportSourceFormat).includes(input.sourceFormat as PriceImportSourceFormat)
      ? (input.sourceFormat as PriceImportSourceFormat)
      : PriceImportSourceFormat.XLSX

  const existing = await prisma.supplierImportProfile.findFirst({
    where: { supplierId, code },
    orderBy: { version: 'desc' },
  })

  return prisma.supplierImportProfile.create({
    data: {
      supplierId,
      code,
      name,
      version: existing ? existing.version + 1 : 1,
      sourceFormat,
      rulesJson: input.rulesJson as Prisma.InputJsonValue,
    },
  })
}

export async function listSupplierImportProfiles(supplierId?: string | null) {
  return prisma.supplierImportProfile.findMany({
    where: supplierId ? { OR: [{ supplierId }, { supplierId: null }] } : undefined,
    orderBy: [{ name: 'asc' }, { version: 'desc' }],
  })
}
