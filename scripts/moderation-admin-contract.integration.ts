import assert from 'assert'
import { randomUUID } from 'crypto'
import fs from 'fs/promises'
import type { AddressInfo } from 'net'
import os from 'os'
import path from 'path'
import jwt from 'jsonwebtoken'

import app from '../src/app'
import { env } from '../src/config/env'
import {
  AccessLevel,
  AccountType,
  AuditActorType,
  DisplayRole,
  FacetLevel,
  FacetOptionSource,
  FacetScope,
  FacetType,
  FileAssetType,
  MembershipStatus,
  ProductCatalogStatus,
  UserAdminGroup,
  UserStatus,
} from '../src/generated/prisma'
import { prisma } from '../src/lib/prisma'
import { importModerationSupplierPrice } from '../src/modules/moderation/moderation.service'

const TEST_PREFIX = 'moderation-admin-contract'
const FACET_TEST_PREFIX = 'moderation_admin_contract'
const TEST_PHONE_PREFIX = '+7903'

type JsonResponse = { status: number; json: any }

function randomPhone() {
  return `${TEST_PHONE_PREFIX}${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`
}

function createValidInn() {
  const firstNine = `77${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`
  const digits = [...firstNine].map(Number)
  const coefficients = [2, 4, 10, 3, 5, 9, 4, 6, 8]
  const checksum = coefficients.reduce(
    (sum, coefficient, index) => sum + coefficient * digits[index],
    0
  ) % 11 % 10
  return `${firstNine}${checksum}`
}

function assertExactKeys(value: unknown, expected: string[], label: string) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`)
  assert.deepStrictEqual(
    Object.keys(value as Record<string, unknown>).sort(),
    [...expected].sort(),
    `${label} keys changed`
  )
}

function assertNullableString(value: unknown, label: string) {
  assert.ok(value === null || typeof value === 'string', `${label} must be string|null`)
}

async function fetchJson(
  baseUrl: string,
  token: string,
  requestPath: string,
  options?: RequestInit
): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${requestPath}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options?.body && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(options?.headers ?? {}),
    },
  })
  const text = await response.text()
  return { status: response.status, json: text ? JSON.parse(text) : null }
}

function assertError(response: JsonResponse, status: number) {
  assert.strictEqual(response.status, status)
  const keys = Object.keys(response.json).sort()
  assert.ok(
    JSON.stringify(keys) === JSON.stringify(['error']) ||
      JSON.stringify(keys) === JSON.stringify(['error', 'ok']),
    `${status} response keys changed`
  )
  if ('ok' in response.json) {
    assert.strictEqual(response.json.ok, false)
  }
  if (typeof response.json.error === 'string') {
    return
  }
  assertExactKeys(response.json.error, ['code', 'message', 'details'], `${status} error`)
  assert.strictEqual(typeof response.json.error.code, 'string')
  assert.strictEqual(typeof response.json.error.message, 'string')
}

async function cleanup() {
  const suppliers = await prisma.supplier.findMany({
    where: { name: { startsWith: TEST_PREFIX } },
    select: { id: true, businessId: true },
  })
  await prisma.supplier.deleteMany({ where: { id: { in: suppliers.map((item) => item.id) } } })
  await prisma.business.deleteMany({
    where: {
      OR: [
        { name: { startsWith: TEST_PREFIX } },
        { id: { in: suppliers.flatMap((item) => item.businessId ? [item.businessId] : []) } },
      ],
    },
  })
  await prisma.user.deleteMany({ where: { phone: { startsWith: TEST_PHONE_PREFIX } } })
  await prisma.fileAsset.deleteMany({ where: { storageKey: { startsWith: TEST_PREFIX } } })
  await prisma.auditLog.deleteMany({ where: { action: { startsWith: TEST_PREFIX } } })
  await prisma.facetRegistryEntry.deleteMany({ where: { key: { startsWith: FACET_TEST_PREFIX } } })
  await prisma.product.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } })
}

async function createCardFixture() {
  const business = await prisma.business.create({
    data: {
      name: `${TEST_PREFIX}-business-${randomUUID()}`,
      taxNumber: createValidInn(),
      legalAddress: 'Contract street, 1',
    },
  })
  const venue = await prisma.venue.create({
    data: {
      businessId: business.id,
      name: `${TEST_PREFIX}-venue`,
      city: 'Moscow',
      address: 'Contract street, 1',
      phone: randomPhone(),
      email: `${randomUUID()}@contract.test`,
      seatsCount: 42,
    },
  })
  const user = await prisma.user.create({
    data: {
      phone: randomPhone(),
      email: `${randomUUID()}@contract.test`,
      status: UserStatus.ACTIVE,
      adminGroup: UserAdminGroup.TEST,
      accountType: AccountType.VENUE_STAFF,
      profile: {
        create: { firstName: 'Contract', lastName: TEST_PREFIX },
      },
      memberships: {
        create: {
          venueId: venue.id,
          displayRole: DisplayRole.ADMINISTRATOR,
          accessLevel: AccessLevel.ADMIN,
          membershipStatus: MembershipStatus.ACTIVE,
          joinedAt: new Date(),
        },
      },
    },
  })

  return { business, venue, user }
}

function assertUserListItem(user: any) {
  assertExactKeys(user, [
    'id', 'publicId', 'tableId', 'fullName', 'displayName', 'profile', 'phone',
    'email', 'emailVerifiedAt', 'accountType', 'status', 'role', 'adminGroup',
    'registrationAccountGroup', 'membershipsCount', 'venuesCount',
    'venueMembershipsCount', 'supplierMembershipsCount', 'linkedVenues',
    'linkedSuppliers', 'lastLoginAt', 'createdAt',
  ], 'user list item')
  assert.strictEqual(typeof user.id, 'string')
  assert.strictEqual(typeof user.publicId, 'string')
  assert.strictEqual(user.tableId, user.publicId)
  assert.strictEqual(user.fullName, `${TEST_PREFIX} Contract`)
  assert.strictEqual(user.displayName, user.fullName)
  assert.notStrictEqual(user.displayName, user.phone)
  assert.strictEqual(user.accountType, 'VENUE_STAFF')
  assert.strictEqual(user.registrationAccountGroup, 'VENUE')
  assert.strictEqual(user.role, 'TEST')
  assert.strictEqual(user.adminGroup, 'TEST')
  assert.strictEqual(user.venuesCount, 1)
  assert.ok(Array.isArray(user.linkedVenues))
  assert.ok(Array.isArray(user.linkedSuppliers))
}

function assertUserDetail(detail: any) {
  assertExactKeys(detail, ['user', 'memberships', 'supplierMemberships', 'sessions', 'auditLog'], 'user detail')
  assertExactKeys(detail.user, [
    'id', 'publicId', 'profile', 'phone', 'email', 'emailVerifiedAt',
    'emailVerification', 'status', 'adminGroup', 'registrationAccountGroup', 'membershipsCount',
    'venueMembershipsCount', 'supplierMembershipsCount', 'lastLoginAt',
    'createdAt', 'updatedAt',
  ], 'user detail.user')
  assertExactKeys(detail.user.emailVerification, [
    'status', 'email', 'emailVerifiedAt', 'pendingEmail', 'pendingEmailExpiresAt',
  ], 'user detail.user.emailVerification')
  assert.ok(['MISSING', 'VERIFIED', 'PENDING', 'UNVERIFIED'].includes(detail.user.emailVerification.status))
  assert.ok(Array.isArray(detail.memberships))
  assert.ok(Array.isArray(detail.supplierMemberships))
  assert.ok(Array.isArray(detail.sessions))
  assert.ok(Array.isArray(detail.auditLog))
  assertExactKeys(detail.memberships[0], [
    'id', 'userId', 'venueId', 'venue', 'displayRole', 'accessLevel',
    'membershipStatus', 'joinedAt', 'confirmedByUserId', 'confirmedBy',
    'createdAt', 'updatedAt',
  ], 'user membership')
}

function assertVenueDetail(detail: any) {
  assertExactKeys(detail, [
    'venue', 'memberships', 'photos', 'cuisineTypes', 'orderHistory',
    'uploadedFiles', 'inventorySessions', 'currentInventorySession', 'counts',
  ], 'venue detail')
  assertExactKeys(detail.venue, [
    'id', 'publicId', 'businessId', 'business', 'name', 'city', 'address',
    'latitude', 'longitude', 'phone', 'email', 'website', 'contactPersonName',
    'seatsCount', 'description', 'venueType', 'mainPhotoFileId', 'showPhoneInCard',
    'showAdminContactsToSuppliers', 'ownerId', 'ownerPublicId', 'ownerDisplayId',
    'ownerStatus', 'venueStatus', 'isActive',
    'createdAt', 'updatedAt',
  ], 'venue detail.venue')
  assertExactKeys(detail.counts, [
    'tasks', 'notes', 'carts', 'orderBatches', 'supplierOrders', 'inventoryItems', 'menuItems',
  ], 'venue detail.counts')
  assert.ok(Array.isArray(detail.memberships))
  assert.ok(Array.isArray(detail.photos))
  assert.ok(Array.isArray(detail.orderHistory))
  assert.ok(Array.isArray(detail.uploadedFiles))
  assert.ok(Array.isArray(detail.inventorySessions))
  assertExactKeys(detail.memberships[0], [
    'id', 'userId', 'user', 'displayRole', 'accessLevel', 'membershipStatus',
    'joinedAt', 'confirmedByUserId', 'confirmedBy', 'createdAt', 'updatedAt',
  ], 'venue membership')
}

function assertMembershipListItem(membership: any, accessLevel = 'ADMIN') {
  assertExactKeys(membership, [
    'id', 'publicId', 'tableId', 'userId', 'userPublicId', 'userName', 'user',
    'venueId', 'venuePublicId', 'venueName', 'venue', 'displayRole', 'role',
    'accessLevel', 'membershipStatus', 'joinedAt', 'loginAt', 'confirmedBy',
    'confirmedByName', 'createdAt',
  ], 'membership list item')
  assert.strictEqual(membership.membershipStatus, 'ACTIVE')
  assert.strictEqual(membership.accessLevel, accessLevel)
  assert.ok(!('status' in membership), 'membership list item must not expose top-level status')
  assert.strictEqual(membership.user.status, 'ACTIVE')
}

function assertBusinessDetail(detail: any) {
  assertExactKeys(detail, [
    'business', 'venues', 'supplier', 'registrationDrafts',
    'companyModerationRequests', 'counts',
  ], 'business detail')
  assertExactKeys(detail.business, [
    'id', 'name', 'taxNumber', 'legalAddress', 'createdAt', 'updatedAt',
  ], 'business detail.business')
  assert.ok(Array.isArray(detail.venues))
  assertExactKeys(detail.venues[0], [
    'id', 'businessId', 'name', 'city', 'address', 'contactPersonName', 'phone',
    'email', 'seatsCount', 'ownerStatus', 'venueStatus', 'isActive',
    'employeesCount', 'createdAt', 'updatedAt',
  ], 'business venue')
  assert.strictEqual(detail.supplier, null)
}

async function testCardsAndFilters(baseUrl: string, token: string) {
  const fixture = await createCardFixture()

  const filtered = await fetchJson(
    baseUrl,
    token,
    '/moderation/users?accountGroup=VENUE&adminGroup=TEST'
  )
  assert.strictEqual(filtered.status, 200)
  assert.ok(Array.isArray(filtered.json))
  const userListItem = filtered.json.find((item: any) => item.id === fixture.user.id)
  assert.ok(userListItem)
  assertUserListItem(userListItem)

  const excluded = await fetchJson(
    baseUrl,
    token,
    '/moderation/users?accountGroup=SUPPLIER&adminGroup=TEST'
  )
  assert.strictEqual(excluded.status, 200)
  assert.ok(!excluded.json.some((item: any) => item.id === fixture.user.id))

  assertError(
    await fetchJson(baseUrl, token, '/moderation/users?accountGroup=UNKNOWN'),
    400
  )

  const userDetail = await fetchJson(baseUrl, token, `/moderation/users/${fixture.user.id}`)
  assert.strictEqual(userDetail.status, 200)
  assertUserDetail(userDetail.json)

  const venueDetail = await fetchJson(baseUrl, token, `/moderation/venues/${fixture.venue.id}`)
  assert.strictEqual(venueDetail.status, 200)
  assertVenueDetail(venueDetail.json)

  const venueUpdate = await fetchJson(
    baseUrl,
    token,
    `/moderation/venues/${fixture.venue.id}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        name: `${TEST_PREFIX}-venue-updated`,
        showPhoneInCard: true,
      }),
    }
  )
  assert.strictEqual(venueUpdate.status, 200)
  assertExactKeys(venueUpdate.json, ['ok', 'venueDetail'], 'venue update response')
  assert.strictEqual(venueUpdate.json.ok, true)
  assertVenueDetail(venueUpdate.json.venueDetail)
  assert.strictEqual(venueUpdate.json.venueDetail.venue.name, `${TEST_PREFIX}-venue-updated`)
  assert.strictEqual(venueUpdate.json.venueDetail.venue.showPhoneInCard, true)

  const businessUpdate = await fetchJson(
    baseUrl,
    token,
    `/moderation/venues/${fixture.venue.id}/business`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        name: `${TEST_PREFIX}-business-updated`,
        legalAddress: 'Updated contract street, 2',
      }),
    }
  )
  assert.strictEqual(businessUpdate.status, 200)
  assertExactKeys(businessUpdate.json, ['ok', 'venueDetail'], 'venue business update response')
  assert.strictEqual(businessUpdate.json.ok, true)
  assertVenueDetail(businessUpdate.json.venueDetail)
  assert.strictEqual(businessUpdate.json.venueDetail.venue.business.name, `${TEST_PREFIX}-business-updated`)
  assert.strictEqual(businessUpdate.json.venueDetail.venue.business.legalAddress, 'Updated contract street, 2')

  const venueStatusUpdate = await fetchJson(
    baseUrl,
    token,
    `/moderation/venues/${fixture.venue.id}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ venueStatus: 'BLOCKED' }),
    }
  )
  assert.strictEqual(venueStatusUpdate.status, 200)
  assertExactKeys(venueStatusUpdate.json, ['ok', 'venueDetail'], 'venue status update response')
  assert.strictEqual(venueStatusUpdate.json.ok, true)
  assertVenueDetail(venueStatusUpdate.json.venueDetail)
  assert.strictEqual(venueStatusUpdate.json.venueDetail.venue.venueStatus, 'BLOCKED')
  assert.strictEqual(venueStatusUpdate.json.venueDetail.venue.isActive, false)

  assertError(
    await fetchJson(
      baseUrl,
      token,
      `/moderation/venues/${fixture.venue.id}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify({ venueStatus: 'DELETED' }),
      }
    ),
    400
  )

  await fetchJson(
    baseUrl,
    token,
    `/moderation/venues/${fixture.venue.id}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ venueStatus: 'ACTIVE' }),
    }
  )

  const memberships = await fetchJson(baseUrl, token, '/moderation/memberships')
  assert.strictEqual(memberships.status, 200)
  assert.ok(Array.isArray(memberships.json))
  const membershipListItem = memberships.json.find(
    (item: any) => item.userId === fixture.user.id && item.venueId === fixture.venue.id
  )
  assert.ok(membershipListItem)
  assertMembershipListItem(membershipListItem)

  const accessLevelUpdate = await fetchJson(
    baseUrl,
    token,
    `/moderation/memberships/${membershipListItem.id}/access-level`,
    {
      method: 'PATCH',
      body: JSON.stringify({ accessLevel: 'SENIOR_STAFF' }),
    }
  )
  assert.strictEqual(accessLevelUpdate.status, 200)
  assertExactKeys(accessLevelUpdate.json, ['ok', 'membership'], 'access level update response')
  assert.strictEqual(accessLevelUpdate.json.ok, true)
  assertMembershipListItem(accessLevelUpdate.json.membership, 'SENIOR_STAFF')

  assertError(
    await fetchJson(
      baseUrl,
      token,
      `/moderation/memberships/${membershipListItem.id}/access-level`,
      {
        method: 'PATCH',
        body: JSON.stringify({ accessLevel: 'UNKNOWN' }),
      }
    ),
    400
  )

  const membershipsAfterAccessUpdate = await fetchJson(baseUrl, token, '/moderation/memberships')
  assert.strictEqual(membershipsAfterAccessUpdate.status, 200)
  const updatedMembershipListItem = membershipsAfterAccessUpdate.json.find(
    (item: any) => item.id === membershipListItem.id
  )
  assert.ok(updatedMembershipListItem)
  assertMembershipListItem(updatedMembershipListItem, 'SENIOR_STAFF')

  const businessDetail = await fetchJson(baseUrl, token, `/moderation/businesses/${fixture.business.id}`)
  assert.strictEqual(businessDetail.status, 200)
  assertBusinessDetail(businessDetail.json)

  const missingId = randomUUID()
  assertError(await fetchJson(baseUrl, token, `/moderation/users/${missingId}`), 404)
  assertError(await fetchJson(baseUrl, token, `/moderation/venues/${missingId}`), 404)
  assertError(await fetchJson(baseUrl, token, `/moderation/businesses/${missingId}`), 404)

  return fixture
}

async function testConflict(baseUrl: string, token: string) {
  const payload = {
    inn: createValidInn(),
    companyName: `${TEST_PREFIX}-supplier-${randomUUID()}`,
    ownerFullName: 'Contract Supplier',
    ownerPhone: randomPhone(),
    companyPhone: randomPhone(),
    city: 'Moscow',
    address: 'Contract street, 2',
    accessStatus: 'ACTIVE',
  }
  const created = await fetchJson(baseUrl, token, '/moderation/suppliers', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  assert.strictEqual(created.status, 201)

  const conflict = await fetchJson(baseUrl, token, '/moderation/suppliers', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  assertError(conflict, 409)
  assert.strictEqual(conflict.json.error.code, 'SUPPLIER_MEMBERSHIP_EXISTS')

  const csvPath = path.join(os.tmpdir(), `${randomUUID()}.csv`)
  await fs.writeFile(csvPath, 'name,category\nContract product,Contract category\n')

  try {
    const imported = await importModerationSupplierPrice(created.json.supplier.id, {
      originalname: 'contract-price.csv',
      mimetype: 'text/csv',
      size: (await fs.stat(csvPath)).size,
      path: csvPath,
      filename: path.basename(csvPath),
    })
    const overview = await fetchJson(
      baseUrl,
      token,
      `/moderation/suppliers/${created.json.supplier.id}/price-imports/${imported.importId}?page=1&pageSize=50`
    )
    assert.strictEqual(overview.status, 200)
    assertExactKeys(overview.json, ['ok', 'import', 'stats', 'rows'], 'price overview response')
    assert.strictEqual(overview.json.import.id, imported.importId)
    assert.strictEqual(overview.json.stats.categories.total, 1)
    assert.strictEqual(overview.json.stats.products.total, 1)
    assert.strictEqual(overview.json.rows.items.length, 1)

    const replacementForm = new FormData()
    replacementForm.append(
      'file',
      new Blob(['name,category\nHTTP replacement,HTTP category\n'], { type: 'text/csv' }),
      'http-replacement.csv'
    )
    const replacement = await fetchJson(
      baseUrl,
      token,
      `/moderation/suppliers/${created.json.supplier.id}/price-imports/${imported.importId}`,
      { method: 'PUT', body: replacementForm }
    )
    assert.strictEqual(replacement.status, 200)
    assertExactKeys(replacement.json, ['ok', 'replacedImportId', 'import'], 'replace price response')
    assert.strictEqual(replacement.json.replacedImportId, imported.importId)
    const activeImportId = replacement.json.import.importId

    const deleted = await fetchJson(
      baseUrl,
      token,
      `/moderation/suppliers/${created.json.supplier.id}/price-imports/${activeImportId}`,
      { method: 'DELETE' }
    )
    assert.strictEqual(deleted.status, 200)
    assertExactKeys(deleted.json, ['ok', 'importId', 'supplier'], 'delete price import response')
    assert.strictEqual(deleted.json.ok, true)
    assert.strictEqual(deleted.json.importId, activeImportId)
    assert.strictEqual(deleted.json.supplier.priceImportsCount, 0)
    assert.deepStrictEqual(deleted.json.supplier.priceImports, [])

    assertError(
      await fetchJson(
        baseUrl,
        token,
        `/moderation/suppliers/${created.json.supplier.id}/price-imports/${activeImportId}`,
        { method: 'DELETE' }
      ),
      404
    )
  } finally {
    await fs.rm(csvPath, { force: true })
  }
}

async function testHardDelete(
  baseUrl: string,
  token: string,
  fixture: Awaited<ReturnType<typeof createCardFixture>>
) {
  const task = await prisma.userTask.create({
    data: {
      title: `${TEST_PREFIX}-task`,
      creatorUserId: fixture.user.id,
      assigneeUserId: fixture.user.id,
      venueId: fixture.venue.id,
    },
  })
  const order = await prisma.orderBatch.create({
    data: { venueId: fixture.venue.id, createdByUserId: fixture.user.id },
  })
  const file = await prisma.fileAsset.create({
    data: {
      storageKey: `${TEST_PREFIX}/${randomUUID()}`,
      fileName: 'contract.txt',
      mimeType: 'text/plain',
      fileSize: 1,
      type: FileAssetType.DOCUMENT,
      uploadedByUserId: fixture.user.id,
    },
  })
  const audit = await prisma.auditLog.create({
    data: {
      actorType: AuditActorType.USER,
      actorUserId: fixture.user.id,
      entityType: 'User',
      entityId: fixture.user.id,
      action: `${TEST_PREFIX}-audit`,
    },
  })

  const response = await fetchJson(
    baseUrl,
    token,
    `/moderation/users/${fixture.user.id}`,
    { method: 'DELETE' }
  )
  assert.strictEqual(response.status, 200)
  assertExactKeys(response.json, ['ok', 'deletedUser', 'deleted'], 'hard delete response')
  assertExactKeys(response.json.deletedUser, ['id', 'phone', 'email'], 'hard delete user')
  assert.strictEqual(response.json.ok, true)
  assert.strictEqual(response.json.deleted.userTasks, 1)
  assert.strictEqual(response.json.deleted.orderBatches, 1)
  assert.strictEqual(response.json.deleted.fileAssetsUnlinked, 1)
  assert.strictEqual(response.json.deleted.auditLogsUnlinked, 1)

  assert.strictEqual(await prisma.user.findUnique({ where: { id: fixture.user.id } }), null)
  assert.strictEqual(await prisma.userTask.findUnique({ where: { id: task.id } }), null)
  assert.strictEqual(await prisma.orderBatch.findUnique({ where: { id: order.id } }), null)
  assert.strictEqual((await prisma.fileAsset.findUniqueOrThrow({ where: { id: file.id } })).uploadedByUserId, null)
  assert.strictEqual((await prisma.auditLog.findUniqueOrThrow({ where: { id: audit.id } })).actorUserId, null)

  assertError(
    await fetchJson(baseUrl, token, `/moderation/users/${fixture.user.id}`, { method: 'DELETE' }),
    404
  )
}

async function testCatalogFacetAdmin(baseUrl: string, token: string) {
  const key = `${FACET_TEST_PREFIX}_facet_${randomUUID().replace(/-/g, '_').slice(0, 12)}`
  const createResponse = await fetchJson(baseUrl, token, '/moderation/catalog/facets', {
    method: 'POST',
    body: JSON.stringify({
      key,
      label: 'Contract facet',
      type: FacetType.MULTISELECT,
      level: FacetLevel.PRODUCT,
      scopes: [FacetScope.CATALOG, FacetScope.ADMIN_CATALOG],
      dataSource: 'product.country',
      optionSource: FacetOptionSource.DYNAMIC,
      minFillRate: 0.05,
      sortOrder: 9999,
    }),
  })
  assert.strictEqual(createResponse.status, 201)
  assert.strictEqual(createResponse.json.ok, true)
  assert.strictEqual(createResponse.json.facet.key, key)
  assert.strictEqual(createResponse.json.facet.dataSource, 'product.country')
  assert.deepStrictEqual(createResponse.json.facet.scopes, [
    FacetScope.CATALOG,
    FacetScope.ADMIN_CATALOG,
  ])
  const facetId = createResponse.json.facet.id

  const listResponse = await fetchJson(
    baseUrl,
    token,
    `/moderation/catalog/facets?scope=${FacetScope.CATALOG}&q=${encodeURIComponent(key)}`
  )
  assert.strictEqual(listResponse.status, 200)
  assert.strictEqual(listResponse.json.ok, true)
  assert.ok(listResponse.json.items.some((item: any) => item.id === facetId))

  const previewResponse = await fetchJson(
    baseUrl,
    token,
    `/moderation/catalog/facets/preview?id=${facetId}`
  )
  assert.strictEqual(previewResponse.status, 200)
  assert.strictEqual(previewResponse.json.ok, true)
  assert.strictEqual(previewResponse.json.facet.id, facetId)
  assert.strictEqual(typeof previewResponse.json.visibleIn.categoriesCount, 'number')
  assert.strictEqual(typeof previewResponse.json.coverage.productsTotal, 'number')
  assert.strictEqual(typeof previewResponse.json.coverage.productsFilled, 'number')
  assert.ok(Array.isArray(previewResponse.json.values))

  const patchResponse = await fetchJson(baseUrl, token, `/moderation/catalog/facets/${facetId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      label: 'Contract facet updated',
      type: FacetType.CHIPS,
      optionSource: FacetOptionSource.STATIC,
      options: [
        { value: 'France', label: 'Франция', sortOrder: 10 },
        { value: 'Italy', label: 'Италия', sortOrder: 20 },
      ],
    }),
  })
  assert.strictEqual(patchResponse.status, 200)
  assert.strictEqual(patchResponse.json.ok, true)
  assert.strictEqual(patchResponse.json.facet.label, 'Contract facet updated')
  assert.strictEqual(patchResponse.json.facet.options.length, 2)

  assertError(
    await fetchJson(baseUrl, token, '/moderation/catalog/facets', {
      method: 'POST',
      body: JSON.stringify({
        key: `${key}_bad`,
        label: 'Bad facet',
        type: FacetType.MULTISELECT,
        level: FacetLevel.PRODUCT,
        scopes: [FacetScope.CATALOG],
        dataSource: 'offer.price',
      }),
    }),
    400
  )

  const deleteResponse = await fetchJson(baseUrl, token, `/moderation/catalog/facets/${facetId}`, {
    method: 'DELETE',
  })
  assert.strictEqual(deleteResponse.status, 200)
  assert.strictEqual(deleteResponse.json.ok, true)
  assert.strictEqual(deleteResponse.json.id, facetId)

  assertError(
    await fetchJson(baseUrl, token, `/moderation/catalog/facets/preview?id=${facetId}`),
    404
  )
}

async function testCatalogProductsFacetFiltering(baseUrl: string, token: string) {
  const key = `${FACET_TEST_PREFIX}_country_${randomUUID().replace(/-/g, '_').slice(0, 12)}`
  const createFacetResponse = await fetchJson(baseUrl, token, '/moderation/catalog/facets', {
    method: 'POST',
    body: JSON.stringify({
      key,
      label: 'Contract country facet',
      type: FacetType.MULTISELECT,
      level: FacetLevel.PRODUCT,
      scopes: [FacetScope.ADMIN_CATALOG],
      dataSource: 'product.country',
      optionSource: FacetOptionSource.DYNAMIC,
      minFillRate: 0,
      sortOrder: 9999,
    }),
  })
  assert.strictEqual(createFacetResponse.status, 201, 'facet-filtering: facet creation must succeed')

  const countryA = `${TEST_PREFIX}-country-a-${randomUUID()}`
  const countryB = `${TEST_PREFIX}-country-b-${randomUUID()}`

  const pendingProduct = await prisma.product.create({
    data: {
      name: `${TEST_PREFIX}-pending-${randomUUID()}`,
      country: countryA,
      status: ProductCatalogStatus.NEEDS_REVIEW,
      isConfirmed: false,
    },
  })
  const hiddenProduct = await prisma.product.create({
    data: {
      name: `${TEST_PREFIX}-hidden-${randomUUID()}`,
      country: countryA,
      status: ProductCatalogStatus.CONFIRMED,
      isConfirmed: true,
      isHidden: true,
    },
  })
  const otherCountryProduct = await prisma.product.create({
    data: {
      name: `${TEST_PREFIX}-other-country-${randomUUID()}`,
      country: countryB,
      status: ProductCatalogStatus.CONFIRMED,
      isConfirmed: true,
    },
  })

  const unfilteredResponse = await fetchJson(
    baseUrl,
    token,
    `/moderation/catalog/products?query=${encodeURIComponent(TEST_PREFIX)}&limit=100`
  )
  assert.strictEqual(unfilteredResponse.status, 200, 'facet-filtering: unfiltered list must succeed')
  const unfilteredIds = unfilteredResponse.json.items.map((item: any) => item.id)
  assert.ok(unfilteredIds.includes(pendingProduct.id), 'facet-filtering: NEEDS_REVIEW product must be visible without facets')
  assert.ok(unfilteredIds.includes(hiddenProduct.id), 'facet-filtering: hidden product must be visible without facets')
  assert.ok(unfilteredIds.includes(otherCountryProduct.id), 'facet-filtering: unrelated-country product must be visible without facets')

  const facetedResponse = await fetchJson(
    baseUrl,
    token,
    `/moderation/catalog/products?query=${encodeURIComponent(TEST_PREFIX)}&facets=${encodeURIComponent(
      JSON.stringify({ [key]: [countryA] })
    )}&limit=100`
  )
  assert.strictEqual(facetedResponse.status, 200, 'facet-filtering: faceted list must succeed')
  const facetedIds = facetedResponse.json.items.map((item: any) => item.id)
  assert.ok(
    facetedIds.includes(pendingProduct.id),
    'facet-filtering: NEEDS_REVIEW product matching the facet must stay visible (ADMIN_CATALOG scope must not hide unconfirmed products)'
  )
  assert.ok(
    facetedIds.includes(hiddenProduct.id),
    'facet-filtering: hidden product matching the facet must stay visible (ADMIN_CATALOG scope must not hide hidden products)'
  )
  assert.ok(
    !facetedIds.includes(otherCountryProduct.id),
    'facet-filtering: product with a non-matching country must be excluded once the facet is applied'
  )

  const optionsResponse = await fetchJson(
    baseUrl,
    token,
    `/moderation/catalog/facets/options?query=${encodeURIComponent(TEST_PREFIX)}`
  )
  assert.strictEqual(optionsResponse.status, 200, 'facet-filtering: facets/options must succeed')
  assert.strictEqual(optionsResponse.json.ok, true)
  const countryFacet = optionsResponse.json.facets.find((facet: any) => facet.key === key)
  assert.ok(countryFacet, 'facet-filtering: facets/options must include the ADMIN_CATALOG-scoped test facet')
  const countryAOption = countryFacet.options.find((option: any) => option.value === countryA)
  assert.ok(countryAOption, 'facet-filtering: facets/options must include the countryA option')
  assert.strictEqual(
    countryAOption.count,
    2,
    'facet-filtering: countryA option count must include both the pending and hidden product'
  )

  assertError(
    await fetchJson(baseUrl, token, `/moderation/catalog/products?facets=not-json`),
    400
  )
}

async function main() {
  const moderator = env.moderators[0]
  assert.ok(moderator, 'At least one moderator must be configured for HTTP contract tests')
  const token = jwt.sign(
    { moderatorId: moderator.id, email: moderator.email, role: moderator.role },
    env.jwtSecret,
    { expiresIn: '5m' }
  )

  await cleanup()
  const server = app.listen(0)

  try {
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address() as AddressInfo
    const baseUrl = `http://127.0.0.1:${address.port}`
    const fixture = await testCardsAndFilters(baseUrl, token)
    await testCatalogFacetAdmin(baseUrl, token)
    await testCatalogProductsFacetFiltering(baseUrl, token)
    await testConflict(baseUrl, token)
    await testHardDelete(baseUrl, token, fixture)
    console.info('[moderation-admin-contract] all checks passed')
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
    await cleanup()
    await prisma.$disconnect()
  }
}

main().catch(async (error) => {
  console.error('[moderation-admin-contract] failed:', error)
  await prisma.$disconnect()
  process.exit(1)
})
