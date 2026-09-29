export const AUTH_PUBLIC_API_ROUTES = {
  loginStart: { method: 'POST', path: '/auth/login/start' },
  loginCheckPhone: { method: 'POST', path: '/auth/login/check-phone' },
  loginResend: { method: 'POST', path: '/auth/login/resend' },
  loginVerify: { method: 'POST', path: '/auth/login/verify' },
  refresh: { method: 'POST', path: '/auth/refresh' },
  logout: { method: 'POST', path: '/auth/logout' },
  me: { method: 'GET', path: '/auth/me' },
} as const

export const REGISTRATION_DRAFT_PUBLIC_API_PREFIX = '/registration-drafts'

export const REGISTRATION_DRAFT_PUBLIC_API_ROUTES = {
  createDraft: { method: 'POST', path: REGISTRATION_DRAFT_PUBLIC_API_PREFIX },
  resolveInviteToken: {
    method: 'POST',
    path: `${REGISTRATION_DRAFT_PUBLIC_API_PREFIX}/invite-token/resolve`,
  },
  getDraft: {
    method: 'GET',
    path: `${REGISTRATION_DRAFT_PUBLIC_API_PREFIX}/:draftId`,
  },
  getDraftStatus: {
    method: 'GET',
    path: `${REGISTRATION_DRAFT_PUBLIC_API_PREFIX}/:draftId/status`,
  },
  updateFullName: {
    method: 'PATCH',
    path: `${REGISTRATION_DRAFT_PUBLIC_API_PREFIX}/:draftId/full-name`,
  },
  updatePhone: {
    method: 'PATCH',
    path: `${REGISTRATION_DRAFT_PUBLIC_API_PREFIX}/:draftId/phone`,
  },
  sendOtp: {
    method: 'POST',
    path: `${REGISTRATION_DRAFT_PUBLIC_API_PREFIX}/:draftId/otp/send`,
  },
  verifyOtp: {
    method: 'POST',
    path: `${REGISTRATION_DRAFT_PUBLIC_API_PREFIX}/:draftId/otp/verify`,
  },
  updateRole: {
    method: 'PATCH',
    path: `${REGISTRATION_DRAFT_PUBLIC_API_PREFIX}/:draftId/role`,
  },
  lookupInn: {
    method: 'POST',
    path: `${REGISTRATION_DRAFT_PUBLIC_API_PREFIX}/:draftId/inn/lookup`,
  },
  getVerification: {
    method: 'GET',
    path: `${REGISTRATION_DRAFT_PUBLIC_API_PREFIX}/:draftId/verification`,
  },
  confirmSupplierCreate: {
    method: 'POST',
    path: `${REGISTRATION_DRAFT_PUBLIC_API_PREFIX}/:draftId/confirm/supplier-create`,
  },
  confirmSupplierExistingCompany: {
    method: 'POST',
    path: `${REGISTRATION_DRAFT_PUBLIC_API_PREFIX}/:draftId/confirm/supplier-existing-company`,
  },
  confirmSupplierNotFound: {
    method: 'POST',
    path: `${REGISTRATION_DRAFT_PUBLIC_API_PREFIX}/:draftId/confirm/supplier-not-found`,
  },
  confirmVenueCreate: {
    method: 'POST',
    path: `${REGISTRATION_DRAFT_PUBLIC_API_PREFIX}/:draftId/confirm/venue-create`,
  },
  confirmVenueExistingOwner: {
    method: 'POST',
    path: `${REGISTRATION_DRAFT_PUBLIC_API_PREFIX}/:draftId/confirm/venue-existing-owner`,
  },
  confirmVenueExistingNoOwner: {
    method: 'POST',
    path: `${REGISTRATION_DRAFT_PUBLIC_API_PREFIX}/:draftId/confirm/venue-existing-no-owner`,
  },
  confirmVenueExistingJoin: {
    method: 'POST',
    path: `${REGISTRATION_DRAFT_PUBLIC_API_PREFIX}/:draftId/confirm/venue-existing-join`,
  },
  confirmVenueNotFound: {
    method: 'POST',
    path: `${REGISTRATION_DRAFT_PUBLIC_API_PREFIX}/:draftId/confirm/venue-not-found`,
  },
  confirmInviteStaff: {
    method: 'POST',
    path: `${REGISTRATION_DRAFT_PUBLIC_API_PREFIX}/:draftId/confirm/invite-staff`,
  },
} as const

export const AUTH_AND_REGISTRATION_PUBLIC_API_ROUTES = {
  ...AUTH_PUBLIC_API_ROUTES,
  ...REGISTRATION_DRAFT_PUBLIC_API_ROUTES,
} as const
