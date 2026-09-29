import type { ApiErrorEnvelope, ApiFieldErrors } from './api-contract'
import { localizeApiErrorMessage } from './api-error-messages'

export type ApiErrorDetails = unknown

export function apiError(
  code: string,
  message: string,
  details: ApiErrorDetails = null,
  fieldErrors?: ApiFieldErrors,
): ApiErrorEnvelope {
  return {
    ok: false,
    error: {
      code,
      message: localizeApiErrorMessage(code, message),
      details,
      ...(fieldErrors ? { fieldErrors } : {}),
    },
  }
}
