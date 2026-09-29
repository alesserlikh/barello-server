import { randomUUID } from 'crypto'
import type { NextFunction, Request, Response } from 'express'
import rateLimit from 'express-rate-limit'

const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'passwordhash',
  'refreshToken',
  'accessToken',
  'token',
  'code',
  'otp',
  'secret',
])

const AUTH_AUDIT_PATHS = [
  '/auth/login/start',
  '/auth/login/check-phone',
  '/auth/login/resend',
  '/auth/login/verify',
  '/auth/refresh',
  '/moderation/auth/login',
] as const

declare global {
  namespace Express {
    interface Request {
      requestId?: string
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function shouldRedactKey(key: string) {
  return SENSITIVE_KEYS.has(key.toLowerCase())
}

export function redactSensitiveData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveData(item))
  }

  if (!isRecord(value)) {
    return value
  }

  const sanitizedEntries = Object.entries(value).map(([key, nestedValue]) => {
    if (shouldRedactKey(key)) {
      return [key, '[REDACTED]'] as const
    }

    return [key, redactSensitiveData(nestedValue)] as const
  })

  return Object.fromEntries(sanitizedEntries)
}

export function buildRequestLogContext(req: Request) {
  return {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl || req.path,
    ipAddress: req.ip,
    userAgent:
      typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    headers: redactSensitiveData(req.headers),
    query: redactSensitiveData(req.query),
    body: redactSensitiveData(req.body),
  }
}

function isAuditedAuthRequest(pathname: string) {
  return AUTH_AUDIT_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  )
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const headerValue = req.headers['x-request-id']
  const requestId =
    typeof headerValue === 'string' && headerValue.trim() ? headerValue.trim() : randomUUID()

  req.requestId = requestId
  res.setHeader('X-Request-Id', requestId)
  next()
}

export function authAuditMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!isAuditedAuthRequest(req.path)) {
    next()
    return
  }

  const startedAt = Date.now()

  res.on('finish', () => {
    console.info('[HTTP Audit]', {
      ...buildRequestLogContext(req),
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    })
  })

  next()
}

function createRateLimitResponse(message: string) {
  return {
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message,
    },
  }
}

function createRateLimiter(windowMs: number, max: number, message: string) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler(req, res) {
      res.status(429).json({
        ...createRateLimitResponse(message),
        requestId: req.requestId ?? null,
      })
    },
  })
}

export const authRateLimiter = createRateLimiter(
  15 * 60 * 1000,
  12,
  'Слишком много попыток авторизации. Повторите позже.'
)

export const refreshRateLimiter = createRateLimiter(
  15 * 60 * 1000,
  30,
  'Слишком много запросов на обновление сессии. Повторите позже.'
)

export const moderationLoginRateLimiter = createRateLimiter(
  15 * 60 * 1000,
  5,
  'Слишком много попыток входа модератора. Повторите позже.'
)

