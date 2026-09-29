import { MembershipStatus, PriceImportStatus, type SupplierPriceImport } from '../../generated/prisma'
import { apiError } from '../../lib/api-error'
import { prisma } from '../../lib/prisma'
import type { AuthPayload } from '../../middleware/auth'
import { getProfilePermissionsForAuth } from '../profile/profile-permissions.service'

export class SupplierPriceImportError extends Error {
  constructor(public code: 'SECTION_FORBIDDEN' | 'PRICE_IMPORT_NOT_FOUND', message: string, public status = 400) {
    super(message)
  }
}

async function getAccess(auth: AuthPayload) {
  if (auth.type !== 'user') throw new SupplierPriceImportError('SECTION_FORBIDDEN', 'Supplier prices section is forbidden', 403)
  const profile = await getProfilePermissionsForAuth(auth).catch(() => null)
  if (!profile?.permissions.profileSections.supplierPrices) throw new SupplierPriceImportError('SECTION_FORBIDDEN', 'Supplier prices section is forbidden', 403)
  const membership = await prisma.supplierMembership.findFirst({
    where: { userId: auth.userId, status: MembershipStatus.ACTIVE, supplier: { isActive: true } },
    select: { supplierId: true }, orderBy: { createdAt: 'asc' },
  })
  if (!membership) throw new SupplierPriceImportError('SECTION_FORBIDDEN', 'Supplier prices section is forbidden', 403)
  return membership
}

function publicStatus(status: PriceImportStatus) {
  if (status === PriceImportStatus.PENDING) return 'UPLOADED' as const
  if (status === PriceImportStatus.PROCESSING) return 'PROCESSING' as const
  if (status === PriceImportStatus.PROCESSED) return 'DONE' as const
  return 'FAILED' as const
}

function mapImport(item: SupplierPriceImport, fileName: string) {
  return {
    id: item.id, fileName, uploadedAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(),
    status: publicStatus(item.status), rowsCount: item.rowsCount, processedRows: item.processedRows,
    errorsCount: item.failedRows, warningsCount: 0,
  }
}

async function fileNamesById(ids: string[]) {
  const files = await prisma.fileAsset.findMany({ where: { id: { in: ids } }, select: { id: true, fileName: true } })
  return new Map(files.map((file) => [file.id, file.fileName]))
}

export async function getSupplierPriceImportStatus(auth: AuthPayload) {
  const access = await getAccess(auth)
  const item = await prisma.supplierPriceImport.findFirst({ where: { supplierId: access.supplierId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
  if (!item) return { lastImport: null, updatedAt: null }
  const names = await fileNamesById([item.fileAssetId])
  return { lastImport: mapImport(item, names.get(item.fileAssetId) ?? 'price-list'), updatedAt: item.updatedAt.toISOString() }
}

export async function listSupplierPriceImports(auth: AuthPayload) {
  const access = await getAccess(auth)
  const items = await prisma.supplierPriceImport.findMany({ where: { supplierId: access.supplierId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
  const names = await fileNamesById(items.map((item) => item.fileAssetId))
  return items.map((item) => mapImport(item, names.get(item.fileAssetId) ?? 'price-list'))
}

export async function getSupplierPriceImport(auth: AuthPayload, id: string) {
  const access = await getAccess(auth)
  const item = await prisma.supplierPriceImport.findFirst({ where: { id, supplierId: access.supplierId } })
  if (!item) throw new SupplierPriceImportError('PRICE_IMPORT_NOT_FOUND', 'Price import was not found', 404)
  const [names, rows] = await Promise.all([
    fileNamesById([item.fileAssetId]),
    prisma.supplierPriceImportRow.findMany({ where: { importId: item.id }, select: { id: true, rawName: true, rawCategory: true, mappingStatus: true, errorText: true }, orderBy: { id: 'asc' } }),
  ])
  return { ...mapImport(item, names.get(item.fileAssetId) ?? 'price-list'), rows }
}

export function mapSupplierPriceImportError(error: unknown) {
  if (error instanceof SupplierPriceImportError) return { status: error.status, body: apiError(error.code, error.message) }
  return { status: 500, body: apiError('PRICE_IMPORT_REQUEST_FAILED', 'Price import request failed') }
}
