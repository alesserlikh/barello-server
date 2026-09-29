import { Router } from 'express'
import { requireAuth } from '../../middleware/auth'
import {
  buildEmailVerificationRedirectUrl,
  confirmEmailVerification,
  getEmailVerificationStatus,
  isEmailVerificationError,
  requestEmailVerification,
} from './email-verification.service'

const emailVerificationRouter = Router()

function handleEmailVerificationError(
  error: unknown,
  route: string,
  res: Parameters<Router['get']>[1] extends (
    req: any,
    res: infer R
  ) => any
    ? R
    : never
) {
  console.error(`${route} failed:`, error)

  if (isEmailVerificationError(error)) {
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

function wantsJsonConfirmResponse(format: unknown) {
  return typeof format === 'string' && format.toLowerCase() === 'json'
}

emailVerificationRouter.post(
  '/me/email-verification',
  requireAuth,
  async (req, res) => {
    try {
      const result = await requestEmailVerification(req.auth!, req.body)
      res.status(200).json({
        ok: true,
        ...result,
      })
    } catch (error) {
      handleEmailVerificationError(error, 'POST /me/email-verification', res)
    }
  }
)

emailVerificationRouter.get(
  '/me/email-verification/status',
  requireAuth,
  async (req, res) => {
    try {
      const result = await getEmailVerificationStatus(req.auth!)
      res.status(200).json({
        ok: true,
        ...result,
      })
    } catch (error) {
      handleEmailVerificationError(error, 'GET /me/email-verification/status', res)
    }
  }
)

// Keep this endpoint only for explicitly authorized flows.
// Frontend confirmation from email links must use GET /email-verification/confirm.
emailVerificationRouter.get('/email-verification/confirm', async (req, res) => {
  const jsonMode = wantsJsonConfirmResponse(req.query.format)

  try {
    const result = await confirmEmailVerification({
      token: req.query.token,
    })

    if (!jsonMode) {
      res.redirect(
        302,
        buildEmailVerificationRedirectUrl('confirmed', {
          email: result.email,
        })
      )
      return
    }

    res.status(200).json({
      ok: true,
      ...result,
    })
  } catch (error) {
    if (!jsonMode) {
      if (isEmailVerificationError(error)) {
        res.redirect(
          302,
          buildEmailVerificationRedirectUrl(
            error.code === 'EMAIL_VERIFICATION_EXPIRED' ? 'expired' : 'invalid'
          )
        )
        return
      }

      console.error('GET /email-verification/confirm failed:', error)
      res.redirect(302, buildEmailVerificationRedirectUrl('error'))
      return
    }

    handleEmailVerificationError(error, 'GET /email-verification/confirm', res)
  }
})

export default emailVerificationRouter
