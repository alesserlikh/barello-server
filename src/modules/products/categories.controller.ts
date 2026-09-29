import { Router } from 'express'
import {
  buildCatalogListResponse,
  CatalogRequestError,
  parseBooleanFlag,
  parsePositiveInteger,
} from './catalog-contract'
import { getAllCategories } from './categories.service'

const categoriesRouter = Router()

categoriesRouter.get('/', async (req, res) => {
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
    const level = parsePositiveInteger(req.query.level, 'level')
    const categories = await getAllCategories({
      includeChildren,
      includeCode,
      includeProductsCount,
      level,
    })

    res.status(200).json(
      buildCatalogListResponse(categories, {
        level: level ?? null,
        includeChildren,
        includeCode,
        includeProductsCount,
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

export default categoriesRouter
