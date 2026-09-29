import { FacetScope, Prisma } from '../../../generated/prisma'
import { prisma } from '../../../lib/prisma'
import { CatalogFacetDto, CatalogFacetSelectedValues } from '../facet-shared'
import {
  buildSingleHopFacetWhere,
  getSingleHopFacets,
  SingleHopFacetQuery,
  SingleHopRecord,
} from './single-hop-facet-adapter'

const NATIVE_PREFIX = 'menu'

export type MenuFacetQuery = SingleHopFacetQuery & {
  venueId: string
}

async function loadRecords(venueId: string, categoryIds: string[], search?: string | null): Promise<SingleHopRecord[]> {
  const items = await prisma.menuItem.findMany({
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

export async function getMenuFacets(query: MenuFacetQuery): Promise<{
  facets: CatalogFacetDto[]
  appliedFacets: CatalogFacetSelectedValues
}> {
  return getSingleHopFacets({
    scope: FacetScope.MENU,
    nativePrefix: NATIVE_PREFIX,
    query,
    loadRecords: (categoryIds, search) => loadRecords(query.venueId, categoryIds, search),
  })
}

export async function buildMenuItemWhere(query: MenuFacetQuery): Promise<Prisma.MenuItemWhereInput> {
  const facetWhere = await buildSingleHopFacetWhere({
    scope: FacetScope.MENU,
    nativePrefix: NATIVE_PREFIX,
    query,
  })

  return {
    venueId: query.venueId,
    ...facetWhere,
  } as Prisma.MenuItemWhereInput
}
