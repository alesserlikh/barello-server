import { Router } from 'express'
import { requireAuth } from '../../middleware/auth'
import {
  acceptStaffInvitation,
  createStaffInvitation,
  isStaffInvitationError,
  listStaffInvitations,
  markStaffInvitationSent,
  regenerateStaffInvitationToken,
  revokeStaffInvitation,
} from './staff-invitations.service'

const staffInvitationsRouter = Router()

function handleStaffInvitationError(
  error: unknown,
  route: string,
  res: Parameters<Router['get']>[1] extends (
    req: any,
    res: infer R
  ) => any
    ? R
    : never
) {
  console.error(`${route} failed:`, error)

  if (isStaffInvitationError(error)) {
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
      },
    })
    return
  }

  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Внутренняя ошибка сервера',
    },
  })
}

staffInvitationsRouter.post(
  '/venues/:venueId/staff-invitations',
  requireAuth,
  async (req, res) => {
    try {
      const result = await createStaffInvitation(
        req.auth!,
        String(req.params.venueId),
        req.body
      )
      res.status(201).json(result)
    } catch (error) {
      handleStaffInvitationError(
        error,
        'POST /venues/:venueId/staff-invitations',
        res
      )
    }
  }
)

staffInvitationsRouter.get(
  '/venues/:venueId/staff-invitations',
  requireAuth,
  async (req, res) => {
    try {
      const result = await listStaffInvitations(req.auth!, String(req.params.venueId))
      res.status(200).json(result)
    } catch (error) {
      handleStaffInvitationError(
        error,
        'GET /venues/:venueId/staff-invitations',
        res
      )
    }
  }
)

staffInvitationsRouter.post(
  '/staff-invitations/:invitationId/mark-sent',
  requireAuth,
  async (req, res) => {
    try {
      const result = await markStaffInvitationSent(
        req.auth!,
        String(req.params.invitationId)
      )
      res.status(200).json(result)
    } catch (error) {
      handleStaffInvitationError(
        error,
        'POST /staff-invitations/:invitationId/mark-sent',
        res
      )
    }
  }
)

staffInvitationsRouter.post(
  '/staff-invitations/:invitationId/regenerate-token',
  requireAuth,
  async (req, res) => {
    try {
      const result = await regenerateStaffInvitationToken(
        req.auth!,
        String(req.params.invitationId)
      )
      res.status(200).json(result)
    } catch (error) {
      handleStaffInvitationError(
        error,
        'POST /staff-invitations/:invitationId/regenerate-token',
        res
      )
    }
  }
)

staffInvitationsRouter.post(
  '/staff-invitations/:invitationId/revoke',
  requireAuth,
  async (req, res) => {
    try {
      const result = await revokeStaffInvitation(req.auth!, String(req.params.invitationId))
      res.status(200).json(result)
    } catch (error) {
      handleStaffInvitationError(
        error,
        'POST /staff-invitations/:invitationId/revoke',
        res
      )
    }
  }
)

staffInvitationsRouter.post('/staff-invitations/accept', requireAuth, async (req, res) => {
  try {
    const result = await acceptStaffInvitation(req.auth!, req.body)
    res.status(200).json(result)
  } catch (error) {
    handleStaffInvitationError(error, 'POST /staff-invitations/accept', res)
  }
})

export default staffInvitationsRouter


