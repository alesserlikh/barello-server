import {
  AccessLevel,
  ContractSupplierStatus,
  MembershipStatus,
  VenueStatus,
} from '../../generated/prisma'
import type { AuthPayload } from '../../middleware/auth'
import { prisma } from '../../lib/prisma'

export type ProfileCompletionBlockKey =
  | 'fullName'
  | 'phone'
  | 'innAndBasics'
  | 'avatar'
  | 'venuePhotos'
  | 'companyPhotos'
  | 'email'
  | 'staff'
  | 'managers'
  | 'stock'
  | 'menu'
  | 'salesData'
  | 'suppliers'
  | 'price'
  | 'geography'

export type ProfileCompletionBlock = {
  key: ProfileCompletionBlockKey
  completed: boolean
  weight: number
}

export type ProfileCompletionSummary = {
  percent: number
  blocks: ProfileCompletionBlock[]
}

export type ProfileCompletionResponse = {
  venue: ProfileCompletionSummary | null
  supplier: ProfileCompletionSummary | null
}

const VENUE_BLOCK_WEIGHTS = {
  fullName: 5,
  phone: 8,
  innAndBasics: 17,
  avatar: 4,
  venuePhotos: 6,
  email: 5,
  staff: 10,
  stock: 12,
  menu: 10,
  salesData: 12,
  suppliers: 11,
} as const

const SUPPLIER_BLOCK_WEIGHTS = {
  fullName: 5,
  phone: 8,
  innAndBasics: 18,
  avatar: 4,
  companyPhotos: 6,
  email: 6,
  managers: 10,
  price: 22,
  stock: 15,
  geography: 6,
} as const

function compareAccessLevels(left: AccessLevel, right: AccessLevel) {
  const priority: Record<AccessLevel, number> = {
    ADMIN: 3,
    SENIOR_STAFF: 2,
    LINE_STAFF: 1,
  }

  return priority[right] - priority[left]
}

function hasValue(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0
}

function hasCompletedFullName(
  profile:
    | {
        firstName: string
        lastName: string
      }
    | null
    | undefined
) {
  return hasValue(profile?.firstName) && hasValue(profile?.lastName)
}

function buildSummary(blocks: ProfileCompletionBlock[]): ProfileCompletionSummary {
  const percent = blocks.reduce((total, block) => total + (block.completed ? block.weight : 0), 0)

  return {
    percent,
    blocks,
  }
}

function hasCompanyBasics(
  company:
    | {
        taxNumber: string | null
      }
    | null
    | undefined,
  entity: {
    name: string | null
    city: string | null
    address: string | null
  }
) {
  return (
    hasValue(company?.taxNumber) &&
    hasValue(entity.name) &&
    (hasValue(entity.city) || hasValue(entity.address))
  )
}

async function resolveActiveVenueId(userId: string, venueId?: string) {
  if (venueId) {
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
        venueId: true,
      },
    })

    return membership?.venueId
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      activeVenueId: true,
      defaultVenueId: true,
    },
  })

  const preferredVenueIds = [
    user?.activeVenueId,
    user?.defaultVenueId,
  ].filter((id): id is string => Boolean(id))

  if (preferredVenueIds.length > 0) {
    const membership = await prisma.userVenueMembership.findFirst({
      where: {
        userId,
        venueId: {
          in: preferredVenueIds,
        },
        membershipStatus: MembershipStatus.ACTIVE,
        venue: {
          isActive: true,
          venueStatus: VenueStatus.ACTIVE,
        },
      },
      select: {
        venueId: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    })

    if (membership) {
      return membership.venueId
    }
  }

  const memberships = await prisma.userVenueMembership.findMany({
    where: {
      userId,
      membershipStatus: MembershipStatus.ACTIVE,
      venue: {
        isActive: true,
        venueStatus: VenueStatus.ACTIVE,
      },
    },
    select: {
      venueId: true,
      accessLevel: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: 'asc',
    },
  })

  const membership = [...memberships].sort((left, right) =>
    compareAccessLevels(left.accessLevel, right.accessLevel)
  )[0]

  return membership?.venueId
}

async function resolveActiveSupplierId(userId: string, supplierId?: string) {
  const membership = await prisma.supplierMembership.findFirst({
    where: {
      userId,
      status: MembershipStatus.ACTIVE,
      ...(supplierId ? { supplierId } : {}),
    },
    select: {
      supplierId: true,
    },
    orderBy: {
      createdAt: 'asc',
    },
  })

  return membership?.supplierId
}

export async function getVenueProfileCompletion(
  userId: string,
  venueId?: string
): Promise<ProfileCompletionSummary | undefined> {
  const activeVenueId = await resolveActiveVenueId(userId, venueId)

  if (!activeVenueId) {
    return undefined
  }

  const [user, venue, venuePhotoCount, activeStaffCount, activeSupplierCount] =
    await prisma.$transaction([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          phone: true,
          email: true,
          emailVerifiedAt: true,
          profile: {
            select: {
              firstName: true,
              lastName: true,
              avatarFileId: true,
            },
          },
        },
      }),
      prisma.venue.findUnique({
        where: { id: activeVenueId },
        select: {
          name: true,
          city: true,
          address: true,
          mainPhotoFileId: true,
          showPhoneInCard: true,
          business: {
            select: {
              taxNumber: true,
            },
          },
        },
      }),
      prisma.venuePhoto.count({
        where: {
          venueId: activeVenueId,
        },
      }),
      prisma.userVenueMembership.count({
        where: {
          venueId: activeVenueId,
          membershipStatus: MembershipStatus.ACTIVE,
        },
      }),
      prisma.contractSupplier.count({
        where: {
          venueId: activeVenueId,
          status: ContractSupplierStatus.ACTIVE,
        },
      }),
    ])

  if (!user || !venue) {
    return undefined
  }

  const blocks: ProfileCompletionBlock[] = [
    {
      key: 'fullName',
      completed: hasCompletedFullName(user.profile),
      weight: VENUE_BLOCK_WEIGHTS.fullName,
    },
    {
      key: 'phone',
      completed: hasValue(user.phone),
      weight: VENUE_BLOCK_WEIGHTS.phone,
    },
    {
      key: 'innAndBasics',
      completed: hasCompanyBasics(venue.business, venue),
      weight: VENUE_BLOCK_WEIGHTS.innAndBasics,
    },
    {
      key: 'avatar',
      completed: hasValue(user.profile?.avatarFileId),
      weight: VENUE_BLOCK_WEIGHTS.avatar,
    },
    {
      key: 'venuePhotos',
      completed: hasValue(venue.mainPhotoFileId) || venuePhotoCount > 0,
      weight: VENUE_BLOCK_WEIGHTS.venuePhotos,
    },
    {
      key: 'email',
      completed: hasValue(user.email) && Boolean(user.emailVerifiedAt),
      weight: VENUE_BLOCK_WEIGHTS.email,
    },
    {
      key: 'staff',
      completed: activeStaffCount > 1,
      weight: VENUE_BLOCK_WEIGHTS.staff,
    },
    {
      key: 'stock',
      completed: false,
      weight: VENUE_BLOCK_WEIGHTS.stock,
    },
    {
      key: 'menu',
      completed: false,
      weight: VENUE_BLOCK_WEIGHTS.menu,
    },
    {
      key: 'salesData',
      completed: false,
      weight: VENUE_BLOCK_WEIGHTS.salesData,
    },
    {
      key: 'suppliers',
      completed: activeSupplierCount > 0,
      weight: VENUE_BLOCK_WEIGHTS.suppliers,
    },
  ]

  return buildSummary(blocks)
}

export async function getSupplierProfileCompletion(
  userId: string,
  supplierId?: string
): Promise<ProfileCompletionSummary | undefined> {
  const activeSupplierId = await resolveActiveSupplierId(userId, supplierId)

  if (!activeSupplierId) {
    return undefined
  }

  const [user, supplier, supplierPhotoCount] =
    await prisma.$transaction([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          phone: true,
          email: true,
          emailVerifiedAt: true,
          profile: {
            select: {
              firstName: true,
              lastName: true,
              avatarFileId: true,
            },
          },
        },
      }),
      prisma.supplier.findUnique({
        where: { id: activeSupplierId },
        select: {
          name: true,
          city: true,
          address: true,
          mainPhotoFileId: true,
          showPhoneInCard: true,
          business: {
            select: {
              taxNumber: true,
            },
          },
        },
      }),
      prisma.supplierPhoto.count({
        where: {
          supplierId: activeSupplierId,
        },
      }),
    ])

  if (!user || !supplier) {
    return undefined
  }

  const blocks: ProfileCompletionBlock[] = [
    {
      key: 'fullName',
      completed: hasCompletedFullName(user.profile),
      weight: SUPPLIER_BLOCK_WEIGHTS.fullName,
    },
    {
      key: 'phone',
      completed: hasValue(user.phone),
      weight: SUPPLIER_BLOCK_WEIGHTS.phone,
    },
    {
      key: 'innAndBasics',
      completed: hasCompanyBasics(supplier.business, supplier),
      weight: SUPPLIER_BLOCK_WEIGHTS.innAndBasics,
    },
    {
      key: 'avatar',
      completed: hasValue(user.profile?.avatarFileId),
      weight: SUPPLIER_BLOCK_WEIGHTS.avatar,
    },
    {
      key: 'companyPhotos',
      completed: hasValue(supplier.mainPhotoFileId) || supplierPhotoCount > 0,
      weight: SUPPLIER_BLOCK_WEIGHTS.companyPhotos,
    },
    {
      key: 'email',
      completed: hasValue(user.email) && Boolean(user.emailVerifiedAt),
      weight: SUPPLIER_BLOCK_WEIGHTS.email,
    },
    {
      key: 'managers',
      completed: false,
      weight: SUPPLIER_BLOCK_WEIGHTS.managers,
    },
    {
      key: 'price',
      completed: false,
      weight: SUPPLIER_BLOCK_WEIGHTS.price,
    },
    {
      key: 'stock',
      completed: false,
      weight: SUPPLIER_BLOCK_WEIGHTS.stock,
    },
    {
      key: 'geography',
      completed: false,
      weight: SUPPLIER_BLOCK_WEIGHTS.geography,
    },
  ]

  return buildSummary(blocks)
}

export async function getProfileCompletion(
  auth: AuthPayload
): Promise<ProfileCompletionResponse> {
  if (auth.type !== 'user') {
    throw new Error('Only user principals are supported for profile completion')
  }

  const [venue, supplier] = await Promise.all([
    getVenueProfileCompletion(auth.userId),
    getSupplierProfileCompletion(auth.userId),
  ])

  return {
    venue: venue ?? null,
    supplier: supplier ?? null,
  }
}
