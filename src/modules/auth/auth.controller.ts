import { Router } from 'express'
import { requireAuth, resolveAuth } from '../../middleware/auth'
import {
  checkLoginPhone,
  isLoginError,
  startLogin,
  verifyLoginOtp,
} from './login.service'
import {
  getMe,
  isAuthSessionError,
  logout,
  refreshAuthSession,
  SESSION_ERROR_CODES,
} from './session.service'
const authRouter = Router()

function getSessionContext(req: Parameters<typeof authRouter.post>[1] extends (
  req: infer R,
  res: any
) => any
  ? R
  : never) {
  return {
    userAgent:
      typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    ipAddress: req.ip,
  }
}

function buildLoginErrorResponse(error: {
  code: string
  message: string
  nextStep: string
  phone?: string
  otpExpiresAt?: string
  resendAvailableAt?: string
}) {
  return {
    error: {
      code: error.code,
      message: error.code,
    },
    nextStep: error.nextStep,
    ...(error.phone ? { phone: error.phone } : {}),
    ...(error.otpExpiresAt ? { otpExpiresAt: error.otpExpiresAt } : {}),
    ...(error.resendAvailableAt
      ? { resendAvailableAt: error.resendAvailableAt }
      : {}),
  }
}

authRouter.post('/login/start', async (req, res) => {
  try {
    const result = await startLogin(req.body)
    res.status(200).json(result)
  } catch (error) {
    console.error('POST /auth/login/start failed:', error)

    if (isLoginError(error)) {
      res.status(error.status).json(buildLoginErrorResponse(error))
      return
    }

    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'INTERNAL_SERVER_ERROR',
      },
      nextStep: 'BLOCKED',
    })
  }
})

authRouter.post('/login/check-phone', async (req, res) => {
  try {
    const result = await checkLoginPhone(req.body)
    res.status(200).json(result)
  } catch (error) {
    console.error('POST /auth/login/check-phone failed:', error)

    if (isLoginError(error)) {
      res.status(error.status).json(buildLoginErrorResponse(error))
      return
    }

    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'INTERNAL_SERVER_ERROR',
      },
      nextStep: 'BLOCKED',
    })
  }
})

authRouter.post('/login/resend', async (req, res) => {
  try {
    const result = await startLogin(req.body)
    res.status(200).json(result)
  } catch (error) {
    console.error('POST /auth/login/resend failed:', error)

    if (isLoginError(error)) {
      res.status(error.status).json(buildLoginErrorResponse(error))
      return
    }

    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'INTERNAL_SERVER_ERROR',
      },
      nextStep: 'BLOCKED',
    })
  }
})

authRouter.post('/login/verify', async (req, res) => {
  try {
    const result = await verifyLoginOtp(req.body, getSessionContext(req))
    res.status(200).json(result)
  } catch (error) {
    console.error('POST /auth/login/verify failed:', error)

    if (isLoginError(error)) {
      res.status(error.status).json(buildLoginErrorResponse(error))
      return
    }

    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'INTERNAL_SERVER_ERROR',
      },
      nextStep: 'BLOCKED',
    })
  }
})

authRouter.post('/refresh', async (req, res) => {
  try {
    const result = await refreshAuthSession(req.body, getSessionContext(req))
    res.status(200).json(result)
  } catch (error) {
    console.error('POST /auth/refresh failed:', error)

    if (isAuthSessionError(error)) {
      res.status(error.status).json({
        error: {
          code: error.code,
          message: error.code,
        },
      })
      return
    }

    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'INTERNAL_SERVER_ERROR',
      },
    })
  }
})

authRouter.get('/me', requireAuth, async (req, res) => {
  try {
    console.info('[Auth] GET /auth/me start', {
      userId: req.auth?.userId,
      sessionId: req.auth?.sessionId,
      ipAddress: req.ip,
      userAgent:
        typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    })

    const result = await getMe(req.auth!)

    console.info('[Auth] GET /auth/me success', {
      authUserId: req.auth?.userId,
      responseUserId: result.user.id,
      accountType: result.user.accountType,
      userStatus: result.user.status,
      venueMembershipsCount: result.venueMemberships.length,
      supplierMembershipsCount: result.supplierMemberships.length,
    })

    res.status(200).json(result)
  } catch (error) {
    console.error('[Auth] GET /auth/me failed', {
      userId: req.auth?.userId,
      sessionId: req.auth?.sessionId,
      ipAddress: req.ip,
      userAgent:
        typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : 'Не удалось получить профиль пользователя',
    })

    const userNotFound = error instanceof Error && error.message === 'User not found'
    const status = userNotFound ? 404 : 500

    res.status(status).json({
      error: {
        code: userNotFound
          ? SESSION_ERROR_CODES.AUTH_USER_NOT_FOUND
          : 'INTERNAL_SERVER_ERROR',
        message: userNotFound
          ? SESSION_ERROR_CODES.AUTH_USER_NOT_FOUND
          : 'INTERNAL_SERVER_ERROR',
      },
    })
  }
})


authRouter.post('/logout', async (req, res) => {
  try {
    const auth = await resolveAuth(req)

    if (auth) {
      await logout(auth)
    }

    res.status(204).send()
  } catch (error) {
    console.error('POST /auth/logout failed:', error)
    res.status(500).json({
      error: {
        code: SESSION_ERROR_CODES.LOGOUT_FAILED,
        message: SESSION_ERROR_CODES.LOGOUT_FAILED,
      },
    })
  }
})

export default authRouter
