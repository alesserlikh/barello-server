import {
  AccountType,
  AccessLevel,
  MembershipStatus,
  UserStatus,
} from '../../generated/prisma'
import { prisma } from '../../lib/prisma'
import type { AuthPayload } from '../../middleware/auth'
import { getUserVenueContext } from '../venues/venue-context.service'
import { getUserSupplierContext } from '../suppliers/supplier-context.service'

type HomeSectionKey =
  | 'MAIN'
  | 'CATALOG'
  | 'MENU'
  | 'WAREHOUSE'
  | 'ORDERS'
  | 'INVENTORY'
  | 'STAFF'
  | 'TASKS'
  | 'NOTES'
  | 'CONTENT'
  | 'ANALYTICS'

type HomeSectionState = 'AVAILABLE' | 'SETUP_REQUIRED' | 'HIDDEN' | 'LOCKED'

type HomeSection = {
  key: HomeSectionKey
  state: HomeSectionState
}

type ProfileSectionPermissions = {
  downloads: boolean
  business: boolean
  notes: boolean
  tasks: boolean
  notifications: boolean
}

function buildProfileSectionPermissions(params: {
  accountType: AccountType
  accessLevel?: AccessLevel | null
}): ProfileSectionPermissions {
  if (params.accountType === AccountType.SUPPLIER_STAFF) {
    return {
      downloads: true,
      business: true,
      notes: true,
      tasks: true,
      notifications: true,
    }
  }

  if (params.accountType === AccountType.VENUE_STAFF) {
    const isAdmin = params.accessLevel === AccessLevel.ADMIN
    const isSenior = params.accessLevel === AccessLevel.SENIOR_STAFF

    return {
      downloads: isAdmin || isSenior,
      business: isAdmin,
      notes: true,
      tasks: true,
      notifications: true,
    }
  }

  return {
    downloads: false,
    business: false,
    notes: false,
    tasks: false,
    notifications: false,
  }
}

function buildHomeNavigation() {
  return {
    homeRoute: '/home',
  }
}

function unidentifiedSections(): HomeSection[] {
  return [
    { key: 'CATALOG', state: 'AVAILABLE' },
    { key: 'NOTES', state: 'AVAILABLE' },
    { key: 'CONTENT', state: 'AVAILABLE' },
  ]
}

function venueAdminSections(): HomeSection[] {
  return [
    { key: 'MAIN', state: 'AVAILABLE' },
    { key: 'CATALOG', state: 'AVAILABLE' },
    { key: 'MENU', state: 'SETUP_REQUIRED' },
    { key: 'WAREHOUSE', state: 'SETUP_REQUIRED' },
    { key: 'ORDERS', state: 'AVAILABLE' },
    { key: 'INVENTORY', state: 'SETUP_REQUIRED' },
    { key: 'STAFF', state: 'AVAILABLE' },
    { key: 'TASKS', state: 'AVAILABLE' },
    { key: 'ANALYTICS', state: 'SETUP_REQUIRED' },
  ]
}

function venueSeniorSections(): HomeSection[] {
  return [
    { key: 'MAIN', state: 'AVAILABLE' },
    { key: 'CATALOG', state: 'AVAILABLE' },
    { key: 'MENU', state: 'SETUP_REQUIRED' },
    { key: 'WAREHOUSE', state: 'SETUP_REQUIRED' },
    { key: 'ORDERS', state: 'AVAILABLE' },
    { key: 'INVENTORY', state: 'SETUP_REQUIRED' },
    { key: 'TASKS', state: 'AVAILABLE' },
  ]
}

function venueLineSections(): HomeSection[] {
  return [
    { key: 'MAIN', state: 'AVAILABLE' },
    { key: 'CATALOG', state: 'AVAILABLE' },
    { key: 'MENU', state: 'SETUP_REQUIRED' },
    { key: 'TASKS', state: 'AVAILABLE' },
    { key: 'NOTES', state: 'AVAILABLE' },
  ]
}

function supplierAdminSections(): HomeSection[] {
  return [
    { key: 'MAIN', state: 'AVAILABLE' },
    { key: 'CATALOG', state: 'AVAILABLE' },
    { key: 'ORDERS', state: 'SETUP_REQUIRED' },
    { key: 'CONTENT', state: 'AVAILABLE' },
    { key: 'ANALYTICS', state: 'SETUP_REQUIRED' },
  ]
}

export async function getHomeContext(auth: AuthPayload) {
  if (auth.type !== 'user') {
    throw new Error('Only user principals are supported for home context')
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    include: {
      profile: true,
      memberships: {
        where: {
          membershipStatus: {
            in: [MembershipStatus.ACTIVE, MembershipStatus.PENDING],
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      },
      supplierMemberships: {
        where: {
          status: {
            in: [MembershipStatus.ACTIVE, MembershipStatus.PENDING],
          },
        },
        include: {
          supplier: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
  })

  if (!user) {
    throw new Error('User not found')
  }

  if (user.memberships.length > 0 && user.supplierMemberships.length > 0) {
    console.warn('[HomeContext] User has mixed account memberships', {
      userId: user.id,
      accountType: user.accountType,
      venueMembershipsCount: user.memberships.length,
      supplierMembershipsCount: user.supplierMemberships.length,
    })
  }

  if (user.status === UserStatus.UNIDENTIFIED || user.accountType === AccountType.UNIDENTIFIED) {
    return {
      user: {
        id: user.id,
        publicId: user.publicId,
        status: user.status,
        accountType: user.accountType,
        fullName: [user.profile?.lastName, user.profile?.firstName, user.profile?.middleName]
          .filter(Boolean)
          .join(' '),
      },
      permissions: {
        profileSections: buildProfileSectionPermissions({
          accountType: user.accountType,
        }),
      },
      navigation: buildHomeNavigation(),
      sections: unidentifiedSections(),
      notice: 'Complete company confirmation to unlock the full workspace.',
    }
  }

  if (user.accountType === AccountType.VENUE_STAFF) {
    const venueContext = await getUserVenueContext(user.id)
    const activeVenue = venueContext.activeVenue

    if (!activeVenue) {
      return {
        user: {
          id: user.id,
          publicId: user.publicId,
          status: user.status,
          accountType: user.accountType,
          fullName: [user.profile?.lastName, user.profile?.firstName, user.profile?.middleName]
            .filter(Boolean)
            .join(' '),
        },
        permissions: {
          profileSections: buildProfileSectionPermissions({
            accountType: user.accountType,
          }),
        },
        navigation: buildHomeNavigation(),
        sections: unidentifiedSections(),
        notice: 'Venue membership is not active yet.',
      }
    }

    const sections =
      activeVenue.membership.accessLevel === AccessLevel.ADMIN
        ? venueAdminSections()
        : activeVenue.membership.accessLevel === AccessLevel.SENIOR_STAFF
          ? venueSeniorSections()
          : venueLineSections()

    return {
      user: {
        id: user.id,
        publicId: user.publicId,
        status: user.status,
        accountType: user.accountType,
        fullName: [user.profile?.lastName, user.profile?.firstName, user.profile?.middleName]
          .filter(Boolean)
          .join(' '),
      },
      context: {
        type: 'VENUE',
        venueId: activeVenue.id,
        venuePublicId: activeVenue.publicId,
        venueName: activeVenue.name,
        venueCity: activeVenue.city,
        accessLevel: activeVenue.membership.accessLevel,
        displayRole: activeVenue.membership.displayRole,
        ownerStatus: activeVenue.ownerStatus,
        activeVenueId: venueContext.activeVenueId,
        defaultVenueId: venueContext.defaultVenueId,
        activeVenueSource: venueContext.activeVenueSource,
      },
      permissions: {
        profileSections: buildProfileSectionPermissions({
          accountType: user.accountType,
          accessLevel: activeVenue.membership.accessLevel,
        }),
      },
      navigation: buildHomeNavigation(),
      sections,
    }
  }

  if (user.accountType === AccountType.SUPPLIER_STAFF) {
    const supplierContext = await getUserSupplierContext(auth)
    const activeSupplier = supplierContext.activeSupplier

    if (!activeSupplier) {
      return {
        user: {
          id: user.id,
          publicId: user.publicId,
          status: user.status,
          accountType: user.accountType,
          fullName: [user.profile?.lastName, user.profile?.firstName, user.profile?.middleName]
            .filter(Boolean)
            .join(' '),
        },
        permissions: {
          profileSections: buildProfileSectionPermissions({
            accountType: user.accountType,
          }),
        },
        navigation: buildHomeNavigation(),
        sections: unidentifiedSections(),
        notice: 'Supplier membership is not active yet.',
      }
    }

    return {
      user: {
        id: user.id,
        publicId: user.publicId,
        status: user.status,
        accountType: user.accountType,
        fullName: [user.profile?.lastName, user.profile?.firstName, user.profile?.middleName]
          .filter(Boolean)
          .join(' '),
      },
      context: {
        type: 'SUPPLIER',
        supplierId: activeSupplier.id,
        supplierPublicId: activeSupplier.publicId,
        supplierName: activeSupplier.name,
        supplierCity: activeSupplier.city,
        company: activeSupplier.company,
        accessLevel: activeSupplier.membership.accessLevel,
        displayRole: activeSupplier.membership.displayRole,
        membershipType: AccountType.SUPPLIER_STAFF,
      },
      permissions: {
        profileSections: buildProfileSectionPermissions({
          accountType: user.accountType,
          accessLevel: activeSupplier.membership.accessLevel,
        }),
      },
      navigation: buildHomeNavigation(),
      sections: supplierAdminSections(),
    }
  }

  return {
    user: {
      id: user.id,
      publicId: user.publicId,
      status: user.status,
      accountType: user.accountType,
      fullName: [user.profile?.lastName, user.profile?.firstName, user.profile?.middleName]
        .filter(Boolean)
        .join(' '),
    },
    permissions: {
      profileSections: buildProfileSectionPermissions({
        accountType: user.accountType,
      }),
    },
    navigation: buildHomeNavigation(),
    sections: unidentifiedSections(),
  }
}
