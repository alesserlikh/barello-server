import { apiError } from '../../lib/api-error'
import { AccountType, AccessLevel } from '../../generated/prisma'
import type { AuthPayload } from '../../middleware/auth'
import { getHomeContext } from '../auth/home-context.service'

type HomeContextView = Awaited<ReturnType<typeof getHomeContext>>

export type ProfileSectionPermissions = {
  profile: boolean
  myData: boolean
  settings: boolean
  business: boolean
  downloads: boolean
  tasks: boolean
  notes: boolean
  notifications: boolean
  employeeInvite: boolean
  supplierPrices: boolean
  promoBalance: boolean
}

export type ProfileActionPermissions = {
  canEditProfile: boolean
  canUploadAvatar: boolean
  canInviteEmployees: boolean
  canAddVenue: boolean
  canEditVenue: boolean
  canUploadVenuePhotos: boolean
  canCreateTask: boolean
  canAssignTask: boolean
  canCreateSharedTask: boolean
  canCreateNote: boolean
  canCreateSharedNote: boolean
  canUploadDownloads: boolean
  canUploadPrice: boolean
  canViewPromoBalance: boolean
  canEditSupplierProfile: boolean
  canManageManagers: boolean
  canManageExperts: boolean
}

export type ProfilePermissions = {
  profileSections: ProfileSectionPermissions
  actions: ProfileActionPermissions
}

export type ProfileActionKey = keyof ProfileActionPermissions

export class ProfilePermissionError extends Error {
  code: string
  status: number

  constructor(params: { code: string; message: string; status?: number }) {
    super(params.message)
    this.name = 'ProfilePermissionError'
    this.code = params.code
    this.status = params.status ?? 403
  }
}

function readContext(homeContext: HomeContextView) {
  return 'context' in homeContext ? homeContext.context : undefined
}

export function getProfileAccessLevel(homeContext: HomeContextView): AccessLevel | null {
  const accessLevel = readContext(homeContext)?.accessLevel

  if (
    accessLevel === AccessLevel.ADMIN ||
    accessLevel === AccessLevel.SENIOR_STAFF ||
    accessLevel === AccessLevel.LINE_STAFF
  ) {
    return accessLevel
  }

  return null
}

function isVenueAccount(accountType: AccountType) {
  return accountType === AccountType.VENUE_STAFF
}

function isSupplierAccount(accountType: AccountType) {
  return accountType === AccountType.SUPPLIER_STAFF
}

export function buildProfileSectionPermissions(params: {
  accountType: AccountType
  accessLevel: AccessLevel | null
}): ProfileSectionPermissions {
  const isVenue = isVenueAccount(params.accountType)
  const isSupplier = isSupplierAccount(params.accountType)
  const isAdmin = params.accessLevel === AccessLevel.ADMIN
  const isSenior = params.accessLevel === AccessLevel.SENIOR_STAFF
  const isLine = params.accessLevel === AccessLevel.LINE_STAFF
  const canUseVenueManagement = isVenue && (isAdmin || isSenior)

  return {
    profile: params.accountType !== AccountType.UNIDENTIFIED,
    myData: params.accountType !== AccountType.UNIDENTIFIED,
    settings: params.accountType !== AccountType.UNIDENTIFIED,
    business: canUseVenueManagement || isSupplier,
    downloads: canUseVenueManagement,
    tasks: isVenue || isSupplier,
    notes: isVenue || isSupplier,
    notifications: isVenue || isSupplier,
    employeeInvite: canUseVenueManagement,
    supplierPrices: isSupplier,
    promoBalance: isSupplier && !isLine,
  }
}

export function buildProfileActionPermissions(params: {
  accountType: AccountType
  accessLevel: AccessLevel | null
}): ProfileActionPermissions {
  const isVenue = isVenueAccount(params.accountType)
  const isSupplier = isSupplierAccount(params.accountType)
  const isAdmin = params.accessLevel === AccessLevel.ADMIN
  const isSenior = params.accessLevel === AccessLevel.SENIOR_STAFF
  const isLine = params.accessLevel === AccessLevel.LINE_STAFF
  const canManageVenue = isVenue && (isAdmin || isSenior)
  const isKnownProfile = params.accountType !== AccountType.UNIDENTIFIED

  return {
    canEditProfile: isKnownProfile,
    canUploadAvatar: isKnownProfile,
    canInviteEmployees: canManageVenue,
    canAddVenue: canManageVenue,
    canEditVenue: canManageVenue,
    canUploadVenuePhotos: canManageVenue,
    canCreateTask: isVenue || isSupplier,
    canAssignTask: canManageVenue || isSupplier,
    canCreateSharedTask: canManageVenue || isSupplier,
    canCreateNote: isVenue || isSupplier,
    canCreateSharedNote: canManageVenue || isSupplier,
    canUploadDownloads: canManageVenue,
    canUploadPrice: isSupplier,
    canViewPromoBalance: isSupplier && !isLine,
    canEditSupplierProfile: isSupplier,
    canManageManagers: isSupplier,
    canManageExperts: isSupplier,
  }
}

export function buildProfilePermissions(params: {
  accountType: AccountType
  accessLevel: AccessLevel | null
}): ProfilePermissions {
  return {
    profileSections: buildProfileSectionPermissions(params),
    actions: buildProfileActionPermissions(params),
  }
}

export async function getProfilePermissionsForAuth(auth: AuthPayload) {
  if (auth.type !== 'user') {
    throw new ProfilePermissionError({
      code: 'SECTION_FORBIDDEN',
      message: 'Profile section requires user principal',
    })
  }

  const homeContext = await getHomeContext(auth)
  const accessLevel = getProfileAccessLevel(homeContext)

  return {
    homeContext,
    accessLevel,
    permissions: buildProfilePermissions({
      accountType: homeContext.user.accountType,
      accessLevel,
    }),
  }
}

export async function assertProfileActionAllowed(
  auth: AuthPayload,
  action: ProfileActionKey,
) {
  const { permissions } = await getProfilePermissionsForAuth(auth)

  if (!permissions.actions[action]) {
    throw new ProfilePermissionError({
      code: 'SECTION_FORBIDDEN',
      message: 'Profile section is forbidden',
    })
  }

  return permissions
}

export function mapProfilePermissionError(error: unknown) {
  if (error instanceof ProfilePermissionError) {
    return { status: error.status, body: apiError(error.code, error.message) }
  }
  return {
    status: 500,
    body: apiError('PROFILE_PERMISSION_CHECK_FAILED', 'Profile permission check failed'),
  }
}
