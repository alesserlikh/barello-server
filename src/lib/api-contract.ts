export type ApiFieldErrors = Record<string, string[]>

export type ApiErrorBody = {
  code: string
  message: string
  details?: unknown
  fieldErrors?: ApiFieldErrors
}

export type ApiSuccessEnvelope<TData, TMeta = undefined> = {
  ok: true
  data: TData
} & (TMeta extends undefined ? { meta?: undefined } : { meta: TMeta })

export type ApiErrorEnvelope = {
  ok: false
  error: ApiErrorBody
}

export type ApiEnvelope<TData, TMeta = undefined> =
  | ApiSuccessEnvelope<TData, TMeta>
  | ApiErrorEnvelope

export type OffsetLimitPaginationQuery = {
  offset?: number
  limit?: number
}

export type OffsetLimitPaginationMeta = {
  offset: number
  limit: number
  total: number
  hasMore: boolean
}

export const DEFAULT_OFFSET = 0
export const DEFAULT_LIMIT = 20
export const MAX_LIMIT = 100

export function parseOffsetLimitPagination(
  query: Record<string, unknown>,
  options: {
    defaultOffset?: number
    defaultLimit?: number
    maxLimit?: number
  } = {},
): Required<OffsetLimitPaginationQuery> {
  const defaultOffset = options.defaultOffset ?? DEFAULT_OFFSET
  const defaultLimit = options.defaultLimit ?? DEFAULT_LIMIT
  const maxLimit = options.maxLimit ?? MAX_LIMIT

  const offset = parseIntegerQueryParam(query.offset, 'offset', {
    min: 0,
    defaultValue: defaultOffset,
  })
  const limit = parseIntegerQueryParam(query.limit, 'limit', {
    min: 1,
    max: maxLimit,
    defaultValue: defaultLimit,
  })

  return { offset, limit }
}

export function buildOffsetLimitPaginationMeta(params: {
  offset: number
  limit: number
  total: number
}): OffsetLimitPaginationMeta {
  return {
    offset: params.offset,
    limit: params.limit,
    total: params.total,
    hasMore: params.offset + params.limit < params.total,
  }
}

function parseIntegerQueryParam(
  value: unknown,
  fieldName: string,
  options: {
    min: number
    max?: number
    defaultValue: number
  },
) {
  if (value === undefined) {
    return options.defaultValue
  }

  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be an integer`)
  }

  const parsedValue = Number.parseInt(value, 10)

  if (!Number.isInteger(parsedValue) || parsedValue < options.min) {
    throw new Error(`${fieldName} must be greater than or equal to ${options.min}`)
  }

  if (options.max !== undefined && parsedValue > options.max) {
    throw new Error(`${fieldName} must be less than or equal to ${options.max}`)
  }

  return parsedValue
}
