import {
  CatalogCategorySection,
  FacetLevel,
  FacetScope,
  FacetType,
  OfferAvailabilityLevel,
  Prisma,
  ProductCatalogStatus,
} from '../../generated/prisma'
import { prisma } from '../../lib/prisma'
import {
  CatalogFacetDto,
  CatalogFacetSelectedValues,
  computeScopeFacets,
  FacetRegistryRecord,
  hasFacetSelection,
  loadFacetRegistryEntries,
  matchesRangeValue,
  matchesAnyValueSelection,
  matchesValueSelection,
  normalizeRange,
  normalizeScope,
  normalizeStringArray,
  readProductLikeFieldValues,
  resolveEffectiveCategorySelection,
  UNSPECIFIED_FACET_VALUE,
} from './facet-shared'

export type {
  CatalogFacetDto,
  CatalogFacetOptionDto,
  CatalogFacetSelectedValues,
} from './facet-shared'

export { UNSPECIFIED_FACET_VALUE } from './facet-shared'

export type CatalogFacetEngineQuery = {
  scope: FacetScope | keyof typeof FacetScope | string
  categoryId?: string | null
  categoryIds?: string[]
  sections?: CatalogCategorySection[]
  search?: string | null
  selectedFacets?: CatalogFacetSelectedValues | null
  includeHiddenFacets?: boolean
  productWhere?: Prisma.ProductWhereInput
}

type ProductRecord = Awaited<ReturnType<typeof loadFacetProducts>>[number]
type SupplierProductRecord = ProductRecord['supplierProducts'][number]
type OfferRecord = SupplierProductRecord['offers'][number]

const PUBLIC_OFFER_WHERE = {
  isCurrent: true,
  isAvailable: true,
} as const

const PUBLIC_SUPPLIER_PRODUCT_WHERE = {
  supplier: {
    isActive: true,
  },
  offers: {
    some: PUBLIC_OFFER_WHERE,
  },
} as const

const PUBLIC_PRODUCT_WHERE = {
  status: ProductCatalogStatus.CONFIRMED,
  isConfirmed: true,
  isHidden: false,
  mergedIntoProductId: null,
  // NOT (not OR) so a null categoryId still passes: Prisma's relation filter only matches
  // when the related row exists and satisfies the condition, so NOT{category:{isHidden:true}}
  // already means "no category, or category exists and isn't hidden" without a separate branch.
  NOT: { category: { isHidden: true } },
} as const

function getVariantFieldValue(
  variant: ProductRecord['variants'][number],
  dataSource: string
) {
  const field = dataSource.replace('variant.', '')
  const value = (variant as unknown as Record<string, unknown>)[field]
  if (value === null || value === undefined || Array.isArray(value)) return null
  return String(value)
}

function getOfferAvailability(offer: OfferRecord) {
  const stockAvailable = offer.stockAvailable === null ? null : Number(offer.stockAvailable)

  if (
    offer.isAvailable &&
    (
      (stockAvailable !== null && stockAvailable > 0) ||
      offer.availabilityLevel === OfferAvailabilityLevel.IN_STOCK ||
      offer.availabilityLevel === OfferAvailabilityLevel.LOW_STOCK
    )
  ) {
    return 'ACTIVE'
  }

  if (offer.isAvailable) {
    return 'ORDERABLE'
  }

  if (offer.availabilityLevel === OfferAvailabilityLevel.OUT_OF_STOCK) {
    return 'SOLD_OUT'
  }

  return 'UNAVAILABLE'
}

function getOfferDeliveryDays(offer: OfferRecord) {
  const max = offer.deliveryDaysMax
  const min = offer.deliveryDaysMin
  const value = max ?? min

  if (value === null || value === undefined) return null
  if (value <= 0) return 'today'
  if (value === 1) return 'tomorrow'
  if (value <= 3) return 'up_to_3'
  if (value <= 7) return 'up_to_7'
  return null
}

function getOfferStockLevel(offer: OfferRecord) {
  const stockAvailable = offer.stockAvailable === null ? null : Number(offer.stockAvailable)

  if (stockAvailable === null || stockAvailable <= 0) return null
  return stockAvailable <= 6 ? 'limited' : 'high'
}

function getOfferFieldValue(
  supplierProduct: SupplierProductRecord,
  offer: OfferRecord,
  dataSource: string
) {
  if (dataSource === 'offer.availability') return getOfferAvailability(offer)
  if (dataSource === 'offer.deliveryDays') return getOfferDeliveryDays(offer)
  if (dataSource === 'offer.stockLevel') return getOfferStockLevel(offer)
  if (dataSource === 'offer.supplierId') return supplierProduct.supplierId

  const field = dataSource.replace('offer.', '')
  const value = (offer as unknown as Record<string, unknown>)[field]
  if (value === null || value === undefined || Array.isArray(value)) return null
  return String(value)
}

function readFacetValues(
  product: ProductRecord,
  facet: FacetRegistryRecord,
  context?: {
    facets: FacetRegistryRecord[]
    selectedFacets: CatalogFacetSelectedValues
    ignoredFacetKey: string
  }
) {
  const values = new Set<string>()

  if (facet.level === FacetLevel.PRODUCT) {
    for (const value of readProductLikeFieldValues(product, facet.dataSource)) {
      if (value) values.add(value)
    }
  }

  if (facet.level === FacetLevel.VARIANT) {
    const activePeerFacets = (context?.facets ?? []).filter(
      (peerFacet) =>
        peerFacet.level === FacetLevel.VARIANT &&
        peerFacet.key !== context?.ignoredFacetKey &&
        hasFacetSelection(peerFacet, context?.selectedFacets[peerFacet.key])
    )
    for (const variant of product.variants) {
      if (
        activePeerFacets.length &&
        !activePeerFacets.every((peerFacet) =>
          variantMatchesFacet(variant, peerFacet, context?.selectedFacets[peerFacet.key])
        )
      ) {
        continue
      }
      const value = getVariantFieldValue(variant, facet.dataSource)
      if (value) values.add(value)
    }
  }

  if (facet.level === FacetLevel.OFFER) {
    const activePeerFacets = (context?.facets ?? []).filter(
      (peerFacet) =>
        peerFacet.level === FacetLevel.OFFER &&
        peerFacet.key !== context?.ignoredFacetKey &&
        hasFacetSelection(peerFacet, context?.selectedFacets[peerFacet.key])
    )
    for (const supplierProduct of product.supplierProducts) {
      for (const offer of supplierProduct.offers) {
        if (
          activePeerFacets.length &&
          !activePeerFacets.every((peerFacet) =>
            offerMatchesFacet(supplierProduct, offer, peerFacet, context?.selectedFacets[peerFacet.key])
          )
        ) {
          continue
        }
        const value = getOfferFieldValue(supplierProduct, offer, facet.dataSource)
        if (value) values.add(value)
      }
    }
  }

  return [...values]
}

function productMatchesFacet(product: ProductRecord, facet: FacetRegistryRecord, selection: unknown) {
  if (!hasFacetSelection(facet, selection)) return true

  if (facet.level === FacetLevel.PRODUCT) {
    const values = readProductLikeFieldValues(product, facet.dataSource)
    const value = values[0] ?? null
    return facet.type === FacetType.RANGE
      ? matchesRangeValue(value, selection)
      : matchesAnyValueSelection(values, selection)
  }

  if (facet.level === FacetLevel.VARIANT) {
    return product.variants.some((variant) => {
      const value = getVariantFieldValue(variant, facet.dataSource)
      return facet.type === FacetType.RANGE
        ? matchesRangeValue(value, selection)
        : matchesValueSelection(value, selection)
    })
  }

  if (facet.level === FacetLevel.OFFER) {
    return product.supplierProducts.some((supplierProduct) =>
      supplierProduct.offers.some((offer) => {
        const value = getOfferFieldValue(supplierProduct, offer, facet.dataSource)
        return facet.type === FacetType.RANGE
          ? matchesRangeValue(value, selection)
          : matchesValueSelection(value, selection)
      })
    )
  }

  return true
}

function variantMatchesFacet(
  variant: ProductRecord['variants'][number],
  facet: FacetRegistryRecord,
  selection: unknown
) {
  if (!hasFacetSelection(facet, selection)) return true
  const value = getVariantFieldValue(variant, facet.dataSource)
  return facet.type === FacetType.RANGE
    ? matchesRangeValue(value, selection)
    : matchesValueSelection(value, selection)
}

function offerMatchesFacet(
  supplierProduct: SupplierProductRecord,
  offer: OfferRecord,
  facet: FacetRegistryRecord,
  selection: unknown
) {
  if (!hasFacetSelection(facet, selection)) return true
  const value = getOfferFieldValue(supplierProduct, offer, facet.dataSource)
  return facet.type === FacetType.RANGE
    ? matchesRangeValue(value, selection)
    : matchesValueSelection(value, selection)
}

function productMatchesSelections(
  product: ProductRecord,
  facets: FacetRegistryRecord[],
  selectedFacets: CatalogFacetSelectedValues,
  ignoredFacetKey?: string
) {
  const activeProductFacets = facets.filter(
    (facet) =>
      facet.level === FacetLevel.PRODUCT &&
      facet.key !== ignoredFacetKey &&
      hasFacetSelection(facet, selectedFacets[facet.key])
  )
  const activeVariantFacets = facets.filter(
    (facet) =>
      facet.level === FacetLevel.VARIANT &&
      facet.key !== ignoredFacetKey &&
      hasFacetSelection(facet, selectedFacets[facet.key])
  )
  const activeOfferFacets = facets.filter(
    (facet) =>
      facet.level === FacetLevel.OFFER &&
      facet.key !== ignoredFacetKey &&
      hasFacetSelection(facet, selectedFacets[facet.key])
  )

  for (const facet of activeProductFacets) {
    if (facet.key === ignoredFacetKey) continue
    if (!productMatchesFacet(product, facet, selectedFacets[facet.key])) return false
  }

  if (
    activeVariantFacets.length &&
    !product.variants.some((variant) =>
      activeVariantFacets.every((facet) =>
        variantMatchesFacet(variant, facet, selectedFacets[facet.key])
      )
    )
  ) {
    return false
  }

  if (
    activeOfferFacets.length &&
    !product.supplierProducts.some((supplierProduct) =>
      supplierProduct.offers.some((offer) =>
        activeOfferFacets.every((facet) =>
          offerMatchesFacet(supplierProduct, offer, facet, selectedFacets[facet.key])
        )
      )
    )
  ) {
    return false
  }

  return true
}

async function loadFacetProducts(query: CatalogFacetEngineQuery, scope: FacetScope) {
  const requestedCategoryIds = query.categoryIds?.length
    ? query.categoryIds
    : query.categoryId
      ? [query.categoryId]
      : []
  const categoryIds = requestedCategoryIds.length
    ? (await resolveEffectiveCategorySelection(requestedCategoryIds)).expandedCategoryIds
    : []
  const sections = query.sections?.length
    ? Array.from(new Set(query.sections))
    : []
  const where: Prisma.ProductWhereInput = {
    ...(scope === FacetScope.CATALOG ? PUBLIC_PRODUCT_WHERE : {}),
    ...(categoryIds.length ? { categoryId: { in: categoryIds } } : {}),
    ...(sections.length
      ? {
          category: {
            is: {
              section: {
                in: sections,
              },
            },
          },
        }
      : {}),
    ...(query.productWhere ?? {}),
    ...(query.search?.trim()
      ? {
          OR: [
            { name: { contains: query.search.trim(), mode: 'insensitive' } },
            { translatedName: { contains: query.search.trim(), mode: 'insensitive' } },
            { brand: { contains: query.search.trim(), mode: 'insensitive' } },
            { producer: { contains: query.search.trim(), mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(scope === FacetScope.CATALOG
      ? {
          supplierProducts: {
            some: PUBLIC_SUPPLIER_PRODUCT_WHERE,
          },
        }
      : {}),
  }

  return prisma.product.findMany({
    where,
    include: {
      variants: true,
      supplierProducts: {
        include: {
          supplier: true,
          offers: {
            where: scope === FacetScope.CATALOG ? PUBLIC_OFFER_WHERE : undefined,
          },
        },
      },
    },
  })
}

export async function getCatalogFacets(query: CatalogFacetEngineQuery): Promise<{
  facets: CatalogFacetDto[]
  appliedFacets: CatalogFacetSelectedValues
}> {
  const scope = normalizeScope(query.scope)
  const selectedFacets = query.selectedFacets ?? {}
  const facets = await loadFacetRegistryEntries(scope, query.categoryId)
  const products = await loadFacetProducts(query, scope)

  return computeScopeFacets({
    facets,
    records: products,
    selectedFacets,
    includeHiddenFacets: query.includeHiddenFacets,
    readValues: readFacetValues,
    matchesOtherSelections: (product, allFacets, selected, ignoredFacetKey) =>
      productMatchesSelections(product, allFacets, selected, ignoredFacetKey),
  })
}

function buildProductFacetWhere(facet: FacetRegistryRecord, selection: unknown): Prisma.ProductWhereInput | null {
  if (!hasFacetSelection(facet, selection)) return null
  if (!facet.dataSource.startsWith('product.')) return null

  const values = normalizeStringArray(selection)
  const field = facet.dataSource.replace('product.', '')

  if (facet.type === FacetType.RANGE) {
    const range = normalizeRange(selection)
    if (!range || field.startsWith('attributesJson.')) return null
    return {
      [field]: {
        ...(range.min !== null ? { gte: range.min } : {}),
        ...(range.max !== null ? { lte: range.max } : {}),
      },
    } as Prisma.ProductWhereInput
  }

  if (field.startsWith('attributesJson.')) {
    const path = field.replace('attributesJson.', '').split('.')
    const concreteValues = values.filter((value) => value !== UNSPECIFIED_FACET_VALUE)
    if (!concreteValues.length) return null
    const OR: Prisma.ProductWhereInput[] = [
      ...concreteValues.flatMap((value) => [
        {
          attributesJson: {
            path,
            equals: value,
          },
        } as Prisma.ProductWhereInput,
        {
          attributesJson: {
            path,
            array_contains: [value],
          },
        } as Prisma.ProductWhereInput,
      ]),
    ]

    return {
      OR,
    } as Prisma.ProductWhereInput
  }

  const includesUnspecified = values.includes(UNSPECIFIED_FACET_VALUE)
  const concreteValues = values.filter((value) => value !== UNSPECIFIED_FACET_VALUE)

  if (includesUnspecified) {
    return {
      OR: [
        { [field]: null },
        ...(concreteValues.length ? [{ [field]: { in: concreteValues } }] : []),
      ],
    } as Prisma.ProductWhereInput
  }

  return {
    [field]: {
      in: values,
    },
  } as Prisma.ProductWhereInput
}

function buildVariantFacetCondition(
  facet: FacetRegistryRecord,
  selection: unknown
): Prisma.ProductVariantWhereInput | null {
  if (!hasFacetSelection(facet, selection) || !facet.dataSource.startsWith('variant.')) return null

  const field = facet.dataSource.replace('variant.', '')

  if (facet.type === FacetType.RANGE) {
    const range = normalizeRange(selection)
    if (!range) return null
    return {
      [field]: {
        ...(range.min !== null ? { gte: range.min } : {}),
        ...(range.max !== null ? { lte: range.max } : {}),
      },
    } as Prisma.ProductVariantWhereInput
  }

  return {
    [field]: {
      in: normalizeStringArray(selection),
    },
  } as Prisma.ProductVariantWhereInput
}

function applyOfferFacetWhere(
  facet: FacetRegistryRecord,
  selection: unknown,
  supplierProductWhere: Prisma.SupplierProductWhereInput,
  offerWhere: Prisma.OfferWhereInput
) {
  if (!hasFacetSelection(facet, selection) || !facet.dataSource.startsWith('offer.')) return

  const field = facet.dataSource.replace('offer.', '')
  const pushOfferAnd = (condition: Prisma.OfferWhereInput) => {
    offerWhere.AND = [...(Array.isArray(offerWhere.AND) ? offerWhere.AND : []), condition]
  }

  if (field === 'supplierId') {
    supplierProductWhere.supplierId = { in: normalizeStringArray(selection) }
    return
  }

  if (field === 'availability') {
    const values = normalizeStringArray(selection)
    const or: Prisma.OfferWhereInput[] = []
    if (values.includes('ACTIVE')) {
      or.push({
        isAvailable: true,
        OR: [
          { stockAvailable: { gt: 0 } },
          { availabilityLevel: { in: [OfferAvailabilityLevel.IN_STOCK, OfferAvailabilityLevel.LOW_STOCK] } },
        ],
      })
    }
    if (values.includes('ORDERABLE')) {
      or.push({ isAvailable: true })
    }
    if (values.includes('SOLD_OUT')) {
      or.push({ availabilityLevel: OfferAvailabilityLevel.OUT_OF_STOCK })
    }
    if (values.includes('UNAVAILABLE')) {
      or.push({ isAvailable: false })
    }
    if (or.length) pushOfferAnd({ OR: or })
    return
  }

  if (field === 'deliveryDays') {
    const values = normalizeStringArray(selection)
    const or: Prisma.OfferWhereInput[] = []
    if (values.includes('today')) or.push({ deliveryDaysMax: { lte: 0 } })
    if (values.includes('tomorrow')) or.push({ deliveryDaysMax: 1 })
    if (values.includes('up_to_3')) or.push({ deliveryDaysMax: { lte: 3 } })
    if (values.includes('up_to_7')) or.push({ deliveryDaysMax: { lte: 7 } })
    if (or.length) pushOfferAnd({ OR: or })
    return
  }

  if (field === 'stockLevel') {
    const values = normalizeStringArray(selection)
    const or: Prisma.OfferWhereInput[] = []
    if (values.includes('limited')) or.push({ stockAvailable: { gt: 0, lte: 6 } })
    if (values.includes('high')) or.push({ stockAvailable: { gt: 6 } })
    if (or.length) pushOfferAnd({ OR: or })
    return
  }

  if (facet.type === FacetType.RANGE) {
    const range = normalizeRange(selection)
    if (!range) return
    pushOfferAnd({
      [field]: {
        ...(range.min !== null ? { gte: range.min } : {}),
        ...(range.max !== null ? { lte: range.max } : {}),
      },
    } as Prisma.OfferWhereInput)
    return
  }

  pushOfferAnd({
    [field]: {
      in: normalizeStringArray(selection),
    },
  } as Prisma.OfferWhereInput)
}

export async function buildCatalogFacetProductWhere(
  query: CatalogFacetEngineQuery
): Promise<Prisma.ProductWhereInput> {
  const scope = normalizeScope(query.scope)
  const facets = await loadFacetRegistryEntries(scope, query.categoryId)
  const selectedFacets = query.selectedFacets ?? {}
  const and: Prisma.ProductWhereInput[] = []
  const variantAnd: Prisma.ProductVariantWhereInput[] = []
  const supplierProductWhere: Prisma.SupplierProductWhereInput = {
    ...(scope === FacetScope.CATALOG ? PUBLIC_SUPPLIER_PRODUCT_WHERE : {}),
  }
  const offerWhere: Prisma.OfferWhereInput = {
    ...(scope === FacetScope.CATALOG ? PUBLIC_OFFER_WHERE : {}),
  }

  for (const facet of facets) {
    const selection = selectedFacets[facet.key]
    const productWhere = buildProductFacetWhere(facet, selection)
    if (productWhere) and.push(productWhere)

    const variantWhere = buildVariantFacetCondition(facet, selection)
    if (variantWhere) variantAnd.push(variantWhere)

    applyOfferFacetWhere(facet, selection, supplierProductWhere, offerWhere)
  }

  if (variantAnd.length) {
    and.push({
      variants: {
        some: {
          AND: variantAnd,
        },
      },
    })
  }

  if (Object.keys(offerWhere).length) {
    supplierProductWhere.offers = { some: offerWhere }
  }

  if (Object.keys(supplierProductWhere).length) {
    and.push({
      supplierProducts: {
        some: supplierProductWhere,
      },
    })
  }

  return {
    ...(scope === FacetScope.CATALOG ? PUBLIC_PRODUCT_WHERE : {}),
    ...(and.length ? { AND: and } : {}),
  }
}
