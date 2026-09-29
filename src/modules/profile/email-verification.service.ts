import { createHash, randomUUID } from 'crypto'

import { VerificationCodeType } from '../../generated/prisma'
import { env } from '../../config/env'
import { sendEmailVerificationLink } from '../../lib/email'
import { prisma } from '../../lib/prisma'
import type { AuthPayload } from '../../middleware/auth'

const EMAIL_VERIFY_TTL_MINUTES = 60

type RequestEmailVerificationInput = {
  email?: unknown
}

type ConfirmEmailVerificationInput = {
  token?: unknown
}

type EmailVerificationErrorCode =
  | 'INVALID_EMAIL'
  | 'EMAIL_ALREADY_USED'
  | 'INSUFFICIENT_PERMISSIONS'
  | 'INVALID_TOKEN'
  | 'EMAIL_VERIFICATION_EXPIRED'
  | 'USER_NOT_FOUND'

class EmailVerificationError extends Error {
  code: EmailVerificationErrorCode
  status: number

  constructor(params: {
    code: EmailVerificationErrorCode
    message: string
    status?: number
  }) {
    super(params.message)
    this.code = params.code
    this.status = params.status ?? 400
  }
}

function normalizeEmail(value: unknown) {
  if (typeof value !== 'string') {
    throw new EmailVerificationError({
      code: 'INVALID_EMAIL',
      message: 'Введите корректный email',
      status: 400,
    })
  }

  const email = value.trim().toLowerCase()

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new EmailVerificationError({
      code: 'INVALID_EMAIL',
      message: 'Введите корректный email',
      status: 400,
    })
  }

  return email
}

function normalizeToken(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new EmailVerificationError({
      code: 'INVALID_TOKEN',
      message: 'Ссылка подтверждения email недействительна',
      status: 404,
    })
  }

  return value.trim()
}

function generateVerificationToken() {
  return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
}

function hashVerificationToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function getEmailVerifyExpiresAt() {
  return new Date(Date.now() + EMAIL_VERIFY_TTL_MINUTES * 60 * 1000)
}

function buildVerificationUrl(token: string) {
  const baseUrl = env.apiPublicUrl.replace(/\/$/, '')
  // Email links must point to the public GET confirmation endpoint.
  return `${baseUrl}/email-verification/confirm?token=${encodeURIComponent(token)}`
}

export function buildEmailVerificationRedirectUrl(
  status: 'confirmed' | 'expired' | 'invalid' | 'error',
  params?: {
    email?: string | null
  }
) {
  const redirectUrl = new URL('/email/verify', env.clientUrl)
  redirectUrl.searchParams.set('status', status)

  if (params?.email) {
    redirectUrl.searchParams.set('email', params.email)
  }

  return redirectUrl.toString()
}

async function ensureEmailAvailable(email: string, userId: string) {
  const existingUser = await prisma.user.findFirst({
    where: {
      email,
      id: {
        not: userId,
      },
    },
    select: {
      id: true,
    },
  })

  if (existingUser) {
    throw new EmailVerificationError({
      code: 'EMAIL_ALREADY_USED',
      message: 'Этот email уже используется другим пользователем',
      status: 409,
    })
  }
}

async function getActivePendingEmailVerification(userId: string) {
  return prisma.verificationCode.findFirst({
    where: {
      userId,
      type: VerificationCodeType.EMAIL_VERIFY,
      usedAt: null,
      expiresAt: {
        gt: new Date(),
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  })
}

export async function requestEmailVerification(
  auth: AuthPayload,
  input: RequestEmailVerificationInput
) {
  if (auth.type !== 'user') {
    throw new EmailVerificationError({
      code: 'INSUFFICIENT_PERMISSIONS',
      message: 'Подтверждать email могут только авторизованные пользователи',
      status: 403,
    })
  }

  const email = normalizeEmail(input.email)
  await ensureEmailAvailable(email, auth.userId)

  const token = generateVerificationToken()
  const tokenHash = hashVerificationToken(token)
  const expiresAt = getEmailVerifyExpiresAt()

  await prisma.$transaction(async (tx) => {
    await tx.verificationCode.updateMany({
      where: {
        userId: auth.userId,
        type: VerificationCodeType.EMAIL_VERIFY,
        usedAt: null,
      },
      data: {
        usedAt: new Date(),
      },
    })

    await tx.verificationCode.create({
      data: {
        target: email,
        type: VerificationCodeType.EMAIL_VERIFY,
        code: tokenHash,
        userId: auth.userId,
        expiresAt,
      },
    })
  })

  await sendEmailVerificationLink({
    to: email,
    verificationUrl: buildVerificationUrl(token),
    expiresAt,
  })

  return {
    status: 'SENT' as const,
    pendingEmail: email,
    pendingEmailExpiresAt: expiresAt.toISOString(),
  }
}

export async function confirmEmailVerification(
  input: ConfirmEmailVerificationInput
) {
  const token = normalizeToken(input.token)
  const tokenHash = hashVerificationToken(token)

  const verification = await prisma.verificationCode.findFirst({
    where: {
      code: tokenHash,
      type: VerificationCodeType.EMAIL_VERIFY,
    },
    orderBy: {
      createdAt: 'desc',
    },
  })

  if (!verification || verification.usedAt) {
    throw new EmailVerificationError({
      code: 'INVALID_TOKEN',
      message: 'Ссылка подтверждения email недействительна',
      status: 404,
    })
  }

  if (verification.expiresAt.getTime() <= Date.now()) {
    throw new EmailVerificationError({
      code: 'EMAIL_VERIFICATION_EXPIRED',
      message: 'Срок действия ссылки подтверждения email истёк',
      status: 410,
    })
  }

  if (!verification.userId) {
    throw new EmailVerificationError({
      code: 'INVALID_TOKEN',
      message: 'Ссылка подтверждения email недействительна',
      status: 404,
    })
  }

  await ensureEmailAvailable(verification.target, verification.userId)

  const confirmedAt = new Date()

  await prisma.$transaction([
    prisma.user.update({
      where: { id: verification.userId },
      data: {
        email: verification.target,
        emailVerifiedAt: confirmedAt,
      },
    }),
    prisma.verificationCode.update({
      where: { id: verification.id },
      data: {
        usedAt: confirmedAt,
      },
    }),
  ])

  return {
    status: 'CONFIRMED' as const,
    email: verification.target,
    emailVerifiedAt: confirmedAt.toISOString(),
  }
}

export async function getEmailVerificationStatus(auth: AuthPayload) {
  if (auth.type !== 'user') {
    throw new EmailVerificationError({
      code: 'INSUFFICIENT_PERMISSIONS',
      message:
        'Просматривать статус подтверждения email могут только авторизованные пользователи',
      status: 403,
    })
  }

  const [user, pendingVerification] = await Promise.all([
    prisma.user.findUnique({
      where: { id: auth.userId },
      select: {
        email: true,
        emailVerifiedAt: true,
      },
    }),
    getActivePendingEmailVerification(auth.userId),
  ])

  if (!user) {
    throw new EmailVerificationError({
      code: 'USER_NOT_FOUND',
      message: 'Пользователь не найден',
      status: 404,
    })
  }

  return {
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    pendingEmail: pendingVerification?.target ?? null,
    pendingEmailExpiresAt: pendingVerification?.expiresAt.toISOString() ?? null,
  }
}

export function isEmailVerificationError(
  error: unknown
): error is EmailVerificationError {
  return error instanceof EmailVerificationError
}
