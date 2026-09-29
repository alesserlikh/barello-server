import { createHash, randomUUID } from 'crypto'

import { prisma } from '../../lib/prisma'
import {
  AccessLevel,
  DisplayRole,
  MembershipStatus,
  AccountType,
  StaffInvitationStatus,
} from '../../generated/prisma'
import type { AuthPayload } from '../../middleware/auth'

export const INVITATION_TTL_HOURS = 48
const FREE_TEAM_MEMBER_LIMIT = 5

type CreateStaffInvitationInput = {
  invitedRole: DisplayRole
}

type AcceptStaffInvitationInput = {
  inviteToken: string
  onExistingMembership?: 'CHANGE_ROLE' | 'KEEP_ROLE'
}

class StaffInvitationError extends Error {
  code: string
  status: number

  constructor(params: { code: string; message: string; status?: number }) {
    super(params.message)
    this.code = params.code
    this.status = params.status ?? 400
  }
}

function transliterateToSlug(value: string) {
  const map: Record<string, string> = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ё: 'e',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'y',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'h',
    ц: 'ts',
    ч: 'ch',
    ш: 'sh',
    щ: 'sch',
    ъ: '',
    ы: 'y',
    ь: '',
    э: 'e',
    ю: 'yu',
    я: 'ya',
  }

  const transliterated = value
    .trim()
    .toLowerCase()
    .split('')
    .map((char) => map[char] ?? char)
    .join('')

  const slug = transliterated
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'venue'
}

function hashInviteToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function generateInviteToken() {
  return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
}

function expiresAtFromNow(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000)
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

function buildInvitationView(invitation: {
  id: string
  venueId: string
  invitedRole: DisplayRole
  invitedAccessLevel: AccessLevel
  status: StaffInvitationStatus
  inviteUrl: string
  expiresAt: Date
  acceptedByUserId: string | null
  acceptedAt: Date | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: invitation.id,
    venueId: invitation.venueId,
    invitedRole: invitation.invitedRole,
    invitedAccessLevel: invitation.invitedAccessLevel,
    status: invitation.status,
    inviteUrl: invitation.inviteUrl,
    expiresAt: invitation.expiresAt.toISOString(),
    acceptedByUserId: invitation.acceptedByUserId,
    acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
    createdAt: invitation.createdAt.toISOString(),
    updatedAt: invitation.updatedAt.toISOString(),
  }
}

async function requireVenueInvitationPermissions(venueId: string, userId: string) {
  const membership = await prisma.userVenueMembership.findFirst({
    where: {
      venueId,
      userId,
      membershipStatus: MembershipStatus.ACTIVE,
      accessLevel: {
        in: [AccessLevel.ADMIN, AccessLevel.SENIOR_STAFF],
      },
    },
  })

  if (!membership) {
    throw new StaffInvitationError({
      code: 'INVITE_FORBIDDEN',
      message: 'У вас нет прав на управление приглашениями для этого заведения',
      status: 403,
    })
  }

  return membership
}

async function getInvitationForManagement(invitationId: string, userId: string) {
  const invitation = await prisma.staffInvitation.findUnique({
    where: { id: invitationId },
    include: {
      venue: true,
    },
  })

  if (!invitation) {
    throw new StaffInvitationError({
      code: 'INVITATION_NOT_FOUND',
      message: 'Приглашение сотрудника не найдено',
      status: 404,
    })
  }

  await requireVenueInvitationPermissions(invitation.venueId, userId)

  return invitation
}

async function resolveInvitationByToken(inviteToken: string) {
  const tokenHash = hashInviteToken(inviteToken)

  const invitation = await prisma.staffInvitation.findFirst({
    where: {
      currentTokenHash: tokenHash,
    },
    include: {
      venue: true,
    },
  })

  if (!invitation) {
    throw new StaffInvitationError({
      code: 'INVITE_TOKEN_INVALID',
      message: 'Приглашение недействительно',
      status: 404,
    })
  }

  if (invitation.status === StaffInvitationStatus.REVOKED) {
    throw new StaffInvitationError({
      code: 'INVITE_TOKEN_REVOKED',
      message: 'Приглашение отозвано',
      status: 409,
    })
  }

  if (invitation.status === StaffInvitationStatus.ACCEPTED) {
    throw new StaffInvitationError({
      code: 'INVITE_ALREADY_USED',
      message: 'Приглашение уже использовано',
      status: 409,
    })
  }

  if (invitation.expiresAt.getTime() <= Date.now()) {
    throw new StaffInvitationError({
      code: 'INVITE_EXPIRED',
      message: 'Срок действия приглашения истек',
      status: 410,
    })
  }

  return invitation
}

export async function createStaffInvitation(
  auth: AuthPayload,
  venueId: string,
  input: CreateStaffInvitationInput
) {
  if (auth.type !== 'user') {
    throw new StaffInvitationError({
      code: 'INVITE_FORBIDDEN',
      message: 'Создавать приглашения может только пользователь заведения',
      status: 403,
    })
  }

  if (input.invitedRole === DisplayRole.OWNER) {
    throw new StaffInvitationError({
      code: 'INVITE_INVALID_ROLE',
      message: 'Нельзя пригласить сотрудника сразу владельцем заведения',
      status: 400,
    })
  }

  await requireVenueInvitationPermissions(venueId, auth.userId)

  const venue = await prisma.venue.findUnique({
    where: { id: venueId },
  })

  if (!venue) {
    throw new StaffInvitationError({
      code: 'VENUE_NOT_FOUND',
      message: 'Заведение не найдено',
      status: 404,
    })
  }

  const [activeMembershipsCount, openInvitationsCount] = await Promise.all([
    prisma.userVenueMembership.count({
      where: {
        venueId,
        membershipStatus: MembershipStatus.ACTIVE,
      },
    }),
    prisma.staffInvitation.count({
      where: {
        venueId,
        status: {
          in: [StaffInvitationStatus.CREATED, StaffInvitationStatus.SENT],
        },
        expiresAt: {
          gt: new Date(),
        },
      },
    }),
  ])

  if (activeMembershipsCount + openInvitationsCount >= FREE_TEAM_MEMBER_LIMIT) {
    throw new StaffInvitationError({
      code: 'INVITE_LIMIT_REACHED',
      message: 'Для этого заведения достигнут лимит сотрудников команды',
      status: 409,
    })
  }

  const inviteToken = generateInviteToken()
  const inviteUrl = `https://barello.ru/addstaff/${transliterateToSlug(venue.name)}/${inviteToken}`

  const invitation = await prisma.staffInvitation.create({
    data: {
      venueId,
      inviterUserId: auth.userId,
      invitedRole: input.invitedRole,
      invitedAccessLevel: mapVenueRoleToAccessLevel(input.invitedRole),
      status: StaffInvitationStatus.CREATED,
      currentTokenHash: hashInviteToken(inviteToken),
      inviteUrl,
      expiresAt: expiresAtFromNow(INVITATION_TTL_HOURS),
    },
  })

  return {
    invitation: buildInvitationView(invitation),
  }
}

export async function listStaffInvitations(auth: AuthPayload, venueId: string) {
  if (auth.type !== 'user') {
    throw new StaffInvitationError({
      code: 'INVITE_FORBIDDEN',
      message: 'Просматривать приглашения может только пользователь заведения',
      status: 403,
    })
  }

  await requireVenueInvitationPermissions(venueId, auth.userId)

  const invitations = await prisma.staffInvitation.findMany({
    where: { venueId },
    orderBy: {
      createdAt: 'desc',
    },
  })

  return {
    invitations: invitations.map(buildInvitationView),
  }
}

export async function markStaffInvitationSent(auth: AuthPayload, invitationId: string) {
  if (auth.type !== 'user') {
    throw new StaffInvitationError({
      code: 'INVITE_FORBIDDEN',
      message: 'Изменять приглашение может только пользователь заведения',
      status: 403,
    })
  }

  const invitation = await getInvitationForManagement(invitationId, auth.userId)

  const updated = await prisma.staffInvitation.update({
    where: { id: invitation.id },
    data: {
      status: StaffInvitationStatus.SENT,
    },
  })

  return {
    invitation: buildInvitationView(updated),
  }
}

export async function regenerateStaffInvitationToken(
  auth: AuthPayload,
  invitationId: string
) {
  if (auth.type !== 'user') {
    throw new StaffInvitationError({
      code: 'INVITE_FORBIDDEN',
      message: 'Изменять приглашение может только пользователь заведения',
      status: 403,
    })
  }

  const invitation = await getInvitationForManagement(invitationId, auth.userId)

  const inviteToken = generateInviteToken()
  const inviteUrl = `https://barello.ru/addstaff/${transliterateToSlug(invitation.venue.name)}/${inviteToken}`

  const updated = await prisma.staffInvitation.update({
    where: { id: invitation.id },
    data: {
      currentTokenHash: hashInviteToken(inviteToken),
      inviteUrl,
      expiresAt: expiresAtFromNow(INVITATION_TTL_HOURS),
      status: StaffInvitationStatus.CREATED,
      acceptedAt: null,
      acceptedByUserId: null,
    },
  })

  return {
    invitation: buildInvitationView(updated),
  }
}

export async function revokeStaffInvitation(auth: AuthPayload, invitationId: string) {
  if (auth.type !== 'user') {
    throw new StaffInvitationError({
      code: 'INVITE_FORBIDDEN',
      message: 'Изменять приглашение может только пользователь заведения',
      status: 403,
    })
  }

  const invitation = await getInvitationForManagement(invitationId, auth.userId)

  const updated = await prisma.staffInvitation.update({
    where: { id: invitation.id },
    data: {
      status: StaffInvitationStatus.REVOKED,
      currentTokenHash: `revoked:${randomUUID()}`,
    },
  })

  return {
    invitation: buildInvitationView(updated),
  }
}

export async function acceptStaffInvitation(
  auth: AuthPayload,
  input: AcceptStaffInvitationInput
) {
  if (auth.type !== 'user') {
    throw new StaffInvitationError({
      code: 'INVITE_FORBIDDEN',
      message: 'Принять приглашение может только пользователь заведения',
      status: 403,
    })
  }

  const invitation = await resolveInvitationByToken(input.inviteToken)

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    include: {
      supplierMemberships: {
        where: {
          status: {
            in: [MembershipStatus.ACTIVE, MembershipStatus.PENDING],
          },
        },
      },
    },
  })

  if (!user) {
    throw new StaffInvitationError({
      code: 'USER_NOT_FOUND',
      message: 'Пользователь не найден',
      status: 404,
    })
  }

  if (
    user.accountType === AccountType.SUPPLIER_STAFF ||
    user.supplierMemberships.length > 0
  ) {
    throw new StaffInvitationError({
      code: 'ACCOUNT_TYPE_CONFLICT',
      message:
        'Пользователь не может одновременно работать с закупками заведения и поставщиком.',
      status: 409,
    })
  }

  const existingMembership = await prisma.userVenueMembership.findUnique({
    where: {
      userId_venueId: {
        userId: auth.userId,
        venueId: invitation.venueId,
      },
    },
  })

  if (existingMembership && !input.onExistingMembership) {
    throw new StaffInvitationError({
      code: 'USER_ALREADY_IN_VENUE',
      message: 'Вы уже состоите в команде этого заведения. Сменить роль или оставить прежнюю?',
      status: 409,
    })
  }

  return prisma.$transaction(async (tx) => {
    let membership = existingMembership

    if (!membership) {
      membership = await tx.userVenueMembership.create({
        data: {
          userId: auth.userId,
          venueId: invitation.venueId,
          displayRole: invitation.invitedRole,
          accessLevel: invitation.invitedAccessLevel,
          membershipStatus: MembershipStatus.ACTIVE,
          joinedAt: new Date(),
          confirmedByUserId: auth.userId,
        },
      })
    } else if (input.onExistingMembership === 'CHANGE_ROLE') {
      membership = await tx.userVenueMembership.update({
        where: {
          userId_venueId: {
            userId: auth.userId,
            venueId: invitation.venueId,
          },
        },
        data: {
          displayRole: invitation.invitedRole,
          accessLevel: invitation.invitedAccessLevel,
          membershipStatus: MembershipStatus.ACTIVE,
        },
      })
    }

    await tx.staffInvitation.update({
      where: { id: invitation.id },
      data: {
        status: StaffInvitationStatus.ACCEPTED,
        acceptedByUserId: auth.userId,
        acceptedAt: new Date(),
      },
    })

    return {
      user: {
        id: user.id,
        phone: user.phone,
        status: user.status,
        accountType: user.accountType,
      },
      membership,
      redirectTo: 'HOME' as const,
    }
  })
}

export function isStaffInvitationError(
  error: unknown
): error is StaffInvitationError {
  return error instanceof StaffInvitationError
}

export { hashInviteToken, resolveInvitationByToken, transliterateToSlug }

