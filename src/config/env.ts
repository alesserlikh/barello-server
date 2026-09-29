import dotenv from 'dotenv'
import * as path from 'node:path'

dotenv.config()

function requireEnv(name: string): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

function optionalEnv(name: string): string | null {
  const value = process.env[name]

  if (!value) {
    return null
  }

  return value
}

function optionalBooleanEnv(name: string, defaultValue = false): boolean {
  const value = optionalEnv(name)

  if (value === null) {
    return defaultValue
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function optionalNumberEnv(name: string, defaultValue: number): number {
  const value = optionalEnv(name)

  if (value === null) {
    return defaultValue
  }

  const numberValue = Number(value)

  if (!Number.isFinite(numberValue)) {
    throw new Error(`Environment variable ${name} must be a number.`)
  }

  return numberValue
}

function optionalTrustProxyEnv(name: string, defaultValue: boolean | number | string) {
  const value = optionalEnv(name)

  if (value === null) {
    return defaultValue
  }

  const normalizedValue = value.trim().toLowerCase()

  if (['true', 'yes', 'on'].includes(normalizedValue)) {
    return true
  }

  if (['false', 'no', 'off'].includes(normalizedValue)) {
    return false
  }

  const numberValue = Number(value)

  if (Number.isFinite(numberValue)) {
    return numberValue
  }

  return value
}

function buildModerator(index: 1 | 2 | 3) {
  const email = optionalEnv(`MODERATOR_${index}_EMAIL`)
  const passwordHash = optionalEnv(`MODERATOR_${index}_PASSWORD_HASH`)
  const name = optionalEnv(`MODERATOR_${index}_NAME`)

  if (!email && !passwordHash && !name) {
    return null
  }

  if (!email || !passwordHash) {
    throw new Error(
      `Moderator ${index} is configured incorrectly. MODERATOR_${index}_EMAIL and MODERATOR_${index}_PASSWORD_HASH are required.`
    )
  }

  return {
    id: `platform-moderator-${index}`,
    email,
    passwordHash,
    name: name || `Модератор ${index}`,
    role: 'PLATFORM_MODERATOR' as const,
  }
}

const moderators = [
  buildModerator(1),
  buildModerator(2),
  buildModerator(3),
].filter(Boolean) as Array<{
  id: string
  email: string
  passwordHash: string
  name: string
  role: 'PLATFORM_MODERATOR'
}>

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3006),

  databaseUrl: requireEnv('DATABASE_URL'),

  jwtSecret: process.env.JWT_SECRET || 'barello_dev_jwt_secret_change_me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  allowTestOtp: optionalBooleanEnv('ALLOW_TEST_OTP', false),
  registrationAssumeUnknownInnConfirmed: optionalBooleanEnv(
    'REGISTRATION_ASSUME_UNKNOWN_INN_CONFIRMED',
    false
  ),

  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  adminClientUrl: process.env.ADMIN_CLIENT_URL || 'http://localhost:5174',
  apiPublicUrl:
    optionalEnv('API_PUBLIC_URL') || `http://localhost:${Number(process.env.PORT || 3006)}`,
  uploadsRoot: optionalEnv('UPLOADS_ROOT') || path.resolve(process.cwd(), 'uploads'),
  trustProxy: optionalTrustProxyEnv('TRUST_PROXY', process.env.NODE_ENV === 'production' ? 1 : false),

  emailProvider: (optionalEnv('EMAIL_PROVIDER') || 'console').toLowerCase(),
  emailFrom: optionalEnv('EMAIL_FROM') || 'Barello <noreply@barello.ru>',
  resendApiKey: optionalEnv('RESEND_API_KEY'),
  sendgridApiKey: optionalEnv('SENDGRID_API_KEY'),
  smtpHost: optionalEnv('SMTP_HOST'),
  smtpPort: optionalNumberEnv('SMTP_PORT', 465),
  smtpSecure: optionalBooleanEnv('SMTP_SECURE', true),
  smtpUser: optionalEnv('SMTP_USER'),
  smtpPass: optionalEnv('SMTP_PASS'),
  emailRequestTimeoutMs: optionalNumberEnv('EMAIL_REQUEST_TIMEOUT_MS', 10_000),

  moderators,
}
