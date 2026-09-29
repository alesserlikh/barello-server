import { Router } from 'express'
import {
  buildCatalogDataResponse,
  buildCatalogListResponse,
  CatalogRequestError,
  parseBooleanFlag,
  parsePositiveInteger,
} from './catalog-contract'
import { getAllCategories, getCategoryFilters } from './categories.service'

const publicCategoriesRouter = Router()

publicCategoriesRouter.get('/tree', async (_req, res) => {
  try {
    const categories = await getAllCategories({
      includeChildren: true,
      includeCode: true,
      includeProductsCount: true,
    })
    res.status(200).json(
      buildCatalogListResponse(categories, {
        level: null,
        includeChildren: true,
        includeCode: true,
        includeProductsCount: true,
      })
    )
  } catch (error) {
    console.error('GET /categories/tree failed:', error)
    res.status(500).json({
      ok: false,
      error: 'Не удалось загрузить дерево категорий',
    })
  }
})

publicCategoriesRouter.get('/', async (req, res) => {
  try {
    const includeChildren = parseBooleanFlag(
      req.query.includeChildren,
      false,
      'includeChildren'
    )
    const includeCode = parseBooleanFlag(req.query.includeCode, true, 'includeCode')
    const includeProductsCount = parseBooleanFlag(
      req.query.includeProductsCount,
      true,
      'includeProductsCount'
    )
    const quickOnly = parseBooleanFlag(req.query.quickOnly, false, 'quickOnly')
    const level = parsePositiveInteger(req.query.level, 'level')
    const categories = await getAllCategories({
      includeChildren,
      includeCode,
      includeProductsCount,
      level,
      quickOnly,
    })
    res.status(200).json(
      buildCatalogListResponse(categories, {
        level: level ?? null,
        includeChildren,
        includeCode,
        includeProductsCount,
        quickOnly,
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

    console.error('GET /categories failed:', error)
    res.status(500).json({
      ok: false,
      error: 'Не удалось загрузить категории',
    })
  }
})

publicCategoriesRouter.get('/filters', async (_req, res) => {
  try {
    const filters = await getCategoryFilters()
    res.status(200).json(buildCatalogDataResponse(filters))
  } catch (error) {
    console.error('GET /categories/filters failed:', error)
    res.status(500).json({
      ok: false,
      error: 'Не удалось загрузить фильтры каталога',
    })
  }
})

export default publicCategoriesRouter
