import fs from 'fs'
import path from 'path'
import * as XLSX from 'xlsx'
import { PriceImportSourceFormat } from '../../generated/prisma'
import { decomposeName, extractVolume } from './name-decomposer.service'
import { resolvePriceImportProductNames } from './price-import-name-resolution'

export type ParsedPriceRow = {
  rowNumber: number
  rawName: string | null
  normalizedName: string | null
  rawCategory: string | null
  normalizedCategory: string | null
  supplierSku: string | null
  barcode: string | null
  article: string | null
  price: number | null
  currency: string | null
  stock: number | null
  deliveryDaysMin: number | null
  deliveryDaysMax: number | null
  volumeMl: number | null
  rawPayload: Record<string, unknown>
  normalizedPayload: Record<string, unknown>
}

export type WorkbookSheetStructure = {
  name: string
  index: number
  rowCount: number
  columnCount: number
  headerRowIndex: number | null
  headerConfidence: number
  headers: string[]
  sampleRows: unknown[][]
}

export type WorkbookStructure = {
  sheets: WorkbookSheetStructure[]
  bestSheetName: string | null
}

export type ImportProfileColumnRules = Record<string, string | number | Array<string | number> | null>

export type ImportProfileRules = {
  code?: string
  name?: string
  parserKind?: 'generic' | 'ast' | 'beluga' | 'simple' | 'ryatiko' | 'normalized'
  importKind?: 'PRICE_WITH_OFFERS' | 'PRODUCT_MASTER' | 'STOCK_ONLY' | 'IMAGE_PACKAGE'
  sheets?: {
    include?: string[]
    exclude?: string[]
  }
  header?: {
    rowIndex?: number
    dataStartRowIndex?: number
    strategy?: 'auto' | 'fixed' | 'none' | 'multiRow'
  }
  columns?: ImportProfileColumnRules
  contextRows?: Array<'category' | 'country' | 'region' | 'producer'> | boolean
  mergeRows?: {
    continuationRows?: boolean
    inheritContext?: boolean
  }
  rowClassification?: {
    minFilledCells?: number
    requireName?: boolean
    requirePrice?: boolean
    ignoreRepeatedHeaders?: boolean
  }
  publishing?: {
    publishOffers?: boolean
  }
  [key: string]: unknown
}

export type ParseRowsFromFileOptions = {
  supplierId?: string | null
  profile?: ImportProfileRules | Record<string, unknown> | null
}

export type DetectedImportProfileResult = {
  profile: ImportProfileRules
  structure: WorkbookStructure | null
}

const NAME_ALIASES = ['name', 'title', 'product', 'productname', 'наименование', 'название', 'номенклатура', 'наименование для печати']
const CATEGORY_ALIASES = ['category', 'categoryname', 'категория', 'группа']
const SKU_ALIASES = ['sku', 'supplier_sku', 'suppliersku', 'артикул', 'supplierarticle', 'article', 'код товара', 'код']
const BARCODE_ALIASES = ['barcode', 'bar_code', 'штрихкод', 'штрих код', 'штрих/код', 'ean']
const ARTICLE_ALIASES = ['article', 'art', 'vendorcode', 'vendor_code', 'артикул', 'код']
const PRICE_ALIASES = ['price', 'cost', 'цена', 'стоимость', 'прайс лист базовый', 'прайслист базовый', 'основной розничный', 'розничный']
const STOCK_ALIASES = ['stock', 'stockavailable', 'availability', 'остаток', 'наличие', 'свободный остаток', 'склад']
const VOLUME_ALIASES = ['volume', 'volumeml', 'volume_ml', 'объем', 'объём', 'емкость', 'ёмкость', 'ёмк л', 'мл']
const VOLUME_UNIT_ALIASES = ['volumeunit', 'volume_unit', 'unitvolume']
const UNIT_ALIASES = ['unit', 'единица', 'едизм', 'единицаизмерения']
const MIN_ORDER_ALIASES = ['minorder', 'minorderqty', 'minimumorder', 'moq', 'минзаказ']
const PACK_QTY_ALIASES = ['packqty', 'packageqty', 'packagequantity', 'pack', 'кратность', 'упаковка']
const PACKAGE_SIZE_ALIASES = ['packagesize', 'package_size', 'packsize']
const PACKAGE_SIZE_UNIT_ALIASES = ['packagesizeunit', 'package_size_unit', 'packunit']
const PRODUCER_ALIASES = ['producer', 'manufacturer', 'brand', 'производитель', 'поставщик', 'бренд']
const COUNTRY_ALIASES = ['country', 'страна']
const REGION_ALIASES = ['region', 'регион']
const VINTAGE_ALIASES = ['vintage', 'year', 'год', 'урожай']
const ALCOHOL_ALIASES = ['alcohol', 'alcoholpercent', 'alc', 'крепость', 'алк']
const COLOR_ALIASES = ['color', 'цвет']
const SUGAR_ALIASES = ['sugar', 'сахар', 'тип']
const GRAPE_ALIASES = ['grape', 'grapes', 'сорт', 'сорта', 'виноград']
const DEFAULT_EXCLUDED_SHEET_PATTERNS = [
  'оглавление',
  'тит',
  'титуль',
  'cover',
  'contents',
  'index',
  'услов',
  'достав',
  'контакт',
  'справ',
  'image',
  'картин',
  'фото',
]

const CANONICAL_COLUMN_ALIASES: Record<string, string[]> = {
  name: NAME_ALIASES,
  category: CATEGORY_ALIASES,
  supplierSku: SKU_ALIASES,
  supplierArticle: ARTICLE_ALIASES,
  article: ARTICLE_ALIASES,
  barcode: BARCODE_ALIASES,
  price: PRICE_ALIASES,
  stock: STOCK_ALIASES,
  volume: VOLUME_ALIASES,
  volumeUnit: VOLUME_UNIT_ALIASES,
  unit: UNIT_ALIASES,
  minOrderQty: MIN_ORDER_ALIASES,
  packQty: PACK_QTY_ALIASES,
  packageSize: PACKAGE_SIZE_ALIASES,
  packageSizeUnit: PACKAGE_SIZE_UNIT_ALIASES,
  producer: PRODUCER_ALIASES,
  manufacturer: PRODUCER_ALIASES,
  brand: PRODUCER_ALIASES,
  country: COUNTRY_ALIASES,
  region: REGION_ALIASES,
  vintage: VINTAGE_ALIASES,
  alcoholPercent: ALCOHOL_ALIASES,
  color: COLOR_ALIASES,
  sugar: SUGAR_ALIASES,
  grapeSorts: GRAPE_ALIASES,
}

const NORMALIZED_EMPTY_VALUES = new Set(['-', '—', '–', 'нет', 'n/a', 'na', 'null', 'none'])
const NORMALIZED_SKU_ALIASES = ['SKU поставщика', 'sku поставщика', 'sku']
const NORMALIZED_CANONICAL_NAME_ALIASES = ['Каноническое название (ориг.)', 'Каноническое название', 'canonical name', 'name']
const NORMALIZED_RUSSIAN_NAME_ALIASES = ['Русское название', 'Название на русском']
const NORMALIZED_DESCRIPTION_ALIASES = ['Описание (сомелье, ≤140)', 'Описание']
const NORMALIZED_CATEGORY_ALIASES = ['Категория Barello (card_type SPIRIT)', 'Категория Barello (card_type WINE)', 'Категория Barello']
const NORMALIZED_BRAND_ALIASES = ['Бренд', 'Бренд / хозяйство']
const NORMALIZED_PRODUCER_ALIASES = ['Производитель']
const NORMALIZED_COUNTRY_ALIASES = ['Страна']
const NORMALIZED_REGION_ALIASES = ['Регион']
const NORMALIZED_RAW_MATERIAL_ALIASES = ['Сырьё', 'Сырье']
const NORMALIZED_AGING_ALIASES = ['Выдержка']
const NORMALIZED_VINTAGE_ALIASES = ['Год']
const NORMALIZED_ALCOHOL_ALIASES = ['Крепость, %', 'Алкоголь, %']
const NORMALIZED_COLOR_ALIASES = ['Цвет']
const NORMALIZED_SUGAR_ALIASES = ['Сахар']
const NORMALIZED_GRAPE_ALIASES = ['Сорта винограда']
const NORMALIZED_VOLUME_ALIASES = ['Объём, л', 'Объем, л', 'Объём', 'Объем']
const NORMALIZED_PACKAGING_TYPE_ALIASES = ['Тип упаковки']
const NORMALIZED_PACK_QTY_ALIASES = ['Кол-во в коробе, шт', 'Кол-во в коробе', 'Количество в коробе']
const NORMALIZED_OPTIONS_ALIASES = ['Опции']
const NORMALIZED_MIN_ORDER_ALIASES = ['Мин. закупка', 'Минимальная закупка']
const NORMALIZED_PRICE_ALIASES = ['Цена, ₽', 'Цена']
const NORMALIZED_DISCOUNT_ALIASES = ['Скидка']
const NORMALIZED_DELIVERY_TYPE_ALIASES = ['Тип поставки']
const NORMALIZED_SOURCE_URL_ALIASES = ['Ссылка поставщика']
const NORMALIZED_NOTE_ALIASES = ['Примечание / источник обогащения', 'Примечание']

function normalizeHeaderName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, '')
}

function getRowValue(row: Record<string, unknown>, aliases: string[]) {
  const normalizedHeaders = new Map<string, string>()

  for (const [header] of Object.entries(row)) {
    normalizedHeaders.set(normalizeHeaderName(header), header)
  }

  for (const alias of aliases) {
    const normalizedAlias = normalizeHeaderName(alias)
    const matchedHeader = normalizedHeaders.get(normalizedAlias)

    if (matchedHeader) {
      return row[matchedHeader]
    }
  }

  return null
}

function getRowString(row: Record<string, unknown>, aliases: string[]) {
  const value = getRowValue(row, aliases)

  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  return null
}

function getNormalizedRowString(row: Record<string, unknown>, aliases: string[]) {
  const value = getRowString(row, aliases)
  if (!value) return null
  const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim()
  if (!normalized) return null
  return NORMALIZED_EMPTY_VALUES.has(normalized.toLowerCase()) ? null : normalized
}

function getNormalizedRowNumber(row: Record<string, unknown>, aliases: string[]) {
  const parsed = parseNumber(getRowValue(row, aliases))
  return parsed === null ? null : parsed
}

function normalizeText(value: string | null | undefined) {
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

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const sanitized = value.trim().replace(/\s/g, '').replace(/,/g, '.')

    if (!sanitized) {
      return null
    }

    const parsed = Number(sanitized)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function parsePackageQuantity(value: unknown) {
  if (typeof value !== 'string') return null

  const match = value.match(/\((\d+)\s*\/\s*\d+\)/)
  if (!match) return null

  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeVolumeMl(value: number | null) {
  if (value === null) return null
  return value > 0 && value <= 20 ? Math.round(value * 1000) : value
}

function parseVolumeMlFromText(value: string | null | undefined) {
  return value ? extractVolume(value).volumeMl : null
}

function payloadObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function payloadNumber(payload: Record<string, unknown>, key: string) {
  const value = payload[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function payloadString(payload: Record<string, unknown>, key: string) {
  const value = payload[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function payloadStringList(payload: Record<string, unknown>, key: string) {
  const value = payload[key]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function payloadRecordStringList(payload: Record<string, unknown>, key: string) {
  return payloadStringList(payload, key)
}

function hasCategoryMismatch(rawCategory: string | null, categoryPath: string[] | null) {
  if (!rawCategory || !categoryPath?.length) return false

  const normalizedRawCategory = normalizeText(rawCategory)
  const normalizedNameCategory = normalizeText(categoryPath[0])
  if (!normalizedRawCategory || !normalizedNameCategory) return false

  return !normalizedRawCategory.includes(normalizedNameCategory)
}

function getCellString(row: unknown[], index: number) {
  const value = row[index]

  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  return null
}

function normalizeMultilineName(value: string) {
  return value
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' / ')
}

function isProbablyHeadingRow(row: unknown[]) {
  const filledCells = row.filter((value) => {
    return value !== null && value !== undefined && String(value).trim() !== ''
  })

  return filledCells.length === 1
}

function normalizeAlcoholCategory(value: string | null, fallback: string | null = null) {
  const source = `${value ?? ''} ${fallback ?? ''}`.toLowerCase()

  if (source.includes('шампан') || source.includes('champagne')) return 'Шампанское'
  if (source.includes('игрист') || source.includes('cremant') || source.includes('franciacorta')) return 'Игристое'
  if (source.includes('настой')) return 'Настойка'
  if (source.includes('порт')) return 'Портвейн'
  if (source.includes('херес') || source.includes('sherry')) return 'Херес'
  if (source.includes('водк') || source.includes('vodka')) return 'Водка'
  if (source.includes('джин') || source.includes('gin')) return 'Джин'
  if (source.includes('виск') || source.includes('whisk')) return 'Виски'
  if (source.includes('ром') || source.includes('rum')) return 'Ром'
  if (source.includes('текил') || source.includes('tequila')) return 'Текила'
  if (source.includes('мескал') || source.includes('mezcal')) return 'Мескаль'
  if (source.includes('бренди') || source.includes('brandy')) return 'Бренди'
  if (source.includes('коньяк') || source.includes('cognac')) return 'Коньяк'
  if (source.includes('арманьяк') || source.includes('armagnac')) return 'Арманьяк'
  if (source.includes('кальвадос') || source.includes('calvados')) return 'Кальвадос'
  if (source.includes('ликер') || source.includes('ликёр') || source.includes('liqueur')) return 'Ликер'
  if (source.includes('саке') || source.includes('sake')) return 'Сакэ'
  if (source.includes('аперитив') || source.includes('aperitif')) return 'Аперитив'
  if (source.includes('масло') || source.includes('oil')) return 'Масло'
  if (source.includes('вино') || source.includes('wine')) return 'Вино'

  return fallback
}

function buildNormalizedPayload(params: {
  price: number | null
  currency?: string | null
  unit?: string | null
  stockAvailable?: number | null
  volumeMl?: number | null
  packageSize?: number | null
  minOrderQty?: number | null
  packQty?: number | null
}) {
  const unit = params.unit ?? (params.volumeMl !== null && params.volumeMl !== undefined ? 'bottle' : 'pcs')
  const packageSize = params.packageSize ?? null

  return {
    price: params.price,
    currency: params.currency ?? 'RUB',
    unit,
    minOrderQty: params.minOrderQty ?? packageSize,
    packQty: params.packQty ?? packageSize,
    stockAvailable: params.stockAvailable ?? null,
    deliveryDaysMin: null,
    deliveryDaysMax: null,
    volumeMl: params.volumeMl ?? null,
    volumeUnit: params.volumeMl !== null && params.volumeMl !== undefined ? 'ml' : null,
    packageSize,
    packageSizeUnit: packageSize !== null ? 'pcs' : null,
  }
}

function parseNormalizedList(value: string | null) {
  if (!value) return []

  return value
    .split(/[;,/]+/)
    .map((item) => item.normalize('NFKC').replace(/\s+/g, ' ').trim())
    .filter((item) => item && !NORMALIZED_EMPTY_VALUES.has(item.toLowerCase()))
}

function isNormalizedMethodologySheet(sheetName: string) {
  const normalized = normalizeText(sheetName) ?? ''
  return normalized.includes('методолог') || normalized.includes('method')
}

function parseNormalizedAdminWorkbook(workbook: XLSX.WorkBook): ParsedPriceRow[] {
  const rows: ParsedPriceRow[] = []

  for (const sheetName of workbook.SheetNames) {
    if (isNormalizedMethodologySheet(sheetName)) continue

    const sheet = workbook.Sheets[sheetName]
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
      raw: false,
    })

    rawRows.forEach((row, rowIndex) => {
      const canonicalName = getNormalizedRowString(row, NORMALIZED_CANONICAL_NAME_ALIASES)
      const russianName = getNormalizedRowString(row, NORMALIZED_RUSSIAN_NAME_ALIASES)
      const price = getNormalizedRowNumber(row, NORMALIZED_PRICE_ALIASES)
      const volumeMl = normalizeVolumeMl(getNormalizedRowNumber(row, NORMALIZED_VOLUME_ALIASES))

      if (!canonicalName && !russianName && price === null) return

      const supplierSku = getNormalizedRowString(row, NORMALIZED_SKU_ALIASES)
      const categoryRaw = getNormalizedRowString(row, NORMALIZED_CATEGORY_ALIASES)
      const packagingType = getNormalizedRowString(row, NORMALIZED_PACKAGING_TYPE_ALIASES)
      const packagingOptions = parseNormalizedList(getNormalizedRowString(row, NORMALIZED_OPTIONS_ALIASES))
      const packQty = getNormalizedRowNumber(row, NORMALIZED_PACK_QTY_ALIASES)
      const minOrderQty = getNormalizedRowNumber(row, NORMALIZED_MIN_ORDER_ALIASES)
      const producer = getNormalizedRowString(row, NORMALIZED_PRODUCER_ALIASES)
      const note = getNormalizedRowString(row, NORMALIZED_NOTE_ALIASES)
      const sourceUrl = getNormalizedRowString(row, NORMALIZED_SOURCE_URL_ALIASES)

      rows.push({
        rowNumber: rowIndex + 2,
        rawName: canonicalName ?? russianName ?? '(empty)',
        normalizedName: normalizeText(canonicalName ?? russianName ?? null),
        rawCategory: categoryRaw,
        normalizedCategory: normalizeText(categoryRaw),
        supplierSku,
        barcode: null,
        article: null,
        price,
        currency: 'RUB',
        stock: null,
        deliveryDaysMin: null,
        deliveryDaysMax: null,
        volumeMl,
        rawPayload: {
          sheetName,
          rowIndex: rowIndex + 2,
          row,
        },
        normalizedPayload: {
          source: {
            sheetName,
            rowIndex: rowIndex + 2,
            format: 'NORMALIZED_ADMIN_PRICE',
            sourceUrl,
            note,
          },
          identity: {
            supplierSku,
            normalizedName: normalizeText(canonicalName ?? russianName ?? null),
            matchBy: 'CANONICAL_NAME_VOLUME_OPTIONS',
          },
          product: {
            name: canonicalName,
            canonicalName,
            russianName,
            displayName: russianName ?? canonicalName,
            translatedName: russianName,
            description: getNormalizedRowString(row, NORMALIZED_DESCRIPTION_ALIASES),
            categoryRaw,
            categorySource: 'NORMALIZED_ADMIN_PRICE',
            categoryConfidence: 1,
            brand: getNormalizedRowString(row, NORMALIZED_BRAND_ALIASES),
            producer,
            manufacturer: producer,
            country: getNormalizedRowString(row, NORMALIZED_COUNTRY_ALIASES),
            region: getNormalizedRowString(row, NORMALIZED_REGION_ALIASES),
            rawMaterial: getNormalizedRowString(row, NORMALIZED_RAW_MATERIAL_ALIASES),
            aging: getNormalizedRowString(row, NORMALIZED_AGING_ALIASES),
            vintage: getNormalizedRowNumber(row, NORMALIZED_VINTAGE_ALIASES),
            alcoholPercent: getNormalizedRowNumber(row, NORMALIZED_ALCOHOL_ALIASES),
            color: getNormalizedRowString(row, NORMALIZED_COLOR_ALIASES),
            sugar: getNormalizedRowString(row, NORMALIZED_SUGAR_ALIASES),
            grapeSorts: parseNormalizedList(getNormalizedRowString(row, NORMALIZED_GRAPE_ALIASES)),
            volumeMl,
            packagingType,
            packagingOptions,
          },
          variant: {
            volumeMl,
            volumeUnit: volumeMl !== null ? 'ml' : null,
            unit: volumeMl !== null ? 'bottle' : 'pcs',
            packageSize: packQty,
            packageSizeUnit: packQty !== null ? 'pcs' : null,
            packQty,
            packagingType,
            packagingOptions,
          },
          offer: {
            price,
            currency: 'RUB',
            unit: volumeMl !== null ? 'bottle' : 'pcs',
            minOrderQty,
            packQty,
            stockAvailable: null,
            availability: price !== null ? 'ORDERABLE' : null,
            discount: getNormalizedRowString(row, NORMALIZED_DISCOUNT_ALIASES),
            deliveryType: getNormalizedRowString(row, NORMALIZED_DELIVERY_TYPE_ALIASES),
          },
          matching: {
            identityStrategy: 'CANONICAL_NAME_VOLUME_OPTIONS',
          },
        },
      })
    })
  }

  return rows
}

function parseDeliveryDays(value: unknown) {
  const parsed = parseNumber(value)

  if (parsed === null) {
    return null
  }

  return Math.max(0, Math.round(parsed))
}

function getFilledCells(row: unknown[]) {
  return row.filter((value) => value !== null && value !== undefined && String(value).trim() !== '')
}

function rowToHeaderStrings(row: unknown[]) {
  return row.map((value) => {
    if (value === null || value === undefined) return ''
    return String(value).trim()
  })
}

function scoreHeaderRow(row: unknown[]) {
  const headers = rowToHeaderStrings(row)
  const normalizedHeaders = headers.map((header) => normalizeHeaderName(header)).filter(Boolean)
  if (normalizedHeaders.length === 0) return 0

  let score = 0
  const matchedCanonicalFields = new Set<string>()

  for (const [field, aliases] of Object.entries(CANONICAL_COLUMN_ALIASES)) {
    const normalizedAliases = aliases.map((alias) => normalizeHeaderName(alias))
    if (
      normalizedHeaders.some((header) =>
        normalizedAliases.some((alias) => header === alias || header.includes(alias) || alias.includes(header))
      )
    ) {
      matchedCanonicalFields.add(field)
      score += field === 'name' || field === 'price' ? 3 : 1
    }
  }

  if (matchedCanonicalFields.has('name')) score += 4
  if (matchedCanonicalFields.has('price')) score += 4
  if (matchedCanonicalFields.has('barcode')) score += 2
  if (matchedCanonicalFields.has('supplierSku') || matchedCanonicalFields.has('article')) score += 2

  return score
}

function detectSheetStructure(sheet: XLSX.WorkSheet, name: string, index: number): WorkbookSheetStructure {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const candidates = rows.slice(0, 30).map((row, rowIndex) => ({
    rowIndex,
    score: scoreHeaderRow(row),
    headers: rowToHeaderStrings(row),
  }))
  const bestCandidate = candidates.reduce(
    (best, candidate) => candidate.score > best.score ? candidate : best,
    { rowIndex: -1, score: 0, headers: [] as string[] },
  )

  return {
    name,
    index,
    rowCount: rows.length,
    columnCount,
    headerRowIndex: bestCandidate.score > 0 ? bestCandidate.rowIndex : null,
    headerConfidence: bestCandidate.score,
    headers: bestCandidate.score > 0 ? bestCandidate.headers : [],
    sampleRows: rows.slice(0, 10),
  }
}

export function detectWorkbookStructure(workbook: XLSX.WorkBook): WorkbookStructure {
  const sheets = workbook.SheetNames.map((sheetName, index) => {
    const sheet = workbook.Sheets[sheetName]
    return detectSheetStructure(sheet, sheetName, index)
  })
  const bestSheet = sheets.reduce<WorkbookSheetStructure | null>((best, sheet) => {
    if (!best) return sheet
    if (sheet.headerConfidence > best.headerConfidence) return sheet
    if (sheet.headerConfidence === best.headerConfidence && sheet.rowCount > best.rowCount) return sheet
    return best
  }, null)

  return {
    sheets,
    bestSheetName: bestSheet?.name ?? null,
  }
}

function normalizeProfileRules(profile: ImportProfileRules | Record<string, unknown> | null | undefined): ImportProfileRules | null {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null
  return profile as ImportProfileRules
}

function sheetPatternMatches(sheetName: string, pattern: string) {
  if (pattern === '*') return true
  const normalizedSheetName = normalizeText(sheetName) ?? ''
  const normalizedPattern = normalizeText(pattern) ?? ''
  return normalizedSheetName.includes(normalizedPattern)
}

function shouldReadSheet(sheetName: string, profile: ImportProfileRules) {
  const include = profile.sheets?.include?.length ? profile.sheets.include : ['*']
  const exclude = profile.sheets?.exclude ?? []
  return include.some((pattern) => sheetPatternMatches(sheetName, pattern)) &&
    !exclude.some((pattern) => sheetPatternMatches(sheetName, pattern))
}

function isDefaultExcludedSheet(sheetName: string) {
  const normalizedSheetName = normalizeText(sheetName) ?? ''
  return DEFAULT_EXCLUDED_SHEET_PATTERNS.some((pattern) => {
    const normalizedPattern = normalizeText(pattern) ?? pattern
    return normalizedSheetName.includes(normalizedPattern)
  })
}

function isAutoGenericProfile(profile: ImportProfileRules) {
  return profile.parserKind === 'generic' &&
    typeof profile.code === 'string' &&
    (profile.code === 'auto-generic' || profile.code.endsWith('-auto'))
}

function detectGenericImportKind(structure: WorkbookStructure) {
  const bestSheet = structure.sheets.find((sheet) => sheet.name === structure.bestSheetName)
  const headers = bestSheet?.headers ?? []
  const normalizedHeaders = headers.map((header) => normalizeHeaderName(header)).filter(Boolean)
  const hasName = normalizedHeaders.some((header) =>
    NAME_ALIASES.map((alias) => normalizeHeaderName(alias)).some((alias) => header.includes(alias) || alias.includes(header))
  )
  const hasPrice = normalizedHeaders.some((header) =>
    PRICE_ALIASES.map((alias) => normalizeHeaderName(alias)).some((alias) => header.includes(alias) || alias.includes(header))
  )
  const hasStock = normalizedHeaders.some((header) =>
    STOCK_ALIASES.map((alias) => normalizeHeaderName(alias)).some((alias) => header.includes(alias) || alias.includes(header))
  )

  if (hasName && !hasPrice && !hasStock) return 'PRODUCT_MASTER' as const
  if (!hasPrice && hasStock) return 'STOCK_ONLY' as const
  return 'PRICE_WITH_OFFERS' as const
}

export function detectImportProfile(
  workbook: XLSX.WorkBook,
  supplierId?: string | null,
  providedProfile?: ImportProfileRules | Record<string, unknown> | null,
): ImportProfileRules {
  const explicitProfile = normalizeProfileRules(providedProfile)
  if (explicitProfile) {
    return {
      parserKind: 'generic',
      importKind: 'PRICE_WITH_OFFERS',
      ...explicitProfile,
    }
  }

  const structure = detectWorkbookStructure(workbook)

  if (isBelugaWorkbook(workbook)) {
    return { code: 'beluga', name: 'Beluga detected profile', parserKind: 'beluga', importKind: 'PRICE_WITH_OFFERS' }
  }

  if (isSimpleWorkbook(workbook)) {
    return { code: 'simple', name: 'Simple detected profile', parserKind: 'simple', importKind: 'PRICE_WITH_OFFERS' }
  }

  if (isRyatikoWorkbook(workbook)) {
    return { code: 'ryatiko', name: 'Ryatiko detected profile', parserKind: 'ryatiko', importKind: 'PRICE_WITH_OFFERS' }
  }

  const hasAstSheet = workbook.SheetNames.some((sheetName) => {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) return false
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null })
    return isAstPriceSheet(rows)
  })
  if (hasAstSheet) {
    return { code: 'ast', name: 'AST detected profile', parserKind: 'ast', importKind: 'PRICE_WITH_OFFERS' }
  }

  const firstSheetStructure = structure.sheets.find((sheet) => sheet.index === 0)
  const firstSheetHeaders = firstSheetStructure?.headers.join(' ').toLowerCase() ?? ''

  if (
    firstSheetHeaders.includes('код товара') &&
    firstSheetHeaders.includes('номенклатура') &&
    firstSheetHeaders.includes('цена')
  ) {
    return {
      code: 'ast-compact',
      name: 'AST compact detected profile',
      parserKind: 'generic',
      importKind: 'PRICE_WITH_OFFERS',
      sheets: { include: [workbook.SheetNames[0]], exclude: [] },
      header: { strategy: 'fixed', rowIndex: 1, dataStartRowIndex: 5 },
      columns: {
        article: 0,
        supplierSku: 1,
        name: 2,
        alcoholPercent: 4,
        volume: 5,
        price: 6,
        brand: 7,
        category: 8,
        stock: 13,
        barcode: 14,
      },
      contextRows: true,
    }
  }

  if (workbook.SheetNames.includes('Прайс 2025')) {
    return {
      code: 'fort',
      name: 'FORT detected profile',
      parserKind: 'generic',
      importKind: 'PRICE_WITH_OFFERS',
      sheets: { include: ['Прайс 2025'], exclude: [] },
      header: { strategy: 'fixed', rowIndex: 0, dataStartRowIndex: 1 },
      columns: {
        supplierSku: 1,
        category: null,
        name: 3,
        color: 4,
        sugar: 4,
        volume: 5,
        vintage: 6,
        alcoholPercent: 7,
        price: 8,
        grapeSorts: 9,
        barcode: 11,
        packQty: 12,
      },
      contextRows: true,
      mergeRows: { continuationRows: true, inheritContext: true },
    }
  }

  if (firstSheetHeaders.includes('прайс-лист базовый')) {
    return {
      code: 'vinoterra',
      name: 'Vinoterra detected profile',
      parserKind: 'generic',
      importKind: 'PRICE_WITH_OFFERS',
      sheets: { include: [workbook.SheetNames[0]], exclude: [] },
      header: { strategy: 'fixed', rowIndex: 2, dataStartRowIndex: 6 },
      columns: {
        article: 0,
        color: 12,
        vintage: 13,
        name: 14,
        producer: 15,
        volume: 16,
        country: 17,
        region: 18,
        sugar: 19,
        alcoholPercent: 20,
        price: 21,
        stock: 22,
      },
      contextRows: true,
    }
  }

  if (firstSheetHeaders.includes('основной розничный')) {
    return {
      code: 'retail-beer',
      name: 'Retail beer detected profile',
      parserKind: 'generic',
      importKind: 'PRICE_WITH_OFFERS',
      sheets: { include: [workbook.SheetNames[0]], exclude: [] },
      header: { strategy: 'fixed', rowIndex: 2, dataStartRowIndex: 6 },
      columns: {
        article: 0,
        category: 3,
        name: 13,
        packageSize: 14,
        price: 15,
        stock: 16,
      },
      contextRows: true,
    }
  }

  return {
    code: supplierId ? `supplier-${supplierId}-auto` : 'auto-generic',
    name: 'Auto detected generic profile',
    parserKind: 'generic',
    importKind: detectGenericImportKind(structure),
    sheets: {
      include: ['*'],
      exclude: [],
    },
    header: {
      strategy: 'auto',
    },
    columns: {},
    contextRows: true,
    mergeRows: {
      continuationRows: true,
      inheritContext: true,
    },
    rowClassification: {
      ignoreRepeatedHeaders: true,
      requireName: true,
      requirePrice: detectGenericImportKind(structure) === 'PRICE_WITH_OFFERS',
    },
  }
}

function getProfileColumnMatchers(profile: ImportProfileRules, field: string) {
  const explicitRule = profile.columns?.[field]
  if (profile.columns && Object.prototype.hasOwnProperty.call(profile.columns, field) && explicitRule === null) {
    return []
  }
  const explicitValues = Array.isArray(explicitRule)
    ? explicitRule
    : explicitRule !== null && explicitRule !== undefined
      ? [explicitRule]
      : []
  const aliases = CANONICAL_COLUMN_ALIASES[field] ?? []
  return [...explicitValues, ...aliases]
}

function resolveColumnIndex(headers: string[], profile: ImportProfileRules, field: string) {
  const matchers = getProfileColumnMatchers(profile, field)

  for (const matcher of matchers) {
    if (typeof matcher === 'number' && Number.isInteger(matcher) && matcher >= 0) {
      return matcher
    }
  }

  const normalizedHeaders = headers.map((header) => normalizeHeaderName(header))

  for (const matcher of matchers) {
    if (typeof matcher !== 'string') continue
    const normalizedMatcher = normalizeHeaderName(matcher)
    if (!normalizedMatcher) continue
    const index = normalizedHeaders.findIndex((header) =>
      Boolean(header) && (
        header === normalizedMatcher ||
        header.includes(normalizedMatcher) ||
        (header.length >= 3 && normalizedMatcher.includes(header))
      )
    )
    if (index >= 0) return index
  }

  return null
}

function getProfileCell(row: unknown[], columns: Record<string, number | null>, field: string) {
  const columnIndex = columns[field]
  return typeof columnIndex === 'number' ? row[columnIndex] : null
}

function getProfileString(row: unknown[], columns: Record<string, number | null>, field: string) {
  const columnIndex = columns[field]
  return typeof columnIndex === 'number' ? getCellString(row, columnIndex) : null
}

function splitStringList(value: string | null) {
  if (!value) return []
  return value
    .split(/[,;/]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function isRepeatedHeaderRow(row: unknown[], columns: Record<string, number | null>) {
  const nameCell = getProfileString(row, columns, 'name')
  const priceCell = getProfileString(row, columns, 'price')
  const nameHeader = nameCell ? normalizeHeaderName(nameCell) : ''
  const priceHeader = priceCell ? normalizeHeaderName(priceCell) : ''
  return Boolean(
    nameHeader &&
    NAME_ALIASES.some((alias) => normalizeHeaderName(alias) === nameHeader) &&
    (!priceHeader || PRICE_ALIASES.some((alias) => normalizeHeaderName(alias) === priceHeader))
  )
}

function isContextRow(row: unknown[], columns: Record<string, number | null>) {
  const filledCells = getFilledCells(row)
  if (filledCells.length !== 1) return false
  const hasPrice = parseNumber(getProfileCell(row, columns, 'price')) !== null
  const hasName = Boolean(getProfileString(row, columns, 'name'))
  return !hasPrice && hasName
}

function applyExplicitContextRow(
  row: unknown[],
  currentContext: { category: string | null; country: string | null; region: string | null; producer: string | null },
) {
  const marker = getCellString(row, 0)?.toLowerCase()
  const value = getCellString(row, 3) || getCellString(row, 2) || getCellString(row, 1)
  const hasPriceLikeValue = getFilledCells(row).some((cell) => {
    const parsed = parseNumber(cell)
    return parsed !== null && parsed > 0
  })

  if (!marker || !value || hasPriceLikeValue) return false

  if (marker.includes('категор') || marker.includes('тип')) {
    currentContext.category = normalizeAlcoholCategory(value, value)
    return true
  }

  if (marker.includes('страна')) {
    currentContext.country = value
    return true
  }

  if (marker.includes('регион')) {
    currentContext.region = value
    return true
  }

  if (marker.includes('производ')) {
    currentContext.producer = value
    return true
  }

  return false
}

function resolveDataStartRowIndex(sheetStructure: WorkbookSheetStructure | undefined, profile: ImportProfileRules) {
  if (typeof profile.header?.dataStartRowIndex === 'number') return profile.header.dataStartRowIndex
  if (typeof profile.header?.rowIndex === 'number') return profile.header.rowIndex + 1
  if (profile.header?.strategy === 'none') return 0
  return (sheetStructure?.headerRowIndex ?? 0) + 1
}

function resolveHeaderRow(sheetRows: unknown[][], sheetStructure: WorkbookSheetStructure | undefined, profile: ImportProfileRules) {
  if (typeof profile.header?.rowIndex === 'number') {
    return rowToHeaderStrings(sheetRows[profile.header.rowIndex] ?? [])
  }
  if (profile.header?.strategy === 'none') return []
  return sheetStructure?.headers?.length ? sheetStructure.headers : rowToHeaderStrings(sheetRows[0] ?? [])
}

function mapProfileRowToParsedPrice(params: {
  row: unknown[]
  rowNumber: number
  sheetName: string
  columns: Record<string, number | null>
  profile: ImportProfileRules
  currentContext: { category: string | null; country: string | null; region: string | null; producer: string | null }
}): ParsedPriceRow | null {
  const rawName = getProfileString(params.row, params.columns, 'name')
  const rawCategory =
    getProfileString(params.row, params.columns, 'category') ||
    params.currentContext.category
  const supplierSku = getProfileString(params.row, params.columns, 'supplierSku')
  const article =
    getProfileString(params.row, params.columns, 'article') ||
    getProfileString(params.row, params.columns, 'supplierArticle')
  const barcode = getProfileString(params.row, params.columns, 'barcode')
  const price = parseNumber(getProfileCell(params.row, params.columns, 'price'))
  const stock = parseNumber(getProfileCell(params.row, params.columns, 'stock'))
  const volumeMl =
    normalizeVolumeMl(parseNumber(getProfileCell(params.row, params.columns, 'volume'))) ??
    parseVolumeMlFromText(rawName)
  const currency = getProfileString(params.row, params.columns, 'currency') ?? 'RUB'
  const packageSize = parseNumber(getProfileCell(params.row, params.columns, 'packageSize'))
  const packQty = parseNumber(getProfileCell(params.row, params.columns, 'packQty')) ?? packageSize
  const minOrderQty = parseNumber(getProfileCell(params.row, params.columns, 'minOrderQty')) ?? packageSize
  const producer =
    getProfileString(params.row, params.columns, 'producer') ||
    getProfileString(params.row, params.columns, 'manufacturer') ||
    getProfileString(params.row, params.columns, 'brand') ||
    params.currentContext.producer
  const country = getProfileString(params.row, params.columns, 'country') || params.currentContext.country
  const region = getProfileString(params.row, params.columns, 'region') || params.currentContext.region
  const vintage = parseNumber(getProfileCell(params.row, params.columns, 'vintage'))
  const alcoholPercent = parseNumber(getProfileCell(params.row, params.columns, 'alcoholPercent'))
  const color = getProfileString(params.row, params.columns, 'color')
  const sugar = getProfileString(params.row, params.columns, 'sugar')
  const grapeSorts = splitStringList(getProfileString(params.row, params.columns, 'grapeSorts'))
  const publishOffers = params.profile.publishing?.publishOffers !== false && params.profile.importKind !== 'PRODUCT_MASTER'
  const requirePrice = params.profile.rowClassification?.requirePrice ?? publishOffers

  if (!rawName) return null
  if (requirePrice && price === null) return null

  const normalizedName = normalizeText(rawName)
  const normalizedCategory = normalizeText(rawCategory)
  const normalizedPayload = buildNormalizedPayload({
    price,
    currency,
    unit: volumeMl !== null ? 'bottle' : 'pcs',
    minOrderQty,
    packQty,
    stockAvailable: stock,
    volumeMl,
    packageSize,
  })

  return {
    rowNumber: params.rowNumber,
    rawName,
    normalizedName,
    rawCategory,
    normalizedCategory,
    supplierSku,
    barcode,
    article,
    price,
    currency,
    stock,
    deliveryDaysMin: null,
    deliveryDaysMax: null,
    volumeMl,
    rawPayload: {
      sheetName: params.sheetName,
      rowIndex: params.rowNumber,
      rowType: publishOffers ? 'PRODUCT_OFFER' : 'PRODUCT_MASTER',
      row: params.row,
    },
    normalizedPayload: {
      ...normalizedPayload,
      producer,
      manufacturer: producer,
      brand: producer,
      country,
      region,
      vintage,
      alcoholPercent,
      color,
      sugar,
      grapeSorts,
    },
  }
}

function shouldParseGenericSheet(params: {
  sheetName: string
  sheetStructure: WorkbookSheetStructure | undefined
  profile: ImportProfileRules
  columns: Record<string, number | null>
}) {
  if (!isAutoGenericProfile(params.profile)) {
    return true
  }

  if (isDefaultExcludedSheet(params.sheetName)) {
    return false
  }

  if (!params.sheetStructure || params.sheetStructure.rowCount <= 0) {
    return false
  }

  if (params.columns.name === null) {
    return false
  }

  const importKind = params.profile.importKind ?? 'PRICE_WITH_OFFERS'
  if (importKind === 'PRICE_WITH_OFFERS' && params.columns.price === null) {
    return false
  }

  if (importKind === 'STOCK_ONLY' && params.columns.stock === null) {
    return false
  }

  return true
}

function looksLikeHeaderlessPriceSheet(rows: unknown[][]) {
  const sampleRows = rows.slice(0, 300)
  let pricedNameRows = 0

  for (const row of sampleRows) {
    const name = getCellString(row, 0)
    const numericCells = row.slice(1, 6).filter((cell) => parseNumber(cell) !== null)
    if (name && numericCells.length > 0) {
      pricedNameRows += 1
    }
  }

  return pricedNameRows >= 5
}

function parseHeaderlessPriceSheet(params: {
  rows: unknown[][]
  sheetName: string
}) {
  const parsedRows: ParsedPriceRow[] = []
  let currentCategory: string | null = null
  let currentProducer: string | null = null

  params.rows.forEach((row, index) => {
    const rawName = getCellString(row, 0)
    if (!rawName) {
      return
    }

    const numericValues = row
      .slice(1, 6)
      .map((cell, offset) => ({ index: offset + 1, value: parseNumber(cell) }))
      .filter((item): item is { index: number; value: number } => item.value !== null)
    const priceCandidate = numericValues.length ? numericValues[numericValues.length - 1] : null
    const price = priceCandidate?.value ?? null

    if (price === null) {
      const category = normalizeAlcoholCategory(rawName, null)
      if (category) {
        currentCategory = category
        currentProducer = null
      } else if (currentCategory) {
        currentProducer = rawName
      }
      return
    }

    const stockCandidate = numericValues.find((item) => item.index !== priceCandidate?.index)
    const stock = stockCandidate?.value ?? null
    const volumeMl = parseVolumeMlFromText(rawName)
    const normalizedPayload = buildNormalizedPayload({
      price,
      currency: 'RUB',
      unit: volumeMl !== null ? 'bottle' : 'pcs',
      stockAvailable: stock,
      volumeMl,
    })

    parsedRows.push({
      rowNumber: index + 1,
      rawName,
      normalizedName: normalizeText(rawName),
      rawCategory: currentCategory,
      normalizedCategory: normalizeText(currentCategory),
      supplierSku: null,
      barcode: null,
      article: null,
      price,
      currency: 'RUB',
      stock,
      deliveryDaysMin: null,
      deliveryDaysMax: null,
      volumeMl,
      rawPayload: {
        sheetName: params.sheetName,
        rowIndex: index + 1,
        row,
        parserFallback: 'headerless-price-sheet',
      },
      normalizedPayload: {
        ...normalizedPayload,
        producer: currentProducer,
        manufacturer: currentProducer,
        brand: currentProducer,
      },
    })
  })

  return parsedRows
}

function parseGenericWorkbookWithProfile(
  workbook: XLSX.WorkBook,
  profile: ImportProfileRules,
  structure: WorkbookStructure,
) {
  const parsedRows: ParsedPriceRow[] = []

  for (const sheetName of workbook.SheetNames) {
    if (!shouldReadSheet(sheetName, profile)) continue

    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })
    const sheetStructure = structure.sheets.find((item) => item.name === sheetName)
    const headers = resolveHeaderRow(rows, sheetStructure, profile)
    const dataStartRowIndex = resolveDataStartRowIndex(sheetStructure, profile)
    const columns: Record<string, number | null> = {}

    for (const field of Object.keys(CANONICAL_COLUMN_ALIASES)) {
      columns[field] = resolveColumnIndex(headers, profile, field)
    }

    if (!shouldParseGenericSheet({ sheetName, sheetStructure, profile, columns })) {
      if (isAutoGenericProfile(profile) && looksLikeHeaderlessPriceSheet(rows)) {
        parsedRows.push(...parseHeaderlessPriceSheet({ rows, sheetName }))
      }
      continue
    }

    let previousParsedRow: ParsedPriceRow | null = null
    const currentContext = {
      category: null as string | null,
      country: null as string | null,
      region: null as string | null,
      producer: null as string | null,
    }

    rows.slice(dataStartRowIndex).forEach((row, offset) => {
      const rowNumber = dataStartRowIndex + offset + 1
      const filledCells = getFilledCells(row)
      if (filledCells.length < (profile.rowClassification?.minFilledCells ?? 1)) return

      if (profile.rowClassification?.ignoreRepeatedHeaders !== false && isRepeatedHeaderRow(row, columns)) return

      if (profile.contextRows && applyExplicitContextRow(row, currentContext)) {
        return
      }

      if (profile.contextRows && isContextRow(row, columns)) {
        const contextValue = getProfileString(row, columns, 'name')
        if (contextValue) {
          currentContext.category = normalizeAlcoholCategory(contextValue, contextValue)
        }
        return
      }

      const parsedRow = mapProfileRowToParsedPrice({
        row,
        rowNumber,
        sheetName,
        columns,
        profile,
        currentContext,
      })

      if (!parsedRow) {
        if (
          profile.mergeRows?.continuationRows &&
          previousParsedRow &&
          filledCells.length > 0
        ) {
          previousParsedRow.rawPayload = {
            ...previousParsedRow.rawPayload,
            continuationRows: [
              ...(
                Array.isArray(previousParsedRow.rawPayload.continuationRows)
                  ? previousParsedRow.rawPayload.continuationRows
                  : []
              ),
              { sheetName, rowIndex: rowNumber, row },
            ],
          }
        }
        return
      }

      parsedRows.push(parsedRow)
      previousParsedRow = parsedRow
    })
  }

  return parsedRows
}

export function applyImportProfile(
  workbook: XLSX.WorkBook,
  profile: ImportProfileRules,
  structure: WorkbookStructure = detectWorkbookStructure(workbook),
): ParsedPriceRow[] {
  switch (profile.parserKind) {
    case 'normalized':
      return parseNormalizedAdminWorkbook(workbook)
    case 'beluga':
      return parseBelugaWorkbook(workbook)
    case 'simple':
      return parseSimpleWorkbook(workbook)
    case 'ryatiko':
      return parseRyatikoWorkbook(workbook)
    case 'ast':
      return parseAstWorkbook(workbook)
    case 'generic':
    default:
      return parseGenericWorkbookWithProfile(workbook, profile, structure)
  }
}

export async function normalizeParsedRows(rows: ParsedPriceRow[]): Promise<ParsedPriceRow[]> {
  return Promise.all(rows.map(async (row) => {
    const nameParts = await decomposeName(row.rawName)
    const payload = row.normalizedPayload ?? {}
    const sourcePayload = payloadObject(payload.source)
    const identityPayload = payloadObject(payload.identity)
    const productPayload = payloadObject(payload.product)
    const variantPayload = payloadObject(payload.variant)
    const offerPayload = payloadObject(payload.offer)
    const mappingPayload = payloadObject(payload.mapping)
    const rawPayload = row.rawPayload ?? {}
    const sheetName = typeof rawPayload.sheetName === 'string' ? rawPayload.sheetName : null
    const rowIndex = typeof rawPayload.rowIndex === 'number' ? rawPayload.rowIndex : row.rowNumber
    const flatVolumeMl = typeof payload.volumeMl === 'number' ? payload.volumeMl : row.volumeMl
    const flatPackageSize = typeof payload.packageSize === 'number' ? payload.packageSize : null
    const flatPackQty = typeof payload.packQty === 'number' ? payload.packQty : null
    const flatPrice = typeof payload.price === 'number' ? payload.price : row.price
    const flatCurrency = typeof payload.currency === 'string' ? payload.currency : row.currency
    const flatStock = typeof payload.stockAvailable === 'number' ? payload.stockAvailable : row.stock
    const flatUnit = typeof payload.unit === 'string' && payload.unit.trim() ? payload.unit.trim() : null
    const productVolumeMl =
      payloadNumber(productPayload, 'volumeMl') ??
      flatVolumeMl ??
      nameParts?.volumeMl ??
      null
    const variantVolumeMl =
      payloadNumber(variantPayload, 'volumeMl') ??
      flatVolumeMl ??
      nameParts?.volumeMl ??
      null
    const productAlcoholPercent =
      payloadNumber(productPayload, 'alcoholPercent') ??
      nameParts?.alcoholPercent ??
      null
    const productVintage =
      payloadNumber(productPayload, 'vintage') ??
      nameParts?.vintage ??
      null
    const productFeatures = payloadStringList(productPayload, 'features')
    const categoryAttrs = nameParts?.categoryAttrs ?? {}
    const productGrapeSorts = payloadStringList(productPayload, 'grapeSorts')
    const categoryGrapeSorts = payloadRecordStringList(categoryAttrs, 'grapeSorts')
    const categoryConfidence =
      payloadNumber(productPayload, 'categoryConfidence') ??
      payloadNumber(mappingPayload, 'categoryConfidence') ??
      nameParts?.categoryConfidence ??
      null
    const categoryFromName = nameParts?.categoryPath?.length
      ? nameParts.categoryPath.join(' / ')
      : null
    const existingProductCategoryRaw = payloadString(productPayload, 'categoryRaw')
    const existingProductCountry =
      payloadString(productPayload, 'country') ??
      payloadString(payload, 'country')
    const existingProductRegion =
      payloadString(productPayload, 'region') ??
      payloadString(payload, 'region')
    const existingProductBrand =
      payloadString(productPayload, 'brand') ??
      payloadString(payload, 'brand')
    const existingProductProducer =
      payloadString(productPayload, 'producer') ??
      payloadString(payload, 'producer')
    const existingProductManufacturer =
      payloadString(productPayload, 'manufacturer') ??
      payloadString(payload, 'manufacturer')
    const geoCountry = nameParts?.country ?? null
    const geoRegion = nameParts?.region ?? null
    const resolvedCountry = existingProductCountry ?? geoCountry
    const resolvedNames = resolvePriceImportProductNames({
      ...payload,
      product: {
        ...productPayload,
        country: resolvedCountry,
        nameParts,
      },
    }, {
      rawName: row.rawName,
      normalizedName: row.normalizedName,
    })
    const nameBrand = nameParts?.brand ?? null
    const nameProducer = nameParts?.producer ?? null
    const hasGeoCountryConflict = Boolean(
      existingProductCountry &&
      geoCountry &&
      normalizeText(existingProductCountry) !== normalizeText(geoCountry),
    )
    const shouldUseNameCategory = !row.rawCategory && !existingProductCategoryRaw && Boolean(categoryFromName)
    const categoryFromNameSource = shouldUseNameCategory ? 'HEURISTIC' : null
    const categoryReason = shouldUseNameCategory ? 'name-derived category signal' : null
    const hasSuggestedCategorySignal = Boolean(
      nameParts?.categorySignals?.some((signal) => (
        signal.source === 'CATEGORY_KEYWORD' ||
        signal.source === 'GEO_MARKER'
      )),
    )
    const normalizedName = normalizeText(nameParts?.ruName ?? null) ?? row.normalizedName
    const mappingIssues = new Set(payloadStringList(mappingPayload, 'issues'))

    if (hasCategoryMismatch(row.rawCategory, nameParts?.categoryPath ?? null)) {
      mappingIssues.add('NAME_CATEGORY_MISMATCH')
      if (hasSuggestedCategorySignal) {
        mappingIssues.add('CATEGORY_SUGGESTION_CONFLICT')
      }
    }

    if (hasGeoCountryConflict) {
      mappingIssues.add('COUNTRY_CONFLICT')
    }

    if (nameParts?.geoAmbiguous) {
      mappingIssues.add('GEO_AMBIGUOUS')
    }

    if (
      flatVolumeMl !== null &&
      nameParts?.volumeMl !== null &&
      nameParts?.volumeMl !== undefined &&
      flatVolumeMl !== nameParts.volumeMl
    ) {
      mappingIssues.add('VOLUME_CONFLICT')
    }

    const columnVintage = payloadNumber(productPayload, 'vintage')
    if (
      columnVintage !== null &&
      nameParts?.vintage !== null &&
      nameParts?.vintage !== undefined &&
      Math.round(columnVintage) !== nameParts.vintage
    ) {
      mappingIssues.add('VINTAGE_CONFLICT')
    }

    return {
      ...row,
      normalizedName,
      volumeMl: variantVolumeMl,
      normalizedPayload: {
        ...payload,
        source: {
          sheetName,
          rowIndex,
          ...sourcePayload,
        },
        identity: {
          ...identityPayload,
          supplierSku: row.supplierSku,
          article: row.article,
          barcode: row.barcode,
          eanList: [],
          normalizedName,
        },
        product: {
          ...productPayload,
          name: resolvedNames.canonicalName ?? nameParts?.enName ?? nameParts?.ruName ?? row.rawName,
          canonicalName: resolvedNames.canonicalName,
          russianName: resolvedNames.russianName,
          displayName: resolvedNames.displayName,
          originalName: row.rawName,
          translatedName: resolvedNames.translatedName,
          categoryRaw: row.rawCategory ?? existingProductCategoryRaw ?? categoryFromName,
          categorySource: payloadString(productPayload, 'categorySource') ?? categoryFromNameSource,
          categoryConfidence,
          categoryReason: payloadString(productPayload, 'categoryReason') ?? categoryReason,
          volumeMl: productVolumeMl,
          alcoholPercent: productAlcoholPercent,
          alcoholPercentMax: payloadNumber(productPayload, 'alcoholPercentMax') ?? nameParts?.alcoholPercentMax ?? null,
          vintage: productVintage,
          brand: existingProductBrand ?? nameBrand,
          producer: existingProductProducer ?? nameProducer,
          manufacturer: existingProductManufacturer ?? existingProductProducer ?? nameProducer,
          country: resolvedCountry,
          region: existingProductRegion ?? (!hasGeoCountryConflict ? geoRegion : null),
          color: payloadString(productPayload, 'color') ?? payloadString(categoryAttrs, 'color'),
          sugar: payloadString(productPayload, 'sugar') ?? payloadString(categoryAttrs, 'sugar'),
          grapeSorts: productGrapeSorts.length ? productGrapeSorts : categoryGrapeSorts,
          features: productFeatures.length ? productFeatures : nameParts?.features ?? [],
          nameParts,
        },
        variant: {
          ...variantPayload,
          volumeMl: variantVolumeMl,
          volumeUnit: variantVolumeMl !== null ? 'ml' : null,
          packageSize: flatPackageSize,
          packageSizeUnit: flatPackageSize !== null ? 'pcs' : null,
          unit: flatUnit ?? (variantVolumeMl !== null ? 'bottle' : 'pcs'),
          packQty: flatPackQty,
        },
        offer: {
          ...offerPayload,
          price: flatPrice,
          currency: flatCurrency ?? 'RUB',
          stockAvailable: flatStock,
          stockTotal: flatStock,
          deliveryDaysMin: row.deliveryDaysMin,
          deliveryDaysMax: row.deliveryDaysMax,
          availability: flatStock === 0 ? 'SOLD_OUT' : flatStock === null && flatPrice !== null ? 'ORDERABLE' : flatPrice !== null ? 'ACTIVE' : null,
          minOrderQty: typeof payload.minOrderQty === 'number' ? payload.minOrderQty : null,
          packQty: flatPackQty,
        },
        mapping: {
          ...mappingPayload,
          status: 'PARSED',
          confidence: null,
          categorySource: payloadString(mappingPayload, 'categorySource') ?? categoryFromNameSource,
          categoryConfidence,
          categoryReason: payloadString(mappingPayload, 'categoryReason') ?? categoryReason,
          issues: Array.from(mappingIssues),
        },
      },
    }
  }))
}

export function detectImportProfileFromFile(
  filePath: string,
  sourceFormat: PriceImportSourceFormat,
  options: ParseRowsFromFileOptions = {},
): DetectedImportProfileResult {
  const extension = path.extname(filePath).toLowerCase()

  if (sourceFormat === PriceImportSourceFormat.CSV || extension === '.csv') {
    return {
      profile: {
        code: 'csv-generic',
        name: 'CSV generic profile',
        parserKind: 'generic',
        importKind: 'PRICE_WITH_OFFERS',
        header: { strategy: 'auto' },
      },
      structure: null,
    }
  }

  if (sourceFormat === PriceImportSourceFormat.XML || extension === '.xml') {
    return {
      profile: {
        code: 'xml-generic',
        name: 'XML generic profile',
        parserKind: 'generic',
        importKind: 'PRICE_WITH_OFFERS',
        header: { strategy: 'auto' },
      },
      structure: null,
    }
  }

  const workbook = XLSX.readFile(filePath)
  const structure = detectWorkbookStructure(workbook)
  const profile = detectImportProfile(workbook, options.supplierId, options.profile)

  return { profile, structure }
}

function parseCsvContent(content: string): Record<string, unknown>[] {
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentValue = ''
  let inQuotes = false

  const pushValue = () => {
    currentRow.push(currentValue)
    currentValue = ''
  }

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]

    if (char === '"') {
      if (inQuotes && content[index + 1] === '"') {
        currentValue += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      pushValue()
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && content[index + 1] === '\n') {
        index += 1
      }

      pushValue()
      if (currentRow.some((value) => value.length > 0)) {
        rows.push(currentRow)
      }
      currentRow = []
      continue
    }

    currentValue += char
  }

  if (currentValue.length > 0 || currentRow.length > 0) {
    pushValue()
    if (currentRow.some((value) => value.length > 0)) {
      rows.push(currentRow)
    }
  }

  if (rows.length === 0) {
    return []
  }

  const [headerRow, ...dataRows] = rows
  const headers = headerRow.map((header) => header.trim())

  return dataRows.map((rowValues) => {
    const normalizedRow: Record<string, unknown> = {}

    headers.forEach((header, index) => {
      normalizedRow[header] = rowValues[index] ?? null
    })

    return normalizedRow
  })
}

function parseCsvRows(filePath: string): ParsedPriceRow[] {
  const content = fs.readFileSync(filePath, 'utf8')
  const rawRows = parseCsvContent(content)

  return rawRows.map((row, index) => mapRowToParsedPrice(row, index + 1))
}

function parseXmlRows(filePath: string): ParsedPriceRow[] {
  const content = fs.readFileSync(filePath, 'utf8')
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/gi
  const matchedRows = Array.from(content.matchAll(rowRegex), (match) => match[1])

  return matchedRows.map((rowContent, index) => {
    const cellRegex = /<([a-zA-Z0-9_а-яА-Я-]+)\b[^>]*>([\s\S]*?)<\/\1>/g
    const rowObject: Record<string, unknown> = {}

    for (const cellMatch of rowContent.matchAll(cellRegex)) {
      const [, tagName, value] = cellMatch
      rowObject[tagName] = value.replace(/<[^>]+>/g, '').trim()
    }

    return mapRowToParsedPrice(rowObject, index + 1)
  })
}

function mapRowToParsedPrice(row: Record<string, unknown>, rowNumber: number): ParsedPriceRow {
  const rawName = getRowString(row, NAME_ALIASES)
  const normalizedName = normalizeText(rawName)
  const rawCategory = getRowString(row, CATEGORY_ALIASES)
  const normalizedCategory = normalizeText(rawCategory)
  const supplierSku = getRowString(row, SKU_ALIASES)
  const barcode = getRowString(row, BARCODE_ALIASES)
  const article = getRowString(row, ARTICLE_ALIASES)
  const price = parseNumber(getRowValue(row, PRICE_ALIASES))
  const stock = parseNumber(getRowValue(row, STOCK_ALIASES))
  const deliveryDaysMin = parseDeliveryDays(getRowValue(row, ['deliverydaysmin', 'deliverydays', 'srokdostavki']))
  const deliveryDaysMax = parseDeliveryDays(getRowValue(row, ['deliverydaysmax']))
  const volumeMl = parseNumber(getRowValue(row, VOLUME_ALIASES))
  const volumeUnit = getRowString(row, VOLUME_UNIT_ALIASES)
  const unit = getRowString(row, UNIT_ALIASES)
  const minOrderQty = parseNumber(getRowValue(row, MIN_ORDER_ALIASES))
  const packQty = parseNumber(getRowValue(row, PACK_QTY_ALIASES))
  const packageSize = parseNumber(getRowValue(row, PACKAGE_SIZE_ALIASES)) ?? packQty
  const packageSizeUnit = getRowString(row, PACKAGE_SIZE_UNIT_ALIASES) ?? unit
  const currency = getRowString(row, ['currency', 'валюта', 'currencycode'])

  const normalizedPayload = {
    price,
    currency,
    unit,
    minOrderQty,
    packQty,
    stockAvailable: stock,
    deliveryDaysMin,
    deliveryDaysMax,
    volumeMl,
    volumeUnit,
    packageSize,
    packageSizeUnit,
  }

  return {
    rowNumber,
    rawName,
    normalizedName,
    rawCategory,
    normalizedCategory,
    supplierSku,
    barcode,
    article,
    price,
    currency,
    stock,
    deliveryDaysMin,
    deliveryDaysMax,
    volumeMl,
    rawPayload: row,
    normalizedPayload,
  }
}

function isAstPriceSheet(rows: Record<string, unknown>[]) {
  return rows.some((row) =>
    Object.prototype.hasOwnProperty.call(row, 'Номенклатура текущий проект') &&
    Object.prototype.hasOwnProperty.call(row, '__EMPTY_1') &&
    Object.prototype.hasOwnProperty.call(row, 'В2В') &&
    Object.prototype.hasOwnProperty.call(row, 'Варшавка')
  )
}

function parseAstPriceRows(rows: Record<string, unknown>[], sheetName: string | null = null): ParsedPriceRow[] {
  return rows.flatMap((row, index) => {
    const rawName = getRowString(row, ['__EMPTY_1'])
    const supplierSku = getRowString(row, ['Номенклатура текущий проект'])
    const article = getRowString(row, ['__EMPTY'])
    const price = parseNumber(row['В2В'])

    if (!rawName || !supplierSku || price === null) {
      return []
    }

    const rawCategory =
      getRowString(row, ['__EMPTY_12']) ||
      getRowString(row, ['__EMPTY_11']) ||
      getRowString(row, ['__EMPTY_27'])
    const normalizedName = normalizeText(rawName)
    const normalizedCategory = normalizeText(rawCategory)
    const stocks = [
      parseNumber(row['Варшавка']),
      parseNumber(row['АСТ (Внуково)']),
      parseNumber(row['Склад БИГ (Внуково)']),
    ].filter((value): value is number => value !== null)
    const stock = stocks.length ? stocks.reduce((total, value) => total + value, 0) : null
    const volumeMl = normalizeVolumeMl(parseNumber(row['__EMPTY_14']))
    const packageSize = parsePackageQuantity(row['__EMPTY_28'])
    const unit = volumeMl !== null ? 'bottle' : 'pcs'

    const normalizedPayload = {
      price,
      currency: 'RUB',
      unit,
      minOrderQty: packageSize,
      packQty: packageSize,
      stockAvailable: stock,
      deliveryDaysMin: null,
      deliveryDaysMax: null,
      volumeMl,
      volumeUnit: volumeMl !== null ? 'ml' : null,
      packageSize,
      packageSizeUnit: packageSize !== null ? 'pcs' : null,
    }

    return [{
      rowNumber: index + 1,
      rawName,
      normalizedName,
      rawCategory,
      normalizedCategory,
      supplierSku,
      barcode: null,
      article,
      price,
      currency: 'RUB',
      stock,
      deliveryDaysMin: null,
      deliveryDaysMax: null,
      volumeMl,
      rawPayload: sheetName ? { sheetName, rowIndex: index + 1, row } : row,
      normalizedPayload,
    }]
  })
}

function parseAstWorkbook(workbook: XLSX.WorkBook): ParsedPriceRow[] {
  const parsedRows: ParsedPriceRow[] = []

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null })
    if (!isAstPriceSheet(rows)) continue

    parsedRows.push(...parseAstPriceRows(rows, sheetName))
  }

  return parsedRows
}

function isBelugaWorkbook(workbook: XLSX.WorkBook) {
  return workbook.SheetNames.includes('Крепкий алкоголь') && workbook.SheetNames.includes('ВИНО')
}

function parseBelugaWorkbook(workbook: XLSX.WorkBook): ParsedPriceRow[] {
  const parsedRows: ParsedPriceRow[] = []

  for (const sheetName of ['Крепкий алкоголь', 'ВИНО']) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })
    let currentCategory = normalizeAlcoholCategory(sheetName, sheetName === 'ВИНО' ? 'Вино' : 'Крепкий алкоголь')

    rows.forEach((row, index) => {
      const heading = getCellString(row, 0)
      const basePrice = parseNumber(row[5])
      const discountPrice = parseNumber(row[6])
      const price = discountPrice && discountPrice > 0 ? discountPrice : basePrice
      const volumeSource = sheetName === 'ВИНО' ? parseNumber(row[4]) : parseNumber(row[3])
      const volumeMl = normalizeVolumeMl(volumeSource)
      const packageSize = sheetName === 'ВИНО' ? null : parseNumber(row[4])

      if (isProbablyHeadingRow(row) && heading) {
        const category = normalizeAlcoholCategory(heading, null)
        if (category) currentCategory = category
      }

      if (!heading || price === null || volumeMl === null) {
        return
      }

      const rawName = normalizeMultilineName(heading)
      const rawCategory = sheetName === 'ВИНО'
        ? normalizeAlcoholCategory(heading, currentCategory)
        : currentCategory
      const normalizedPayload = buildNormalizedPayload({
        price,
        volumeMl,
        packageSize,
      })

      parsedRows.push({
        rowNumber: index + 1,
        rawName,
        normalizedName: normalizeText(rawName),
        rawCategory,
        normalizedCategory: normalizeText(rawCategory),
        supplierSku: null,
        barcode: null,
        article: null,
        price,
        currency: 'RUB',
        stock: null,
        deliveryDaysMin: null,
        deliveryDaysMax: null,
        volumeMl,
        rawPayload: { sheetName, rowIndex: index + 1, row },
        normalizedPayload,
      })
    })
  }

  return parsedRows
}

function isSimpleWorkbook(workbook: XLSX.WorkBook) {
  return workbook.SheetNames.includes('Оглавление') && workbook.SheetNames.includes('Крепкий алкоголь')
}

function getSimpleSheetCategory(sheetName: string, heading: string | null) {
  if (sheetName.includes('Шампан')) return 'Шампанское'
  if (sheetName.includes('Игрист')) return 'Игристое'

  const category = normalizeAlcoholCategory(heading, null)
  if (category) return category

  if (sheetName.includes('Водка')) return 'Водка'
  if (sheetName.includes('Крепкий')) return 'Крепкий алкоголь'
  if (sheetName.includes('Порто')) return 'Портвейн'
  if (sheetName.includes('Херес')) return 'Херес'
  if (sheetName.includes('Безалкогольные вина')) return 'Безалкогольное вино'
  if (sheetName.includes('Специалитеты')) return 'Специалитеты'

  return 'Вино'
}

function parseSimpleWorkbook(workbook: XLSX.WorkBook): ParsedPriceRow[] {
  const skippedSheets = new Set(['Тит_лист', 'Оглавление'])
  const parsedRows: ParsedPriceRow[] = []

  for (const sheetName of workbook.SheetNames) {
    if (skippedSheets.has(sheetName)) continue

    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })
    let currentHeading: string | null = null
    let previousName: string | null = null

    rows.forEach((row, index) => {
      const firstCell = getCellString(row, 0)
      const price = parseNumber(row[3])
      const volumeMl = normalizeVolumeMl(parseNumber(row[2]))
      const article = getCellString(row, 8)

      if (isProbablyHeadingRow(row) && firstCell) {
        currentHeading = firstCell
      }

      if (firstCell && price !== null) {
        previousName = normalizeMultilineName(firstCell)
      }

      const rawName = firstCell && price !== null
        ? normalizeMultilineName(firstCell)
        : price !== null && previousName
          ? previousName
          : null

      if (!rawName || price === null || volumeMl === null) {
        return
      }

      const rawCategory = getSimpleSheetCategory(sheetName, currentHeading)
      const normalizedPayload = buildNormalizedPayload({
        price,
        volumeMl,
      })

      parsedRows.push({
        rowNumber: index + 1,
        rawName,
        normalizedName: normalizeText(rawName),
        rawCategory,
        normalizedCategory: normalizeText(rawCategory),
        supplierSku: article,
        barcode: null,
        article,
        price,
        currency: 'RUB',
        stock: null,
        deliveryDaysMin: null,
        deliveryDaysMax: null,
        volumeMl,
        rawPayload: { sheetName, rowIndex: index + 1, row },
        normalizedPayload,
      })
    })
  }

  return parsedRows
}

function isRyatikoWorkbook(workbook: XLSX.WorkBook) {
  return workbook.SheetNames.includes('Прайс алкоголь') && workbook.SheetNames.includes('Hirooka Farm')
}

function parseRyatikoWorkbook(workbook: XLSX.WorkBook): ParsedPriceRow[] {
  const sheet = workbook.Sheets['Прайс алкоголь']
  if (!sheet) return []

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })
  const parsedRows: ParsedPriceRow[] = []
  let currentCategory: string | null = 'Алкоголь'

  rows.forEach((row, index) => {
    const rawNameCell = getCellString(row, 1)
    const region = getCellString(row, 2)
    const price = parseNumber(row[4])

    if (isProbablyHeadingRow(row) && rawNameCell) {
      currentCategory = normalizeAlcoholCategory(rawNameCell, rawNameCell)
    }

    if (!rawNameCell || price === null) {
      return
    }

    const rawName = normalizeMultilineName(rawNameCell)
    const volumeMl = parseVolumeMlFromText(rawName)
    const rawCategory = normalizeAlcoholCategory(rawName, currentCategory)
    const normalizedPayload = buildNormalizedPayload({
      price,
      volumeMl,
    })

    parsedRows.push({
      rowNumber: index + 1,
      rawName,
      normalizedName: normalizeText(rawName),
      rawCategory,
      normalizedCategory: normalizeText(rawCategory),
      supplierSku: null,
      barcode: null,
      article: null,
      price,
      currency: 'RUB',
      stock: null,
      deliveryDaysMin: null,
      deliveryDaysMax: null,
      volumeMl,
      rawPayload: { sheetName: 'Прайс алкоголь', rowIndex: index + 1, region, row },
      normalizedPayload,
    })
  })

  return parsedRows
}

export async function parseRowsFromFile(
  filePath: string,
  sourceFormat: PriceImportSourceFormat,
  options: ParseRowsFromFileOptions = {},
): Promise<ParsedPriceRow[]> {
  const extension = path.extname(filePath).toLowerCase()

  if (sourceFormat === PriceImportSourceFormat.CSV || extension === '.csv') {
    return normalizeParsedRows(parseCsvRows(filePath))
  }

  if (sourceFormat === PriceImportSourceFormat.XML || extension === '.xml') {
    return normalizeParsedRows(parseXmlRows(filePath))
  }

  const workbook = XLSX.readFile(filePath)
  if (!workbook.SheetNames[0]) {
    throw new Error('Excel file has no sheets')
  }

  const detected = detectImportProfile(workbook, options.supplierId, options.profile)
  const structure = detectWorkbookStructure(workbook)
  const profile = detected
  return normalizeParsedRows(applyImportProfile(workbook, profile, structure))
}
