import {
  AuditActorType,
  DisplayRole,
  MembershipStatus,
  Prisma,
  VenuePhotoStatus,
  VenueStatus,
} from '../../generated/prisma'
import { prisma } from '../../lib/prisma'
import { externalIdWhere, isPublicId } from '../../lib/public-id'
import { buildFileAssetUrl } from '../profile/profile-media.service'

type TransactionClient = Prisma.TransactionClient

class VenueContextError extends Error {
  code: string
  status: number

  constructor(params: { code: string; message: string; status?: number }) {
    super(params.message)
    this.code = params.code
    this.status = params.status ?? 400
  }
}

function isVenueAvailableForWork(venue: {
  isActive: boolean
  venueStatus: VenueStatus
}) {
  return venue.isActive && venue.venueStatus === VenueStatus.ACTIVE
}

function getInactiveReason(venue: {
  isActive: boolean
  venueStatus: VenueStatus
}) {
  if (venue.venueStatus !== VenueStatus.ACTIVE) {
    return venue.venueStatus
  }

  return venue.isActive ? null : VenueStatus.BLOCKED
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

async function findAvailableMembership(userId: string, venueId: string) {
  const internalVenueId = await resolveVenueId(venueId)

  return prisma.userVenueMembership.findFirst({
    where: {
      userId,
      venueId: internalVenueId ?? venueId,
      membershipStatus: MembershipStatus.ACTIVE,
      venue: {
        isActive: true,
        venueStatus: VenueStatus.ACTIVE,
      },
    },
    include: {
      venue: true,
    },
  })
}

async function resolveVenueId(venueId: string) {
  if (!isPublicId(venueId, '3')) {
    return venueId
  }

  const venue = await prisma.venue.findUnique({
    where: externalIdWhere(venueId, '3'),
    select: { id: true },
  })

  return venue?.id ?? null
}

async function findFallbackAvailableVenueId(userId: string) {
  const membership = await prisma.userVenueMembership.findFirst({
    where: {
      userId,
      membershipStatus: MembershipStatus.ACTIVE,
      venue: {
        isActive: true,
        venueStatus: VenueStatus.ACTIVE,
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
    select: {
      venueId: true,
    },
  })

  return membership?.venueId ?? null
}

async function getActiveMembershipVenueIds(userId: string) {
  const memberships = await prisma.userVenueMembership.findMany({
    where: {
      userId,
      membershipStatus: MembershipStatus.ACTIVE,
    },
    orderBy: {
      createdAt: 'asc',
    },
    select: {
      venueId: true,
    },
  })

  return memberships.map((membership) => membership.venueId)
}

async function normalizeUserVenueSelection(userId: string, options?: {
  preferDefault?: boolean
}) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      activeVenueId: true,
      defaultVenueId: true,
    },
  })

  if (!user) {
    throw new VenueContextError({
      code: 'USER_NOT_FOUND',
      message: 'Пользователь не найден',
      status: 404,
    })
  }

  const activeMembershipVenueIds = await getActiveMembershipVenueIds(userId)
  const hasActiveVenue =
    Boolean(user.activeVenueId) &&
    activeMembershipVenueIds.includes(user.activeVenueId!)
  const hasDefaultVenue =
    Boolean(user.defaultVenueId) &&
    activeMembershipVenueIds.includes(user.defaultVenueId!)

  let nextActiveVenueId: string | null = null

  if (options?.preferDefault && hasDefaultVenue) {
    nextActiveVenueId = user.defaultVenueId
  } else if (hasActiveVenue) {
    nextActiveVenueId = user.activeVenueId
  } else if (hasDefaultVenue) {
    nextActiveVenueId = user.defaultVenueId
  } else {
    nextActiveVenueId = await findFallbackAvailableVenueId(userId)
  }

  const nextDefaultVenueId = hasDefaultVenue ? user.defaultVenueId : null

  if (
    nextActiveVenueId !== user.activeVenueId ||
    nextDefaultVenueId !== user.defaultVenueId
  ) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        activeVenueId: nextActiveVenueId,
        defaultVenueId: nextDefaultVenueId,
      },
    })
  }

  return {
    activeVenueId: nextActiveVenueId,
    defaultVenueId: nextDefaultVenueId,
  }
}

export async function setInitialUserVenueContext(
  tx: TransactionClient,
  userId: string,
  venueId: string
) {
  await tx.user.update({
    where: { id: userId },
    data: {
      activeVenueId: venueId,
      defaultVenueId: venueId,
    },
  })
}

export async function resetActiveVenueToDefault(userId: string) {
  const selection = await normalizeUserVenueSelection(userId, {
    preferDefault: true,
  })

  return selection.activeVenueId
}

export async function getUserVenueContext(userId: string) {
  const selection = await normalizeUserVenueSelection(userId)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      publicId: true,
      phone: true,
      activeVenueId: true,
      defaultVenueId: true,
      profile: {
        select: {
          avatarFileId: true,
        },
      },
      memberships: {
        where: {
          membershipStatus: MembershipStatus.ACTIVE,
        },
        orderBy: {
          createdAt: 'asc',
        },
        include: {
          venue: {
            include: {
              photos: {
                where: {
                  status: VenuePhotoStatus.ACTIVE,
                },
                orderBy: {
                  sortOrder: 'asc',
                },
                take: 3,
                include: {
                  fileAsset: {
                    select: {
                      id: true,
                      storageKey: true,
                      fileName: true,
                      mimeType: true,
                    },
                  },
                },
              },
              memberships: {
                where: {
                  membershipStatus: MembershipStatus.ACTIVE,
                },
                orderBy: {
                  joinedAt: 'asc',
                },
                take: 5,
                include: {
                  user: {
                    include: {
                      profile: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })

  if (!user) {
    throw new VenueContextError({
      code: 'USER_NOT_FOUND',
      message: 'Пользователь не найден',
      status: 404,
    })
  }

  const avatarFileIds = Array.from(
    new Set(
      [
        user.profile?.avatarFileId,
        ...user.memberships.flatMap((membership) =>
          membership.venue.memberships.map(
            (staffMembership) => staffMembership.user.profile?.avatarFileId
          )
        ),
      ].filter((fileAssetId): fileAssetId is string => Boolean(fileAssetId))
    )
  )
  const avatarAssets = avatarFileIds.length
    ? await prisma.fileAsset.findMany({
        where: {
          id: {
            in: avatarFileIds,
          },
        },
        select: {
          id: true,
          storageKey: true,
        },
      })
    : []
  const avatarUrlsByFileId = new Map(
    avatarAssets.map((asset) => [asset.id, buildFileAssetUrl(asset.storageKey)])
  )
  const currentUserAvatarUrl = user.profile?.avatarFileId
    ? avatarUrlsByFileId.get(user.profile.avatarFileId) ?? null
    : null

  const venues = user.memberships.map((membership) => {
    const venue = membership.venue
    const isAvailableForSwitch = isVenueAvailableForWork(venue)

    return {
      id: venue.id,
      publicId: venue.publicId,
      name: venue.name,
      city: venue.city,
      address: venue.address,
      phone: venue.phone,
      email: venue.email,
      showPhoneInCard: venue.showPhoneInCard,
      ownerStatus: venue.ownerStatus,
      venueStatus: venue.venueStatus,
      inactiveReason: getInactiveReason(venue),
      isActive: venue.isActive,
      isAvailableForSwitch,
      isActiveVenue: venue.id === user.activeVenueId,
      isDefaultVenue: venue.id === user.defaultVenueId,
      membership: {
        id: membership.id,
        displayRole: membership.displayRole,
        accessLevel: membership.accessLevel,
        status: membership.membershipStatus,
      },
      currentUser: {
        phone: user.phone,
        avatarFileId: user.profile?.avatarFileId ?? null,
        avatarUrl: currentUserAvatarUrl,
      },
      photos: venue.photos.map((photo) => ({
        id: photo.id,
        fileAssetId: photo.fileAssetId,
        storageKey: photo.fileAsset.storageKey,
        fileName: photo.fileAsset.fileName,
        mimeType: photo.fileAsset.mimeType,
      })),
      staffPreview: venue.memberships
        .filter((staffMembership) => staffMembership.user.id !== user.id)
        .map((staffMembership) => ({
          id: staffMembership.user.id,
          publicId: staffMembership.user.publicId,
          membershipId: staffMembership.id,
          fullName: formatUserFullName(staffMembership.user.profile),
          displayRole: staffMembership.displayRole,
          avatarFileId: staffMembership.user.profile?.avatarFileId ?? null,
          avatarUrl: staffMembership.user.profile?.avatarFileId
            ? avatarUrlsByFileId.get(staffMembership.user.profile.avatarFileId) ?? null
            : null,
        })),
      staffPreviewLimit: 5,
    }
  })

  const activeVenue =
    venues.find((venue) => venue.id === selection.activeVenueId) ?? null
  const defaultVenue =
    venues.find((venue) => venue.id === selection.defaultVenueId) ?? null
  const activeVenueSource = activeVenue
    ? activeVenue.id === selection.defaultVenueId
      ? 'DEFAULT'
      : 'LAST_SELECTED'
    : 'NONE'

  return {
    activeVenueId: selection.activeVenueId,
    defaultVenueId: selection.defaultVenueId,
    activeVenueSource,
    activeVenue,
    defaultVenue,
    canUnsetDefault:
      venues.length > 1 && selection.defaultVenueId !== null,
    venues,
    dropdownVenues: venues
      .filter((venue) => venue.isAvailableForSwitch)
      .map((venue) => ({
        id: venue.id,
        publicId: venue.publicId,
        name: venue.name,
        city: venue.city,
      })),
  }
}

export async function setActiveVenue(userId: string, venueId: string) {
  const membership = await findAvailableMembership(userId, venueId)

  if (!membership) {
    throw new VenueContextError({
      code: 'VENUE_NOT_AVAILABLE',
      message: 'Это заведение недоступно для текущего пользователя',
      status: 403,
    })
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      activeVenueId: membership.venueId,
    },
  })

  return getUserVenueContext(userId)
}

export async function setDefaultVenue(userId: string, venueId: string) {
  const membership = await findAvailableMembership(userId, venueId)

  if (!membership) {
    throw new VenueContextError({
      code: 'VENUE_NOT_AVAILABLE',
      message: 'Это заведение недоступно для текущего пользователя',
      status: 403,
    })
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      activeVenueId: membership.venueId,
      defaultVenueId: membership.venueId,
    },
  })

  return getUserVenueContext(userId)
}

export async function clearDefaultVenue(userId: string) {
  const activeVenueIds = await getActiveMembershipVenueIds(userId)

  if (activeVenueIds.length <= 1) {
    throw new VenueContextError({
      code: 'DEFAULT_VENUE_REQUIRED',
      message: 'A default venue is required when only one venue is available',
      status: 409,
    })
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      defaultVenueId: null,
    },
  })

  return getUserVenueContext(userId)
}

export async function ensureSingleVenueOwner(
  venueId: string,
  nextOwnerUserId: string
) {
  const existingOwner = await prisma.userVenueMembership.findFirst({
    where: {
      venueId,
      displayRole: DisplayRole.OWNER,
      membershipStatus: {
        in: [MembershipStatus.ACTIVE, MembershipStatus.PENDING],
      },
      userId: {
        not: nextOwnerUserId,
      },
    },
  })

  if (existingOwner) {
    throw new VenueContextError({
      code: 'VENUE_OWNER_ALREADY_EXISTS',
      message: 'У заведения уже есть владелец',
      status: 409,
    })
  }
}

export async function writeVenueMembershipAudit(params: {
  actorUserId: string
  membershipId: string
  action: string
  payload?: Prisma.InputJsonValue
}) {
  await prisma.auditLog.create({
    data: {
      actorType: AuditActorType.USER,
      actorUserId: params.actorUserId,
      entityType: 'UserVenueMembership',
      entityId: params.membershipId,
      action: params.action,
      payload: params.payload,
    },
  })
}

export function isVenueContextError(
  error: unknown
): error is VenueContextError {
  return error instanceof VenueContextError
}
