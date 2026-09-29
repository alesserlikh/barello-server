import { Router } from 'express'

import { requireAuth } from '../../middleware/auth'
import { getProfileCompletion } from '../profile/profile-completion.service'

const authProfileCompletionRouter = Router()

authProfileCompletionRouter.get('/profile-completion', requireAuth, async (req, res) => {
  try {
    const result = await getProfileCompletion(req.auth!)
    res.status(200).json(result)
  } catch (error) {
    console.error('GET /auth/profile-completion failed:', error)
    res.status(500).json({
      ok: false,
      error: 'Не удалось загрузить статус заполнения профиля',
    })
  }
})

export default authProfileCompletionRouter
