import type { Notification } from '../../generated/prisma'
import { apiError } from '../../lib/api-error'
import { prisma } from '../../lib/prisma'
import type { AuthPayload } from '../../middleware/auth'
import { getProfilePermissionsForAuth } from '../profile/profile-permissions.service'

export class NotificationError extends Error {
  code: 'NOTIFICATION_NOT_FOUND' | 'SECTION_FORBIDDEN'
  status: number

  constructor(params: {
    code: 'NOTIFICATION_NOT_FOUND' | 'SECTION_FORBIDDEN'
    message: string
    status: number
  }) {
    super(params.message)
    this.name = 'NotificationError'
    this.code = params.code
    this.status = params.status
  }
}

async function requireNotificationsSection(auth: AuthPayload) {
  const { permissions } = await getProfilePermissionsForAuth(auth).catch(() => {
    throw new NotificationError({
      code: 'SECTION_FORBIDDEN',
      message: 'Notifications section is forbidden',
      status: 403,
    })
  })

  if (!permissions.profileSections.notifications) {
    throw new NotificationError({
      code: 'SECTION_FORBIDDEN',
      message: 'Notifications section is forbidden',
      status: 403,
    })
  }

  if (auth.type !== 'user') {
    throw new NotificationError({
      code: 'SECTION_FORBIDDEN',
      message: 'Notifications section is forbidden',
      status: 403,
    })
  }

  return auth.userId
}

function mapNotification(notification: Notification) {
  const hasRelatedEntity =
    Boolean(notification.relatedEntityType) &&
    Boolean(notification.relatedEntityId)

  return {
    id: notification.id,
    title: notification.title,
    description: notification.description,
    type: notification.type,
    isRead: notification.isRead,
    createdAt: notification.createdAt.toISOString(),
    relatedEntity: hasRelatedEntity
      ? {
          type: notification.relatedEntityType!,
          id: notification.relatedEntityId!,
          ...(notification.relatedEntityRoute
            ? { route: notification.relatedEntityRoute }
            : {}),
        }
      : null,
  }
}

function notFound(): never {
  throw new NotificationError({
    code: 'NOTIFICATION_NOT_FOUND',
    message: 'Notification was not found',
    status: 404,
  })
}

export async function getNotificationsSummary(auth: AuthPayload) {
  const userId = await requireNotificationsSection(auth)
  const unreadCount = await prisma.notification.count({
    where: { userId, isRead: false },
  })

  return { unreadCount }
}

export async function listNotifications(auth: AuthPayload) {
  const userId = await requireNotificationsSection(auth)
  const notifications = await prisma.notification.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })

  return notifications.map(mapNotification)
}

export async function getNotification(auth: AuthPayload, notificationId: string) {
  const userId = await requireNotificationsSection(auth)
  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
  })

  if (!notification) notFound()
  return mapNotification(notification)
}

export async function markNotificationRead(
  auth: AuthPayload,
  notificationId: string,
) {
  const userId = await requireNotificationsSection(auth)
  const result = await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { isRead: true, readAt: new Date() },
  })

  if (result.count === 0) notFound()
  return getNotification(auth, notificationId)
}

export async function markAllNotificationsRead(auth: AuthPayload) {
  const userId = await requireNotificationsSection(auth)
  const result = await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  })

  return { updatedCount: result.count, unreadCount: 0 }
}

export function mapNotificationError(error: unknown) {
  if (error instanceof NotificationError) {
    return { status: error.status, body: apiError(error.code, error.message) }
  }

  return {
    status: 500,
    body: apiError('NOTIFICATION_REQUEST_FAILED', 'Notification request failed'),
  }
}