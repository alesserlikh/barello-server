import { Router } from 'express'
import { requireAuth } from '../../middleware/auth'
import {
  getUserSupplierContext,
  isSupplierContextError,
} from './supplier-context.service'

const supplierContextRouter = Router()

supplierContextRouter.get('/me/supplier-context', requireAuth, async (req, res) => {
  try {
    const context = await getUserSupplierContext(req.auth!)

    res.status(200).json({
      ok: true,
      ...context,
    })
  } catch (error) {
    console.error('GET /me/supplier-context failed:', error)

    if (isSupplierContextError(error)) {
      res.status(error.status).json({
        ok: false,
        error: {
          code: error.code,
          message: error.message,
        },
      })
      return
    }

    res.status(500).json({
      ok: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Внутренняя ошибка сервера',
      },
    })
  }
})

export default supplierContextRouter


