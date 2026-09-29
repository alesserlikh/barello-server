import {
  FacetLevel,
  FacetOptionSource,
  FacetScope,
  FacetType,
  Prisma,
} from '../../generated/prisma'
import { prisma } from '../../lib/prisma'

export type CatalogFacetSelectedValues = Record<string, unknown>

export type CatalogFacetOptionDto = {
  value: string
  label: string
  count: number
  selected: boolean
  disabled: boolean
  metadata: unknown | null
}

export type CatalogFacetDto = {
  key: string
  label: string
  type: FacetType
  level: FacetLevel
  dataSource: string
  options: CatalogFacetOptionDto[]
  selected: unknown
  visible: boolean
  fillRate: number
  sortOrder: number
}

export type FacetRegistryRecord = Awaited<ReturnType<typeof loadFacetRegistryEntries>>[number]

/**
 * Sentinel selected/option value for "Не указано" (NULL). By default a NULL field doesn't
 * pass an active facet — matching this value explicitly is the only way to retrieve it.
 * Only meaningful for PRODUCT-level facets (see computeScopeFacets), matching the design
 * doc's scope: "для товарных фасетов с заполненностью 5–95% добавляется... «Не указано»".
 */
export const UNSPECIFIED_FACET_VALUE = '__UNSPECIFIED__'

export function normalizeScope(scope: string | FacetScope | null | undefined) {
  if (typeof scope !== 'string') return FacetScope.CATALOG
  const normalized = scope.trim().toUpperCase()
  return Object.values(FacetScope).includes(normalized as FacetScope)
    ? (normalized as FacetScope)
    : FacetScope.CATALOG
}

export function normalizeStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string | number | boolean =>
        ['string', 'number', 'boolean'].includes(typeof item)
      )
      .map(String)
      .filter(Boolean)
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)].filter(Boolean)
  }

  return []
}

export function normalizeRange(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const min = record.min === null || record.min === undefined || record.min === ''
    ? null
    : Number(record.min)
  const max = record.max === null || record.max === undefined || record.max === ''
    ? null
    : Number(record.max)

  return {
    min: Number.isFinite(min) ? min : null,
    max: Number.isFinite(max) ? max : null,
  }
}

export function hasFacetSelection(facet: Pick<FacetRegistryRecord, 'type'>, value: unknown) {
  if (facet.type === FacetType.RANGE) {
    const range = normalizeRange(value)
    return Boolean(range && (range.min !== null || range.max !== null))
  }

  return normalizeStringArray(value).length > 0
}

function normalizeQueryStringList(value: unknown) {
  const rawValues = Array.isArray(value) ? value : [value]
  return rawValues.flatMap((item) => {
    if (typeof item !== 'string') return []
    return item.split(',').map((part) => part.trim()).filter(Boolean)
  })
}

/**
 * Normalizes one raw facet value coming from an HTTP query (string, string[], or a
 * `{min,max}`-shaped range object) into the shape `CatalogFacetSelectedValues` expects.
 * Shared by every route that accepts facet selections in a query string (public catalog
 * and moderation catalog), so both parse `facets=<json>` / `facet.<key>=<value>` the same way.
 */
export function normalizeFacetValue(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined

  if (typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const min = record.min
    const max = record.max
    if (min !== undefined || max !== undefined) {
      return {
        min: min === undefined || min === null || min === '' ? null : Number(min),
        max: max === undefined || max === null || max === '' ? null : Number(max),
      }
    }
    return Object.fromEntries(
      Object.entries(record)
        .map(([key, item]) => [key, normalizeFacetValue(item)])
        .filter(([, item]) => item !== undefined)
    )
  }

  const list = normalizeQueryStringList(value)
  return list.length ? list : undefined
}

/**
 * Parses `query.facets` (a JSON-encoded `CatalogFacetState` object) and any `facet.<key>`
 * query params into `CatalogFacetSelectedValues`. Throws `FacetQueryError` if `facets` is
 * present but not valid JSON.
 */
export function parseFacetSelectionFromQuery(query: Record<string, unknown>): CatalogFacetSelectedValues {
  const result: CatalogFacetSelectedValues = {}
  const rawFacets = query.facets

  if (typeof rawFacets === 'string' && rawFacets.trim()) {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(rawFacets) as Record<string, unknown>
    } catch {
      throw new FacetQueryError('facets must be a valid JSON object')
    }
    for (const [key, value] of Object.entries(parsed)) {
      const normalized = normalizeFacetValue(value)
      if (normalized !== undefined) result[key] = normalized
    }
  } else if (rawFacets && typeof rawFacets === 'object' && !Array.isArray(rawFacets)) {
    for (const [key, value] of Object.entries(rawFacets as Record<string, unknown>)) {
      const normalized = normalizeFacetValue(value)
      if (normalized !== undefined) result[key] = normalized
    }
  }

  for (const [key, value] of Object.entries(query)) {
    if (!key.startsWith('facet.')) continue
    const facetKey = key.replace(/^facet\./, '')
    const normalized = normalizeFacetValue(value)
    if (facetKey && normalized !== undefined) result[facetKey] = normalized
  }

  return result
}

export class FacetQueryError extends Error {}

export function readAttributeValue(attributesJson: Prisma.JsonValue | null, path: string) {
  const values = readAttributeValues(attributesJson, path)
  return values[0] ?? null
}

export function readAttributeValues(attributesJson: Prisma.JsonValue | null, path: string) {
  const keys = path.split('.').filter(Boolean)
  let current: unknown = attributesJson

  for (const key of keys) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return []
    current = (current as Record<string, unknown>)[key]
  }

  if (Array.isArray(current)) {
    return current
      .filter((item): item is string | number | boolean =>
        ['string', 'number', 'boolean'].includes(typeof item)
      )
      .map(String)
      .filter(Boolean)
  }

  if (current === null || current === undefined) return []
  if (typeof current === 'string' || typeof current === 'number' || typeof current === 'boolean') {
    return [String(current)]
  }

  return []
}

/**
 * Reads a `product.<field>` / `product.attributesJson.<path>` dataSource off any
 * Product-shaped record. Shared by the CATALOG/ADMIN_CATALOG engine and every scope
 * adapter that joins to Product (VENUE_STOCK, SUPPLIER_STOCK, MENU, INVENTORY).
 */
export function readProductLikeFieldValue(
  product: Record<string, unknown> & { attributesJson?: Prisma.JsonValue | null },
  dataSource: string
) {
  return readProductLikeFieldValues(product, dataSource)[0] ?? null
}

export function readProductLikeFieldValues(
  product: Record<string, unknown> & { attributesJson?: Prisma.JsonValue | null },
  dataSource: string
) {
  if (dataSource.startsWith('product.attributesJson.')) {
    return readAttributeValues(
      product.attributesJson ?? null,
      dataSource.replace('product.attributesJson.', '')
    )
  }

  const field = dataSource.replace('product.', '')
  const value = product[field]
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string | number | boolean =>
        ['string', 'number', 'boolean'].includes(typeof item)
      )
      .map(String)
      .filter(Boolean)
  }
  if (value === null || value === undefined) return []
  return [String(value)]
}

export function matchesRangeValue(rawValue: string | null, selection: unknown) {
  const range = normalizeRange(selection)
  if (!range) return true
  const value = rawValue === null ? Number.NaN : Number(rawValue)
  if (!Number.isFinite(value)) return false
  if (range.min !== null && value < range.min) return false
  if (range.max !== null && value > range.max) return false
  return true
}

export function matchesValueSelection(rawValue: string | null, selection: unknown) {
  return matchesAnyValueSelection(rawValue === null ? [] : [rawValue], selection)
}

export function matchesAnyValueSelection(rawValues: string[], selection: unknown) {
  const selected = normalizeStringArray(selection)
  if (!selected.length) return true
  if (!rawValues.length) return selected.includes(UNSPECIFIED_FACET_VALUE)
  return rawValues.some((value) => selected.includes(value))
}

type ParsedCategoryScope = {
  categoryIds: string[]
  sections: string[]
  rootCategoryCodes: string[]
  includeDescendants: boolean
}

export function parseCategoryScope(value: Prisma.JsonValue | null): ParsedCategoryScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      categoryIds: [],
      sections: [],
      rootCategoryCodes: [],
      includeDescendants: true,
    }
  }
  const record = value as Record<string, unknown>

  return {
    categoryIds: normalizeStringArray(record.categoryIds),
    sections: normalizeStringArray(record.sections),
    rootCategoryCodes: normalizeStringArray(record.rootCategoryCodes),
    includeDescendants: record.includeDescendants !== false,
  }
}

export async function resolveCategorySubtreeIds(categoryId: string | null | undefined) {
  if (!categoryId) return []
  const category = await prisma.catalogCategory.findUnique({
    where: {
      id: categoryId,
    },
    select: { id: true },
  }).catch(() => null)
  const resolvedCategoryId = category?.id ?? categoryId
  const categories = await prisma.catalogCategory.findMany({
    select: {
      id: true,
      parentId: true,
    },
  })
  const childrenByParent = new Map<string, string[]>()

  for (const item of categories) {
    if (!item.parentId) continue
    childrenByParent.set(item.parentId, [...(childrenByParent.get(item.parentId) ?? []), item.id])
  }

  const ids = new Set<string>([resolvedCategoryId])
  const queue = [...(childrenByParent.get(resolvedCategoryId) ?? [])]

  while (queue.length) {
    const id = queue.shift()!
    if (ids.has(id)) continue
    ids.add(id)
    queue.push(...(childrenByParent.get(id) ?? []))
  }

  return [...ids]
}

export async function resolveEffectiveCategorySelection(categoryIds: string[] | null | undefined) {
  const selectedIds = Array.from(
    new Set((categoryIds ?? []).map((id) => id.trim()).filter(Boolean))
  )

  if (!selectedIds.length) {
    return {
      selectedCategoryIds: [],
      effectiveCategoryIds: [],
      expandedCategoryIds: [],
    }
  }

  const categories = await prisma.catalogCategory.findMany({
    select: {
      id: true,
      parentId: true,
      path: true,
      isTagActive: true,
      isHidden: true,
    },
  })
  const categoryById = new Map(categories.map((category) => [category.id, category]))
  const pathCache = new Map<string, string>()
  const validSelectedIds = selectedIds.filter((id) => categoryById.has(id))

  function resolveCategoryPath(categoryId: string): string {
    const cachedPath = pathCache.get(categoryId)
    if (cachedPath) return cachedPath

    const category = categoryById.get(categoryId)
    if (!category) return `/${categoryId}/`
    if (category.path) {
      pathCache.set(categoryId, category.path)
      return category.path
    }

    const parentPath = category.parentId ? resolveCategoryPath(category.parentId) : '/'
    const path = `${parentPath}${category.id}/`
    pathCache.set(categoryId, path)
    return path
  }

  if (!validSelectedIds.length) {
    return {
      selectedCategoryIds: selectedIds,
      effectiveCategoryIds: [],
      expandedCategoryIds: [],
    }
  }

  const childrenByParent = new Map<string, string[]>()
  for (const category of categories) {
    if (!category.parentId) continue
    childrenByParent.set(category.parentId, [
      ...(childrenByParent.get(category.parentId) ?? []),
      category.id,
    ])
  }

  const effectiveCategoryIds = validSelectedIds.filter((id) => {
    const category = categoryById.get(id)
    if (!category) return false
    const categoryPath = resolveCategoryPath(category.id)

    return !validSelectedIds.some((otherId) => {
      if (otherId === id) return false
      const otherCategory = categoryById.get(otherId)
      if (!otherCategory) return false
      const otherPath = resolveCategoryPath(otherCategory.id)

      return otherPath.length > categoryPath.length && otherPath.startsWith(categoryPath)
    })
  })

  const expandedIds = new Set<string>()
  for (const effectiveCategoryId of effectiveCategoryIds) {
    const queue = [effectiveCategoryId]

    while (queue.length) {
      const id = queue.shift()!
      const category = categoryById.get(id)
      if (!category || expandedIds.has(id)) continue
      if (category.isTagActive === false || category.isHidden) continue
      expandedIds.add(id)
      queue.push(...(childrenByParent.get(id) ?? []))
    }
  }

  return {
    selectedCategoryIds: selectedIds,
    effectiveCategoryIds,
    expandedCategoryIds: [...expandedIds],
  }
}

/** Ancestor chain of a category, including itself. Used only for facet category-scope
 * resolution (see loadFacetRegistryEntries) — NOT for product filtering, where "browsing
 * category X" must stay descendants-only (resolveCategorySubtreeIds), otherwise a query for
 * a child category would incorrectly also return products filed under its parent. */
export async function resolveCategoryAncestorIds(categoryId: string | null | undefined) {
  if (!categoryId) return []
  const categories = await prisma.catalogCategory.findMany({
    select: { id: true, parentId: true },
  })
  const byId = new Map(categories.map((category) => [category.id, category]))

  const ids: string[] = []
  let current = byId.get(categoryId)
  while (current) {
    ids.push(current.id)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }

  return ids
}

export async function loadFacetRegistryEntries(scope: FacetScope, categoryId?: string | null) {
  const descendantIds = await resolveCategorySubtreeIds(categoryId)
  const ancestorIds = await resolveCategoryAncestorIds(categoryId)
  // A facet declared on a branch (categoryId / categoryScope.categoryIds) must apply to all
  // of that branch's subcategories (design doc §1), so scope-gating below checks against
  // both descendants AND ancestors of the queried category — not just descendants, which
  // would only support the reverse (child-declared facet visible at an ancestor query).
  const categoryIds = [...new Set([...descendantIds, ...ancestorIds])]
  const selectedCategory = categoryId
    ? await prisma.catalogCategory.findFirst({
        where: { id: { in: categoryIds } },
        select: {
          id: true,
          section: true,
          code: true,
        },
      })
    : null

  const facets = await prisma.facetRegistryEntry.findMany({
    where: {
      isActive: true,
      scopes: {
        has: scope,
      },
    },
    include: {
      options: {
        where: {
          isActive: true,
        },
        orderBy: [
          { sortOrder: 'asc' },
          { label: 'asc' },
        ],
      },
    },
    orderBy: [
      { sortOrder: 'asc' },
      { label: 'asc' },
    ],
  })

  return facets.filter((facet) => {
    if (facet.categoryId && !categoryIds.includes(facet.categoryId)) return false
    const scopeConfig = parseCategoryScope(facet.categoryScope as Prisma.JsonValue | null)

    if (!scopeConfig.categoryIds.length && !scopeConfig.sections.length && !scopeConfig.rootCategoryCodes.length) {
      return true
    }

    if (scopeConfig.categoryIds.some((id) => categoryIds.includes(id))) return true
    if (selectedCategory && scopeConfig.sections.includes(selectedCategory.section)) return true
    if (selectedCategory?.code && scopeConfig.rootCategoryCodes.includes(selectedCategory.code)) return true

    return false
  })
}

function buildOptionsFromValueLists(
  facet: FacetRegistryRecord,
  valueLists: string[][],
  selectedFacets: CatalogFacetSelectedValues
) {
  const selectedValues = normalizeStringArray(selectedFacets[facet.key])
  const countByValue = new Map<string, number>()
  let filledRecords = 0

  for (const values of valueLists) {
    if (values.length) filledRecords += 1
    for (const value of values) {
      countByValue.set(value, (countByValue.get(value) ?? 0) + 1)
    }
  }

  const optionMap = new Map<string, CatalogFacetOptionDto>()

  if (facet.optionSource === FacetOptionSource.STATIC) {
    for (const option of facet.options) {
      const count = countByValue.get(option.value) ?? 0
      optionMap.set(option.value, {
        value: option.value,
        label: formatFacetOptionLabel(facet, option.value, option.label),
        count,
        selected: selectedValues.includes(option.value),
        disabled: count === 0 && !selectedValues.includes(option.value),
        metadata: option.metadata ?? null,
      })
    }
  }

  for (const [value, count] of [...countByValue.entries()].sort((left, right) => {
    return right[1] - left[1] || left[0].localeCompare(right[0])
  })) {
    const existing = optionMap.get(value)
    if (existing) {
      existing.count = count
      existing.disabled = count === 0 && !existing.selected
      continue
    }

    optionMap.set(value, {
      value,
      label: formatFacetOptionLabel(facet, value),
      count,
      selected: selectedValues.includes(value),
      disabled: count === 0 && !selectedValues.includes(value),
      metadata: null,
    })
  }

  const fillRate = valueLists.length ? filledRecords / valueLists.length : 0

  return {
    options: [...optionMap.values()],
    fillRate,
  }
}

function isVolumeFacet(facet: FacetRegistryRecord) {
  const dataSource = String(facet.dataSource || '').toLowerCase()
  return facet.key === 'volume' || dataSource === 'variant.volume' || dataSource === 'variant.volumeml'
}

function formatLiters(value: number) {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(value)
}

function formatVolumeFacetOptionLabel(facet: FacetRegistryRecord, rawValue: string, fallback?: string) {
  if (!isVolumeFacet(facet)) return fallback ?? rawValue

  const normalized = String(rawValue).trim().replace(',', '.')
  const numericValue = Number(normalized)
  if (!Number.isFinite(numericValue) || numericValue <= 0) return fallback ?? rawValue

  const liters = numericValue >= 20 ? numericValue / 1000 : numericValue
  return `${formatLiters(liters)} \u043b`
}

function formatFacetOptionLabel(facet: FacetRegistryRecord, rawValue: string, fallback?: string) {
  return formatVolumeFacetOptionLabel(facet, rawValue, fallback)
}

/**
 * Model-agnostic facet computation: given already-loaded records for a scope and a way to
 * read a facet's values off one record (`readValues`) and to test a record against every
 * OTHER selected facet (`matchesOtherSelections`, for disjunctive/"count as if this facet
 * weren't applied" counters), produces the same CatalogFacetDto[] shape regardless of
 * whether the underlying model is Product, InventoryItem, MenuItem, etc.
 */
export function computeScopeFacets<TRecord>(params: {
  facets: FacetRegistryRecord[]
  records: TRecord[]
  selectedFacets: CatalogFacetSelectedValues
  includeHiddenFacets?: boolean
  readValues: (
    record: TRecord,
    facet: FacetRegistryRecord,
    context: {
      facets: FacetRegistryRecord[]
      selectedFacets: CatalogFacetSelectedValues
      ignoredFacetKey: string
    }
  ) => string[]
  matchesOtherSelections: (
    record: TRecord,
    facets: FacetRegistryRecord[],
    selectedFacets: CatalogFacetSelectedValues,
    ignoredFacetKey: string
  ) => boolean
}): { facets: CatalogFacetDto[]; appliedFacets: CatalogFacetSelectedValues } {
  const { facets, records, selectedFacets, includeHiddenFacets, readValues, matchesOtherSelections } = params
  const result: CatalogFacetDto[] = []

  for (const facet of facets) {
    const recordsForCounter = records.filter((record) =>
      matchesOtherSelections(record, facets, selectedFacets, facet.key)
    )
    const valueLists = recordsForCounter.map((record) =>
      readValues(record, facet, {
        facets,
        selectedFacets,
        ignoredFacetKey: facet.key,
      })
    )
    const { options, fillRate } = buildOptionsFromValueLists(facet, valueLists, selectedFacets)

    // "Не указано": only for PRODUCT-level facets, and only when the field is genuinely
    // partially filled (some null, some not) — a facet that's all-null or all-filled has
    // nothing useful to say about NULL, so don't clutter it with a 0- or 100%-count option.
    if (facet.level === FacetLevel.PRODUCT) {
      const nullCount = valueLists.filter((values) => values.length === 0).length
      if (nullCount > 0 && nullCount < valueLists.length) {
        const selectedValues = normalizeStringArray(selectedFacets[facet.key])
        options.push({
          value: UNSPECIFIED_FACET_VALUE,
          label: 'Не указано',
          count: nullCount,
          selected: selectedValues.includes(UNSPECIFIED_FACET_VALUE),
          disabled: false,
          metadata: null,
        })
      }
    }

    const selected = selectedFacets[facet.key] ?? null
    const isSelected = hasFacetSelection(facet, selected)
    const minFillRate = Number(facet.minFillRate)
    const visible =
      Boolean(includeHiddenFacets) ||
      isSelected ||
      (options.filter((option) => option.count > 0 || option.selected).length >= 2 &&
        fillRate >= minFillRate)

    if (!visible && !includeHiddenFacets) continue

    result.push({
      key: facet.key,
      label: facet.label,
      type: facet.type,
      level: facet.level,
      dataSource: facet.dataSource,
      options,
      selected,
      visible,
      fillRate,
      sortOrder: facet.sortOrder,
    })
  }

  return {
    facets: result,
    appliedFacets: selectedFacets,
  }
}
