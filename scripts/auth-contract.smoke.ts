import assert from 'assert'
import { randomUUID } from 'crypto'
import { readFile } from 'fs/promises'
import type { AddressInfo } from 'net'
import path from 'path'

import app from '../src/app'
import {
  AccessLevel,
  AccountType,
  DisplayRole,
  MembershipStatus,
  RegistrationFlowType,
  StaffInvitationStatus,
  UserStatus,
  VenueOwnerStatus,
  VenueStatus,
} from '../src/generated/prisma'
import { prisma } from '../src/lib/prisma'
import {
  checkLoginPhone,
  confirmVenueExistingJoin,
  createRegistrationDraft,
  DRAFT_ERROR_CODES,
  LOGIN_FLOW_ERROR_CODES,
  logout,
  lookupDraftInn,
  REGISTRATION_FLOW_ERROR_CODES,
  refreshAuthSession,
  resolveInviteToken,
  sendDraftOtp,
  SESSION_ERROR_CODES,
  startLogin,
  updateDraftPhone,
  updateDraftRole,
  VALIDATION_ERROR_CODES,
  verifyDraftOtp,
  verifyLoginOtp,
} from '../src/modules/auth/auth.service'
import { getHomeContext } from '../src/modules/auth/home-context.service'
import { getProfileMobileContext } from '../src/modules/profile/profile-mobile-context.service'
import { createNote, getLatestNote } from '../src/modules/notes/notes.service'
import { clearDefaultVenue } from '../src/modules/venues/venue-context.service'
import {
  createTask,
  getTaskSettings,
  listTasks,
  updateTask,
  updateTaskSettings,
} from '../src/modules/tasks/tasks.service'
import { assertProfileActionAllowed } from '../src/modules/profile/profile-permissions.service'
import {
  AUTH_PUBLIC_API_ROUTES,
  REGISTRATION_DRAFT_PUBLIC_API_PREFIX,
  REGISTRATION_DRAFT_PUBLIC_API_ROUTES,
} from '../src/modules/auth/auth-api-contract'
import {
  hashInviteToken,
  transliterateToSlug,
} from '../src/modules/auth/staff-invitations.service'

const TEST_PREFIX = 'auth-contract-smoke'
const TEST_PHONE_PREFIX = '+7901'

function randomInn() {
  return `77${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`
}

function randomPhone() {
  const tail = String(Math.floor(1_000_000 + Math.random() * 8_999_999))
  return `${TEST_PHONE_PREFIX}${tail}`
}

function authFor(userId: string, sessionId: string) {
  return {
    type: 'user' as const,
    userId,
    sessionId,
  }
}

async function fetchJson(
  baseUrl: string,
  path: string,
  options?: RequestInit
) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options?.headers ?? {}),
    },
  })
  const text = await response.text()
  const json = text ? JSON.parse(text) : null

  return {
    status: response.status,
    json,
  }
}

function toJsonBody(value: unknown) {
  return JSON.stringify(value)
}

async function expectCode(
  action: () => Promise<unknown>,
  expectedCode: string
) {
  await assert.rejects(
    action,
    (error: any) => {
      assert.strictEqual(error?.code, expectedCode)
      assert.strictEqual(typeof error?.message, 'string')
      assert.ok(error.message.length > 0)
      return true
    }
  )
}

function expectErrorResponse(
  response: Awaited<ReturnType<typeof fetchJson>>,
  expected: {
    status: number
    code: string
    nextStep?: string
    redirectTo?: string
    phone?: string
    hasOtpTimestamps?: boolean
  }
) {
  assert.strictEqual(response.status, expected.status)
  assert.strictEqual(response.json.error.code, expected.code)
  assert.strictEqual(typeof response.json.error.message, 'string')
  assert.ok(response.json.error.message.length > 0)

  if (expected.nextStep) {
    assert.strictEqual(response.json.nextStep, expected.nextStep)
  }

  if (expected.redirectTo) {
    assert.strictEqual(response.json.redirectTo, expected.redirectTo)
  }

  if (expected.phone) {
    assert.strictEqual(response.json.phone, expected.phone)
  }

  if (expected.hasOtpTimestamps) {
    assert.strictEqual(typeof response.json.otpExpiresAt, 'string')
    assert.strictEqual(typeof response.json.resendAvailableAt, 'string')
  }
}

async function cleanup() {
  await prisma.verificationCode.deleteMany({
    where: {
      target: {
        startsWith: TEST_PHONE_PREFIX,
      },
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
      profile: {
        lastName: TEST_PREFIX,
      },
    },
  })

  await prisma.supplier.deleteMany({
    where: {
      name: {
        startsWith: TEST_PREFIX,
      },
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

async function createUser(
  phone = randomPhone(),
  accountType: AccountType = AccountType.VENUE_STAFF
) {
  return prisma.user.create({
    data: {
      phone,
      status: UserStatus.ACTIVE,
      accountType,
      profile: {
        create: {
          firstName: 'Smoke',
          lastName: TEST_PREFIX,
        },
      },
    },
  })
}

async function createVenue(params?: { inn?: string; name?: string }) {
  const inn = params?.inn ?? randomInn()
  const business = await prisma.business.create({
    data: {
      name: params?.name ?? `${TEST_PREFIX} venue ${inn}`,
      taxNumber: inn,
      legalAddress: `${TEST_PREFIX} address`,
    },
  })

  const venue = await prisma.venue.create({
    data: {
      businessId: business.id,
      name: business.name,
      city: 'Moscow',
      address: business.legalAddress,
      ownerStatus: VenueOwnerStatus.OWNER_MISSING,
      venueStatus: VenueStatus.ACTIVE,
      isActive: true,
    },
  })

  return {
    business,
    venue,
  }
}

async function createSupplier(params?: { inn?: string; name?: string }) {
  const inn = params?.inn ?? randomInn()
  const business = await prisma.business.create({
    data: {
      name: params?.name ?? `${TEST_PREFIX} supplier ${inn}`,
      taxNumber: inn,
      legalAddress: `${TEST_PREFIX} supplier address`,
    },
  })

  const supplier = await prisma.supplier.create({
    data: {
      businessId: business.id,
      name: business.name,
      city: 'Moscow',
      address: business.legalAddress,
      passwordHash: TEST_PREFIX,
      isActive: true,
    },
  })

  return {
    business,
    supplier,
  }
}

async function createVenueUserWithAccess(accessLevel: AccessLevel) {
  const user = await createUser(randomPhone(), AccountType.VENUE_STAFF)
  const { venue } = await createVenue({
    name: `${TEST_PREFIX} permissions venue ${accessLevel}`,
  })
  const displayRole =
    accessLevel === AccessLevel.ADMIN
      ? DisplayRole.ADMINISTRATOR
      : accessLevel === AccessLevel.SENIOR_STAFF
        ? DisplayRole.SENIOR_BARTENDER
        : DisplayRole.BARTENDER

  await prisma.userVenueMembership.create({
    data: {
      userId: user.id,
      venueId: venue.id,
      displayRole,
      accessLevel,
      membershipStatus: MembershipStatus.ACTIVE,
      joinedAt: new Date(),
      confirmedByUserId: user.id,
    },
  })
  await prisma.user.update({
    where: {
      id: user.id,
    },
    data: {
      activeVenueId: venue.id,
      defaultVenueId: venue.id,
    },
  })

  return user
}

async function createSupplierUserWithAccess(accessLevel = AccessLevel.ADMIN) {
  const user = await createUser(randomPhone(), AccountType.SUPPLIER_STAFF)
  const { supplier } = await createSupplier({
    name: `${TEST_PREFIX} permissions supplier`,
  })

  await prisma.supplierMembership.create({
    data: {
      userId: user.id,
      supplierId: supplier.id,
      displayRole: 'SUPPLIER_STAFF',
      accessLevel,
      status: MembershipStatus.ACTIVE,
      joinedAt: new Date(),
    },
  })

  return user
}

async function createReadyDraftForInn(selectedAccountType: 'SUPPLIER_STAFF' | 'VENUE_STAFF') {
  const draftResponse = await createRegistrationDraft({
    flowType: RegistrationFlowType.DIRECT,
    fullName: `${TEST_PREFIX} INN Draft`,
  })
  await updateDraftPhone(draftResponse.draft.id, { phone: randomPhone() })
  await sendDraftOtp(draftResponse.draft.id)
  await verifyDraftOtp(draftResponse.draft.id, { code: '1234' })
  await updateDraftRole(
    draftResponse.draft.id,
    selectedAccountType === 'VENUE_STAFF'
      ? {
          selectedAccountType,
          venueRole: DisplayRole.BARTENDER,
        }
      : {
          selectedAccountType,
        }
  )

  return draftResponse.draft.id
}

async function testLoginUnknownPhone() {
  await expectCode(
    () => startLogin({ phone: randomPhone() }),
    'PHONE_NOT_REGISTERED'
  )

  const status = await checkLoginPhone({ phone: randomPhone() })
  assert.strictEqual(status.exists, false)
  assert.strictEqual(status.canLogin, false)
}

async function testLoginOtpVerify() {
  const user = await createUser()

  const start = await startLogin({ phone: user.phone! })
  assert.strictEqual(start.phone, user.phone)
  assert.strictEqual(start.nextStep, 'OTP_INPUT')
  assert.strictEqual(typeof start.otpExpiresAt, 'string')
  assert.strictEqual(typeof start.resendAvailableAt, 'string')

  await expectCode(
    () => verifyLoginOtp({ phone: user.phone!, code: '0000' }),
    'OTP_INVALID'
  )

  const verified = await verifyLoginOtp(
    { phone: user.phone!, code: '1234' },
    { userAgent: TEST_PREFIX, ipAddress: '127.0.0.1' }
  )
  assert.strictEqual(verified.redirectTo, 'HOME')
  assert.strictEqual(typeof verified.accessToken, 'string')
  assert.strictEqual(typeof verified.refreshToken, 'string')
}

async function testRegistrationDraftPhoneOtp() {
  const draftResponse = await createRegistrationDraft({
    flowType: RegistrationFlowType.DIRECT,
    fullName: `${TEST_PREFIX} Registration OTP`,
  })

  const phone = randomPhone()
  const phoneResponse = await updateDraftPhone(draftResponse.draft.id, { phone })
  assert.strictEqual(phoneResponse.draft.phone, phone)
  assert.strictEqual(phoneResponse.nextStep, 'OTP_INPUT')

  const sent = await sendDraftOtp(draftResponse.draft.id)
  assert.strictEqual(sent.nextStep, 'OTP_INPUT')
  assert.strictEqual(typeof sent.otpExpiresAt, 'string')
  assert.strictEqual(typeof sent.resendAvailableAt, 'string')

  await expectCode(
    () => verifyDraftOtp(draftResponse.draft.id, { code: '0000' }),
    'OTP_INVALID'
  )

  const verified = await verifyDraftOtp(draftResponse.draft.id, { code: '1234' })
  assert.strictEqual(verified.draft.phoneOtpVerified, true)
  assert.strictEqual(verified.nextStep, 'ROLE_CHOICE')
}

async function testExistingPhoneInRegistration() {
  const user = await createUser()
  const draftResponse = await createRegistrationDraft({
    flowType: RegistrationFlowType.DIRECT,
    fullName: `${TEST_PREFIX} Existing Phone`,
  })

  await assert.rejects(
    () => updateDraftPhone(draftResponse.draft.id, { phone: user.phone! }),
    (error: any) => {
      assert.strictEqual(error?.code, 'PHONE_ALREADY_REGISTERED')
      assert.strictEqual(error?.phone, user.phone)
      assert.strictEqual(error?.redirectTo, '/login/phone')
      assert.strictEqual(typeof error?.message, 'string')
      assert.ok(error.message.length > 0)
      return true
    }
  )
}

async function createInvite(params: {
  venueId: string
  inviterUserId: string
  token: string
  status: StaffInvitationStatus
  expiresAt: Date
}) {
  const venue = await prisma.venue.findUniqueOrThrow({
    where: {
      id: params.venueId,
    },
    select: {
      name: true,
    },
  })

  return prisma.staffInvitation.create({
    data: {
      venueId: params.venueId,
      inviterUserId: params.inviterUserId,
      invitedRole: DisplayRole.BARTENDER,
      invitedAccessLevel: AccessLevel.LINE_STAFF,
      status: params.status,
      currentTokenHash: hashInviteToken(params.token),
      inviteUrl: `https://barello.ru/addstaff/${transliterateToSlug(venue.name)}/${params.token}`,
      expiresAt: params.expiresAt,
    },
  })
}

async function testInviteErrorsMapToInviteExpired() {
  const inviter = await createUser()
  const { venue } = await createVenue({
    name: `${TEST_PREFIX} invite venue`,
  })
  const inviteToken = `expired-${randomUUID()}`

  await createInvite({
    venueId: venue.id,
    inviterUserId: inviter.id,
    token: inviteToken,
    status: StaffInvitationStatus.SENT,
    expiresAt: new Date(Date.now() - 1_000),
  })

  await expectCode(
    () =>
      resolveInviteToken({
        venueSlug: transliterateToSlug(venue.name),
        inviteToken,
      }),
    'INVITE_EXPIRED'
  )

  await expectCode(
    () =>
      resolveInviteToken({
        venueSlug: transliterateToSlug(venue.name),
        inviteToken: `invalid-${randomUUID()}`,
      }),
    'INVITE_EXPIRED'
  )

  const usedToken = `used-${randomUUID()}`
  await createInvite({
    venueId: venue.id,
    inviterUserId: inviter.id,
    token: usedToken,
    status: StaffInvitationStatus.ACCEPTED,
    expiresAt: new Date(Date.now() + 60_000),
  })

  await expectCode(
    () =>
      resolveInviteToken({
        venueSlug: transliterateToSlug(venue.name),
        inviteToken: usedToken,
      }),
    'INVITE_EXPIRED'
  )
}

async function testInnConflict() {
  const inn = randomInn()
  await createVenue({ inn, name: `${TEST_PREFIX} inn conflict venue` })

  const draftId = await createReadyDraftForInn('SUPPLIER_STAFF')

  await expectCode(
    () => lookupDraftInn(draftId, { inn }),
    'INN_CONFLICT'
  )
}

async function testInnConflictVariants() {
  const venueInn = randomInn()
  await createVenue({
    inn: venueInn,
    name: `${TEST_PREFIX} venue mismatch`,
  })
  await expectCode(
    async () => lookupDraftInn(await createReadyDraftForInn('SUPPLIER_STAFF'), { inn: venueInn }),
    'INN_CONFLICT'
  )

  const supplierInn = randomInn()
  await createSupplier({
    inn: supplierInn,
    name: `${TEST_PREFIX} supplier mismatch`,
  })
  await expectCode(
    async () => lookupDraftInn(await createReadyDraftForInn('VENUE_STAFF'), { inn: supplierInn }),
    'INN_CONFLICT'
  )

  const multipleVenuesInn = randomInn()
  const { business } = await createVenue({
    inn: multipleVenuesInn,
    name: `${TEST_PREFIX} multiple venues`,
  })
  await prisma.venue.create({
    data: {
      businessId: business.id,
      name: `${TEST_PREFIX} multiple venues branch`,
      city: 'Moscow',
      address: `${TEST_PREFIX} branch address`,
      ownerStatus: VenueOwnerStatus.OWNER_MISSING,
      venueStatus: VenueStatus.ACTIVE,
      isActive: true,
    },
  })
  await expectCode(
    async () => lookupDraftInn(await createReadyDraftForInn('VENUE_STAFF'), { inn: multipleVenuesInn }),
    'INN_CONFLICT'
  )

  const companyTypeConflictInn = randomInn()
  const conflict = await createVenue({
    inn: companyTypeConflictInn,
    name: `${TEST_PREFIX} company type conflict`,
  })
  await prisma.supplier.create({
    data: {
      businessId: conflict.business.id,
      name: `${TEST_PREFIX} company type conflict supplier`,
      city: 'Moscow',
      address: `${TEST_PREFIX} supplier address`,
      passwordHash: TEST_PREFIX,
      isActive: true,
    },
  })
  await expectCode(
    async () =>
      lookupDraftInn(await createReadyDraftForInn('VENUE_STAFF'), {
        inn: companyTypeConflictInn,
      }),
    'INN_CONFLICT'
  )
}

async function testVenueNotFoundForDeletedExistingVenueDraft() {
  const inn = randomInn()
  const { venue } = await createVenue({
    inn,
    name: `${TEST_PREFIX} deleted existing venue`,
  })
  const draftId = await createReadyDraftForInn('VENUE_STAFF')
  await lookupDraftInn(draftId, { inn })
  await prisma.venue.delete({
    where: {
      id: venue.id,
    },
  })

  await expectCode(
    () => confirmVenueExistingJoin(draftId),
    'VENUE_NOT_FOUND'
  )
}

async function testRefreshLogoutRegression() {
  const user = await createUser()
  await startLogin({ phone: user.phone! })
  const login = await verifyLoginOtp(
    { phone: user.phone!, code: '1234' },
    { userAgent: TEST_PREFIX, ipAddress: '127.0.0.1' }
  )

  const refreshed = await refreshAuthSession(
    { refreshToken: login.refreshToken },
    { userAgent: `${TEST_PREFIX}-refresh`, ipAddress: '127.0.0.1' }
  )
  assert.strictEqual(typeof refreshed.accessToken, 'string')
  assert.strictEqual(refreshed.refreshToken, login.refreshToken)

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

  await expectCode(
    () => refreshAuthSession({ refreshToken: login.refreshToken }),
    'REFRESH_TOKEN_INVALID'
  )
}

async function testProfileSectionPermissions() {
  const admin = await createVenueUserWithAccess(AccessLevel.ADMIN)
  const adminContext = await getHomeContext(authFor(admin.id, randomUUID()))
  assert.strictEqual(adminContext.user.accountType, AccountType.VENUE_STAFF)
  assert.strictEqual(adminContext.context?.type, 'VENUE')
  assert.strictEqual(adminContext.context?.accessLevel, AccessLevel.ADMIN)
  assert.strictEqual(adminContext.permissions.profileSections.downloads, true)
  assert.strictEqual(adminContext.navigation.homeRoute, '/home')

  const senior = await createVenueUserWithAccess(AccessLevel.SENIOR_STAFF)
  const seniorContext = await getHomeContext(authFor(senior.id, randomUUID()))
  assert.strictEqual(seniorContext.user.accountType, AccountType.VENUE_STAFF)
  assert.strictEqual(seniorContext.context?.type, 'VENUE')
  assert.strictEqual(seniorContext.context?.accessLevel, AccessLevel.SENIOR_STAFF)
  assert.strictEqual(seniorContext.permissions.profileSections.downloads, true)
  assert.strictEqual(seniorContext.navigation.homeRoute, '/home')

  const supplier = await createSupplierUserWithAccess()
  const supplierContext = await getHomeContext(authFor(supplier.id, randomUUID()))
  assert.strictEqual(supplierContext.user.accountType, AccountType.SUPPLIER_STAFF)
  assert.strictEqual(supplierContext.context?.type, 'SUPPLIER')
  assert.strictEqual(supplierContext.context?.membershipType, AccountType.SUPPLIER_STAFF)
  assert.strictEqual(supplierContext.permissions.profileSections.downloads, false)
  assert.strictEqual(supplierContext.navigation.homeRoute, '/home')

  const line = await createVenueUserWithAccess(AccessLevel.LINE_STAFF)
  const lineContext = await getHomeContext(authFor(line.id, randomUUID()))
  assert.strictEqual(lineContext.user.accountType, AccountType.VENUE_STAFF)
  assert.strictEqual(lineContext.context?.type, 'VENUE')
  assert.strictEqual(lineContext.context?.accessLevel, AccessLevel.LINE_STAFF)
  assert.strictEqual(lineContext.permissions.profileSections.downloads, false)
  assert.strictEqual(lineContext.navigation.homeRoute, '/home')
}

async function testProfileMobileContextBaselineContract() {
  const admin = await createVenueUserWithAccess(AccessLevel.ADMIN)
  const context = await getProfileMobileContext(authFor(admin.id, randomUUID()))

  assert.strictEqual(context.ok, true)
  assert.strictEqual(context.user.id, admin.id)
  assert.strictEqual(context.user.accountType, AccountType.VENUE_STAFF)
  assert.strictEqual(typeof context.user.fullName, 'string')
  assert.strictEqual(typeof context.user.phone, 'string')
  assert.strictEqual(context.context.accessLevel, AccessLevel.ADMIN)
  assert.strictEqual(context.navigation.homeRoute, '/home')
  assert.deepStrictEqual(context.notifications, { unreadCount: 0 })
  assert.deepStrictEqual(context.errorsBySection, {})
  assert.ok(context.completion)
  assert.ok(context.completion.venue)
  assert.strictEqual(context.completion.supplier, null)
  assert.ok(
    context.completion.venue.items.some((item) => item.completed === true)
  )
  for (const item of context.completion.venue.items) {
    assert.strictEqual(typeof item.rewardPercent, 'number')
    assert.strictEqual('rewardPoints' in item, false)
    assert.strictEqual(typeof item.completed, 'boolean')
  }
  assert.strictEqual(context.venues.length, 1)
  assert.strictEqual((context.activeVenue as any)?.id, context.venues[0]?.id)
  assert.strictEqual(context.canUnsetDefault, false)
  assert.deepStrictEqual((context.activeVenue as any)?.statistics, {
    menuItemsCount: 0,
    stockItemsCount: 0,
    ordersCount: 0,
    inventoriesCount: 0,
    staffCount: 1,
  })
  await expectCode(
    () => clearDefaultVenue(admin.id),
    'DEFAULT_VENUE_REQUIRED'
  )
  assert.strictEqual(context.permissions.profileSections.profile, true)
  assert.strictEqual(context.permissions.profileSections.myData, true)
  assert.strictEqual(context.permissions.profileSections.settings, true)
  assert.strictEqual(context.permissions.profileSections.business, true)
  assert.strictEqual(context.permissions.profileSections.downloads, true)
  assert.strictEqual(context.permissions.profileSections.tasks, true)
  assert.strictEqual(context.permissions.profileSections.notes, true)
  assert.strictEqual(context.permissions.profileSections.notifications, true)
  assert.strictEqual(context.permissions.profileSections.employeeInvite, true)
  assert.strictEqual(context.permissions.profileSections.supplierPrices, false)
  assert.strictEqual(context.permissions.profileSections.promoBalance, false)

  assert.strictEqual(context.permissions.actions.canEditProfile, true)
  assert.strictEqual(context.permissions.actions.canUploadAvatar, true)
  assert.strictEqual(context.permissions.actions.canInviteEmployees, true)
  assert.strictEqual(context.permissions.actions.canAddVenue, true)
  assert.strictEqual(context.permissions.actions.canEditVenue, true)
  assert.strictEqual(context.permissions.actions.canUploadVenuePhotos, true)
  assert.strictEqual(context.permissions.actions.canCreateTask, true)
  assert.strictEqual(context.permissions.actions.canAssignTask, true)
  assert.strictEqual(context.permissions.actions.canCreateSharedTask, true)
  assert.strictEqual(context.permissions.actions.canCreateNote, true)
  assert.strictEqual(context.permissions.actions.canCreateSharedNote, true)
  assert.strictEqual(context.permissions.actions.canUploadDownloads, true)
  assert.strictEqual(context.permissions.actions.canUploadPrice, false)
  assert.strictEqual(context.permissions.actions.canViewPromoBalance, false)
}

async function testProfileMobileRolePermissionsContract() {
  const admin = await createVenueUserWithAccess(AccessLevel.ADMIN)
  const adminContext = await getProfileMobileContext(authFor(admin.id, randomUUID()))
  assert.strictEqual(adminContext.permissions.profileSections.downloads, true)
  assert.strictEqual(adminContext.permissions.actions.canUploadDownloads, true)
  assert.strictEqual(adminContext.permissions.actions.canUploadVenuePhotos, true)

  const senior = await createVenueUserWithAccess(AccessLevel.SENIOR_STAFF)
  const seniorContext = await getProfileMobileContext(authFor(senior.id, randomUUID()))
  assert.strictEqual(seniorContext.permissions.profileSections.downloads, true)
  assert.strictEqual(seniorContext.permissions.actions.canUploadDownloads, true)
  assert.strictEqual(seniorContext.permissions.actions.canUploadVenuePhotos, true)

  const line = await createVenueUserWithAccess(AccessLevel.LINE_STAFF)
  const lineContext = await getProfileMobileContext(authFor(line.id, randomUUID()))
  assert.strictEqual(lineContext.permissions.profileSections.downloads, false)
  assert.strictEqual(lineContext.permissions.actions.canUploadDownloads, false)
  assert.strictEqual(lineContext.permissions.actions.canUploadVenuePhotos, false)
  await expectCode(
    () => assertProfileActionAllowed(authFor(line.id, randomUUID()), 'canUploadDownloads'),
    'SECTION_FORBIDDEN'
  )
  await expectCode(
    () => assertProfileActionAllowed(authFor(line.id, randomUUID()), 'canUploadVenuePhotos'),
    'SECTION_FORBIDDEN'
  )

  const supplier = await createSupplierUserWithAccess()
  const supplierContext = await getProfileMobileContext(authFor(supplier.id, randomUUID()))
  assert.strictEqual(supplierContext.permissions.profileSections.supplierPrices, true)
  assert.strictEqual(supplierContext.permissions.profileSections.promoBalance, true)
  assert.strictEqual(supplierContext.permissions.profileSections.downloads, false)
  assert.strictEqual(supplierContext.permissions.actions.canUploadPrice, true)
  assert.strictEqual(supplierContext.permissions.actions.canEditSupplierProfile, true)
  assert.strictEqual(supplierContext.permissions.actions.canManageManagers, true)
  assert.strictEqual(supplierContext.permissions.actions.canManageExperts, true)
  assert.ok(supplierContext.activeSupplier)
  assert.ok(supplierContext.completion)
  assert.strictEqual(supplierContext.completion.venue, null)
  assert.ok(supplierContext.completion.supplier)
  assert.ok(
    supplierContext.completion.supplier.items.some(
      (item) => item.completed === true
    )
  )
  for (const item of supplierContext.completion.supplier.items) {
    assert.strictEqual(typeof item.rewardPercent, 'number')
    assert.strictEqual('rewardPoints' in item, false)
    assert.strictEqual(typeof item.completed, 'boolean')
  }
  assert.deepStrictEqual((supplierContext.activeSupplier as any).statistics, {
    skuCount: 0,
    activeOrdersCount: 0,
    priceListsCount: 0,
    managersCount: 0,
    expertsCount: 0,
  })
}

async function testNotesLatestContract() {
  const admin = await createVenueUserWithAccess(AccessLevel.ADMIN)
  const auth = authFor(admin.id, randomUUID())
  const created = await createNote(auth, {
    title: 'Latest profile note',
    body: 'Contract body',
    scope: 'PRIVATE',
  })
  const latest = await getLatestNote(auth)
  assert.ok(latest)
  assert.strictEqual(latest.id, created.id)
  assert.strictEqual(latest.scope, 'PRIVATE')
}
async function testTasksContract() {
  const admin = await createVenueUserWithAccess(AccessLevel.ADMIN)
  const auth = authFor(admin.id, randomUUID())
  const today = new Date().toISOString().slice(0, 10)

  const week = await listTasks(auth, { period: 'week', date: today })
  assert.strictEqual(week.period, 'week')
  assert.strictEqual(week.days.length, 7)
  assert.ok(week.tasks.length >= 2)
  assert.ok(week.tasks.some((task) => task.title === 'Заполнить профиль'))

  const month = await listTasks(auth, { period: 'month', date: today })
  assert.strictEqual(month.period, 'month')
  assert.ok(month.days.length >= 28 && month.days.length <= 31)

  const created = await createTask(auth, {
    title: 'Contract task',
    dueAt: `${today}T18:00:00.000Z`,
    visibility: 'PRIVATE',
  })
  assert.strictEqual(created.status, 'OPEN')
  assert.strictEqual(created.assigneeId, admin.id)

  const updated = await updateTask(auth, created.id, { status: 'DONE' })
  assert.strictEqual(updated.status, 'DONE')

  assert.deepStrictEqual(await getTaskSettings(auth), {
    weekStartsOn: 1,
    showCompleted: true,
    notificationsEnabled: true,
  })
  assert.deepStrictEqual(
    await updateTaskSettings(auth, {
      weekStartsOn: 0,
      showCompleted: false,
      notificationsEnabled: false,
    }),
    {
      weekStartsOn: 0,
      showCompleted: false,
      notificationsEnabled: false,
    },
  )

  const mobileContext = await getProfileMobileContext(auth)
  assert.ok(mobileContext.tasks)
  assert.strictEqual(mobileContext.tasks.days.length, 7)

  const line = await createVenueUserWithAccess(AccessLevel.LINE_STAFF)
  await expectCode(
    () =>
      createTask(authFor(line.id, randomUUID()), {
        title: 'Forbidden assignment',
        dueAt: `${today}T18:00:00.000Z`,
        assigneeId: admin.id,
      }),
    'TASK_ASSIGNEE_FORBIDDEN',
  )
}
async function testNotificationsHttpContract() {
  const server = app.listen(0)

  try {
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve())
    })

    const address = server.address() as AddressInfo
    const baseUrl = `http://127.0.0.1:${address.port}`
    const user = await createVenueUserWithAccess(AccessLevel.ADMIN)
    const unread = await prisma.notification.create({
      data: {
        userId: user.id,
        title: 'Unread notification',
        description: 'Unread notification description',
        type: 'SYSTEM',
        relatedEntityType: 'venue',
        relatedEntityId: randomUUID(),
        relatedEntityRoute: '/venue/profile',
      },
    })
    await prisma.notification.create({
      data: {
        userId: user.id,
        title: 'Read notification',
        description: 'Read notification description',
        type: 'SYSTEM',
        isRead: true,
        readAt: new Date(),
      },
    })

    await startLogin({ phone: user.phone! })
    const login = await fetchJson(baseUrl, AUTH_PUBLIC_API_ROUTES.loginVerify.path, {
      method: AUTH_PUBLIC_API_ROUTES.loginVerify.method,
      body: toJsonBody({ phone: user.phone, code: '1234' }),
    })
    const headers = { Authorization: `Bearer ${login.json.accessToken}` }

    const summary = await fetchJson(baseUrl, '/notifications/summary', {
      method: 'GET',
      headers,
    })
    assert.strictEqual(summary.status, 200)
    assert.strictEqual(summary.json.unreadCount, 1)

    const mobileContext = await fetchJson(baseUrl, '/profile/mobile-context', {
      method: 'GET',
      headers,
    })
    assert.strictEqual(mobileContext.status, 200)
    assert.strictEqual(mobileContext.json.notifications.unreadCount, 1)

    const list = await fetchJson(baseUrl, '/notifications', {
      method: 'GET',
      headers,
    })
    assert.strictEqual(list.status, 200)
    assert.strictEqual(list.json.notifications.length, 2)

    const detail = await fetchJson(baseUrl, `/notifications/${unread.id}`, {
      method: 'GET',
      headers,
    })
    assert.strictEqual(detail.status, 200)
    assert.strictEqual(detail.json.notification.isRead, false)
    assert.deepStrictEqual(detail.json.notification.relatedEntity, {
      type: 'venue',
      id: unread.relatedEntityId,
      route: '/venue/profile',
    })

    const marked = await fetchJson(
      baseUrl,
      `/notifications/${unread.id}/read`,
      { method: 'PATCH', headers },
    )
    assert.strictEqual(marked.status, 200)
    assert.strictEqual(marked.json.notification.isRead, true)

    const missing = await fetchJson(
      baseUrl,
      `/notifications/${randomUUID()}`,
      { method: 'GET', headers },
    )
    expectErrorResponse(missing, {
      status: 404,
      code: 'NOTIFICATION_NOT_FOUND',
    })

    const readAll = await fetchJson(baseUrl, '/notifications/read-all', {
      method: 'PATCH',
      headers,
    })
    assert.strictEqual(readAll.status, 200)
    assert.strictEqual(readAll.json.unreadCount, 0)

    const unidentified = await createUser(randomPhone(), AccountType.UNIDENTIFIED)
    await startLogin({ phone: unidentified.phone! })
    const unidentifiedLogin = await fetchJson(
      baseUrl,
      AUTH_PUBLIC_API_ROUTES.loginVerify.path,
      {
        method: AUTH_PUBLIC_API_ROUTES.loginVerify.method,
        body: toJsonBody({ phone: unidentified.phone, code: '1234' }),
      },
    )
    const forbidden = await fetchJson(baseUrl, '/notifications/summary', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${unidentifiedLogin.json.accessToken}`,
      },
    })
    expectErrorResponse(forbidden, {
      status: 403,
      code: 'SECTION_FORBIDDEN',
    })
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }
}
async function testProfileLineStaffForbiddenHttpContract() {
  const server = app.listen(0)

  try {
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve())
    })

    const address = server.address() as AddressInfo
    const baseUrl = `http://127.0.0.1:${address.port}`
    const line = await createVenueUserWithAccess(AccessLevel.LINE_STAFF)

    await startLogin({ phone: line.phone! })
    const login = await fetchJson(baseUrl, AUTH_PUBLIC_API_ROUTES.loginVerify.path, {
      method: AUTH_PUBLIC_API_ROUTES.loginVerify.method,
      body: toJsonBody({ phone: line.phone, code: '1234' }),
    })

    assert.strictEqual(login.status, 200)
    assert.strictEqual(typeof login.json.accessToken, 'string')

    const forbidden = await fetchJson(baseUrl, '/profile/media/venue-photos', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${login.json.accessToken}`,
      },
    })

    expectErrorResponse(forbidden, {
      status: 403,
      code: 'SECTION_FORBIDDEN',
    })
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  }
}

async function testAuthServiceLayerFacadesStaySeparated() {
  const serviceFiles = {
    login: await readFile(
      path.resolve(process.cwd(), 'src/modules/auth/login.service.ts'),
      'utf8'
    ),
    registrationDraft: await readFile(
      path.resolve(
        process.cwd(),
        'src/modules/auth/registration-draft.service.ts'
      ),
      'utf8'
    ),
    registrationConfirm: await readFile(
      path.resolve(
        process.cwd(),
        'src/modules/auth/registration-confirm.service.ts'
      ),
      'utf8'
    ),
    otp: await readFile(
      path.resolve(process.cwd(), 'src/modules/auth/otp.service.ts'),
      'utf8'
    ),
    session: await readFile(
      path.resolve(process.cwd(), 'src/modules/auth/session.service.ts'),
      'utf8'
    ),
    core: await readFile(
      path.resolve(process.cwd(), 'src/modules/auth/auth-core.service.ts'),
      'utf8'
    ),
  }

  assert.ok(serviceFiles.login.includes('startLogin'))
  assert.ok(serviceFiles.login.includes('checkLoginPhone'))
  assert.ok(serviceFiles.login.includes('verifyLoginOtp'))
  assert.strictEqual(serviceFiles.login.includes('createRegistrationDraft'), false)
  assert.strictEqual(serviceFiles.login.includes('refreshAuthSession'), false)

  assert.ok(serviceFiles.registrationDraft.includes('createRegistrationDraft'))
  assert.ok(serviceFiles.registrationDraft.includes('sendDraftOtp'))
  assert.ok(serviceFiles.registrationDraft.includes('verifyDraftOtp'))
  assert.strictEqual(serviceFiles.registrationDraft.includes('startLogin'), false)
  assert.strictEqual(
    serviceFiles.registrationDraft.includes('refreshAuthSession'),
    false
  )

  assert.ok(serviceFiles.registrationConfirm.includes('confirmSupplierCreate'))
  assert.ok(serviceFiles.registrationConfirm.includes('confirmVenueCreate'))
  assert.ok(serviceFiles.registrationConfirm.includes('confirmInviteStaff'))
  assert.strictEqual(
    serviceFiles.registrationConfirm.includes('createRegistrationDraft'),
    false
  )
  assert.strictEqual(serviceFiles.registrationConfirm.includes('startLogin'), false)

  assert.ok(serviceFiles.otp.includes('OTP_PURPOSE'))
  assert.ok(serviceFiles.otp.includes('createOtpCodeRecord'))
  assert.ok(serviceFiles.otp.includes('verifyOtpCodeOrThrow'))
  assert.strictEqual(serviceFiles.otp.includes('startLogin'), false)

  assert.ok(serviceFiles.session.includes('refreshAuthSession'))
  assert.ok(serviceFiles.session.includes('logout'))
  assert.ok(serviceFiles.session.includes('getMe'))
  assert.strictEqual(serviceFiles.session.includes('createRegistrationDraft'), false)
  assert.strictEqual(serviceFiles.session.includes('verifyLoginOtp'), false)

  assert.ok(serviceFiles.core.includes('export const LOGIN_FLOW_ERROR_CODES'))
  assert.ok(serviceFiles.core.includes('export const REGISTRATION_FLOW_ERROR_CODES'))
  assert.ok(serviceFiles.core.includes('export const DRAFT_ERROR_CODES'))
  assert.ok(serviceFiles.core.includes('export const SESSION_ERROR_CODES'))
  assert.ok(serviceFiles.core.includes('export const VALIDATION_ERROR_CODES'))
}

async function testAuthErrorCodeNamespaces() {
  assert.deepStrictEqual(LOGIN_FLOW_ERROR_CODES, {
    PHONE_NOT_REGISTERED: 'PHONE_NOT_REGISTERED',
    OTP_RESEND_COOLDOWN: 'OTP_RESEND_COOLDOWN',
    OTP_EXPIRED: 'OTP_EXPIRED',
    OTP_INVALID: 'OTP_INVALID',
  })
  assert.strictEqual(
    'OTP_ATTEMPTS_EXCEEDED' in LOGIN_FLOW_ERROR_CODES,
    false
  )

  assert.deepStrictEqual(REGISTRATION_FLOW_ERROR_CODES, {
    PHONE_ALREADY_REGISTERED: 'PHONE_ALREADY_REGISTERED',
    INN_CONFLICT: 'INN_CONFLICT',
    INVITE_EXPIRED: 'INVITE_EXPIRED',
    VENUE_NOT_FOUND: 'VENUE_NOT_FOUND',
  })

  assert.deepStrictEqual(
    {
      DRAFT_NOT_FOUND: DRAFT_ERROR_CODES.DRAFT_NOT_FOUND,
      DRAFT_EXPIRED: DRAFT_ERROR_CODES.DRAFT_EXPIRED,
      DRAFT_NOT_READY: DRAFT_ERROR_CODES.DRAFT_NOT_READY,
      OTP_NOT_VERIFIED: DRAFT_ERROR_CODES.OTP_NOT_VERIFIED,
      ROLE_REQUIRED: DRAFT_ERROR_CODES.ROLE_REQUIRED,
    },
    {
      DRAFT_NOT_FOUND: 'DRAFT_NOT_FOUND',
      DRAFT_EXPIRED: 'DRAFT_EXPIRED',
      DRAFT_NOT_READY: 'DRAFT_NOT_READY',
      OTP_NOT_VERIFIED: 'OTP_NOT_VERIFIED',
      ROLE_REQUIRED: 'ROLE_REQUIRED',
    }
  )

  assert.deepStrictEqual(
    {
      AUTH_REQUIRED: SESSION_ERROR_CODES.AUTH_REQUIRED,
      REFRESH_TOKEN_REQUIRED: SESSION_ERROR_CODES.REFRESH_TOKEN_REQUIRED,
      REFRESH_TOKEN_INVALID: SESSION_ERROR_CODES.REFRESH_TOKEN_INVALID,
      REFRESH_TOKEN_EXPIRED: SESSION_ERROR_CODES.REFRESH_TOKEN_EXPIRED,
      REFRESH_TOKEN_REUSED: SESSION_ERROR_CODES.REFRESH_TOKEN_REUSED,
      LOGOUT_FAILED: SESSION_ERROR_CODES.LOGOUT_FAILED,
    },
    {
      AUTH_REQUIRED: 'AUTH_REQUIRED',
      REFRESH_TOKEN_REQUIRED: 'REFRESH_TOKEN_REQUIRED',
      REFRESH_TOKEN_INVALID: 'REFRESH_TOKEN_INVALID',
      REFRESH_TOKEN_EXPIRED: 'REFRESH_TOKEN_EXPIRED',
      REFRESH_TOKEN_REUSED: 'REFRESH_TOKEN_REUSED',
      LOGOUT_FAILED: 'LOGOUT_FAILED',
    }
  )

  assert.deepStrictEqual(VALIDATION_ERROR_CODES, {
    PHONE_REQUIRED: 'PHONE_REQUIRED',
    PHONE_INVALID: 'PHONE_INVALID',
    INN_INVALID: 'INN_INVALID',
  })
}

async function testLoginOtpAttemptsExceededMapsToInvalid() {
  const user = await createUser()
  await startLogin({ phone: user.phone! })

  for (let attempt = 0; attempt < 6; attempt += 1) {
    await expectCode(
      () => verifyLoginOtp({ phone: user.phone!, code: `000${attempt}` }),
      'OTP_INVALID'
    )
  }
}

async function testPublicApiRouteRegistry() {
  assert.deepStrictEqual(AUTH_PUBLIC_API_ROUTES.loginStart, {
    method: 'POST',
    path: '/auth/login/start',
  })
  assert.deepStrictEqual(AUTH_PUBLIC_API_ROUTES.loginCheckPhone, {
    method: 'POST',
    path: '/auth/login/check-phone',
  })
  assert.deepStrictEqual(AUTH_PUBLIC_API_ROUTES.loginResend, {
    method: 'POST',
    path: '/auth/login/resend',
  })
  assert.deepStrictEqual(AUTH_PUBLIC_API_ROUTES.loginVerify, {
    method: 'POST',
    path: '/auth/login/verify',
  })
  assert.deepStrictEqual(AUTH_PUBLIC_API_ROUTES.refresh, {
    method: 'POST',
    path: '/auth/refresh',
  })
  assert.deepStrictEqual(AUTH_PUBLIC_API_ROUTES.logout, {
    method: 'POST',
    path: '/auth/logout',
  })
  assert.deepStrictEqual(AUTH_PUBLIC_API_ROUTES.me, {
    method: 'GET',
    path: '/auth/me',
  })
  assert.strictEqual(
    REGISTRATION_DRAFT_PUBLIC_API_PREFIX,
    '/registration-drafts'
  )
  assert.strictEqual(
    REGISTRATION_DRAFT_PUBLIC_API_ROUTES.createDraft.path,
    '/registration-drafts'
  )
  assert.ok(
    Object.values(REGISTRATION_DRAFT_PUBLIC_API_ROUTES).every((route) =>
      route.path.startsWith('/registration-drafts')
    )
  )
}

async function testAuthControllerOnlyOwnsLoginAndSessionRoutes() {
  const controllerPath = path.resolve(
    process.cwd(),
    'src/modules/auth/auth.controller.ts'
  )
  const source = await readFile(controllerPath, 'utf8')
  const routeMatches = [...source.matchAll(/authRouter\.(get|post|patch|put|delete)\('([^']+)'/g)]
  const routes = routeMatches.map((match) => ({
    method: match[1].toUpperCase(),
    path: match[2],
  }))

  assert.deepStrictEqual(routes, [
    { method: 'POST', path: '/login/start' },
    { method: 'POST', path: '/login/check-phone' },
    { method: 'POST', path: '/login/resend' },
    { method: 'POST', path: '/login/verify' },
    { method: 'POST', path: '/refresh' },
    { method: 'GET', path: '/me' },
    { method: 'POST', path: '/logout' },
  ])

  for (const forbiddenPattern of [
    '/profile-completion',
    '/account-deletion',
    'registration-drafts',
    'staff-invitations',
    'invite-token',
  ]) {
    assert.strictEqual(
      source.includes(forbiddenPattern),
      false,
      `auth.controller.ts must not own ${forbiddenPattern}`
    )
  }
}

async function testNonAuthFlowEndpointsStayInSeparateAuthMountedRouters() {
  const appSource = await readFile(path.resolve(process.cwd(), 'src/app.ts'), 'utf8')
  const profileControllerSource = await readFile(
    path.resolve(
      process.cwd(),
      'src/modules/auth/auth-profile-completion.controller.ts'
    ),
    'utf8'
  )
  const accountDeletionControllerSource = await readFile(
    path.resolve(
      process.cwd(),
      'src/modules/auth/auth-account-deletion.controller.ts'
    ),
    'utf8'
  )

  assert.ok(
    appSource.includes("app.use('/auth', authProfileCompletionRouter)"),
    'profile completion must be mounted as a separate /auth router'
  )
  assert.ok(
    appSource.includes("app.use('/auth', authAccountDeletionRouter)"),
    'account deletion must be mounted as a separate /auth router'
  )
  assert.ok(
    appSource.includes("app.use('/auth', authRouter)"),
    'login/session authRouter must remain mounted under /auth'
  )

  assert.ok(profileControllerSource.includes("get('/profile-completion'"))
  assert.ok(accountDeletionControllerSource.includes("get('/account-deletion'"))
  assert.ok(accountDeletionControllerSource.includes("post('/account-deletion'"))

  for (const source of [
    profileControllerSource,
    accountDeletionControllerSource,
  ]) {
    assert.strictEqual(source.includes("'/login/"), false)
    assert.strictEqual(source.includes("'/refresh'"), false)
    assert.strictEqual(source.includes("'/logout'"), false)
    assert.strictEqual(source.includes("'/me'"), false)
  }
}

async function testRegistrationControllerOnlyOwnsDraftAndWizardRoutes() {
  const controllerPath = path.resolve(
    process.cwd(),
    'src/modules/auth/registration.controller.ts'
  )
  const source = await readFile(controllerPath, 'utf8')
  const routeMatches = [
    ...source.matchAll(
      /registrationRouter\.(get|post|patch|put|delete)\(\s*'([^']+)'/g
    ),
  ]
  const routes = routeMatches.map((match) => ({
    method: match[1].toUpperCase(),
    path: match[2],
  }))

  assert.deepStrictEqual(routes, [
    { method: 'POST', path: '/registration-drafts' },
    { method: 'POST', path: '/registration-drafts/invite-token/resolve' },
    { method: 'GET', path: '/registration-drafts/:draftId' },
    { method: 'GET', path: '/registration-drafts/:draftId/status' },
    { method: 'PATCH', path: '/registration-drafts/:draftId/full-name' },
    { method: 'PATCH', path: '/registration-drafts/:draftId/phone' },
    { method: 'POST', path: '/registration-drafts/:draftId/otp/send' },
    { method: 'POST', path: '/registration-drafts/:draftId/otp/verify' },
    { method: 'PATCH', path: '/registration-drafts/:draftId/role' },
    { method: 'POST', path: '/registration-drafts/:draftId/inn/lookup' },
    { method: 'GET', path: '/registration-drafts/:draftId/verification' },
    { method: 'POST', path: '/registration-drafts/:draftId/confirm/supplier-create' },
    {
      method: 'POST',
      path: '/registration-drafts/:draftId/confirm/supplier-existing-company',
    },
    { method: 'POST', path: '/registration-drafts/:draftId/confirm/supplier-not-found' },
    { method: 'POST', path: '/registration-drafts/:draftId/confirm/venue-create' },
    { method: 'POST', path: '/registration-drafts/:draftId/confirm/venue-existing-owner' },
    {
      method: 'POST',
      path: '/registration-drafts/:draftId/confirm/venue-existing-no-owner',
    },
    { method: 'POST', path: '/registration-drafts/:draftId/confirm/venue-existing-join' },
    { method: 'POST', path: '/registration-drafts/:draftId/confirm/venue-not-found' },
    { method: 'POST', path: '/registration-drafts/:draftId/confirm/invite-staff' },
  ])

  assert.ok(routes.every((route) => route.path.startsWith('/registration-drafts')))

  for (const forbiddenPattern of [
    "'/login/",
    "'/refresh'",
    "'/logout'",
    "'/me'",
    '/profile-completion',
    '/account-deletion',
    '/staff-invitations',
  ]) {
    assert.strictEqual(
      source.includes(forbiddenPattern),
      false,
      `registration.controller.ts must not own ${forbiddenPattern}`
    )
  }
}

async function testPublicApiHttpContracts() {
  const server = app.listen(0)

  try {
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve())
    })

    const address = server.address() as AddressInfo
    const baseUrl = `http://127.0.0.1:${address.port}`
    const unknownPhone = randomPhone()

    const unknownLogin = await fetchJson(
      baseUrl,
      AUTH_PUBLIC_API_ROUTES.loginStart.path,
      {
        method: AUTH_PUBLIC_API_ROUTES.loginStart.method,
        body: toJsonBody({ phone: unknownPhone }),
      }
    )
    expectErrorResponse(unknownLogin, {
      status: 404,
      code: 'PHONE_NOT_REGISTERED',
      nextStep: 'PHONE_INPUT',
    })

    const phoneCheck = await fetchJson(
      baseUrl,
      AUTH_PUBLIC_API_ROUTES.loginCheckPhone.path,
      {
        method: AUTH_PUBLIC_API_ROUTES.loginCheckPhone.method,
        body: toJsonBody({ phone: unknownPhone }),
      }
    )
    assert.strictEqual(phoneCheck.status, 200)
    assert.strictEqual(phoneCheck.json.exists, false)
    assert.strictEqual(phoneCheck.json.canLogin, false)

    const user = await createUser()
    const loginStart = await fetchJson(
      baseUrl,
      AUTH_PUBLIC_API_ROUTES.loginStart.path,
      {
        method: AUTH_PUBLIC_API_ROUTES.loginStart.method,
        body: toJsonBody({ phone: user.phone }),
      }
    )
    assert.strictEqual(loginStart.status, 200)
    assert.strictEqual(loginStart.json.phone, user.phone)
    assert.strictEqual(loginStart.json.nextStep, 'OTP_INPUT')
    assert.strictEqual(typeof loginStart.json.otpExpiresAt, 'string')
    assert.strictEqual(typeof loginStart.json.resendAvailableAt, 'string')

    await prisma.verificationCode.deleteMany({
      where: {
        target: user.phone!,
      },
    })

    const loginResend = await fetchJson(
      baseUrl,
      AUTH_PUBLIC_API_ROUTES.loginResend.path,
      {
        method: AUTH_PUBLIC_API_ROUTES.loginResend.method,
        body: toJsonBody({ phone: user.phone }),
      }
    )
    assert.strictEqual(loginResend.status, 200)
    assert.strictEqual(loginResend.json.phone, user.phone)
    assert.strictEqual(loginResend.json.nextStep, 'OTP_INPUT')
    assert.strictEqual(typeof loginResend.json.otpExpiresAt, 'string')
    assert.strictEqual(typeof loginResend.json.resendAvailableAt, 'string')

    const loginResendCooldown = await fetchJson(
      baseUrl,
      AUTH_PUBLIC_API_ROUTES.loginResend.path,
      {
        method: AUTH_PUBLIC_API_ROUTES.loginResend.method,
        body: toJsonBody({ phone: user.phone }),
      }
    )
    expectErrorResponse(loginResendCooldown, {
      status: 429,
      code: 'OTP_RESEND_COOLDOWN',
      nextStep: 'OTP_INPUT',
      phone: user.phone!,
      hasOtpTimestamps: true,
    })

    const loginVerify = await fetchJson(
      baseUrl,
      AUTH_PUBLIC_API_ROUTES.loginVerify.path,
      {
        method: AUTH_PUBLIC_API_ROUTES.loginVerify.method,
        body: toJsonBody({ phone: user.phone, code: '1234' }),
      }
    )
    assert.strictEqual(loginVerify.status, 200)
    assert.strictEqual(loginVerify.json.redirectTo, 'HOME')
    assert.strictEqual(typeof loginVerify.json.accessToken, 'string')
    assert.strictEqual(typeof loginVerify.json.refreshToken, 'string')

    const me = await fetchJson(baseUrl, AUTH_PUBLIC_API_ROUTES.me.path, {
      method: AUTH_PUBLIC_API_ROUTES.me.method,
      headers: {
        Authorization: `Bearer ${loginVerify.json.accessToken}`,
      },
    })
    assert.strictEqual(me.status, 200)
    assert.strictEqual(me.json.type, 'user')
    assert.strictEqual(me.json.user.id, user.id)

    const mobileContext = await fetchJson(baseUrl, '/profile/mobile-context', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${loginVerify.json.accessToken}`,
      },
    })
    assert.strictEqual(mobileContext.status, 200)
    assert.strictEqual(mobileContext.json.ok, true)
    assert.strictEqual(mobileContext.json.user.id, user.id)
    assert.strictEqual(typeof mobileContext.json.user.fullName, 'string')
    assert.strictEqual(typeof mobileContext.json.user.phone, 'string')
    assert.strictEqual(typeof mobileContext.json.permissions.profileSections, 'object')
    assert.strictEqual(typeof mobileContext.json.permissions.actions, 'object')
    assert.strictEqual(typeof mobileContext.json.navigation.homeRoute, 'string')
    assert.strictEqual(typeof mobileContext.json.notifications.unreadCount, 'number')
    assert.deepStrictEqual(mobileContext.json.errorsBySection, {})

    const unauthorizedMe = await fetchJson(
      baseUrl,
      AUTH_PUBLIC_API_ROUTES.me.path,
      {
        method: AUTH_PUBLIC_API_ROUTES.me.method,
      }
    )
    expectErrorResponse(unauthorizedMe, {
      status: 401,
      code: 'AUTH_REQUIRED',
    })

    const refresh = await fetchJson(
      baseUrl,
      AUTH_PUBLIC_API_ROUTES.refresh.path,
      {
        method: AUTH_PUBLIC_API_ROUTES.refresh.method,
        body: toJsonBody({ refreshToken: loginVerify.json.refreshToken }),
      }
    )
    assert.strictEqual(refresh.status, 200)
    assert.strictEqual(typeof refresh.json.accessToken, 'string')
    assert.strictEqual(refresh.json.refreshToken, loginVerify.json.refreshToken)

    const invalidRefresh = await fetchJson(
      baseUrl,
      AUTH_PUBLIC_API_ROUTES.refresh.path,
      {
        method: AUTH_PUBLIC_API_ROUTES.refresh.method,
        body: toJsonBody({ refreshToken: 'invalid-refresh-token' }),
      }
    )
    expectErrorResponse(invalidRefresh, {
      status: 401,
      code: 'REFRESH_TOKEN_INVALID',
    })

    const logoutResponse = await fetchJson(
      baseUrl,
      AUTH_PUBLIC_API_ROUTES.logout.path,
      {
        method: AUTH_PUBLIC_API_ROUTES.logout.method,
        headers: {
          Authorization: `Bearer ${loginVerify.json.accessToken}`,
        },
      }
    )
    assert.strictEqual(logoutResponse.status, 204)

    const draftCreate = await fetchJson(
      baseUrl,
      REGISTRATION_DRAFT_PUBLIC_API_ROUTES.createDraft.path,
      {
        method: REGISTRATION_DRAFT_PUBLIC_API_ROUTES.createDraft.method,
        body: toJsonBody({
          flowType: RegistrationFlowType.DIRECT,
          fullName: `${TEST_PREFIX} HTTP Draft`,
        }),
      }
    )
    assert.strictEqual(draftCreate.status, 201)
    assert.strictEqual(draftCreate.json.nextStep, 'PHONE_INPUT')
    assert.strictEqual(typeof draftCreate.json.draft.id, 'string')

    const draftId = draftCreate.json.draft.id
    const draftPath = (path: string) => path.replace(':draftId', draftId)

    const draftGet = await fetchJson(
      baseUrl,
      draftPath(REGISTRATION_DRAFT_PUBLIC_API_ROUTES.getDraft.path),
      {
        method: REGISTRATION_DRAFT_PUBLIC_API_ROUTES.getDraft.method,
      }
    )
    assert.strictEqual(draftGet.status, 200)
    assert.strictEqual(draftGet.json.draft.id, draftId)

    const draftStatus = await fetchJson(
      baseUrl,
      draftPath(REGISTRATION_DRAFT_PUBLIC_API_ROUTES.getDraftStatus.path),
      {
        method: REGISTRATION_DRAFT_PUBLIC_API_ROUTES.getDraftStatus.method,
      }
    )
    assert.strictEqual(draftStatus.status, 200)
    assert.strictEqual(draftStatus.json.exists, true)

    const fullNameUpdate = await fetchJson(
      baseUrl,
      draftPath(REGISTRATION_DRAFT_PUBLIC_API_ROUTES.updateFullName.path),
      {
        method: REGISTRATION_DRAFT_PUBLIC_API_ROUTES.updateFullName.method,
        body: toJsonBody({ fullName: `${TEST_PREFIX} HTTP Renamed` }),
      }
    )
    assert.strictEqual(fullNameUpdate.status, 200)

    const existingPhoneUpdate = await fetchJson(
      baseUrl,
      draftPath(REGISTRATION_DRAFT_PUBLIC_API_ROUTES.updatePhone.path),
      {
        method: REGISTRATION_DRAFT_PUBLIC_API_ROUTES.updatePhone.method,
        body: toJsonBody({ phone: user.phone }),
      }
    )
    expectErrorResponse(existingPhoneUpdate, {
      status: 409,
      code: 'PHONE_ALREADY_REGISTERED',
      nextStep: 'PHONE_INPUT',
      redirectTo: '/login/phone',
      phone: user.phone!,
    })

    const registrationPhone = randomPhone()
    const phoneUpdate = await fetchJson(
      baseUrl,
      draftPath(REGISTRATION_DRAFT_PUBLIC_API_ROUTES.updatePhone.path),
      {
        method: REGISTRATION_DRAFT_PUBLIC_API_ROUTES.updatePhone.method,
        body: toJsonBody({ phone: registrationPhone }),
      }
    )
    assert.strictEqual(phoneUpdate.status, 200)
    assert.strictEqual(phoneUpdate.json.nextStep, 'OTP_INPUT')

    const draftOtpSend = await fetchJson(
      baseUrl,
      draftPath(REGISTRATION_DRAFT_PUBLIC_API_ROUTES.sendOtp.path),
      {
        method: REGISTRATION_DRAFT_PUBLIC_API_ROUTES.sendOtp.method,
      }
    )
    assert.strictEqual(draftOtpSend.status, 200)
    assert.strictEqual(typeof draftOtpSend.json.otpExpiresAt, 'string')
    assert.strictEqual(typeof draftOtpSend.json.resendAvailableAt, 'string')

    const draftOtpCooldown = await fetchJson(
      baseUrl,
      draftPath(REGISTRATION_DRAFT_PUBLIC_API_ROUTES.sendOtp.path),
      {
        method: REGISTRATION_DRAFT_PUBLIC_API_ROUTES.sendOtp.method,
      }
    )
    expectErrorResponse(draftOtpCooldown, {
      status: 429,
      code: 'OTP_RESEND_COOLDOWN',
      nextStep: 'OTP_INPUT',
      phone: registrationPhone,
      hasOtpTimestamps: true,
    })

    const draftOtpVerify = await fetchJson(
      baseUrl,
      draftPath(REGISTRATION_DRAFT_PUBLIC_API_ROUTES.verifyOtp.path),
      {
        method: REGISTRATION_DRAFT_PUBLIC_API_ROUTES.verifyOtp.method,
        body: toJsonBody({ code: '1234' }),
      }
    )
    assert.strictEqual(draftOtpVerify.status, 200)
    assert.strictEqual(draftOtpVerify.json.draft.phoneOtpVerified, true)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  }
}

type SmokeContractTest = {
  name: string
  run: () => Promise<void>
}

const BASELINE_AUTH_CONTRACT_TESTS: SmokeContractTest[] = [
  {
    name: 'login unknown phone',
    run: testLoginUnknownPhone,
  },
  {
    name: 'login OTP verify',
    run: testLoginOtpVerify,
  },
  {
    name: 'registration draft phone OTP',
    run: testRegistrationDraftPhoneOtp,
  },
  {
    name: 'existing phone in registration',
    run: testExistingPhoneInRegistration,
  },
  {
    name: 'invite expired',
    run: testInviteErrorsMapToInviteExpired,
  },
  {
    name: 'INN conflict',
    run: testInnConflict,
  },
  {
    name: 'refresh/logout regression',
    run: testRefreshLogoutRegression,
  },
]

const EXTENDED_AUTH_CONTRACT_TESTS: SmokeContractTest[] = [
  {
    name: 'invite, INN, and venue edge-case contracts',
    run: async () => {
      await testInnConflictVariants()
      await testVenueNotFoundForDeletedExistingVenueDraft()
    },
  },
  {
    name: 'profile section permissions',
    run: testProfileSectionPermissions,
  },
  {
    name: 'profile mobile context baseline contract',
    run: testProfileMobileContextBaselineContract,
  },
  {
    name: 'profile mobile role permissions contract',
    run: testProfileMobileRolePermissionsContract,
  },
  {
    name: 'tasks contract',
    run: testTasksContract,
  },
  {
    name: 'notifications HTTP contract',
    run: testNotificationsHttpContract,
  },
  {
    name: 'profile line staff forbidden HTTP contract',
    run: testProfileLineStaffForbiddenHttpContract,
  },
  {
    name: 'auth service layer boundaries',
    run: testAuthServiceLayerFacadesStaySeparated,
  },
  {
    name: 'auth error code namespaces',
    run: testAuthErrorCodeNamespaces,
  },
  {
    name: 'login OTP attempts map to invalid',
    run: testLoginOtpAttemptsExceededMapsToInvalid,
  },
  {
    name: 'public API route registry',
    run: testPublicApiRouteRegistry,
  },
  {
    name: 'auth controller route ownership',
    run: testAuthControllerOnlyOwnsLoginAndSessionRoutes,
  },
  {
    name: 'non-auth-flow auth-mounted routers',
    run: testNonAuthFlowEndpointsStayInSeparateAuthMountedRouters,
  },
  {
    name: 'registration controller route ownership',
    run: testRegistrationControllerOnlyOwnsDraftAndWizardRoutes,
  },
  {
    name: 'public API HTTP contracts',
    run: testPublicApiHttpContracts,
  },
]

async function runSmokeTests(tests: SmokeContractTest[]) {
  for (const test of tests) {
    await test.run()
  }
}

async function main() {
  await cleanup()

  try {
    await runSmokeTests(BASELINE_AUTH_CONTRACT_TESTS)
    await runSmokeTests(EXTENDED_AUTH_CONTRACT_TESTS)

    console.info('[auth-contract-smoke] all checks passed')
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
}

main().catch(async (error) => {
  console.error('[auth-contract-smoke] failed:', error)
  await prisma.$disconnect()
  process.exit(1)
})
