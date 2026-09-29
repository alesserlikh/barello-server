import { FacetScope, Prisma } from '../../../generated/prisma'
import { prisma } from '../../../lib/prisma'
import { CatalogFacetDto, CatalogFacetSelectedValues } from '../facet-shared'
import {
  buildSingleHopFacetWhere,
  getSingleHopFacets,
  SingleHopFacetQuery,
  SingleHopRecord,
} from './single-hop-facet-adapter'

const NATIVE_PREFIX = 'stock'

export type VenueStockFacetQuery = SingleHopFacetQuery & {
  venueId: string
}

async function loadRecords(venueId: string, categoryIds: string[], search?: string | null): Promise<SingleHopRecord[]> {
  const items = await prisma.inventoryItem.findMany({
    where: {
      venueId,
      ...(categoryIds.length ? { product: { categoryId: { in: categoryIds } } } : {}),
      ...(search?.trim()
        ? {
            OR: [
              { name: { contains: search.trim(), mode: 'insensitive' } },
              { product: { name: { contains: search.trim(), mode: 'insensitive' } } },
            ],
          }
        : {}),
    },
    include: { product: true },
  })

  return items as unknown as SingleHopRecord[]
}

export async function getVenueStockFacets(query: VenueStockFacetQuery): Promise<{
  facets: CatalogFacetDto[]
  appliedFacets: CatalogFacetSelectedValues
}> {
  return getSingleHopFacets({
    scope: FacetScope.VENUE_STOCK,
    nativePrefix: NATIVE_PREFIX,
    query,
    loadRecords: (categoryIds, search) => loadRecords(query.venueId, categoryIds, search),
  })
}

export async function buildVenueStockItemWhere(query: VenueStockFacetQuery): Promise<Prisma.InventoryItemWhereInput> {
  const facetWhere = await buildSingleHopFacetWhere({
    scope: FacetScope.VENUE_STOCK,
    nativePrefix: NATIVE_PREFIX,
    query,
  })

  return {
    venueId: query.venueId,
    ...facetWhere,
  } as Prisma.InventoryItemWhereInput
}
