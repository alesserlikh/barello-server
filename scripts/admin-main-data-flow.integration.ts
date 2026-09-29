import assert from 'assert'
import { randomUUID } from 'crypto'

import {
  AccessLevel,
  AccountType,
  CatalogCategorySection,
  DisplayRole,
  FileAssetType,
  MembershipStatus,
  UserAdminGroup,
  UserStatus,
  VenueStatus,
} from '../src/generated/prisma'
import { prisma } from '../src/lib/prisma'
import type { AuthPayload } from '../src/middleware/auth'
import { buildFileAssetUrl } from '../src/modules/profile/profile-media.service'
import {
  updateModerationCatalogCategory,
  updateModerationMembershipRole,
  updateModerationMembershipStatus,
  updateModerationSupplier,
  updateModerationUserProfile,
  updateModerationVenueBusiness,
  updateModerationVenueDetail,
  updateModerationVenueStatus,
} from '../src/modules/moderation/moderation.service'
import { getAllCategories, getCategoryFilters } from '../src/modules/products/categories.service'
import { getProfileMobileContext } from '../src/modules/profile/profile-mobile-context.service'
import { getVenueProfile } from '../src/modules/profile/venue-profile.service'
import { getUserSupplierContext } from '../src/modules/suppliers/supplier-context.service'
import { getUserVenueContext } from '../src/modules/venues/venue-context.service'

const TEST_PREFIX = 'admin-main-data-flow'
const TEST_PHONE_PREFIX = '+7904'

function createPhone() {
  return `${TEST_PHONE_PREFIX}${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`
}

function createValidInn() {
  const firstNine = `77${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`
  const digits = [...firstNine].map(Number)
  const coefficients = [2, 4, 10, 3, 5, 9, 4, 6, 8]
  const checksum =
    coefficients.reduce((sum, coefficient, index) => sum + coefficient * digits[index], 0) %
    11 %
    10

  return `${firstNine}${checksum}`
}

function auth(userId: string): AuthPayload {
  return {
    type: 'user',
    userId,
    sessionId: randomUUID(),
  }
}

async function cleanup() {
  const suppliers = await prisma.supplier.findMany({
    where: {
      OR: [
        { name: { startsWith: TEST_PREFIX } },
        { catalogName: { startsWith: TEST_PREFIX } },
      ],
    },
    select: {
      id: true,
      businessId: true,
    },
  })
  const venues = await prisma.venue.findMany({
    where: { name: { startsWith: TEST_PREFIX } },
    select: {
      id: true,
      businessId: true,
    },
  })
  const businessIds = [
    ...suppliers.flatMap((supplier) => (supplier.businessId ? [supplier.businessId] : [])),
    ...venues.map((venue) => venue.businessId),
  ]

  await prisma.catalogCategory.deleteMany({
    where: { name: { startsWith: TEST_PREFIX } },
  })
  await prisma.supplier.deleteMany({
    where: { id: { in: suppliers.map((supplier) => supplier.id) } },
  })
  await prisma.venue.deleteMany({
    where: { id: { in: venues.map((venue) => venue.id) } },
  })
  await prisma.business.deleteMany({
    where: {
      OR: [
        { id: { in: businessIds } },
        { name: { startsWith: TEST_PREFIX } },
      ],
    },
  })
  await prisma.user.deleteMany({
    where: { phone: { startsWith: TEST_PHONE_PREFIX } },
  })
  await prisma.fileAsset.deleteMany({
    where: { storageKey: { startsWith: `${TEST_PREFIX}/` } },
  })
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { action: 'MODERATION_SUPPLIER_UPDATED' },
        { action: { startsWith: TEST_PREFIX } },
      ],
    },
  }).catch(() => undefined)
}

async function createVenueFixture() {
  const business = await prisma.business.create({
    data: {
      name: `${TEST_PREFIX}-venue-business-${randomUUID()}`,
      taxNumber: createValidInn(),
      legalAddress: 'Initial legal address',
    },
  })
  const venue = await prisma.venue.create({
    data: {
      businessId: business.id,
      name: `${TEST_PREFIX}-venue-${randomUUID()}`,
      city: 'Initial city',
      address: 'Initial address',
      phone: createPhone(),
      email: `${randomUUID()}@venue.test`,
      website: 'https://initial.example.test',
      description: 'Initial description',
      showPhoneInCard: false,
      venueStatus: VenueStatus.ACTIVE,
      isActive: true,
    },
  })
  const user = await prisma.user.create({
    data: {
      phone: createPhone(),
      email: `${randomUUID()}@user.test`,
      emailVerifiedAt: new Date(),
      status: UserStatus.ACTIVE,
      adminGroup: UserAdminGroup.TEST,
      accountType: AccountType.VENUE_STAFF,
      activeVenueId: venue.id,
      defaultVenueId: venue.id,
      profile: {
        create: {
          firstName: 'Initial',
          lastName: 'User',
        },
      },
      memberships: {
        create: {
          venueId: venue.id,
          displayRole: DisplayRole.BARTENDER,
          accessLevel: AccessLevel.LINE_STAFF,
          membershipStatus: MembershipStatus.ACTIVE,
          joinedAt: new Date(),
        },
      },
    },
    include: {
      memberships: true,
    },
  })
  const avatar = await prisma.fileAsset.create({
    data: {
      storageKey: `${TEST_PREFIX}/avatars/${randomUUID()}.jpg`,
      fileName: 'avatar.jpg',
      mimeType: 'image/jpeg',
      fileSize: 1024,
      type: FileAssetType.IMAGE,
      uploadedByUserId: user.id,
    },
  })
  await prisma.userProfile.update({
    where: { userId: user.id },
    data: { avatarFileId: avatar.id },
  })

  return {
    business,
    venue,
    user,
    membership: user.memberships[0],
    avatar,
  }
}

async function createSupplierFixture() {
  const business = await prisma.business.create({
    data: {
      name: `${TEST_PREFIX}-supplier-business-${randomUUID()}`,
      taxNumber: createValidInn(),
      legalAddress: 'Supplier initial legal address',
    },
  })
  const supplier = await prisma.supplier.create({
    data: {
      businessId: business.id,
      name: `${TEST_PREFIX}-supplier-${randomUUID()}`,
      catalogName: `${TEST_PREFIX}-catalog-initial`,
      city: 'Supplier initial city',
      address: 'Supplier initial address',
      phone: createPhone(),
      isActive: true,
    },
  })
  const user = await prisma.user.create({
    data: {
      phone: createPhone(),
      email: `${randomUUID()}@supplier-user.test`,
      status: UserStatus.ACTIVE,
      adminGroup: UserAdminGroup.TEST,
      accountType: AccountType.SUPPLIER_STAFF,
      profile: {
        create: {
          firstName: 'Supplier',
          lastName: 'Owner',
        },
      },
      supplierMemberships: {
        create: {
          supplierId: supplier.id,
          displayRole: 'OWNER',
          accessLevel: AccessLevel.ADMIN,
          status: MembershipStatus.ACTIVE,
          joinedAt: new Date(),
        },
      },
    },
  })

  return {
    business,
    supplier,
    user,
  }
}

async function testVenueUserAndMembershipFlow() {
  const fixture = await createVenueFixture()
  const nextPhone = createPhone()

  await updateModerationUserProfile(fixture.user.id, {
    firstName: 'Updated',
    lastName: 'Person',
    middleName: 'Admin',
    phone: nextPhone,
  })
  await updateModerationVenueDetail(fixture.venue.id, {
    name: `${TEST_PREFIX}-venue-updated`,
    city: 'Updated city',
    address: 'Updated address',
    phone: createPhone(),
    email: 'venue-updated@example.test',
    website: 'https://updated.example.test',
    description: 'Updated description',
    showPhoneInCard: true,
  })
  await updateModerationVenueBusiness(fixture.venue.id, {
    name: `${TEST_PREFIX}-venue-business-updated`,
    taxNumber: createValidInn(),
    legalAddress: 'Updated legal address',
  })
  await updateModerationMembershipRole(fixture.membership.id, DisplayRole.OWNER)

  const venueContext = await getUserVenueContext(fixture.user.id)
  assert.strictEqual(venueContext.activeVenue?.name, `${TEST_PREFIX}-venue-updated`)
  assert.strictEqual(venueContext.activeVenue?.city, 'Updated city')
  assert.strictEqual(venueContext.activeVenue?.address, 'Updated address')
  assert.strictEqual(venueContext.activeVenue?.showPhoneInCard, true)
  assert.strictEqual(venueContext.activeVenue?.membership.displayRole, DisplayRole.OWNER)
  assert.strictEqual(venueContext.activeVenue?.membership.accessLevel, AccessLevel.ADMIN)
  assert.strictEqual(venueContext.activeVenue?.currentUser.avatarFileId, fixture.avatar.id)
  assert.strictEqual(
    venueContext.activeVenue?.currentUser.avatarUrl,
    buildFileAssetUrl(fixture.avatar.storageKey)
  )

  const mobileContext = await getProfileMobileContext(auth(fixture.user.id))
  assert.strictEqual(mobileContext.user.fullName, 'Person Updated Admin')
  assert.strictEqual(mobileContext.user.phone, nextPhone)
  assert.strictEqual(mobileContext.activeVenue?.name, `${TEST_PREFIX}-venue-updated`)
  assert.strictEqual(mobileContext.activeVenue?.role, DisplayRole.OWNER)
  assert.strictEqual(mobileContext.activeVenue?.accessLevel, AccessLevel.ADMIN)
  assert.strictEqual(mobileContext.activeVenue?.avatarFileId, fixture.avatar.id)
  assert.strictEqual(
    mobileContext.activeVenue?.avatarUrl,
    buildFileAssetUrl(fixture.avatar.storageKey)
  )

  const venueProfile = await getVenueProfile(auth(fixture.user.id), fixture.venue.id)
  assert.strictEqual(venueProfile.name, `${TEST_PREFIX}-venue-updated`)
  assert.strictEqual(venueProfile.email, 'venue-updated@example.test')
  assert.strictEqual(venueProfile.description, 'Updated description')
  assert.strictEqual(venueProfile.showPhoneInCard, true)

  await updateModerationVenueStatus(fixture.venue.id, VenueStatus.BLOCKED)
  const blockedContext = await getUserVenueContext(fixture.user.id)
  assert.strictEqual(blockedContext.activeVenue?.venueStatus, VenueStatus.BLOCKED)
  assert.strictEqual(blockedContext.activeVenue?.isAvailableForSwitch, false)
  assert.strictEqual(blockedContext.activeVenue?.inactiveReason, VenueStatus.BLOCKED)
  assert.strictEqual(blockedContext.dropdownVenues.length, 0)

  await updateModerationVenueStatus(fixture.venue.id, VenueStatus.ACTIVE)
  await updateModerationMembershipStatus(fixture.membership.id, MembershipStatus.REVOKED)
  const revokedContext = await getUserVenueContext(fixture.user.id)
  assert.strictEqual(revokedContext.activeVenue, null)

  await updateModerationMembershipStatus(fixture.membership.id, MembershipStatus.ACTIVE)
  const restoredContext = await getUserVenueContext(fixture.user.id)
  assert.strictEqual(restoredContext.activeVenue?.membership.status, MembershipStatus.ACTIVE)
}

async function testSupplierCompanyFlow() {
  const fixture = await createSupplierFixture()
  const updatedInn = createValidInn()

  await updateModerationSupplier(fixture.supplier.id, {
    inn: updatedInn,
    companyName: `${TEST_PREFIX}-supplier-business-updated`,
    catalogName: `${TEST_PREFIX}-catalog-updated`,
    ownerFullName: 'Supplier Updated Owner',
    ownerPhone: fixture.user.phone!,
    companyPhone: createPhone(),
    city: 'Supplier updated city',
    address: 'Supplier updated address',
  })

  const supplierContext = await getUserSupplierContext(auth(fixture.user.id))
  assert.strictEqual(supplierContext.activeSupplier?.name, `${TEST_PREFIX}-supplier-business-updated`)
  assert.strictEqual(supplierContext.activeSupplier?.catalogName, `${TEST_PREFIX}-catalog-updated`)
  assert.strictEqual(supplierContext.activeSupplier?.city, 'Supplier updated city')
  assert.strictEqual(supplierContext.activeSupplier?.address, 'Supplier updated address')
  assert.strictEqual(supplierContext.activeSupplier?.company?.name, `${TEST_PREFIX}-supplier-business-updated`)
  assert.strictEqual(supplierContext.activeSupplier?.company?.taxNumber, updatedInn)
  assert.strictEqual(supplierContext.dropdownSuppliers[0]?.name, `${TEST_PREFIX}-catalog-updated`)

  const mobileContext = await getProfileMobileContext(auth(fixture.user.id))
  assert.strictEqual(mobileContext.activeSupplier?.companyName, `${TEST_PREFIX}-catalog-updated`)
  assert.strictEqual(mobileContext.activeSupplier?.city, 'Supplier updated city')
  assert.strictEqual(mobileContext.activeSupplier?.address, 'Supplier updated address')
}

async function testCatalogCategoriesAndFiltersFlow() {
  const category = await prisma.catalogCategory.create({
    data: {
      name: `${TEST_PREFIX}-category-initial-${randomUUID()}`,
      code: `${TEST_PREFIX}-initial`,
      section: CatalogCategorySection.ALCOHOL,
      sortOrder: 10,
      isTagActive: true,
      showInQuickFilters: true,
      isHidden: false,
    },
  })

  const updatedCategory = await updateModerationCatalogCategory(category.id, {
    name: `${TEST_PREFIX}-category-updated`,
    code: `${TEST_PREFIX}-updated`,
    section: CatalogCategorySection.DRINKS_FOOD,
    sortOrder: 20,
    isTagActive: true,
    showInQuickFilters: true,
    isHidden: false,
  })

  assert.strictEqual(updatedCategory.name, `${TEST_PREFIX}-category-updated`)

  const categories = await getAllCategories({ includeProductsCount: false })
  assert.ok(
    categories.some((item) => item.id === category.id && item.name === `${TEST_PREFIX}-category-updated`),
    'updated category must be visible in public categories'
  )

  const filters = await getCategoryFilters()
  assert.ok(
    filters.categories.some((item) => item.id === category.id && item.name === `${TEST_PREFIX}-category-updated`),
    'updated category must be visible in public filters'
  )

  await updateModerationCatalogCategory(category.id, {
    isHidden: true,
  })

  const hiddenCategories = await getAllCategories({ includeProductsCount: false })
  assert.ok(
    !hiddenCategories.some((item) => item.id === category.id),
    'hidden category must not be visible in public categories'
  )

  const hiddenFilters = await getCategoryFilters()
  assert.ok(
    !hiddenFilters.categories.some((item) => item.id === category.id),
    'hidden category must not be visible in public filters'
  )
}

async function main() {
  await cleanup()

  try {
    await testVenueUserAndMembershipFlow()
    await testSupplierCompanyFlow()
    await testCatalogCategoriesAndFiltersFlow()
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }

  console.info('[admin-main-data-flow] all checks passed')
}

main().catch(async (error) => {
  console.error('[admin-main-data-flow] failed:', error)
  await prisma.$disconnect()
  process.exit(1)
})
