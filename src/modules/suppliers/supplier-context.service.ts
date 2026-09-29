import { AccountType, MembershipStatus } from '../../generated/prisma'
import { prisma } from '../../lib/prisma'
import type { AuthPayload } from '../../middleware/auth'

class SupplierContextError extends Error {
  code: string
  status: number

  constructor(params: { code: string; message: string; status?: number }) {
    super(params.message)
    this.code = params.code
    this.status = params.status ?? 400
  }
}

function formatUserFullName(
  profile:
    | {
        firstName: string
        lastName: string
        middleName: string | null
      }
    | null
    | undefined
) {
  if (!profile) return ''

  return [profile.lastName, profile.firstName, profile.middleName]
    .filter(Boolean)
    .join(' ')
}

function formatSupplierMembership(
  membership: NonNullable<
    Awaited<ReturnType<typeof findSupplierMembershipsForUser>>
  >[number]
) {
  const supplier = membership.supplier

  return {
    id: supplier.id,
    publicId: supplier.publicId,
    name: supplier.name,
    catalogName: supplier.catalogName,
    city: supplier.city,
    address: supplier.address,
    description: supplier.description,
    phone: supplier.phone,
    email: supplier.email,
    website: supplier.website,
    showPhoneInCard: supplier.showPhoneInCard,
    planName: supplier.planName,
    planStatus: supplier.planStatus,
    promoBalance: supplier.promoBalance,
    isActive: supplier.isActive,
    mainPhotoFileId: supplier.mainPhotoFileId,
    membership: {
      id: membership.id,
      displayRole: membership.displayRole,
      accessLevel: membership.accessLevel,
      status: membership.status,
      notifyByEmail: membership.notifyByEmail,
      notifyByMessenger: membership.notifyByMessenger,
      messengerType: membership.messengerType,
      messengerContact: membership.messengerContact,
    },
    company: supplier.business
      ? {
          id: supplier.business.id,
          name: supplier.business.name,
          taxNumber: supplier.business.taxNumber,
          legalAddress: supplier.business.legalAddress,
        }
      : null,
    photos: supplier.photos.map((photo) => ({
      id: photo.id,
      fileAssetId: photo.fileAssetId,
      storageKey: photo.fileAsset.storageKey,
      fileName: photo.fileAsset.fileName,
      mimeType: photo.fileAsset.mimeType,
    })),
  }
}

function findSupplierMembershipsForUser(userId: string) {
  return prisma.supplierMembership.findMany({
    where: {
      userId,
      status: {
        in: [MembershipStatus.ACTIVE, MembershipStatus.PENDING],
      },
    },
    include: {
      supplier: {
        include: {
          business: true,
          photos: {
            orderBy: {
              sortOrder: 'asc',
            },
            take: 3,
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
    orderBy: {
      createdAt: 'asc',
    },
  })
}

export async function getUserSupplierContext(auth: AuthPayload) {
  if (auth.type !== 'user') {
    throw new SupplierContextError({
      code: 'INSUFFICIENT_PERMISSIONS',
      message: 'Просматривать контекст поставщика могут только авторизованные пользователи',
      status: 403,
    })
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: {
      id: true,
      publicId: true,
      phone: true,
      status: true,
      accountType: true,
      profile: {
        select: {
          firstName: true,
          lastName: true,
          middleName: true,
          avatarFileId: true,
        },
      },
    },
  })

  if (!user) {
    throw new SupplierContextError({
      code: 'USER_NOT_FOUND',
      message: 'Пользователь не найден',
      status: 404,
    })
  }

  if (user.accountType !== AccountType.SUPPLIER_STAFF) {
    throw new SupplierContextError({
      code: 'SUPPLIER_CONTEXT_NOT_AVAILABLE',
      message: 'Пользователь не относится к контексту поставщика',
      status: 403,
    })
  }

  const memberships = await findSupplierMembershipsForUser(user.id)
  const activeMemberships = memberships.filter(
    (membership) =>
      membership.status === MembershipStatus.ACTIVE && membership.supplier.isActive
  )
  const activeMembership = activeMemberships[0] ?? null

  return {
    user: {
      id: user.id,
      publicId: user.publicId,
      phone: user.phone,
      status: user.status,
      accountType: user.accountType,
      fullName: formatUserFullName(user.profile),
      avatarFileId: user.profile?.avatarFileId ?? null,
    },
    activeSupplierId: activeMembership?.supplierId ?? null,
    activeSupplier: activeMembership
      ? formatSupplierMembership(activeMembership)
      : null,
    suppliers: memberships.map(formatSupplierMembership),
    dropdownSuppliers: activeMemberships.map((membership) => ({
      id: membership.supplier.id,
      publicId: membership.supplier.publicId,
      name: membership.supplier.catalogName || membership.supplier.name,
      city: membership.supplier.city,
    })),
  }
}

export function isSupplierContextError(
  error: unknown
): error is SupplierContextError {
  return error instanceof SupplierContextError
}

