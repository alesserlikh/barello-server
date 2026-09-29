import { FacetScope, FacetType, Prisma } from '../../../generated/prisma'
import { prisma } from '../../../lib/prisma'
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
 * INVENTORY (stocktake/revision) scope. Two hops to Product: InventorySessionItem ->
 * InventoryItem -> Product. Adds a computed `session_item.status` facet (NOT_IN_CATALOG /
 * NOT_COUNTED / DISCREPANCY / MATCHES) since a revision screen's main filtering need is
 * these derived states, not raw field equality — see design doc: "не посчитано",
 * "расхождение", "нет в каталоге".
 */

export const SESSION_ITEM_STATUS = {
  NOT_IN_CATALOG: 'NOT_IN_CATALOG',
  NOT_COUNTED: 'NOT_COUNTED',
  DISCREPANCY: 'DISCREPANCY',
  MATCHES: 'MATCHES',
} as const

type InventorySessionItemRecord = {
  id: string
  actualQty: Prisma.Decimal | null
  differenceQty: Prisma.Decimal | null
  expectedQty: Prisma.Decimal
  inventoryItem: {
    productId: string | null
    quantity: Prisma.Decimal
    unit: string
    isOutOfStock: boolean
    product: (Record<string, unknown> & { attributesJson?: Prisma.JsonValue | null }) | null
  }
} & Record<string, unknown>

export type InventoryFacetQuery = {
  sessionId: string
  categoryId?: string | null
  search?: string | null
  selectedFacets?: CatalogFacetSelectedValues | null
  includeHiddenFacets?: boolean
}

function computeSessionItemStatus(record: InventorySessionItemRecord): string {
  if (!record.inventoryItem.productId) return SESSION_ITEM_STATUS.NOT_IN_CATALOG
  if (record.actualQty === null) return SESSION_ITEM_STATUS.NOT_COUNTED
  if (record.differenceQty !== null && Number(record.differenceQty) !== 0) return SESSION_ITEM_STATUS.DISCREPANCY
  return SESSION_ITEM_STATUS.MATCHES
}

function readInventoryFieldValues(record: InventorySessionItemRecord, facet: FacetRegistryRecord): string[] {
  if (facet.dataSource.startsWith('product.')) {
    if (!record.inventoryItem.product) return []
    const value = readProductLikeFieldValue(record.inventoryItem.product, facet.dataSource)
    return value ? [value] : []
  }

  if (facet.dataSource.startsWith('stock.')) {
    const field = facet.dataSource.replace('stock.', '')
    const value = (record.inventoryItem as unknown as Record<string, unknown>)[field]
    if (value === null || value === undefined || Array.isArray(value)) return []
    return [String(value)]
  }

  if (facet.dataSource === 'session_item.status') {
    return [computeSessionItemStatus(record)]
  }

  if (facet.dataSource.startsWith('session_item.')) {
    const field = facet.dataSource.replace('session_item.', '')
    const value = record[field]
    if (value === null || value === undefined || Array.isArray(value)) return []
    return [String(value)]
  }

  return []
}

function inventoryMatchesFacet(record: InventorySessionItemRecord, facet: FacetRegistryRecord, selection: unknown) {
  if (!hasFacetSelection(facet, selection)) return true
  const value = readInventoryFieldValues(record, facet)[0] ?? null
  return facet.type === FacetType.RANGE
    ? matchesRangeValue(value, selection)
    : matchesValueSelection(value, selection)
}

async function loadRecords(
  sessionId: string,
  categoryIds: string[],
  search?: string | null
): Promise<InventorySessionItemRecord[]> {
  const items = await prisma.inventorySessionItem.findMany({
    where: {
      sessionId,
      ...(categoryIds.length ? { inventoryItem: { product: { categoryId: { in: categoryIds } } } } : {}),
      ...(search?.trim()
        ? {
            inventoryItem: {
              OR: [
                { name: { contains: search.trim(), mode: 'insensitive' } },
                { product: { name: { contains: search.trim(), mode: 'insensitive' } } },
              ],
            },
          }
        : {}),
    },
    include: {
      inventoryItem: {
        include: { product: true },
      },
    },
  })

  return items as unknown as InventorySessionItemRecord[]
}

export async function getInventoryFacets(query: InventoryFacetQuery): Promise<{
  facets: CatalogFacetDto[]
  appliedFacets: CatalogFacetSelectedValues
}> {
  const selectedFacets = query.selectedFacets ?? {}
  const facets = await loadFacetRegistryEntries(FacetScope.INVENTORY, query.categoryId)
  const categoryIds = await resolveCategorySubtreeIds(query.categoryId)
  const records = await loadRecords(query.sessionId, categoryIds, query.search)

  return computeScopeFacets({
    facets,
    records,
    selectedFacets,
    includeHiddenFacets: query.includeHiddenFacets,
    readValues: readInventoryFieldValues,
    matchesOtherSelections: (record, allFacets, selected, ignoredFacetKey) => {
      for (const facet of allFacets) {
        if (facet.key === ignoredFacetKey) continue
        if (!inventoryMatchesFacet(record, facet, selected[facet.key])) return false
      }
      return true
    },
  })
}

function buildSessionItemStatusWhere(selection: unknown): Prisma.InventorySessionItemWhereInput | null {
  const values = normalizeStringArray(selection)
  if (!values.length) return null

  const or: Prisma.InventorySessionItemWhereInput[] = []
  if (values.includes(SESSION_ITEM_STATUS.NOT_IN_CATALOG)) {
    or.push({ inventoryItem: { productId: null } })
  }
  if (values.includes(SESSION_ITEM_STATUS.NOT_COUNTED)) {
    or.push({ inventoryItem: { productId: { not: null } }, actualQty: null })
  }
  if (values.includes(SESSION_ITEM_STATUS.DISCREPANCY)) {
    or.push({
      inventoryItem: { productId: { not: null } },
      actualQty: { not: null },
      NOT: { differenceQty: 0 },
    })
  }
  if (values.includes(SESSION_ITEM_STATUS.MATCHES)) {
    or.push({
      inventoryItem: { productId: { not: null } },
      actualQty: { not: null },
      differenceQty: 0,
    })
  }

  return or.length ? { OR: or } : null
}

function buildInventoryFieldWhere(
  facet: FacetRegistryRecord,
  selection: unknown
): Prisma.InventorySessionItemWhereInput | null {
  if (!hasFacetSelection(facet, selection)) return null

  if (facet.dataSource === 'session_item.status') {
    return buildSessionItemStatusWhere(selection)
  }

  if (facet.dataSource.startsWith('product.')) {
    const field = facet.dataSource.replace('product.', '')

    if (facet.type === FacetType.RANGE) {
      const range = normalizeRange(selection)
      if (!range || field.startsWith('attributesJson.')) return null
      return {
        inventoryItem: {
          product: {
            [field]: {
              ...(range.min !== null ? { gte: range.min } : {}),
              ...(range.max !== null ? { lte: range.max } : {}),
            },
          },
        },
      } as Prisma.InventorySessionItemWhereInput
    }

    if (field.startsWith('attributesJson.')) {
      const path = field.replace('attributesJson.', '').split('.')
      const values = normalizeStringArray(selection)
      return {
        inventoryItem: {
          product: {
            OR: values.flatMap((value) => [
              { attributesJson: { path, equals: value } },
              { attributesJson: { path, array_contains: [value] } },
            ]),
          },
        },
      } as Prisma.InventorySessionItemWhereInput
    }

    return {
      inventoryItem: { product: { [field]: { in: normalizeStringArray(selection) } } },
    } as Prisma.InventorySessionItemWhereInput
  }

  if (facet.dataSource.startsWith('stock.')) {
    const field = facet.dataSource.replace('stock.', '')

    if (facet.type === FacetType.RANGE) {
      const range = normalizeRange(selection)
      if (!range) return null
      return {
        inventoryItem: {
          [field]: {
            ...(range.min !== null ? { gte: range.min } : {}),
            ...(range.max !== null ? { lte: range.max } : {}),
          },
        },
      } as Prisma.InventorySessionItemWhereInput
    }

    if (facet.type === FacetType.TOGGLE) {
      return { inventoryItem: { [field]: true } } as Prisma.InventorySessionItemWhereInput
    }

    return {
      inventoryItem: { [field]: { in: normalizeStringArray(selection) } },
    } as Prisma.InventorySessionItemWhereInput
  }

  if (facet.dataSource.startsWith('session_item.')) {
    const field = facet.dataSource.replace('session_item.', '')

    if (facet.type === FacetType.RANGE) {
      const range = normalizeRange(selection)
      if (!range) return null
      return {
        [field]: {
          ...(range.min !== null ? { gte: range.min } : {}),
          ...(range.max !== null ? { lte: range.max } : {}),
        },
      } as Prisma.InventorySessionItemWhereInput
    }

    return { [field]: { in: normalizeStringArray(selection) } } as Prisma.InventorySessionItemWhereInput
  }

  return null
}

export async function buildInventorySessionItemWhere(
  query: InventoryFacetQuery
): Promise<Prisma.InventorySessionItemWhereInput> {
  const facets = await loadFacetRegistryEntries(FacetScope.INVENTORY, query.categoryId)
  const selectedFacets = query.selectedFacets ?? {}
  const and: Prisma.InventorySessionItemWhereInput[] = []

  for (const facet of facets) {
    const where = buildInventoryFieldWhere(facet, selectedFacets[facet.key])
    if (where) and.push(where)
  }

  return {
    sessionId: query.sessionId,
    ...(and.length ? { AND: and } : {}),
  }
}
