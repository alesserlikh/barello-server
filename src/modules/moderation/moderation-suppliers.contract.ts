import { normalizePhoneOrThrow } from '../../utils/phone'

export const MODERATION_SUPPLIER_ACCESS_STATUSES = ['ACTIVE', 'BLOCKED'] as const
export const MODERATION_PRICE_IMPORT_STATUSES = [
  'PENDING',
  'UPLOADED',
  'QUEUED',
  'PROCESSING',
  'PARSED',
  'HAS_ISSUES',
  'READY_TO_PUBLISH',
  'PROCESSED',
  'PUBLISHED',
  'PARTIALLY_PUBLISHED',
  'FAILED',
  'CANCELLED',
] as const
export const MODERATION_PRICE_IMPORT_ROW_STATUSES = [
  'IGNORED',
  'PARSED',
  'MATCHED',
  'LOW_CONFIDENCE',
  'CANDIDATE',
  'UNMATCHED',
  'MANUAL_MATCHED',
  'FAILED',
] as const

export type ModerationSupplierAccessStatus =
  (typeof MODERATION_SUPPLIER_ACCESS_STATUSES)[number]

export type CreateModerationSupplierDto = {
  inn: string
  companyName: string
  catalogName?: string
  ownerFullName?: string
  ownerPhone: string
  companyPhone: string
  city: string
  address: string
  accessStatus: ModerationSupplierAccessStatus
}

export type ConfirmExistingSupplierAccountDto =
  CreateModerationSupplierDto & {
    confirmExistingAccount: true
  }

export type UpdateModerationSupplierDto = Omit<
  CreateModerationSupplierDto,
  'accessStatus'
>

export type ModerationSupplierPriceImportDto = {
  id: string
  supplierId: string
  sourceFormat: 'XLSX' | 'CSV' | 'XML' | 'API'
  uploadType: 'ORIGINAL' | 'NORMALIZED'
  status:
    | 'PENDING'
    | 'UPLOADED'
    | 'QUEUED'
    | 'PROCESSING'
    | 'PARSED'
    | 'HAS_ISSUES'
    | 'READY_TO_PUBLISH'
    | 'PROCESSED'
    | 'PUBLISHED'
    | 'PARTIALLY_PUBLISHED'
    | 'FAILED'
    | 'CANCELLED'
  rowsCount: number
  processedRows: number
  failedRows: number
  errorText: string | null
  fileAssetId: string
  file: {
    id: string
    fileName: string
    mimeType: string
    fileSize: number
  } | null
  createdAt: string
  updatedAt: string
}

export type ModerationSupplierDto = {
  id: string
  publicId: string
  tableId: string
  businessId: string | null
  inn: string | null
  name: string
  displayName: string
  companyName: string
  catalogName: string | null
  city: string | null
  address: string | null
  contactName: string | null
  ownerFullName: string | null
  ownerName: string | null
  ownerPhone: string | null
  owner: {
    id: string
    publicId: string
    fullName: string | null
    loginPhone: string | null
    status: 'UNIDENTIFIED' | 'ACTIVE' | 'BLOCKED' | 'ARCHIVED'
    accountType: 'VENUE_STAFF' | 'SUPPLIER_STAFF' | 'UNIDENTIFIED'
    lastLoginAt: string | null
  } | null
  hasActiveAccount: boolean
  accountStatus: string
  membershipId: string | null
  membershipStatus: 'PENDING' | 'ACTIVE' | 'REJECTED' | 'REVOKED' | null
  membershipAccessLevel: 'ADMIN' | 'SENIOR_STAFF' | 'LINE_STAFF' | null
  membershipJoinedAt: string | null
  loginPhone: string | null
  companyPhone: string | null
  phone: string | null
  email: string | null
  website: string | null
  accessStatus: ModerationSupplierAccessStatus
  lastLoginAt: string | null
  categoriesCount: number
  supplierProductsCount: number
  productsCount: number
  offersCount: number
  promoCount: number
  priceImportsCount: number
  lastPriceImportAt: string | null
  lastPriceImport: {
    id: string
    fileName: string | null
    uploadType: 'ORIGINAL' | 'NORMALIZED'
    status:
      | 'PENDING'
      | 'UPLOADED'
      | 'QUEUED'
      | 'PROCESSING'
      | 'PARSED'
      | 'HAS_ISSUES'
      | 'READY_TO_PUBLISH'
      | 'PROCESSED'
      | 'PUBLISHED'
      | 'PARTIALLY_PUBLISHED'
      | 'FAILED'
      | 'CANCELLED'
    createdAt: string
    rowsCount: number
    failedRows: number
    errorText: string | null
  } | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type ModerationSupplierDetailDto = ModerationSupplierDto & {
  priceImports: ModerationSupplierPriceImportDto[]
}

export type ModerationSupplierProductDto = {
  id: string
  productId: string
  productName: string
  category: {
    id: string
    name: string
    code: string | null
  } | null
  supplierSku: string | null
  barcode: string | null
  variant: {
    id: string
    volume: number | null
    volumeUnit: string | null
    packageSize: number | null
    packageSizeUnit: string | null
    isDefault: boolean
  } | null
  offers: Array<{
    id: string
    price: number
    currency: string
    availability: string
    stockAvailable: number | null
    deliveryTerm: string | null
  }>
  sourceImportId: string | null
  sourceImportRowId: string | null
  sourceImport: {
    id: string
    fileAssetId: string
    fileName: string | null
    file: {
      id: string
      fileName: string
      mimeType: string
      fileSize: number
      url: string | null
    } | null
  } | null
  updatedAt: string
}

export type UpdateModerationSupplierProductDto = {
  supplierSku?: string | null
  offerId?: string | null
  price?: number | null
  currency?: string | null
  stockAvailable?: number | null
  availability?: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | null
  deliveryTerm?: string | null
}

export type ModerationSupplierProductsResponseDto = {
  items: ModerationSupplierProductDto[]
  total: number
}

export type ModerationCatalogProductStatus =
  | 'DRAFT'
  | 'NEEDS_REVIEW'
  | 'CONFIRMED'
  | 'HIDDEN'
  | 'MERGED'
  | 'ARCHIVED'

export type ModerationCatalogProductPublicVisibilityReason =
  | 'NOT_CONFIRMED'
  | 'NO_CATEGORY'
  | 'CATEGORY_HIDDEN'
  | 'CATEGORY_INACTIVE'
  | 'NO_ACTIVE_SUPPLIER_OFFER'
  | 'SUPPLIER_INACTIVE'
  | 'PRODUCT_HIDDEN'
  | 'MERGED'

export type ModerationCatalogProductPublicVisibilityDto = {
  isVisibleInPublicCatalog: boolean
  reasons: ModerationCatalogProductPublicVisibilityReason[]
}

export type ModerationCatalogProductListItemDto = {
  id: string
  publicId: string
  tableId: string
  category: { id: string; name: string } | null
  article: string | null
  barcode: string | null
  canonicalName: string
  russianName: string | null
  volume: string | null
  packagingType: string | null
  packagingOptions: string[]
  description: string | null
  imageUrl: string | null
  image: {
    id: string
    fileName: string
    url: string
  } | null
  hasImage: boolean
  suppliersCount: number
  activeOffersCount: number
  promoCount: number
  status: ModerationCatalogProductStatus
  publicVisibility: ModerationCatalogProductPublicVisibilityDto
  issuesCount: number
  conflictsCount: number
  updatedAt: string
}

export type ModerationCatalogProductsResponseDto = {
  items: ModerationCatalogProductListItemDto[]
  total: number
  offset: number
  limit: number
}

export type ModerationCatalogProductDetailDto = {
  id: string
  publicId: string
  category: { id: string; name: string; code: string | null } | null
  article: string | null
  barcode: string | null
  canonicalName: string
  russianName: string | null
  description: string | null
  image: {
    id: string
    fileName: string
    url: string
  } | null
  brand: string | null
  producer: string | null
  country: string | null
  region: string | null
  year: number | null
  alcoholPercent: number | null
  volume: string | null
  packagingType: string | null
  packagingOptions: string[]
  attributesJson: Record<string, unknown> | null
  suppliers: Array<{
    supplierId: string
    supplierPublicId: string
    supplierName: string
    supplierSku: string | null
    price: number | null
    stockAvailable: number | null
    availability: string | null
    sourceImportId: string | null
  }>
  aliases: Array<{
    id: string
    supplierId: string
    supplierPublicId: string
    supplierName: string
    supplierProductId: string | null
    aliasType: string
    rawValue: string
    normalizedValue: string
    confidence: number | null
    isActive: boolean
  }>
  issues: Array<{
    id: string
    type: string
    severity: string
    status: string
    fieldName: string | null
    message: string
    sourceValue: unknown
    catalogValue: unknown
    suggestedAction: string | null
  }>
  analytics: {
    views: number
    favorites: number
    shipments: number
    repeatPurchases: number
    defects: number
    rating: number | null
  }
  publicVisibility: ModerationCatalogProductPublicVisibilityDto
}

export type ModerationProductCardDto = {
  product: {
    id: string
    publicId: string
    status: ModerationCatalogProductStatus
    statusReasons: string[]
    publicVisibility: ModerationCatalogProductPublicVisibilityDto
    completeness: {
      percent: number
      missingFacetFields: string[]
    }
    name: string
    translatedName: string | null
    originalName: string | null
    category: {
      id: string
      name: string
      code: string | null
      section: string | null
      path: Array<{ id: string; name: string }>
    } | null
    attributes: Array<{
      key: string
      label: string
      group: string
      value: unknown
      source: 'PIPELINE' | 'MODERATOR' | null
      locked: boolean
      facetKeys: string[]
    }>
    attributesJson: Record<string, unknown> | null
    fieldOverrides: Array<{
      field: string
      label: string
      value: unknown
      updatedAt: string
      source: 'MODERATOR'
    }>
    features: string[]
    description: string | null
    createdAt: string
    updatedAt: string
  }
  variants: Array<{
    id: string
    volume: number | null
    volumeUnit: string | null
    packageSize: number | null
    packageSizeUnit: string | null
    packagingType: string | null
    isDefault: boolean
    offersCount: number
    priceFrom: { amount: number; currency: string } | null
  }>
  offers: Array<{
    id: string
    variantId: string
    supplier: { id: string; publicId: string; name: string }
    price: { amount: number; currency: string }
    stockAvailable: number | null
    status: string
    deliveryDaysMin: number | null
    deliveryDaysMax: number | null
    minOrderQty: number | null
    packQty: number | null
    supplierSku: string | null
    updatedAt: string
    sourceImportId: string | null
  }>
  media: {
    main: { id: string; fileName: string; url: string } | null
    gallery: Array<{ id: string; fileName: string; url: string }>
    videos: Array<{ id: string; fileName: string; url: string; mimeType: string }>
    candidates: Array<{
      id: string
      image: { id: string; fileName: string; url: string }
      score: number | null
      status: string
      sourceImportId: string | null
    }>
  }
  issues: Array<{
    id: string
    type: string
    severity: string
    status: string
    fieldName: string | null
    message: string
    sourceValue: unknown
    catalogValue: unknown
    suggestedAction: string | null
  }>
  duplicates: Array<{
    productId: string
    publicId: string
    name: string
    similarity: number
    differingFields: string[]
  }>
  aliases: Array<{
    id: string
    supplierId: string
    supplierName: string
    type: string
    value: string
    confidence: number | null
  }>
  audit: Array<{
    id: string
    at: string
    actor: string
    action: string
    field?: string
    before?: unknown
    after?: unknown
  }>
  analytics: {
    views: number
    favorites: number
    shipments: number
    repeatPurchases: number
    defects: number
    rating: number | null
  }
}

export type UpdateModerationCatalogProductDto = {
  categoryId?: string | null
  canonicalName?: string
  russianName?: string | null
  description?: string | null
  imageFileId?: string | null
  article?: string | null
  barcode?: string | null
  brand?: string | null
  producer?: string | null
  manufacturer?: string | null
  country?: string | null
  region?: string | null
  year?: number | null
  alcoholPercent?: number | null
  color?: string | null
  sugar?: string | null
  grapeSorts?: string[] | string | null
  volume?: number | string | null
  packagingType?: string | null
  packagingOptions?: string[] | string | null
  attributesJson?: Record<string, unknown> | null
  isHidden?: boolean
  isConfirmed?: boolean
}

export type ModerationSupplierPriceImportOverviewDto = {
  import: ModerationSupplierPriceImportDto
  stats: {
    categories: {
      total: number
      items: Array<{ name: string; productsCount: number }>
    }
    products: {
      total: number
      matched: number
      unmatched: number
      failed: number
    }
  }
  rows: {
    items: Array<{
      id: string
      rawName: string
      rawCategory: string | null
      mappingStatus:
        | 'IGNORED'
        | 'PARSED'
        | 'MATCHED'
        | 'LOW_CONFIDENCE'
        | 'CANDIDATE'
        | 'MANUAL_MATCHED'
        | 'UNMATCHED'
        | 'FAILED'
      errorText: string | null
    }>
    total: number
    page: number
    pageSize: number
    hasMore: boolean
  }
}

export type ModerationSupplierListResponseDto = ModerationSupplierDto[]

export type ModerationSupplierItemResponseDto = {
  ok: true
  supplier: ModerationSupplierDto | ModerationSupplierDetailDto
}

export type DeleteModerationSupplierPriceImportResponseDto = {
  ok: true
  importId: string
  supplier: ModerationSupplierDetailDto
}

const nullable = (schema: Record<string, unknown>) => ({
  anyOf: [schema, { type: 'null' }],
})

const dateTimeSchema = { type: 'string', format: 'date-time' }
const nullableDateTimeSchema = nullable(dateTimeSchema)
const nullableStringSchema = nullable({ type: 'string' })

export const moderationSupplierProductSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'productId',
    'productName',
    'category',
    'supplierSku',
    'barcode',
    'variant',
    'offers',
    'sourceImportId',
    'sourceImportRowId',
    'sourceImport',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    productId: { type: 'string', format: 'uuid' },
    productName: { type: 'string' },
    category: nullable({
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name', 'code'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
        code: nullableStringSchema,
      },
    }),
    supplierSku: nullableStringSchema,
    barcode: nullableStringSchema,
    variant: nullable({
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'volume',
        'volumeUnit',
        'packageSize',
        'packageSizeUnit',
        'isDefault',
      ],
      properties: {
        id: { type: 'string', format: 'uuid' },
        volume: nullable({ type: 'number' }),
        volumeUnit: nullableStringSchema,
        packageSize: nullable({ type: 'number' }),
        packageSizeUnit: nullableStringSchema,
        isDefault: { type: 'boolean' },
      },
    }),
    offers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'price',
          'currency',
          'availability',
          'stockAvailable',
          'deliveryTerm',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          price: { type: 'number' },
          currency: { type: 'string' },
          availability: { type: 'string' },
          stockAvailable: nullable({ type: 'number' }),
          deliveryTerm: nullableStringSchema,
        },
      },
    },
    sourceImportId: nullable({ type: 'string', format: 'uuid' }),
    sourceImportRowId: nullable({ type: 'string', format: 'uuid' }),
    sourceImport: nullable({
      type: 'object',
      additionalProperties: false,
      required: ['id', 'fileAssetId', 'fileName', 'file'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        fileAssetId: { type: 'string', format: 'uuid' },
        fileName: nullableStringSchema,
        file: nullable({
          type: 'object',
          additionalProperties: false,
          required: ['id', 'fileName', 'mimeType', 'fileSize', 'url'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            fileName: { type: 'string' },
            mimeType: { type: 'string' },
            fileSize: { type: 'integer', minimum: 0 },
            url: nullableStringSchema,
          },
        }),
      },
    }),
    updatedAt: dateTimeSchema,
  },
} as const

export const moderationSupplierProductsResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'total'],
  properties: {
    items: { type: 'array', items: moderationSupplierProductSchema },
    total: { type: 'integer', minimum: 0 },
  },
} as const

export const moderationSupplierPriceImportSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id', 'supplierId', 'sourceFormat', 'uploadType', 'status', 'rowsCount', 'processedRows',
    'failedRows', 'errorText', 'fileAssetId', 'file', 'createdAt', 'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    supplierId: { type: 'string', format: 'uuid' },
    sourceFormat: { type: 'string', enum: ['XLSX', 'CSV', 'XML', 'API'] },
    uploadType: { type: 'string', enum: ['ORIGINAL', 'NORMALIZED'] },
    status: { type: 'string', enum: MODERATION_PRICE_IMPORT_STATUSES },
    rowsCount: { type: 'integer', minimum: 0 },
    processedRows: { type: 'integer', minimum: 0 },
    failedRows: { type: 'integer', minimum: 0 },
    errorText: nullableStringSchema,
    fileAssetId: { type: 'string', format: 'uuid' },
    file: nullable({
      type: 'object',
      additionalProperties: false,
      required: ['id', 'fileName', 'mimeType', 'fileSize'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        fileName: { type: 'string' },
        mimeType: { type: 'string' },
        fileSize: { type: 'integer', minimum: 0 },
      },
    }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  },
} as const

export const moderationSupplierSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id', 'publicId', 'tableId', 'businessId', 'inn', 'name', 'displayName',
    'companyName', 'catalogName', 'city', 'address',
    'contactName', 'ownerFullName', 'ownerName', 'ownerPhone', 'owner',
    'hasActiveAccount', 'accountStatus',
    'membershipId', 'membershipStatus', 'membershipAccessLevel',
    'membershipJoinedAt', 'loginPhone', 'companyPhone', 'phone', 'email',
    'website', 'accessStatus', 'lastLoginAt', 'categoriesCount',
    'supplierProductsCount', 'productsCount', 'offersCount', 'promoCount',
    'priceImportsCount',
    'lastPriceImportAt', 'lastPriceImport', 'isActive', 'createdAt', 'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    publicId: { type: 'string' },
    tableId: { type: 'string' },
    businessId: nullable({ type: 'string', format: 'uuid' }),
    inn: nullableStringSchema,
    name: { type: 'string' },
    displayName: { type: 'string' },
    companyName: { type: 'string' },
    catalogName: nullableStringSchema,
    city: nullableStringSchema,
    address: nullableStringSchema,
    contactName: nullableStringSchema,
    ownerFullName: nullableStringSchema,
    ownerName: nullableStringSchema,
    ownerPhone: nullableStringSchema,
    owner: nullable({
      type: 'object',
      additionalProperties: false,
      required: ['id', 'publicId', 'fullName', 'loginPhone', 'status', 'accountType', 'lastLoginAt'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        publicId: { type: 'string' },
        fullName: nullableStringSchema,
        loginPhone: nullableStringSchema,
        status: { type: 'string', enum: ['UNIDENTIFIED', 'ACTIVE', 'BLOCKED', 'ARCHIVED'] },
        accountType: { type: 'string', enum: ['VENUE_STAFF', 'SUPPLIER_STAFF', 'UNIDENTIFIED'] },
        lastLoginAt: nullableDateTimeSchema,
      },
    }),
    hasActiveAccount: { type: 'boolean' },
    accountStatus: { type: 'string' },
    membershipId: nullable({ type: 'string', format: 'uuid' }),
    membershipStatus: nullable({ type: 'string', enum: ['PENDING', 'ACTIVE', 'REJECTED', 'REVOKED'] }),
    membershipAccessLevel: nullable({ type: 'string', enum: ['ADMIN', 'SENIOR_STAFF', 'LINE_STAFF'] }),
    membershipJoinedAt: nullableDateTimeSchema,
    loginPhone: nullableStringSchema,
    companyPhone: nullableStringSchema,
    phone: nullableStringSchema,
    email: nullableStringSchema,
    website: nullableStringSchema,
    accessStatus: { type: 'string', enum: MODERATION_SUPPLIER_ACCESS_STATUSES },
    lastLoginAt: nullableDateTimeSchema,
    categoriesCount: { type: 'integer', minimum: 0 },
    supplierProductsCount: { type: 'integer', minimum: 0 },
    productsCount: { type: 'integer', minimum: 0 },
    offersCount: { type: 'integer', minimum: 0 },
    promoCount: { type: 'integer', minimum: 0 },
    priceImportsCount: { type: 'integer', minimum: 0 },
    lastPriceImportAt: nullableDateTimeSchema,
    lastPriceImport: nullable({
      type: 'object',
      additionalProperties: false,
      required: ['id', 'fileName', 'uploadType', 'status', 'createdAt', 'rowsCount', 'failedRows', 'errorText'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        fileName: nullableStringSchema,
        uploadType: { type: 'string', enum: ['ORIGINAL', 'NORMALIZED'] },
        status: { type: 'string', enum: MODERATION_PRICE_IMPORT_STATUSES },
        createdAt: dateTimeSchema,
        rowsCount: { type: 'integer', minimum: 0 },
        failedRows: { type: 'integer', minimum: 0 },
        errorText: nullableStringSchema,
      },
    }),
    isActive: { type: 'boolean' },
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  },
} as const

export const moderationSupplierDetailSchema = {
  ...moderationSupplierSchema,
  required: [...moderationSupplierSchema.required, 'priceImports'],
  properties: {
    ...moderationSupplierSchema.properties,
    priceImports: { type: 'array', items: moderationSupplierPriceImportSchema },
  },
} as const

export class ModerationSupplierValidationError extends Error {
  code: string
  status: number
  details: unknown

  constructor(params: {
    code: string
    message: string
    status?: number
    details?: unknown
  }) {
    super(params.message)
    this.name = 'ModerationSupplierValidationError'
    this.code = params.code
    this.status = params.status ?? 400
    this.details = params.details ?? null
  }
}

const ALLOWED_CREATE_FIELDS = new Set([
  'inn',
  'companyName',
  'catalogName',
  'ownerFullName',
  'ownerPhone',
  'companyPhone',
  'city',
  'address',
  'accessStatus',
])

const ALLOWED_UPDATE_FIELDS = new Set([
  'inn',
  'companyName',
  'catalogName',
  'ownerFullName',
  'ownerPhone',
  'companyPhone',
  'city',
  'address',
])

const ALLOWED_SUPPLIER_PRODUCT_UPDATE_FIELDS = new Set([
  'supplierSku',
  'offerId',
  'price',
  'currency',
  'stockAvailable',
  'availability',
  'deliveryTerm',
])

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function requiredString(
  input: Record<string, unknown>,
  field: string,
  minLength: number,
  maxLength: number
) {
  const value = input[field]

  if (typeof value !== 'string' || !value.trim()) {
    throw new ModerationSupplierValidationError({
      code: 'FIELD_REQUIRED',
      message: `Поле ${field} обязательно`,
      details: { field },
    })
  }

  const normalized = normalizeWhitespace(value)

  if (normalized.length < minLength || normalized.length > maxLength) {
    throw new ModerationSupplierValidationError({
      code: 'FIELD_LENGTH_INVALID',
      message: `Поле ${field} должно содержать от ${minLength} до ${maxLength} символов`,
      details: { field, minLength, maxLength },
    })
  }

  return normalized
}

function optionalString(
  input: Record<string, unknown>,
  field: string,
  minLength: number,
  maxLength: number
) {
  const value = input[field]

  if (value === undefined || value === null || value === '') {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new ModerationSupplierValidationError({
      code: 'FIELD_TYPE_INVALID',
      message: `Поле ${field} должно быть строкой`,
      details: { field },
    })
  }

  const normalized = normalizeWhitespace(value)

  if (normalized.length < minLength || normalized.length > maxLength) {
    throw new ModerationSupplierValidationError({
      code: 'FIELD_LENGTH_INVALID',
      message: `Поле ${field} должно содержать от ${minLength} до ${maxLength} символов`,
      details: { field, minLength, maxLength },
    })
  }

  return normalized
}

function optionalNullableString(
  input: Record<string, unknown>,
  field: string,
  maxLength: number
) {
  const value = input[field]
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  if (typeof value !== 'string') {
    throw new ModerationSupplierValidationError({
      code: 'FIELD_TYPE_INVALID',
      message: `Поле ${field} должно быть строкой`,
      details: { field },
    })
  }
  const normalized = normalizeWhitespace(value)
  if (normalized.length > maxLength) {
    throw new ModerationSupplierValidationError({
      code: 'FIELD_LENGTH_INVALID',
      message: `Поле ${field} должно содержать не более ${maxLength} символов`,
      details: { field, maxLength },
    })
  }
  return normalized || null
}

function optionalNullableNumber(
  input: Record<string, unknown>,
  field: string,
  min = 0
) {
  const value = input[field]
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value.replace(',', '.'))
      : Number.NaN
  if (!Number.isFinite(parsed) || parsed < min) {
    throw new ModerationSupplierValidationError({
      code: 'FIELD_NUMBER_INVALID',
      message: `Поле ${field} должно быть числом`,
      details: { field, min },
    })
  }
  return parsed
}

function isValidInn(inn: string) {
  const checksum = (digits: number[], coefficients: number[]) =>
    coefficients.reduce((sum, coefficient, index) => sum + coefficient * digits[index], 0) % 11 % 10
  const digits = inn.split('').map(Number)

  if (inn.length === 10) {
    return checksum(digits, [2, 4, 10, 3, 5, 9, 4, 6, 8]) === digits[9]
  }

  if (inn.length === 12) {
    return (
      checksum(digits, [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === digits[10] &&
      checksum(digits, [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === digits[11]
    )
  }

  return false
}

export function parseCreateModerationSupplierDto(
  value: unknown
): CreateModerationSupplierDto {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ModerationSupplierValidationError({
      code: 'BODY_INVALID',
      message: 'Тело запроса должно быть объектом',
    })
  }

  const input = value as Record<string, unknown>
  const unknownFields = Object.keys(input).filter(
    (field) => !ALLOWED_CREATE_FIELDS.has(field)
  )

  if (unknownFields.length > 0) {
    throw new ModerationSupplierValidationError({
      code: 'UNKNOWN_FIELDS',
      message: 'Запрос содержит неизвестные поля',
      details: { fields: unknownFields },
    })
  }

  const rawInn = requiredString(input, 'inn', 10, 14)
  const inn = rawInn.replace(/\D/g, '')

  if (!isValidInn(inn)) {
    throw new ModerationSupplierValidationError({
      code: 'INN_INVALID',
      message: 'Введите корректный ИНН',
      details: { field: 'inn' },
    })
  }

  const ownerFullName = optionalString(input, 'ownerFullName', 2, 200)

  if (ownerFullName && ownerFullName.split(' ').length < 2) {
    throw new ModerationSupplierValidationError({
      code: 'OWNER_FULL_NAME_INVALID',
      message: 'Укажите фамилию и имя владельца',
      details: { field: 'ownerFullName' },
    })
  }

  const ownerPhone = normalizePhoneOrThrow(input.ownerPhone, (params) =>
    new ModerationSupplierValidationError({
      ...params,
      details: { field: 'ownerPhone' },
    })
  )
  const companyPhone = normalizePhoneOrThrow(input.companyPhone, (params) =>
    new ModerationSupplierValidationError({
      ...params,
      details: { field: 'companyPhone' },
    })
  )
  const accessStatus = input.accessStatus

  if (
    typeof accessStatus !== 'string' ||
    !MODERATION_SUPPLIER_ACCESS_STATUSES.includes(
      accessStatus as ModerationSupplierAccessStatus
    )
  ) {
    throw new ModerationSupplierValidationError({
      code: 'ACCESS_STATUS_INVALID',
      message: 'Статус доступа должен быть ACTIVE или BLOCKED',
      details: { field: 'accessStatus' },
    })
  }

  return {
    inn,
    companyName: requiredString(input, 'companyName', 2, 200),
    catalogName: optionalString(input, 'catalogName', 2, 200),
    ownerFullName,
    ownerPhone,
    companyPhone,
    city: requiredString(input, 'city', 2, 100),
    address: requiredString(input, 'address', 3, 300),
    accessStatus: accessStatus as ModerationSupplierAccessStatus,
  }
}

export function parseConfirmExistingSupplierAccountDto(
  value: unknown
): ConfirmExistingSupplierAccountDto {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ModerationSupplierValidationError({
      code: 'BODY_INVALID',
      message: 'Тело запроса должно быть объектом',
    })
  }

  const { confirmExistingAccount, ...createInput } = value as Record<
    string,
    unknown
  >

  if (confirmExistingAccount !== true) {
    throw new ModerationSupplierValidationError({
      code: 'CONFIRMATION_REQUIRED',
      message: 'Требуется явное подтверждение привязки существующего аккаунта',
      details: { field: 'confirmExistingAccount' },
    })
  }

  return {
    ...parseCreateModerationSupplierDto(createInput),
    confirmExistingAccount: true,
  }
}

export function parseUpdateModerationSupplierDto(
  value: unknown
): UpdateModerationSupplierDto {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ModerationSupplierValidationError({
      code: 'BODY_INVALID',
      message: 'Тело запроса должно быть объектом',
    })
  }

  const input = value as Record<string, unknown>
  const unknownFields = Object.keys(input).filter(
    (field) => !ALLOWED_UPDATE_FIELDS.has(field)
  )

  if (unknownFields.length > 0) {
    throw new ModerationSupplierValidationError({
      code: 'UNKNOWN_FIELDS',
      message: 'Запрос содержит неизвестные поля',
      details: { fields: unknownFields },
    })
  }

  const { accessStatus: _accessStatus, ...parsed } =
    parseCreateModerationSupplierDto({ ...input, accessStatus: 'ACTIVE' })

  return parsed
}

export function parseUpdateModerationSupplierProductDto(
  value: unknown
): UpdateModerationSupplierProductDto {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ModerationSupplierValidationError({
      code: 'BODY_INVALID',
      message: 'Тело запроса должно быть объектом',
    })
  }

  const input = value as Record<string, unknown>
  const unknownFields = Object.keys(input).filter(
    (field) => !ALLOWED_SUPPLIER_PRODUCT_UPDATE_FIELDS.has(field)
  )

  if (unknownFields.length > 0) {
    throw new ModerationSupplierValidationError({
      code: 'UNKNOWN_FIELDS',
      message: 'Запрос содержит неизвестные поля',
      details: { fields: unknownFields },
    })
  }

  const output: UpdateModerationSupplierProductDto = {}
  const supplierSku = optionalNullableString(input, 'supplierSku', 120)
  if (supplierSku !== undefined) output.supplierSku = supplierSku

  const offerId = optionalNullableString(input, 'offerId', 80)
  if (offerId !== undefined) output.offerId = offerId

  const price = optionalNullableNumber(input, 'price', 0)
  if (price !== undefined) output.price = price

  const stockAvailable = optionalNullableNumber(input, 'stockAvailable', 0)
  if (stockAvailable !== undefined) output.stockAvailable = stockAvailable

  const currency = optionalNullableString(input, 'currency', 12)
  if (currency !== undefined) output.currency = currency?.toUpperCase() ?? null

  const deliveryTerm = optionalNullableString(input, 'deliveryTerm', 120)
  if (deliveryTerm !== undefined) output.deliveryTerm = deliveryTerm

  if (input.availability !== undefined) {
    if (input.availability === null || input.availability === '') {
      output.availability = null
    } else if (
      typeof input.availability === 'string' &&
      ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'].includes(input.availability)
    ) {
      output.availability = input.availability as UpdateModerationSupplierProductDto['availability']
    } else {
      throw new ModerationSupplierValidationError({
        code: 'AVAILABILITY_INVALID',
        message: 'Доступность должна быть IN_STOCK, LOW_STOCK или OUT_OF_STOCK',
        details: { field: 'availability' },
      })
    }
  }

  if (Object.keys(output).length === 0) {
    throw new ModerationSupplierValidationError({
      code: 'EMPTY_UPDATE',
      message: 'Нет данных для обновления',
    })
  }

  return output
}

export function isModerationSupplierValidationError(
  error: unknown
): error is ModerationSupplierValidationError {
  return error instanceof ModerationSupplierValidationError
}

