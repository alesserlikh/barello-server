import type { Prisma } from '../../generated/prisma'
import type { CatalogCategorySection } from '../../generated/prisma'

export type ProductsQuery = {
  search?: string
  query?: string
  categoryId?: string
  categoryIds?: string[]
  sections?: CatalogCategorySection[]
  supplierId?: string
  supplierIds?: string[]
  availability?: Array<'ACTIVE' | 'ORDERABLE' | 'SOLD_OUT' | 'UNAVAILABLE'>
  deliveryDays?: Array<'today' | 'tomorrow' | 'up_to_3' | 'up_to_7'>
  stockLevels?: Array<'high' | 'limited'>
  isPromo?: string
  sort?: string
  offset?: number
  limit?: number
  page?: number
  pageSize?: number
  facetProductWhere?: Prisma.ProductWhereInput
}
