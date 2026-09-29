import { randomUUID } from 'crypto'

import { prisma } from '../../lib/prisma'
import {
  AccessLevel,
  AccountType,
  AuthSession,
  CompanyModerationRequestSource,
  CompanyType,
  DisplayRole,
  MembershipStatus,
  Prisma,
  RegistrationDraftStatus,
  RegistrationFlowType,
  StaffInvitationStatus,
  UserStatus,
  VerificationCodeType,
  VenueOwnerStatus,
  VenueStatus,
} from '../../generated/prisma'
import type { AuthPayload } from '../../middleware/auth'
import { env } from '../../config/env'
import {
  comparePassword,
  hashPassword,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../utils/auth'
import { resolveInvitationByToken, transliterateToSlug } from './staff-invitations.service'
import { normalizePhoneOrThrow } from '../../utils/phone'
import {
  ensureSingleVenueOwner,
  resetActiveVenueToDefault,
  setInitialUserVenueContext,
} from '../venues/venue-context.service'

const OTP_TTL_MINUTES = 10
const OTP_MAX_VERIFY_ATTEMPTS = 5
const OTP_RESEND_COOLDOWN_SECONDS = 60
const OTP_ATTEMPT_PREFIX = '__attempt__:'
const TEST_VERIFICATION_CODE = '1234'
const DEFAULT_SUPPLIER_ROLE = 'SUPPLIER_ADMIN'

export const OTP_PURPOSE = {
  LOGIN: 'LOGIN',
  REGISTRATION_PHONE: 'REGISTRATION_PHONE',
} as const

export type OtpPurpose = (typeof OTP_PURPOSE)[keyof typeof OTP_PURPOSE]

export const VALIDATION_ERROR_CODES = {
  PHONE_REQUIRED: 'PHONE_REQUIRED',
  PHONE_INVALID: 'PHONE_INVALID',
  INN_INVALID: 'INN_INVALID',
} as const

export const LOGIN_FLOW_ERROR_CODES = {
  PHONE_NOT_REGISTERED: 'PHONE_NOT_REGISTERED',
  OTP_RESEND_COOLDOWN: 'OTP_RESEND_COOLDOWN',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_INVALID: 'OTP_INVALID',
} as const

export const REGISTRATION_FLOW_ERROR_CODES = {
  PHONE_ALREADY_REGISTERED: 'PHONE_ALREADY_REGISTERED',
  INN_CONFLICT: 'INN_CONFLICT',
  INVITE_EXPIRED: 'INVITE_EXPIRED',
  VENUE_NOT_FOUND: 'VENUE_NOT_FOUND',
} as const

export const DRAFT_ERROR_CODES = {
  DRAFT_ALREADY_COMPLETED: 'DRAFT_ALREADY_COMPLETED',
  DRAFT_EXPIRED: 'DRAFT_EXPIRED',
  DRAFT_NOT_FOUND: 'DRAFT_NOT_FOUND',
  DRAFT_NOT_READY: 'DRAFT_NOT_READY',
  FULL_NAME_REQUIRED: 'FULL_NAME_REQUIRED',
  OTP_NOT_VERIFIED: 'OTP_NOT_VERIFIED',
  ROLE_REQUIRED: 'ROLE_REQUIRED',
  ROLE_CHOICE_NOT_ALLOWED: 'ROLE_CHOICE_NOT_ALLOWED',
  INN_NOT_ALLOWED: 'INN_NOT_ALLOWED',
  CONFIRM_FLOW_MISMATCH: 'CONFIRM_FLOW_MISMATCH',
  OWNER_ALREADY_EXISTS: 'OWNER_ALREADY_EXISTS',
} as const

export const SESSION_ERROR_CODES = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  REFRESH_TOKEN_REQUIRED: 'REFRESH_TOKEN_REQUIRED',
  REFRESH_TOKEN_INVALID: 'REFRESH_TOKEN_INVALID',
  REFRESH_TOKEN_EXPIRED: 'REFRESH_TOKEN_EXPIRED',
  REFRESH_TOKEN_REUSED: 'REFRESH_TOKEN_REUSED',
  LOGOUT_FAILED: 'LOGOUT_FAILED',
  AUTH_USER_NOT_FOUND: 'AUTH_USER_NOT_FOUND',
} as const

export const LOGIN_ERROR_CODES = {
  ...VALIDATION_ERROR_CODES,
  ...LOGIN_FLOW_ERROR_CODES,
  USER_BLOCKED: 'USER_BLOCKED',
} as const

export const REGISTRATION_ERROR_CODES = {
  ...VALIDATION_ERROR_CODES,
  ...REGISTRATION_FLOW_ERROR_CODES,
  ...DRAFT_ERROR_CODES,
  OTP_RESEND_COOLDOWN: 'OTP_RESEND_COOLDOWN',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_ATTEMPTS_EXCEEDED: 'OTP_ATTEMPTS_EXCEEDED',
  OTP_INVALID: 'OTP_INVALID',
} as const
type AuthFlowErrorMeta = {
  phone?: string
  otpExpiresAt?: string
  resendAvailableAt?: string
}

type SessionContext = {
  userAgent?: string
  ipAddress?: string
}

type RegistrationNextStep =
  | 'FULL_NAME_INPUT'
  | 'PHONE_INPUT'
  | 'OTP_INPUT'
  | 'ROLE_CHOICE'
  | 'INN_INPUT'
  | 'DATA_VERIFICATION'
  | 'SUPPLIER_CREATE_CONFIRM'
  | 'VENUE_CREATE_CONFIRM'
  | 'SUPPLIER_EXISTING_COMPANY_CONFIRM'
  | 'VENUE_EXISTING_OWNER_CONFIRM'
  | 'VENUE_EXISTING_NO_OWNER_CONFIRM'
  | 'STAFF_CONFIRM'
  | 'SUPPLIER_COMPANY_NOT_FOUND_CONFIRM'
  | 'VENUE_COMPANY_NOT_FOUND_CONFIRM'
  | 'COMPLETED'
  | 'BLOCKED'

type RegistrationDraftInput = {
  flowType: RegistrationFlowType
  fullName: string
}

type ResolveInviteTokenInput = {
  venueSlug: string
  inviteToken: string
}

type UpdateFullNameInput = {
  fullName: string
}

type UpdatePhoneInput = {
  phone: string
}

type VerifyOtpInput = {
  code: string
}

type UpdateRoleInput =
  | {
      selectedAccountType: 'SUPPLIER_STAFF'
    }
  | {
      selectedAccountType: 'VENUE_STAFF'
      venueRole: DisplayRole
    }

type LookupInnInput = {
  inn: string
}

type ManualCompanyInput = {
  companyName?: string
  companyAddress?: string
}

type ConfirmVenueExistingOwnerInput = {
  venueRole?: DisplayRole
}

type RegistrationDraftView = {
  id: string
  flowType: RegistrationFlowType
  status: RegistrationDraftStatus
  fullName: string | null
  phone: string | null
  phoneOtpVerified: boolean
  selectedAccountType: AccountType | null
  venueRole: DisplayRole | null
  supplierRole: string | null
  supplierAccessLevel: AccessLevel | null
  venueAccessLevel: AccessLevel | null
  inn: string | null
  companyExistsInBarello: boolean | null
  existingCompanyType: CompanyType | null
  existingCompanyId: string | null
  externalCompanyConfirmed: boolean | null
  externalCompanyData: Prisma.JsonValue | null
  manualCompanyName: string | null
  manualCompanyAddress: string | null
  inviteToken: string | null
  staffInvitationId: string | null
  venueId: string | null
  businessId: string | null
  invitedRole: DisplayRole | null
  invitedAccessLevel: AccessLevel | null
  expiresAt: string
  createdAt: string
  updatedAt: string
}

type RegistrationStepResponse = {
  draft: RegistrationDraftView
  nextStep: RegistrationNextStep
  redirectTo?: string
  otpExpiresAt?: string
  resendAvailableAt?: string
}

type RegistrationDraftStatusResponse = {
  exists: boolean
  isActive: boolean
  nextStep: RegistrationNextStep | 'BLOCKED'
  shouldResume: boolean
  shouldClear: boolean
}

type RegistrationConfirmResponse = {
  user: ReturnType<typeof sanitizeUserView>
  accessToken: string
  refreshToken: string
  nextStep: 'COMPLETED'
  redirectTo: 'HOME'
}

type LoginPhoneInput = {
  phone: string
}

type LoginPhoneStatusResponse = {
  phone: string
  exists: boolean
  canLogin: boolean
}

type LoginOtpInput = {
  phone: string
  code: string
}

type LoginStartResponse = {
  phone: string
  nextStep: 'OTP_INPUT'
  otpExpiresAt: string
  resendAvailableAt: string
}

type LoginVerifyResponse = {
  user: ReturnType<typeof sanitizeUserView>
  accessToken: string
  refreshToken: string
  redirectTo: 'HOME'
}

type RefreshSessionInput = {
  refreshToken: string
}

type RefreshSessionResponse = {
  accessToken: string
  refreshToken: string
}

class RegistrationError extends Error {
  code: string
  status: number
  nextStep: RegistrationNextStep
  redirectTo?: string
  phone?: string
  otpExpiresAt?: string
  resendAvailableAt?: string

  constructor(params: {
    code: string
    message: string
    status?: number
    nextStep?: RegistrationNextStep
    redirectTo?: string
  } & AuthFlowErrorMeta) {
    super(params.message)
    this.code = params.code
    this.status = params.status ?? 400
    this.nextStep = params.nextStep ?? 'BLOCKED'
    this.redirectTo = params.redirectTo
    this.phone = params.phone
    this.otpExpiresAt = params.otpExpiresAt
    this.resendAvailableAt = params.resendAvailableAt
  }
}

class LoginError extends Error {
  code: string
  status: number
  nextStep: 'PHONE_INPUT' | 'OTP_INPUT' | 'BLOCKED'
  phone?: string
  otpExpiresAt?: string
  resendAvailableAt?: string

  constructor(params: {
    code: string
    message: string
    status?: number
    nextStep?: 'PHONE_INPUT' | 'OTP_INPUT' | 'BLOCKED'
  } & AuthFlowErrorMeta) {
    super(params.message)
    this.code = params.code
    this.status = params.status ?? 400
    this.nextStep = params.nextStep ?? 'BLOCKED'
    this.phone = params.phone
    this.otpExpiresAt = params.otpExpiresAt
    this.resendAvailableAt = params.resendAvailableAt
  }
}

class AuthSessionError extends Error {
  code: string
  status: number

  constructor(params: { code: string; message: string; status?: number }) {
    super(params.message)
    this.code = params.code
    this.status = params.status ?? 401
  }
}

const externalCompaniesByInn: Record<
  string,
  {
    name: string
    address: string
    city?: string
    companyType?: CompanyType
  }
> = {
  '1234567890': {
    name: 'Тестовая компания по ИНН 1234567890',
    address: 'ул. Якиманка, д. 4',
    city: 'Москва',
  },
  '9876543210': {
    name: 'Тестовая компания по ИНН 9876543210',
    address: 'Третьяковский пр-д, д. 18',
    city: 'Москва',
  },
}

function sanitizeUserView(user: {
  id: string
  phone: string | null
  status: UserStatus
  accountType: AccountType
  profile?: {
    firstName: string
    lastName: string
    middleName: string | null
  } | null
}) {
  return {
    id: user.id,
    fullName: formatUserFullName(user.profile),
    phone: user.phone,
    status: user.status,
    accountType: user.accountType,
  }
}

function formatUserFullName(
  profile:
    | {
        firstName: string
        lastName: string
        middleName: string | null
      }
    | null
    | undefined
) {
  if (!profile) {
    return ''
  }

  return [profile.lastName, profile.firstName, profile.middleName]
    .filter(Boolean)
    .join(' ')
}

function splitFullName(fullName: string) {
  const normalized = fullName.trim().replace(/\s+/g, ' ')
  const parts = normalized.split(' ').filter(Boolean)

  return {
    lastName: parts[0] || '',
    firstName: parts[1] || '',
    middleName: parts.slice(2).join(' ') || undefined,
  }
}

function normalizeInn(inn: string) {
  return inn.replace(/\D/g, '')
}

function ensureDraftIsMutable(draft: {
  status: RegistrationDraftStatus
  expiresAt: Date
}) {
  if (draft.status === RegistrationDraftStatus.COMPLETED) {
    throw new RegistrationError({
      code: REGISTRATION_ERROR_CODES.DRAFT_ALREADY_COMPLETED,
      message: 'Регистрационная анкета уже завершена',
      status: 409,
    })
  }

  if (
    draft.status === RegistrationDraftStatus.CANCELLED ||
    draft.status === RegistrationDraftStatus.EXPIRED ||
    draft.expiresAt.getTime() <= Date.now()
  ) {
    throw new RegistrationError({
      code: REGISTRATION_ERROR_CODES.DRAFT_EXPIRED,
      message: 'Срок действия регистрационной анкеты истёк',
      status: 410,
    })
  }
}

function mapVenueRoleToAccessLevel(role: DisplayRole) {
  switch (role) {
    case DisplayRole.OWNER:
    case DisplayRole.ADMINISTRATOR:
    case DisplayRole.BAR_MANAGER:
      return AccessLevel.ADMIN
    case DisplayRole.SENIOR_BARTENDER:
    case DisplayRole.SOMMELIER:
      return AccessLevel.SENIOR_STAFF
    case DisplayRole.BARTENDER:
    case DisplayRole.WAITER:
      return AccessLevel.LINE_STAFF
    default:
      return AccessLevel.LINE_STAFF
  }
}

function getOtpExpiryDate() {
  return new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000)
}

function generateOtpCode() {
  return TEST_VERIFICATION_CODE
}

function isTestVerificationCode(code: string) {
  return code.trim() === TEST_VERIFICATION_CODE
}

function buildDraftView(
  draft: Prisma.RegistrationDraftGetPayload<Record<string, never>>
): RegistrationDraftView {
  return {
    id: draft.id,
    flowType: draft.flowType,
    status: draft.status,
    fullName: draft.fullName,
    phone: draft.phone,
    phoneOtpVerified: draft.phoneOtpVerified,
    selectedAccountType: draft.selectedAccountType,
    venueRole: draft.venueRole,
    supplierRole: draft.supplierRole,
    supplierAccessLevel: draft.supplierAccessLevel,
    venueAccessLevel: draft.venueAccessLevel,
    inn: draft.inn,
    companyExistsInBarello: draft.companyExistsInBarello,
    existingCompanyType: draft.existingCompanyType,
    existingCompanyId: draft.existingCompanyId,
    externalCompanyConfirmed: draft.externalCompanyConfirmed,
    externalCompanyData: draft.externalCompanyData,
    manualCompanyName: draft.manualCompanyName,
    manualCompanyAddress: draft.manualCompanyAddress,
    inviteToken: draft.inviteToken,
    staffInvitationId: draft.staffInvitationId,
    venueId: draft.venueId,
    businessId: draft.businessId,
    invitedRole: draft.invitedRole,
    invitedAccessLevel: draft.invitedAccessLevel,
    expiresAt: draft.expiresAt.toISOString(),
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  }
}

async function getDraftOrThrow(draftId: string) {
  const draft = await prisma.registrationDraft.findUnique({
    where: { id: draftId },
  })

  if (!draft) {
    throw new RegistrationError({
      code: REGISTRATION_ERROR_CODES.DRAFT_NOT_FOUND,
      message: 'Регистрационная анкета не найдена',
      status: 404,
    })
  }

  return draft
}

async function getDraftById(draftId: string) {
  return prisma.registrationDraft.findUnique({
    where: { id: draftId },
  })
}

async function ensurePhoneAvailable(phone: string) {
  const existingUser = await prisma.user.findUnique({
    where: { phone },
  })

  if (existingUser) {
    throw new RegistrationError({
      code: REGISTRATION_ERROR_CODES.PHONE_ALREADY_REGISTERED,
      message: 'Пользователь с этим номером уже зарегистрирован. Войдите в аккаунт.',
      status: 409,
      nextStep: 'PHONE_INPUT',
      redirectTo: '/login/phone',
      phone,
    })
  }
}

function getOtpErrorCodesForPurpose(purpose: OtpPurpose) {
  switch (purpose) {
    case OTP_PURPOSE.LOGIN:
      return {
        ...LOGIN_ERROR_CODES,
        OTP_ATTEMPTS_EXCEEDED: LOGIN_ERROR_CODES.OTP_INVALID,
      }
    case OTP_PURPOSE.REGISTRATION_PHONE:
      return REGISTRATION_ERROR_CODES
    default:
      return purpose satisfies never
  }
}
function getVerificationCodeTypeForPurpose(purpose: OtpPurpose) {
  switch (purpose) {
    case OTP_PURPOSE.LOGIN:
      return VerificationCodeType.LOGIN
    case OTP_PURPOSE.REGISTRATION_PHONE:
      return VerificationCodeType.REGISTER
    default:
      return purpose satisfies never
  }
}
async function getLatestOtpCode(target: string, type: VerificationCodeType) {
  return prisma.verificationCode.findFirst({
    where: {
      target,
      type,
      code: {
        not: {
          startsWith: OTP_ATTEMPT_PREFIX,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  })
}

async function countOtpAttemptsSince(
  target: string,
  type: VerificationCodeType,
  createdAt: Date
) {
  return prisma.verificationCode.count({
    where: {
      target,
      type,
      code: {
        startsWith: OTP_ATTEMPT_PREFIX,
      },
      createdAt: {
        gte: createdAt,
      },
    },
  })
}

async function getExistingCompanyState(
  draft: Prisma.RegistrationDraftGetPayload<Record<string, never>>
) {
  if (!draft.companyExistsInBarello || !draft.existingCompanyId) {
    return {
      venueHasOwner: false,
    }
  }

  if (draft.existingCompanyType === CompanyType.VENUE) {
    const venue = await prisma.venue.findUnique({
      where: { id: draft.existingCompanyId },
      include: {
        memberships: {
          where: {
            membershipStatus: MembershipStatus.ACTIVE,
            displayRole: DisplayRole.OWNER,
          },
        },
      },
    })

    return {
      venueHasOwner:
        venue?.ownerStatus === VenueOwnerStatus.OWNER_CONFIRMED ||
        Boolean(venue?.memberships.length),
    }
  }

  return {
    venueHasOwner: false,
  }
}

async function ensureDraftVenueExists(venueId: string) {
  const venue = await prisma.venue.findUnique({
    where: { id: venueId },
    select: { id: true },
  })

  if (!venue) {
    throw new RegistrationError({
      code: REGISTRATION_ERROR_CODES.VENUE_NOT_FOUND,
      message: 'Заведение не найдено',
      status: 404,
      nextStep: 'VENUE_COMPANY_NOT_FOUND_CONFIRM',
    })
  }
}
async function deriveVerificationNextStep(
  draft: Prisma.RegistrationDraftGetPayload<Record<string, never>>
): Promise<RegistrationNextStep> {
  if (draft.flowType === RegistrationFlowType.INVITE_TOKEN) {
    return 'STAFF_CONFIRM'
  }

  if (!draft.selectedAccountType) {
    return 'ROLE_CHOICE'
  }

  if (!draft.inn) {
    return 'INN_INPUT'
  }

  if (draft.selectedAccountType === AccountType.SUPPLIER_STAFF) {
    if (draft.companyExistsInBarello && draft.existingCompanyType === CompanyType.SUPPLIER) {
      return 'SUPPLIER_EXISTING_COMPANY_CONFIRM'
    }

    return draft.externalCompanyConfirmed
      ? 'SUPPLIER_CREATE_CONFIRM'
      : 'SUPPLIER_COMPANY_NOT_FOUND_CONFIRM'
  }

  if (draft.companyExistsInBarello && draft.existingCompanyType === CompanyType.VENUE) {
    const existingState = await getExistingCompanyState(draft)

    if (draft.venueRole === DisplayRole.OWNER) {
      return existingState.venueHasOwner
        ? 'VENUE_EXISTING_OWNER_CONFIRM'
        : 'VENUE_EXISTING_NO_OWNER_CONFIRM'
    }

    return existingState.venueHasOwner
      ? 'STAFF_CONFIRM'
      : 'VENUE_EXISTING_NO_OWNER_CONFIRM'
  }

  return draft.externalCompanyConfirmed
    ? 'VENUE_CREATE_CONFIRM'
    : 'VENUE_COMPANY_NOT_FOUND_CONFIRM'
}

async function deriveCurrentNextStep(
  draft: Prisma.RegistrationDraftGetPayload<Record<string, never>>
): Promise<RegistrationNextStep> {
  if (draft.status === RegistrationDraftStatus.COMPLETED) {
    return 'COMPLETED'
  }

  if (!draft.fullName) {
    return 'FULL_NAME_INPUT'
  }

  if (!draft.phone) {
    return 'PHONE_INPUT'
  }

  if (!draft.phoneOtpVerified) {
    return 'OTP_INPUT'
  }

  if (draft.flowType === RegistrationFlowType.DIRECT && !draft.selectedAccountType) {
    return 'ROLE_CHOICE'
  }

  if (draft.flowType === RegistrationFlowType.DIRECT && !draft.inn) {
    return 'INN_INPUT'
  }

  return deriveVerificationNextStep(draft)
}

async function buildStepResponse(
  draft: Prisma.RegistrationDraftGetPayload<Record<string, never>>
): Promise<RegistrationStepResponse> {
  const nextStep = await deriveCurrentNextStep(draft)

  return {
    draft: buildDraftView(draft),
    nextStep,
    redirectTo: nextStep === 'DATA_VERIFICATION' ? '/registration/data-verification' : undefined,
  }
}

function getRegistrationDraftActivityState(draft: {
  status: RegistrationDraftStatus
  expiresAt: Date
}):
  | {
      isActive: false
      nextStep: RegistrationNextStep | 'BLOCKED'
      shouldResume: false
      shouldClear: true
    }
  | {
      isActive: true
      shouldResume: true
      shouldClear: false
    } {
  if (draft.status === RegistrationDraftStatus.COMPLETED) {
    return {
      isActive: false,
      nextStep: 'COMPLETED' as const,
      shouldResume: false,
      shouldClear: true,
    }
  }

  if (
    draft.status === RegistrationDraftStatus.CANCELLED ||
    draft.status === RegistrationDraftStatus.EXPIRED ||
    draft.expiresAt.getTime() <= Date.now()
  ) {
    return {
      isActive: false,
      nextStep: 'BLOCKED' as const,
      shouldResume: false,
      shouldClear: true,
    }
  }

  return {
    isActive: true,
    shouldResume: true,
    shouldClear: false,
  }
}

function assertValidInn(inn: string) {
  if (!/^\d{10}(\d{2})?$/.test(inn)) {
    throw new RegistrationError({
      code: REGISTRATION_ERROR_CODES.INN_INVALID,
      message: 'Введите корректный ИНН',
      status: 400,
    })
  }
}

async function lookupInternalCompany(
  inn: string,
  selectedAccountType: AccountType
): Promise<{
  companyExistsInBarello: boolean
  existingCompanyType: CompanyType | null
  existingCompanyId: string | null
}> {
  const business = await prisma.business.findUnique({
    where: { taxNumber: inn },
    include: {
      venues: true,
      supplier: true,
    },
  })

  if (!business) {
    return {
      companyExistsInBarello: false,
      existingCompanyType: null,
      existingCompanyId: null,
    }
  }

  if (business.venues.length > 1) {
    throw new RegistrationError({
      code: REGISTRATION_ERROR_CODES.INN_CONFLICT,
      message: 'Для этого ИНН найдено несколько заведений',
      status: 409,
    })
  }

  if (business.venues.length && business.supplier) {
    throw new RegistrationError({
      code: REGISTRATION_ERROR_CODES.INN_CONFLICT,
      message: 'Компания уже связана и с заведением, и с поставщиком',
      status: 409,
    })
  }

  if (business.venues.length) {
    if (selectedAccountType !== AccountType.VENUE_STAFF) {
      throw new RegistrationError({
        code: REGISTRATION_ERROR_CODES.INN_CONFLICT,
        message: 'Этот ИНН относится к заведению',
        status: 409,
      })
    }

    return {
      companyExistsInBarello: true,
      existingCompanyType: CompanyType.VENUE,
      existingCompanyId: business.venues[0].id,
    }
  }

  if (business.supplier) {
    if (selectedAccountType !== AccountType.SUPPLIER_STAFF) {
      throw new RegistrationError({
        code: REGISTRATION_ERROR_CODES.INN_CONFLICT,
        message: 'Этот ИНН относится к поставщику',
        status: 409,
      })
    }

    return {
      companyExistsInBarello: true,
      existingCompanyType: CompanyType.SUPPLIER,
      existingCompanyId: business.supplier.id,
    }
  }

  return {
    companyExistsInBarello: false,
    existingCompanyType: null,
    existingCompanyId: null,
  }
}

async function lookupExternalCompany(inn: string) {
  const company = externalCompaniesByInn[inn]

  if (!company && env.registrationAssumeUnknownInnConfirmed) {
    return {
      confirmed: true,
      data: {
        inn,
        name: `Компания ${inn}`,
        address: null,
        city: null,
        companyType: null,
      },
    }
  }

  if (!company) {
    return {
      confirmed: false,
      data: null,
    }
  }

  return {
    confirmed: true,
    data: {
      inn,
      name: company.name,
      address: company.address,
      city: company.city ?? null,
      companyType: company.companyType ?? null,
    },
  }
}

async function findLoginUserByPhone(phone: string) {
  const user = await prisma.user.findUnique({
    where: { phone },
    include: {
      profile: true,
    },
  })

  if (!user) {
    throw new LoginError({
      code: LOGIN_ERROR_CODES.PHONE_NOT_REGISTERED,
      message: 'Пользователь с этим номером не найден',
      status: 404,
      nextStep: 'PHONE_INPUT',
    })
  }

  if (
    user.status === UserStatus.BLOCKED ||
    user.status === UserStatus.ARCHIVED
  ) {
    throw new LoginError({
      code: LOGIN_ERROR_CODES.USER_BLOCKED,
      message: 'Пользователь заблокирован',
      status: 403,
      nextStep: 'BLOCKED',
    })
  }

  return user
}

async function getLoginPhoneStatus(
  phone: string
): Promise<LoginPhoneStatusResponse> {
  const user = await prisma.user.findUnique({
    where: { phone },
    select: {
      status: true,
    },
  })

  return {
    phone,
    exists: Boolean(user),
    canLogin:
      Boolean(user) &&
      user?.status !== UserStatus.BLOCKED &&
      user?.status !== UserStatus.ARCHIVED,
  }
}

export async function createOtpCodeRecord(
  target: string,
  purpose: OtpPurpose,
  userId: string | undefined,
  errorFactory: (params: {
    code: string
    message: string
    status: number
  } & AuthFlowErrorMeta) => Error
) {
  const type = getVerificationCodeTypeForPurpose(purpose)
  const otpErrorCodes = getOtpErrorCodesForPurpose(purpose)
  const latestOtp = await getLatestOtpCode(target, type)
  if (
    latestOtp &&
    Date.now() - latestOtp.createdAt.getTime() <
      OTP_RESEND_COOLDOWN_SECONDS * 1000
  ) {
    throw errorFactory({
      code: otpErrorCodes.OTP_RESEND_COOLDOWN,
      message: 'Повторный запрос кода пока недоступен',
      status: 429,
      phone: target,
      otpExpiresAt: latestOtp.expiresAt.toISOString(),
      resendAvailableAt: new Date(
        latestOtp.createdAt.getTime() + OTP_RESEND_COOLDOWN_SECONDS * 1000
      ).toISOString(),
    })
  }

  const code = generateOtpCode()
  const expiresAt = getOtpExpiryDate()

  await prisma.verificationCode.create({
    data: {
      target,
      type,
      code,
      userId,
      expiresAt,
    },
  })

  return {
    expiresAt,
    resendAvailableAt: new Date(Date.now() + OTP_RESEND_COOLDOWN_SECONDS * 1000),
  }
}

export async function verifyOtpCodeOrThrow(
  target: string,
  purpose: OtpPurpose,
  code: string,
  errorFactory: (params: {
    code: string
    message: string
    status: number
  } & AuthFlowErrorMeta) => Error
) {
  const type = getVerificationCodeTypeForPurpose(purpose)
  const otpErrorCodes = getOtpErrorCodesForPurpose(purpose)
  const latestOtp = await getLatestOtpCode(target, type)
  if (!latestOtp) {
    throw errorFactory({
      code: otpErrorCodes.OTP_EXPIRED,
      message: 'Срок действия кода истёк',
      status: 410,
    })
  }

  const attempts = await countOtpAttemptsSince(target, type, latestOtp.createdAt)
  if (attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
    throw errorFactory({
      code: otpErrorCodes.OTP_ATTEMPTS_EXCEEDED,
      message: 'Превышено количество попыток ввода кода',
      status: 429,
    })
  }

  if (latestOtp.usedAt || latestOtp.expiresAt.getTime() <= Date.now()) {
    throw errorFactory({
      code: otpErrorCodes.OTP_EXPIRED,
      message: 'Срок действия кода истёк',
      status: 410,
    })
  }

  const normalizedCode = code.trim()
  const isValidCode =
    latestOtp.code === normalizedCode || isTestVerificationCode(normalizedCode)

  if (!isValidCode) {
    await prisma.verificationCode.create({
      data: {
        target,
        type,
        code: `${OTP_ATTEMPT_PREFIX}${normalizedCode}`,
        userId: latestOtp.userId ?? undefined,
        expiresAt: latestOtp.expiresAt,
      },
    })

    throw errorFactory({
      code: otpErrorCodes.OTP_INVALID,
      message: 'Неверный код подтверждения',
      status: 400,
    })
  }

  await prisma.verificationCode.update({
    where: { id: latestOtp.id },
    data: {
      usedAt: new Date(),
    },
  })

  return latestOtp
}

async function createAuthSession(
  userId: string,
  sessionContext?: SessionContext
): Promise<{
  session: AuthSession
  accessToken: string
  refreshToken: string
}> {
  const session = await prisma.authSession.create({
    data: {
      userId,
      refreshTokenHash: await hashPassword(randomUUID()),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      userAgent: sessionContext?.userAgent,
      ipAddress: sessionContext?.ipAddress,
    },
  })

  const accessToken = signAccessToken({
    userId,
    sessionId: session.id,
    type: 'user',
  })
  const refreshToken = signRefreshToken({
    userId,
    sessionId: session.id,
  })

  await prisma.authSession.update({
    where: { id: session.id },
    data: {
      refreshTokenHash: await hashPassword(refreshToken),
    },
  })

  return {
    session,
    accessToken,
    refreshToken,
  }
}

async function refreshAccessSession(
  session: Pick<AuthSession, 'id' | 'userId'>,
  refreshToken: string,
  sessionContext?: SessionContext
): Promise<RefreshSessionResponse> {
  const accessToken = signAccessToken({
    userId: session.userId,
    sessionId: session.id,
    type: 'user',
  })

  await prisma.authSession.update({
    where: { id: session.id },
    data: {
      ...(sessionContext?.userAgent ? { userAgent: sessionContext.userAgent } : {}),
      ...(sessionContext?.ipAddress ? { ipAddress: sessionContext.ipAddress } : {}),
    },
  })

  return {
    accessToken,
    refreshToken,
  }
}

async function createUserFromDraft(
  tx: Prisma.TransactionClient,
  draft: Prisma.RegistrationDraftGetPayload<Record<string, never>>,
  status: UserStatus,
  accountType: AccountType
) {
  if (!draft.phone || !draft.fullName || !draft.phoneOtpVerified) {
    throw new RegistrationError({
      code: REGISTRATION_ERROR_CODES.DRAFT_NOT_READY,
      message: 'Анкета ещё не готова к подтверждению',
      status: 409,
    })
  }

  const phone = normalizePhoneOrThrow(
    draft.phone,
    (params) =>
      new RegistrationError({
        ...params,
        nextStep: 'PHONE_INPUT',
      })
  )

  const existingUser = await tx.user.findUnique({
    where: { phone },
  })

  if (existingUser) {
    throw new RegistrationError({
      code: REGISTRATION_ERROR_CODES.PHONE_ALREADY_REGISTERED,
      message: 'Пользователь с этим номером уже зарегистрирован. Войдите в аккаунт.',
      status: 409,
      nextStep: 'PHONE_INPUT',
      redirectTo: '/login/phone',
      phone,
    })
  }

  const { firstName, lastName, middleName } = splitFullName(draft.fullName)

  return tx.user.create({
    data: {
      phone,
      status,
      accountType,
      profile: {
        create: {
          firstName,
          lastName,
          middleName,
        },
      },
    },
    include: {
      profile: true,
    },
  })
}

function getDraftCompanyName(
  draft: Prisma.RegistrationDraftGetPayload<Record<string, never>>,
  fallbackPrefix = 'Компания'
) {
  const externalData =
    draft.externalCompanyData && typeof draft.externalCompanyData === 'object'
      ? (draft.externalCompanyData as Record<string, unknown>)
      : null

  const generatedCompanyName = `Компания ${draft.inn ?? ''}`.trim()
  const fallbackName = `${fallbackPrefix} ${draft.inn ?? ''}`.trim()
  const manualCompanyName =
    draft.manualCompanyName && draft.manualCompanyName !== generatedCompanyName
      ? draft.manualCompanyName
      : null
  const externalCompanyName =
    typeof externalData?.name === 'string' &&
    externalData.name !== generatedCompanyName
      ? externalData.name
      : null

  return manualCompanyName || externalCompanyName || fallbackName
}

function getDraftCompanyAddress(
  draft: Prisma.RegistrationDraftGetPayload<Record<string, never>>
) {
  const externalData =
    draft.externalCompanyData && typeof draft.externalCompanyData === 'object'
      ? (draft.externalCompanyData as Record<string, unknown>)
      : null

  return (
    draft.manualCompanyAddress ||
    (typeof externalData?.address === 'string' ? externalData.address : null) ||
    undefined
  )
}

async function markDraftCompleted(
  tx: Prisma.TransactionClient,
  draftId: string
) {
  await tx.registrationDraft.update({
    where: { id: draftId },
    data: {
      status: RegistrationDraftStatus.COMPLETED,
      completedAt: new Date(),
    },
  })
}

async function makeConfirmResponse(
  user: {
    id: string
    phone: string | null
    status: UserStatus
    accountType: AccountType
    profile?: {
      firstName: string
      lastName: string
      middleName: string | null
    } | null
  },
  sessionContext?: SessionContext
): Promise<RegistrationConfirmResponse> {
  const tokens = await createAuthSession(user.id, sessionContext)

  return {
    user: sanitizeUserView(user),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    nextStep: 'COMPLETED',
    redirectTo: 'HOME',
  }
}

export async function createRegistrationDraft(
  input: RegistrationDraftInput
): Promise<RegistrationStepResponse> {
  if (!input.fullName.trim()) {
    throw new RegistrationError({
      code: REGISTRATION_ERROR_CODES.FULL_NAME_REQUIRED,
      message: 'Введите ФИО',
      status: 400,
      nextStep: 'FULL_NAME_INPUT',
    })
  }

  const draft = await prisma.registrationDraft.create({
    data: {
      flowType: input.flowType,
      status: RegistrationDraftStatus.IN_PROGRESS,
      fullName: input.fullName.trim(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  })

  return buildStepResponse(draft)
}

export async function resolveInviteToken(
  input: ResolveInviteTokenInput
): Promise<RegistrationStepResponse> {
  let invitation
  try {
    invitation = await resolveInvitationByToken(input.inviteToken)
  } catch (error) {
    if (error instanceof Error && 'code' in error && 'status' in error) {
      throw new RegistrationError({
        code: REGISTRATION_ERROR_CODES.INVITE_EXPIRED,
        message: error.message,
        status: Number((error as { status: unknown }).status) || 400,
      })
    }

    throw error
  }

  if (transliterateToSlug(invitation.venue.name) !== input.venueSlug) {
    throw new RegistrationError({
      code: REGISTRATION_ERROR_CODES.INVITE_EXPIRED,
      message: 'Приглашение недействительно',
      status: 404,
    })
  }

  const draft = await prisma.registrationDraft.create({
    data: {
      flowType: RegistrationFlowType.INVITE_TOKEN,
      status: RegistrationDraftStatus.IN_PROGRESS,
      staffInvitationId: invitation.id,
      inviteToken: input.inviteToken,
      venueId: invitation.venueId,
      invitedRole: invitation.invitedRole,
      invitedAccessLevel: invitation.invitedAccessLevel,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  })

  return buildStepResponse(draft)
}

export async function getRegistrationDraft(
  draftId: string
): Promise<RegistrationStepResponse> {
  const draft = await getDraftOrThrow(draftId)
  return buildStepResponse(draft)
}

export async function getRegistrationDraftStatus(
  draftId: string
): Promise<RegistrationDraftStatusResponse> {
  const draft = await getDraftById(draftId)

  if (!draft) {
    return {
      exists: false,
      isActive: false,
      nextStep: 'BLOCKED',
      shouldResume: false,
      shouldClear: true,
    }
  }

  const activity = getRegistrationDraftActivityState(draft)

  if (!activity.isActive) {
    return {
      exists: true,
      isActive: activity.isActive,
      nextStep: activity.nextStep,
      shouldResume: activity.shouldResume,
      shouldClear: activity.shouldClear,
    }
  }

  return {
    exists: true,
    isActive: true,
    nextStep: await deriveCurrentNextStep(draft),
    shouldResume: true,
    shouldClear: false,
  }
}

export async function updateDraftFullName(
  draftId: string,
  input: UpdateFullNameInput
): Promise<RegistrationStepResponse> {
  const draft = await getDraftOrThrow(draftId)
  ensureDraftIsMutable(draft)

  const updated = await prisma.registrationDraft.update({
    where: { id: draftId },
    data: {
      fullName: input.fullName.trim(),
    },
  })

  return buildStepResponse(updated)
}

export async function updateDraftPhone(
  draftId: string,
  input: UpdatePhoneInput
): Promise<RegistrationStepResponse> {
  const draft = await getDraftOrThrow(draftId)
  ensureDraftIsMutable(draft)

  const phone = normalizePhoneOrThrow(
    input.phone,
    (params) =>
      new RegistrationError({
        ...params,
        nextStep: 'PHONE_INPUT',
      })
  )

  await ensurePhoneAvailable(phone)

  const updated = await prisma.registrationDraft.update({
    where: { id: draftId },
    data: {
      phone,
      phoneOtpVerified: false,
    },
  })

  return buildStepResponse(updated)
}

export async function sendDraftOtp(
  draftId: string
): Promise<RegistrationStepResponse> {
  const draft = await getDraftOrThrow(draftId)
  ensureDraftIsMutable(draft)

  const phone = normalizePhoneOrThrow(
    draft.phone ?? '',
    (params) =>
      new RegistrationError({
        ...params,
        nextStep: 'PHONE_INPUT',
      })
  )

  await ensurePhoneAvailable(phone)

  const otp = await createOtpCodeRecord(
    phone,
    OTP_PURPOSE.REGISTRATION_PHONE,
    undefined,
    (params) =>
      new RegistrationError({
        ...params,
        nextStep: 'OTP_INPUT',
      })
  )

  return {
    ...(await buildStepResponse(draft)),
    otpExpiresAt: otp.expiresAt.toISOString(),
    resendAvailableAt: otp.resendAvailableAt.toISOString(),
  }
}

export async function verifyDraftOtp(
  draftId: string,
  input: VerifyOtpInput
): Promise<RegistrationStepResponse> {
  const draft = await getDraftOrThrow(draftId)
  ensureDraftIsMutable(draft)

  const phone = normalizePhoneOrThrow(
    draft.phone ?? '',
    (params) =>
      new RegistrationError({
        ...params,
        nextStep: 'PHONE_INPUT',
      })
  )

  await prisma.$transaction(async (tx) => {
    await verifyOtpCodeOrThrow(
      phone,
      OTP_PURPOSE.REGISTRATION_PHONE,
      input.code,
      (params) =>
        new RegistrationError({
          ...params,
          nextStep: 'OTP_INPUT',
        })
    )

    await tx.registrationDraft.update({
      where: { id: draftId },
      data: {
        phone,
        phoneOtpVerified: true,
      },
    })
  })

  const updated = await getDraftOrThrow(draftId)
  return buildStepResponse(updated)
}

export async function updateDraftRole(
  draftId: string,
  input: UpdateRoleInput
): Promise<RegistrationStepResponse> {
  const draft = await getDraftOrThrow(draftId)
  ensureDraftIsMutable(draft)

  if (!draft.phoneOtpVerified) {
    throw new RegistrationError({
      code: REGISTRATION_ERROR_CODES.OTP_NOT_VERIFIED,
      message: 'Сначала подтвердите номер телефона',
      status: 409,
      nextStep: 'OTP_INPUT',
    })
  }

  if (draft.flowType !== RegistrationFlowType.DIRECT) {
    throw new RegistrationError({
      code: REGISTRATION_ERROR_CODES.ROLE_CHOICE_NOT_ALLOWED,
      message: 'В этом сценарии нельзя выбирать роль вручную',
      status: 409,
    })
  }

  const data: Prisma.RegistrationDraftUpdateInput =
    input.selectedAccountType === AccountType.SUPPLIER_STAFF
      ? {
          selectedAccountType: AccountType.SUPPLIER_STAFF,
          supplierRole: DEFAULT_SUPPLIER_ROLE,
          supplierAccessLevel: AccessLevel.ADMIN,
          venueRole: null,
          venueAccessLevel: null,
        }
      : {
          selectedAccountType: AccountType.VENUE_STAFF,
          venueRole: 'venueRole' in input ? input.venueRole : null,
          venueAccessLevel:
            'venueRole' in input ? mapVenueRoleToAccessLevel(input.venueRole) : null,
          supplierRole: null,
          supplierAccessLevel: null,
        }

  const updated = await prisma.registrationDraft.update({
    where: { id: draftId },
    data,
  })

  return buildStepResponse(updated)
}

export async function lookupDraftInn(
  draftId: string,
  input: LookupInnInput
): Promise<RegistrationStepResponse> {
  const draft = await getDraftOrThrow(draftId)
  ensureDraftIsMutable(draft)

  if (!draft.phoneOtpVerified) {
    throw new RegistrationError({
      code: REGISTRATION_ERROR_CODES.OTP_NOT_VERIFIED,
      message: 'Сначала подтвердите номер телефона',
      status: 409,
      nextStep: 'OTP_INPUT',
    })
  }

  if (draft.flowType !== RegistrationFlowType.DIRECT) {
    throw new RegistrationError({
      code: REGISTRATION_ERROR_CODES.INN_NOT_ALLOWED,
      message: 'В этом сценарии нельзя искать компанию по ИНН',
      status: 409,
    })
  }

  if (!draft.selectedAccountType) {
    throw new RegistrationError({
      code: REGISTRATION_ERROR_CODES.ROLE_REQUIRED,
      message: 'Перед поиском по ИНН выберите роль',
      status: 409,
      nextStep: 'ROLE_CHOICE',
    })
  }

  const inn = normalizeInn(input.inn)
  assertValidInn(inn)

  const internal = await lookupInternalCompany(inn, draft.selectedAccountType)

  let externalCompanyConfirmed: boolean | null = null
  let externalCompanyData: Prisma.JsonValue | null = null

  if (!internal.companyExistsInBarello) {
    const external = await lookupExternalCompany(inn)
    externalCompanyConfirmed = external.confirmed
    externalCompanyData = external.data
  }

  const updated = await prisma.registrationDraft.update({
    where: { id: draftId },
    data: {
      inn,
      companyExistsInBarello: internal.companyExistsInBarello,
      existingCompanyType: internal.existingCompanyType,
      existingCompanyId: internal.existingCompanyId,
      externalCompanyConfirmed,
      externalCompanyData: externalCompanyData ?? undefined,
      status: RegistrationDraftStatus.READY_TO_CONFIRM,
    },
  })

  return {
    draft: buildDraftView(updated),
    nextStep: 'DATA_VERIFICATION',
    redirectTo: '/registration/data-verification',
  }
}

export async function getDraftVerification(
  draftId: string
): Promise<RegistrationStepResponse> {
  const draft = await getDraftOrThrow(draftId)
  ensureDraftIsMutable(draft)

  if (!draft.phoneOtpVerified) {
    throw new RegistrationError({
      code: REGISTRATION_ERROR_CODES.OTP_NOT_VERIFIED,
      message: 'Сначала подтвердите номер телефона',
      status: 409,
      nextStep: 'OTP_INPUT',
    })
  }

  return {
    draft: buildDraftView(draft),
    nextStep: await deriveVerificationNextStep(draft),
    redirectTo: '/registration/data-verification',
  }
}

export async function confirmSupplierCreate(
  draftId: string,
  input?: ManualCompanyInput,
  sessionContext?: SessionContext
): Promise<RegistrationConfirmResponse> {
  const draft = await getDraftOrThrow(draftId)
  ensureDraftIsMutable(draft)

  if (input?.companyName || input?.companyAddress) {
    await prisma.registrationDraft.update({
      where: { id: draftId },
      data: {
        manualCompanyName: input.companyName,
        manualCompanyAddress: input.companyAddress,
      },
    })
  }

  const refreshed = await getDraftOrThrow(draftId)

  if (
    refreshed.selectedAccountType !== AccountType.SUPPLIER_STAFF ||
    refreshed.companyExistsInBarello
  ) {
    throw new RegistrationError({
      code: REGISTRATION_ERROR_CODES.CONFIRM_FLOW_MISMATCH,
      message: 'Анкета не соответствует сценарию создания поставщика',
      status: 409,
    })
  }

  const user = await prisma.$transaction(async (tx) => {
    const user = await createUserFromDraft(
      tx,
      refreshed,
      UserStatus.ACTIVE,
      AccountType.SUPPLIER_STAFF
    )

    const business = await tx.business.create({
      data: {
        name: getDraftCompanyName(refreshed, 'Поставщик'),
        taxNumber: refreshed.inn!,
        legalAddress: getDraftCompanyAddress(refreshed),
      },
    })

    const supplier = await tx.supplier.create({
      data: {
        businessId: business.id,
        name: business.name,
        city:
          typeof (refreshed.externalCompanyData as Record<string, unknown> | null)?.city ===
          'string'
            ? ((refreshed.externalCompanyData as Record<string, unknown>).city as string)
            : undefined,
        address: business.legalAddress,
        contactName: refreshed.fullName ?? undefined,
        phone: refreshed.phone ?? undefined,
        isActive: true,
      },
    })

    await tx.supplierMembership.create({
      data: {
        userId: user.id,
        supplierId: supplier.id,
        displayRole: DEFAULT_SUPPLIER_ROLE,
        accessLevel: AccessLevel.ADMIN,
        status: MembershipStatus.ACTIVE,
        joinedAt: new Date(),
      },
    })

    await markDraftCompleted(tx, refreshed.id)

    return user
  })

  return makeConfirmResponse(user, sessionContext)
}

export async function confirmSupplierExistingCompany(
  draftId: string,
  sessionContext?: SessionContext
): Promise<RegistrationConfirmResponse> {
  const draft = await getDraftOrThrow(draftId)
  ensureDraftIsMutable(draft)

  if (
    draft.selectedAccountType !== AccountType.SUPPLIER_STAFF ||
    !draft.companyExistsInBarello ||
    draft.existingCompanyType !== CompanyType.SUPPLIER ||
    !draft.existingCompanyId
  ) {
    throw new RegistrationError({
      code: REGISTRATION_ERROR_CODES.CONFIRM_FLOW_MISMATCH,
      message: 'Анкета не соответствует сценарию присоединения к существующему поставщику',
      status: 409,
    })
  }

  const user = await prisma.$transaction(async (tx) => {
    const user = await createUserFromDraft(
      tx,
      draft,
      UserStatus.UNIDENTIFIED,
      AccountType.UNIDENTIFIED
    )

    await tx.supplierMembership.create({
      data: {
        userId: user.id,
        supplierId: draft.existingCompanyId!,
        displayRole: DEFAULT_SUPPLIER_ROLE,
        accessLevel: AccessLevel.ADMIN,
        status: MembershipStatus.PENDING,
      },
    })

    await markDraftCompleted(tx, draft.id)

    return user
  })

  return makeConfirmResponse(user, sessionContext)
}

export async function confirmSupplierNotFound(
  draftId: string,
  input?: ManualCompanyInput,
  sessionContext?: SessionContext
): Promise<RegistrationConfirmResponse> {
  const draft = await getDraftOrThrow(draftId)
  ensureDraftIsMutable(draft)

  const user = await prisma.$transaction(async (tx) => {
    const updatedDraft =
      input?.companyName || input?.companyAddress
        ? await tx.registrationDraft.update({
            where: { id: draftId },
            data: {
              manualCompanyName: input.companyName,
              manualCompanyAddress: input.companyAddress,
            },
          })
        : draft

    const user = await createUserFromDraft(
      tx,
      updatedDraft,
      UserStatus.UNIDENTIFIED,
      AccountType.UNIDENTIFIED
    )

    await tx.companyModerationRequest.create({
      data: {
        userId: user.id,
        draftId: updatedDraft.id,
        requestedCompanyType: CompanyType.SUPPLIER,
        inn: updatedDraft.inn!,
        companyName: getDraftCompanyName(updatedDraft, 'Поставщик'),
        companyAddress: getDraftCompanyAddress(updatedDraft),
        source: CompanyModerationRequestSource.REGISTRATION_NOT_FOUND,
      },
    })

    await markDraftCompleted(tx, updatedDraft.id)

    return user
  })

  return makeConfirmResponse(user, sessionContext)
}

export async function confirmVenueCreate(
  draftId: string,
  input?: ManualCompanyInput,
  sessionContext?: SessionContext
): Promise<RegistrationConfirmResponse> {
  const draft = await getDraftOrThrow(draftId)
  ensureDraftIsMutable(draft)

  const user = await prisma.$transaction(async (tx) => {
    const updatedDraft =
      input?.companyName || input?.companyAddress
        ? await tx.registrationDraft.update({
            where: { id: draftId },
            data: {
              manualCompanyName: input.companyName,
              manualCompanyAddress: input.companyAddress,
            },
          })
        : draft

    if (
      updatedDraft.selectedAccountType !== AccountType.VENUE_STAFF ||
      !updatedDraft.venueRole ||
      !updatedDraft.venueAccessLevel ||
      updatedDraft.companyExistsInBarello
    ) {
      throw new RegistrationError({
        code: REGISTRATION_ERROR_CODES.CONFIRM_FLOW_MISMATCH,
        message: 'Анкета не соответствует сценарию создания заведения',
        status: 409,
      })
    }

    const user = await createUserFromDraft(
      tx,
      updatedDraft,
      UserStatus.ACTIVE,
      AccountType.VENUE_STAFF
    )

    const business = await tx.business.create({
      data: {
        name: getDraftCompanyName(updatedDraft, 'Тестовое заведение'),
        taxNumber: updatedDraft.inn!,
        legalAddress: getDraftCompanyAddress(updatedDraft),
      },
    })

    const venue = await tx.venue.create({
      data: {
        businessId: business.id,
        name: business.name,
        city:
          typeof (updatedDraft.externalCompanyData as Record<string, unknown> | null)?.city ===
          'string'
            ? ((updatedDraft.externalCompanyData as Record<string, unknown>).city as string)
            : '',
        address: business.legalAddress,
        ownerStatus:
          updatedDraft.venueRole === DisplayRole.OWNER
            ? VenueOwnerStatus.OWNER_CONFIRMED
            : VenueOwnerStatus.OWNER_MISSING,
        venueStatus: VenueStatus.ACTIVE,
        isActive: true,
      },
    })

    const membership = await tx.userVenueMembership.create({
      data: {
        userId: user.id,
        venueId: venue.id,
        displayRole: updatedDraft.venueRole,
        accessLevel: updatedDraft.venueAccessLevel,
        membershipStatus: MembershipStatus.ACTIVE,
        joinedAt: new Date(),
        confirmedByUserId: user.id,
      },
    })

    await setInitialUserVenueContext(tx, user.id, membership.venueId)
    await markDraftCompleted(tx, updatedDraft.id)

    return user
  })

  return makeConfirmResponse(user, sessionContext)
}

export async function confirmVenueExistingOwner(
  draftId: string,
  input?: ConfirmVenueExistingOwnerInput
): Promise<RegistrationStepResponse> {
  const draft = await getDraftOrThrow(draftId)
  ensureDraftIsMutable(draft)

  if (!input?.venueRole || input.venueRole === DisplayRole.OWNER) {
    throw new RegistrationError({
      code: REGISTRATION_ERROR_CODES.OWNER_ALREADY_EXISTS,
      message: 'У этого заведения уже есть владелец. Выберите другую роль.',
      status: 409,
      nextStep: 'VENUE_EXISTING_OWNER_CONFIRM',
    })
  }

  const updated = await prisma.registrationDraft.update({
    where: { id: draftId },
    data: {
      venueRole: input.venueRole,
      venueAccessLevel: mapVenueRoleToAccessLevel(input.venueRole),
    },
  })

  return {
    draft: buildDraftView(updated),
    nextStep: await deriveVerificationNextStep(updated),
    redirectTo: '/registration/data-verification',
  }
}

export async function confirmVenueExistingNoOwner(
  draftId: string,
  sessionContext?: SessionContext
): Promise<RegistrationConfirmResponse> {
  const draft = await getDraftOrThrow(draftId)
  ensureDraftIsMutable(draft)

  if (
    draft.selectedAccountType !== AccountType.VENUE_STAFF ||
    !draft.venueRole ||
    !draft.venueAccessLevel ||
    !draft.companyExistsInBarello ||
    draft.existingCompanyType !== CompanyType.VENUE ||
    !draft.existingCompanyId
  ) {
    throw new RegistrationError({
      code: REGISTRATION_ERROR_CODES.CONFIRM_FLOW_MISMATCH,
      message: 'Анкета не соответствует сценарию заведения без владельца',
      status: 409,
    })
  }

  await ensureDraftVenueExists(draft.existingCompanyId!)

  const user = await prisma.$transaction(async (tx) => {
    const user = await createUserFromDraft(
      tx,
      draft,
      UserStatus.ACTIVE,
      AccountType.VENUE_STAFF
    )

    if (draft.venueRole === DisplayRole.OWNER) {
      await ensureSingleVenueOwner(draft.existingCompanyId!, user.id)
    }

    await tx.venue.update({
      where: { id: draft.existingCompanyId! },
      data: {
        ownerStatus:
          draft.venueRole === DisplayRole.OWNER
            ? VenueOwnerStatus.OWNER_CONFIRMED
            : VenueOwnerStatus.OWNER_MISSING,
      },
    })

    const membership = await tx.userVenueMembership.create({
      data: {
        userId: user.id,
        venueId: draft.existingCompanyId!,
        displayRole: draft.venueRole!,
        accessLevel: draft.venueAccessLevel!,
        membershipStatus: MembershipStatus.ACTIVE,
        joinedAt: new Date(),
        confirmedByUserId: user.id,
      },
    })

    await setInitialUserVenueContext(tx, user.id, membership.venueId)
    await markDraftCompleted(tx, draft.id)

    return user
  })

  return makeConfirmResponse(user, sessionContext)
}

export async function confirmVenueExistingJoin(
  draftId: string,
  sessionContext?: SessionContext
): Promise<RegistrationConfirmResponse> {
  const draft = await getDraftOrThrow(draftId)
  ensureDraftIsMutable(draft)

  if (
    draft.selectedAccountType !== AccountType.VENUE_STAFF ||
    !draft.venueRole ||
    !draft.venueAccessLevel ||
    !draft.companyExistsInBarello ||
    draft.existingCompanyType !== CompanyType.VENUE ||
    !draft.existingCompanyId
  ) {
    throw new RegistrationError({
      code: REGISTRATION_ERROR_CODES.CONFIRM_FLOW_MISMATCH,
      message: 'Анкета не соответствует сценарию присоединения к заведению',
      status: 409,
    })
  }

  await ensureDraftVenueExists(draft.existingCompanyId!)

  const user = await prisma.$transaction(async (tx) => {
    const user = await createUserFromDraft(
      tx,
      draft,
      UserStatus.UNIDENTIFIED,
      AccountType.UNIDENTIFIED
    )

    await tx.userVenueMembership.create({
      data: {
        userId: user.id,
        venueId: draft.existingCompanyId!,
        displayRole: draft.venueRole!,
        accessLevel: draft.venueAccessLevel!,
        membershipStatus: MembershipStatus.PENDING,
      },
    })

    await markDraftCompleted(tx, draft.id)

    return user
  })

  return makeConfirmResponse(user, sessionContext)
}

export async function confirmVenueNotFound(
  draftId: string,
  input?: ManualCompanyInput,
  sessionContext?: SessionContext
): Promise<RegistrationConfirmResponse> {
  const draft = await getDraftOrThrow(draftId)
  ensureDraftIsMutable(draft)

  const user = await prisma.$transaction(async (tx) => {
    const updatedDraft =
      input?.companyName || input?.companyAddress
        ? await tx.registrationDraft.update({
            where: { id: draftId },
            data: {
              manualCompanyName: input.companyName,
              manualCompanyAddress: input.companyAddress,
            },
          })
        : draft

    if (!updatedDraft.venueRole || !updatedDraft.venueAccessLevel) {
      throw new RegistrationError({
        code: REGISTRATION_ERROR_CODES.CONFIRM_FLOW_MISMATCH,
        message: 'Анкета не соответствует сценарию компании, не найденной в системе',
        status: 409,
      })
    }

    const user = await createUserFromDraft(
      tx,
      updatedDraft,
      UserStatus.UNIDENTIFIED,
      AccountType.UNIDENTIFIED
    )

    await tx.companyModerationRequest.create({
      data: {
        userId: user.id,
        draftId: updatedDraft.id,
        requestedCompanyType: CompanyType.VENUE,
        requestedVenueRole: updatedDraft.venueRole,
        requestedAccessLevel: updatedDraft.venueAccessLevel,
        inn: updatedDraft.inn!,
        companyName: getDraftCompanyName(updatedDraft, 'Заведение'),
        companyAddress: getDraftCompanyAddress(updatedDraft),
        source: CompanyModerationRequestSource.REGISTRATION_NOT_FOUND,
      },
    })

    await markDraftCompleted(tx, updatedDraft.id)

    return user
  })

  return makeConfirmResponse(user, sessionContext)
}

export async function confirmInviteStaff(
  draftId: string,
  sessionContext?: SessionContext
): Promise<RegistrationConfirmResponse> {
  const draft = await getDraftOrThrow(draftId)
  ensureDraftIsMutable(draft)

  if (
    draft.flowType !== RegistrationFlowType.INVITE_TOKEN ||
    !draft.staffInvitationId ||
    !draft.venueId ||
    !draft.invitedRole ||
    !draft.invitedAccessLevel
  ) {
    throw new RegistrationError({
      code: REGISTRATION_ERROR_CODES.CONFIRM_FLOW_MISMATCH,
      message: 'Анкета не соответствует сценарию приглашения сотрудника',
      status: 409,
    })
  }

  const user = await prisma.$transaction(async (tx) => {
    const invitation = await tx.staffInvitation.findUnique({
      where: { id: draft.staffInvitationId! },
    })

    if (!invitation) {
      throw new RegistrationError({
        code: REGISTRATION_ERROR_CODES.INVITE_EXPIRED,
        message: 'Приглашение недействительно',
        status: 404,
      })
    }

    if (invitation.status === StaffInvitationStatus.ACCEPTED) {
      throw new RegistrationError({
        code: REGISTRATION_ERROR_CODES.INVITE_EXPIRED,
        message: 'Приглашение уже использовано',
        status: 409,
      })
    }

    const user = await createUserFromDraft(
      tx,
      draft,
      UserStatus.ACTIVE,
      AccountType.VENUE_STAFF
    )

    const membership = await tx.userVenueMembership.create({
      data: {
        userId: user.id,
        venueId: draft.venueId!,
        displayRole: draft.invitedRole!,
        accessLevel: draft.invitedAccessLevel!,
        membershipStatus: MembershipStatus.ACTIVE,
        joinedAt: new Date(),
        confirmedByUserId: user.id,
      },
    })

    await setInitialUserVenueContext(tx, user.id, membership.venueId)
    await tx.staffInvitation.update({
      where: { id: invitation.id },
      data: {
        status: StaffInvitationStatus.ACCEPTED,
        acceptedByUserId: user.id,
        acceptedAt: new Date(),
      },
    })

    await markDraftCompleted(tx, draft.id)

    return user
  })

  return makeConfirmResponse(user, sessionContext)
}

export async function startLogin(
  input: LoginPhoneInput
): Promise<LoginStartResponse> {
  const phone = normalizePhoneOrThrow(
    input.phone,
    (params) =>
      new LoginError({
        ...params,
        nextStep: 'PHONE_INPUT',
      })
  )

  const user = await findLoginUserByPhone(phone)

  const otp = await createOtpCodeRecord(
    phone,
    OTP_PURPOSE.LOGIN,
    user.id,
    (params) =>
      new LoginError({
        ...params,
        nextStep: 'OTP_INPUT',
      })
  )

  return {
    phone,
    nextStep: 'OTP_INPUT',
    otpExpiresAt: otp.expiresAt.toISOString(),
    resendAvailableAt: otp.resendAvailableAt.toISOString(),
  }
}

export async function checkLoginPhone(
  input: LoginPhoneInput
): Promise<LoginPhoneStatusResponse> {
  const phone = normalizePhoneOrThrow(
    input.phone,
    (params) =>
      new LoginError({
        ...params,
        nextStep: 'PHONE_INPUT',
      })
  )

  return getLoginPhoneStatus(phone)
}

export async function verifyLoginOtp(
  input: LoginOtpInput,
  sessionContext?: SessionContext
): Promise<LoginVerifyResponse> {
  const phone = normalizePhoneOrThrow(
    input.phone,
    (params) =>
      new LoginError({
        ...params,
        nextStep: 'PHONE_INPUT',
      })
  )

  const user = await findLoginUserByPhone(phone)

  await verifyOtpCodeOrThrow(
    phone,
    OTP_PURPOSE.LOGIN,
    input.code,
    (params) =>
      new LoginError({
        ...params,
        nextStep: 'OTP_INPUT',
      })
  )

  await resetActiveVenueToDefault(user.id)

  await prisma.user.update({
    where: { id: user.id },
    data: {
      lastLoginAt: new Date(),
    },
  })

  const tokens = await createAuthSession(user.id, sessionContext)

  return {
    user: sanitizeUserView(user),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    redirectTo: 'HOME',
  }
}

export async function refreshAuthSession(
  input: RefreshSessionInput,
  sessionContext?: SessionContext
): Promise<RefreshSessionResponse> {
  const refreshToken = input.refreshToken?.trim()

  if (!refreshToken) {
    throw new AuthSessionError({
      code: SESSION_ERROR_CODES.REFRESH_TOKEN_REQUIRED,
      message: 'Refresh token is required',
      status: 400,
    })
  }

  let payload: Awaited<ReturnType<typeof verifyRefreshToken>>

  try {
    payload = verifyRefreshToken(refreshToken)
  } catch {
    throw new AuthSessionError({
      code: SESSION_ERROR_CODES.REFRESH_TOKEN_INVALID,
      message: 'Refresh token is invalid',
      status: 401,
    })
  }

  if (payload.type !== 'refresh') {
    throw new AuthSessionError({
      code: SESSION_ERROR_CODES.REFRESH_TOKEN_INVALID,
      message: 'Refresh token is invalid',
      status: 401,
    })
  }

  const session = await prisma.authSession.findUnique({
    where: { id: payload.sessionId },
    select: {
      id: true,
      userId: true,
      refreshTokenHash: true,
      expiresAt: true,
    },
  })

  if (!session || session.userId !== payload.userId) {
    throw new AuthSessionError({
      code: SESSION_ERROR_CODES.REFRESH_TOKEN_INVALID,
      message: 'Refresh token is invalid',
      status: 401,
    })
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.authSession.deleteMany({
      where: {
        id: session.id,
      },
    })

    throw new AuthSessionError({
      code: SESSION_ERROR_CODES.REFRESH_TOKEN_EXPIRED,
      message: 'Refresh token has expired',
      status: 401,
    })
  }

  const isValidToken = await comparePassword(refreshToken, session.refreshTokenHash)

  if (!isValidToken) {
    throw new AuthSessionError({
      code: SESSION_ERROR_CODES.REFRESH_TOKEN_REUSED,
      message: 'Refresh token has already been rotated',
      status: 401,
    })
  }

  return refreshAccessSession(session, refreshToken, sessionContext)
}

export async function logout(auth: AuthPayload): Promise<void> {
  await prisma.authSession.deleteMany({
    where: {
      id: auth.sessionId,
      userId: auth.userId,
    },
  })
}

export async function getMe(auth: AuthPayload) {
  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: {
      id: true,
      phone: true,
      status: true,
      accountType: true,
      profile: {
        select: {
          firstName: true,
          lastName: true,
          middleName: true,
        },
      },
      memberships: {
        select: {
          id: true,
        },
      },
      supplierMemberships: {
        select: {
          id: true,
        },
      },
    },
  })

  if (!user) {
    console.error('[Auth] getMe: user not found for authenticated payload', {
      authUserId: auth.userId,
      sessionId: auth.sessionId,
      authType: auth.type,
    })
    throw new Error('User not found')
  }

  console.info('[Auth] getMe: loaded user', {
    authUserId: auth.userId,
    sessionId: auth.sessionId,
    responseUserId: user.id,
    accountType: user.accountType,
    userStatus: user.status,
    venueMembershipsCount: user.memberships.length,
    supplierMembershipsCount: user.supplierMemberships.length,
    hasProfile: Boolean(user.profile),
  })

  return {
    type: 'user' as const,
    user: sanitizeUserView(user),
    venueMemberships: user.memberships,
    supplierMemberships: user.supplierMemberships,
  }
}

export function isRegistrationError(error: unknown): error is RegistrationError {
  return error instanceof RegistrationError
}

export function isLoginError(error: unknown): error is LoginError {
  return error instanceof LoginError
}

export function isAuthSessionError(error: unknown): error is AuthSessionError {
  return error instanceof AuthSessionError
}


