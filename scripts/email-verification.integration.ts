import assert from 'assert'
import { createHash, randomUUID } from 'crypto'
import type { AddressInfo } from 'net'

import app from '../src/app'
import { AccountType, UserStatus, VerificationCodeType } from '../src/generated/prisma'
import { prisma } from '../src/lib/prisma'

const TEST_PREFIX = 'email-verification-integration'
const TEST_PHONE_PREFIX = '+7922'

function randomPhone() {
  const tail = String(Math.floor(1_000_000 + Math.random() * 8_999_999))
  return `${TEST_PHONE_PREFIX}${tail}`
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

async function cleanup() {
  await prisma.verificationCode.deleteMany({
    where: {
      target: {
        contains: TEST_PREFIX,
      },
    },
  })

  await prisma.user.deleteMany({
    where: {
      OR: [
        {
          phone: {
            startsWith: TEST_PHONE_PREFIX,
          },
        },
        {
          email: {
            contains: TEST_PREFIX,
          },
        },
        {
          profile: {
            lastName: TEST_PREFIX,
          },
        },
      ],
    },
  })
}

async function createUser(label: string) {
  return prisma.user.create({
    data: {
      phone: randomPhone(),
      status: UserStatus.ACTIVE,
      accountType: AccountType.VENUE_STAFF,
      profile: {
        create: {
          firstName: label,
          lastName: TEST_PREFIX,
        },
      },
    },
  })
}

async function createEmailVerification(params: {
  userId: string
  email: string
  token: string
  expiresAt: Date
  usedAt?: Date | null
}) {
  return prisma.verificationCode.create({
    data: {
      userId: params.userId,
      target: params.email,
      type: VerificationCodeType.EMAIL_VERIFY,
      code: hashToken(params.token),
      expiresAt: params.expiresAt,
      usedAt: params.usedAt ?? null,
    },
  })
}

async function startServer() {
  const server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))

  const { port } = server.address() as AddressInfo

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      }),
  }
}

async function getWithoutRedirect(url: string) {
  return fetch(url, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      Accept: 'application/json',
    },
  })
}

async function testJsonSuccessWithoutAuth(baseUrl: string) {
  const user = await createUser('Json Success')
  const token = `valid-${randomUUID()}`
  const email = `${TEST_PREFIX}-valid-${randomUUID()}@example.com`

  await createEmailVerification({
    userId: user.id,
    email,
    token,
    expiresAt: new Date(Date.now() + 60_000),
  })

  const response = await getWithoutRedirect(
    `${baseUrl}/email-verification/confirm?token=${encodeURIComponent(token)}&format=json`
  )
  const body = (await response.json()) as Record<string, any>

  assert.strictEqual(response.status, 200)
  assert.strictEqual(body.ok, true)
  assert.strictEqual(body.status, 'CONFIRMED')
  assert.strictEqual(body.email, email)

  const updatedUser = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
  })
  assert.strictEqual(updatedUser.email, email)
  assert.ok(updatedUser.emailVerifiedAt)

  const pendingVerification = await prisma.verificationCode.findFirst({
    where: {
      userId: user.id,
      type: VerificationCodeType.EMAIL_VERIFY,
      usedAt: null,
    },
  })
  assert.strictEqual(pendingVerification, null)
}

async function testExpiredJson(baseUrl: string) {
  const user = await createUser('Json Expired')
  const token = `expired-${randomUUID()}`

  await createEmailVerification({
    userId: user.id,
    email: `${TEST_PREFIX}-expired-${randomUUID()}@example.com`,
    token,
    expiresAt: new Date(Date.now() - 60_000),
  })

  const response = await getWithoutRedirect(
    `${baseUrl}/email-verification/confirm?token=${encodeURIComponent(token)}&format=json`
  )
  const body = (await response.json()) as Record<string, any>

  assert.strictEqual(response.status, 410)
  assert.strictEqual(body.ok, false)
  assert.strictEqual(body.error.code, 'EMAIL_VERIFICATION_EXPIRED')
}

async function testInvalidJson(baseUrl: string) {
  const response = await getWithoutRedirect(
    `${baseUrl}/email-verification/confirm?token=missing-token&format=json`
  )
  const body = (await response.json()) as Record<string, any>

  assert.strictEqual(response.status, 404)
  assert.strictEqual(body.ok, false)
  assert.strictEqual(body.error.code, 'INVALID_TOKEN')
}

async function testRepeatedUseJson(baseUrl: string) {
  const user = await createUser('Json Reused')
  const token = `reused-${randomUUID()}`
  const email = `${TEST_PREFIX}-reused-${randomUUID()}@example.com`

  await createEmailVerification({
    userId: user.id,
    email,
    token,
    expiresAt: new Date(Date.now() + 60_000),
  })

  const firstResponse = await getWithoutRedirect(
    `${baseUrl}/email-verification/confirm?token=${encodeURIComponent(token)}&format=json`
  )
  assert.strictEqual(firstResponse.status, 200)

  const secondResponse = await getWithoutRedirect(
    `${baseUrl}/email-verification/confirm?token=${encodeURIComponent(token)}&format=json`
  )
  const secondBody = (await secondResponse.json()) as Record<string, any>

  assert.strictEqual(secondResponse.status, 404)
  assert.strictEqual(secondBody.ok, false)
  assert.strictEqual(secondBody.error.code, 'INVALID_TOKEN')
}

async function testRedirectModes(baseUrl: string) {
  const successUser = await createUser('Redirect Success')
  const successToken = `redirect-success-${randomUUID()}`
  const successEmail = `${TEST_PREFIX}-redirect-${randomUUID()}@example.com`

  await createEmailVerification({
    userId: successUser.id,
    email: successEmail,
    token: successToken,
    expiresAt: new Date(Date.now() + 60_000),
  })

  const successResponse = await fetch(
    `${baseUrl}/email-verification/confirm?token=${encodeURIComponent(successToken)}`,
    {
      method: 'GET',
      redirect: 'manual',
    }
  )

  assert.strictEqual(successResponse.status, 302)
  assert.match(
    successResponse.headers.get('location') ?? '',
    /\/email\/verify\?status=confirmed&email=/
  )

  const expiredUser = await createUser('Redirect Expired')
  const expiredToken = `redirect-expired-${randomUUID()}`

  await createEmailVerification({
    userId: expiredUser.id,
    email: `${TEST_PREFIX}-redirect-expired-${randomUUID()}@example.com`,
    token: expiredToken,
    expiresAt: new Date(Date.now() - 60_000),
  })

  const expiredResponse = await fetch(
    `${baseUrl}/email-verification/confirm?token=${encodeURIComponent(expiredToken)}`,
    {
      method: 'GET',
      redirect: 'manual',
    }
  )

  assert.strictEqual(expiredResponse.status, 302)
  assert.match(expiredResponse.headers.get('location') ?? '', /status=expired/)

  const invalidResponse = await fetch(
    `${baseUrl}/email-verification/confirm?token=invalid-redirect-token`,
    {
      method: 'GET',
      redirect: 'manual',
    }
  )

  assert.strictEqual(invalidResponse.status, 302)
  assert.match(invalidResponse.headers.get('location') ?? '', /status=invalid/)
}

async function main() {
  await cleanup()
  const server = await startServer()

  try {
    await testJsonSuccessWithoutAuth(server.baseUrl)
    await testExpiredJson(server.baseUrl)
    await testInvalidJson(server.baseUrl)
    await testRepeatedUseJson(server.baseUrl)
    await testRedirectModes(server.baseUrl)

    console.info('[email-verification.integration] all checks passed')
  } finally {
    await server.close()
    await cleanup()
    await prisma.$disconnect()
  }
}

main().catch(async (error) => {
  console.error('[email-verification.integration] failed:', error)
  await prisma.$disconnect()
  process.exit(1)
})
