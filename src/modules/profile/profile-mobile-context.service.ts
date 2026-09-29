import { prisma } from '../../lib/prisma'
import type { AuthPayload } from '../../middleware/auth'
import {
  AccountType,
  MembershipStatus,
  SupplierOrderStatus,
} from '../../generated/prisma'
import { getHomeContext } from '../auth/home-context.service'
import { getUserVenueContext } from '../venues/venue-context.service'
import { getUserSupplierContext } from '../suppliers/supplier-context.service'
import {
  getProfileCompletion,
  type ProfileCompletionSummary,
} from './profile-completion.service'
import { findFileAssetViewById } from './profile-media.service'
import { getNotificationsSummary } from '../notifications/notifications.service'
import { getTasksWeekSummary } from '../tasks/tasks.service'
import { getLatestNote } from '../notes/notes.service'
import { getSupplierPriceImportStatus } from '../price-imports/supplier-price-imports.service'
import { getLatestDownloads } from '../downloads/downloads.service'
import {
  buildProfilePermissions,
  getProfileAccessLevel,
} from './profile-permissions.service'

type HomeContextView = Awaited<ReturnType<typeof getHomeContext>>

type ProfileMobileContextSection =
  | 'completion'
  | 'notifications'
  | 'venue'
  | 'supplier'
  | 'tasks'
  | 'notes'
  | 'downloads'
  | 'supplierPrices'
  | 'promoBalance'

type ApiErrorDto = {
  code: string
  message: string
  details?: unknown
}

export class ProfileMobileContextError extends Error {
  code: string
  status: number
  details?: unknown

  constructor(params: {
    code: string
    message: string
    status?: number
    details?: unknown
  }) {
    super(params.message)
    this.name = 'ProfileMobileContextError'
    this.code = params.code
    this.status = params.status ?? 400
    this.details = params.details
  }
}

async function getVenueStatistics(venueId: string) {
  try {
    const [
      menuItemsCount,
      stockItemsCount,
      ordersCount,
      inventoriesCount,
      staffCount,
    ] = await prisma.$transaction([
      prisma.menuItem.count({ where: { venueId } }),
      prisma.inventoryItem.count({ where: { venueId } }),
      prisma.orderBatch.count({ where: { venueId } }),
      prisma.inventorySession.count({ where: { venueId } }),
      prisma.userVenueMembership.count({
        where: { venueId, membershipStatus: MembershipStatus.ACTIVE },
      }),
    ])

    return {
      menuItemsCount,
      stockItemsCount,
      ordersCount,
      inventoriesCount,
      staffCount,
    }
  } catch {
    return {
      menuItemsCount: null,
      stockItemsCount: null,
      ordersCount: null,
      inventoriesCount: null,
      staffCount: null,
    }
  }
}

async function getSupplierStatistics(supplierId: string) {
  try {
    const [skuCount, activeOrdersCount, priceListsCount, memberships] =
      await Promise.all([
        prisma.supplierProduct.count({ where: { supplierId } }),
        prisma.supplierOrder.count({
          where: {
            supplierId,
            status: {
              in: [
                SupplierOrderStatus.PENDING,
                SupplierOrderStatus.ACCEPTED,
                SupplierOrderStatus.PROCESSING,
                SupplierOrderStatus.SHIPPED,
              ],
            },
          },
        }),
        prisma.supplierPriceImport.count({ where: { supplierId } }),
        prisma.supplierMembership.findMany({
          where: { supplierId, status: MembershipStatus.ACTIVE },
          select: { displayRole: true },
        }),
      ])

    const normalizedRoles = memberships.map((membership) =>
      membership.displayRole.trim().toUpperCase(),
    )

    return {
      skuCount,
      activeOrdersCount,
      priceListsCount,
      managersCount: normalizedRoles.filter((role) => role.includes('MANAGER'))
        .length,
      expertsCount: normalizedRoles.filter((role) => role.includes('EXPERT'))
        .length,
    }
  } catch {
    return {
      skuCount: null,
      activeOrdersCount: null,
      priceListsCount: null,
      managersCount: null,
      expertsCount: null,
    }
  }
}
function mapProfileCompletionSummary(summary: ProfileCompletionSummary | null) {
  if (!summary) return null

  return {
    percent: summary.percent,
    items: summary.blocks.map((block) => ({
      code: block.key,
      completed: block.completed,
      rewardPercent: block.weight,
    })),
  }
}

function readContext(homeContext: HomeContextView) {
  return 'context' in homeContext ? homeContext.context : undefined
}

function normalizeBusinessContext(homeContext: HomeContextView) {
  const context = readContext(homeContext)

  return {
    accessLevel: context?.accessLevel ?? null,
    displayRole: context?.displayRole ?? null,
    membershipType: context?.membershipType ?? null,
    activeVenueId: context?.activeVenueId ?? context?.venueId ?? null,
    activeSupplierId: context?.supplierId ?? null,
  }
}

function buildCriticalError(error: unknown): ProfileMobileContextError {
  if (error instanceof ProfileMobileContextError) {
    return error
  }

  if (error instanceof Error && error.message === 'User not found') {
    return new ProfileMobileContextError({
      code: 'PROFILE_CONTEXT_USER_NOT_FOUND',
      message: 'Profile context user was not found',
      status: 404,
    })
  }

  return new ProfileMobileContextError({
    code: 'PROFILE_CONTEXT_UNAVAILABLE',
    message: 'Profile mobile context is unavailable',
    status: 400,
  })
}

export function mapProfileMobileContextError(error: unknown) {
  const normalized = buildCriticalError(error)

  return {
    status: normalized.status,
    body: {
      ok: false,
      error: {
        code: normalized.code,
        message: normalized.message,
        ...(normalized.details === undefined ? {} : { details: normalized.details }),
      },
    },
  }
}

export async function getProfileMobileContext(auth: AuthPayload) {
  if (auth.type !== 'user') {
    throw new ProfileMobileContextError({
      code: 'PROFILE_FORBIDDEN',
      message: 'Profile mobile context requires user principal',
      status: 403,
    })
  }

  const homeContext = await getHomeContext(auth)
  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: {
      id: true,
      phone: true,
      email: true,
      accountType: true,
      profile: {
        select: {
          avatarFileId: true,
        },
      },
    },
  })

  if (!user) {
    throw new ProfileMobileContextError({
      code: 'PROFILE_CONTEXT_USER_NOT_FOUND',
      message: 'Profile context user was not found',
      status: 404,
    })
  }

  const accessLevel = getProfileAccessLevel(homeContext)
  const permissions = buildProfilePermissions({
    accountType: user.accountType,
    accessLevel,
  })
  const avatar = await findFileAssetViewById(user.profile?.avatarFileId)
  const errorsBySection: Partial<Record<ProfileMobileContextSection, ApiErrorDto>> = {}

  const completion = await getProfileCompletion(auth).catch(() => {
    errorsBySection.completion = {
      code: 'PROFILE_COMPLETION_UNAVAILABLE',
      message: 'Profile completion is unavailable',
    }
    return null
  })

  const notifications = await getNotificationsSummary(auth).catch(() => {
    errorsBySection.notifications = {
      code: 'NOTIFICATIONS_SUMMARY_UNAVAILABLE',
      message: 'Notifications summary is unavailable',
    }
    return { unreadCount: 0 }
  })

  const tasks = await getTasksWeekSummary(auth).catch(() => {
    errorsBySection.tasks = {
      code: 'TASKS_UNAVAILABLE',
      message: 'Tasks summary is unavailable',
    }
    return null
  })

  const latestNote = await getLatestNote(auth).catch(() => {
    errorsBySection.notes = {
      code: 'NOTES_UNAVAILABLE',
      message: 'Latest note is unavailable',
    }
    return null
  })

  const supplierPriceStatus = permissions.profileSections.supplierPrices
    ? await getSupplierPriceImportStatus(auth).catch(() => {
        errorsBySection.supplierPrices = {
          code: 'SUPPLIER_PRICE_STATUS_UNAVAILABLE',
          message: 'Supplier price status is unavailable',
        }
        return null
      })
    : null

  let promoBalance: { amount: number; currency: 'RUB' } | null = null
  let plan: {
    planName: string | null
    planStatus: 'ACTIVE' | 'TRIAL' | 'PAST_DUE' | 'CANCELLED' | null
  } | null = null
  const latestDownloads = permissions.profileSections.downloads
    ? await getLatestDownloads(auth).catch(() => {
        errorsBySection.downloads = {
          code: 'DOWNLOADS_UNAVAILABLE',
          message: 'Latest downloads are unavailable',
        }
        return []
      })
    : []
  let activeVenue: Record<string, unknown> | null = null
  let venues: Array<Record<string, unknown>> = []
  let activeSupplier: Record<string, unknown> | null = null
  let canUnsetDefault = false

  if (user.accountType === AccountType.VENUE_STAFF) {
    const venueContext = await getUserVenueContext(user.id).catch(() => {
      errorsBySection.venue = {
        code: 'VENUE_CONTEXT_UNAVAILABLE',
        message: 'Venue profile context is unavailable',
      }
      return null
    })

    if (venueContext) {
      canUnsetDefault = venueContext.canUnsetDefault
      venues = await Promise.all(venueContext.venues.map(async (venue) => ({
        id: venue.id,
        name: venue.name,
        address: venue.address,
        city: venue.city,
        phone: venue.phone,
        role: venue.membership.displayRole,
        accessLevel: venue.membership.accessLevel,
        isDefault: venue.isDefaultVenue,
        isActive: venue.isActiveVenue,
        showPhoneInCard: venue.showPhoneInCard,
        avatarFileId: venue.currentUser.avatarFileId,
        avatarUrl: venue.currentUser.avatarUrl,
        photos: venue.photos.map((photo) => ({
          id: photo.id,
          fileAssetId: photo.fileAssetId,
          storageKey: photo.storageKey,
          url: photo.storageKey,
          fileName: photo.fileName,
          mimeType: photo.mimeType,
        })),
        staffPreview: venue.staffPreview,
        planName: null,
        statistics: await getVenueStatistics(venue.id),
        isAvailableForSwitch: venue.isAvailableForSwitch,
        venueStatus: venue.venueStatus,
        inactiveReason: venue.inactiveReason,
      })))
      activeVenue =
        venues.find((venue) => venue.id === venueContext.activeVenueId) ?? null
    }
  }

  if (user.accountType === AccountType.SUPPLIER_STAFF) {
    const supplierContext = await getUserSupplierContext(auth).catch(() => {
      errorsBySection.supplier = {
        code: 'SUPPLIER_CONTEXT_UNAVAILABLE',
        message: 'Supplier profile context is unavailable',
      }
      return null
    })

    if (supplierContext?.activeSupplier) {
      const supplier = supplierContext.activeSupplier
      plan = {
        planName: supplier.planName ?? null,
        planStatus: supplier.planStatus ?? null,
      }
      if (
        permissions.profileSections.promoBalance &&
        permissions.actions.canViewPromoBalance
      ) {
        promoBalance = supplier.promoBalance === null
          ? null
          : { amount: Number(supplier.promoBalance), currency: 'RUB' }
      }
      const statistics = await getSupplierStatistics(supplier.id)
      activeSupplier = {
        id: supplier.id,
        companyId: supplier.company?.id ?? supplier.id,
        companyName: supplier.catalogName || supplier.name,
        logoUrl: avatar?.url ?? null,
        avatarFileId: user.profile?.avatarFileId ?? null,
        role: readContext(homeContext)?.displayRole ?? null,
        membershipType: 'SUPPLIER_STAFF',
        phone: supplier.phone,
        email: supplier.email,
        address: supplier.address,
        city: supplier.city,
        description: supplier.description ?? null,
        showPhoneInCard: supplier.showPhoneInCard,
        mainPhotoFileId: supplier.mainPhotoFileId,
        photos: supplier.photos.map((photo) => ({
          id: photo.id,
          fileAssetId: photo.fileAssetId,
          storageKey: photo.storageKey,
          url: photo.storageKey,
          fileName: photo.fileName,
          mimeType: photo.mimeType,
        })),
        planName: supplier.planName ?? null,
        statistics,
      }
    }
  }

  return {
    ok: true,
    user: {
      id: user.id,
      accountType: user.accountType,
      fullName: homeContext.user.fullName,
      phone: user.phone ?? '',
      email: user.email,
      avatarFileId: user.profile?.avatarFileId ?? null,
      avatarUrl: avatar?.url ?? null,
    },
    context: normalizeBusinessContext(homeContext),
    permissions,
    navigation: homeContext.navigation,
    completion: completion
      ? {
          venue: mapProfileCompletionSummary(completion.venue),
          supplier: mapProfileCompletionSummary(completion.supplier),
        }
      : null,
    activeVenue,
    venues,
    activeSupplier,
    canUnsetDefault,
    notifications,
    tasks,
    latestNote,
    downloads: latestDownloads,
    supplierPriceStatus,
    promoBalance,
    plan,
    errorsBySection,
  }
}

