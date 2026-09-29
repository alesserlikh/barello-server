import {
  AccessLevel,
  AccountType,
  AuditActorType,
  DisplayRole,
  MembershipStatus,
  UserStatus,
  VenueOwnerStatus,
  VenueStatus,
} from '../../generated/prisma'
import { prisma } from '../../lib/prisma'
import type { AuthPayload } from '../../middleware/auth'
import {
  ensureSingleVenueOwner,
  getUserVenueContext,
} from './venue-context.service'

type AddVenueInput = {
  inn?: string
  venueRole?: DisplayRole
  venueName?: string
  city?: string
  address?: string
  phone?: string
  email?: string
}

class VenueError extends Error {
  code: string
  status: number
  warning?: boolean

  constructor(params: {
    code: string
    message: string
    status?: number
    warning?: boolean
  }) {
    super(params.message)
    this.code = params.code
    this.status = params.status ?? 400
    this.warning = params.warning
  }
}

function normalizeInn(value: unknown) {
  return typeof value === 'string' ? value.replace(/\D/g, '') : ''
}

function assertValidInn(inn: string) {
  if (!/^\d{10}(\d{2})?$/.test(inn)) {
    throw new VenueError({
      code: 'INN_INVALID',
      message: 'Укажите корректный ИНН',
      status: 400,
      warning: true,
    })
  }
}

function assertDisplayRole(value: unknown): asserts value is DisplayRole {
  if (
    typeof value !== 'string' ||
    !Object.values(DisplayRole).includes(value as DisplayRole)
  ) {
    throw new VenueError({
      code: 'VENUE_ROLE_REQUIRED',
      message: 'Выберите роль в заведении',
      status: 400,
      warning: true,
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

function trimOptional(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function hasOwner(venue: {
  ownerStatus: VenueOwnerStatus | null
  memberships: Array<{
    displayRole: DisplayRole
    membershipStatus: MembershipStatus
  }>
}) {
  return (
    venue.ownerStatus === VenueOwnerStatus.OWNER_CONFIRMED ||
    venue.memberships.some(
      (membership) =>
        membership.displayRole === DisplayRole.OWNER &&
        (membership.membershipStatus === MembershipStatus.ACTIVE ||
          membership.membershipStatus === MembershipStatus.PENDING)
    )
  )
}

async function assertCanUseVenueAccount(auth: AuthPayload) {
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
    throw new VenueError({
      code: 'USER_NOT_FOUND',
      message: 'Пользователь не найден',
      status: 404,
    })
  }

  if (
    user.accountType === AccountType.SUPPLIER_STAFF ||
    user.supplierMemberships.length > 0
  ) {
    throw new VenueError({
      code: 'ACCOUNT_TYPE_CONFLICT',
      message: 'Аккаунт поставщика не может добавлять заведение',
      status: 409,
    })
  }

  return user
}

export async function addVenueForCurrentUser(
  auth: AuthPayload,
  input: AddVenueInput
) {
  if (auth.type !== 'user') {
    throw new VenueError({
      code: 'INSUFFICIENT_PERMISSIONS',
      message: 'Добавить заведение может только пользователь заведения',
      status: 403,
    })
  }

  const user = await assertCanUseVenueAccount(auth)
  const inn = normalizeInn(input.inn)
  assertValidInn(inn)
  assertDisplayRole(input.venueRole)

  const venueRole = input.venueRole
  const accessLevel = mapVenueRoleToAccessLevel(venueRole)
  const venueName = trimOptional(input.venueName) || `Заведение ${inn}`
  const city = trimOptional(input.city) || ''
  const address = trimOptional(input.address)
  const phone = trimOptional(input.phone)
  const email = trimOptional(input.email)

  const result = await prisma.$transaction(async (tx) => {
    const business = await tx.business.findUnique({
      where: { taxNumber: inn },
      include: {
        venues: {
          include: {
            memberships: true,
          },
        },
        supplier: true,
      },
    })

    if (business?.supplier) {
      throw new VenueError({
        code: 'INN_COMPANY_TYPE_MISMATCH',
        message: 'ИНН уже привязан к поставщику',
        status: 409,
        warning: true,
      })
    }

    if (business && business.venues.length > 1) {
      throw new VenueError({
        code: 'INN_DUPLICATE_CONFLICT',
        message: 'Для этого ИНН уже создано несколько заведений',
        status: 409,
      })
    }

    const existingVenue = business?.venues[0] ?? null

    if (existingVenue) {
      const existingMembership = await tx.userVenueMembership.findUnique({
        where: {
          userId_venueId: {
            userId: auth.userId,
            venueId: existingVenue.id,
          },
        },
      })

      if (
        existingMembership &&
        existingMembership.membershipStatus !== MembershipStatus.REVOKED
      ) {
        throw new VenueError({
          code:
            existingMembership.membershipStatus === MembershipStatus.PENDING
              ? 'VENUE_MEMBERSHIP_PENDING'
              : 'VENUE_ALREADY_ADDED',
          message:
            existingMembership.membershipStatus === MembershipStatus.PENDING
              ? 'Заявка на присоединение к этому заведению уже отправлена'
              : 'Это заведение уже добавлено в ваш аккаунт',
          status: 409,
          warning: true,
        })
      }

      const venueHasOwner = hasOwner(existingVenue)

      if (venueHasOwner && venueRole === DisplayRole.OWNER) {
        throw new VenueError({
          code: 'VENUE_OWNER_ALREADY_EXISTS',
          message: 'У заведения уже есть владелец',
          status: 409,
          warning: true,
        })
      }

      if (venueRole === DisplayRole.OWNER) {
        await ensureSingleVenueOwner(existingVenue.id, auth.userId)
      }

      const membershipStatus = venueHasOwner
        ? MembershipStatus.PENDING
        : MembershipStatus.ACTIVE

      const membership = existingMembership
        ? await tx.userVenueMembership.update({
            where: {
              userId_venueId: {
                userId: auth.userId,
                venueId: existingVenue.id,
              },
            },
            data: {
              displayRole: venueRole,
              accessLevel,
              membershipStatus,
              joinedAt: membershipStatus === MembershipStatus.ACTIVE ? new Date() : null,
              confirmedByUserId:
                membershipStatus === MembershipStatus.ACTIVE ? auth.userId : null,
            },
          })
        : await tx.userVenueMembership.create({
            data: {
              userId: auth.userId,
              venueId: existingVenue.id,
              displayRole: venueRole,
              accessLevel,
              membershipStatus,
              joinedAt: membershipStatus === MembershipStatus.ACTIVE ? new Date() : undefined,
              confirmedByUserId:
                membershipStatus === MembershipStatus.ACTIVE ? auth.userId : undefined,
            },
          })

      if (!venueHasOwner && venueRole === DisplayRole.OWNER) {
        await tx.venue.update({
          where: { id: existingVenue.id },
          data: {
            ownerStatus: VenueOwnerStatus.OWNER_CONFIRMED,
          },
        })
      }

      if (membershipStatus === MembershipStatus.ACTIVE) {
        await tx.user.update({
          where: { id: auth.userId },
          data: {
            accountType: AccountType.VENUE_STAFF,
            status:
              user.status === UserStatus.UNIDENTIFIED
                ? UserStatus.ACTIVE
                : user.status,
            activeVenueId: existingVenue.id,
          },
        })
      }

      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.USER,
          actorUserId: auth.userId,
          entityType: 'UserVenueMembership',
          entityId: membership.id,
          action: 'VENUE_MEMBERSHIP_REQUESTED',
          payload: {
            inn,
            venueId: existingVenue.id,
            displayRole: venueRole,
            accessLevel,
            membershipStatus,
          },
        },
      })

      return {
        venueId: existingVenue.id,
        membershipStatus,
      }
    }

    const createdBusiness =
      business ??
      (await tx.business.create({
        data: {
          name: venueName,
          taxNumber: inn,
          legalAddress: address,
        },
      }))

    const createdVenue = await tx.venue.create({
      data: {
        businessId: createdBusiness.id,
        name: venueName,
        city,
        address,
        phone,
        email,
        ownerStatus:
          venueRole === DisplayRole.OWNER
            ? VenueOwnerStatus.OWNER_CONFIRMED
            : VenueOwnerStatus.OWNER_MISSING,
        venueStatus: VenueStatus.ACTIVE,
        isActive: true,
      },
    })

    const membership = await tx.userVenueMembership.create({
      data: {
        userId: auth.userId,
        venueId: createdVenue.id,
        displayRole: venueRole,
        accessLevel,
        membershipStatus: MembershipStatus.ACTIVE,
        joinedAt: new Date(),
        confirmedByUserId: auth.userId,
      },
    })

    await tx.user.update({
      where: { id: auth.userId },
      data: {
        accountType: AccountType.VENUE_STAFF,
        status:
          user.status === UserStatus.UNIDENTIFIED ? UserStatus.ACTIVE : user.status,
        activeVenueId: createdVenue.id,
        defaultVenueId: user.defaultVenueId ?? createdVenue.id,
      },
    })

    await tx.auditLog.create({
      data: {
        actorType: AuditActorType.USER,
        actorUserId: auth.userId,
        entityType: 'Venue',
        entityId: createdVenue.id,
        action: 'VENUE_CREATED_AFTER_REGISTRATION',
        payload: {
          inn,
          membershipId: membership.id,
          displayRole: venueRole,
          accessLevel,
        },
      },
    })

    return {
      venueId: createdVenue.id,
      membershipStatus: MembershipStatus.ACTIVE,
    }
  })

  return {
    result,
    context: await getUserVenueContext(auth.userId),
  }
}

export function isVenueError(error: unknown): error is VenueError {
  return error instanceof VenueError
}

