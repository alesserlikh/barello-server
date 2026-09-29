import assert from 'assert'
import { randomUUID } from 'crypto'
import type { AddressInfo } from 'net'

import jwt from 'jsonwebtoken'

import app from '../src/app'
import { env } from '../src/config/env'
import {
  AccessLevel,
  AccountType,
  DisplayRole,
  FileAssetType,
  MembershipStatus,
  UserStatus,
} from '../src/generated/prisma'
import { prisma } from '../src/lib/prisma'
import { updateMySupplierProfile } from '../src/modules/profile/supplier-profile.service'
import { updateMyVenueProfile } from '../src/modules/profile/venue-profile.service'

const TEST_PREFIX = 'profile-media-integration'
const TEST_PHONE_PREFIX = '+7911'

function randomPhone() {
  const tail = String(Math.floor(1_000_000 + Math.random() * 8_999_999))
  return `${TEST_PHONE_PREFIX}${tail}`
}

async function cleanup() {
  await prisma.catalogCategoryBanner.deleteMany({
    where: {
      title: {
        startsWith: TEST_PREFIX,
      },
    },
  })

  await prisma.catalogBanner.deleteMany({
    where: {
      title: {
        startsWith: TEST_PREFIX,
      },
    },
  })

  await prisma.supplier.deleteMany({
    where: {
      name: {
        startsWith: TEST_PREFIX,
      },
    },
  })

  await prisma.business.deleteMany({
    where: {
      name: {
        startsWith: TEST_PREFIX,
      },
    },
  })

  await prisma.user.deleteMany({
    where: {
      OR: [
        {
          phone: {
            startsWith: TEST_PHONE_PREFIX,
          },
        },
        {
          profile: {
            lastName: TEST_PREFIX,
          },
        },
      ],
    },
  })

  await prisma.fileAsset.deleteMany({
    where: {
      storageKey: {
        contains: TEST_PREFIX,
      },
    },
  })
}

async function createUser(label: string) {
  return prisma.user.create({
    data: {
      phone: randomPhone(),
      status: UserStatus.ACTIVE,
      accountType: AccountType.VENUE_STAFF,
      profile: {
        create: {
          firstName: label,
          lastName: TEST_PREFIX,
        },
      },
    },
  })
}

async function createAuthHeader(userId: string) {
  const session = await prisma.authSession.create({
    data: {
      userId,
      refreshTokenHash: `${TEST_PREFIX}-refresh-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      userAgent: TEST_PREFIX,
      ipAddress: '127.0.0.1',
    },
  })

  const token = jwt.sign(
    {
      userId,
      sessionId: session.id,
      type: 'user',
    },
    env.jwtSecret
  )

  return `Bearer ${token}`
}

async function createFileAsset(userId: string, label: string) {
  return prisma.fileAsset.create({
    data: {
      storageKey: `profile-media/${TEST_PREFIX}-${label}-${randomUUID()}.jpg`,
      fileName: `${label}.jpg`,
      mimeType: 'image/jpeg',
      fileSize: 1024,
      type: FileAssetType.IMAGE,
      uploadedByUserId: userId,
    },
  })
}

async function createVenueMembership(userId: string) {
  const business = await prisma.business.create({
    data: {
      name: `${TEST_PREFIX} business ${randomUUID()}`,
      taxNumber: String(Math.floor(1_000_000_000 + Math.random() * 8_999_999_999)),
    },
  })

  const venue = await prisma.venue.create({
    data: {
      businessId: business.id,
      name: `${TEST_PREFIX} venue ${randomUUID()}`,
      city: 'Moscow',
    },
  })

  await prisma.userVenueMembership.create({
    data: {
      userId,
      venueId: venue.id,
      displayRole: DisplayRole.OWNER,
      accessLevel: AccessLevel.ADMIN,
      membershipStatus: MembershipStatus.ACTIVE,
    },
  })

  return venue
}

async function createSupplierMembership(userId: string) {
  const supplier = await prisma.supplier.create({
    data: {
      name: `${TEST_PREFIX} supplier ${randomUUID()}`,
      passwordHash: `${TEST_PREFIX}-password-hash`,
    },
  })

  await prisma.supplierMembership.create({
    data: {
      userId,
      supplierId: supplier.id,
      displayRole: 'OWNER',
      accessLevel: AccessLevel.ADMIN,
      status: MembershipStatus.ACTIVE,
    },
  })

  return supplier
}

async function startTestServer() {
  const server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))

  const { port } = server.address() as AddressInfo

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      }),
  }
}

async function patchJson(baseUrl: string, path: string, token: string, body: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  return {
    status: response.status,
    json: (await response.json()) as Record<string, any>,
  }
}

async function getJson(baseUrl: string, path: string, token: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'GET',
    headers: {
      Authorization: token,
    },
  })

  return {
    status: response.status,
    json: (await response.json()) as Record<string, any>,
  }
}

async function testProfilePatchOwnAvatarAndResponseShape(baseUrl: string) {
  const user = await createUser('Own Avatar')
  const token = await createAuthHeader(user.id)
  const avatar = await createFileAsset(user.id, 'avatar-own')

  const response = await patchJson(baseUrl, '/profile/me', token, {
    firstName: 'Updated',
    avatarFileId: avatar.id,
  })

  assert.strictEqual(response.status, 200)
  assert.strictEqual(response.json.ok, true)
  assert.ok(response.json.user)
  assert.strictEqual(response.json.profile, undefined)
  assert.strictEqual(response.json.user.profile.avatarFileId, avatar.id)
  assert.strictEqual(response.json.user.avatar.id, avatar.id)
}

async function testProfilePatchRejectsForeignAvatar(baseUrl: string) {
  const owner = await createUser('Foreign Avatar Owner')
  const foreignUser = await createUser('Foreign Avatar Uploader')
  const token = await createAuthHeader(owner.id)
  const foreignAvatar = await createFileAsset(foreignUser.id, 'avatar-foreign')

  const response = await patchJson(baseUrl, '/profile/me', token, {
    avatarFileId: foreignAvatar.id,
  })

  assert.strictEqual(response.status, 400)
  assert.strictEqual(response.json.ok, false)
  assert.match(
    String(response.json.error),
    /does not belong to the current user/i
  )
}

async function testVenueProfileOwnershipAndConsistency() {
  const owner = await createUser('Venue Owner')
  await createVenueMembership(owner.id)

  const ownMainPhoto = await createFileAsset(owner.id, 'venue-main')
  const ownSecondPhoto = await createFileAsset(owner.id, 'venue-second')

  const updatedVenue = await updateMyVenueProfile(owner.id, {
    mainPhotoFileId: ownMainPhoto.id,
    venuePhotoFileIds: [ownMainPhoto.id, ownSecondPhoto.id],
  })

  assert.strictEqual(updatedVenue.mainPhotoFileId, ownMainPhoto.id)
  assert.deepStrictEqual(
    updatedVenue.photos.map((photo) => photo.fileAssetId),
    [ownMainPhoto.id, ownSecondPhoto.id]
  )

  const foreignUser = await createUser('Venue Foreign Uploader')
  const foreignPhoto = await createFileAsset(foreignUser.id, 'venue-foreign')

  await assert.rejects(
    () =>
      updateMyVenueProfile(owner.id, {
        venuePhotoFileIds: [foreignPhoto.id],
      }),
    (error: any) =>
      /принадлеж/i.test(String(error?.message)) ||
      /belong to the current user/i.test(String(error?.message))
  )

  await assert.rejects(
    () =>
      updateMyVenueProfile(owner.id, {
        mainPhotoFileId: ownMainPhoto.id,
        venuePhotoFileIds: [ownSecondPhoto.id],
      }),
    (error: any) =>
      /venuePhotoFileIds/i.test(String(error?.message))
  )
}

async function testSupplierProfileOwnershipAndConsistency() {
  const owner = await createUser('Supplier Owner')
  await createSupplierMembership(owner.id)

  const ownMainPhoto = await createFileAsset(owner.id, 'supplier-main')
  const ownSecondPhoto = await createFileAsset(owner.id, 'supplier-second')

  const updatedSupplier = await updateMySupplierProfile(owner.id, {
    mainPhotoFileId: ownMainPhoto.id,
    companyPhotoFileIds: [ownMainPhoto.id, ownSecondPhoto.id],
  })

  assert.strictEqual(updatedSupplier.mainPhotoFileId, ownMainPhoto.id)
  assert.deepStrictEqual(
    updatedSupplier.photos.map((photo) => photo.fileAssetId),
    [ownMainPhoto.id, ownSecondPhoto.id]
  )

  const foreignUser = await createUser('Supplier Foreign Uploader')
  const foreignPhoto = await createFileAsset(foreignUser.id, 'supplier-foreign')

  await assert.rejects(
    () =>
      updateMySupplierProfile(owner.id, {
        companyPhotoFileIds: [foreignPhoto.id],
      }),
    (error: any) =>
      /do not belong to the current user/i.test(String(error?.message))
  )

  await assert.rejects(
    () =>
      updateMySupplierProfile(owner.id, {
        mainPhotoFileId: ownMainPhoto.id,
        companyPhotoFileIds: [ownSecondPhoto.id],
      }),
    (error: any) =>
      /companyPhotoFileIds/i.test(String(error?.message))
  )
}

async function testSupplierDescriptionFlow(baseUrl: string) {
  const owner = await createUser('Supplier Description')
  await createSupplierMembership(owner.id)
  await prisma.user.update({
    where: { id: owner.id },
    data: {
      accountType: AccountType.SUPPLIER_STAFF,
    },
  })

  const token = await createAuthHeader(owner.id)

  const patchResponse = await patchJson(baseUrl, '/profile/supplier/me', token, {
    description: '  Premium importer of spirits and bar supplies.  ',
  })

  assert.strictEqual(patchResponse.status, 200)
  assert.strictEqual(
    patchResponse.json.supplier.description,
    'Premium importer of spirits and bar supplies.'
  )

  const supplierProfileResponse = await getJson(baseUrl, '/profile/supplier/me', token)
  assert.strictEqual(supplierProfileResponse.status, 200)
  assert.strictEqual(
    supplierProfileResponse.json.supplier.description,
    'Premium importer of spirits and bar supplies.'
  )

  const supplierContextResponse = await getJson(baseUrl, '/me/supplier-context', token)
  assert.strictEqual(supplierContextResponse.status, 200)
  assert.strictEqual(
    supplierContextResponse.json.activeSupplier.description,
    'Premium importer of spirits and bar supplies.'
  )
  assert.strictEqual(
    supplierContextResponse.json.suppliers[0].description,
    'Premium importer of spirits and bar supplies.'
  )

  const clearResponse = await patchJson(baseUrl, '/profile/supplier/me', token, {
    description: '   ',
  })

  assert.strictEqual(clearResponse.status, 200)
  assert.strictEqual(clearResponse.json.supplier.description, null)

  const clearedProfileResponse = await getJson(baseUrl, '/profile/supplier/me', token)
  assert.strictEqual(clearedProfileResponse.status, 200)
  assert.strictEqual(clearedProfileResponse.json.supplier.description, null)
}

async function main() {
  await cleanup()

  const server = await startTestServer()

  try {
    await testProfilePatchOwnAvatarAndResponseShape(server.baseUrl)
    await testProfilePatchRejectsForeignAvatar(server.baseUrl)
    await testVenueProfileOwnershipAndConsistency()
    await testSupplierProfileOwnershipAndConsistency()
    await testSupplierDescriptionFlow(server.baseUrl)

    console.info('[profile-media.integration] all checks passed')
  } finally {
    await server.close()
    await cleanup()
    await prisma.$disconnect()
  }
}

main().catch(async (error) => {
  console.error('[profile-media.integration] failed:', error)
  await prisma.$disconnect()
  process.exit(1)
})
