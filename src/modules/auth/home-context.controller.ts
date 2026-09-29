import { Router } from 'express'
import { requireAuth } from '../../middleware/auth'
import { getHomeContext } from './home-context.service'

const homeContextRouter = Router()

homeContextRouter.get('/home-context', requireAuth, async (req, res) => {
  try {
    const result = await getHomeContext(req.auth!)
    res.status(200).json(result)
  } catch (error) {
    console.error('GET /home-context failed:', error)
    res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to build home context',
    })
  }
})

export default homeContextRouter
