import { Router } from 'express'
import {
  createRegistrationDraft,
  getDraftVerification,
  getRegistrationDraft,
  getRegistrationDraftStatus,
  isRegistrationError,
  lookupDraftInn,
  resolveInviteToken,
  sendDraftOtp,
  updateDraftFullName,
  updateDraftPhone,
  updateDraftRole,
  verifyDraftOtp,
} from './registration-draft.service'
import {
  confirmInviteStaff,
  confirmSupplierCreate,
  confirmSupplierExistingCompany,
  confirmSupplierNotFound,
  confirmVenueCreate,
  confirmVenueExistingJoin,
  confirmVenueExistingNoOwner,
  confirmVenueExistingOwner,
  confirmVenueNotFound,
} from './registration-confirm.service'

const registrationRouter = Router()

function getSessionContext(req: Parameters<typeof registrationRouter.post>[1] extends (
  req: infer R,
  res: any
) => any
  ? R
  : never) {
  return {
    userAgent:
      typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    ipAddress: req.ip,
  }
}

function buildRegistrationErrorResponse(error: {
  code: string
  message: string
  nextStep: string
  redirectTo?: string
  phone?: string
  otpExpiresAt?: string
  resendAvailableAt?: string
}) {
  return {
    error: {
      code: error.code,
      message: error.code,
    },
    nextStep: error.nextStep,
    ...(error.redirectTo ? { redirectTo: error.redirectTo } : {}),
    ...(error.phone ? { phone: error.phone } : {}),
    ...(error.otpExpiresAt ? { otpExpiresAt: error.otpExpiresAt } : {}),
    ...(error.resendAvailableAt
      ? { resendAvailableAt: error.resendAvailableAt }
      : {}),
  }
}
function handleRegistrationError(
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

  if (isRegistrationError(error)) {
    res.status(error.status).json(buildRegistrationErrorResponse(error))
    return
  }

  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'INTERNAL_SERVER_ERROR',
    },
    nextStep: 'BLOCKED',
  })
}

registrationRouter.post('/registration-drafts', async (req, res) => {
  try {
    const result = await createRegistrationDraft(req.body)
    res.status(201).json(result)
  } catch (error) {
    handleRegistrationError(error, 'POST /registration-drafts', res)
  }
})

registrationRouter.post('/registration-drafts/invite-token/resolve', async (req, res) => {
  try {
    const result = await resolveInviteToken(req.body)
    res.status(201).json(result)
  } catch (error) {
    handleRegistrationError(
      error,
      'POST /registration-drafts/invite-token/resolve',
      res
    )
  }
})

registrationRouter.get('/registration-drafts/:draftId', async (req, res) => {
  try {
    const result = await getRegistrationDraft(req.params.draftId)
    res.status(200).json(result)
  } catch (error) {
    handleRegistrationError(error, 'GET /registration-drafts/:draftId', res)
  }
})

registrationRouter.get('/registration-drafts/:draftId/status', async (req, res) => {
  try {
    const result = await getRegistrationDraftStatus(req.params.draftId)
    res.status(200).json(result)
  } catch (error) {
    handleRegistrationError(error, 'GET /registration-drafts/:draftId/status', res)
  }
})

registrationRouter.patch('/registration-drafts/:draftId/full-name', async (req, res) => {
  try {
    const result = await updateDraftFullName(req.params.draftId, req.body)
    res.status(200).json(result)
  } catch (error) {
    handleRegistrationError(error, 'PATCH /registration-drafts/:draftId/full-name', res)
  }
})

registrationRouter.patch('/registration-drafts/:draftId/phone', async (req, res) => {
  try {
    const result = await updateDraftPhone(req.params.draftId, req.body)
    res.status(200).json(result)
  } catch (error) {
    handleRegistrationError(error, 'PATCH /registration-drafts/:draftId/phone', res)
  }
})

registrationRouter.post('/registration-drafts/:draftId/otp/send', async (req, res) => {
  try {
    const result = await sendDraftOtp(req.params.draftId)
    res.status(200).json(result)
  } catch (error) {
    handleRegistrationError(error, 'POST /registration-drafts/:draftId/otp/send', res)
  }
})

registrationRouter.post('/registration-drafts/:draftId/otp/verify', async (req, res) => {
  try {
    const result = await verifyDraftOtp(req.params.draftId, req.body)
    res.status(200).json(result)
  } catch (error) {
    handleRegistrationError(error, 'POST /registration-drafts/:draftId/otp/verify', res)
  }
})

registrationRouter.patch('/registration-drafts/:draftId/role', async (req, res) => {
  try {
    const result = await updateDraftRole(req.params.draftId, req.body)
    res.status(200).json(result)
  } catch (error) {
    handleRegistrationError(error, 'PATCH /registration-drafts/:draftId/role', res)
  }
})

registrationRouter.post('/registration-drafts/:draftId/inn/lookup', async (req, res) => {
  try {
    const result = await lookupDraftInn(req.params.draftId, req.body)
    res.status(200).json(result)
  } catch (error) {
    handleRegistrationError(error, 'POST /registration-drafts/:draftId/inn/lookup', res)
  }
})

registrationRouter.get('/registration-drafts/:draftId/verification', async (req, res) => {
  try {
    const result = await getDraftVerification(req.params.draftId)
    res.status(200).json(result)
  } catch (error) {
    handleRegistrationError(
      error,
      'GET /registration-drafts/:draftId/verification',
      res
    )
  }
})

registrationRouter.post(
  '/registration-drafts/:draftId/confirm/supplier-create',
  async (req, res) => {
    try {
      const result = await confirmSupplierCreate(
        req.params.draftId,
        req.body,
        getSessionContext(req)
      )
      res.status(201).json(result)
    } catch (error) {
      handleRegistrationError(
        error,
        'POST /registration-drafts/:draftId/confirm/supplier-create',
        res
      )
    }
  }
)

registrationRouter.post(
  '/registration-drafts/:draftId/confirm/supplier-existing-company',
  async (req, res) => {
    try {
      const result = await confirmSupplierExistingCompany(
        req.params.draftId,
        getSessionContext(req)
      )
      res.status(201).json(result)
    } catch (error) {
      handleRegistrationError(
        error,
        'POST /registration-drafts/:draftId/confirm/supplier-existing-company',
        res
      )
    }
  }
)

registrationRouter.post(
  '/registration-drafts/:draftId/confirm/supplier-not-found',
  async (req, res) => {
    try {
      const result = await confirmSupplierNotFound(
        req.params.draftId,
        req.body,
        getSessionContext(req)
      )
      res.status(201).json(result)
    } catch (error) {
      handleRegistrationError(
        error,
        'POST /registration-drafts/:draftId/confirm/supplier-not-found',
        res
      )
    }
  }
)

registrationRouter.post('/registration-drafts/:draftId/confirm/venue-create', async (req, res) => {
  try {
    const result = await confirmVenueCreate(
      req.params.draftId,
      req.body,
      getSessionContext(req)
    )
    res.status(201).json(result)
  } catch (error) {
    handleRegistrationError(error, 'POST /registration-drafts/:draftId/confirm/venue-create', res)
  }
})

registrationRouter.post(
  '/registration-drafts/:draftId/confirm/venue-existing-owner',
  async (req, res) => {
    try {
      const result = await confirmVenueExistingOwner(req.params.draftId, req.body)
      res.status(200).json(result)
    } catch (error) {
      handleRegistrationError(
        error,
        'POST /registration-drafts/:draftId/confirm/venue-existing-owner',
        res
      )
    }
  }
)

registrationRouter.post(
  '/registration-drafts/:draftId/confirm/venue-existing-no-owner',
  async (req, res) => {
    try {
      const result = await confirmVenueExistingNoOwner(
        req.params.draftId,
        getSessionContext(req)
      )
      res.status(201).json(result)
    } catch (error) {
      handleRegistrationError(
        error,
        'POST /registration-drafts/:draftId/confirm/venue-existing-no-owner',
        res
      )
    }
  }
)

registrationRouter.post(
  '/registration-drafts/:draftId/confirm/venue-existing-join',
  async (req, res) => {
    try {
      const result = await confirmVenueExistingJoin(
        req.params.draftId,
        getSessionContext(req)
      )
      res.status(201).json(result)
    } catch (error) {
      handleRegistrationError(
        error,
        'POST /registration-drafts/:draftId/confirm/venue-existing-join',
        res
      )
    }
  }
)

registrationRouter.post(
  '/registration-drafts/:draftId/confirm/venue-not-found',
  async (req, res) => {
    try {
      const result = await confirmVenueNotFound(
        req.params.draftId,
        req.body,
        getSessionContext(req)
      )
      res.status(201).json(result)
    } catch (error) {
      handleRegistrationError(
        error,
        'POST /registration-drafts/:draftId/confirm/venue-not-found',
        res
      )
    }
  }
)

registrationRouter.post(
  '/registration-drafts/:draftId/confirm/invite-staff',
  async (req, res) => {
    try {
      const result = await confirmInviteStaff(
        req.params.draftId,
        getSessionContext(req)
      )
      res.status(201).json(result)
    } catch (error) {
      handleRegistrationError(
        error,
        'POST /registration-drafts/:draftId/confirm/invite-staff',
        res
      )
    }
  }
)

export default registrationRouter


