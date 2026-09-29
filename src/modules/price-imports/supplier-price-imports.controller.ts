import { Router } from 'express'
import { requireAuth } from '../../middleware/auth'
import {
  getSupplierPriceImport,
  getSupplierPriceImportStatus,
  listSupplierPriceImports,
  mapSupplierPriceImportError,
} from './supplier-price-imports.service'

const router = Router()
function handle(error: unknown, res: any) {
  const result = mapSupplierPriceImportError(error)
  res.status(result.status).json(result.body)
}

router.get('/status', requireAuth, async (req, res) => {
  try { res.json({ ok: true, status: await getSupplierPriceImportStatus(req.auth!) }) } catch (error) { handle(error, res) }
})
router.get('/', requireAuth, async (req, res) => {
  try { res.json({ ok: true, imports: await listSupplierPriceImports(req.auth!) }) } catch (error) { handle(error, res) }
})
router.get('/:id', requireAuth, async (req, res) => {
  try { res.json({ ok: true, import: await getSupplierPriceImport(req.auth!, String(req.params.id)) }) } catch (error) { handle(error, res) }
})

export default router
