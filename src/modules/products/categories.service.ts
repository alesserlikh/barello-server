import {
  getCatalogCategories,
  getCatalogFilters,
  GetCatalogCategoriesOptions,
} from './catalog-data.service'

export async function getAllCategories(options?: GetCatalogCategoriesOptions) {
  return getCatalogCategories(options)
}

export async function getCategoryFilters() {
  return getCatalogFilters()
}
