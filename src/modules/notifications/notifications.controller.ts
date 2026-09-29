import { Router } from 'express'
import { requireAuth } from '../../middleware/auth'
import {
  getNotification,
  getNotificationsSummary,
  listNotifications,
  mapNotificationError,
  markAllNotificationsRead,
  markNotificationRead,
} from './notifications.service'

const notificationsRouter = Router()

notificationsRouter.get('/notifications/summary', requireAuth, async (req, res) => {
  try {
    const summary = await getNotificationsSummary(req.auth!)
    res.status(200).json({ ok: true, ...summary })
  } catch (error) {
    const response = mapNotificationError(error)
    res.status(response.status).json(response.body)
  }
})

notificationsRouter.get('/notifications', requireAuth, async (req, res) => {
  try {
    const notifications = await listNotifications(req.auth!)
    res.status(200).json({ ok: true, notifications })
  } catch (error) {
    const response = mapNotificationError(error)
    res.status(response.status).json(response.body)
  }
})

notificationsRouter.patch('/notifications/read-all', requireAuth, async (req, res) => {
  try {
    const result = await markAllNotificationsRead(req.auth!)
    res.status(200).json({ ok: true, ...result })
  } catch (error) {
    const response = mapNotificationError(error)
    res.status(response.status).json(response.body)
  }
})

notificationsRouter.get('/notifications/:id', requireAuth, async (req, res) => {
  try {
    const notification = await getNotification(req.auth!, String(req.params.id))
    res.status(200).json({ ok: true, notification })
  } catch (error) {
    const response = mapNotificationError(error)
    res.status(response.status).json(response.body)
  }
})

notificationsRouter.patch('/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    const notification = await markNotificationRead(req.auth!, String(req.params.id))
    res.status(200).json({ ok: true, notification })
  } catch (error) {
    const response = mapNotificationError(error)
    res.status(response.status).json(response.body)
  }
})

export default notificationsRouter