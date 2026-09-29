import type {
  ApiSuccessEnvelope,
  OffsetLimitPaginationMeta,
  OffsetLimitPaginationQuery,
} from '../../lib/api-contract'

export const PRICE_IMPORT_STATUSES = [
  'UPLOADED',
  'QUEUED',
  'PROCESSING',
  'PARSED',
  'HAS_ISSUES',
  'READY_TO_PUBLISH',
  'PUBLISHED',
  'PARTIALLY_PUBLISHED',
  'FAILED',
  'CANCELLED',
] as const

export type PriceImportStatusDto = (typeof PRICE_IMPORT_STATUSES)[number]

export const PRICE_IMPORT_KINDS = [
  'PRICE_WITH_OFFERS',
  'PRODUCT_MASTER',
  'STOCK_ONLY',
  'IMAGE_PACKAGE',
] as const

export type PriceImportKindDto = (typeof PRICE_IMPORT_KINDS)[number]

export const PRICE_IMPORT_SOURCE_FORMATS = [
  'XLSX',
  'CSV',
  'XML',
  'API',
] as const

export type PriceImportSourceFormatDto =
  (typeof PRICE_IMPORT_SOURCE_FORMATS)[number]

export const PRICE_IMPORT_ROW_STATUSES = [
  'IGNORED',
  'PARSED',
  'MATCHED',
  'LOW_CONFIDENCE',
  'CANDIDATE',
  'UNMATCHED',
  'MANUAL_MATCHED',
  'FAILED',
] as const

export type PriceImportRowStatusDto = (typeof PRICE_IMPORT_ROW_STATUSES)[number]

export const CATALOG_IMPORT_ROW_VALIDATION_STATUSES = [
  'RAW',
  'NORMALIZED',
  'MATCHED',
  'VALIDATED',
  'NEEDS_REVIEW',
  'EDITED',
  'REVALIDATED',
  'CONFLICT',
  'APPROVED',
  'READY_TO_PUBLISH',
  'PUBLISHED',
  'IGNORED',
  'FAILED',
] as const

export type CatalogImportRowValidationStatusDto =
  (typeof CATALOG_IMPORT_ROW_VALIDATION_STATUSES)[number]

export const PRICE_IMPORT_ISSUE_SEVERITIES = [
  'INFO',
  'WARNING',
  'ERROR',
  'CRITICAL',
] as const

export type PriceImportIssueSeverityDto =
  (typeof PRICE_IMPORT_ISSUE_SEVERITIES)[number]

export const PRICE_IMPORT_ISSUE_STATUSES = [
  'OPEN',
  'RESOLVED',
  'IGNORED',
] as const

export type PriceImportIssueStatusDto =
  (typeof PRICE_IMPORT_ISSUE_STATUSES)[number]

export const CATALOG_CATEGORY_MATCH_SOURCES = [
  'EXACT_SUPPLIER_MAPPING',
  'GLOBAL_MAPPING',
  'HEURISTIC',
  'UNRESOLVED',
] as const

export type CatalogCategoryMatchSourceDto =
  (typeof CATALOG_CATEGORY_MATCH_SOURCES)[number]

export type CatalogCategorySignalDto = {
  source: 'CATEGORY_PREFIX' | 'CATEGORY_KEYWORD' | 'GEO_MARKER'
  pattern: string
  categoryPath: string[]
  weight: number
  attrs: Record<string, unknown>
}

export type PriceImportFileDto = {
  id: string
  fileName: string
  mimeType: string
  fileSize: number
}

export type SupplierPriceImportDetectedProfileDto = {
  profileId?: string | null
  code?: string | null
  name?: string | null
  version?: number | null
  confidence?: number | null
  reason?: string | null
  sheetNames?: string[]
  headerRowIndex?: number | null
  warnings?: string[]
  [key: string]: unknown
}

export type SupplierPriceImportMappingConfigDto = {
  sheetNames?: string[]
  headerRowIndex?: number | null
  dataStartRowIndex?: number | null
  columns?: Record<string, string | number | null>
  rowRules?: Record<string, unknown>
  categoryRules?: Record<string, unknown>
  [key: string]: unknown
}

export type SupplierPriceImportProfileSnapshotDto = {
  id?: string | null
  code?: string | null
  name?: string | null
  version?: number | null
  sourceFormat?: PriceImportSourceFormatDto | null
  rulesJson?: unknown
  [key: string]: unknown
}

export type SupplierPriceImportDto = {
  id: string
  supplierId: string
  profileId: string | null
  file: PriceImportFileDto | null
  sourceFormat: PriceImportSourceFormatDto
  importKind: PriceImportKindDto
  status: PriceImportStatusDto
  parserVersion: string | null
  detectedProfile: SupplierPriceImportDetectedProfileDto | null
  mappingConfig: SupplierPriceImportMappingConfigDto | null
  profileSnapshot: SupplierPriceImportProfileSnapshotDto | null
  rowsCount: number
  parsedRows: number
  matchedRows: number
  failedRows: number
  issuesCount: number
  criticalIssuesCount: number
  errorText: string | null
  uploadedAt: string
  updatedAt: string
  publishedAt: string | null
}

export type SupplierPriceImportListQueryDto = OffsetLimitPaginationQuery & {
  supplierId?: string
  status?: PriceImportStatusDto[]
}

export type SupplierPriceImportListResponseDto = ApiSuccessEnvelope<
  { items: SupplierPriceImportDto[] },
  OffsetLimitPaginationMeta
>

export type SupplierPriceImportPreviewMetaDto = OffsetLimitPaginationMeta & {
  matchedRows: number
  failedRows: number
  issuesCount: number
}

export type SupplierPriceImportPreviewResponseDto = ApiSuccessEnvelope<
  {
    import: SupplierPriceImportDto
    rows: SupplierPriceImportPreviewRowDto[]
    issues: SupplierPriceImportIssueDto[]
  },
  SupplierPriceImportPreviewMetaDto
>

export type UploadSupplierPriceImportRequestDto = {
  supplierId: string
  profileId?: string | null
  importKind?: PriceImportKindDto | null
  mappingConfig?: SupplierPriceImportMappingConfigDto | null
  priceDate?: string | null
}

export type SupplierPriceImportNormalizedPayloadDto = {
  source?: {
    sheetName?: string | null
    rowIndex?: number | null
    supplierId?: string | null
    importId?: string | null
    fileName?: string | null
    [key: string]: unknown
  }
  identity?: {
    supplierSku?: string | null
    article?: string | null
    barcode?: string | null
    eanList?: string[]
    normalizedName?: string | null
    identityKey?: string | null
    [key: string]: unknown
  }
  product?: {
    name?: string | null
    canonicalName?: string | null
    russianName?: string | null
    displayName?: string | null
    originalName?: string | null
    translatedName?: string | null
    brand?: string | null
    producer?: string | null
    manufacturer?: string | null
    country?: string | null
    region?: string | null
    categoryRaw?: string | null
    categoryId?: string | null
    categoryName?: string | null
    categorySource?: CatalogCategoryMatchSourceDto | null
    categoryConfidence?: number | null
    categoryReason?: string | null
    color?: string | null
    sugar?: string | null
    grapeSorts?: string[]
    vintage?: number | null
    alcoholPercent?: number | null
    alcoholPercentMax?: number | null
    features?: string[]
    nameParts?: {
      ruName?: string | null
      enName?: string | null
      enSource?: 'SUPPLIER_PROVIDED' | 'TRANSLATION_MEMORY' | 'GENERATED' | null
      enConfidence?: number | null
      categoryPath?: string[] | null
      categoryAttrs?: Record<string, unknown>
      categorySignals?: CatalogCategorySignalDto[]
      categoryConfidence?: number | null
      country?: string | null
      region?: string | null
      geoAmbiguous?: boolean
      geoSignals?: Array<{
        source?: 'GEO_MARKER' | string | null
        pattern?: string | null
        country?: string | null
        region?: string | null
        categoryPath?: string[] | null
        weight?: number | null
        [key: string]: unknown
      }>
      brand?: string | null
      producer?: string | null
      brandSegment?: string | null
      brandSignals?: Array<{
        source?: 'BRAND' | string | null
        pattern?: string | null
        canonical?: string | null
        producer?: string | null
        segment?: string | null
        position?: number | null
        score?: number | null
        secondaryBrand?: string | null
        [key: string]: unknown
      }>
      volumeMl?: number | null
      alcoholPercent?: number | null
      alcoholPercentMax?: number | null
      vintage?: number | null
      features?: string[]
      strippedTokens?: string[]
      [key: string]: unknown
    } | null
    volumeMl?: number | null
    [key: string]: unknown
  }
  variant?: {
    volumeMl?: number | null
    packageSize?: number | null
    packageSizeUnit?: string | null
    unit?: string | null
    packQty?: number | null
    [key: string]: unknown
  }
  offer?: {
    price?: number | null
    basePrice?: number | null
    discountPrice?: number | null
    currency?: string | null
    stockAvailable?: number | null
    stockTotal?: number | null
    availability?: string | null
    minOrderQty?: number | null
    deliveryDaysMin?: number | null
    deliveryDaysMax?: number | null
    [key: string]: unknown
  }
  mapping?: {
    status?: PriceImportRowStatusDto | null
    confidence?: number | null
    categorySource?: CatalogCategoryMatchSourceDto | null
    categoryConfidence?: number | null
    categoryReason?: string | null
    issues?: string[]
    profileId?: string | null
    profileVersion?: number | null
    [key: string]: unknown
  }
  [key: string]: unknown
}

export type SupplierPriceImportPreviewRowDto = {
  id: string
  sheetName: string | null
  rowIndex: number | null
  rowType: string | null
  rowHash: string | null
  status: PriceImportRowStatusDto
  validationStatus: CatalogImportRowValidationStatusDto
  rawName: string | null
  normalizedName: string | null
  canonicalName: string | null
  russianName: string | null
  translatedName: string | null
  nameParts: SupplierPriceImportNormalizedPayloadDto['product'] extends infer Product
    ? Product extends { nameParts?: infer NameParts }
      ? NameParts
      : unknown
    : unknown
  categoryName: string | null
  categoryId: string | null
  categorySource: CatalogCategoryMatchSourceDto | null
  categoryConfidence: number | null
  categoryReason: string | null
  categorySignals: CatalogCategorySignalDto[]
  supplierSku: string | null
  article: string | null
  barcode: string | null
  eanList: string[]
  brand: string | null
  producer: string | null
  manufacturer: string | null
  country: string | null
  region: string | null
  color: string | null
  sugar: string | null
  grapeSorts: string[]
  vintage: number | null
  alcoholPercent: number | null
  alcoholPercentMax: number | null
  features: string[]
  volumeMl: number | null
  packageSize: number | null
  packageSizeUnit: string | null
  packQty: number | null
  price: number | null
  basePrice: number | null
  discountPrice: number | null
  currency: string | null
  stockAvailable: number | null
  stockTotal: number | null
  availability: string | null
  minOrderQty: number | null
  deliveryDaysMin: number | null
  deliveryDaysMax: number | null
  matchedProductId: string | null
  matchedProductVariantId: string | null
  matchedSupplierProductId: string | null
  matchedOfferId: string | null
  confidence: number | null
  rawPayload: unknown
  normalizedPayload: SupplierPriceImportNormalizedPayloadDto | null
  adminCorrectionPayload: unknown
  approvedAt: string | null
  publishedAt: string | null
  errorText: string | null
}

export type UpdateSupplierPriceImportMappingRowDto = {
  rowId: string
  ignore?: boolean
  rawCategory?: string | null
  categoryId?: string | null
  mappedProductId?: string | null
  mappedProductVariantId?: string | null
  mappedSupplierProductId?: string | null
  mappedOfferId?: string | null
  mappingStatus?: PriceImportRowStatusDto | null
  validationStatus?: CatalogImportRowValidationStatusDto | null
  approve?: boolean
  mappingConfidence?: number | null
  normalizedPayloadPatch?: Record<string, unknown> | null
  adminCorrectionPayload?: Record<string, unknown> | null
}

export type UpdateSupplierPriceImportMappingRequestDto = {
  mappingConfig?: SupplierPriceImportMappingConfigDto | null
  rows?: UpdateSupplierPriceImportMappingRowDto[]
}

export type SupplierPriceImportIssueDto = {
  id: string
  importId: string
  rowId: string | null
  type: string
  severity: PriceImportIssueSeverityDto
  status: PriceImportIssueStatusDto
  fieldName: string | null
  message: string
  supplierValue: unknown
  catalogValue: unknown
  suggestedAction: string | null
}

export type SupplierPriceImportIssuesQueryDto = OffsetLimitPaginationQuery & {
  status?: PriceImportIssueStatusDto[]
  severity?: PriceImportIssueSeverityDto[]
}

export type SupplierPriceImportIssuesResponseDto = ApiSuccessEnvelope<
  { items: SupplierPriceImportIssueDto[] },
  OffsetLimitPaginationMeta
>

export type UploadSupplierPriceImportResponseDto = SupplierPriceImportPreviewResponseDto

export type PriceImportPublishSummaryDto = {
  createdProducts: number
  updatedProducts: number
  createdVariants: number
  createdSupplierProducts: number
  createdOffers: number
  updatedOffers: number
  skippedRows: number
  unresolvedRows: number
  categoryIssues: number
  productMasterRows: number
  stockOnlyRows: number
  imageMatches: number
}

export type PublishSupplierPriceImportResponseDto = ApiSuccessEnvelope<{
  import: SupplierPriceImportDto
  summary: PriceImportPublishSummaryDto
}>

export type PriceImportUnpublishSummaryDto = {
  unpublishedOffers: number
  resetRows: number
}

export type UnpublishSupplierPriceImportResponseDto = ApiSuccessEnvelope<{
  import: SupplierPriceImportDto
  summary: PriceImportUnpublishSummaryDto
}>

export type DeleteSupplierPriceImportResponseDto = ApiSuccessEnvelope<{
  deletedId: string
}>

export type SupplierImportProfileDto = {
  id: string
  supplierId: string | null
  code: string
  name: string
  version: number
  isActive: boolean
  isDefault: boolean
  sourceFormat: PriceImportSourceFormatDto
  rulesJson: SupplierPriceImportMappingConfigDto
  createdAt: string
  updatedAt: string
}

export type CreateSupplierImportProfileRequestDto = {
  supplierId?: string | null
  code: string
  name: string
  sourceFormat?: PriceImportSourceFormatDto
  rulesJson: SupplierPriceImportMappingConfigDto
}

export type SupplierImportProfileListResponseDto = ApiSuccessEnvelope<{
  items: SupplierImportProfileDto[]
}>

export type CreateSupplierImportProfileResponseDto = ApiSuccessEnvelope<{
  profile: SupplierImportProfileDto
}>
