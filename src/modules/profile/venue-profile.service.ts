import {
  AccessLevel,
  DisplayRole,
  MembershipStatus,
  VenuePhotoStatus,
  VenueStatus,
} from '../../generated/prisma'
import { prisma } from '../../lib/prisma'
import type { AuthPayload } from '../../middleware/auth'
import {
  assertMainPhotoIsIncluded,
  assertUserOwnsFileAssets,
  FileAssetValidationError,
} from './profile-media.service'

type UpdateVenueProfileInput = {
  name?: string
  city?: string
  address?: string | null
  phone?: string | null
  email?: string | null
  showPhoneInCard?: boolean
  cuisine?: string[]
  description?: string | null
  venueType?: string | null
  venuePhotoFileIds?: string[]
  mainPhotoFileId?: string | null
}

class VenueProfileError extends Error {
  code: string
  status: number

  constructor(params: { code: string; message: string; status?: number }) {
    super(params.message)
    this.code = params.code
    this.status = params.status ?? 400
  }
}

function normalizeOptionalString(
  value: unknown,
  fieldName: string,
  options: { required?: boolean } = {}
) {
  if (value === undefined) return undefined
  if (value === null) {
    if (options.required) {
      throw new VenueProfileError({
        code: 'INVALID_VENUE_PROFILE_FIELD',
        message: `${fieldName} не может быть null`,
        status: 400,
      })
    }

    return null
  }
  if (typeof value !== 'string') {
    throw new VenueProfileError({
      code: 'INVALID_VENUE_PROFILE_FIELD',
      message: `${fieldName} должно быть строкой`,
      status: 400,
    })
  }

  const normalized = value.trim()
  if (options.required && !normalized) {
    throw new VenueProfileError({
      code: 'INVALID_VENUE_PROFILE_FIELD',
      message: `${fieldName} не может быть пустым`,
      status: 400,
    })
  }

  return normalized || null
}

function normalizeCuisine(value: unknown) {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new VenueProfileError({
      code: 'INVALID_VENUE_PROFILE_FIELD',
      message: 'Поле cuisine должно быть массивом строк',
      status: 400,
    })
  }

  const names = value.map((item) => {
    if (typeof item !== 'string') {
      throw new VenueProfileError({
        code: 'INVALID_VENUE_PROFILE_FIELD',
        message: 'Поле cuisine должно быть массивом строк',
        status: 400,
      })
    }

    return item.trim()
  })

  return Array.from(new Set(names.filter(Boolean)))
}

function normalizeUpdateVenueProfileInput(input: unknown): UpdateVenueProfileInput {
  const body =
    input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const showPhoneInCard = body.showPhoneInCard

  if (showPhoneInCard !== undefined && typeof showPhoneInCard !== 'boolean') {
    throw new VenueProfileError({
      code: 'INVALID_VENUE_PROFILE_FIELD',
      message: 'Поле showPhoneInCard должно быть булевым значением',
      status: 400,
    })
  }

  return {
    name: normalizeOptionalString(body.name, 'name', { required: true }) ?? undefined,
    city: normalizeOptionalString(body.city, 'city', { required: true }) ?? undefined,
    address: normalizeOptionalString(body.address, 'address'),
    phone: normalizeOptionalString(body.phone, 'phone'),
    email: normalizeOptionalString(body.email, 'email'),
    showPhoneInCard,
    cuisine: normalizeCuisine(body.cuisine),
    description: normalizeOptionalString(body.description, 'description'),
    venueType: normalizeOptionalString(body.venueType, 'venueType'),
    venuePhotoFileIds: Array.isArray(body.venuePhotoFileIds)
      ? body.venuePhotoFileIds.filter(
          (fileAssetId): fileAssetId is string => typeof fileAssetId === 'string'
        )
      : undefined,
    mainPhotoFileId:
      body.mainPhotoFileId === undefined
        ? undefined
        : normalizeOptionalString(body.mainPhotoFileId, 'mainPhotoFileId'),
  }
}

async function getActiveVenueMembership(userId: string) {
  return prisma.userVenueMembership.findFirst({
    where: {
      userId,
      membershipStatus: MembershipStatus.ACTIVE,
    },
    include: {
      venue: {
        include: {
          photos: {
            where: {
              status: VenuePhotoStatus.ACTIVE,
            },
            orderBy: {
              sortOrder: 'asc',
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
  })
}

function buildVenueProfileView(
  venue: NonNullable<Awaited<ReturnType<typeof findVenueProfileById>>>
) {
  return {
    id: venue.id,
    name: venue.name,
    city: venue.city,
    address: venue.address,
    phone: venue.phone,
    email: venue.email,
    showPhoneInCard: venue.showPhoneInCard,
    cuisine: venue.cuisineLinks.map((link) => link.cuisineType.name),
    description: venue.description,
    venueType: venue.venueType,
    mainPhotoFileId: venue.mainPhotoFileId,
    photos: venue.photos.map((photo) => ({
      id: photo.id,
      fileAssetId: photo.fileAssetId,
      storageKey: photo.fileAsset.storageKey,
      fileName: photo.fileAsset.fileName,
      mimeType: photo.fileAsset.mimeType,
    })),
    venueStatus: venue.venueStatus,
    isActive: venue.isActive,
  }
}

function findVenueProfileById(venueId: string) {
  return prisma.venue.findUnique({
    where: { id: venueId },
    include: {
      cuisineLinks: {
        include: {
          cuisineType: true,
        },
        orderBy: {
          cuisineType: {
            name: 'asc',
          },
        },
      },
      photos: {
        where: {
          status: VenuePhotoStatus.ACTIVE,
        },
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
}

async function requireVenueProfilePermissions(auth: AuthPayload, venueId: string) {
  if (auth.type !== 'user') {
    throw new VenueProfileError({
      code: 'INSUFFICIENT_PERMISSIONS',
      message: 'Управлять профилем заведения могут только авторизованные пользователи',
      status: 403,
    })
  }

  const membership = await prisma.userVenueMembership.findFirst({
    where: {
      userId: auth.userId,
      venueId,
      membershipStatus: MembershipStatus.ACTIVE,
      venue: {
        isActive: true,
        venueStatus: VenueStatus.ACTIVE,
      },
    },
    select: {
      id: true,
      displayRole: true,
      accessLevel: true,
    },
  })

  if (!membership) {
    throw new VenueProfileError({
      code: 'VENUE_NOT_AVAILABLE',
      message: 'Это заведение недоступно для текущего пользователя',
      status: 403,
    })
  }

  if (
    membership.displayRole !== DisplayRole.OWNER &&
    membership.accessLevel !== AccessLevel.ADMIN &&
    membership.accessLevel !== AccessLevel.SENIOR_STAFF
  ) {
    throw new VenueProfileError({
      code: 'INSUFFICIENT_PERMISSIONS',
      message: 'У вас нет прав на управление профилем заведения',
      status: 403,
    })
  }

  return membership
}

function assertVenuePhotoConsistency(
  mainPhotoFileId: string | null | undefined,
  venuePhotoFileIds: string[] | undefined,
) {
  try {
    assertMainPhotoIsIncluded(mainPhotoFileId, venuePhotoFileIds)
  } catch (error) {
    if (
      error instanceof FileAssetValidationError &&
      error.code === 'MAIN_PHOTO_NOT_IN_COLLECTION'
    ) {
      throw new VenueProfileError({
        code: 'MAIN_PHOTO_NOT_IN_COLLECTION',
        message:
          'Основная фотография заведения должна входить в массив venuePhotoFileIds',
        status: 400,
      })
    }

    throw error
  }
}

function assertMyVenuePhotoConsistency(
  mainPhotoFileId: string | null | undefined,
  venuePhotoFileIds: string[] | undefined,
) {
  try {
    assertMainPhotoIsIncluded(mainPhotoFileId, venuePhotoFileIds)
  } catch (error) {
    if (
      error instanceof FileAssetValidationError &&
      error.code === 'MAIN_PHOTO_NOT_IN_COLLECTION'
    ) {
      throw new Error(
        'Основная фотография заведения должна входить в массив venuePhotoFileIds'
      )
    }

    throw error
  }
}

async function assertVenuePhotoOwnership(
  userId: string,
  params: {
    mainPhotoFileId?: string | null
    venuePhotoFileIds?: string[]
  },
) {
  try {
    await assertUserOwnsFileAssets(userId, params.mainPhotoFileId)
    await assertUserOwnsFileAssets(userId, params.venuePhotoFileIds)
  } catch (error) {
    if (
      error instanceof FileAssetValidationError &&
      error.code === 'FILE_NOT_FOUND'
    ) {
      throw new VenueProfileError({
        code: 'FILE_NOT_FOUND',
        message:
          params.mainPhotoFileId &&
          error.fileAssetIds.includes(params.mainPhotoFileId)
            ? 'Основная фотография заведения не найдена'
            : 'Одна или несколько фотографий заведения не найдены',
        status: 404,
      })
    }

    if (
      error instanceof FileAssetValidationError &&
      error.code === 'FILE_NOT_OWNED'
    ) {
      throw new VenueProfileError({
        code: 'FILE_NOT_OWNED',
        message:
          params.mainPhotoFileId &&
          error.fileAssetIds.includes(params.mainPhotoFileId)
            ? 'Основная фотография заведения принадлежит другому пользователю'
            : 'Одна или несколько фотографий заведения принадлежат другому пользователю',
        status: 403,
      })
    }

    throw error
  }
}

async function assertMyVenuePhotoOwnership(
  userId: string,
  params: {
    mainPhotoFileId?: string | null
    venuePhotoFileIds?: string[]
  },
) {
  try {
    await assertUserOwnsFileAssets(userId, params.mainPhotoFileId)
    await assertUserOwnsFileAssets(userId, params.venuePhotoFileIds)
  } catch (error) {
    if (
      error instanceof FileAssetValidationError &&
      error.code === 'FILE_NOT_FOUND'
    ) {
      throw new Error(
        params.mainPhotoFileId &&
          error.fileAssetIds.includes(params.mainPhotoFileId)
          ? 'Основная фотография заведения не найдена'
          : 'Одна или несколько фотографий заведения не найдены'
      )
    }

    if (
      error instanceof FileAssetValidationError &&
      error.code === 'FILE_NOT_OWNED'
    ) {
      throw new Error(
        params.mainPhotoFileId &&
          error.fileAssetIds.includes(params.mainPhotoFileId)
          ? 'Основная фотография заведения принадлежит другому пользователю'
          : 'Одна или несколько фотографий заведения принадлежат другому пользователю'
      )
    }

    throw error
  }
}

export async function getMyVenueProfile(userId: string) {
  const membership = await getActiveVenueMembership(userId)

  if (!membership?.venue) {
    throw new Error('Заведение не найдено')
  }

  return membership.venue
}

export async function getVenueProfile(auth: AuthPayload, venueId: string) {
  await requireVenueProfilePermissions(auth, venueId)

  const venue = await findVenueProfileById(venueId)

  if (!venue) {
    throw new VenueProfileError({
      code: 'VENUE_NOT_FOUND',
      message: 'Заведение не найдено',
      status: 404,
    })
  }

  return buildVenueProfileView(venue)
}

export async function updateVenueProfile(
  auth: AuthPayload,
  venueId: string,
  input: unknown
) {
  await requireVenueProfilePermissions(auth, venueId)
  const normalizedInput = normalizeUpdateVenueProfileInput(input)

  assertVenuePhotoConsistency(
    normalizedInput.mainPhotoFileId,
    normalizedInput.venuePhotoFileIds,
  )
  await assertVenuePhotoOwnership(auth.userId, {
    mainPhotoFileId: normalizedInput.mainPhotoFileId,
    venuePhotoFileIds: normalizedInput.venuePhotoFileIds,
  })

  const updatedVenue = await prisma.$transaction(async (tx) => {
    await tx.venue.update({
      where: { id: venueId },
      data: {
        name: normalizedInput.name,
        city: normalizedInput.city,
        address: normalizedInput.address,
        phone: normalizedInput.phone,
        email: normalizedInput.email,
        showPhoneInCard: normalizedInput.showPhoneInCard,
        description: normalizedInput.description,
        venueType: normalizedInput.venueType,
        mainPhotoFileId: normalizedInput.mainPhotoFileId,
      },
    })

    if (normalizedInput.cuisine !== undefined) {
      await tx.venueCuisineType.deleteMany({
        where: { venueId },
      })

      for (const cuisineName of normalizedInput.cuisine) {
        const cuisineType = await tx.cuisineType.upsert({
          where: { name: cuisineName },
          create: { name: cuisineName },
          update: {},
        })

        await tx.venueCuisineType.create({
          data: {
            venueId,
            cuisineTypeId: cuisineType.id,
          },
        })
      }
    }

    if (normalizedInput.venuePhotoFileIds !== undefined) {
      await tx.venuePhoto.deleteMany({
        where: {
          venueId,
        },
      })

      if (normalizedInput.venuePhotoFileIds.length > 0) {
        await tx.venuePhoto.createMany({
          data: normalizedInput.venuePhotoFileIds.map((fileAssetId, index) => ({
            venueId,
            fileAssetId,
            sortOrder: index,
          })),
        })
      }
    }

    return tx.venue.findUnique({
      where: { id: venueId },
      include: {
        cuisineLinks: {
          include: {
            cuisineType: true,
          },
          orderBy: {
            cuisineType: {
              name: 'asc',
            },
          },
        },
        photos: {
          where: {
            status: VenuePhotoStatus.ACTIVE,
          },
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

  if (!updatedVenue) {
    throw new VenueProfileError({
      code: 'VENUE_NOT_FOUND',
      message: 'Заведение не найдено',
      status: 404,
    })
  }

  return buildVenueProfileView(updatedVenue)
}

export async function updateMyVenueProfile(
  userId: string,
  input: UpdateVenueProfileInput,
) {
  const membership = await getActiveVenueMembership(userId)

  if (!membership?.venue) {
    throw new Error('Заведение не найдено')
  }

  assertMyVenuePhotoConsistency(input.mainPhotoFileId, input.venuePhotoFileIds)
  await assertMyVenuePhotoOwnership(userId, {
    mainPhotoFileId: input.mainPhotoFileId,
    venuePhotoFileIds: input.venuePhotoFileIds,
  })

  const updatedVenue = await prisma.$transaction(async (tx) => {
    await tx.venue.update({
      where: { id: membership.venue.id },
      data: {
        showPhoneInCard:
          input.showPhoneInCard ?? membership.venue.showPhoneInCard,
        mainPhotoFileId:
          input.mainPhotoFileId === undefined
            ? membership.venue.mainPhotoFileId
            : input.mainPhotoFileId,
      },
    })

    if (input.venuePhotoFileIds !== undefined) {
      await tx.venuePhoto.deleteMany({
        where: {
          venueId: membership.venue.id,
        },
      })

      if (input.venuePhotoFileIds.length > 0) {
        await tx.venuePhoto.createMany({
          data: input.venuePhotoFileIds.map((fileAssetId, index) => ({
            venueId: membership.venue.id,
            fileAssetId,
            sortOrder: index,
          })),
        })
      }
    }

    return tx.venue.findUnique({
      where: { id: membership.venue.id },
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

  if (!updatedVenue) {
    throw new Error('Заведение не найдено')
  }

  return updatedVenue
}

export function isVenueProfileError(error: unknown): error is VenueProfileError {
  return error instanceof VenueProfileError
}
