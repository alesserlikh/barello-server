import { Router } from 'express'
import { getAllSuppliers, getSupplierById } from './suppliers.service'

const suppliersRouter = Router()

suppliersRouter.get('/', async (_req, res) => {
  try {
    const suppliers = await getAllSuppliers()
    res.status(200).json(suppliers)
  } catch (error) {
    console.error('GET /suppliers failed:', error)
    res.status(500).json({
      ok: false,
      error: 'Не удалось получить поставщиков',
    })
  }
})

suppliersRouter.get('/:id', async (req, res) => {
  try {
    const supplier = await getSupplierById(req.params.id)

    if (!supplier) {
      res.status(404).json({
        ok: false,
        error: 'Поставщик не найден',
      })
      return
    }

    res.status(200).json(supplier)
  } catch (error) {
    console.error('GET /suppliers/:id failed:', error)
    res.status(500).json({
      ok: false,
      error: 'Не удалось получить поставщика',
    })
  }
})

export default suppliersRouter
