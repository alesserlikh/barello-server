import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'

import { FileAssetType } from '../../generated/prisma'
import { prisma } from '../../lib/prisma'
import { env } from '../../config/env'

const uploadsRootDir = env.uploadsRoot
const profileMediaDir = path.join(uploadsRootDir, 'profile-media')

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

export type FileAssetView = {
  id: string
  storageKey: string
  fileName: string
  mimeType: string
  fileSize: number
  url: string
}

export class FileAssetValidationError extends Error {
  code: 'FILE_NOT_FOUND' | 'FILE_NOT_OWNED' | 'MAIN_PHOTO_NOT_IN_COLLECTION'
  fileAssetIds: string[]

  constructor(params: {
    code: 'FILE_NOT_FOUND' | 'FILE_NOT_OWNED' | 'MAIN_PHOTO_NOT_IN_COLLECTION'
    message: string
    fileAssetIds?: string[]
  }) {
    super(params.message)
    this.code = params.code
    this.fileAssetIds = params.fileAssetIds ?? []
  }
}

export function ensureProfileMediaDir() {
  if (!fs.existsSync(profileMediaDir)) {
    fs.mkdirSync(profileMediaDir, { recursive: true })
  }
}

export function getUploadsRootDir() {
  return uploadsRootDir
}

export function getProfileMediaDir() {
  ensureProfileMediaDir()
  return profileMediaDir
}

export function isSupportedImageMimeType(mimeType: string) {
  return IMAGE_MIME_TYPES.has(mimeType.toLowerCase())
}

export function getSafeUploadExtension(fileName: string, mimeType: string) {
  const extension = path.extname(fileName).trim().toLowerCase()

  if (extension) {
    return extension
  }

  switch (mimeType.toLowerCase()) {
    case 'image/png':
      return '.png'
    case 'image/webp':
      return '.webp'
    case 'image/gif':
      return '.gif'
    default:
      return '.jpg'
  }
}

export function buildProfileMediaStorageKey(fileName: string) {
  return `profile-media/${fileName}`
}

export function createProfileMediaFileName(
  originalName: string,
  mimeType: string,
) {
  return `${Date.now()}-${randomUUID()}${getSafeUploadExtension(originalName, mimeType)}`
}

export function buildFileAssetUrl(storageKey: string) {
  const normalizedStorageKey = storageKey.replace(/^\/+/, '')
  return `${env.apiPublicUrl.replace(/\/$/, '')}/uploads/${normalizedStorageKey}`
}

export function mapFileAssetToView(asset: {
  id: string
  storageKey: string
  fileName: string
  mimeType: string
  fileSize: number
}) {
  return {
    id: asset.id,
    storageKey: asset.storageKey,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    fileSize: asset.fileSize,
    url: buildFileAssetUrl(asset.storageKey),
  } satisfies FileAssetView
}

export async function createUploadedImageAsset(params: {
  fileName: string
  storageKey: string
  mimeType: string
  fileSize: number
  uploadedByUserId: string
}) {
  const asset = await prisma.fileAsset.create({
    data: {
      storageKey: params.storageKey,
      fileName: params.fileName,
      mimeType: params.mimeType,
      fileSize: params.fileSize,
      type: FileAssetType.IMAGE,
      uploadedByUserId: params.uploadedByUserId,
    },
    select: {
      id: true,
      storageKey: true,
      fileName: true,
      mimeType: true,
      fileSize: true,
    },
  })

  return mapFileAssetToView(asset)
}

export async function findFileAssetViewById(fileAssetId: string | null | undefined) {
  if (!fileAssetId) {
    return null
  }

  const asset = await prisma.fileAsset.findUnique({
    where: { id: fileAssetId },
    select: {
      id: true,
      storageKey: true,
      fileName: true,
      mimeType: true,
      fileSize: true,
    },
  })

  return asset ? mapFileAssetToView(asset) : null
}

function normalizeFileAssetIds(fileAssetIds: string | string[] | null | undefined) {
  const ids = Array.isArray(fileAssetIds) ? fileAssetIds : [fileAssetIds]

  return Array.from(
    new Set(
      ids.filter((fileAssetId): fileAssetId is string =>
        typeof fileAssetId === 'string' && fileAssetId.trim().length > 0
      )
    )
  )
}

export async function assertUserOwnsFileAssets(
  userId: string,
  fileAssetIds: string | string[] | null | undefined,
) {
  const normalizedFileAssetIds = normalizeFileAssetIds(fileAssetIds)

  if (normalizedFileAssetIds.length === 0) {
    return []
  }

  const assets = await prisma.fileAsset.findMany({
    where: {
      id: {
        in: normalizedFileAssetIds,
      },
    },
    select: {
      id: true,
      uploadedByUserId: true,
    },
  })

  if (assets.length !== normalizedFileAssetIds.length) {
    const foundIds = new Set(assets.map((asset) => asset.id))
    const missingIds = normalizedFileAssetIds.filter((fileAssetId) => !foundIds.has(fileAssetId))

    throw new FileAssetValidationError({
      code: 'FILE_NOT_FOUND',
      message: 'One or more files were not found',
      fileAssetIds: missingIds,
    })
  }

  const foreignIds = assets
    .filter((asset) => asset.uploadedByUserId !== userId)
    .map((asset) => asset.id)

  if (foreignIds.length > 0) {
    throw new FileAssetValidationError({
      code: 'FILE_NOT_OWNED',
      message: 'One or more files do not belong to the current user',
      fileAssetIds: foreignIds,
    })
  }

  return assets
}

export function assertMainPhotoIsIncluded(
  mainPhotoFileId: string | null | undefined,
  photoFileIds: string[] | undefined,
) {
  if (photoFileIds === undefined || mainPhotoFileId === undefined || mainPhotoFileId === null) {
    return
  }

  if (!photoFileIds.includes(mainPhotoFileId)) {
    throw new FileAssetValidationError({
      code: 'MAIN_PHOTO_NOT_IN_COLLECTION',
      message: 'Main photo must be included in the photo collection',
      fileAssetIds: [mainPhotoFileId],
    })
  }
}

export async function findOrphanedFileAssets() {
  const [
    fileAssets,
    avatarProfiles,
    venues,
    suppliers,
    venuePhotos,
    supplierPhotos,
    supplierPriceImports,
    supplierStockImports,
    salesReportImports,
    products,
    categoryBanners,
    catalogBanners,
  ] = await Promise.all([
    prisma.fileAsset.findMany({
      select: {
        id: true,
        storageKey: true,
        fileName: true,
        mimeType: true,
        fileSize: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    }),
    prisma.userProfile.findMany({
      where: {
        avatarFileId: {
          not: null,
        },
      },
      select: {
        avatarFileId: true,
      },
    }),
    prisma.venue.findMany({
      where: {
        mainPhotoFileId: {
          not: null,
        },
      },
      select: {
        mainPhotoFileId: true,
      },
    }),
    prisma.supplier.findMany({
      where: {
        mainPhotoFileId: {
          not: null,
        },
      },
      select: {
        mainPhotoFileId: true,
      },
    }),
    prisma.venuePhoto.findMany({
      select: {
        fileAssetId: true,
      },
    }),
    prisma.supplierPhoto.findMany({
      select: {
        fileAssetId: true,
      },
    }),
    prisma.supplierPriceImport.findMany({
      select: {
        fileAssetId: true,
      },
    }),
    prisma.supplierStockImport.findMany({
      select: {
        fileAssetId: true,
      },
    }),
    prisma.salesReportImport.findMany({
      select: {
        fileAssetId: true,
      },
    }),
    prisma.product.findMany({
      select: {
        barcodeImageFileId: true,
        mainImageFileId: true,
        promoVideoFileId: true,
      },
    }),
    prisma.catalogCategoryBanner.findMany({
      select: {
        fileAssetId: true,
      },
    }),
    prisma.catalogBanner.findMany({
      select: {
        fileAssetId: true,
      },
    }),
  ])

  const linkedFileAssetIds = new Set<string>()

  for (const record of avatarProfiles) {
    if (record.avatarFileId) linkedFileAssetIds.add(record.avatarFileId)
  }

  for (const record of venues) {
    if (record.mainPhotoFileId) linkedFileAssetIds.add(record.mainPhotoFileId)
  }

  for (const record of suppliers) {
    if (record.mainPhotoFileId) linkedFileAssetIds.add(record.mainPhotoFileId)
  }

  for (const record of venuePhotos) {
    linkedFileAssetIds.add(record.fileAssetId)
  }

  for (const record of supplierPhotos) {
    linkedFileAssetIds.add(record.fileAssetId)
  }

  for (const record of supplierPriceImports) {
    linkedFileAssetIds.add(record.fileAssetId)
  }

  for (const record of supplierStockImports) {
    linkedFileAssetIds.add(record.fileAssetId)
  }

  for (const record of salesReportImports) {
    linkedFileAssetIds.add(record.fileAssetId)
  }

  for (const record of categoryBanners) {
    linkedFileAssetIds.add(record.fileAssetId)
  }

  for (const record of catalogBanners) {
    linkedFileAssetIds.add(record.fileAssetId)
  }

  for (const product of products) {
    if (product.barcodeImageFileId) linkedFileAssetIds.add(product.barcodeImageFileId)
    if (product.mainImageFileId) linkedFileAssetIds.add(product.mainImageFileId)
    if (product.promoVideoFileId) linkedFileAssetIds.add(product.promoVideoFileId)
  }

  return fileAssets
    .filter((fileAsset) => !linkedFileAssetIds.has(fileAsset.id))
    .map((fileAsset) => ({
      ...mapFileAssetToView(fileAsset),
      createdAt: fileAsset.createdAt,
    }))
}

function collectUploadFilesRecursively(rootDir: string, currentDir = rootDir) {
  if (!fs.existsSync(currentDir)) {
    return [] as string[]
  }

  const dirEntries = fs.readdirSync(currentDir, { withFileTypes: true })
  const files: string[] = []

  for (const dirEntry of dirEntries) {
    const absolutePath = path.join(currentDir, dirEntry.name)

    if (dirEntry.isDirectory()) {
      files.push(...collectUploadFilesRecursively(rootDir, absolutePath))
      continue
    }

    const relativePath = path.relative(rootDir, absolutePath).replace(/\\/g, '/')
    files.push(relativePath)
  }

  return files
}

export async function inspectProfileMediaConsistency() {
  const [fileAssets, orphanedFileAssets] = await Promise.all([
    prisma.fileAsset.findMany({
      select: {
        id: true,
        storageKey: true,
        fileName: true,
        mimeType: true,
        fileSize: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    }),
    findOrphanedFileAssets(),
  ])

  const filesOnDisk = new Set(collectUploadFilesRecursively(uploadsRootDir))
  const fileAssetsByStorageKey = new Map(
    fileAssets.map((fileAsset) => [fileAsset.storageKey.replace(/^\/+/, ''), fileAsset])
  )

  const fileAssetsMissingOnDisk = fileAssets
    .filter((fileAsset) => !filesOnDisk.has(fileAsset.storageKey.replace(/^\/+/, '')))
    .map((fileAsset) => ({
      ...mapFileAssetToView(fileAsset),
      createdAt: fileAsset.createdAt,
    }))

  const filesOnDiskWithoutFileAsset = Array.from(filesOnDisk)
    .filter((storageKey) => !fileAssetsByStorageKey.has(storageKey))
    .sort()
    .map((storageKey) => ({
      storageKey,
      absolutePath: path.join(uploadsRootDir, ...storageKey.split('/')),
    }))

  return {
    fileAssetsMissingOnDisk,
    filesOnDiskWithoutFileAsset,
    orphanedFileAssets,
  }
}
