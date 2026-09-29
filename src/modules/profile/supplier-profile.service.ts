import { prisma } from '../../lib/prisma'
import {
  assertMainPhotoIsIncluded,
  assertUserOwnsFileAssets,
  FileAssetValidationError,
} from './profile-media.service'

export async function getAllSuppliers() {
  return prisma.supplier.findMany({
    where: {
      isActive: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
    select: {
      id: true,
      name: true,
      catalogName: true,
      city: true,
      address: true,
      contactName: true,
      phone: true,
      email: true,
      website: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  })
}

type UpdateSupplierProfileInput = {
  name?: string
  catalogName?: string | null
  contactName?: string
  description?: string | null
  city?: string
  address?: string
  phone?: string
  website?: string
  showPhoneInCard?: boolean
  companyPhotoFileIds?: string[]
  mainPhotoFileId?: string | null
}

const SUPPLIER_DESCRIPTION_MAX_LENGTH = 5_000

function normalizeSupplierDescription(value: string | null | undefined) {
  if (value === undefined) {
    return undefined
  }

  if (value === null) {
    return null
  }

  const normalizedValue = value.trim()

  if (!normalizedValue) {
    return null
  }

  if (normalizedValue.length > SUPPLIER_DESCRIPTION_MAX_LENGTH) {
    throw new Error(
      `Supplier description must be at most ${SUPPLIER_DESCRIPTION_MAX_LENGTH} characters`
    )
  }

  return normalizedValue
}

export async function getMySupplierProfile(userId: string) {
  const membership = await prisma.supplierMembership.findFirst({
    where: {
      userId,
    },
    include: {
        supplier: {
          include: {
            photos: {
              orderBy: {
                sortOrder: 'asc',
              },
              include: {
                fileAsset: {
                  select: {
                    id: true,
                    storageKey: true,
                    fileName: true,
                    mimeType: true,
                  },
                },
              },
            },
          },
        },
    },
    orderBy: [
      {
        status: 'asc',
      },
      {
        createdAt: 'asc',
      },
    ],
  })

  if (!membership?.supplier) {
    throw new Error('Supplier not found')
  }

  const { passwordHash, ...safeSupplier } = membership.supplier

  return {
    ...safeSupplier,
    photos: safeSupplier.photos.map((photo) => ({
      id: photo.id,
      fileAssetId: photo.fileAssetId,
      storageKey: photo.fileAsset.storageKey,
      fileName: photo.fileAsset.fileName,
      mimeType: photo.fileAsset.mimeType,
    })),
  }
}

export async function updateMySupplierProfile(
  userId: string,
  input: UpdateSupplierProfileInput,
) {
  const membership = await prisma.supplierMembership.findFirst({
    where: {
      userId,
    },
    include: {
      supplier: true,
    },
    orderBy: [
      {
        status: 'asc',
      },
      {
        createdAt: 'asc',
      },
    ],
  })

  if (!membership?.supplier) {
    throw new Error('Supplier not found')
  }

  const normalizedDescription = normalizeSupplierDescription(input.description)
  assertSupplierPhotoConsistency(input.mainPhotoFileId, input.companyPhotoFileIds)
  await assertSupplierPhotoOwnership(userId, {
    mainPhotoFileId: input.mainPhotoFileId,
    companyPhotoFileIds: input.companyPhotoFileIds,
  })

  const updatedSupplier = await prisma.$transaction(async (tx) => {
    await tx.supplier.update({
      where: { id: membership.supplier.id },
      data: {
        name: input.name ?? membership.supplier.name,
        catalogName:
          input.catalogName === undefined
            ? membership.supplier.catalogName
            : input.catalogName?.trim() || null,
        contactName: input.contactName ?? membership.supplier.contactName,
        description:
          normalizedDescription === undefined
            ? membership.supplier.description
            : normalizedDescription,
        city: input.city ?? membership.supplier.city,
        address: input.address ?? membership.supplier.address,
        phone: input.phone ?? membership.supplier.phone,
        website: input.website ?? membership.supplier.website,
        showPhoneInCard:
          input.showPhoneInCard ?? membership.supplier.showPhoneInCard,
        mainPhotoFileId:
          input.mainPhotoFileId === undefined
            ? membership.supplier.mainPhotoFileId
            : input.mainPhotoFileId,
      },
    })

    if (input.companyPhotoFileIds !== undefined) {
      await tx.supplierPhoto.deleteMany({
        where: {
          supplierId: membership.supplier.id,
        },
      })

      if (input.companyPhotoFileIds.length > 0) {
        await tx.supplierPhoto.createMany({
          data: input.companyPhotoFileIds.map((fileAssetId, index) => ({
            supplierId: membership.supplier.id,
            fileAssetId,
            sortOrder: index,
          })),
        })
      }
    }

    return tx.supplier.findUnique({
      where: { id: membership.supplier.id },
      include: {
        photos: {
          orderBy: {
            sortOrder: 'asc',
          },
          include: {
            fileAsset: {
              select: {
                id: true,
                storageKey: true,
                fileName: true,
                mimeType: true,
              },
            },
          },
        },
      },
    })
  })

  if (!updatedSupplier) {
    throw new Error('Supplier not found')
  }

  const { passwordHash, ...safeSupplier } = updatedSupplier

  return {
    ...safeSupplier,
    photos: safeSupplier.photos.map((photo) => ({
      id: photo.id,
      fileAssetId: photo.fileAssetId,
      storageKey: photo.fileAsset.storageKey,
      fileName: photo.fileAsset.fileName,
      mimeType: photo.fileAsset.mimeType,
    })),
  }
}

function assertSupplierPhotoConsistency(
  mainPhotoFileId: string | null | undefined,
  companyPhotoFileIds: string[] | undefined,
) {
  try {
    assertMainPhotoIsIncluded(mainPhotoFileId, companyPhotoFileIds)
  } catch (error) {
    if (
      error instanceof FileAssetValidationError &&
      error.code === 'MAIN_PHOTO_NOT_IN_COLLECTION'
    ) {
      throw new Error(
        'Main company photo must be included in companyPhotoFileIds'
      )
    }

    throw error
  }
}

async function assertSupplierPhotoOwnership(
  userId: string,
  params: {
    mainPhotoFileId?: string | null
    companyPhotoFileIds?: string[]
  },
) {
  try {
    await assertUserOwnsFileAssets(userId, params.mainPhotoFileId)
    await assertUserOwnsFileAssets(userId, params.companyPhotoFileIds)
  } catch (error) {
    if (
      error instanceof FileAssetValidationError &&
      error.code === 'FILE_NOT_FOUND'
    ) {
      throw new Error(
        params.mainPhotoFileId &&
          error.fileAssetIds.includes(params.mainPhotoFileId)
          ? 'Main company photo file not found'
          : 'One or more company photo files were not found'
      )
    }

    if (
      error instanceof FileAssetValidationError &&
      error.code === 'FILE_NOT_OWNED'
    ) {
      throw new Error(
        params.mainPhotoFileId &&
          error.fileAssetIds.includes(params.mainPhotoFileId)
          ? 'Main company photo file does not belong to the current user'
          : 'One or more company photo files do not belong to the current user'
      )
    }

    throw error
  }
}
