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

export type SupplierStockFacetQuery = SingleHopFacetQuery & {
  supplierId: string
}

async function loadRecords(supplierId: string, categoryIds: string[], search?: string | null): Promise<SingleHopRecord[]> {
  const items = await prisma.supplierInventoryItem.findMany({
    where: {
      supplierId,
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

export async function getSupplierStockFacets(query: SupplierStockFacetQuery): Promise<{
  facets: CatalogFacetDto[]
  appliedFacets: CatalogFacetSelectedValues
}> {
  return getSingleHopFacets({
    scope: FacetScope.SUPPLIER_STOCK,
    nativePrefix: NATIVE_PREFIX,
    query,
    loadRecords: (categoryIds, search) => loadRecords(query.supplierId, categoryIds, search),
  })
}

export async function buildSupplierStockItemWhere(
  query: SupplierStockFacetQuery
): Promise<Prisma.SupplierInventoryItemWhereInput> {
  const facetWhere = await buildSingleHopFacetWhere({
    scope: FacetScope.SUPPLIER_STOCK,
    nativePrefix: NATIVE_PREFIX,
    query,
  })

  return {
    supplierId: query.supplierId,
    ...facetWhere,
  } as Prisma.SupplierInventoryItemWhereInput
}
