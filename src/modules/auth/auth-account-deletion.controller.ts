import { Router } from 'express'

import { requireAuth } from '../../middleware/auth'
import {
  getOwnAccountDeletionRequest,
  isAccountDeletionError,
  requestAccountDeletion,
} from '../account-deletion/account-deletion.service'

const authAccountDeletionRouter = Router()

authAccountDeletionRouter.get('/account-deletion', requireAuth, async (req, res) => {
  try {
    const result = await getOwnAccountDeletionRequest(req.auth!)
    res.status(200).json(result)
  } catch (error) {
    console.error('GET /auth/account-deletion failed:', error)
    res.status(500).json({
      ok: false,
      error: 'Не удалось загрузить статус удаления аккаунта',
    })
  }
})

authAccountDeletionRouter.post('/account-deletion', requireAuth, async (req, res) => {
  try {
    const result = await requestAccountDeletion(req.auth!, req.body)
    res.status(200).json(result)
  } catch (error) {
    console.error('POST /auth/account-deletion failed:', error)

    if (isAccountDeletionError(error)) {
      res.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
        },
      })
      return
    }

    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Не удалось отправить запрос на удаление аккаунта',
      },
    })
  }
})

export default authAccountDeletionRouter
