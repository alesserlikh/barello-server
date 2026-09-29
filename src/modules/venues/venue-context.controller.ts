import { Router } from 'express'
import { requireAuth } from '../../middleware/auth'
import {
  clearDefaultVenue,
  getUserVenueContext,
  isVenueContextError,
  setActiveVenue,
  setDefaultVenue,
} from './venue-context.service'
import { addVenueForCurrentUser, isVenueError } from './venues.service'
import {
  isVenueStaffError,
  listVenueStaff,
  normalizeUpdateVenueStaffMembershipInput,
  updateVenueStaffMembership,
} from './venue-staff.service'
import {
  getVenueProfile,
  isVenueProfileError,
  updateVenueProfile,
} from '../profile/venue-profile.service'

const venueContextRouter = Router()

function handleVenueContextError(
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

  if (isVenueContextError(error)) {
    res.status(error.status).json({
      ok: false,
      error: {
        code: error.code,
        message: error.message,
      },
    })
    return
  }

  if (isVenueError(error)) {
    res.status(error.status).json({
      ok: false,
      warning: error.warning,
      error: {
        code: error.code,
        message: error.message,
      },
    })
    return
  }

  if (isVenueStaffError(error)) {
    res.status(error.status).json({
      ok: false,
      error: {
        code: error.code,
        message: error.message,
      },
    })
    return
  }

  if (isVenueProfileError(error)) {
    res.status(error.status).json({
      ok: false,
      error: {
        code: error.code,
        message: error.message,
      },
    })
    return
  }

  res.status(500).json({
    ok: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Внутренняя ошибка сервера',
    },
  })
}

venueContextRouter.get('/me/venue-context', requireAuth, async (req, res) => {
  try {
    const context = await getUserVenueContext(req.auth!.userId)

    res.status(200).json({
      ok: true,
      ...context,
    })
  } catch (error) {
    handleVenueContextError(error, 'GET /me/venue-context', res)
  }
})

venueContextRouter.post('/venues', requireAuth, async (req, res) => {
  try {
    const result = await addVenueForCurrentUser(req.auth!, req.body)

    res.status(201).json({
      ok: true,
      ...result,
    })
  } catch (error) {
    handleVenueContextError(error, 'POST /venues', res)
  }
})

venueContextRouter.get('/venues/:venueId/staff', requireAuth, async (req, res) => {
  try {
    const result = await listVenueStaff(req.auth!, String(req.params.venueId))

    res.status(200).json({
      ok: true,
      ...result,
    })
  } catch (error) {
    handleVenueContextError(error, 'GET /venues/:venueId/staff', res)
  }
})

venueContextRouter.get(
  '/venues/:venueId/profile',
  requireAuth,
  async (req, res) => {
    try {
      const venue = await getVenueProfile(req.auth!, String(req.params.venueId))

      res.status(200).json({
        ok: true,
        venue,
      })
    } catch (error) {
      handleVenueContextError(error, 'GET /venues/:venueId/profile', res)
    }
  }
)

venueContextRouter.patch(
  '/venues/:venueId/profile',
  requireAuth,
  async (req, res) => {
    try {
      const venue = await updateVenueProfile(
        req.auth!,
        String(req.params.venueId),
        req.body
      )

      res.status(200).json({
        ok: true,
        venue,
      })
    } catch (error) {
      handleVenueContextError(error, 'PATCH /venues/:venueId/profile', res)
    }
  }
)

venueContextRouter.patch(
  '/venues/:venueId/staff/:membershipId',
  requireAuth,
  async (req, res) => {
    try {
      const result = await updateVenueStaffMembership(
        req.auth!,
        String(req.params.venueId),
        String(req.params.membershipId),
        normalizeUpdateVenueStaffMembershipInput(req.body)
      )

      res.status(200).json({
        ok: true,
        ...result,
      })
    } catch (error) {
      handleVenueContextError(
        error,
        'PATCH /venues/:venueId/staff/:membershipId',
        res
      )
    }
  }
)

venueContextRouter.patch('/me/active-venue', requireAuth, async (req, res) => {
  try {
    const venueId = typeof req.body?.venueId === 'string' ? req.body.venueId : ''

    if (!venueId) {
      res.status(400).json({
        ok: false,
        error: {
          code: 'VENUE_ID_REQUIRED',
          message: 'Не выбрано заведение',
        },
      })
      return
    }

    const context = await setActiveVenue(req.auth!.userId, venueId)

    res.status(200).json({
      ok: true,
      ...context,
    })
  } catch (error) {
    handleVenueContextError(error, 'PATCH /me/active-venue', res)
  }
})

venueContextRouter.patch('/me/default-venue', requireAuth, async (req, res) => {
  try {
    const hasVenueId =
      Boolean(req.body) &&
      Object.prototype.hasOwnProperty.call(req.body, 'venueId')
    const venueId = hasVenueId ? req.body.venueId : undefined

    if (!hasVenueId || (venueId !== null && typeof venueId !== 'string')) {
      res.status(400).json({
        ok: false,
        error: {
          code: 'VENUE_ID_REQUIRED',
          message: 'Идентификатор заведения обязателен и должен быть строкой с ID заведения или null',
        },
      })
      return
    }

    const context =
      venueId === null
        ? await clearDefaultVenue(req.auth!.userId)
        : await setDefaultVenue(req.auth!.userId, venueId)

    res.status(200).json({
      ok: true,
      ...context,
    })
  } catch (error) {
    handleVenueContextError(error, 'PATCH /me/default-venue', res)
  }
})

export default venueContextRouter


