import { FacetType, Prisma } from '../../../generated/prisma'
import {
  CatalogFacetDto,
  CatalogFacetSelectedValues,
  computeScopeFacets,
  FacetRegistryRecord,
  hasFacetSelection,
  loadFacetRegistryEntries,
  matchesRangeValue,
  matchesValueSelection,
  normalizeRange,
  normalizeStringArray,
  readProductLikeFieldValue,
  resolveCategorySubtreeIds,
} from '../facet-shared'

/**
 * Generic adapter for scopes backed by a single row with a nullable `productId` FK and no
 * variant/offer sub-entity (InventoryItem -> VENUE_STOCK, SupplierInventoryItem ->
 * SUPPLIER_STOCK, MenuItem -> MENU). `product.*` facets read through the joined Product;
 * `<nativePrefix>.*` facets (e.g. `stock.quantity`, `menu.price`) read the row itself.
 *
 * Where clauses are built as plain records and cast to the caller's specific
 * Prisma `*WhereInput` type at the call site, since the three concrete models don't
 * share a Prisma-generated type to genericize over.
 */
export type SingleHopRecord = {
  id: string
  product: (Record<string, unknown> & { attributesJson?: Prisma.JsonValue | null }) | null
} & Record<string, unknown>

export type SingleHopFacetQuery = {
  categoryId?: string | null
  search?: string | null
  selectedFacets?: CatalogFacetSelectedValues | null
  includeHiddenFacets?: boolean
}

function readSingleHopFieldValues(record: SingleHopRecord, facet: FacetRegistryRecord, nativePrefix: string) {
  if (facet.dataSource.startsWith('product.')) {
    if (!record.product) return []
    const value = readProductLikeFieldValue(record.product, facet.dataSource)
    return value ? [value] : []
  }

  if (facet.dataSource.startsWith(`${nativePrefix}.`)) {
    const field = facet.dataSource.replace(`${nativePrefix}.`, '')
    const value = record[field]
    if (value === null || value === undefined || Array.isArray(value)) return []
    return [String(value)]
  }

  return []
}

function singleHopMatchesFacet(
  record: SingleHopRecord,
  facet: FacetRegistryRecord,
  selection: unknown,
  nativePrefix: string
) {
  if (!hasFacetSelection(facet, selection)) return true
  const value = readSingleHopFieldValues(record, facet, nativePrefix)[0] ?? null
  return facet.type === FacetType.RANGE
    ? matchesRangeValue(value, selection)
    : matchesValueSelection(value, selection)
}

export async function getSingleHopFacets(params: {
  scope: Parameters<typeof loadFacetRegistryEntries>[0]
  nativePrefix: string
  query: SingleHopFacetQuery
  loadRecords: (categoryIds: string[], search?: string | null) => Promise<SingleHopRecord[]>
}): Promise<{ facets: CatalogFacetDto[]; appliedFacets: CatalogFacetSelectedValues }> {
  const selectedFacets = params.query.selectedFacets ?? {}
  const facets = await loadFacetRegistryEntries(params.scope, params.query.categoryId)
  const categoryIds = await resolveCategorySubtreeIds(params.query.categoryId)
  const records = await params.loadRecords(categoryIds, params.query.search)

  return computeScopeFacets({
    facets,
    records,
    selectedFacets,
    includeHiddenFacets: params.query.includeHiddenFacets,
    readValues: (record, facet) => readSingleHopFieldValues(record, facet, params.nativePrefix),
    matchesOtherSelections: (record, allFacets, selected, ignoredFacetKey) => {
      for (const facet of allFacets) {
        if (facet.key === ignoredFacetKey) continue
        if (!singleHopMatchesFacet(record, facet, selected[facet.key], params.nativePrefix)) return false
      }
      return true
    },
  })
}

function buildSingleHopFieldWhere(
  facet: FacetRegistryRecord,
  selection: unknown,
  nativePrefix: string
): Record<string, unknown> | null {
  if (!hasFacetSelection(facet, selection)) return null

  if (facet.dataSource.startsWith('product.')) {
    const field = facet.dataSource.replace('product.', '')

    if (facet.type === FacetType.RANGE) {
      const range = normalizeRange(selection)
      if (!range || field.startsWith('attributesJson.')) return null
      return {
        product: {
          [field]: {
            ...(range.min !== null ? { gte: range.min } : {}),
            ...(range.max !== null ? { lte: range.max } : {}),
          },
        },
      }
    }

    if (field.startsWith('attributesJson.')) {
      const path = field.replace('attributesJson.', '').split('.')
      const values = normalizeStringArray(selection)
      return {
        product: {
          OR: values.flatMap((value) => [
            { attributesJson: { path, equals: value } },
            { attributesJson: { path, array_contains: [value] } },
          ]),
        },
      }
    }

    return { product: { [field]: { in: normalizeStringArray(selection) } } }
  }

  if (facet.dataSource.startsWith(`${nativePrefix}.`)) {
    const field = facet.dataSource.replace(`${nativePrefix}.`, '')

    if (facet.type === FacetType.RANGE) {
      const range = normalizeRange(selection)
      if (!range) return null
      return {
        [field]: {
          ...(range.min !== null ? { gte: range.min } : {}),
          ...(range.max !== null ? { lte: range.max } : {}),
        },
      }
    }

    if (facet.type === FacetType.TOGGLE) {
      return { [field]: true }
    }

    return { [field]: { in: normalizeStringArray(selection) } }
  }

  return null
}

export async function buildSingleHopFacetWhere(params: {
  scope: Parameters<typeof loadFacetRegistryEntries>[0]
  nativePrefix: string
  query: SingleHopFacetQuery
}): Promise<Record<string, unknown>> {
  const facets = await loadFacetRegistryEntries(params.scope, params.query.categoryId)
  const selectedFacets = params.query.selectedFacets ?? {}
  const and: Record<string, unknown>[] = []

  for (const facet of facets) {
    const where = buildSingleHopFieldWhere(facet, selectedFacets[facet.key], params.nativePrefix)
    if (where) and.push(where)
  }

  return and.length ? { AND: and } : {}
}
