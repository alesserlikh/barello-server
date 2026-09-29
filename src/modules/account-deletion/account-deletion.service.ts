import { prisma } from '../../lib/prisma'
import {
  AccountDeletionRequestStatus,
  AccountType,
  MembershipStatus,
  Prisma,
  UserStatus,
} from '../../generated/prisma'
import type { AuthPayload } from '../../middleware/auth'

const ACCOUNT_DELETION_RETENTION_DAYS = 90

export type ModeratorContext = {
  id: string
  email: string
  name: string
  role: string
}

export class AccountDeletionError extends Error {
  code: string
  status: number

  constructor(params: { code: string; message: string; status?: number }) {
    super(params.message)
    this.code = params.code
    this.status = params.status ?? 400
  }
}

type AccountDeletionRequestWithUser = Prisma.AccountDeletionRequestGetPayload<{
  include: {
    user: {
      include: {
        profile: true
      }
    }
  }
}>

function addRetentionDays(date: Date) {
  return new Date(date.getTime() + ACCOUNT_DELETION_RETENTION_DAYS * 24 * 60 * 60 * 1000)
}

function formatFullName(
  profile:
    | {
        firstName: string
        lastName: string
        middleName: string | null
      }
    | null
    | undefined
) {
  if (!profile) {
    return ''
  }

  return [profile.lastName, profile.firstName, profile.middleName]
    .filter(Boolean)
    .join(' ')
}

function formatAccountDeletionRequest(
  request: AccountDeletionRequestWithUser
) {
  return {
    id: request.id,
    userId: request.userId,
    status: request.status,
    requestedReason: request.requestedReason,
    requestedAt: request.requestedAt.toISOString(),
    scheduledDeletionAt: request.scheduledDeletionAt.toISOString(),
    executedAt: request.executedAt?.toISOString() ?? null,
    executedByModeratorId: request.executedByModeratorId ?? null,
    executedByModeratorEmail: request.executedByModeratorEmail ?? null,
    executionReason: request.executionReason ?? null,
    cancelledAt: request.cancelledAt?.toISOString() ?? null,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    user: {
      id: request.user.id,
      fullName: formatFullName(request.user.profile),
      phone: request.user.phone,
      email: request.user.email,
      status: request.user.status,
      accountType: request.user.accountType,
    },
  }
}

async function revokeUserAccess(tx: Prisma.TransactionClient, userId: string) {
  await tx.userVenueMembership.updateMany({
    where: {
      userId,
      membershipStatus: {
        not: MembershipStatus.REVOKED,
      },
    },
    data: {
      membershipStatus: MembershipStatus.REVOKED,
    },
  })

  await tx.supplierMembership.updateMany({
    where: {
      userId,
      status: {
        not: MembershipStatus.REVOKED,
      },
    },
    data: {
      status: MembershipStatus.REVOKED,
    },
  })

  await tx.authSession.deleteMany({
    where: {
      userId,
    },
  })
}

async function purgeUserData(tx: Prisma.TransactionClient, userId: string) {
  await revokeUserAccess(tx, userId)

  await tx.verificationCode.deleteMany({
    where: {
      userId,
    },
  })

  await tx.registrationDraft.deleteMany({
    where: {
      userId,
    },
  })

  await tx.userProfile.deleteMany({
    where: {
      userId,
    },
  })

  await tx.user.update({
    where: {
      id: userId,
    },
    data: {
      phone: null,
      email: null,
      emailVerifiedAt: null,
      passwordHash: null,
      status: UserStatus.BLOCKED,
      accountType: AccountType.UNIDENTIFIED,
      activeVenueId: null,
      defaultVenueId: null,
      lastLoginAt: null,
    },
  })
}

async function getPendingAccountDeletionRequest(
  tx: Prisma.TransactionClient,
  userId: string
) {
  return tx.accountDeletionRequest.findFirst({
    where: {
      userId,
      status: AccountDeletionRequestStatus.PENDING,
    },
    include: {
      user: {
        include: {
          profile: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  })
}

export async function requestAccountDeletion(
  auth: AuthPayload,
  input?: { reason?: string }
) {
  const requestId = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: {
        id: auth.userId,
      },
      include: {
        profile: true,
      },
    })

    if (!user) {
      throw new AccountDeletionError({
        code: 'USER_NOT_FOUND',
        message: 'Пользователь не найден',
        status: 404,
      })
    }

    const existingRequest = await getPendingAccountDeletionRequest(tx, user.id)

    await tx.user.update({
      where: {
        id: user.id,
      },
      data: {
        status: UserStatus.BLOCKED,
      },
    })

    await revokeUserAccess(tx, user.id)

    if (existingRequest) {
      return existingRequest.id
    }

    const request = await tx.accountDeletionRequest.create({
      data: {
        userId: user.id,
        requestedReason: input?.reason?.trim() || null,
        scheduledDeletionAt: addRetentionDays(new Date()),
      },
      include: {
        user: {
          include: {
            profile: true,
          },
        },
      },
    })

    await tx.auditLog.create({
      data: {
        actorType: 'USER',
        actorUserId: user.id,
        entityType: 'ACCOUNT_DELETION_REQUEST',
        entityId: request.id,
        action: 'ACCOUNT_DELETION_REQUESTED',
        payload: {
          scheduledDeletionAt: request.scheduledDeletionAt.toISOString(),
        },
      },
    })

    return request.id
  })

  const result = await prisma.accountDeletionRequest.findUnique({
    where: {
      id: requestId,
    },
    include: {
      user: {
        include: {
          profile: true,
        },
      },
    },
  })

  if (!result) {
    throw new AccountDeletionError({
      code: 'ACCOUNT_DELETION_REQUEST_NOT_FOUND',
      message: 'Заявка на удаление аккаунта не найдена',
      status: 404,
    })
  }

  return {
    ok: true as const,
    deletionRequest: formatAccountDeletionRequest(result),
  }
}

export async function getOwnAccountDeletionRequest(auth: AuthPayload) {
  const request = await prisma.accountDeletionRequest.findFirst({
    where: {
      userId: auth.userId,
      status: AccountDeletionRequestStatus.PENDING,
    },
    include: {
      user: {
        include: {
          profile: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  })

  return {
    ok: true as const,
    deletionRequest: request ? formatAccountDeletionRequest(request) : null,
  }
}

export async function listAccountDeletionRequests() {
  const requests = await prisma.accountDeletionRequest.findMany({
    include: {
      user: {
        include: {
          profile: true,
        },
      },
    },
    orderBy: [
      {
        status: 'asc',
      },
      {
        requestedAt: 'desc',
      },
    ],
  })

  return requests.map(formatAccountDeletionRequest)
}

export async function executeAccountDeletionRequest(
  requestId: string,
  moderator: ModeratorContext,
  input?: { reason?: string }
) {
  const result = await prisma.$transaction(async (tx) => {
    const request = await tx.accountDeletionRequest.findUnique({
      where: {
        id: requestId,
      },
      include: {
        user: {
          include: {
            profile: true,
          },
        },
      },
    })

    if (!request) {
      throw new AccountDeletionError({
        code: 'ACCOUNT_DELETION_REQUEST_NOT_FOUND',
        message: 'Заявка на удаление аккаунта не найдена',
        status: 404,
      })
    }

    if (request.status === AccountDeletionRequestStatus.EXECUTED) {
      return request
    }

    await purgeUserData(tx, request.userId)

    const updatedRequest = await tx.accountDeletionRequest.update({
      where: {
        id: request.id,
      },
      data: {
        status: AccountDeletionRequestStatus.EXECUTED,
        executedAt: new Date(),
        executedByModeratorId: moderator.id,
        executedByModeratorEmail: moderator.email,
        executionReason: input?.reason?.trim() || null,
      },
      include: {
        user: {
          include: {
            profile: true,
          },
        },
      },
    })

    await tx.auditLog.create({
      data: {
        actorType: 'SYSTEM',
        entityType: 'ACCOUNT_DELETION_REQUEST',
        entityId: updatedRequest.id,
        action: 'ACCOUNT_DELETION_EXECUTED',
        payload: {
          moderatorId: moderator.id,
          moderatorEmail: moderator.email,
          executionReason: updatedRequest.executionReason,
        },
      },
    })

    return updatedRequest
  })

  return {
    ok: true as const,
    deletionRequest: formatAccountDeletionRequest(result),
  }
}

export async function executeDueAccountDeletionRequests() {
  const dueRequests = await prisma.accountDeletionRequest.findMany({
    where: {
      status: AccountDeletionRequestStatus.PENDING,
      scheduledDeletionAt: {
        lte: new Date(),
      },
    },
    orderBy: {
      scheduledDeletionAt: 'asc',
    },
    select: {
      id: true,
    },
  })

  let processed = 0

  for (const request of dueRequests) {
    await executeAccountDeletionRequest(request.id, {
      id: 'system-retention-job',
      email: 'system@barello.local',
      name: 'System retention job',
      role: 'SYSTEM',
    })
    processed += 1
  }

  return {
    ok: true as const,
    processed,
  }
}

export function isAccountDeletionError(error: unknown): error is AccountDeletionError {
  return error instanceof AccountDeletionError
}

