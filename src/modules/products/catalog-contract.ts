import { isExternalEntityId } from '../../lib/public-id'

export class CatalogRequestError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'CatalogRequestError'
    this.status = status
  }
}

export function parseBooleanFlag(
  value: unknown,
  defaultValue: boolean,
  fieldName: string
) {
  if (value === undefined) {
    return defaultValue
  }

  if (typeof value !== 'string') {
    throw new CatalogRequestError(400, `${fieldName} must be a boolean query parameter`)
  }

  if (value === 'true') {
    return true
  }

  if (value === 'false') {
    return false
  }

  throw new CatalogRequestError(400, `${fieldName} must be "true" or "false"`)
}

export function parsePositiveInteger(value: unknown, fieldName: string) {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new CatalogRequestError(400, `${fieldName} must be a positive integer`)
  }

  const parsedValue = Number.parseInt(value, 10)

  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    throw new CatalogRequestError(400, `${fieldName} must be a positive integer`)
  }

  return parsedValue
}

export function parsePositiveIntegerWithDefault(
  value: unknown,
  fieldName: string,
  defaultValue: number,
  maxValue?: number
) {
  if (value === undefined) {
    return defaultValue
  }

  const parsedValue = parsePositiveInteger(value, fieldName)

  if (parsedValue === undefined) {
    return defaultValue
  }

  if (maxValue && parsedValue > maxValue) {
    throw new CatalogRequestError(
      400,
      `${fieldName} must be less than or equal to ${maxValue}`
    )
  }

  return parsedValue
}

export function parseNonNegativeIntegerWithDefault(
  value: unknown,
  fieldName: string,
  defaultValue: number,
  maxValue?: number
) {
  if (value === undefined) {
    return defaultValue
  }

  if (typeof value !== 'string') {
    throw new CatalogRequestError(400, `${fieldName} must be a non-negative integer`)
  }

  const parsedValue = Number.parseInt(value, 10)

  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new CatalogRequestError(400, `${fieldName} must be a non-negative integer`)
  }

  if (maxValue && parsedValue > maxValue) {
    throw new CatalogRequestError(
      400,
      `${fieldName} must be less than or equal to ${maxValue}`
    )
  }

  return parsedValue
}

export function parseOptionalUuid(value: unknown, fieldName: string) {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new CatalogRequestError(400, `${fieldName} must be a UUID`)
  }

  const normalizedValue = value.trim()

  if (!normalizedValue) {
    return undefined
  }

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

  if (!uuidPattern.test(normalizedValue)) {
    throw new CatalogRequestError(400, `${fieldName} must be a UUID`)
  }

  return normalizedValue
}

export function parseOptionalEntityId(value: unknown, fieldName: string) {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new CatalogRequestError(400, `${fieldName} must be a UUID or publicId`)
  }

  const normalizedValue = value.trim()

  if (!normalizedValue) {
    return undefined
  }

  if (!isExternalEntityId(normalizedValue)) {
    throw new CatalogRequestError(400, `${fieldName} must be a UUID or publicId`)
  }

  return normalizedValue
}

function normalizeStringList(value: unknown, fieldName: string) {
  if (value === undefined) {
    return undefined
  }

  const rawValues = Array.isArray(value) ? value : [value]
  const normalizedValues = rawValues.flatMap((rawValue) => {
    if (typeof rawValue !== 'string') {
      throw new CatalogRequestError(400, `${fieldName} must be a string list`)
    }

    return rawValue
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  })

  return normalizedValues.length > 0 ? normalizedValues : undefined
}

export function parseOptionalStringList(value: unknown, fieldName: string) {
  return normalizeStringList(value, fieldName)
}

export function parseOptionalEnumStringList<T extends string>(
  value: unknown,
  fieldName: string,
  allowedValues: readonly T[]
) {
  const normalizedValues = normalizeStringList(value, fieldName)

  if (!normalizedValues) {
    return undefined
  }

  const allowedValuesSet = new Set<string>(allowedValues)

  for (const item of normalizedValues) {
    if (!allowedValuesSet.has(item)) {
      throw new CatalogRequestError(
        400,
        `${fieldName} must contain only: ${allowedValues.join(', ')}`
      )
    }
  }

  return normalizedValues as T[]
}

export function parseOptionalUuidList(value: unknown, fieldName: string) {
  const normalizedValues = normalizeStringList(value, fieldName)

  if (!normalizedValues) {
    return undefined
  }

  return normalizedValues.filter(
    (item): item is string => Boolean(parseOptionalUuid(item, fieldName))
  )
}

export function parseOptionalEntityIdList(value: unknown, fieldName: string) {
  const normalizedValues = normalizeStringList(value, fieldName)

  if (!normalizedValues) {
    return undefined
  }

  return normalizedValues.filter(
    (item): item is string => Boolean(parseOptionalEntityId(item, fieldName))
  )
}

export function parseAvailability(value: unknown) {
  const normalizedValues = normalizeStringList(value, 'availability')

  if (!normalizedValues) {
    return undefined
  }

  const allowedValues = new Set(['ACTIVE', 'ORDERABLE', 'SOLD_OUT', 'UNAVAILABLE'])
  const aliases = new Map<string, 'ACTIVE' | 'SOLD_OUT'>([
    ['IN_STOCK', 'ACTIVE'],
    ['LOW_STOCK', 'ACTIVE'],
    ['OUT_OF_STOCK', 'SOLD_OUT'],
  ])
  const mappedValues = normalizedValues.map((item) => aliases.get(item) ?? item)

  for (const item of mappedValues) {
    if (!allowedValues.has(item)) {
      throw new CatalogRequestError(
        400,
        'availability must be one of: ACTIVE, ORDERABLE, SOLD_OUT, UNAVAILABLE'
      )
    }
  }

  return mappedValues as Array<'ACTIVE' | 'ORDERABLE' | 'SOLD_OUT' | 'UNAVAILABLE'>
}

export function parseOptionalBooleanString(value: unknown, fieldName: string) {
  if (value === undefined) {
    return undefined
  }

  if (value === 'true' || value === 'false') {
    return value
  }

  throw new CatalogRequestError(400, `${fieldName} must be "true" or "false"`)
}

export function buildCatalogListResponse<T>(
  items: T[],
  extra?: Record<string, unknown>
) {
  const {
    offset: rawOffset,
    limit: rawLimit,
    total: rawTotal,
    hasMore: rawHasMore,
    ...dataExtra
  } = extra ?? {}
  const meta =
    typeof rawOffset === 'number' &&
    typeof rawLimit === 'number' &&
    typeof rawTotal === 'number' &&
    typeof rawHasMore === 'boolean'
      ? {
          offset: rawOffset,
          limit: rawLimit,
          total: rawTotal,
          hasMore: rawHasMore,
        }
      : undefined
  const legacyTotal = typeof rawTotal === 'number' ? rawTotal : items.length
  const legacyOffset = typeof rawOffset === 'number' ? rawOffset : 0
  const legacyLimit =
    typeof rawLimit === 'number' ? rawLimit : items.length
  const legacyHasMore =
    typeof rawHasMore === 'boolean' ? rawHasMore : false
  const legacyPage =
    legacyLimit > 0 ? Math.floor(legacyOffset / legacyLimit) + 1 : 1

  return {
    ok: true,
    data: {
      items,
      total: legacyTotal,
      offset: legacyOffset,
      limit: legacyLimit,
      page: legacyPage,
      pageSize: legacyLimit,
      hasMore: legacyHasMore,
      ...dataExtra,
    },
    ...(meta ? { meta } : {}),
  }
}

export function buildCatalogItemResponse<T>(item: T) {
  return {
    ok: true,
    data: {
      item,
    },
  }
}

export function buildCatalogDataResponse<T extends Record<string, unknown>>(data: T) {
  return {
    ok: true,
    data,
  }
}
