import { Router } from 'express'

import { FacetScope } from '../../generated/prisma'
import { requireAuth } from '../../middleware/auth'
import {
  buildCatalogFacetProductWhere,
  CatalogFacetSelectedValues,
  getCatalogFacets,
} from '../catalog-filters/catalog-filter-engine.service'
import { FacetQueryError, parseFacetSelectionFromQuery } from '../catalog-filters/facet-shared'
import {
  CatalogRequestError,
  parseNonNegativeIntegerWithDefault,
  parseOptionalUuidList,
  parsePositiveIntegerWithDefault,
} from '../products/catalog-contract'
import { getCatalogProducts } from '../products/catalog-data.service'
import { getAllCategories } from '../products/categories.service'
import {
  getCatalogFilterPreferences,
  updateCatalogFilterPreferences,
} from './catalog-filter-preferences.service'

const catalogRouter = Router()
const DEFAULT_OFFSET = 0
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

function normalizeSearch(query: Record<string, unknown>) {
  const source =
    typeof query.q === 'string'
      ? query.q
      : typeof query.search === 'string'
        ? query.search
        : typeof query.query === 'string'
          ? query.query
          : undefined
  return source?.trim() || undefined
}

function normalizeCategoryId(query: Record<string, unknown>) {
  return typeof query.categoryId === 'string' && query.categoryId.trim()
    ? query.categoryId.trim()
    : undefined
}

function normalizeCategoryIds(query: Record<string, unknown>) {
  return Array.from(new Set([
    ...(parseOptionalUuidList(query.categoryIds, 'categoryIds') ?? []),
    ...(parseOptionalUuidList(query.categories, 'categories') ?? []),
  ]))
}

function normalizeSort(query: Record<string, unknown>) {
  return typeof query.sort === 'string' && query.sort.trim()
    ? query.sort.trim()
    : undefined
}

function parseFacets(query: Record<string, unknown>): CatalogFacetSelectedValues {
  try {
    return parseFacetSelectionFromQuery(query)
  } catch (error) {
    if (error instanceof FacetQueryError) {
      throw new CatalogRequestError(400, error.message)
    }
    throw error
  }
}

function parseCatalogQuery(query: Record<string, unknown>) {
  return {
    scope: FacetScope.CATALOG,
    categoryId: normalizeCategoryId(query),
    categoryIds: normalizeCategoryIds(query),
    search: normalizeSearch(query),
    selectedFacets: parseFacets(query),
    sort: normalizeSort(query),
    offset: parseNonNegativeIntegerWithDefault(query.offset, 'offset', DEFAULT_OFFSET),
    limit: parsePositiveIntegerWithDefault(query.limit, 'limit', DEFAULT_LIMIT, MAX_LIMIT),
  }
}

catalogRouter.get('/facets', async (req, res, next) => {
  try {
    const query = parseCatalogQuery(req.query)
    const facets = await getCatalogFacets({
      scope: query.scope,
      categoryId: query.categoryId,
      categoryIds: query.categoryIds,
      search: query.search,
      selectedFacets: query.selectedFacets,
    })

    res.status(200).json({
      ok: true,
      facets: facets.facets,
      appliedFacets: facets.appliedFacets,
    })
  } catch (error) {
    if (error instanceof CatalogRequestError) {
      res.status(error.status).json({ ok: false, error: error.message })
      return
    }
    next(error)
  }
})

catalogRouter.get('/filter-preferences', requireAuth, async (req, res, next) => {
  try {
    const preferences = await getCatalogFilterPreferences(req.auth!)

    res.status(200).json({
      ok: true,
      ...preferences,
    })
  } catch (error) {
    next(error)
  }
})

catalogRouter.patch('/filter-preferences', requireAuth, async (req, res, next) => {
  try {
    const preferences = await updateCatalogFilterPreferences(req.auth!, req.body ?? {})

    res.status(200).json({
      ok: true,
      ...preferences,
    })
  } catch (error) {
    next(error)
  }
})

catalogRouter.get('/categories/tree', async (_req, res, next) => {
  try {
    const categories = await getAllCategories({
      includeChildren: true,
      includeCode: true,
      includeProductsCount: true,
    })

    res.status(200).json({
      ok: true,
      items: categories,
    })
  } catch (error) {
    next(error)
  }
})

catalogRouter.get('/products', async (req, res, next) => {
  try {
    const query = parseCatalogQuery(req.query)
    const [facetProductWhere, facets] = await Promise.all([
      buildCatalogFacetProductWhere({
        scope: query.scope,
        categoryId: query.categoryId,
        categoryIds: query.categoryIds,
        search: query.search,
        selectedFacets: query.selectedFacets,
      }),
      getCatalogFacets({
        scope: query.scope,
        categoryId: query.categoryId,
        categoryIds: query.categoryIds,
        search: query.search,
        selectedFacets: query.selectedFacets,
      }),
    ])
    const products = await getCatalogProducts({
      search: query.search,
      query: query.search,
      categoryId: query.categoryId,
      categoryIds: query.categoryIds,
      sort: query.sort,
      offset: query.offset,
      limit: query.limit,
      facetProductWhere,
    })

    res.status(200).json({
      ok: true,
      items: products.items,
      facets: facets.facets,
      appliedFacets: facets.appliedFacets,
      total: products.total,
      offset: products.offset,
      limit: products.limit,
      hasMore: products.hasMore,
      query: {
        scope: query.scope,
        categoryId: query.categoryId ?? null,
        categoryIds: query.categoryIds,
        categories: query.categoryIds,
        q: query.search ?? null,
        facets: query.selectedFacets,
        sort: query.sort ?? null,
        offset: query.offset,
        limit: query.limit,
      },
      appliedCategoryIds: products.appliedCategoryIds,
    })
  } catch (error) {
    if (error instanceof CatalogRequestError) {
      res.status(error.status).json({ ok: false, error: error.message })
      return
    }
    next(error)
  }
})

export default catalogRouter
