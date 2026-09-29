import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'

import {
  AccessLevel,
  BusinessDownloadPurpose,
  BusinessDownloadStatus,
  FileAssetType,
  MembershipStatus,
  type Prisma,
} from '../../generated/prisma'
import { env } from '../../config/env'
import { apiError } from '../../lib/api-error'
import { prisma } from '../../lib/prisma'
import type { AuthPayload } from '../../middleware/auth'
import { getProfilePermissionsForAuth } from '../profile/profile-permissions.service'

export const MAX_DOWNLOAD_FILE_SIZE = 20 * 1024 * 1024

const downloadsDir = path.join(env.uploadsRoot, 'business-downloads')
const UUID_PATTERN = new RegExp(
  '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  'i',
)
const ALLOWED_FILE_TYPES = new Map<string, Set<string>>([
  ['.pdf', new Set(['application/pdf'])],
  ['.csv', new Set(['text/csv', 'application/csv'])],
  ['.xls', new Set(['application/vnd.ms-excel'])],
  [
    '.xlsx',
    new Set([
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ]),
  ],
  ['.txt', new Set(['text/plain'])],
  ['.doc', new Set(['application/msword'])],
  [
    '.docx',
    new Set([
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]),
  ],
])

export type DownloadErrorCode =
  | 'SECTION_FORBIDDEN'
  | 'DOWNLOAD_NOT_FOUND'
  | 'DOWNLOAD_INVALID_FILE'
  | 'DOWNLOAD_INVALID_PURPOSE'
  | 'DOWNLOAD_INVALID_STATUS'
  | 'DOWNLOAD_INVALID_LIMIT'

export class DownloadError extends Error {
  code: DownloadErrorCode
  status: number

  constructor(code: DownloadErrorCode, message: string, status = 400) {
    super(message)
    this.name = 'DownloadError'
    this.code = code
    this.status = status
  }
}

const downloadInclude = {
  fileAsset: {
    select: {
      id: true,
      storageKey: true,
      fileName: true,
      mimeType: true,
      fileSize: true,
    },
  },
  uploadedBy: {
    select: {
      id: true,
      profile: {
        select: {
          firstName: true,
          lastName: true,
          middleName: true,
        },
      },
    },
  },
} satisfies Prisma.BusinessDownloadInclude

type DownloadView = Prisma.BusinessDownloadGetPayload<{
  include: typeof downloadInclude
}>

function forbidden(): never {
  throw new DownloadError(
    'SECTION_FORBIDDEN',
    'Downloads section is forbidden',
    403,
  )
}

function notFound(): never {
  throw new DownloadError(
    'DOWNLOAD_NOT_FOUND',
    'Download was not found',
    404,
  )
}

function fullName(profile: NonNullable<DownloadView['uploadedBy']>['profile'] | null | undefined) {
  if (!profile) return null
  return [profile.lastName, profile.firstName, profile.middleName]
    .filter(Boolean)
    .join(' ')
}

function buildFileUrl(storageKey: string) {
  const normalizedKey = storageKey.replace(new RegExp('^/+'), '')
  return (
    env.apiPublicUrl.replace(new RegExp('/+$'), '') +
    '/uploads/' +
    normalizedKey
  )
}

function mapDownload(download: DownloadView) {
  return {
    id: download.id,
    venueId: download.venueId,
    purpose: download.purpose,
    status: download.status,
    processingError: download.processingError,
    uploadedById: download.uploadedBy?.id ?? null,
    uploadedBy: download.uploadedBy
      ? {
          id: download.uploadedBy.id,
          fullName: fullName(download.uploadedBy.profile),
        }
      : null,
    fileAssetId: download.fileAsset.id,
    fileName: download.fileAsset.fileName,
    fileSize: download.fileAsset.fileSize,
    mimeType: download.fileAsset.mimeType,
    url: buildFileUrl(download.fileAsset.storageKey),
    createdAt: download.createdAt.toISOString(),
    updatedAt: download.updatedAt.toISOString(),
  }
}

export function ensureDownloadsDir() {
  if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true })
  }
}

export function getDownloadsDir() {
  ensureDownloadsDir()
  return downloadsDir
}

export function getDownloadExtension(fileName: string) {
  return path.extname(fileName).trim().toLowerCase()
}

export function validateDownloadFile(file: {
  originalname: string
  mimetype: string
  size?: number
}) {
  const extension = getDownloadExtension(file.originalname)
  const allowedMimeTypes = ALLOWED_FILE_TYPES.get(extension)

  if (!allowedMimeTypes) {
    throw new DownloadError(
      'DOWNLOAD_INVALID_FILE',
      'Unsupported file extension',
    )
  }

  if (!allowedMimeTypes.has(file.mimetype.toLowerCase())) {
    throw new DownloadError(
      'DOWNLOAD_INVALID_FILE',
      'MIME type does not match the file extension',
    )
  }

  if (
    typeof file.size === 'number' &&
    file.size > MAX_DOWNLOAD_FILE_SIZE
  ) {
    throw new DownloadError(
      'DOWNLOAD_INVALID_FILE',
      'File size must not exceed 20 MB',
    )
  }

  return extension
}

export function createDownloadStorageName(originalName: string) {
  return (
    Date.now() +
    '-' +
    randomUUID() +
    getDownloadExtension(originalName)
  )
}

function parsePurpose(value: unknown): BusinessDownloadPurpose {
  if (
    value === BusinessDownloadPurpose.MENU ||
    value === BusinessDownloadPurpose.STOCK ||
    value === BusinessDownloadPurpose.SALES ||
    value === BusinessDownloadPurpose.ANALYTICS
  ) {
    return value
  }

  throw new DownloadError(
    'DOWNLOAD_INVALID_PURPOSE',
    'purpose must be MENU, STOCK, SALES or ANALYTICS',
  )
}

function parseStatus(value: unknown): BusinessDownloadStatus {
  if (
    value === BusinessDownloadStatus.UPLOADED ||
    value === BusinessDownloadStatus.PROCESSING ||
    value === BusinessDownloadStatus.DONE ||
    value === BusinessDownloadStatus.FAILED
  ) {
    return value
  }

  throw new DownloadError(
    'DOWNLOAD_INVALID_STATUS',
    'status must be UPLOADED, PROCESSING, DONE or FAILED',
  )
}

function parseLimit(value: unknown) {
  if (value === undefined) return 20
  const normalized =
    typeof value === 'string' && /^\d+$/.test(value)
      ? Number(value)
      : Number.NaN

  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 100) {
    throw new DownloadError(
      'DOWNLOAD_INVALID_LIMIT',
      'limit must be between 1 and 100',
    )
  }

  return normalized
}

async function requireDownloadsSection(auth: AuthPayload) {
  if (auth.type !== 'user') forbidden()

  const access = await getProfilePermissionsForAuth(auth).catch(() => {
    forbidden()
  })

  if (
    !access.permissions.profileSections.downloads ||
    access.accessLevel === AccessLevel.LINE_STAFF
  ) {
    forbidden()
  }

  return {
    userId: auth.userId,
    permissions: access.permissions,
  }
}

async function resolveVenueAccess(
  auth: AuthPayload,
  requestedVenueId?: unknown,
) {
  const sectionAccess = await requireDownloadsSection(auth)
  const user = await prisma.user.findUnique({
    where: { id: sectionAccess.userId },
    select: { activeVenueId: true },
  })

  const venueId =
    typeof requestedVenueId === 'string' && requestedVenueId
      ? requestedVenueId
      : user?.activeVenueId

  if (!venueId) forbidden()

  const membership = await prisma.userVenueMembership.findFirst({
    where: {
      userId: sectionAccess.userId,
      venueId,
      membershipStatus: MembershipStatus.ACTIVE,
      accessLevel: {
        in: [AccessLevel.ADMIN, AccessLevel.SENIOR_STAFF],
      },
    },
    select: { id: true },
  })

  if (!membership) forbidden()

  return {
    userId: sectionAccess.userId,
    venueId,
    permissions: sectionAccess.permissions,
  }
}

async function getDownloadWithAccess(
  auth: AuthPayload,
  downloadId: string,
) {
  if (!UUID_PATTERN.test(downloadId)) notFound()

  const download = await prisma.businessDownload.findUnique({
    where: { id: downloadId },
    include: downloadInclude,
  })

  if (!download) notFound()
  await resolveVenueAccess(auth, download.venueId)
  return download
}

export async function listDownloads(
  auth: AuthPayload,
  params: { venueId?: unknown; limit?: unknown },
) {
  const access = await resolveVenueAccess(auth, params.venueId)
  const downloads = await prisma.businessDownload.findMany({
    where: { venueId: access.venueId },
    include: downloadInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: parseLimit(params.limit),
  })

  return downloads.map(mapDownload)
}

export async function getDownload(
  auth: AuthPayload,
  downloadId: string,
) {
  const download = await getDownloadWithAccess(auth, downloadId)
  return mapDownload(download)
}

export async function createDownload(
  auth: AuthPayload,
  body: Record<string, unknown>,
  file: Express.Multer.File,
) {
  const access = await resolveVenueAccess(auth, body.venueId)
  if (!access.permissions.actions.canUploadDownloads) forbidden()

  validateDownloadFile(file)
  const purpose = parsePurpose(body.purpose)
  const storageKey =
    'business-downloads/' + path.basename(file.filename)

  try {
    const download = await prisma.$transaction(async (tx) => {
      const fileAsset = await tx.fileAsset.create({
        data: {
          storageKey,
          fileName: file.originalname,
          mimeType: file.mimetype.toLowerCase(),
          fileSize: file.size,
          type:
            ['.csv', '.xls', '.xlsx'].includes(
              getDownloadExtension(file.originalname),
            )
              ? FileAssetType.SPREADSHEET
              : FileAssetType.DOCUMENT,
          uploadedByUserId: access.userId,
        },
      })

      return tx.businessDownload.create({
        data: {
          venueId: access.venueId,
          fileAssetId: fileAsset.id,
          uploadedByUserId: access.userId,
          purpose,
        },
        include: downloadInclude,
      })
    })

    return mapDownload(download)
  } catch (error) {
    await fs.promises.unlink(file.path).catch(() => undefined)
    throw error
  }
}

export async function updateDownload(
  auth: AuthPayload,
  downloadId: string,
  body: Record<string, unknown>,
) {
  const existing = await getDownloadWithAccess(auth, downloadId)
  const purpose =
    body.purpose === undefined
      ? existing.purpose
      : parsePurpose(body.purpose)
  const status =
    body.status === undefined
      ? existing.status
      : parseStatus(body.status)

  if (
    body.processingError !== undefined &&
    body.processingError !== null &&
    typeof body.processingError !== 'string'
  ) {
    throw new DownloadError(
      'DOWNLOAD_INVALID_STATUS',
      'processingError must be a string or null',
    )
  }

  const processingError =
    status === BusinessDownloadStatus.FAILED
      ? typeof body.processingError === 'string'
        ? body.processingError.trim() || null
        : existing.processingError
      : null

  const download = await prisma.businessDownload.update({
    where: { id: downloadId },
    data: {
      purpose,
      status,
      processingError,
    },
    include: downloadInclude,
  })

  return mapDownload(download)
}

export async function getLatestDownloads(auth: AuthPayload) {
  return listDownloads(auth, { limit: '3' })
}

export function mapDownloadError(error: unknown) {
  if (error instanceof DownloadError) {
    return { status: error.status, body: apiError(error.code, error.message) }
  }

  return {
    status: 500,
    body: apiError('DOWNLOAD_REQUEST_FAILED', 'Download request failed'),
  }
}
