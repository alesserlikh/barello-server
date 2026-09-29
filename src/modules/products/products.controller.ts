import { Router } from 'express'
import {
  buildCatalogItemResponse,
  buildCatalogListResponse,
  CatalogRequestError,
  parseAvailability,
  parseOptionalEnumStringList,
  parseOptionalEntityIdList,
  parseOptionalBooleanString,
  parseOptionalEntityId,
  parseOptionalUuid,
  parseOptionalUuidList,
  parseNonNegativeIntegerWithDefault,
  parsePositiveIntegerWithDefault,
} from './catalog-contract'
import { getAllProducts, getProductById } from './products.service'

const productsRouter = Router()
const DEFAULT_OFFSET = 0
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

productsRouter.get('/', async (req, res) => {
  try {
    const searchSource =
      typeof req.query.search === 'string'
        ? req.query.search
        : typeof req.query.query === 'string'
          ? req.query.query
          : undefined
    const search = searchSource?.trim() ? searchSource.trim() : undefined
    const categoryId = parseOptionalUuid(req.query.categoryId, 'categoryId')
    const categoryIds = parseOptionalUuidList(req.query.categoryIds, 'categoryIds')
    const sections = parseOptionalEnumStringList(req.query.sections, 'sections', [
      'ALCOHOL',
      'DRINKS_FOOD',
      'NONFOOD',
    ] as const)
    const supplierId = parseOptionalEntityId(req.query.supplierId, 'supplierId')
    const supplierIds = parseOptionalEntityIdList(req.query.supplierIds, 'supplierIds')
    const availability = parseAvailability(req.query.availability)
    const deliveryDays = parseOptionalEnumStringList(req.query.deliveryDays, 'deliveryDays', [
      'today',
      'tomorrow',
      'up_to_3',
      'up_to_7',
    ] as const)
    const stockLevels = parseOptionalEnumStringList(req.query.stockLevels, 'stockLevels', [
      'high',
      'limited',
    ] as const)
    const isPromo = parseOptionalBooleanString(req.query.isPromo, 'isPromo')
    const sort =
      typeof req.query.sort === 'string' && req.query.sort.trim()
        ? req.query.sort.trim()
        : undefined
    const legacyPage = req.query.page === undefined
      ? undefined
      : parsePositiveIntegerWithDefault(req.query.page, 'page', 1)
    const legacyPageSize = req.query.pageSize === undefined
      ? undefined
      : parsePositiveIntegerWithDefault(req.query.pageSize, 'pageSize', DEFAULT_LIMIT, MAX_LIMIT)
    const limit = parsePositiveIntegerWithDefault(
      req.query.limit ?? req.query.pageSize,
      req.query.limit === undefined ? 'pageSize' : 'limit',
      DEFAULT_LIMIT,
      MAX_LIMIT
    )
    const offset = req.query.offset === undefined && legacyPage && legacyPageSize
      ? (legacyPage - 1) * legacyPageSize
      : parseNonNegativeIntegerWithDefault(req.query.offset, 'offset', DEFAULT_OFFSET)

    const products = await getAllProducts({
      search,
      query: search,
      categoryId,
      categoryIds,
      sections,
      supplierId,
      supplierIds,
      availability,
      deliveryDays,
      stockLevels,
      isPromo,
      sort,
      offset,
      limit,
      page: legacyPage,
      pageSize: legacyPageSize,
    })

    res.status(200).json(
      buildCatalogListResponse(products.items, {
        total: products.total,
        offset: products.offset,
        limit: products.limit,
        hasMore: products.hasMore,
        query: {
          search: search ?? null,
          query: search ?? null,
          categoryId: categoryId ?? null,
          categoryIds: categoryIds ?? [],
          sections: sections ?? [],
          supplierId: supplierId ?? null,
          supplierIds: supplierIds ?? [],
          availability: availability ?? null,
          deliveryDays: deliveryDays ?? [],
          stockLevels: stockLevels ?? [],
          isPromo: isPromo ?? null,
          sort: sort ?? null,
          offset,
          limit,
          page: legacyPage ?? Math.floor(offset / limit) + 1,
          pageSize: legacyPageSize ?? limit,
        },
      })
    )
  } catch (error) {
    if (error instanceof CatalogRequestError) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    console.error('GET /products failed:', error)
    res.status(500).json({
      ok: false,
      error: 'Не удалось загрузить товары',
    })
  }
})

productsRouter.get('/suggestions', async (req, res) => {
  try {
    const query = typeof req.query.query === 'string' ? req.query.query.trim() : ''
    const limit = parsePositiveIntegerWithDefault(req.query.limit, 'limit', 10, 20)

    if (!query) {
      res.status(400).json({
        ok: false,
        error: {
          code: 'CATALOG_SUGGESTIONS_QUERY_REQUIRED',
          message: 'query is required',
        },
      })
      return
    }

    const products = await getAllProducts({
      search: query,
      query,
      offset: 0,
      limit,
    })

    res.status(200).json({
      ok: true,
      data: {
        items: products.items.slice(0, limit).map((item) => ({
          id: item.id,
          label: item.title,
          type: 'PRODUCT',
          productId: item.id,
          categoryId: item.category?.id ?? null,
          supplierId: null,
          skuId: null,
        })),
      },
    })
  } catch (error) {
    console.error('GET /products/suggestions failed:', error)
    res.status(500).json({
      ok: false,
      error: {
        code: 'CATALOG_SUGGESTIONS_FAILED',
        message: 'Не удалось загрузить подсказки',
      },
    })
  }
})

productsRouter.get('/sku-search', async (req, res) => {
  try {
    const query = typeof req.query.query === 'string' ? req.query.query.trim() : ''
    const limit = parsePositiveIntegerWithDefault(req.query.limit, 'limit', DEFAULT_LIMIT, MAX_LIMIT)
    const offset = parseNonNegativeIntegerWithDefault(req.query.offset, 'offset', DEFAULT_OFFSET)

    if (!query) {
      res.status(400).json({
        ok: false,
        error: {
          code: 'CATALOG_SKU_SEARCH_QUERY_REQUIRED',
          message: 'query is required',
        },
      })
      return
    }

    const products = await getAllProducts({
      search: query,
      query,
      offset,
      limit,
    })
    const exactMatch = products.items.find((item) => {
      return (
        item.article === query ||
        item.barcode === query
      )
    }) ?? null

    res.status(200).json({
      ok: true,
      data: {
        exactMatch,
        similarItems: products.items.filter((item) => item.id !== exactMatch?.id),
      },
      meta: {
        offset: products.offset,
        limit: products.limit,
        total: products.total,
        hasMore: products.hasMore,
      },
    })
  } catch (error) {
    console.error('GET /products/sku-search failed:', error)
    res.status(500).json({
      ok: false,
      error: {
        code: 'CATALOG_SKU_SEARCH_FAILED',
        message: 'Не удалось выполнить поиск по SKU',
      },
    })
  }
})

productsRouter.get('/:id', async (req, res) => {
  try {
    const product = await getProductById(req.params.id)

    if (!product) {
      res.status(404).json({
        ok: false,
        error: 'Товар не найден',
      })
      return
    }

    res.status(200).json(buildCatalogItemResponse(product))
  } catch (error) {
    console.error('GET /products/:id failed:', error)
    res.status(500).json({
      ok: false,
      error: 'Не удалось загрузить товар',
    })
  }
})

export default productsRouter
