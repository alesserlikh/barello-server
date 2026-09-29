import {
  getCatalogProductById,
  getCatalogProducts,
} from './catalog-data.service'
import { ProductsQuery } from './products.types'

export async function getAllProducts(query: ProductsQuery) {
  return getCatalogProducts(query)
}

export async function getProductById(id: string) {
  return getCatalogProductById(id)
}
