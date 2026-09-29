export type PhoneValidationErrorParams = {
  code: 'PHONE_REQUIRED' | 'PHONE_INVALID'
  message: string
  status: 400
}

const PHONE_REQUIRED_MESSAGE = 'Введите номер телефона'
const PHONE_INVALID_MESSAGE = 'Введите корректный номер телефона'

/** Normalizes Russian phone numbers to E.164 (+7XXXXXXXXXX). */
export function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const digits = value.trim().replace(/\D/g, '')

  if (/^7\d{10}$/.test(digits)) {
    return `+${digits}`
  }

  if (/^8\d{10}$/.test(digits)) {
    return `+7${digits.slice(1)}`
  }

  if (/^\d{10}$/.test(digits)) {
    return `+7${digits}`
  }

  if (/^(375\d{9}|374\d{8}|995\d{9})$/.test(digits)) {
    return `+${digits}`
  }

  return null
}

export function normalizePhoneOrThrow(
  value: unknown,
  createError: (params: PhoneValidationErrorParams) => Error
) {
  if (typeof value !== 'string' || !value.trim()) {
    throw createError({
      code: 'PHONE_REQUIRED',
      message: PHONE_REQUIRED_MESSAGE,
      status: 400,
    })
  }

  const normalizedPhone = normalizePhone(value)

  if (!normalizedPhone) {
    throw createError({
      code: 'PHONE_INVALID',
      message: PHONE_INVALID_MESSAGE,
      status: 400,
    })
  }

  return normalizedPhone
}

