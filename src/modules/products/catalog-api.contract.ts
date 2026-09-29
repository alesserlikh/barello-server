import type {
  ApiSuccessEnvelope,
  OffsetLimitPaginationMeta,
  OffsetLimitPaginationQuery,
} from '../../lib/api-contract'

export const PRODUCT_STATUSES = [
  'ACTIVE',
  'ORDERABLE',
  'SOLD_OUT',
  'UNAVAILABLE',
] as const

export type ProductStatus = (typeof PRODUCT_STATUSES)[number]

export const OFFER_STATUSES = [
  'ACTIVE',
  'OUT_OF_STOCK',
  'CLOSED',
] as const

export type OfferStatus = (typeof OFFER_STATUSES)[number]

export const CATALOG_AVAILABILITY_FILTERS = [
  'ACTIVE',
  'ORDERABLE',
  'SOLD_OUT',
  'UNAVAILABLE',
] as const

export type CatalogAvailabilityFilter =
  (typeof CATALOG_AVAILABILITY_FILTERS)[number]

export type CatalogSort =
  | 'relevance'
  | 'price_asc'
  | 'price_desc'
  | 'newest'
  | 'name_asc'

export type CatalogListQueryDto = OffsetLimitPaginationQuery & {
  venueId?: string
  venueIds?: string[]
  query?: string
  categoryId?: string
  categoryIds?: string[]
  sections?: Array<'ALCOHOL' | 'DRINKS_FOOD' | 'NONFOOD'>
  supplierIds?: string[]
  availability?: CatalogAvailabilityFilter[]
  priceMin?: number
  priceMax?: number
  stockMin?: number
  deliveryDaysMax?: number
  favoritesOnly?: boolean
  sort?: CatalogSort
}

export type CatalogMoneyDto = {
  amount: number
  currency: string
}

export type CatalogImageDto = {
  id: string
  url: string
  alt: string | null
  fileName?: string | null
}

export type CatalogProductAttributesDto = {
  brand: string | null
  producer: string | null
  manufacturer: string | null
  country: string | null
  region: string | null
  vintage: number | null
  alcoholPercent: number | null
  alcoholPercentMax: number | null
  color: string | null
  sugar: string | null
  grapeSorts: string[]
  features: string[]
  packagingType: string | null
  packagingOptions: string[]
}

export type CatalogSupplierDto = {
  id: string
  publicId: string
  name: string
}

export type CatalogOfferDto = {
  id: string
  supplier: CatalogSupplierDto
  status: OfferStatus
  availability: ProductStatus
  price: CatalogMoneyDto
  basePrice: CatalogMoneyDto | null
  stockAvailable: number | null
  stockTotal: number | null
  deliveryDaysMin: number | null
  deliveryDaysMax: number | null
  minOrderQty: number | null
  packQty: number | null
  isAvailable: boolean
}

export type CatalogProductBlockDto = {
  canonicalTitle: string
  russianTitle: string | null
  brand: string | null
  producer: string | null
  country: string | null
  region: string | null
  year: number | null
  alcoholPercent: number | null
  description: string | null
  image: CatalogImageDto | null
}

export type CatalogProductBasicBlockDto = {
  article: string | null
  barcode: string | null
  volume: number | null
  volumeMl: number | null
  volumeUnit: string | null
  package: {
    quantity: number | null
    size: number | null
    unit: string | null
    title: string | null
  }
  packagingType: string | null
  packagingOptions: string[]
  supplierSku: string | null
}

export type CatalogSkuDto = {
  id: string
  productVariantId: string
  packageId: string | null
  volume: number | null
  volumeMl: number | null
  volumeUnit: string | null
  measureLabel: string | null
  packLine: string | null
  packageSize: number | null
  packageSizeUnit: string | null
  packagingType: string | null
  packageTitle: string | null
  supplierSku: string | null
  barcode: string | null
  article: string | null
  status: ProductStatus
  priceFrom: CatalogMoneyDto | null
  offers: CatalogOfferDto[]
}

export type CatalogProductCardDto = {
  id: string
  publicId: string
  canonicalTitle?: string
  russianTitle?: string | null
  title: string
  translatedTitle: string | null
  description?: string | null
  barcode: string | null
  eanList: string[]
  article: string | null
  manufacturer: string | null
  brand: string | null
  producer: string | null
  country: string | null
  region: string | null
  vintage: number | null
  alcoholPercent: number | null
  volume: number | null
  volumeMl: number | null
  volumeUnit: string | null
  measureLabel: string | null
  packLine: string | null
  supplierSku: string | null
  availability: ProductStatus
  stockAvailable: number | null
  minOrderQty: number | null
  packQty: number | null
  packagingType: string | null
  packagingOptions: string[]
  color: string | null
  sugar: string | null
  grapeSorts: string[]
  attributes: CatalogProductAttributesDto
  category: {
    id: string
    name: string
    code: string | null
  }
  mainImage: CatalogImageDto | null
  image?: CatalogImageDto | null
  product?: CatalogProductBlockDto
  basic?: CatalogProductBasicBlockDto
  defaultSkuId: string | null
  skus: CatalogSkuDto[]
  offers?: CatalogOfferDto[]
  priceFrom: CatalogMoneyDto | null
  isFavorite: boolean
}

export type CatalogListItemDto = Omit<CatalogProductCardDto, 'skus'> & {
  skuPreview: CatalogSkuDto | null
  suppliersCount: number
}

export type CatalogListResponseDto = ApiSuccessEnvelope<
  { items: CatalogListItemDto[] },
  OffsetLimitPaginationMeta
>

export type CatalogProductCardResponseDto =
  ApiSuccessEnvelope<{ item: CatalogProductCardDto }>

export type CatalogSuggestionDto = {
  id: string
  label: string
  type: 'PRODUCT' | 'CATEGORY' | 'SUPPLIER' | 'SKU' | 'BARCODE'
  productId: string | null
  categoryId: string | null
  supplierId: string | null
  skuId: string | null
}

export type CatalogSuggestionsQueryDto = {
  query: string
  limit?: number
}

export type CatalogSuggestionsResponseDto = ApiSuccessEnvelope<{
  items: CatalogSuggestionDto[]
}>

export type CatalogSkuSearchQueryDto = OffsetLimitPaginationQuery & {
  query: string
  venueId?: string
}

export type CatalogSkuSearchResponseDto = ApiSuccessEnvelope<
  {
    exactMatch: CatalogListItemDto | null
    similarItems: CatalogListItemDto[]
  },
  OffsetLimitPaginationMeta
>
