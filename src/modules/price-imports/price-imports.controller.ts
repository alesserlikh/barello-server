import { Router, type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import jwt from 'jsonwebtoken'
import {
  FileAssetType,
  MembershipStatus,
  Prisma,
  PriceImportIssueSeverity,
  PriceImportIssueStatus,
  PriceImportRowMappingStatus,
  PriceImportSourceFormat,
  PriceImportStatus,
  SupplierImportImageMatchStatus,
  SupplierPriceImportKind,
} from '../../generated/prisma'
import {
  buildOffsetLimitPaginationMeta,
  type ApiFieldErrors,
  parseOffsetLimitPagination,
} from '../../lib/api-contract'
import { apiError } from '../../lib/api-error'
import { prisma } from '../../lib/prisma'
import { env } from '../../config/env'
import { resolveAuth, type AuthPayload } from '../../middleware/auth'
import { parseFacetSelectionFromQuery, FacetQueryError } from '../catalog-filters/facet-shared'
import {
  buildPriceImportRowWhere,
  getPriceImportFacets,
} from '../catalog-filters/scope-adapters/price-import-facets'
import { getProfilePermissionsForAuth } from '../profile/profile-permissions.service'
import { resolveCatalogCategoryMatch } from './category-mappings.service'
import {
  importPriceFile,
  parsePriceExcel,
  processSupplierPriceImport,
  createProductFromImportRow,
  createSupplierImportProfile,
  listSupplierImportProfiles,
  publishSupplierPriceImport,
  reprocessSupplierPriceImport,
  unpublishSupplierPriceImport,
  updateSupplierPriceImportMapping,
} from './price-imports.service'
import {
  normalizeUploadDisplayFileName,
  normalizeUploadSafeBaseName,
} from './upload-file-name'
import { resolvePriceImportProductNames } from './price-import-name-resolution'
import type {
  PriceImportIssueSeverityDto,
  PriceImportIssueStatusDto,
  PriceImportRowStatusDto,
  PriceImportStatusDto,
  SupplierImportProfileDto,
  SupplierPriceImportDto,
  SupplierPriceImportIssueDto,
  SupplierPriceImportPreviewRowDto,
} from './price-imports.contract'

const priceImportsRouter = Router()

const uploadsDir = path.resolve(process.cwd(), 'uploads')
const PRICE_IMPORT_MAX_FILE_SIZE_BYTES = 120 * 1024 * 1024
const PRICE_IMPORT_IMAGE_MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024
const PRICE_IMPORT_MAX_IMAGE_FILES = 20
const PRICE_IMPORT_PARSER_VERSION = '2026-07-05.mapping-v1'
const PRICE_IMPORT_ALLOWED_EXTENSIONS = new Set(['.csv', '.xls', '.xlsx', '.xml'])
const PRICE_IMPORT_ALLOWED_IMAGE_EXTENSIONS = new Set([
  '.zip',
  '.rar',
  '.7z',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
])
const PRICE_IMPORT_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}

const upload = multer({
  dest: uploadsDir,
  limits: {
    files: 1 + PRICE_IMPORT_MAX_IMAGE_FILES,
    fileSize: PRICE_IMPORT_IMAGE_MAX_FILE_SIZE_BYTES,
  },
})
const uploadPriceImportFiles = upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'images', maxCount: PRICE_IMPORT_MAX_IMAGE_FILES },
])

type PriceImportModerator = {
  id: string
  email: string
  role: string
}

function getBearerToken(authorizationHeader?: string) {
  if (!authorizationHeader) return null

  const [scheme, token] = authorizationHeader.split(' ')
  if (scheme !== 'Bearer' || !token) return null

  return token
}

function resolveModeratorFromToken(token: string): PriceImportModerator | null {
  const payload = jwt.verify(token, env.jwtSecret) as {
    moderatorId?: string
    role?: string
    email?: string
  }

  if (!payload?.moderatorId || payload.role !== 'PLATFORM_MODERATOR') {
    return null
  }

  const moderator = env.moderators.find((item) => item.id === payload.moderatorId)
  if (!moderator) return null

  return {
    id: moderator.id,
    email: moderator.email,
    role: moderator.role,
  }
}

async function requirePriceImportUploadActor(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const token = getBearerToken(req.headers.authorization)

  if (!token) {
    res.status(401).json(apiError('AUTH_REQUIRED', 'AUTH_REQUIRED'))
    return
  }

  try {
    const moderator = resolveModeratorFromToken(token)
    if (moderator) {
      ;(req as any).priceImportModerator = moderator
      next()
      return
    }
  } catch {
    // Regular user auth below keeps supplier uploads on their existing JWT/session path.
  }

  const auth = await resolveAuth(req)
  if (!auth) {
    res.status(401).json(apiError('AUTH_REQUIRED', 'AUTH_REQUIRED'))
    return
  }

  req.auth = auth
  next()
}

function detectSourceFormat(fileName: string): PriceImportSourceFormat {
  const extension = path.extname(fileName).toLowerCase()

  if (extension === '.csv') return PriceImportSourceFormat.CSV
  if (extension === '.xml') return PriceImportSourceFormat.XML

  return PriceImportSourceFormat.XLSX
}

function getFileExtension(fileName: string) {
  return path.extname(fileName).trim().toLowerCase()
}

function isPriceFileSupported(file: Express.Multer.File) {
  return PRICE_IMPORT_ALLOWED_EXTENSIONS.has(getFileExtension(normalizeUploadDisplayFileName(file.originalname)))
}

function isImagePackageSupported(file: Express.Multer.File) {
  return PRICE_IMPORT_ALLOWED_IMAGE_EXTENSIONS.has(getFileExtension(normalizeUploadDisplayFileName(file.originalname)))
}

function getImageAssetType(file: Express.Multer.File) {
  return PRICE_IMPORT_IMAGE_EXTENSIONS.has(getFileExtension(normalizeUploadDisplayFileName(file.originalname)))
    ? FileAssetType.IMAGE
    : FileAssetType.OTHER
}

function toPublicImportStatus(status: PriceImportStatus): PriceImportStatusDto {
  if (status === PriceImportStatus.PENDING) return 'UPLOADED'
  if (status === PriceImportStatus.PROCESSED) return 'PARSED'

  return status
}

function toPublicRowStatus(status: PriceImportRowMappingStatus): PriceImportRowStatusDto {
  return status
}

function toPublicIssueStatus(status: PriceImportIssueStatus): PriceImportIssueStatusDto {
  return status
}

function toPublicIssueSeverity(severity: PriceImportIssueSeverity): PriceImportIssueSeverityDto {
  return severity
}

function jsonOrNull(value: Prisma.JsonValue | null | undefined) {
  return value === undefined ? null : value
}

function jsonRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function jsonString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function jsonNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function jsonStringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : []
}

function jsonCategorySignals(value: unknown): SupplierPriceImportPreviewRowDto['categorySignals'] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    const signal = jsonRecord(item)
    const source = jsonString(signal.source)
    const pattern = jsonString(signal.pattern)
    const categoryPath = jsonStringList(signal.categoryPath)
    const weight = jsonNumber(signal.weight)

    if (
      (source !== 'CATEGORY_PREFIX' && source !== 'CATEGORY_KEYWORD' && source !== 'GEO_MARKER') ||
      !pattern ||
      !categoryPath.length ||
      weight === null
    ) {
      return []
    }

    return [{
      source,
      pattern,
      categoryPath,
      weight,
      attrs: jsonRecord(signal.attrs),
    }]
  })
}

function payloadString(
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>,
  key: string,
) {
  return jsonString(primary[key]) ?? jsonString(fallback[key])
}

function payloadNumber(
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>,
  key: string,
) {
  return jsonNumber(primary[key]) ?? jsonNumber(fallback[key])
}

type ImportRecord = Prisma.SupplierPriceImportGetPayload<{
  include: { fileAsset: true }
}>

function toSupplierPriceImportDto(importRecord: ImportRecord): SupplierPriceImportDto {
  return {
    id: importRecord.id,
    supplierId: importRecord.supplierId,
    profileId: importRecord.profileId,
    file: importRecord.fileAsset
      ? {
          id: importRecord.fileAsset.id,
          fileName: importRecord.fileAsset.fileName,
          mimeType: importRecord.fileAsset.mimeType,
          fileSize: importRecord.fileAsset.fileSize,
        }
      : null,
    sourceFormat: importRecord.sourceFormat,
    importKind: importRecord.importKind,
    status: toPublicImportStatus(importRecord.status),
    parserVersion: importRecord.parserVersion,
    detectedProfile: jsonOrNull(importRecord.detectedProfileJson) as SupplierPriceImportDto['detectedProfile'],
    mappingConfig: jsonOrNull(importRecord.mappingConfigJson) as SupplierPriceImportDto['mappingConfig'],
    profileSnapshot: jsonOrNull(importRecord.profileSnapshotJson) as SupplierPriceImportDto['profileSnapshot'],
    rowsCount: importRecord.rowsCount,
    parsedRows: importRecord.parsedRows || importRecord.processedRows,
    matchedRows: importRecord.matchedRows,
    failedRows: importRecord.failedRows,
    issuesCount: importRecord.issuesCount,
    criticalIssuesCount: importRecord.criticalIssuesCount,
    errorText: importRecord.errorText,
    uploadedAt: importRecord.createdAt.toISOString(),
    updatedAt: importRecord.updatedAt.toISOString(),
    publishedAt: importRecord.publishedAt?.toISOString() ?? null,
  }
}

function toPreviewRowDto(
  row: Prisma.SupplierPriceImportRowGetPayload<Record<string, never>>,
): SupplierPriceImportPreviewRowDto {
  const normalizedPayload = jsonRecord(row.normalizedPayload)
  const identityPayload = jsonRecord(normalizedPayload.identity)
  const productPayload = jsonRecord(normalizedPayload.product)
  const namePartsPayload = jsonRecord(productPayload.nameParts)
  const variantPayload = jsonRecord(normalizedPayload.variant)
  const offerPayload = jsonRecord(normalizedPayload.offer)
  const mappingPayload = jsonRecord(normalizedPayload.mapping)
  const resolvedNames = resolvePriceImportProductNames(normalizedPayload, {
    rawName: row.rawName,
    normalizedName: row.normalizedName,
  })

  return {
    id: row.id,
    sheetName: row.sheetName,
    rowIndex: row.rowIndex,
    rowType: row.rowType,
    rowHash: row.rowHash,
    status: toPublicRowStatus(row.mappingStatus),
    validationStatus: row.validationStatus as SupplierPriceImportPreviewRowDto['validationStatus'],
    rawName: row.rawName,
    normalizedName: row.normalizedName,
    canonicalName: resolvedNames.canonicalName,
    russianName: resolvedNames.russianName,
    translatedName: resolvedNames.translatedName,
    nameParts: namePartsPayload,
    categoryName: payloadString(productPayload, normalizedPayload, 'categoryRaw') ?? row.rawCategory,
    categoryId: payloadString(productPayload, normalizedPayload, 'categoryId'),
    categorySource: (
      payloadString(productPayload, mappingPayload, 'categorySource') ??
      payloadString(mappingPayload, normalizedPayload, 'categorySource')
    ) as SupplierPriceImportPreviewRowDto['categorySource'],
    categoryConfidence:
      payloadNumber(productPayload, mappingPayload, 'categoryConfidence') ??
      payloadNumber(mappingPayload, normalizedPayload, 'categoryConfidence'),
    categoryReason:
      payloadString(productPayload, mappingPayload, 'categoryReason') ??
      payloadString(mappingPayload, normalizedPayload, 'categoryReason'),
    categorySignals: jsonCategorySignals(namePartsPayload.categorySignals),
    supplierSku: payloadString(identityPayload, normalizedPayload, 'supplierSku') ?? row.sourceSku,
    article: payloadString(identityPayload, normalizedPayload, 'article') ?? row.sourceArticle,
    barcode: payloadString(identityPayload, normalizedPayload, 'barcode') ?? row.sourceBarcode,
    eanList: jsonStringList(identityPayload.eanList),
    brand: payloadString(productPayload, normalizedPayload, 'brand'),
    producer: payloadString(productPayload, normalizedPayload, 'producer'),
    manufacturer: payloadString(productPayload, normalizedPayload, 'manufacturer'),
    country: payloadString(productPayload, normalizedPayload, 'country'),
    region: payloadString(productPayload, normalizedPayload, 'region'),
    color: payloadString(productPayload, normalizedPayload, 'color'),
    sugar: payloadString(productPayload, normalizedPayload, 'sugar'),
    grapeSorts: jsonStringList(productPayload.grapeSorts),
    vintage: payloadNumber(productPayload, normalizedPayload, 'vintage'),
    alcoholPercent: payloadNumber(productPayload, normalizedPayload, 'alcoholPercent'),
    alcoholPercentMax: payloadNumber(productPayload, normalizedPayload, 'alcoholPercentMax'),
    features: jsonStringList(productPayload.features),
    volumeMl:
      payloadNumber(variantPayload, normalizedPayload, 'volumeMl') ??
      payloadNumber(productPayload, normalizedPayload, 'volumeMl'),
    packageSize: payloadNumber(variantPayload, normalizedPayload, 'packageSize'),
    packageSizeUnit: payloadString(variantPayload, normalizedPayload, 'packageSizeUnit'),
    packQty: payloadNumber(variantPayload, normalizedPayload, 'packQty'),
    price: payloadNumber(offerPayload, normalizedPayload, 'price'),
    basePrice: payloadNumber(offerPayload, normalizedPayload, 'basePrice'),
    discountPrice: payloadNumber(offerPayload, normalizedPayload, 'discountPrice'),
    currency: payloadString(offerPayload, normalizedPayload, 'currency'),
    stockAvailable: payloadNumber(offerPayload, normalizedPayload, 'stockAvailable'),
    stockTotal: payloadNumber(offerPayload, normalizedPayload, 'stockTotal'),
    availability: payloadString(offerPayload, normalizedPayload, 'availability'),
    minOrderQty: payloadNumber(offerPayload, normalizedPayload, 'minOrderQty'),
    deliveryDaysMin: payloadNumber(offerPayload, normalizedPayload, 'deliveryDaysMin'),
    deliveryDaysMax: payloadNumber(offerPayload, normalizedPayload, 'deliveryDaysMax'),
    matchedProductId: row.mappedProductId,
    matchedProductVariantId: row.mappedProductVariantId,
    matchedSupplierProductId: row.mappedSupplierProductId,
    matchedOfferId: row.mappedOfferId,
    confidence: row.mappingConfidence ? Number(row.mappingConfidence) : null,
    rawPayload: jsonOrNull(row.rawPayload),
    normalizedPayload: jsonOrNull(row.normalizedPayload) as SupplierPriceImportPreviewRowDto['normalizedPayload'],
    adminCorrectionPayload: jsonOrNull(row.adminCorrectionPayload),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    errorText: row.errorText,
  }
}

function toIssueDto(
  issue: Prisma.SupplierPriceImportIssueGetPayload<Record<string, never>>,
): SupplierPriceImportIssueDto {
  return {
    id: issue.id,
    importId: issue.importId,
    rowId: issue.rowId,
    type: issue.type,
    severity: toPublicIssueSeverity(issue.severity),
    status: toPublicIssueStatus(issue.status),
    fieldName: issue.fieldName,
    message: issue.message,
    supplierValue: jsonOrNull(issue.supplierValue),
    catalogValue: jsonOrNull(issue.catalogValue),
    suggestedAction: issue.suggestedAction,
  }
}

async function loadPriceImportPreviewPayload(params: {
  importId: string
  offset: number
  limit: number
  where?: Prisma.SupplierPriceImportRowWhereInput
}) {
  const importRecord = await prisma.supplierPriceImport.findUnique({
    where: { id: params.importId },
    include: { fileAsset: true },
  })

  if (!importRecord) {
    return null
  }

  const where = params.where ?? { importId: importRecord.id }
  const [total, rows, issues] = await prisma.$transaction([
    prisma.supplierPriceImportRow.count({ where }),
    prisma.supplierPriceImportRow.findMany({
      where,
      orderBy: [{ sheetName: 'asc' }, { rowIndex: 'asc' }, { createdAt: 'asc' }],
      skip: params.offset,
      take: params.limit,
    }),
    prisma.supplierPriceImportIssue.findMany({
      where: {
        importId: importRecord.id,
        status: PriceImportIssueStatus.OPEN,
      },
      orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }],
      take: 100,
    }),
  ])

  return {
    importRecord,
    rows,
    issues,
    total,
  }
}

function getUploadedFile(req: Request) {
  const files = req.files

  if (!files || Array.isArray(files)) {
    return req.file ?? null
  }

  const priceFiles = files.file
  return priceFiles?.[0] ?? null
}

function getUploadedImageFiles(req: Request) {
  const files = req.files

  if (!files || Array.isArray(files)) {
    return []
  }

  return files.images ?? []
}

function getStringBodyField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parseImportKind(value: unknown) {
  const rawValue = getStringBodyField(value)
  if (!rawValue) return SupplierPriceImportKind.PRICE_WITH_OFFERS

  if (!Object.values(SupplierPriceImportKind).includes(rawValue as SupplierPriceImportKind)) {
    throw new Error('INVALID_IMPORT_KIND')
  }

  return rawValue as SupplierPriceImportKind
}

function parseJsonObjectBodyField(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const parsedValue = typeof value === 'string' ? JSON.parse(value) : value

  if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) {
    throw new Error('INVALID_JSON_OBJECT')
  }

  return parsedValue as Prisma.InputJsonValue
}

function sendBadRequest(
  res: Response,
  code: string,
  message: string,
  fieldErrors?: ApiFieldErrors,
) {
  res.status(400).json(apiError(code, message, null, fieldErrors))
}

function sendUploadError(res: Response, error: unknown) {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json(apiError('PRICE_IMPORT_FILE_TOO_LARGE', 'Uploaded file is too large'))
      return
    }

    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      res.status(400).json(apiError('PRICE_IMPORT_UNEXPECTED_FILE', 'Unexpected upload field'))
      return
    }

    res.status(400).json(apiError('PRICE_IMPORT_UPLOAD_REJECTED', error.message))
    return
  }

  const message = error instanceof Error ? error.message : 'Failed to upload files'
  res.status(400).json(apiError('PRICE_IMPORT_UPLOAD_REJECTED', message))
}

function cleanupUploadedFiles(files: Array<Express.Multer.File | null | undefined>) {
  for (const file of files) {
    if (!file?.path) continue
    fs.promises.unlink(file.path).catch(() => undefined)
  }
}

function parsePriceDate(value: unknown) {
  const rawValue = getStringBodyField(value)
  if (!rawValue) return null

  const date = new Date(rawValue)
  if (Number.isNaN(date.getTime())) {
    throw new Error('INVALID_PRICE_DATE')
  }

  return date
}

async function assertSupplierUploadAccess(auth: AuthPayload, supplierId: string) {
  const profile = await getProfilePermissionsForAuth(auth).catch(() => null)

  if (!profile?.permissions.actions.canUploadPrice) {
    return null
  }

  return prisma.supplierMembership.findFirst({
    where: {
      userId: auth.userId,
      supplierId,
      status: MembershipStatus.ACTIVE,
      supplier: { isActive: true },
    },
    select: { supplierId: true },
  })
}

async function assertImportProfileAccess(params: {
  profileId: string | null
  supplierId: string
}) {
  if (!params.profileId) return null

  return prisma.supplierImportProfile.findFirst({
    where: {
      id: params.profileId,
      isActive: true,
      OR: [{ supplierId: null }, { supplierId: params.supplierId }],
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
}

priceImportsRouter.get('/', async (req, res) => {
  try {
    const { offset, limit } = parseOffsetLimitPagination(req.query)
    const supplierId = getStringBodyField(req.query.supplierId)
    const rawStatus = req.query.status
    const statuses = (Array.isArray(rawStatus) ? rawStatus : rawStatus ? String(rawStatus).split(',') : [])
      .map((item) => String(item).trim())
      .filter(Boolean) as PriceImportStatus[]
    const where: Prisma.SupplierPriceImportWhereInput = {
      ...(supplierId ? { supplierId } : {}),
      ...(statuses.length ? { status: { in: statuses } } : {}),
    }

    const [total, items] = await prisma.$transaction([
      prisma.supplierPriceImport.count({ where }),
      prisma.supplierPriceImport.findMany({
        where,
        include: { fileAsset: true },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
    ])

    res.status(200).json({
      ok: true,
      data: { items: items.map(toSupplierPriceImportDto) },
      meta: buildOffsetLimitPaginationMeta({ offset, limit, total }),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list price imports'
    res.status(400).json(apiError('PRICE_IMPORT_LIST_FAILED', message))
  }
})

function toSupplierImportProfileDto(
  profile: Prisma.SupplierImportProfileGetPayload<Record<string, never>>,
): SupplierImportProfileDto {
  return {
    id: profile.id,
    supplierId: profile.supplierId,
    code: profile.code,
    name: profile.name,
    version: profile.version,
    isActive: profile.isActive,
    isDefault: profile.isDefault,
    sourceFormat: profile.sourceFormat,
    rulesJson: (profile.rulesJson ?? {}) as SupplierImportProfileDto['rulesJson'],
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  }
}

priceImportsRouter.get('/profiles', async (req, res) => {
  try {
    const supplierId = getStringBodyField(req.query.supplierId) ?? null
    const profiles = await listSupplierImportProfiles(supplierId)

    res.status(200).json({
      ok: true,
      data: { items: profiles.map(toSupplierImportProfileDto) },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list supplier import profiles'
    res.status(400).json(apiError('PRICE_IMPORT_PROFILE_LIST_FAILED', message))
  }
})

priceImportsRouter.post('/profiles', async (req, res) => {
  try {
    const profile = await createSupplierImportProfile(req.body ?? {})

    res.status(201).json({
      ok: true,
      data: { profile: toSupplierImportProfileDto(profile) },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save supplier import profile'
    res.status(400).json(apiError('PRICE_IMPORT_PROFILE_CREATE_FAILED', message))
  }
})

priceImportsRouter.post('/', requirePriceImportUploadActor, (req, res) => {
  uploadPriceImportFiles(req, res, async (uploadError) => {
    if (uploadError) {
      sendUploadError(res, uploadError)
      return
    }

    const file = getUploadedFile(req)
    const imageFiles = getUploadedImageFiles(req)
    const uploadedFiles = [file, ...imageFiles]
    let persistedUpload = false

    try {
      if (!file) {
        sendBadRequest(res, 'PRICE_IMPORT_FILE_REQUIRED', 'file is required', {
          file: ['Price import file is required'],
        })
        return
      }

      const supplierId = getStringBodyField(req.body?.supplierId)

      if (!supplierId) {
        cleanupUploadedFiles(uploadedFiles)
        sendBadRequest(res, 'PRICE_IMPORT_SUPPLIER_REQUIRED', 'supplierId is required', {
          supplierId: ['supplierId is required'],
        })
        return
      }

      if (!isPriceFileSupported(file)) {
        cleanupUploadedFiles(uploadedFiles)
        sendBadRequest(
          res,
          'PRICE_IMPORT_UNSUPPORTED_FILE_FORMAT',
          'Supported price file formats: xls, xlsx, csv, xml',
          { file: ['Supported price file formats: xls, xlsx, csv, xml'] },
        )
        return
      }

      if (file.size > PRICE_IMPORT_MAX_FILE_SIZE_BYTES) {
        cleanupUploadedFiles(uploadedFiles)
        res.status(413).json(apiError('PRICE_IMPORT_FILE_TOO_LARGE', 'Price file is too large'))
        return
      }

      const unsupportedImageFile = imageFiles.find((imageFile) => !isImagePackageSupported(imageFile))
      if (unsupportedImageFile) {
        cleanupUploadedFiles(uploadedFiles)
        sendBadRequest(
          res,
          'PRICE_IMPORT_UNSUPPORTED_IMAGE_FORMAT',
          'Supported image package formats: zip, rar, 7z, jpg, jpeg, png, webp',
          { images: ['Supported image package formats: zip, rar, 7z, jpg, jpeg, png, webp'] },
        )
        return
      }

      const oversizedImageFile = imageFiles.find((imageFile) => imageFile.size > PRICE_IMPORT_IMAGE_MAX_FILE_SIZE_BYTES)
      if (oversizedImageFile) {
        cleanupUploadedFiles(uploadedFiles)
        res.status(413).json(apiError('PRICE_IMPORT_IMAGE_PACKAGE_TOO_LARGE', 'Image package is too large'))
        return
      }

      const priceDisplayFileName = normalizeUploadDisplayFileName(file.originalname)
      const priceImportModerator = (req as any).priceImportModerator as PriceImportModerator | undefined
      const supplierAccess = req.auth ? await assertSupplierUploadAccess(req.auth, supplierId) : null
      if (!priceImportModerator && !supplierAccess) {
        cleanupUploadedFiles(uploadedFiles)
        res.status(403).json(apiError('SUPPLIER_ACCESS_FORBIDDEN', 'Supplier access is forbidden'))
        return
      }
      const uploadedByUserId = req.auth?.userId ?? null

      const profileId = getStringBodyField(req.body?.profileId)
      const profile = await assertImportProfileAccess({ profileId, supplierId })

      if (profileId && !profile) {
        cleanupUploadedFiles(uploadedFiles)
        sendBadRequest(
          res,
          'PRICE_IMPORT_PROFILE_NOT_FOUND',
          'Import profile was not found or is not available for supplier',
          { profileId: ['Import profile was not found or is not available for supplier'] },
        )
        return
      }

      let importKind: SupplierPriceImportKind
      try {
        importKind = parseImportKind(req.body?.importKind)
      } catch {
        cleanupUploadedFiles(uploadedFiles)
        sendBadRequest(res, 'PRICE_IMPORT_INVALID_KIND', 'importKind is invalid', {
          importKind: [`importKind must be one of: ${Object.values(SupplierPriceImportKind).join(', ')}`],
        })
        return
      }

      let mappingConfigJson: Prisma.InputJsonValue | null = null
      try {
        mappingConfigJson = parseJsonObjectBodyField(req.body?.mappingConfig)
      } catch {
        cleanupUploadedFiles(uploadedFiles)
        sendBadRequest(res, 'PRICE_IMPORT_INVALID_MAPPING_CONFIG', 'mappingConfig must be a JSON object', {
          mappingConfig: ['mappingConfig must be a JSON object'],
        })
        return
      }

      let priceDate: Date | null = null
      try {
        priceDate = parsePriceDate(req.body?.priceDate)
      } catch {
        cleanupUploadedFiles(uploadedFiles)
        sendBadRequest(res, 'PRICE_IMPORT_INVALID_PRICE_DATE', 'priceDate must be a valid date', {
          priceDate: ['priceDate must be a valid date'],
        })
        return
      }

      const uploadType = priceImportModerator && req.body?.uploadType === 'NORMALIZED'
        ? 'NORMALIZED'
        : 'ORIGINAL'
      const effectiveMappingConfigJson = {
        ...(mappingConfigJson && typeof mappingConfigJson === 'object' && !Array.isArray(mappingConfigJson)
          ? mappingConfigJson as Record<string, unknown>
          : {}),
        uploadType,
      } as Prisma.InputJsonValue

      const importRecord = await prisma.$transaction(async (tx) => {
        const fileAsset = await tx.fileAsset.create({
          data: {
            storageKey: `uploads/${file.filename}`,
            fileName: priceDisplayFileName,
            mimeType: file.mimetype || 'application/octet-stream',
            fileSize: file.size,
            type: FileAssetType.SPREADSHEET,
            uploadedByUserId,
            uploadedBySupplierId: supplierId,
          },
        })

        const createdImport = await tx.supplierPriceImport.create({
          data: {
            supplierId,
            fileAssetId: fileAsset.id,
            profileId,
            sourceFormat: detectSourceFormat(priceDisplayFileName),
            importKind,
            status: PriceImportStatus.UPLOADED,
            originalFileName: priceDisplayFileName,
            parserVersion: PRICE_IMPORT_PARSER_VERSION,
            detectedProfileJson: profile
              ? {
                  profileId: profile.id,
                  code: profile.code,
                  name: profile.name,
                  version: profile.version,
                  confidence: 1,
                  reason: 'REQUESTED_PROFILE',
                } as Prisma.InputJsonValue
              : Prisma.JsonNull,
            mappingConfigJson: effectiveMappingConfigJson,
            profileSnapshotJson: profile
              ? {
                  id: profile.id,
                  code: profile.code,
                  name: profile.name,
                  version: profile.version,
                  sourceFormat: profile.sourceFormat,
                  rulesJson: profile.rulesJson,
                } as Prisma.InputJsonValue
              : Prisma.JsonNull,
            priceDate,
          },
          include: { fileAsset: true },
        })

        for (const imageFile of imageFiles) {
          const imageDisplayFileName = normalizeUploadDisplayFileName(imageFile.originalname)
          const imageAsset = await tx.fileAsset.create({
            data: {
              storageKey: `uploads/${imageFile.filename}`,
              fileName: imageDisplayFileName,
              mimeType: imageFile.mimetype || 'application/octet-stream',
              fileSize: imageFile.size,
              type: getImageAssetType(imageFile),
              uploadedByUserId,
              uploadedBySupplierId: supplierId,
            },
          })

          await tx.supplierImportImageMatch.create({
            data: {
              supplierId,
              importId: createdImport.id,
              fileAssetId: imageAsset.id,
              originalFileName: imageDisplayFileName,
              normalizedFileName: normalizeUploadSafeBaseName(imageDisplayFileName),
              status: SupplierImportImageMatchStatus.PENDING,
              matchReason: 'UPLOAD_PACKAGE',
            },
          })
        }

        return createdImport
      })
      persistedUpload = true
      if (uploadType === 'ORIGINAL') {
        res.status(201).json({
          ok: true,
          data: {
            import: toSupplierPriceImportDto(importRecord),
            rows: [],
            issues: [],
          },
          meta: {
            ...buildOffsetLimitPaginationMeta({
              offset: 0,
              limit: 100,
              total: 0,
            }),
            matchedRows: 0,
            failedRows: 0,
            issuesCount: 0,
          },
        })
        return
      }

      const processedImport = await processSupplierPriceImport(importRecord.id, {
        profileOverride: mappingConfigJson && typeof mappingConfigJson === 'object' && !Array.isArray(mappingConfigJson)
          ? mappingConfigJson as Record<string, unknown>
          : null,
      })
      const preview = await loadPriceImportPreviewPayload({
        importId: processedImport.id,
        offset: 0,
        limit: 100,
      })

      res.status(201).json({
        ok: true,
        data: {
          import: toSupplierPriceImportDto(preview?.importRecord ?? processedImport),
          rows: preview?.rows.map(toPreviewRowDto) ?? [],
          issues: preview?.issues.map(toIssueDto) ?? [],
        },
        meta: {
          ...buildOffsetLimitPaginationMeta({
            offset: 0,
            limit: 100,
            total: preview?.total ?? processedImport.rowsCount,
          }),
          matchedRows: processedImport.matchedRows,
          failedRows: processedImport.failedRows,
          issuesCount: processedImport.issuesCount,
        },
      })
    } catch (error) {
      if (!persistedUpload) {
        cleanupUploadedFiles(uploadedFiles)
      }
      const message = error instanceof Error ? error.message : 'Failed to upload price import'
      res.status(400).json(apiError('PRICE_IMPORT_UPLOAD_FAILED', message))
    }
  })
})

priceImportsRouter.get('/:importId/preview', async (req, res) => {
  try {
    const { offset, limit } = parseOffsetLimitPagination(req.query)
    const selectedFacets = parseFacetSelectionFromQuery(req.query)
    const categoryId = typeof req.query.categoryId === 'string' ? req.query.categoryId : null
    const search = typeof req.query.query === 'string' ? req.query.query : null
    const rowId = typeof req.query.rowId === 'string' && req.query.rowId.trim()
      ? req.query.rowId.trim()
      : null
    const where = await buildPriceImportRowWhere({
      importId: req.params.importId,
      rowId,
      categoryId,
      search,
      selectedFacets,
    })
    const preview = await loadPriceImportPreviewPayload({
      importId: req.params.importId,
      offset,
      limit,
      where,
    })

    if (!preview) {
      res.status(404).json(apiError('PRICE_IMPORT_NOT_FOUND', 'Price import not found'))
      return
    }

    res.status(200).json({
      ok: true,
      data: {
        import: toSupplierPriceImportDto(preview.importRecord),
        rows: preview.rows.map(toPreviewRowDto),
        issues: preview.issues.map(toIssueDto),
      },
      meta: {
        ...buildOffsetLimitPaginationMeta({ offset, limit, total: preview.total }),
        matchedRows: preview.importRecord.matchedRows,
        failedRows: preview.importRecord.failedRows,
        issuesCount: preview.importRecord.issuesCount,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load price import preview'
    res.status(400).json(apiError(error instanceof FacetQueryError ? 'PRICE_IMPORT_FACETS_INVALID' : 'PRICE_IMPORT_PREVIEW_FAILED', message))
  }
})

priceImportsRouter.get('/:importId/facets', async (req, res) => {
  try {
    const selectedFacets = parseFacetSelectionFromQuery(req.query)
    const categoryId = typeof req.query.categoryId === 'string' ? req.query.categoryId : null
    const search = typeof req.query.query === 'string' ? req.query.query : null
    const facets = await getPriceImportFacets({
      importId: req.params.importId,
      categoryId,
      search,
      selectedFacets,
    })

    res.status(200).json({
      ok: true,
      facets: facets.facets,
      appliedFacets: facets.appliedFacets,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load price import facets'
    res.status(400).json(apiError(error instanceof FacetQueryError ? 'PRICE_IMPORT_FACETS_INVALID' : 'PRICE_IMPORT_FACETS_FAILED', message))
  }
})

priceImportsRouter.get('/:importId/issues', async (req, res) => {
  try {
    const { offset, limit } = parseOffsetLimitPagination(req.query)
    const where: Prisma.SupplierPriceImportIssueWhereInput = {
      importId: req.params.importId,
      status: PriceImportIssueStatus.OPEN,
    }
    const [total, issues] = await prisma.$transaction([
      prisma.supplierPriceImportIssue.count({ where }),
      prisma.supplierPriceImportIssue.findMany({
        where,
        orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }],
        skip: offset,
        take: limit,
      }),
    ])

    res.status(200).json({
      ok: true,
      data: { items: issues.map(toIssueDto) },
      meta: buildOffsetLimitPaginationMeta({ offset, limit, total }),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load price import issues'
    res.status(400).json(apiError('PRICE_IMPORT_ISSUES_FAILED', message))
  }
})

priceImportsRouter.patch('/:importId/mapping', async (req, res) => {
  try {
    const updatedImport = await updateSupplierPriceImportMapping(
      req.params.importId,
      req.body ?? {},
    )
    const preview = await loadPriceImportPreviewPayload({
      importId: updatedImport.id,
      offset: 0,
      limit: 100,
    })

    res.status(200).json({
      ok: true,
      data: {
        import: toSupplierPriceImportDto(preview?.importRecord ?? updatedImport),
        rows: preview?.rows.map(toPreviewRowDto) ?? [],
        issues: preview?.issues.map(toIssueDto) ?? [],
      },
      meta: {
        ...buildOffsetLimitPaginationMeta({
          offset: 0,
          limit: 100,
          total: preview?.total ?? updatedImport.rowsCount,
        }),
        matchedRows: updatedImport.matchedRows,
        failedRows: updatedImport.failedRows,
        issuesCount: updatedImport.issuesCount,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update price import mapping'
    res.status(400).json(apiError('PRICE_IMPORT_MAPPING_UPDATE_FAILED', message))
  }
})

priceImportsRouter.post('/:importId/reprocess', async (req, res) => {
  try {
    const processedImport = await reprocessSupplierPriceImport(
      req.params.importId,
      req.body ?? {},
    )
    const preview = await loadPriceImportPreviewPayload({
      importId: processedImport.id,
      offset: 0,
      limit: 100,
    })

    res.status(200).json({
      ok: true,
      data: {
        import: toSupplierPriceImportDto(preview?.importRecord ?? processedImport),
        rows: preview?.rows.map(toPreviewRowDto) ?? [],
        issues: preview?.issues.map(toIssueDto) ?? [],
      },
      meta: {
        ...buildOffsetLimitPaginationMeta({
          offset: 0,
          limit: 100,
          total: preview?.total ?? processedImport.rowsCount,
        }),
        matchedRows: processedImport.matchedRows,
        failedRows: processedImport.failedRows,
        issuesCount: processedImport.issuesCount,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to reprocess price import'
    res.status(400).json(apiError('PRICE_IMPORT_REPROCESS_FAILED', message))
  }
})

priceImportsRouter.post('/:importId/rows/:rowId/create-product', async (req, res) => {
  try {
    const createdImport = await createProductFromImportRow(
      req.params.importId,
      req.params.rowId,
      req.body ?? {},
    )
    const preview = await loadPriceImportPreviewPayload({
      importId: createdImport.id,
      offset: 0,
      limit: 100,
    })

    res.status(200).json({
      ok: true,
      data: {
        import: toSupplierPriceImportDto(preview?.importRecord ?? createdImport),
        rows: preview?.rows.map(toPreviewRowDto) ?? [],
        issues: preview?.issues.map(toIssueDto) ?? [],
      },
      meta: {
        ...buildOffsetLimitPaginationMeta({
          offset: 0,
          limit: 100,
          total: preview?.total ?? createdImport.rowsCount,
        }),
        matchedRows: createdImport.matchedRows,
        failedRows: createdImport.failedRows,
        issuesCount: createdImport.issuesCount,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create product from row'
    res.status(400).json(apiError('PRICE_IMPORT_ROW_CREATE_PRODUCT_FAILED', message))
  }
})

priceImportsRouter.post('/:importId/publish', async (req, res) => {
  try {
    const published = await publishSupplierPriceImport(req.params.importId)

    res.status(200).json({
      ok: true,
      data: {
        import: toSupplierPriceImportDto(published.import),
        summary: published.summary,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to publish price import'
    res.status(400).json(apiError('PRICE_IMPORT_PUBLISH_FAILED', message))
  }
})

priceImportsRouter.post('/:importId/unpublish', async (req, res) => {
  try {
    const unpublished = await unpublishSupplierPriceImport(req.params.importId)

    res.status(200).json({
      ok: true,
      data: {
        import: toSupplierPriceImportDto(unpublished.import),
        summary: unpublished.summary,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to unpublish price import'
    res.status(400).json(apiError('PRICE_IMPORT_UNPUBLISH_FAILED', message))
  }
})

priceImportsRouter.delete('/:importId', async (req, res) => {
  try {
    await prisma.supplierPriceImport.delete({
      where: { id: req.params.importId },
    })

    res.status(200).json({
      ok: true,
      data: { deletedId: req.params.importId },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete price import'
    res.status(400).json(apiError('PRICE_IMPORT_DELETE_FAILED', message))
  }
})

priceImportsRouter.post('/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      sendBadRequest(res, 'PRICE_IMPORT_FILE_REQUIRED', 'file is required')
      return
    }

    const parsedRows = await parsePriceExcel(req.file.path)
    const supplierId = getStringBodyField(req.body?.supplierId)
    const rows = await Promise.all(
      parsedRows.map(async (row) => {
        const categoryMatch = await resolveCatalogCategoryMatch({
          rawCategory: row.rawCategory,
          supplierId,
        })

        return {
          ...row,
          categoryMatch: {
            source: categoryMatch.source,
            normalizedRawCategory: categoryMatch.normalizedRawCategory,
            category: categoryMatch.category,
            confidence: categoryMatch.confidence,
            reason: categoryMatch.reason,
          },
        }
      }),
    )

    res.status(200).json({
      ok: true,
      data: {
        fileName: normalizeUploadDisplayFileName(req.file.originalname),
        rowsCount: rows.length,
        matchedRowsCount: rows.filter((row) => row.categoryMatch.category).length,
        rows,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to parse price file'
    res.status(400).json(apiError('PRICE_IMPORT_PREVIEW_UPLOAD_FAILED', message))
  }
})

priceImportsRouter.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      sendBadRequest(res, 'PRICE_IMPORT_FILE_REQUIRED', 'file is required')
      return
    }

    const supplierId = getStringBodyField(req.body?.supplierId)

    if (!supplierId) {
      sendBadRequest(res, 'PRICE_IMPORT_SUPPLIER_REQUIRED', 'supplierId is required')
      return
    }

    const imported = await importPriceFile({
      supplierId,
      file: req.file,
      uploadType: 'ORIGINAL',
    })

    res.status(201).json({
      ok: true,
      data: { import: imported },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to import price file'
    res.status(400).json(apiError('PRICE_IMPORT_IMPORT_FAILED', message))
  }
})

export default priceImportsRouter
