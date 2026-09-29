import assert from 'assert'
import { createHash, randomUUID } from 'crypto'

import {
  AccessLevel,
  AccountType,
  DisplayRole,
  MembershipStatus,
  RegistrationFlowType,
  UserStatus,
  VerificationCodeType,
  VenueStatus,
} from '../src/generated/prisma'
import { prisma } from '../src/lib/prisma'
import {
  clearDefaultVenue,
  getUserVenueContext,
  setActiveVenue,
} from '../src/modules/venues/venue-context.service'
import { addVenueForCurrentUser } from '../src/modules/venues/venues.service'
import {
  confirmEmailVerification,
  requestEmailVerification,
} from '../src/modules/profile/email-verification.service'
import { getVenueProfileCompletion } from '../src/modules/profile/profile-completion.service'
import {
  confirmVenueCreate,
  createRegistrationDraft,
  lookupDraftInn,
  logout,
  sendDraftOtp,
  startLogin,
  updateDraftPhone,
  updateDraftRole,
  verifyDraftOtp,
  verifyLoginOtp,
} from '../src/modules/auth/auth.service'
import {
  executeAccountDeletionRequest,
  requestAccountDeletion,
} from '../src/modules/account-deletion/account-deletion.service'

const TEST_PREFIX = 'integration-smoke'
const TEST_PHONE_PREFIX = '+7900'

type TestUser = {
  id: string
  phone: string
}

function randomInn() {
  return String(Math.floor(1_000_000_000 + Math.random() * 8_999_999_999))
}

function randomPhone() {
  const tail = String(Math.floor(1_000_000 + Math.random() * 8_999_999))
  return `${TEST_PHONE_PREFIX}${tail}`
}

function authFor(userId: string, sessionId = 'integration-smoke-session') {
  return {
    type: 'user' as const,
    userId,
    sessionId,
  }
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

async function cleanup() {
  await prisma.verificationCode.deleteMany({
    where: {
      OR: [
        { target: { contains: TEST_PREFIX } },
        { target: { startsWith: TEST_PHONE_PREFIX } },
      ],
    },
  })

  await prisma.registrationDraft.deleteMany({
    where: {
      OR: [
        { fullName: { startsWith: TEST_PREFIX } },
        { phone: { startsWith: TEST_PHONE_PREFIX } },
      ],
    },
  })

  await prisma.user.deleteMany({
    where: {
      OR: [
        { email: { contains: TEST_PREFIX } },
        {
          profile: {
            lastName: TEST_PREFIX,
          },
        },
        {
          accountDeletionRequests: {
            some: {
              requestedReason: TEST_PREFIX,
            },
          },
        },
      ],
    },
  })

  await prisma.business.deleteMany({
    where: {
      name: {
        startsWith: TEST_PREFIX,
      },
    },
  })
}

async function registerVenueOwner(params: {
  fullName: string
  phone: string
  inn: string
  city?: string
}) {
  const draftResponse = await createRegistrationDraft({
    flowType: RegistrationFlowType.DIRECT,
    fullName: params.fullName,
  })

  await updateDraftPhone(draftResponse.draft.id, {
    phone: params.phone,
  })
  await sendDraftOtp(draftResponse.draft.id)
  await verifyDraftOtp(draftResponse.draft.id, {
    code: '1234',
  })
  await updateDraftRole(draftResponse.draft.id, {
    selectedAccountType: 'VENUE_STAFF',
    venueRole: DisplayRole.OWNER,
  })
  await lookupDraftInn(draftResponse.draft.id, {
    inn: params.inn,
  })

  const result = await confirmVenueCreate(
    draftResponse.draft.id,
    {
      companyName: `${TEST_PREFIX} venue ${params.inn}`,
      companyAddress: `${params.city ?? 'Moscow'}, Test street, 1`,
    },
    {
      userAgent: TEST_PREFIX,
      ipAddress: '127.0.0.1',
    }
  )

  const user = await prisma.user.findUniqueOrThrow({
    where: {
      id: result.user.id,
    },
    include: {
      memberships: true,
    },
  })

  return {
    user: {
      id: user.id,
      phone: params.phone,
    },
    venueId: user.memberships[0].venueId,
  }
}

async function createBareUser(phone = randomPhone()): Promise<TestUser> {
  const user = await prisma.user.create({
    data: {
      phone,
      status: UserStatus.ACTIVE,
      accountType: AccountType.VENUE_STAFF,
      profile: {
        create: {
          firstName: 'Smoke',
          lastName: TEST_PREFIX,
        },
      },
    },
  })

  return {
    id: user.id,
    phone,
  }
}

async function testRegistrationLoginVenueContext() {
  const inn = randomInn()
  const { user, venueId } = await registerVenueOwner({
    fullName: `${TEST_PREFIX} Owner`,
    phone: randomPhone(),
    inn,
    city: 'Moscow',
  })

  const context = await getUserVenueContext(user.id)
  assert.strictEqual(context.activeVenueId, venueId)
  assert.strictEqual(context.defaultVenueId, venueId)
  assert.strictEqual(context.dropdownVenues.length, 1)

  const completion = await getVenueProfileCompletion(user.id)
  assert.ok(completion)
  assert.strictEqual(completion.percent, 30)
  assert.strictEqual(
    completion.blocks.find((block) => block.key === 'phone')?.completed,
    true
  )
  assert.strictEqual(
    completion.blocks.find((block) => block.key === 'innAndBasics')?.completed,
    true
  )

  await startLogin({ phone: user.phone })
  const login = await verifyLoginOtp(
    {
      phone: user.phone,
      code: '1234',
    },
    {
      userAgent: TEST_PREFIX,
      ipAddress: '127.0.0.1',
    }
  )
  assert.strictEqual(login.redirectTo, 'HOME')

  const session = await prisma.authSession.findFirstOrThrow({
    where: {
      userId: user.id,
    },
    orderBy: {
      createdAt: 'desc',
    },
  })

  await logout(authFor(user.id, session.id))
  const deletedSession = await prisma.authSession.findUnique({
    where: {
      id: session.id,
    },
  })
  assert.strictEqual(deletedSession, null)
}

async function testLoginWithoutDefaultKeepsLastActiveVenue() {
  const { user, venueId } = await registerVenueOwner({
    fullName: `${TEST_PREFIX} No Default`,
    phone: randomPhone(),
    inn: randomInn(),
  })

  const addResult = await addVenueForCurrentUser(authFor(user.id), {
    inn: randomInn(),
    venueRole: DisplayRole.ADMINISTRATOR,
    venueName: `${TEST_PREFIX} second venue`,
    city: 'Saint Petersburg',
  })
  const secondVenueId = addResult.result.venueId

  await clearDefaultVenue(user.id)
  await setActiveVenue(user.id, secondVenueId)
  await startLogin({ phone: user.phone })
  await verifyLoginOtp({
    phone: user.phone,
    code: '1234',
  })

  const context = await getUserVenueContext(user.id)
  assert.strictEqual(context.defaultVenueId, null)
  assert.strictEqual(context.activeVenueId, secondVenueId)
  assert.notStrictEqual(context.activeVenueId, venueId)
}

async function testBlockedDeletedRevokedAndSecondOwner() {
  const { user, venueId } = await registerVenueOwner({
    fullName: `${TEST_PREFIX} Owner Guard`,
    phone: randomPhone(),
    inn: randomInn(),
  })

  const secondUser = await createBareUser()
  const business = await prisma.venue
    .findUniqueOrThrow({
      where: { id: venueId },
      include: { business: true },
    })
    .then((venue) => venue.business)

  await assert.rejects(
    () =>
      addVenueForCurrentUser(authFor(secondUser.id), {
        inn: business.taxNumber,
        venueRole: DisplayRole.OWNER,
      }),
    (error: any) => error?.code === 'VENUE_OWNER_ALREADY_EXISTS'
  )

  const blockedResult = await addVenueForCurrentUser(authFor(user.id), {
    inn: randomInn(),
    venueRole: DisplayRole.ADMINISTRATOR,
    venueName: `${TEST_PREFIX} blocked venue`,
  })
  const blockedVenueId = blockedResult.result.venueId
  await prisma.venue.update({
    where: { id: blockedVenueId },
    data: {
      venueStatus: VenueStatus.BLOCKED,
      isActive: false,
    },
  })

  const deletedResult = await addVenueForCurrentUser(authFor(user.id), {
    inn: randomInn(),
    venueRole: DisplayRole.ADMINISTRATOR,
    venueName: `${TEST_PREFIX} deleted venue`,
  })
  const deletedVenueId = deletedResult.result.venueId
  await prisma.venue.update({
    where: { id: deletedVenueId },
    data: {
      venueStatus: VenueStatus.DELETED,
      isActive: false,
    },
  })

  const blockedContext = await getUserVenueContext(user.id)
  assert.ok(blockedContext.venues.some((venue) => venue.id === blockedVenueId))
  assert.ok(blockedContext.venues.some((venue) => venue.id === deletedVenueId))
  assert.ok(
    blockedContext.dropdownVenues.every(
      (venue) => venue.id !== blockedVenueId && venue.id !== deletedVenueId
    )
  )

  await prisma.userVenueMembership.updateMany({
    where: {
      userId: user.id,
      venueId: deletedVenueId,
    },
    data: {
      membershipStatus: MembershipStatus.REVOKED,
    },
  })

  const revokedContext = await getUserVenueContext(user.id)
  assert.ok(revokedContext.venues.every((venue) => venue.id !== deletedVenueId))
}

async function testEmailVerification() {
  const user = await createBareUser()
  const takenUser = await createBareUser()
  const takenEmail = `${TEST_PREFIX}-${randomUUID()}@example.com`

  await prisma.user.update({
    where: { id: takenUser.id },
    data: {
      email: takenEmail,
      emailVerifiedAt: new Date(),
    },
  })

  await assert.rejects(
    () => requestEmailVerification(authFor(user.id), { email: 'not-an-email' }),
    (error: any) => error?.code === 'INVALID_EMAIL'
  )
  await assert.rejects(
    () => requestEmailVerification(authFor(user.id), { email: takenEmail }),
    (error: any) => error?.code === 'EMAIL_ALREADY_USED'
  )
  await assert.rejects(
    () => confirmEmailVerification({ token: 'missing-token' }),
    (error: any) => error?.code === 'INVALID_TOKEN'
  )

  const expiredToken = `expired-${randomUUID()}`
  await prisma.verificationCode.create({
    data: {
      userId: user.id,
      target: `${TEST_PREFIX}-expired-${randomUUID()}@example.com`,
      type: VerificationCodeType.EMAIL_VERIFY,
      code: hashToken(expiredToken),
      expiresAt: new Date(Date.now() - 1_000),
    },
  })
  await assert.rejects(
    () => confirmEmailVerification({ token: expiredToken }),
    (error: any) => error?.code === 'EMAIL_VERIFICATION_EXPIRED'
  )

  const validToken = `valid-${randomUUID()}`
  const validEmail = `${TEST_PREFIX}-valid-${randomUUID()}@example.com`
  await prisma.verificationCode.create({
    data: {
      userId: user.id,
      target: validEmail,
      type: VerificationCodeType.EMAIL_VERIFY,
      code: hashToken(validToken),
      expiresAt: new Date(Date.now() + 60_000),
    },
  })

  const confirmed = await confirmEmailVerification({ token: validToken })
  assert.strictEqual(confirmed.status, 'CONFIRMED')
  assert.strictEqual(confirmed.email, validEmail)

  await assert.rejects(
    () => confirmEmailVerification({ token: validToken }),
    (error: any) => error?.code === 'INVALID_TOKEN'
  )

  const updatedUser = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
  })
  assert.strictEqual(updatedUser.email, validEmail)
  assert.ok(updatedUser.emailVerifiedAt)
}

async function testAccountDeletion() {
  const user = await createBareUser()
  const session = await prisma.authSession.create({
    data: {
      userId: user.id,
      refreshTokenHash: 'integration-smoke-refresh',
      expiresAt: new Date(Date.now() + 60_000),
      userAgent: TEST_PREFIX,
      ipAddress: '127.0.0.1',
    },
  })

  const requestResult = await requestAccountDeletion(authFor(user.id, session.id), {
    reason: TEST_PREFIX,
  })
  assert.strictEqual(requestResult.ok, true)

  const blockedUser = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
  })
  assert.strictEqual(blockedUser.status, UserStatus.BLOCKED)

  const remainingSessions = await prisma.authSession.count({
    where: { userId: user.id },
  })
  assert.strictEqual(remainingSessions, 0)

  const executed = await executeAccountDeletionRequest(
    requestResult.deletionRequest.id,
    {
      id: 'integration-moderator',
      email: 'moderator@example.com',
      name: 'Integration Moderator',
      role: 'PLATFORM_MODERATOR',
    },
    {
      reason: TEST_PREFIX,
    }
  )
  assert.strictEqual(executed.deletionRequest.status, 'EXECUTED')

  const purgedUser = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    include: {
      profile: true,
    },
  })
  assert.strictEqual(purgedUser.phone, null)
  assert.strictEqual(purgedUser.email, null)
  assert.strictEqual(purgedUser.emailVerifiedAt, null)
  assert.strictEqual(purgedUser.passwordHash, null)
  assert.strictEqual(purgedUser.activeVenueId, null)
  assert.strictEqual(purgedUser.defaultVenueId, null)
  assert.strictEqual(purgedUser.profile, null)
}

async function main() {
  await cleanup()

  try {
    await testRegistrationLoginVenueContext()
    await testLoginWithoutDefaultKeepsLastActiveVenue()
    await testBlockedDeletedRevokedAndSecondOwner()
    await testEmailVerification()
    await testAccountDeletion()

    console.info('[integration-smoke] all checks passed')
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
}

main().catch(async (error) => {
  console.error('[integration-smoke] failed:', error)
  await prisma.$disconnect()
  process.exit(1)
})
