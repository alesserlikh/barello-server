export type PublicEntityPrefix = '0' | '1' | '2' | '3' | '4'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PUBLIC_ID_PATTERN = /^[0-4][0-9A-Z]{7}$/i

export function isUuid(value: string) {
  return UUID_PATTERN.test(value)
}

export function normalizePublicId(value: string) {
  return value.trim().toUpperCase()
}

export function isPublicId(value: string, prefix?: PublicEntityPrefix) {
  const normalizedValue = normalizePublicId(value)

  if (!PUBLIC_ID_PATTERN.test(normalizedValue)) {
    return false
  }

  return prefix ? normalizedValue.startsWith(prefix) : true
}

export function isExternalEntityId(value: string, prefix?: PublicEntityPrefix) {
  const normalizedValue = value.trim()
  return isUuid(normalizedValue) || isPublicId(normalizedValue, prefix)
}

export function externalIdWhere(value: string, prefix: PublicEntityPrefix) {
  const normalizedValue = value.trim()

  if (isUuid(normalizedValue)) {
    return { id: normalizedValue }
  }

  const publicId = normalizePublicId(normalizedValue)
  if (isPublicId(publicId, prefix)) {
    return { publicId }
  }

  return { id: normalizedValue }
}
