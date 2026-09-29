import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import { prisma } from '../lib/prisma'

export type AuthPayload = {
  userId: string
  sessionId: string
  type: 'user'
  iat?: number
  exp?: number
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload
    }
  }
}

function getAuthRequestMeta(req: Request) {
  return {
    method: req.method,
    path: req.path,
    ipAddress: req.ip,
    userAgent:
      typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
  }
}

function getTokenDebugMeta(token: string) {
  return {
    tokenLength: token.length,
    tokenPreview: `${token.slice(0, 12)}...`,
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = await resolveAuth(req)

  if (!auth) {
    console.warn('[Auth] requireAuth rejected request', {
      ...getAuthRequestMeta(req),
    })

    res.status(401).json({
      error: {
        code: 'AUTH_REQUIRED',
        message: 'AUTH_REQUIRED',
      },
    })
    return
  }

  req.auth = auth
  next()
}

export async function resolveAuth(req: Request): Promise<AuthPayload | undefined> {
  const authHeader = req.headers.authorization
  const requestMeta = getAuthRequestMeta(req)

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('[Auth] resolveAuth: missing or invalid Authorization header', {
      ...requestMeta,
      hasAuthorizationHeader: Boolean(authHeader),
      authorizationScheme: authHeader?.split(' ')[0] ?? null,
    })
    return undefined
  }

  const token = authHeader.slice(7)
  const tokenMeta = getTokenDebugMeta(token)

  try {
    const payload = jwt.verify(token, env.jwtSecret) as AuthPayload
    console.info('[Auth] resolveAuth: jwt verified', {
      ...requestMeta,
      ...tokenMeta,
      payloadUserId: payload.userId,
      payloadSessionId: payload.sessionId,
      payloadType: payload.type,
      issuedAt: payload.iat,
      expiresAt: payload.exp,
    })

    const session = await prisma.authSession.findUnique({
      where: {
        id: payload.sessionId,
      },
    })

    if (!session) {
      console.warn('[Auth] resolveAuth: session not found', {
        ...requestMeta,
        ...tokenMeta,
        payloadUserId: payload.userId,
        payloadSessionId: payload.sessionId,
      })
      return undefined
    }

    if (session.userId !== payload.userId) {
      console.warn('[Auth] resolveAuth: session user mismatch', {
        ...requestMeta,
        ...tokenMeta,
        payloadUserId: payload.userId,
        payloadSessionId: payload.sessionId,
        sessionUserId: session.userId,
      })
      return undefined
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      console.warn('[Auth] resolveAuth: session expired', {
        ...requestMeta,
        ...tokenMeta,
        payloadUserId: payload.userId,
        payloadSessionId: payload.sessionId,
        sessionExpiresAt: session.expiresAt.toISOString(),
      })
      return undefined
    }

    console.info('[Auth] resolveAuth: session accepted', {
      ...requestMeta,
      ...tokenMeta,
      payloadUserId: payload.userId,
      payloadSessionId: payload.sessionId,
      sessionExpiresAt: session.expiresAt.toISOString(),
    })

    return payload
  } catch (error) {
    console.error('[Auth] resolveAuth: jwt verification failed', {
      ...requestMeta,
      ...tokenMeta,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : 'Unknown JWT verification error',
    })
    return undefined
  }
}
