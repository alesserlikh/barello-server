import {
  AccessLevel,
  AuditActorType,
  DisplayRole,
  MembershipStatus,
  VenueStatus,
} from '../../generated/prisma'
import { prisma } from '../../lib/prisma'
import type { AuthPayload } from '../../middleware/auth'

const STAFF_PREVIEW_LIMIT = 5

class VenueStaffError extends Error {
  code: string
  status: number

  constructor(params: { code: string; message: string; status?: number }) {
    super(params.message)
    this.code = params.code
    this.status = params.status ?? 400
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
  if (!profile) return ''

  return [profile.lastName, profile.firstName, profile.middleName]
    .filter(Boolean)
    .join(' ')
}

type UpdateVenueStaffMembershipInput = {
  displayRole?: DisplayRole
  membershipStatus?: MembershipStatus
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

function parseDisplayRole(value: unknown) {
  if (typeof value !== 'string') return undefined
  if (!Object.values(DisplayRole).includes(value as DisplayRole)) {
    throw new VenueStaffError({
      code: 'INVALID_DISPLAY_ROLE',
      message: 'Указана некорректная роль',
      status: 400,
    })
  }

  return value as DisplayRole
}

function parseMembershipStatus(value: unknown) {
  if (typeof value !== 'string') return undefined
  if (!Object.values(MembershipStatus).includes(value as MembershipStatus)) {
    throw new VenueStaffError({
      code: 'INVALID_MEMBERSHIP_STATUS',
      message: 'Указан некорректный статус доступа',
      status: 400,
    })
  }

  return value as MembershipStatus
}

async function requireVenueStaffAccess(userId: string, venueId: string) {
  const membership = await prisma.userVenueMembership.findFirst({
    where: {
      userId,
      venueId,
      membershipStatus: MembershipStatus.ACTIVE,
      venue: {
        isActive: true,
        venueStatus: VenueStatus.ACTIVE,
      },
    },
    select: {
      id: true,
      accessLevel: true,
      displayRole: true,
    },
  })

  if (!membership) {
    throw new VenueStaffError({
      code: 'VENUE_NOT_AVAILABLE',
      message: 'Это заведение недоступно для текущего пользователя',
      status: 403,
    })
  }

  return membership
}

async function requireVenueStaffManagementAccess(userId: string, venueId: string) {
  const membership = await requireVenueStaffAccess(userId, venueId)

  if (
    membership.displayRole !== DisplayRole.OWNER &&
    membership.accessLevel !== AccessLevel.ADMIN &&
    membership.accessLevel !== AccessLevel.SENIOR_STAFF
  ) {
    throw new VenueStaffError({
      code: 'INSUFFICIENT_PERMISSIONS',
      message: 'У вас нет прав на управление сотрудниками заведения',
      status: 403,
    })
  }

  return membership
}

function buildStaffMemberView(membership: {
  id: string
  userId: string
  venueId: string
  displayRole: string
  accessLevel: string
  membershipStatus: string
  joinedAt: Date | null
  createdAt: Date
  updatedAt: Date
  user: {
    id: string
    phone: string | null
    email: string | null
    status: string
    profile: {
      id: string
      firstName: string
      lastName: string
      middleName: string | null
      avatarFileId: string | null
    } | null
  }
}) {
  return {
    membershipId: membership.id,
    userId: membership.userId,
    venueId: membership.venueId,
    fullName: formatUserFullName(membership.user.profile),
    phone: membership.user.phone,
    email: membership.user.email,
    userStatus: membership.user.status,
    avatarFileId: membership.user.profile?.avatarFileId ?? null,
    displayRole: membership.displayRole,
    accessLevel: membership.accessLevel,
    membershipStatus: membership.membershipStatus,
    joinedAt: membership.joinedAt?.toISOString() ?? null,
    createdAt: membership.createdAt.toISOString(),
    updatedAt: membership.updatedAt.toISOString(),
  }
}

export function normalizeUpdateVenueStaffMembershipInput(
  input: unknown
): UpdateVenueStaffMembershipInput {
  const body =
    input && typeof input === 'object' ? (input as Record<string, unknown>) : {}

  const displayRole = parseDisplayRole(body.displayRole)
  const membershipStatus = parseMembershipStatus(body.membershipStatus)

  if (!displayRole && !membershipStatus) {
    throw new VenueStaffError({
      code: 'NO_MEMBERSHIP_CHANGES',
      message: 'Нужно указать роль или статус доступа',
      status: 400,
    })
  }

  return {
    displayRole,
    membershipStatus,
  }
}

export async function listVenueStaff(auth: AuthPayload, venueId: string) {
  if (auth.type !== 'user') {
    throw new VenueStaffError({
      code: 'INSUFFICIENT_PERMISSIONS',
      message: 'Просматривать сотрудников может только пользователь заведения',
      status: 403,
    })
  }

  if (!venueId) {
    throw new VenueStaffError({
      code: 'VENUE_ID_REQUIRED',
      message: 'Не выбрано заведение',
      status: 400,
    })
  }

  await requireVenueStaffAccess(auth.userId, venueId)

  const memberships = await prisma.userVenueMembership.findMany({
    where: {
      venueId,
      membershipStatus: MembershipStatus.ACTIVE,
    },
    orderBy: [
      {
        joinedAt: 'asc',
      },
      {
        createdAt: 'asc',
      },
    ],
    include: {
      user: {
        include: {
          profile: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              middleName: true,
              avatarFileId: true,
            },
          },
        },
      },
    },
  })

  const staff = memberships.map(buildStaffMemberView)

  return {
    venueId,
    staff,
    preview: staff.slice(0, STAFF_PREVIEW_LIMIT),
    previewLimit: STAFF_PREVIEW_LIMIT,
    totalCount: staff.length,
  }
}

export async function updateVenueStaffMembership(
  auth: AuthPayload,
  venueId: string,
  membershipId: string,
  input: UpdateVenueStaffMembershipInput
) {
  if (auth.type !== 'user') {
    throw new VenueStaffError({
      code: 'INSUFFICIENT_PERMISSIONS',
      message: 'Изменять сотрудников заведения может только пользователь заведения',
      status: 403,
    })
  }

  if (!venueId || !membershipId) {
    throw new VenueStaffError({
      code: 'MEMBERSHIP_ID_REQUIRED',
      message: 'Нужно указать идентификаторы заведения и сотрудника',
      status: 400,
    })
  }

  await requireVenueStaffManagementAccess(auth.userId, venueId)

  const membership = await prisma.userVenueMembership.findFirst({
    where: {
      id: membershipId,
      venueId,
    },
    include: {
      user: {
        include: {
          profile: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              middleName: true,
              avatarFileId: true,
            },
          },
        },
      },
    },
  })

  if (!membership) {
    throw new VenueStaffError({
      code: 'MEMBERSHIP_NOT_FOUND',
      message: 'Сотрудник заведения не найден',
      status: 404,
    })
  }

  const nextDisplayRole = input.displayRole ?? membership.displayRole
  const nextAccessLevel = input.displayRole
    ? mapVenueRoleToAccessLevel(input.displayRole)
    : membership.accessLevel
  const nextMembershipStatus =
    input.membershipStatus ?? membership.membershipStatus

  if (
    nextDisplayRole === DisplayRole.OWNER &&
    membership.displayRole !== DisplayRole.OWNER
  ) {
    const existingOwner = await prisma.userVenueMembership.findFirst({
      where: {
        venueId,
        id: {
          not: membership.id,
        },
        displayRole: DisplayRole.OWNER,
        membershipStatus: {
          not: MembershipStatus.REVOKED,
        },
      },
      select: {
        id: true,
      },
    })

    if (existingOwner) {
      throw new VenueStaffError({
        code: 'VENUE_OWNER_ALREADY_EXISTS',
        message: 'У заведения уже есть владелец',
        status: 409,
      })
    }
  }

  const roleChanged =
    nextDisplayRole !== membership.displayRole ||
    nextAccessLevel !== membership.accessLevel
  const statusChanged = nextMembershipStatus !== membership.membershipStatus

  if (!roleChanged && !statusChanged) {
    return {
      membership: buildStaffMemberView(membership),
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const updatedMembership = await tx.userVenueMembership.update({
      where: { id: membership.id },
      data: {
        displayRole: nextDisplayRole,
        accessLevel: nextAccessLevel,
        membershipStatus: nextMembershipStatus,
        joinedAt:
          nextMembershipStatus === MembershipStatus.ACTIVE && !membership.joinedAt
            ? new Date()
            : undefined,
        confirmedByUserId:
          nextMembershipStatus === MembershipStatus.ACTIVE &&
          membership.membershipStatus === MembershipStatus.PENDING
            ? auth.userId
            : undefined,
      },
      include: {
        user: {
          include: {
            profile: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                middleName: true,
                avatarFileId: true,
              },
            },
          },
        },
      },
    })

    if (roleChanged) {
      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.USER,
          actorUserId: auth.userId,
          entityType: 'UserVenueMembership',
          entityId: membership.id,
          action: 'VENUE_MEMBERSHIP_ROLE_CHANGED',
          payload: {
            venueId,
            userId: membership.userId,
            previousDisplayRole: membership.displayRole,
            nextDisplayRole,
            previousAccessLevel: membership.accessLevel,
            nextAccessLevel,
          },
        },
      })
    }

    if (statusChanged) {
      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.USER,
          actorUserId: auth.userId,
          entityType: 'UserVenueMembership',
          entityId: membership.id,
          action: 'VENUE_MEMBERSHIP_STATUS_CHANGED',
          payload: {
            venueId,
            userId: membership.userId,
            previousMembershipStatus: membership.membershipStatus,
            nextMembershipStatus,
          },
        },
      })
    }

    return updatedMembership
  })

  return {
    membership: buildStaffMemberView(updated),
  }
}

export function isVenueStaffError(error: unknown): error is VenueStaffError {
  return error instanceof VenueStaffError
}

