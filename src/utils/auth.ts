import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'

export type AccessTokenPayload = {
  userId: string
  sessionId: string
  type: 'user'
}

export type RefreshTokenPayload = {
  userId: string
  sessionId: string
  type: 'refresh'
  iat?: number
  exp?: number
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export function signAccessToken(payload: AccessTokenPayload) {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: '7d',
  })
}

export function signRefreshToken(payload: { userId: string; sessionId: string }) {
  return jwt.sign(
    {
      ...payload,
      type: 'refresh',
    },
    env.jwtSecret,
    {
      expiresIn: '30d',
    }
  )
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.jwtSecret) as RefreshTokenPayload
}
