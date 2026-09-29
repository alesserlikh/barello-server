import { prisma } from '../../lib/prisma'
import {
  assertUserOwnsFileAssets,
  FileAssetValidationError,
  findFileAssetViewById,
} from './profile-media.service'

type UpdateMyProfileInput = {
  firstName?: string
  lastName?: string
  middleName?: string
  avatarFileId?: string | null
}

export async function updateMyProfile(userId: string, input: UpdateMyProfileInput) {
  const existingProfile = await prisma.userProfile.findUnique({
    where: { userId },
  })

  if (!existingProfile) {
    throw new Error('Profile not found')
  }

  if (input.avatarFileId !== undefined && input.avatarFileId !== null) {
    try {
      await assertUserOwnsFileAssets(userId, input.avatarFileId)
    } catch (error) {
      if (
        error instanceof FileAssetValidationError &&
        error.code === 'FILE_NOT_FOUND'
      ) {
        throw new Error('Avatar file not found')
      }

      if (
        error instanceof FileAssetValidationError &&
        error.code === 'FILE_NOT_OWNED'
      ) {
        throw new Error('Avatar file does not belong to the current user')
      }

      throw error
    }
  }

  const updatedUser = await prisma.$transaction(async (tx) => {
    await tx.userProfile.update({
      where: { userId },
      data: {
        firstName: input.firstName ?? existingProfile.firstName,
        lastName: input.lastName ?? existingProfile.lastName,
        middleName: input.middleName ?? existingProfile.middleName,
        avatarFileId:
          input.avatarFileId === undefined
            ? existingProfile.avatarFileId
            : input.avatarFileId,
      },
    })

    return tx.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        memberships: {
          include: {
            venue: true,
          },
        },
      },
    })
  })

  if (!updatedUser) {
    throw new Error('User not found')
  }

  const avatar = await findFileAssetViewById(updatedUser.profile?.avatarFileId)
  const { passwordHash, ...safeUser } = updatedUser

  return {
    ...safeUser,
    avatar,
  }
}

export async function getMyProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      profile: true,
      memberships: {
        include: {
          venue: true,
        },
      },
    },
  })

  if (!user) {
    throw new Error('User not found')
  }

  const avatar = await findFileAssetViewById(user.profile?.avatarFileId)
  const { passwordHash, ...safeUser } = user

  return {
    ...safeUser,
    avatar,
  }
}
