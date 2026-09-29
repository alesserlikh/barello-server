import assert from 'assert'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { randomUUID } from 'crypto'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import {
  AccessLevel,
  AccountType,
  MembershipStatus,
  UserStatus,
} from '../src/generated/prisma'
import { prisma } from '../src/lib/prisma'
import {
  checkLoginPhone,
  startLogin,
  verifyLoginOtp,
} from '../src/modules/auth/auth.service'
import { getHomeContext } from '../src/modules/auth/home-context.service'
import {
  createModerationSupplier,
  deleteModerationSupplier,
  deleteModerationSupplierPriceImport,
  getModerationSupplierDetail,
  getModerationSupplierPriceImportOverview,
  getModerationSupplierPriceImports,
  getModerationSuppliers,
  importModerationSupplierPrice,
  replaceModerationSupplierPriceImport,
  updateModerationSupplier,
  updateModerationSupplierAccessStatus,
} from '../src/modules/moderation/moderation.service'
import {
  moderationSupplierDetailSchema,
  moderationSupplierSchema,
} from '../src/modules/moderation/moderation-suppliers.contract'

const TEST_PREFIX = 'moderation-supplier-integration'
const TEST_PHONE_PREFIX = '+7902'

const ajv = new Ajv({ allErrors: true, strict: true })
addFormats(ajv)
const validateSupplier = ajv.compile(moderationSupplierSchema)
const validateSupplierDetail = ajv.compile(moderationSupplierDetailSchema)

function assertContract(
  validator: typeof validateSupplier,
  value: unknown,
  contractName: string
) {
  assert.ok(
    validator(value),
    `${contractName} contract mismatch: ${ajv.errorsText(validator.errors)}`
  )
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

function createPhone() {
  return `${TEST_PHONE_PREFIX}${String(
    Math.floor(1_000_000 + Math.random() * 8_999_999)
  )}`
}

async function cleanup() {
  const suppliers = await prisma.supplier.findMany({
    where: { name: { startsWith: TEST_PREFIX } },
    select: { id: true, businessId: true },
  })

  await prisma.supplier.deleteMany({
    where: { id: { in: suppliers.map((item) => item.id) } },
  })
  await prisma.business.deleteMany({
    where: { id: { in: suppliers.flatMap((item) => item.businessId ? [item.businessId] : []) } },
  })
  await prisma.user.deleteMany({
    where: { phone: { startsWith: TEST_PHONE_PREFIX } },
  })
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { action: { startsWith: 'MODERATION_SUPPLIER_' } },
        { action: 'MODERATION_SUPPLIER_PRICE_IMPORTED' },
      ],
      payload: { path: ['testRunId'], equals: TEST_PREFIX },
    },
  }).catch(() => undefined)
}

async function expectSupplierError(
  action: () => Promise<unknown>,
  expectedCode: string
) {
  await assert.rejects(action, (error: any) => {
    assert.strictEqual(error?.code, expectedCode)
    return true
  })
}

async function testModerationSupplierLifecycle() {
  const ownerPhone = createPhone()
  const inn = createValidInn()
  const companyName = `${TEST_PREFIX}-${randomUUID()}`
  const moderator = {
    id: randomUUID(),
    email: 'integration@barello.test',
    name: 'Integration Moderator',
  }

  const created = await createModerationSupplier(
    {
      inn,
      companyName,
      ownerFullName: 'Тестов Тест Тестович',
      ownerPhone,
      companyPhone: ownerPhone,
      city: 'Москва',
      address: 'Тестовая улица, 1',
      accessStatus: 'ACTIVE',
    },
    moderator
  )

  assert.strictEqual(created.inn, inn)
  assert.strictEqual(created.accessStatus, 'ACTIVE')
  assert.strictEqual(created.hasActiveAccount, true)
  assert.strictEqual(created.owner?.status, UserStatus.ACTIVE)
  assert.strictEqual(created.owner?.accountType, AccountType.SUPPLIER_STAFF)
  assert.strictEqual(created.membershipStatus, MembershipStatus.ACTIVE)
  assert.strictEqual(created.membershipAccessLevel, AccessLevel.ADMIN)
  assertContract(validateSupplier, created, 'create supplier response')

  const listItem = (await getModerationSuppliers()).find(
    (supplier) => supplier.id === created.id
  )
  assert.ok(listItem, 'created supplier must be present in moderation list')
  assertContract(validateSupplier, listItem, 'supplier list item')

  const updatedInn = createValidInn()
  const updated = await updateModerationSupplier(
    created.id,
    {
      inn: updatedInn,
      companyName: `${companyName}-updated`,
      ownerFullName: 'Обновлён Тест Тестович',
      ownerPhone,
      companyPhone: ownerPhone,
      city: 'Санкт-Петербург',
      address: 'Обновлённая улица, 2',
    },
    moderator
  )
  assert.strictEqual(updated.inn, updatedInn)
  assert.strictEqual(updated.companyName, `${companyName}-updated`)
  assert.strictEqual(updated.ownerFullName, 'Обновлён Тест Тестович')
  assert.strictEqual(updated.city, 'Санкт-Петербург')

  const phoneCheck = await checkLoginPhone({ phone: ownerPhone })
  assert.strictEqual(phoneCheck.exists, true)
  assert.strictEqual(phoneCheck.canLogin, true)

  await startLogin({ phone: ownerPhone })
  const login = await verifyLoginOtp(
    { phone: ownerPhone, code: '1234' },
    { userAgent: TEST_PREFIX, ipAddress: '127.0.0.1' }
  )
  assert.strictEqual(login.user.accountType, AccountType.SUPPLIER_STAFF)

  const session = await prisma.authSession.findFirstOrThrow({
    where: { userId: created.owner!.id },
    orderBy: { createdAt: 'desc' },
  })
  const homeContext = await getHomeContext({
    type: 'user',
    userId: created.owner!.id,
    sessionId: session.id,
  })
  assert.strictEqual(homeContext.context?.type, 'SUPPLIER')

  const blocked = await updateModerationSupplierAccessStatus(
    created.id,
    'BLOCKED',
    moderator
  )
  assert.strictEqual(blocked.isActive, false)
  assert.strictEqual(blocked.owner?.status, UserStatus.BLOCKED)
  assert.strictEqual(blocked.membershipStatus, MembershipStatus.REVOKED)
  assert.strictEqual((await checkLoginPhone({ phone: ownerPhone })).canLogin, false)
  assert.strictEqual(
    await prisma.authSession.count({ where: { userId: created.owner!.id } }),
    0
  )

  const reactivated = await updateModerationSupplierAccessStatus(
    created.id,
    'ACTIVE',
    moderator
  )
  assert.strictEqual(reactivated.hasActiveAccount, true)
  assert.strictEqual(reactivated.membershipStatus, MembershipStatus.ACTIVE)
  await expectSupplierError(
    () =>
      updateModerationSupplierAccessStatus(
        created.id,
        'UNKNOWN' as any,
        moderator
      ),
    'ACCESS_STATUS_INVALID'
  )

  await expectSupplierError(
    () =>
      importModerationSupplierPrice(
        created.id,
        {
          originalname: 'missing-price.xlsx',
          mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          size: 1,
          path: path.join(os.tmpdir(), `${randomUUID()}-missing.xlsx`),
          filename: `${randomUUID()}-missing.xlsx`,
        },
        moderator
      ),
    'PRICE_IMPORT_FAILED'
  )

  const csvPath = path.join(os.tmpdir(), `${randomUUID()}.csv`)
  let createdImportId = ''
  let createdImportFileAssetId = ''
  await fs.writeFile(csvPath, 'name,category\nIntegration product,Integration category\n')

  try {
    const imported = await importModerationSupplierPrice(
      created.id,
      {
        originalname: 'integration-price.csv',
        mimetype: 'text/csv',
        size: (await fs.stat(csvPath)).size,
        path: csvPath,
        filename: path.basename(csvPath),
      },
      moderator
    )
    createdImportId = imported.importId
    assert.strictEqual(imported.supplier.priceImportsCount, 1)
    assert.ok(imported.supplier.lastPriceImportAt)

    const history = await getModerationSupplierPriceImports(created.id)
    assert.strictEqual(history.length, 1)
    assert.strictEqual(history[0].file?.fileName, 'integration-price.csv')
    createdImportFileAssetId = history[0].fileAssetId
  } finally {
    await fs.rm(csvPath, { force: true })
  }

  const detail = await getModerationSupplierDetail(created.id)
  assertContract(validateSupplierDetail, detail, 'supplier detail')
  assert.strictEqual(detail.priceImports.length, 1)
  assert.ok(detail.createdAt)
  assert.ok(detail.updatedAt)
  assert.ok(detail.lastLoginAt)

  const overview = await getModerationSupplierPriceImportOverview(
    created.id,
    createdImportId,
    { page: 1, pageSize: 50 }
  )
  assert.strictEqual(overview.import.id, createdImportId)
  assert.strictEqual(overview.stats.categories.total, 1)
  assert.strictEqual(overview.stats.categories.items[0].name, 'Integration category')
  assert.strictEqual(overview.stats.products.total, 1)
  assert.strictEqual(overview.rows.items.length, 1)
  assert.strictEqual(overview.rows.items[0].rawName, 'Integration product')

  const originalImportId = createdImportId
  const originalFileAssetId = createdImportFileAssetId
  const replacementPath = path.join(os.tmpdir(), `${randomUUID()}.csv`)
  await fs.writeFile(
    replacementPath,
    'name,category\nReplacement product,Replacement category\n'
  )
  try {
    const replaced = await replaceModerationSupplierPriceImport(
      created.id,
      originalImportId,
      {
        originalname: 'replacement-price.csv',
        mimetype: 'text/csv',
        size: (await fs.stat(replacementPath)).size,
        path: replacementPath,
        filename: path.basename(replacementPath),
      },
      moderator
    )
    createdImportId = replaced.import.importId
    const replacementHistory = await getModerationSupplierPriceImports(created.id)
    createdImportFileAssetId = replacementHistory[0].fileAssetId
    assert.strictEqual(replaced.replacedImportId, originalImportId)
    assert.strictEqual(replaced.import.supplier.priceImportsCount, 1)
    assert.strictEqual(replacementHistory[0].file?.fileName, 'replacement-price.csv')
    assert.strictEqual(
      await prisma.supplierPriceImport.findUnique({ where: { id: originalImportId } }),
      null
    )
    assert.strictEqual(
      await prisma.fileAsset.findUnique({ where: { id: originalFileAssetId } }),
      null
    )
  } finally {
    await fs.rm(replacementPath, { force: true })
  }

  const deletedImport = await deleteModerationSupplierPriceImport(
    created.id,
    createdImportId,
    moderator
  )
  assert.strictEqual(deletedImport.ok, true)
  assert.strictEqual(deletedImport.importId, createdImportId)
  assert.strictEqual(deletedImport.supplier.priceImportsCount, 0)
  assert.deepStrictEqual(deletedImport.supplier.priceImports, [])
  assert.strictEqual(
    await prisma.supplierPriceImport.findUnique({ where: { id: createdImportId } }),
    null
  )
  assert.strictEqual(
    await prisma.supplierPriceImportRow.count({ where: { importId: createdImportId } }),
    0
  )
  assert.strictEqual(
    await prisma.fileAsset.findUnique({ where: { id: createdImportFileAssetId } }),
    null
  )
  await expectSupplierError(
    () => deleteModerationSupplierPriceImport(created.id, createdImportId, moderator),
    'PRICE_IMPORT_NOT_FOUND'
  )

  const deleted = await deleteModerationSupplier(created.id, moderator)
  assert.strictEqual(deleted.ok, true)
  assert.deepStrictEqual(deleted.archivedUserIds, [created.owner!.id])
  assert.strictEqual(await prisma.supplier.findUnique({ where: { id: created.id } }), null)
  assert.strictEqual(await prisma.business.findUnique({ where: { id: created.businessId! } }), null)

  const archivedOwner = await prisma.user.findUniqueOrThrow({
    where: { id: created.owner!.id },
  })
  assert.strictEqual(archivedOwner.status, UserStatus.ARCHIVED)
  assert.strictEqual(
    await prisma.authSession.count({ where: { userId: created.owner!.id } }),
    0
  )
  assert.strictEqual((await checkLoginPhone({ phone: ownerPhone })).canLogin, false)

  await expectSupplierError(
    () => getModerationSupplierDetail(created.id),
    'SUPPLIER_NOT_FOUND'
  )
  await expectSupplierError(
    () => importModerationSupplierPrice(created.id, undefined, moderator),
    'PRICE_FILE_REQUIRED'
  )
}

async function main() {
  await cleanup()

  try {
    await testModerationSupplierLifecycle()
    console.info('[moderation-suppliers-integration] all checks passed')
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
}

main().catch(async (error) => {
  console.error('[moderation-suppliers-integration] failed:', error)
  await prisma.$disconnect()
  process.exit(1)
})
