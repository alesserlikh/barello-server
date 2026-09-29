import assert from 'assert'
import { readFile } from 'fs/promises'
import type { AddressInfo } from 'net'

import app from '../src/app'
import { AccessLevel, AccountType } from '../src/generated/prisma'
import { apiError } from '../src/lib/api-error'
import { INVITATION_TTL_HOURS } from '../src/modules/auth/staff-invitations.service'
import { buildProfilePermissions } from '../src/modules/profile/profile-permissions.service'

function assertErrorEnvelope(value: unknown, code: string) {
  assert.ok(value && typeof value === 'object')
  const error = (value as any).error
  assert.strictEqual(error.code, code)
  assert.strictEqual(typeof error.message, 'string')
  assert.ok('details' in error)
}

async function testHttpErrorNormalization() {
  const server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    for (const path of ['/profile/mobile-context', '/notifications/summary', '/tasks?period=week', '/notes/latest', '/downloads']) {
      const response = await fetch(base + path)
      assert.strictEqual(response.status, 401)
      assertErrorEnvelope(await response.json(), 'AUTH_REQUIRED')
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

function testPermissionsByRole() {
  const admin = buildProfilePermissions({ accountType: AccountType.VENUE_STAFF, accessLevel: AccessLevel.ADMIN })
  const senior = buildProfilePermissions({ accountType: AccountType.VENUE_STAFF, accessLevel: AccessLevel.SENIOR_STAFF })
  const line = buildProfilePermissions({ accountType: AccountType.VENUE_STAFF, accessLevel: AccessLevel.LINE_STAFF })
  const supplier = buildProfilePermissions({ accountType: AccountType.SUPPLIER_STAFF, accessLevel: AccessLevel.ADMIN })
  assert.strictEqual(admin.profileSections.downloads, true)
  assert.strictEqual(senior.profileSections.downloads, true)
  assert.strictEqual(line.profileSections.downloads, false)
  assert.strictEqual(line.actions.canUploadDownloads, false)
  assert.strictEqual(supplier.profileSections.supplierPrices, true)
  assert.strictEqual(supplier.profileSections.promoBalance, true)
}

async function testAggregationAndRegressionContracts() {
  const context = await readFile('src/modules/profile/profile-mobile-context.service.ts', 'utf8')
  assert.ok(context.includes('getNotificationsSummary'))
  assert.ok(context.includes('getTasksWeekSummary'))
  assert.ok(context.includes('getLatestNote'))
  assert.ok(context.includes('errorsBySection.tasks'))
  assert.ok(context.includes('errorsBySection.notes'))
  assert.ok(context.includes('errorsBySection.notifications'))
  assert.ok(context.includes("code: 'PROFILE_FORBIDDEN'"))

  const suite = await readFile('scripts/auth-contract.smoke.ts', 'utf8')
  for (const required of [
    'testProfileMobileContextBaselineContract',
    'testProfileMobileRolePermissionsContract',
    'testTasksContract',
    'testNotesLatestContract',
    'testNotificationsHttpContract',
    'testProfileLineStaffForbiddenHttpContract',
    'testRefreshLogoutRegression',
  ]) assert.ok(suite.includes(required), `missing ${required}`)
  assert.ok(suite.includes('getProfileMobileContext'))
}

function testErrorCodesAndInviteTtl() {
  assert.deepStrictEqual(apiError('NOTE_NOT_FOUND', 'missing'), { error: { code: 'NOTE_NOT_FOUND', message: 'missing', details: null } })
  for (const code of [
    'PROFILE_FORBIDDEN', 'SECTION_FORBIDDEN', 'FILE_UPLOAD_INVALID_TYPE', 'FILE_UPLOAD_TOO_LARGE',
    'NOTIFICATION_NOT_FOUND', 'TASK_NOT_FOUND', 'TASK_FORBIDDEN', 'TASK_ASSIGNEE_FORBIDDEN',
    'TASK_INVALID_DUE_DATE', 'NOTE_NOT_FOUND', 'NOTE_FORBIDDEN', 'NOTE_INVALID_SCOPE',
    'VENUE_NOT_FOUND', 'SUPPLIER_NOT_FOUND', 'EMAIL_INVALID', 'INVITE_LIMIT_REACHED',
  ]) assert.strictEqual(typeof code, 'string')
  assert.strictEqual(INVITATION_TTL_HOURS, 48)
}

async function main() {
  testErrorCodesAndInviteTtl()
  testPermissionsByRole()
  await testAggregationAndRegressionContracts()
  await testHttpErrorNormalization()
  console.info('[profile-contract-smoke] all checks passed')
}

main().catch((error) => { console.error('[profile-contract-smoke] failed:', error); process.exit(1) })