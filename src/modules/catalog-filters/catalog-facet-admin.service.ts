import {
  AuditActorType,
  FacetLevel,
  FacetOptionSource,
  FacetScope,
  FacetType,
  OfferAvailabilityLevel,
  Prisma,
  ProductCatalogStatus,
} from '../../generated/prisma'
import { prisma } from '../../lib/prisma'

const FACET_AUDIT_ENTITY_TYPE = 'FACET'

const FACET_FIELD_LABELS: Record<string, string> = {
  key: 'Ключ',
  label: 'Название',
  type: 'Тип',
  level: 'Уровень',
  scopes: 'Область действия',
  categoryId: 'Категория',
  categoryScope: 'Область по категориям',
  dataSource: 'Источник данных',
  optionSource: 'Источник значений',
  minFillRate: 'Мин. заполненность',
  isActive: 'Активен',
  sortOrder: 'Порядок',
  optionsCount: 'Кол-во статичных значений',
}

function buildFacetAuditChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>
) {
  return Object.keys(after)
    .filter((field) => JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null))
    .map((field) => ({
      field,
      label: FACET_FIELD_LABELS[field] ?? field,
      before: before[field] ?? null,
      after: after[field] ?? null,
    }))
}

async function writeFacetAuditLog(facetId: string, action: string, payload: Prisma.InputJsonValue) {
  await prisma.auditLog.create({
    data: {
      actorType: AuditActorType.SYSTEM,
      entityType: FACET_AUDIT_ENTITY_TYPE,
      entityId: facetId,
      action,
      payload,
    },
  })
}

function mapFacetAuditLog(auditLog: {
  id: string
  action: string
  payload: Prisma.JsonValue | null
  createdAt: Date
}) {
  const payload = auditLog.payload && typeof auditLog.payload === 'object' && !Array.isArray(auditLog.payload)
    ? (auditLog.payload as { changes?: unknown })
    : null
  const changes = Array.isArray(payload?.changes) ? payload.changes : []

  return {
    id: auditLog.id,
    at: auditLog.createdAt.toISOString(),
    action: auditLog.action,
    changes,
  }
}

function compareFacetAdminValues(left: unknown, right: unknown, type: 'text' | 'number' | 'boolean' = 'text') {
  const leftEmpty = left === null || left === undefined || left === ''
  const rightEmpty = right === null || right === undefined || right === ''
  if (leftEmpty && rightEmpty) return 0
  if (leftEmpty) return 1
  if (rightEmpty) return -1
  if (type === 'number') return Number(left ?? 0) - Number(right ?? 0)
  if (type === 'boolean') return Number(Boolean(left)) - Number(Boolean(right))
  return String(left).localeCompare(String(right), 'ru', { sensitivity: 'base', numeric: true })
}

function sortFacetAdminItems<T>(
  items: T[],
  query: Record<string, unknown>,
  sorters: Record<string, { type?: 'text' | 'number' | 'boolean'; accessor: (item: T) => unknown }>
) {
  const sortKey = typeof query.sort === 'string' && query.sort.trim() ? query.sort.trim() : null
  if (!sortKey || !sorters[sortKey]) return items
  const direction = query.sortDirection === 'desc' ? -1 : 1
  const sorter = sorters[sortKey]
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const result = compareFacetAdminValues(
        sorter.accessor(left.item),
        sorter.accessor(right.item),
        sorter.type ?? 'text'
      )
      return result === 0 ? left.index - right.index : result * direction
    })
    .map(({ item }) => item)
}

export class CatalogFacetAdminError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'CatalogFacetAdminError'
    this.status = status
  }
}

type FacetOptionInput = {
  id?: string
  value?: unknown
  label?: unknown
  sortOrder?: unknown
  metadata?: unknown
  isActive?: unknown
}

type FacetInput = {
  key?: unknown
  label?: unknown
  type?: unknown
  level?: unknown
  scopes?: unknown
  categoryId?: unknown
  categoryScope?: unknown
  dataSource?: unknown
  optionSource?: unknown
  minFillRate?: unknown
  isActive?: unknown
  sortOrder?: unknown
  options?: unknown
}

type PreviewFacet = {
  id?: string
  key: string
  label: string
  type: FacetType
  level: FacetLevel
  scopes: FacetScope[]
  categoryId: string | null
  categoryScope: Prisma.JsonValue | null
  dataSource: string
  optionSource: FacetOptionSource
  minFillRate: number
  isActive: boolean
  sortOrder: number
  options: Array<{
    id?: string
    value: string
    label: string
    sortOrder: number
    metadata: unknown | null
    isActive: boolean
  }>
}

const PUBLIC_OFFER_WHERE = {
  isCurrent: true,
  isAvailable: true,
} as const

const PUBLIC_SUPPLIER_PRODUCT_WHERE = {
  supplier: {
    isActive: true,
  },
  offers: {
    some: PUBLIC_OFFER_WHERE,
  },
} as const

const PUBLIC_PRODUCT_WHERE = {
  status: ProductCatalogStatus.CONFIRMED,
  isConfirmed: true,
  isHidden: false,
  mergedIntoProductId: null,
} as const

const PRODUCT_FIELDS = new Set([
  'brand',
  'producer',
  'country',
  'region',
  'vintage',
  'manufacturedYear',
  'alcoholPercent',
  'color',
  'sugar',
  'manufacturer',
  'rawCategory',
])

const VARIANT_FIELDS = new Set([
  'volume',
  'volumeUnit',
  'packageSize',
  'packageSizeUnit',
  'packagingType',
])

const OFFER_FIELDS = new Set([
  'price',
  'supplierId',
  'stockAvailable',
  'availabilityLevel',
  'availability',
  'deliveryDays',
  'deliveryDaysMin',
  'deliveryDaysMax',
  'minOrderQty',
  'stockLevel',
])

function normalizeString(value: unknown, fieldName: string, required = true) {
  if (value === undefined || value === null) {
    if (!required) return undefined
    throw new CatalogFacetAdminError(400, `${fieldName} is required`)
  }
  if (typeof value !== 'string') {
    throw new CatalogFacetAdminError(400, `${fieldName} must be a string`)
  }
  const normalized = value.trim()
  if (!normalized && required) {
    throw new CatalogFacetAdminError(400, `${fieldName} is required`)
  }
  return normalized || undefined
}

function normalizeBoolean(value: unknown, fieldName: string, defaultValue?: boolean) {
  if (value === undefined) return defaultValue
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  throw new CatalogFacetAdminError(400, `${fieldName} must be a boolean`)
}

function normalizeInteger(value: unknown, fieldName: string, defaultValue?: number) {
  if (value === undefined || value === null || value === '') return defaultValue
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    throw new CatalogFacetAdminError(400, `${fieldName} must be an integer`)
  }
  return parsed
}

function normalizeNumber(value: unknown, fieldName: string, defaultValue?: number) {
  if (value === undefined || value === null || value === '') return defaultValue
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new CatalogFacetAdminError(400, `${fieldName} must be a number`)
  }
  return parsed
}

function normalizeEnum<T extends string>(
  value: unknown,
  fieldName: string,
  allowedValues: Record<string, T>,
  defaultValue?: T
) {
  if (value === undefined || value === null || value === '') {
    if (defaultValue !== undefined) return defaultValue
    throw new CatalogFacetAdminError(400, `${fieldName} is required`)
  }
  if (typeof value !== 'string') {
    throw new CatalogFacetAdminError(400, `${fieldName} must be a string`)
  }
  const normalized = value.trim().toUpperCase()
  if (!Object.values(allowedValues).includes(normalized as T)) {
    throw new CatalogFacetAdminError(
      400,
      `${fieldName} must be one of: ${Object.values(allowedValues).join(', ')}`
    )
  }
  return normalized as T
}

function normalizeStringList(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === '') return []
  const rawValues = Array.isArray(value) ? value : [value]
  const values = rawValues.flatMap((item) => {
    if (typeof item !== 'string') {
      throw new CatalogFacetAdminError(400, `${fieldName} must be a string list`)
    }
    return item.split(',').map((part) => part.trim()).filter(Boolean)
  })
  return [...new Set(values)]
}

function normalizeScopes(value: unknown, defaultValue: FacetScope[] = [FacetScope.CATALOG]) {
  const values = normalizeStringList(value, 'scopes')
  if (!values.length) return defaultValue
  return values.map((item) => normalizeEnum(item, 'scopes', FacetScope))
}

function normalizeJson(value: unknown, fieldName: string): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null || value === '') return Prisma.JsonNull
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Prisma.InputJsonValue
    } catch {
      throw new CatalogFacetAdminError(400, `${fieldName} must be a valid JSON value`)
    }
  }
  return value as Prisma.InputJsonValue
}

function validateKey(key: string) {
  if (!/^[a-z][a-z0-9_]{1,79}$/.test(key)) {
    throw new CatalogFacetAdminError(
      400,
      'key must be snake_case, start with a letter and contain 2-80 chars'
    )
  }
}

function validateDataSource(level: FacetLevel, dataSource: string) {
  const [sourceLevel, ...fieldParts] = dataSource.split('.')
  const field = fieldParts.join('.')

  if (level === FacetLevel.PRODUCT) {
    if (sourceLevel !== 'product') {
      throw new CatalogFacetAdminError(400, 'PRODUCT facets must use product.* dataSource')
    }
    if (field.startsWith('attributesJson.') || PRODUCT_FIELDS.has(field)) return
  }

  if (level === FacetLevel.VARIANT) {
    if (sourceLevel !== 'variant') {
      throw new CatalogFacetAdminError(400, 'VARIANT facets must use variant.* dataSource')
    }
    if (VARIANT_FIELDS.has(field)) return
  }

  if (level === FacetLevel.OFFER) {
    if (sourceLevel !== 'offer') {
      throw new CatalogFacetAdminError(400, 'OFFER facets must use offer.* dataSource')
    }
    if (OFFER_FIELDS.has(field)) return
  }

  throw new CatalogFacetAdminError(400, `Unsupported dataSource: ${dataSource}`)
}

function serializeFacet(facet: any) {
  return {
    id: facet.id,
    key: facet.key,
    label: facet.label,
    type: facet.type,
    level: facet.level,
    scopes: facet.scopes,
    categoryId: facet.categoryId,
    category: facet.category
      ? {
          id: facet.category.id,
          name: facet.category.name,
          code: facet.category.code,
          section: facet.category.section,
          parentId: facet.category.parentId,
        }
      : null,
    categoryScope: facet.categoryScope ?? null,
    dataSource: facet.dataSource,
    optionSource: facet.optionSource,
    minFillRate: Number(facet.minFillRate),
    isActive: facet.isActive,
    sortOrder: facet.sortOrder,
    options: (facet.options ?? []).map((option: any) => ({
      id: option.id,
      value: option.value,
      label: option.label,
      sortOrder: option.sortOrder,
      metadata: option.metadata ?? null,
      isActive: option.isActive,
      createdAt: option.createdAt,
      updatedAt: option.updatedAt,
    })),
    createdAt: facet.createdAt,
    updatedAt: facet.updatedAt,
  }
}

function normalizeOptions(value: unknown) {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new CatalogFacetAdminError(400, 'options must be an array')
  }
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new CatalogFacetAdminError(400, 'options must contain objects')
    }
    const option = item as FacetOptionInput
    return {
      id: normalizeString(option.id, `options[${index}].id`, false),
      value: normalizeString(option.value, `options[${index}].value`)!,
      label: normalizeString(option.label, `options[${index}].label`)!,
      sortOrder: normalizeInteger(option.sortOrder, `options[${index}].sortOrder`, index * 10) ?? 0,
      metadata: normalizeJson(option.metadata, `options[${index}].metadata`),
      isActive: normalizeBoolean(option.isActive, `options[${index}].isActive`, true) ?? true,
    }
  })
}

async function assertCategoryExists(categoryId: string | undefined) {
  if (!categoryId) return
  const category = await prisma.catalogCategory.findUnique({
    where: { id: categoryId },
    select: { id: true },
  })
  if (!category) {
    throw new CatalogFacetAdminError(404, 'categoryId not found')
  }
}

async function normalizeCreateInput(input: FacetInput) {
  const key = normalizeString(input.key, 'key')!
  validateKey(key)
  const label = normalizeString(input.label, 'label')!
  const type = normalizeEnum(input.type, 'type', FacetType)
  const level = normalizeEnum(input.level, 'level', FacetLevel)
  const scopes = normalizeScopes(input.scopes)
  const categoryId = normalizeString(input.categoryId, 'categoryId', false)
  const categoryScope = normalizeJson(input.categoryScope, 'categoryScope')
  const dataSource = normalizeString(input.dataSource, 'dataSource')!
  const optionSource = normalizeEnum(
    input.optionSource,
    'optionSource',
    FacetOptionSource,
    FacetOptionSource.DYNAMIC
  )
  const minFillRate = normalizeNumber(input.minFillRate, 'minFillRate', 0.05) ?? 0.05
  const isActive = normalizeBoolean(input.isActive, 'isActive', true) ?? true
  const sortOrder = normalizeInteger(input.sortOrder, 'sortOrder', 0) ?? 0
  const options = normalizeOptions(input.options)

  validateDataSource(level, dataSource)
  await assertCategoryExists(categoryId)

  if (minFillRate < 0 || minFillRate > 1) {
    throw new CatalogFacetAdminError(400, 'minFillRate must be between 0 and 1')
  }

  return {
    key,
    label,
    type,
    level,
    scopes,
    categoryId,
    categoryScope,
    dataSource,
    optionSource,
    minFillRate,
    isActive,
    sortOrder,
    options,
  }
}

async function normalizeUpdateInput(input: FacetInput, existing: PreviewFacet) {
  const merged = {
    key: input.key === undefined ? existing.key : input.key,
    label: input.label === undefined ? existing.label : input.label,
    type: input.type === undefined ? existing.type : input.type,
    level: input.level === undefined ? existing.level : input.level,
    scopes: input.scopes === undefined ? existing.scopes : input.scopes,
    categoryId: input.categoryId === undefined ? existing.categoryId ?? undefined : input.categoryId,
    categoryScope: input.categoryScope === undefined ? existing.categoryScope : input.categoryScope,
    dataSource: input.dataSource === undefined ? existing.dataSource : input.dataSource,
    optionSource: input.optionSource === undefined ? existing.optionSource : input.optionSource,
    minFillRate: input.minFillRate === undefined ? existing.minFillRate : input.minFillRate,
    isActive: input.isActive === undefined ? existing.isActive : input.isActive,
    sortOrder: input.sortOrder === undefined ? existing.sortOrder : input.sortOrder,
    options: input.options,
  }
  return normalizeCreateInput(merged)
}

async function syncOptions(facetId: string, options: ReturnType<typeof normalizeOptions>) {
  if (options === undefined) return

  const incomingIds = options.flatMap((option) => option.id ? [option.id] : [])
  await prisma.facetOption.deleteMany({
    where: {
      facetId,
      ...(incomingIds.length ? { id: { notIn: incomingIds } } : {}),
    },
  })

  for (const option of options) {
    if (option.id) {
      await prisma.facetOption.update({
        where: { id: option.id },
        data: {
          value: option.value,
          label: option.label,
          sortOrder: option.sortOrder,
          metadata: option.metadata,
          isActive: option.isActive,
        },
      })
      continue
    }

    await prisma.facetOption.create({
      data: {
        facetId,
        value: option.value,
        label: option.label,
        sortOrder: option.sortOrder,
        metadata: option.metadata,
        isActive: option.isActive,
      },
    })
  }
}

export async function getModerationCatalogFacets(query: Record<string, unknown> = {}) {
  const scope = query.scope === undefined ? undefined : normalizeEnum(query.scope, 'scope', FacetScope)
  const search = typeof query.q === 'string' && query.q.trim() ? query.q.trim() : undefined
  const facets = await prisma.facetRegistryEntry.findMany({
    where: {
      ...(scope ? { scopes: { has: scope } } : {}),
      ...(search
        ? {
            OR: [
              { key: { contains: search, mode: 'insensitive' } },
              { label: { contains: search, mode: 'insensitive' } },
              { dataSource: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    include: {
      category: true,
      options: { orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] },
    },
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
  })

  const items = facets.map(serializeFacet)

  return {
    ok: true,
    items: sortFacetAdminItems(items, query, {
      label: { accessor: (facet) => facet.label },
      type: { accessor: (facet) => facet.type },
      level: { accessor: (facet) => facet.level },
      dataSource: { accessor: (facet) => facet.dataSource },
      scopes: { accessor: (facet) => facet.scopes.join(', ') },
      minFillRate: { type: 'number', accessor: (facet) => facet.minFillRate },
      isActive: { type: 'boolean', accessor: (facet) => facet.isActive },
    }),
    total: facets.length,
  }
}

export async function createModerationCatalogFacet(input: FacetInput) {
  const data = await normalizeCreateInput(input)
  const existing = await prisma.facetRegistryEntry.findUnique({
    where: { key: data.key },
    select: { id: true },
  })
  if (existing) {
    throw new CatalogFacetAdminError(409, 'Facet key already exists')
  }

  const facet = await prisma.facetRegistryEntry.create({
    data: {
      key: data.key,
      label: data.label,
      type: data.type,
      level: data.level,
      scopes: data.scopes,
      categoryId: data.categoryId ?? null,
      categoryScope: data.categoryScope,
      dataSource: data.dataSource,
      optionSource: data.optionSource,
      minFillRate: String(data.minFillRate),
      isActive: data.isActive,
      sortOrder: data.sortOrder,
      options: data.options?.length
        ? {
            create: data.options.map((option) => ({
              value: option.value,
              label: option.label,
              sortOrder: option.sortOrder,
              metadata: option.metadata,
              isActive: option.isActive,
            })),
          }
        : undefined,
    },
    include: {
      category: true,
      options: { orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] },
    },
  })

  const changes = buildFacetAuditChanges(
    {},
    {
      key: facet.key,
      label: facet.label,
      type: facet.type,
      level: facet.level,
      scopes: facet.scopes,
      categoryId: facet.categoryId,
      categoryScope: facet.categoryScope,
      dataSource: facet.dataSource,
      optionSource: facet.optionSource,
      minFillRate: Number(facet.minFillRate),
      isActive: facet.isActive,
      sortOrder: facet.sortOrder,
      optionsCount: facet.options.length,
    }
  )
  await writeFacetAuditLog(facet.id, 'FACET_CREATED', { changes } as Prisma.InputJsonValue)

  return serializeFacet(facet)
}

export async function updateModerationCatalogFacet(id: string, input: FacetInput) {
  const existing = await prisma.facetRegistryEntry.findUnique({
    where: { id },
    include: {
      options: true,
    },
  })
  if (!existing) {
    throw new CatalogFacetAdminError(404, 'Facet not found')
  }

  const data = await normalizeUpdateInput(input, {
    id: existing.id,
    key: existing.key,
    label: existing.label,
    type: existing.type,
    level: existing.level,
    scopes: existing.scopes,
    categoryId: existing.categoryId,
    categoryScope: existing.categoryScope as Prisma.JsonValue | null,
    dataSource: existing.dataSource,
    optionSource: existing.optionSource,
    minFillRate: Number(existing.minFillRate),
    isActive: existing.isActive,
    sortOrder: existing.sortOrder,
    options: existing.options.map((option) => ({
      id: option.id,
      value: option.value,
      label: option.label,
      sortOrder: option.sortOrder,
      metadata: option.metadata ?? null,
      isActive: option.isActive,
    })),
  })

  const keyOwner = await prisma.facetRegistryEntry.findUnique({
    where: { key: data.key },
    select: { id: true },
  })
  if (keyOwner && keyOwner.id !== id) {
    throw new CatalogFacetAdminError(409, 'Facet key already exists')
  }

  await prisma.facetRegistryEntry.update({
    where: { id },
    data: {
      key: data.key,
      label: data.label,
      type: data.type,
      level: data.level,
      scopes: data.scopes,
      categoryId: data.categoryId ?? null,
      categoryScope: data.categoryScope,
      dataSource: data.dataSource,
      optionSource: data.optionSource,
      minFillRate: String(data.minFillRate),
      isActive: data.isActive,
      sortOrder: data.sortOrder,
    },
  })
  await syncOptions(id, data.options)

  const facet = await prisma.facetRegistryEntry.findUniqueOrThrow({
    where: { id },
    include: {
      category: true,
      options: { orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] },
    },
  })

  const changes = buildFacetAuditChanges(
    {
      key: existing.key,
      label: existing.label,
      type: existing.type,
      level: existing.level,
      scopes: existing.scopes,
      categoryId: existing.categoryId,
      categoryScope: existing.categoryScope,
      dataSource: existing.dataSource,
      optionSource: existing.optionSource,
      minFillRate: Number(existing.minFillRate),
      isActive: existing.isActive,
      sortOrder: existing.sortOrder,
      optionsCount: existing.options.length,
    },
    {
      key: facet.key,
      label: facet.label,
      type: facet.type,
      level: facet.level,
      scopes: facet.scopes,
      categoryId: facet.categoryId,
      categoryScope: facet.categoryScope,
      dataSource: facet.dataSource,
      optionSource: facet.optionSource,
      minFillRate: Number(facet.minFillRate),
      isActive: facet.isActive,
      sortOrder: facet.sortOrder,
      optionsCount: facet.options.length,
    }
  )
  if (changes.length) {
    await writeFacetAuditLog(facet.id, 'FACET_UPDATED', { changes } as Prisma.InputJsonValue)
  }

  return serializeFacet(facet)
}

export async function getModerationCatalogFacetById(id: string) {
  const facet = await prisma.facetRegistryEntry.findUnique({
    where: { id },
    include: {
      category: true,
      options: { orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] },
    },
  })
  if (!facet) {
    throw new CatalogFacetAdminError(404, 'Facet not found')
  }

  const auditLogs = await prisma.auditLog.findMany({
    where: { entityType: FACET_AUDIT_ENTITY_TYPE, entityId: id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, action: true, payload: true, createdAt: true },
  })

  return {
    ok: true,
    facet: serializeFacet(facet),
    auditLog: auditLogs.map(mapFacetAuditLog),
  }
}

export async function deleteModerationCatalogFacet(id: string) {
  const existing = await prisma.facetRegistryEntry.findUnique({
    where: { id },
    select: { id: true, key: true, label: true },
  })
  if (!existing) {
    throw new CatalogFacetAdminError(404, 'Facet not found')
  }
  await prisma.facetRegistryEntry.delete({ where: { id } })
  await writeFacetAuditLog(id, 'FACET_DELETED', {
    changes: [
      { field: 'key', label: FACET_FIELD_LABELS.key, before: existing.key, after: null },
      { field: 'label', label: FACET_FIELD_LABELS.label, before: existing.label, after: null },
    ],
  } as Prisma.InputJsonValue)
  return { ok: true, id }
}

function parseCategoryScope(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      categoryIds: [] as string[],
      sections: [] as string[],
      rootCategoryCodes: [] as string[],
    }
  }
  const record = value as Record<string, unknown>
  return {
    categoryIds: normalizeStringList(record.categoryIds, 'categoryScope.categoryIds'),
    sections: normalizeStringList(record.sections, 'categoryScope.sections'),
    rootCategoryCodes: normalizeStringList(record.rootCategoryCodes, 'categoryScope.rootCategoryCodes'),
  }
}

async function resolveCategorySubtreeIds(categoryId: string | null | undefined) {
  if (!categoryId) return []
  const categories = await prisma.catalogCategory.findMany({
    select: { id: true, parentId: true },
  })
  const childrenByParent = new Map<string, string[]>()
  for (const category of categories) {
    if (!category.parentId) continue
    childrenByParent.set(category.parentId, [
      ...(childrenByParent.get(category.parentId) ?? []),
      category.id,
    ])
  }
  const ids = new Set<string>([categoryId])
  const queue = [...(childrenByParent.get(categoryId) ?? [])]
  while (queue.length) {
    const id = queue.shift()!
    if (ids.has(id)) continue
    ids.add(id)
    queue.push(...(childrenByParent.get(id) ?? []))
  }
  return [...ids]
}

async function getCoveredCategories(facet: PreviewFacet) {
  const scope = parseCategoryScope(facet.categoryScope)
  const explicitCategoryIds = [
    ...(facet.categoryId ? await resolveCategorySubtreeIds(facet.categoryId) : []),
    ...scope.categoryIds,
  ]
  const categories = await prisma.catalogCategory.findMany({
    where: {
      isHidden: false,
      ...(explicitCategoryIds.length || scope.sections.length || scope.rootCategoryCodes.length
        ? {
            OR: [
              ...(explicitCategoryIds.length ? [{ id: { in: explicitCategoryIds } }] : []),
              ...(scope.sections.length ? [{ section: { in: scope.sections as any[] } }] : []),
              ...(scope.rootCategoryCodes.length ? [{ code: { in: scope.rootCategoryCodes } }] : []),
            ],
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      code: true,
      section: true,
      parentId: true,
    },
    orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
  })
  return categories
}

function readAttributeValue(attributesJson: Prisma.JsonValue | null, path: string) {
  const keys = path.split('.').filter(Boolean)
  let current: unknown = attributesJson
  for (const key of keys) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return null
    current = (current as Record<string, unknown>)[key]
  }
  if (current === null || current === undefined || Array.isArray(current)) return null
  if (['string', 'number', 'boolean'].includes(typeof current)) return String(current)
  return null
}

function readProductValue(product: any, dataSource: string) {
  const field = dataSource.replace('product.', '')
  if (field.startsWith('attributesJson.')) {
    return readAttributeValue(product.attributesJson, field.replace('attributesJson.', ''))
  }
  const value = product[field]
  return value === null || value === undefined || Array.isArray(value) ? null : String(value)
}

function readVariantValue(variant: any, dataSource: string) {
  const field = dataSource.replace('variant.', '')
  const value = variant[field]
  return value === null || value === undefined || Array.isArray(value) ? null : String(value)
}

function readOfferValue(supplierProduct: any, offer: any, dataSource: string) {
  const field = dataSource.replace('offer.', '')
  if (field === 'supplierId') return supplierProduct.supplierId
  if (field === 'availability') {
    if (
      offer.isAvailable &&
      (Number(offer.stockAvailable ?? 0) > 0 ||
        offer.availabilityLevel === OfferAvailabilityLevel.IN_STOCK ||
        offer.availabilityLevel === OfferAvailabilityLevel.LOW_STOCK)
    ) {
      return 'ACTIVE'
    }
    if (offer.isAvailable) return 'ORDERABLE'
    if (offer.availabilityLevel === OfferAvailabilityLevel.OUT_OF_STOCK) return 'SOLD_OUT'
    return 'UNAVAILABLE'
  }
  if (field === 'deliveryDays') {
    const value = offer.deliveryDaysMax ?? offer.deliveryDaysMin
    if (value === null || value === undefined) return null
    if (value <= 0) return 'today'
    if (value === 1) return 'tomorrow'
    if (value <= 3) return 'up_to_3'
    if (value <= 7) return 'up_to_7'
    return null
  }
  if (field === 'stockLevel') {
    const value = Number(offer.stockAvailable ?? 0)
    if (value <= 0) return null
    return value <= 6 ? 'limited' : 'high'
  }
  const value = offer[field]
  return value === null || value === undefined || Array.isArray(value) ? null : String(value)
}

function collectFacetValues(product: any, facet: PreviewFacet) {
  const values = new Set<string>()
  if (facet.level === FacetLevel.PRODUCT) {
    const value = readProductValue(product, facet.dataSource)
    if (value) values.add(value)
  }
  if (facet.level === FacetLevel.VARIANT) {
    for (const variant of product.variants) {
      const value = readVariantValue(variant, facet.dataSource)
      if (value) values.add(value)
    }
  }
  if (facet.level === FacetLevel.OFFER) {
    for (const supplierProduct of product.supplierProducts) {
      for (const offer of supplierProduct.offers) {
        const value = readOfferValue(supplierProduct, offer, facet.dataSource)
        if (value) values.add(value)
      }
    }
  }
  return [...values]
}

async function getPreviewFacet(input: Record<string, unknown>): Promise<PreviewFacet> {
  const id = normalizeString(input.id, 'id', false)
  if (id) {
    const facet = await prisma.facetRegistryEntry.findUnique({
      where: { id },
      include: { options: { orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] } },
    })
    if (!facet) throw new CatalogFacetAdminError(404, 'Facet not found')
    return {
      id: facet.id,
      key: facet.key,
      label: facet.label,
      type: facet.type,
      level: facet.level,
      scopes: facet.scopes,
      categoryId: facet.categoryId,
      categoryScope: facet.categoryScope as Prisma.JsonValue | null,
      dataSource: facet.dataSource,
      optionSource: facet.optionSource,
      minFillRate: Number(facet.minFillRate),
      isActive: facet.isActive,
      sortOrder: facet.sortOrder,
      options: facet.options.map((option) => ({
        id: option.id,
        value: option.value,
        label: option.label,
        sortOrder: option.sortOrder,
        metadata: option.metadata ?? null,
        isActive: option.isActive,
      })),
    }
  }

  const draft = await normalizeCreateInput(input)
  return {
    ...draft,
    categoryId: draft.categoryId ?? null,
    categoryScope: draft.categoryScope === Prisma.JsonNull ? null : draft.categoryScope as Prisma.JsonValue,
    minFillRate: draft.minFillRate,
    options: (draft.options ?? []).map((option) => ({
      value: option.value,
      label: option.label,
      sortOrder: option.sortOrder,
      metadata: option.metadata === Prisma.JsonNull ? null : option.metadata,
      isActive: option.isActive,
    })),
  }
}

export async function getModerationCatalogFacetPreview(input: Record<string, unknown>) {
  const facet = await getPreviewFacet(input)
  validateDataSource(facet.level, facet.dataSource)
  const coveredCategories = await getCoveredCategories(facet)
  const coveredCategoryIds = coveredCategories.map((category) => category.id)
  const products = await prisma.product.findMany({
    where: {
      ...(facet.scopes.includes(FacetScope.CATALOG) ? PUBLIC_PRODUCT_WHERE : {}),
      ...(coveredCategoryIds.length ? { categoryId: { in: coveredCategoryIds } } : {}),
      ...(facet.scopes.includes(FacetScope.CATALOG)
        ? { supplierProducts: { some: PUBLIC_SUPPLIER_PRODUCT_WHERE } }
        : {}),
    },
    include: {
      variants: true,
      supplierProducts: {
        include: {
          offers: {
            where: facet.scopes.includes(FacetScope.CATALOG) ? PUBLIC_OFFER_WHERE : undefined,
          },
        },
      },
    },
  })
  const countByValue = new Map<string, number>()
  let filledProducts = 0
  for (const product of products) {
    const values = collectFacetValues(product, facet)
    if (values.length) filledProducts += 1
    for (const value of values) {
      countByValue.set(value, (countByValue.get(value) ?? 0) + 1)
    }
  }
  const staticLabels = new Map(facet.options.map((option) => [option.value, option.label]))
  const values = [...countByValue.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([value, count]) => ({
      value,
      label: staticLabels.get(value) ?? value,
      count,
    }))
  const fillRate = products.length ? filledProducts / products.length : 0
  const visibleByThreshold = values.length >= 2 && fillRate >= facet.minFillRate

  return {
    ok: true,
    facet,
    visibleIn: {
      scopes: facet.scopes,
      categoryId: facet.categoryId,
      categoryScope: facet.categoryScope,
      categoriesCount: coveredCategories.length,
      categories: coveredCategories.slice(0, 100),
    },
    coverage: {
      productsTotal: products.length,
      productsFilled: filledProducts,
      fillRate,
      minFillRate: facet.minFillRate,
      visibleByThreshold,
    },
    values,
  }
}
