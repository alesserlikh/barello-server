import { CatalogCategorySection, OfferAvailabilityLevel, Prisma, ProductCatalogStatus } from '../../generated/prisma'
import { prisma } from '../../lib/prisma'
import { externalIdWhere, isPublicId, normalizePublicId } from '../../lib/public-id'
import { env } from '../../config/env'
import { resolveEffectiveCategorySelection } from '../catalog-filters/facet-shared'
import type {
  CatalogListItemDto,
  CatalogProductCardDto,
} from './catalog-api.contract'

export type CatalogAvailability = 'ACTIVE' | 'ORDERABLE' | 'SOLD_OUT' | 'UNAVAILABLE'
export type CatalogDeliveryDays = 'today' | 'tomorrow' | 'up_to_3' | 'up_to_7'
export type CatalogStockLevel = 'high' | 'limited'

export type CatalogProductsQuery = {
  search?: string
  query?: string
  categoryId?: string
  categoryIds?: string[]
  sections?: CatalogCategorySection[]
  supplierId?: string
  supplierIds?: string[]
  availability?: CatalogAvailability[]
  deliveryDays?: CatalogDeliveryDays[]
  stockLevels?: CatalogStockLevel[]
  isPromo?: string
  sort?: string
  offset?: number
  limit?: number
  page?: number
  pageSize?: number
  facetProductWhere?: Prisma.ProductWhereInput
}

const DEFAULT_CATALOG_OFFSET = 0
const DEFAULT_CATALOG_LIMIT = 20
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
const QUICK_FILTER_ROOT_GROUP_ORDER = new Map<string, number>([
  ['vino', 0],
  ['krepkii-alkogol', 1],
  ['pivo-sidr-i-medovuha', 2],
  ['gotovye-alkogolnye-napitki-rtd', 2],
  ['bezalkogolnye-napitki', 3],
])
const QUICK_FILTER_ROOT_CODES = Array.from(QUICK_FILTER_ROOT_GROUP_ORDER.keys())
const QUICK_FILTER_FALLBACK_GROUP_ORDER = 4

function buildCatalogFileUrl(storageKey: string | null | undefined) {
  if (!storageKey) return null
  const normalizedKey = storageKey.replace(/^uploads\//, '').replace(/^\/+/, '')
  return `${env.apiPublicUrl.replace(/\/$/, '')}/uploads/${normalizedKey}`
}

type CatalogCategoryRecord = {
  id: string
  name: string
  code: string | null
  parentId: string | null
  section?: unknown
  sortOrder?: number
  isTagActive?: boolean
  showInQuickFilters?: boolean
  isHidden?: boolean
  createdAt: Date
  updatedAt: Date
  productsCount?: number
  level?: number
}

export type GetCatalogCategoriesOptions = {
  includeChildren?: boolean
  includeCode?: boolean
  includeProductsCount?: boolean
  level?: number
  quickOnly?: boolean
}

function toNumber(value: unknown) {
  if (value === null || value === undefined) {
    return null
  }

  return Number(value)
}

function toStringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : []
}

function serializeAttributesJson(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function getStringAttribute(attributes: Record<string, unknown>, key: string) {
  const value = attributes[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getStringListAttribute(attributes: Record<string, unknown>, key: string) {
  const value = attributes[key]
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      .map((item) => item.trim())
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map((item) => item.trim()).filter(Boolean)
  }
  return []
}

function formatDecimalLabel(value: number) {
  return Number.isInteger(value)
    ? String(value)
    : value.toLocaleString('ru-RU', {
        maximumFractionDigits: 3,
      })
}

function formatCatalogMeasureLabel(
  value: number | null,
  unit: string | null | undefined,
) {
  if (value === null || !unit) {
    return null
  }

  const normalizedUnit = unit.trim().toLowerCase()

  if (normalizedUnit === 'ml' || normalizedUnit === 'мл') {
    return `${formatDecimalLabel(value / 1000)} л`
  }

  if (normalizedUnit === 'l' || normalizedUnit === 'л') {
    return `${formatDecimalLabel(value)} л`
  }

  return `${formatDecimalLabel(value)} ${unit}`
}

function getSupplierDisplayName(supplier: {
  name: string
  catalogName?: string | null
  business?: { name: string; taxNumber: string } | null
}) {
  return supplier.catalogName?.trim() || supplier.business?.name?.trim() || supplier.name
}

function normalizeAvailability(params: {
  offerAvailabilityLevel: OfferAvailabilityLevel
  offerIsAvailable: boolean
  quantity: number
  hasKnownStock?: boolean
  inventoryMarkedOutOfStock: boolean
}): CatalogAvailability {
  if (
    params.offerIsAvailable &&
    !params.inventoryMarkedOutOfStock &&
    params.hasKnownStock !== false &&
    (
      params.quantity > 0 ||
      params.offerAvailabilityLevel === OfferAvailabilityLevel.IN_STOCK ||
      params.offerAvailabilityLevel === OfferAvailabilityLevel.LOW_STOCK
    )
  ) {
    return 'ACTIVE'
  }

  if (params.offerIsAvailable) {
    return 'ORDERABLE'
  }

  if (params.inventoryMarkedOutOfStock) {
    return 'SOLD_OUT'
  }

  return 'UNAVAILABLE'
}

function normalizeDeliveryDays(params: {
  availability: CatalogAvailability
  deliveryTerm: string | null
}): CatalogDeliveryDays | null {
  if (params.availability === 'ACTIVE') {
    return 'today'
  }

  const normalizedTerm = params.deliveryTerm?.trim().toLowerCase() ?? ''

  if (!normalizedTerm) {
    return null
  }

  if (normalizedTerm.includes('today') || normalizedTerm.includes('сегодня')) {
    return 'today'
  }

  if (normalizedTerm.includes('tomorrow') || normalizedTerm.includes('завтра')) {
    return 'tomorrow'
  }

  const numericMatch = normalizedTerm.match(/(\d+)/)
  const days = numericMatch ? Number.parseInt(numericMatch[1], 10) : Number.NaN

  if (!Number.isNaN(days)) {
    if (days <= 0) {
      return 'today'
    }

    if (days === 1) {
      return 'tomorrow'
    }

    if (days <= 3) {
      return 'up_to_3'
    }

    if (days <= 7) {
      return 'up_to_7'
    }
  }

  if (normalizedTerm.includes('1-3') || normalizedTerm.includes('до 3')) {
    return 'up_to_3'
  }

  if (normalizedTerm.includes('до 7') || normalizedTerm.includes('1-7')) {
    return 'up_to_7'
  }

  return null
}

function normalizeStockLevel(params: {
  quantity: number
  availability: CatalogAvailability
  offerAvailabilityLevel: OfferAvailabilityLevel
}): CatalogStockLevel | null {
  if (params.availability !== 'ACTIVE') {
    return null
  }

  if (params.quantity >= 24 || params.offerAvailabilityLevel === OfferAvailabilityLevel.IN_STOCK) {
    return 'high'
  }

  if (params.quantity > 0 || params.offerAvailabilityLevel === OfferAvailabilityLevel.LOW_STOCK) {
    return 'limited'
  }

  return null
}

function getProductStatusFromAvailability(availability: CatalogAvailability) {
  if (availability === 'ACTIVE') return 'ACTIVE'
  if (availability === 'ORDERABLE') return 'ORDERABLE'
  if (availability === 'SOLD_OUT') return 'SOLD_OUT'
  return 'UNAVAILABLE'
}

function sumInventoryQuantity(
  inventoryItems: Array<{ quantity: unknown }>,
) {
  return inventoryItems.reduce((total, inventoryItem) => {
    return total + Number(inventoryItem.quantity)
  }, 0)
}

function getOfferStockQuantity(offer: { stockAvailable?: unknown }) {
  return toNumber(offer.stockAvailable) ?? 0
}

function serializeCategory(
  category: CatalogCategoryRecord,
  options: Required<Pick<GetCatalogCategoriesOptions, 'includeCode' | 'includeProductsCount'>>
) {
  return {
    id: category.id,
    name: category.name,
    parentId: category.parentId,
    level: category.level ?? 1,
    depth: category.level ?? 1,
    section: category.section ?? null,
    sortOrder: category.sortOrder ?? 0,
    isTagActive: category.isTagActive ?? true,
    showInQuickFilters: category.showInQuickFilters ?? false,
    isHidden: category.isHidden ?? false,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
    ...(options.includeCode ? { code: category.code } : {}),
    ...(options.includeProductsCount
      ? {
          productsCount: category.productsCount ?? 0,
        }
      : {}),
  }
}

function buildCategoryTree<T extends { id: string; parentId: string | null }>(categories: T[]) {
  const categoryMap = new Map<string, T & { children: Array<T & { children: any[] }> }>()

  for (const category of categories) {
    categoryMap.set(category.id, {
      ...category,
      children: [],
    })
  }

  const roots: Array<T & { children: Array<T & { children: any[] }> }> = []

  for (const category of categories) {
    const node = categoryMap.get(category.id)

    if (!node) {
      continue
    }

    if (category.parentId) {
      const parentNode = categoryMap.get(category.parentId)

      if (parentNode) {
        parentNode.children.push(node)
        continue
      }
    }

    roots.push(node)
  }

  return roots
}

function excludeHiddenCategorySubtrees<T extends { id: string; parentId: string | null; isHidden?: boolean }>(
  categories: T[]
) {
  const categoriesById = new Map(categories.map((category) => [category.id, category]))
  const visibilityCache = new Map<string, boolean>()

  function isVisible(category: T): boolean {
    const cached = visibilityCache.get(category.id)

    if (cached !== undefined) {
      return cached
    }

    if (category.isHidden) {
      visibilityCache.set(category.id, false)
      return false
    }

    if (!category.parentId) {
      visibilityCache.set(category.id, true)
      return true
    }

    const parent = categoriesById.get(category.parentId)
    const visible = parent ? isVisible(parent) : true
    visibilityCache.set(category.id, visible)
    return visible
  }

  return categories.filter((category) => isVisible(category))
}

function includeActiveCatalogCategories<
  T extends { id: string; parentId: string | null; isTagActive?: boolean }
>(categories: T[]) {
  const activeCategories = categories.filter((category) => category.isTagActive !== false)
  const activeCategoryIds = new Set(activeCategories.map((category) => category.id))

  return activeCategories.map((category) => {
    if (!category.parentId || activeCategoryIds.has(category.parentId)) {
      return category
    }

    return {
      ...category,
      parentId: null,
    }
  })
}

function getPublicCatalogCategories<
  T extends {
    id: string
    parentId: string | null
    isHidden?: boolean
    isTagActive?: boolean
    showInQuickFilters?: boolean
  }
>(categories: T[]) {
  return includeActiveCatalogCategories(excludeHiddenCategorySubtrees(categories))
}

async function getPublicProductCategoryCounts() {
  const publicProductCategories = await prisma.product.findMany({
    where: {
      ...PUBLIC_PRODUCT_WHERE,
      categoryId: {
        not: null,
      },
      category: {
        is: {
          isTagActive: true,
          isHidden: false,
        },
      },
      supplierProducts: {
        some: PUBLIC_SUPPLIER_PRODUCT_WHERE,
      },
    },
    select: {
      categoryId: true,
    },
  })
  const publicProductCategoryCounts = new Map<string, number>()

  for (const product of publicProductCategories) {
    if (!product.categoryId) continue
    publicProductCategoryCounts.set(
      product.categoryId,
      (publicProductCategoryCounts.get(product.categoryId) ?? 0) + 1
    )
  }

  return publicProductCategoryCounts
}

function buildCategoryLevelMap(categories: CatalogCategoryRecord[]) {
  const parentMap = new Map(categories.map((category) => [category.id, category.parentId]))
  const levelCache = new Map<string, number>()

  function resolveLevel(categoryId: string): number {
    const cachedLevel = levelCache.get(categoryId)

    if (cachedLevel) {
      return cachedLevel
    }

    const parentId = parentMap.get(categoryId) ?? null

    if (!parentId) {
      levelCache.set(categoryId, 1)
      return 1
    }

    const parentLevel = resolveLevel(parentId)
    const level = parentLevel + 1

    levelCache.set(categoryId, level)
    return level
  }

  for (const category of categories) {
    resolveLevel(category.id)
  }

  return levelCache
}

function buildAggregatedProductsCountMap(
  categories: Array<{ id: string; parentId: string | null; _count: { products: number } }>
) {
  const childrenMap = new Map<string | null, string[]>()
  const directCounts = new Map<string, number>()
  const totalsCache = new Map<string, number>()

  for (const category of categories) {
    directCounts.set(category.id, category._count.products)

    const siblingIds = childrenMap.get(category.parentId) ?? []
    siblingIds.push(category.id)
    childrenMap.set(category.parentId, siblingIds)
  }

  function resolveTotal(categoryId: string): number {
    const cachedTotal = totalsCache.get(categoryId)

    if (cachedTotal !== undefined) {
      return cachedTotal
    }

    const childrenIds = childrenMap.get(categoryId) ?? []
    const total =
      (directCounts.get(categoryId) ?? 0) +
      childrenIds.reduce((sum, childId) => sum + resolveTotal(childId), 0)

    totalsCache.set(categoryId, total)
    return total
  }

  for (const category of categories) {
    resolveTotal(category.id)
  }

  return totalsCache
}

function collectTreeNodesAtLevel<T extends { id: string; parentId: string | null; children?: T[] }>(
  categories: T[],
  targetLevel: number
) {
  const matchedNodes: T[] = []

  function visit(nodes: T[], level: number) {
    for (const node of nodes) {
      if (level === targetLevel) {
        matchedNodes.push(node)
        continue
      }

      if (node.children?.length) {
        visit(node.children, level + 1)
      }
    }
  }

  visit(categories, 1)

  return matchedNodes
}

function getQuickFilterRootCategory<
  T extends {
    id: string
    parentId: string | null
    code?: string | null
  }
>(category: T, categoriesById: Map<string, T>) {
  let currentCategory = category
  const visitedCategoryIds = new Set<string>()

  while (currentCategory.parentId && !visitedCategoryIds.has(currentCategory.id)) {
    visitedCategoryIds.add(currentCategory.id)
    const parentCategory = categoriesById.get(currentCategory.parentId)

    if (!parentCategory) {
      break
    }

    currentCategory = parentCategory
  }

  return currentCategory
}

function getQuickFilterRootCode(categoryCode: string | null | undefined) {
  if (!categoryCode) {
    return null
  }

  return QUICK_FILTER_ROOT_CODES.find(
    (rootCode) => categoryCode === rootCode || categoryCode.startsWith(`${rootCode}-`)
  ) ?? null
}

function getQuickFilterRootGroupOrder<
  T extends {
    id: string
    parentId: string | null
    code?: string | null
  }
>(category: T, categoriesById: Map<string, T>) {
  const categoryRootCode = getQuickFilterRootCode(category.code)

  if (categoryRootCode) {
    return QUICK_FILTER_ROOT_GROUP_ORDER.get(categoryRootCode) ?? QUICK_FILTER_FALLBACK_GROUP_ORDER
  }

  const rootCategory = getQuickFilterRootCategory(category, categoriesById)
  const rootCode = getQuickFilterRootCode(rootCategory.code)

  return rootCode
    ? (QUICK_FILTER_ROOT_GROUP_ORDER.get(rootCode) ?? QUICK_FILTER_FALLBACK_GROUP_ORDER)
    : QUICK_FILTER_FALLBACK_GROUP_ORDER
}

function sortQuickFilterCategories<
  T extends {
    id: string
    name: string
    parentId: string | null
    code?: string | null
    sortOrder?: number | null
  }
>(categories: T[]) {
  const categoriesById = new Map(categories.map((category) => [category.id, category]))

  return [...categories].sort((leftCategory, rightCategory) => {
    const leftRoot = getQuickFilterRootCategory(leftCategory, categoriesById)
    const rightRoot = getQuickFilterRootCategory(rightCategory, categoriesById)
    const leftRootGroupOrder = getQuickFilterRootGroupOrder(leftCategory, categoriesById)
    const rightRootGroupOrder = getQuickFilterRootGroupOrder(rightCategory, categoriesById)

    if (leftRootGroupOrder !== rightRootGroupOrder) {
      return leftRootGroupOrder - rightRootGroupOrder
    }

    const leftRootSortOrder = leftRoot.sortOrder ?? 0
    const rightRootSortOrder = rightRoot.sortOrder ?? 0

    if (leftRootSortOrder !== rightRootSortOrder) {
      return leftRootSortOrder - rightRootSortOrder
    }

    const leftSortOrder = leftCategory.sortOrder ?? 0
    const rightSortOrder = rightCategory.sortOrder ?? 0

    if (leftSortOrder !== rightSortOrder) {
      return leftSortOrder - rightSortOrder
    }

    return leftCategory.name.localeCompare(rightCategory.name, 'ru')
  })
}

function filterQuickCategoryTree<
  T extends {
    id: string
    name: string
    parentId: string | null
    code?: string | null
    sortOrder?: number | null
    showInQuickFilters?: boolean
    children?: T[]
  }
>(categories: T[]): T[] {
  return sortQuickFilterCategories(categories).flatMap((category) => {
    const children = category.children?.length
      ? filterQuickCategoryTree(category.children)
      : []

    if (category.showInQuickFilters) {
      return [{
        ...category,
        children,
      }]
    }

    return children
  })
}

export async function getCatalogCategories(options: GetCatalogCategoriesOptions = {}) {
  const includeChildren = options.includeChildren ?? false
  const includeCode = options.includeCode ?? true
  const includeProductsCount = options.includeProductsCount ?? true
  const quickOnly = options.quickOnly ?? false
  const level =
    typeof options.level === 'number' && Number.isInteger(options.level) && options.level > 0
      ? options.level
      : undefined

  if (includeProductsCount) {
    const [categories, publicProductCategoryCounts] = await Promise.all([
      prisma.catalogCategory.findMany({
        orderBy: [
          { parentId: 'asc' },
          { sortOrder: 'asc' },
          { name: 'asc' },
        ],
      }),
      getPublicProductCategoryCounts(),
    ])
    const visibleCategories = getPublicCatalogCategories(categories)
    const quickCategoryIds = new Set(
      visibleCategories
        .filter((category) => category.showInQuickFilters)
        .map((category) => category.id)
    )
    const visibleCategoriesWithPublicCounts = visibleCategories.map((category) => ({
      ...category,
      _count: {
        products: publicProductCategoryCounts.get(category.id) ?? 0,
      },
    }))

    const aggregatedCounts = buildAggregatedProductsCountMap(visibleCategoriesWithPublicCounts)
    const categoryLevels = level ? buildCategoryLevelMap(visibleCategoriesWithPublicCounts) : null
    const fullCategoryLevels = categoryLevels ?? buildCategoryLevelMap(visibleCategoriesWithPublicCounts)
    const serializedCategories = visibleCategoriesWithPublicCounts
      .filter((category) => {
        if (!categoryLevels || !level) {
          return true
        }

        return categoryLevels.get(category.id) === level
      })
      .filter((category) => {
        return !quickOnly || quickCategoryIds.has(category.id)
      })
      .map((category) =>
        serializeCategory(
          {
            id: category.id,
            name: category.name,
            code: category.code,
            parentId: category.parentId,
            section: category.section,
            sortOrder: category.sortOrder,
            isTagActive: category.isTagActive,
            showInQuickFilters: category.showInQuickFilters,
            isHidden: category.isHidden,
            createdAt: category.createdAt,
            updatedAt: category.updatedAt,
            productsCount: aggregatedCounts.get(category.id) ?? 0,
            level: fullCategoryLevels.get(category.id),
          },
          {
            includeCode,
            includeProductsCount: true,
          }
        )
      )

    if (!includeChildren) {
      return quickOnly ? sortQuickFilterCategories(serializedCategories) : serializedCategories
    }

    const fullSerializedCategories = visibleCategoriesWithPublicCounts.map((category) =>
      serializeCategory(
        {
          id: category.id,
          name: category.name,
          code: category.code,
          parentId: category.parentId,
          section: category.section,
          sortOrder: category.sortOrder,
          isTagActive: category.isTagActive,
          showInQuickFilters: category.showInQuickFilters,
          isHidden: category.isHidden,
          createdAt: category.createdAt,
          updatedAt: category.updatedAt,
          productsCount: aggregatedCounts.get(category.id) ?? 0,
          level: fullCategoryLevels.get(category.id),
        },
        {
          includeCode,
          includeProductsCount: true,
        }
      )
    )

    const tree = buildCategoryTree(fullSerializedCategories)

    if (!level) {
      return quickOnly ? filterQuickCategoryTree(tree) : tree
    }

    const levelNodes = collectTreeNodesAtLevel(tree, level)

    return quickOnly
      ? sortQuickFilterCategories(
          levelNodes.filter((category) => quickCategoryIds.has(category.id))
        )
      : levelNodes
  }

  const categories = await prisma.catalogCategory.findMany({
    orderBy: [
      { parentId: 'asc' },
      { sortOrder: 'asc' },
      { name: 'asc' },
    ],
    select: {
      id: true,
      name: true,
      code: true,
      parentId: true,
      section: true,
      sortOrder: true,
      isTagActive: true,
      showInQuickFilters: true,
      isHidden: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  const visibleCategories = getPublicCatalogCategories(categories)
  const quickCategoryIds = new Set(
    visibleCategories
      .filter((category) => category.showInQuickFilters)
      .map((category) => category.id)
  )

  const categoryLevels = level ? buildCategoryLevelMap(visibleCategories) : null
  const fullCategoryLevels = categoryLevels ?? buildCategoryLevelMap(visibleCategories)
  const serializedCategories = visibleCategories
    .filter((category) => {
      if (!categoryLevels || !level) {
        return true
      }

      return categoryLevels.get(category.id) === level
    })
    .filter((category) => {
      return !quickOnly || quickCategoryIds.has(category.id)
    })
    .map((category) =>
      serializeCategory(
        {
          id: category.id,
          name: category.name,
          code: category.code,
          parentId: category.parentId,
          section: category.section,
          sortOrder: category.sortOrder,
          isTagActive: category.isTagActive,
          showInQuickFilters: category.showInQuickFilters,
          isHidden: category.isHidden,
          createdAt: category.createdAt,
          updatedAt: category.updatedAt,
          level: fullCategoryLevels.get(category.id),
        },
        {
          includeCode,
          includeProductsCount: false,
        }
      )
    )

  if (!includeChildren) {
    return quickOnly ? sortQuickFilterCategories(serializedCategories) : serializedCategories
  }

  const fullSerializedCategories = visibleCategories.map((category) =>
    serializeCategory(
      {
        id: category.id,
        name: category.name,
        code: category.code,
        parentId: category.parentId,
        section: category.section,
        sortOrder: category.sortOrder,
        isTagActive: category.isTagActive,
        showInQuickFilters: category.showInQuickFilters,
        isHidden: category.isHidden,
        createdAt: category.createdAt,
        updatedAt: category.updatedAt,
        level: fullCategoryLevels.get(category.id),
      },
      {
        includeCode,
        includeProductsCount: false,
      }
    )
  )

  const tree = buildCategoryTree(fullSerializedCategories)

  if (!level) {
    return quickOnly ? filterQuickCategoryTree(tree) : tree
  }

  const levelNodes = collectTreeNodesAtLevel(tree, level)

  return quickOnly
    ? sortQuickFilterCategories(
        levelNodes.filter((category) => quickCategoryIds.has(category.id))
      )
    : levelNodes
}

async function getCatalogProductsList(query: CatalogProductsQuery) {
  const effectiveSearch = query.search?.trim() || query.query?.trim() || undefined
  const supplierIds = await resolveSupplierFilterIds(query)
  const sections = query.sections?.length
    ? Array.from(new Set(query.sections))
    : []
  const requestedCategoryIds = query.categoryIds?.length
    ? query.categoryIds
    : typeof query.categoryId === 'string' && query.categoryId.trim()
      ? [query.categoryId.trim()]
      : []
  const categorySelection = requestedCategoryIds.length
    ? await resolveEffectiveCategorySelection(requestedCategoryIds)
    : {
        selectedCategoryIds: [],
        effectiveCategoryIds: [],
        expandedCategoryIds: [],
      }
  const categoryIds = requestedCategoryIds.length
    ? categorySelection.expandedCategoryIds
    : null

  if (requestedCategoryIds.length && categoryIds && categoryIds.length === 0) {
    return {
      products: [],
      appliedCategoryIds: categorySelection.effectiveCategoryIds,
    }
  }

  const baseWhere: Prisma.ProductWhereInput = {
      ...PUBLIC_PRODUCT_WHERE,
      categoryId: {
        not: null,
      },
      category: {
        is: {
          isTagActive: true,
          isHidden: false,
          ...(sections.length ? { section: { in: sections } } : {}),
        },
      },
      supplierProducts: {
        some: {
          ...PUBLIC_SUPPLIER_PRODUCT_WHERE,
          ...(supplierIds.length ? { supplierId: { in: supplierIds } } : {}),
        },
      },
      ...(effectiveSearch
        ? {
            OR: [
              {
                name: {
                  contains: effectiveSearch,
                  mode: 'insensitive',
                },
              },
              {
                translatedName: {
                  contains: effectiveSearch,
                  mode: 'insensitive',
                },
              },
              {
                barcode: {
                  contains: effectiveSearch,
                  mode: 'insensitive',
                },
              },
              {
                article: {
                  contains: effectiveSearch,
                  mode: 'insensitive',
                },
              },
              {
                supplierProducts: {
                  some: {
                    supplierSku: {
                      contains: effectiveSearch,
                      mode: 'insensitive',
                    },
                  },
                },
              },
              {
                supplierProducts: {
                  some: {
                    supplier: {
                      OR: [
                        {
                          catalogName: {
                            contains: effectiveSearch,
                            mode: 'insensitive',
                          },
                        },
                        {
                          name: {
                            contains: effectiveSearch,
                            mode: 'insensitive',
                          },
                        },
                        {
                          business: {
                            name: {
                              contains: effectiveSearch,
                              mode: 'insensitive',
                            },
                          },
                        },
                      ],
                    },
                  },
                },
              },
              {
                variants: {
                  some: {
                    packagingType: {
                      contains: effectiveSearch,
                      mode: 'insensitive',
                    },
                  },
                },
              },
              {
                attributesJson: {
                  path: ['packagingType'],
                  string_contains: effectiveSearch,
                },
              },
              {
                attributesJson: {
                  path: ['packagingOptions'],
                  array_contains: [effectiveSearch],
                },
              },
            ],
          }
        : {}),
      ...(categoryIds
        ? {
            categoryId: {
              in: categoryIds,
            },
          }
        : {}),
      ...(query.isPromo !== undefined
        ? {
            isPromo: query.isPromo === 'true',
          }
        : {}),
  }
  const where: Prisma.ProductWhereInput = query.facetProductWhere
    ? {
        AND: [
          baseWhere,
          query.facetProductWhere,
        ],
      }
    : baseWhere

  const products = await prisma.product.findMany({
    where,
    include: {
      category: {
        select: {
          id: true,
          name: true,
          code: true,
          parentId: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      mainImage: {
        select: {
          id: true,
          fileName: true,
          storageKey: true,
        },
      },
      variants: true,
      supplierProducts: {
        where: {
          ...PUBLIC_SUPPLIER_PRODUCT_WHERE,
          ...(supplierIds.length ? { supplierId: { in: supplierIds } } : {}),
        },
        include: {
          supplier: {
            include: {
              business: {
                select: {
                  name: true,
                  taxNumber: true,
                },
              },
              inventoryItems: true,
            },
          },
          productVariant: true,
          offers: {
            where: PUBLIC_OFFER_WHERE,
            orderBy: {
              price: 'asc',
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  })

  const serialized = products.map((product) => {
    const offers = product.supplierProducts.flatMap((supplierProduct) => {
      const matchingInventoryItems = supplierProduct.supplier.inventoryItems.filter(
        (inventoryItem) => inventoryItem.productId === product.id
      )
      const inventoryQuantity = sumInventoryQuantity(matchingInventoryItems)
      const hasInventoryQuantity = matchingInventoryItems.length > 0
      const inventoryMarkedOutOfStock =
        hasInventoryQuantity &&
        matchingInventoryItems.every((inventoryItem) => inventoryItem.isOutOfStock)
      const supplierName = getSupplierDisplayName(supplierProduct.supplier)

      return supplierProduct.offers.map((offer) => {
        const supplierQuantity = hasInventoryQuantity
          ? inventoryQuantity
          : getOfferStockQuantity(offer)
        const availability = normalizeAvailability({
          offerAvailabilityLevel: offer.availabilityLevel,
          offerIsAvailable: offer.isAvailable,
          quantity: supplierQuantity,
          hasKnownStock: hasInventoryQuantity || offer.stockAvailable !== null,
          inventoryMarkedOutOfStock,
        })
        const stockLevel = normalizeStockLevel({
          quantity: supplierQuantity,
          availability,
          offerAvailabilityLevel: offer.availabilityLevel,
        })
        const deliveryDays = normalizeDeliveryDays({
          availability,
          deliveryTerm: offer.deliveryTerm,
        })

        return {
          id: offer.id,
          supplierProductId: supplierProduct.id,
          supplierId: supplierProduct.supplierId,
          supplierPublicId: supplierProduct.supplier.publicId,
          supplierName,
          supplierCompanyName:
            supplierProduct.supplier.catalogName ||
            supplierProduct.supplier.business?.name ||
            null,
          supplierInn: supplierProduct.supplier.business?.taxNumber || null,
          supplierSku: supplierProduct.supplierSku || null,
          productVariantId: supplierProduct.productVariantId,
          productVariant: supplierProduct.productVariant
            ? {
                id: supplierProduct.productVariant.id,
                volume: toNumber(supplierProduct.productVariant.volume),
                volumeUnit: supplierProduct.productVariant.volumeUnit,
                packageSize: toNumber(supplierProduct.productVariant.packageSize),
                packageSizeUnit: supplierProduct.productVariant.packageSizeUnit,
                packagingType: supplierProduct.productVariant.packagingType,
                isDefault: supplierProduct.productVariant.isDefault,
              }
            : null,
          price: Number(offer.price),
          currency: offer.currency,
          unit: offer.unit,
          available: availability === 'ACTIVE' || availability === 'ORDERABLE',
          availability,
          availabilityLevel: offer.availabilityLevel,
          quantity: supplierQuantity,
          stockLevel,
          deliveryDays,
          deliveryTerm: offer.deliveryTerm,
          specialOfferText: offer.specialOfferText,
          specialConditionText: offer.specialConditionText,
          isAvailable: offer.isAvailable,
          stockAvailable: toNumber(offer.stockAvailable),
          stockTotal: toNumber(offer.stockTotal),
          minOrderQty: toNumber(offer.minOrderQty),
          packQty: toNumber(offer.packQty),
          deliveryDaysMin: offer.deliveryDaysMin,
          deliveryDaysMax: offer.deliveryDaysMax,
          validFrom: offer.validFrom,
          validTo: offer.validTo,
          createdAt: offer.createdAt,
          updatedAt: offer.updatedAt,
        }
      })
    })

    const selectedSupplierIds = supplierIds

    const filteredOffers = offers.filter((offer) => {
      if (
        query.availability?.length &&
        !query.availability.includes(offer.availability)
      ) {
        return false
      }

      if (
        query.stockLevels?.length &&
        (!offer.stockLevel || !query.stockLevels.includes(offer.stockLevel))
      ) {
        return false
      }

      if (
        query.deliveryDays?.length &&
        (!offer.deliveryDays || !query.deliveryDays.includes(offer.deliveryDays))
      ) {
        return false
      }

      if (
        selectedSupplierIds.length > 0 &&
        !selectedSupplierIds.includes(offer.supplierId)
      ) {
        return false
      }

      return true
    })

    const matchedSupplierIds = new Set(filteredOffers.map((offer) => offer.supplierId))
    const hasAllSelectedSuppliers =
      selectedSupplierIds.length === 0 ||
      selectedSupplierIds.every((supplierId) => matchedSupplierIds.has(supplierId))

    const purchasableOffers = filteredOffers.filter(
      (offer) => offer.available && offer.price > 0,
    )
    const totalSupplierQuantity = filteredOffers.reduce(
      (total, offer) => total + offer.quantity,
      0
    )
    const priceFrom =
      purchasableOffers.length > 0
        ? Math.min(...purchasableOffers.map((offer) => offer.price))
        : null
    const cheapestOffer = purchasableOffers.reduce<(typeof purchasableOffers)[number] | null>(
      (best, offer) => {
        if (!best || offer.price < best.price) {
          return offer
        }

        return best
      },
      null,
    )
    const previewOffer = cheapestOffer ?? filteredOffers[0] ?? null
    const priceFromMoney = priceFrom !== null
      ? {
          amount: priceFrom,
          currency: cheapestOffer?.currency ?? 'RUB',
        }
      : null
    const previewVolume =
      previewOffer?.productVariant?.volume ??
      toNumber(product.packageVolume)
    const previewVolumeUnit =
      previewOffer?.productVariant?.volumeUnit ??
      product.packageVolumeUnit
    const previewMeasureLabel = formatCatalogMeasureLabel(previewVolume, previewVolumeUnit)
    const productAvailability = filteredOffers.some((offer) => offer.availability === 'ACTIVE')
      ? 'ACTIVE'
      : filteredOffers.some((offer) => offer.availability === 'ORDERABLE')
        ? 'ORDERABLE'
        : filteredOffers.some((offer) => offer.availability === 'SOLD_OUT')
          ? 'SOLD_OUT'
          : 'UNAVAILABLE'
    const productStockAvailable =
      previewOffer?.stockAvailable ??
      (previewOffer?.availability === 'ORDERABLE' ? null : previewOffer?.quantity ?? null)
    const productEanList = product.barcode ? [product.barcode] : []
    const productAttributesJson = serializeAttributesJson(product.attributesJson)
    const defaultVariant = product.variants.find((variant) => variant.isDefault) ?? product.variants[0] ?? null
    const packagingType =
      previewOffer?.productVariant?.packagingType ??
      defaultVariant?.packagingType ??
      getStringAttribute(productAttributesJson, 'packagingType')
    const packagingOptions = getStringListAttribute(productAttributesJson, 'packagingOptions')
    const skuPreview = previewOffer
      ? {
          id: previewOffer.supplierProductId,
          productVariantId: previewOffer.productVariantId,
          packageId: null,
          volume: previewOffer.productVariant?.volume ?? null,
          volumeMl: previewOffer.productVariant?.volume ?? null,
          volumeUnit: previewOffer.productVariant?.volumeUnit ?? null,
          measureLabel: formatCatalogMeasureLabel(
            previewOffer.productVariant?.volume ?? null,
            previewOffer.productVariant?.volumeUnit ?? null,
          ),
          packLine: null,
          packagingType: previewOffer.productVariant?.packagingType ?? packagingType,
          packageSize: previewOffer.productVariant?.packageSize ?? null,
          packageSizeUnit: previewOffer.productVariant?.packageSizeUnit ?? null,
          packageTitle: previewOffer.productVariant?.packageSize
            ? [
                previewOffer.productVariant.packageSize,
                previewOffer.productVariant.packageSizeUnit,
              ].filter(Boolean).join(' ')
            : null,
          supplierSku: previewOffer.supplierSku,
          barcode: product.barcode,
          article: product.article,
          status: getProductStatusFromAvailability(previewOffer.availability),
          priceFrom: priceFromMoney,
          offers: filteredOffers.map((offer) => ({
            id: offer.id,
            supplier: {
              id: offer.supplierId,
              publicId: offer.supplierPublicId,
              name: offer.supplierName,
            },
            status: offer.availability === 'SOLD_OUT' ? 'OUT_OF_STOCK' : offer.available ? 'ACTIVE' : 'CLOSED',
            availability: offer.availability,
            price: {
              amount: offer.price,
              currency: offer.currency,
            },
            basePrice: null,
            stockAvailable: offer.stockAvailable,
            stockTotal: offer.stockTotal,
            deliveryDaysMin: offer.deliveryDaysMin,
            deliveryDaysMax: offer.deliveryDaysMax,
            minOrderQty: offer.minOrderQty,
            packQty: offer.packQty,
            isAvailable: offer.isAvailable,
          })),
        }
      : null
    const category = product.category
      ? serializeCategory(product.category, {
          includeCode: true,
          includeProductsCount: false,
        })
      : null
    const attributes = {
      brand: product.brand,
      producer: product.producer,
      manufacturer: product.manufacturer,
      country: product.country,
      region: product.region,
      vintage: product.vintage ?? product.manufacturedYear,
      alcoholPercent: toNumber(product.alcoholPercent),
      alcoholPercentMax: toNumber(product.alcoholPercentMax),
      color: product.color,
      sugar: product.sugar,
      grapeSorts: toStringList(product.grapeSorts),
      features: toStringList(product.features),
      packagingType,
      packagingOptions,
    }
    const image = product.mainImage
      ? {
          id: product.mainImage.id,
          url: buildCatalogFileUrl(product.mainImage.storageKey) ?? '',
          alt: product.name,
          fileName: product.mainImage.fileName,
        }
      : null
    const packageInfo = {
      quantity: toNumber(product.packageQuantity),
      size: previewOffer?.productVariant?.packageSize ?? null,
      unit: previewOffer?.productVariant?.packageSizeUnit ?? null,
      title: skuPreview?.packageTitle ?? null,
    }

    return {
      id: product.id,
      publicId: product.publicId,
      canonicalTitle: product.name,
      russianTitle: product.translatedName,
      title: product.name,
      name: product.name,
      translatedTitle: product.translatedName,
      translatedName: product.translatedName,
      description: product.description,
      barcode: product.barcode,
      eanList: productEanList,
      article: product.article,
      manufacturer: product.manufacturer,
      brand: product.brand,
      producer: product.producer,
      country: product.country,
      region: product.region,
      manufacturedYear: product.manufacturedYear,
      vintage: attributes.vintage,
      alcoholPercent: attributes.alcoholPercent,
      alcoholPercentMax: attributes.alcoholPercentMax,
      volume: previewVolume,
      volumeMl: previewVolume,
      volumeUnit: previewVolumeUnit,
      measureLabel: previewMeasureLabel,
      packLine: null,
      supplierSku: previewOffer?.supplierSku ?? null,
      availability: productAvailability,
      stockAvailable: productStockAvailable,
      minOrderQty: previewOffer?.minOrderQty ?? null,
      packQty: previewOffer?.packQty ?? null,
      packagingType,
      packagingOptions,
      color: product.color,
      sugar: product.sugar,
      grapeSorts: attributes.grapeSorts,
      features: attributes.features,
      attributes,
      rawCategory: product.rawCategory,
      packageVolume: toNumber(product.packageVolume),
      packageVolumeUnit: product.packageVolumeUnit,
      packageQuantity: toNumber(product.packageQuantity),
      mainImageFileId: product.mainImageFileId,
      mainImage: image,
      image,
      product: {
        canonicalTitle: product.name,
        russianTitle: product.translatedName,
        brand: product.brand,
        producer: product.producer,
        country: product.country,
        region: product.region,
        year: attributes.vintage,
        alcoholPercent: attributes.alcoholPercent,
        description: product.description,
        image,
      },
      basic: {
        article: product.article,
        barcode: product.barcode,
        volume: previewVolume,
        volumeMl: previewVolume,
        volumeUnit: previewVolumeUnit,
        package: packageInfo,
        packagingType,
        packagingOptions,
        supplierSku: previewOffer?.supplierSku ?? null,
      },
      promoVideoFileId: product.promoVideoFileId,
      isPromo: product.isPromo,
      isFavorite: false,
      defaultSkuId: skuPreview?.id ?? null,
      skus: skuPreview ? [skuPreview] : [],
      skuPreview,
      available: filteredOffers.length > 0,
      status: productAvailability,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      categoryId: product.categoryId,
      category,
      variants: product.variants.map((variant) => ({
        id: variant.id,
        volume: toNumber(variant.volume),
        volumeUnit: variant.volumeUnit,
        packageSize: toNumber(variant.packageSize),
        packageSizeUnit: variant.packageSizeUnit,
        packagingType: variant.packagingType,
        isDefault: variant.isDefault,
        createdAt: variant.createdAt,
        updatedAt: variant.updatedAt,
      })),
      offers: skuPreview?.offers ?? [],
      priceFrom: priceFromMoney,
      legacyPriceFrom: priceFrom,
      totalSupplierQuantity,
      suppliersCount: new Set(filteredOffers.map((offer) => offer.supplierId)).size,
      hasAllSelectedSuppliers,
    }
  })

  const filteredProducts = serialized.filter(
    (product) => product.offers.length > 0 && product.hasAllSelectedSuppliers
  )

  const sortedProducts = [...filteredProducts].sort((left, right) => {
    switch (query.sort) {
      case 'price_asc':
        return (left.legacyPriceFrom ?? Number.POSITIVE_INFINITY) - (right.legacyPriceFrom ?? Number.POSITIVE_INFINITY)
      case 'price_desc':
        return (right.legacyPriceFrom ?? Number.NEGATIVE_INFINITY) - (left.legacyPriceFrom ?? Number.NEGATIVE_INFINITY)
      case 'date_added':
        return right.createdAt.getTime() - left.createdAt.getTime()
      case 'stock':
        return (
          Number(right.available) - Number(left.available) ||
          right.totalSupplierQuantity - left.totalSupplierQuantity ||
          right.updatedAt.getTime() - left.updatedAt.getTime()
        )
      case 'popularity':
        return right.updatedAt.getTime() - left.updatedAt.getTime()
      case 'newest':
      default:
        return right.updatedAt.getTime() - left.updatedAt.getTime()
    }
  })

  const serializedProducts = sortedProducts.map(({
    hasAllSelectedSuppliers: _unused,
    legacyPriceFrom: _legacyPriceFrom,
    ...product
  }) => product)

  return {
    products: serializedProducts,
    appliedCategoryIds: categorySelection.effectiveCategoryIds,
  }
}

export async function getCatalogProducts(query: CatalogProductsQuery): Promise<{
  items: CatalogListItemDto[]
  total: number
  offset: number
  limit: number
  hasMore: boolean
  appliedCategoryIds: string[]
}> {
  const legacyPage =
    typeof query.page === 'number' && Number.isInteger(query.page) && query.page > 0
      ? query.page
      : undefined
  const legacyPageSize =
    typeof query.pageSize === 'number' &&
    Number.isInteger(query.pageSize) &&
    query.pageSize > 0
      ? query.pageSize
      : undefined
  const limit =
    typeof query.limit === 'number' && Number.isInteger(query.limit) && query.limit > 0
      ? query.limit
      : legacyPageSize ?? DEFAULT_CATALOG_LIMIT
  const offset =
    typeof query.offset === 'number' && Number.isInteger(query.offset) && query.offset >= 0
      ? query.offset
      : legacyPage && legacyPageSize
        ? (legacyPage - 1) * legacyPageSize
        : DEFAULT_CATALOG_OFFSET

  const productsResult = await getCatalogProductsList(query)
  const products = productsResult.products
  const total = products.length
  const items = products.slice(offset, offset + limit) as CatalogListItemDto[]

  return {
    items,
    total,
    offset,
    limit,
    hasMore: offset + items.length < total,
    appliedCategoryIds: productsResult.appliedCategoryIds,
  }
}

export async function getCatalogProductById(id: string): Promise<CatalogProductCardDto | null> {
  const [product] = await getCatalogProductsList({}).then((result) =>
    result.products.filter((item) => item.id === id || item.publicId === normalizePublicId(id))
  )

  return (product as CatalogProductCardDto | undefined) ?? null
}

async function resolveSupplierFilterIds(query: CatalogProductsQuery) {
  const externalIds = query.supplierIds?.length
    ? query.supplierIds
    : query.supplierId
      ? [query.supplierId]
      : []

  if (!externalIds.length) {
    return []
  }

  const resolvedIds = await Promise.all(
    externalIds.map(async (externalId) => {
      if (!isPublicId(externalId, '2')) {
        return externalId
      }

      const supplier = await prisma.supplier.findUnique({
        where: externalIdWhere(externalId, '2'),
        select: { id: true },
      })

      return supplier?.id ?? null
    })
  )

  return resolvedIds.filter((id): id is string => Boolean(id))
}

export async function getCatalogFilters() {
  const [categories, suppliers, supplierProductGroups, publicProductCategories] = await Promise.all([
    prisma.catalogCategory.findMany({
      orderBy: [
        { parentId: 'asc' },
        { sortOrder: 'asc' },
        { name: 'asc' },
      ],
      include: {
        _count: {
          select: {
            products: true,
          },
        },
      },
    }),
    prisma.supplier.findMany({
      where: {
        isActive: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        business: {
          select: {
            name: true,
            taxNumber: true,
          },
        },
      },
    }),
    prisma.supplierProduct.findMany({
      where: PUBLIC_SUPPLIER_PRODUCT_WHERE,
      include: {
        supplier: {
          include: {
            business: {
              select: {
                name: true,
                taxNumber: true,
              },
            },
            inventoryItems: true,
          },
        },
        offers: {
          where: PUBLIC_OFFER_WHERE,
        },
      },
    }),
    prisma.product.findMany({
      where: {
        ...PUBLIC_PRODUCT_WHERE,
        categoryId: {
          not: null,
        },
        category: {
          is: {
            isTagActive: true,
            isHidden: false,
          },
        },
        supplierProducts: {
          some: PUBLIC_SUPPLIER_PRODUCT_WHERE,
        },
      },
      select: {
        categoryId: true,
      },
    }),
  ])

  const supplierCounts = new Map<
    string,
    {
      productsCount: number
      totalQuantity: number
      hasInStock: boolean
    }
  >()
  const deliveryDayCounts = new Map<CatalogDeliveryDays, number>()
  const stockLevelCounts = new Map<CatalogStockLevel, number>()
  const visibleCategories = getPublicCatalogCategories(categories)
  const publicProductCategoryCounts = new Map<string, number>()
  for (const product of publicProductCategories) {
    if (!product.categoryId) continue
    publicProductCategoryCounts.set(
      product.categoryId,
      (publicProductCategoryCounts.get(product.categoryId) ?? 0) + 1,
    )
  }
  const visibleCategoriesWithPublicCounts = visibleCategories.map((category) => ({
    ...category,
    _count: {
      products: publicProductCategoryCounts.get(category.id) ?? 0,
    },
  }))
  const aggregatedCategoryCounts = buildAggregatedProductsCountMap(visibleCategoriesWithPublicCounts)
  const categoryLevels = buildCategoryLevelMap(visibleCategoriesWithPublicCounts)
  const serializedCategoryTree = buildCategoryTree(
    visibleCategoriesWithPublicCounts.map((category) =>
      serializeCategory(
        {
          id: category.id,
          name: category.name,
          code: category.code,
          parentId: category.parentId,
          section: category.section,
          sortOrder: category.sortOrder,
          isTagActive: category.isTagActive,
          showInQuickFilters: category.showInQuickFilters,
          isHidden: category.isHidden,
          createdAt: category.createdAt,
          updatedAt: category.updatedAt,
          productsCount: aggregatedCategoryCounts.get(category.id) ?? 0,
          level: categoryLevels.get(category.id),
        },
        {
          includeCode: true,
          includeProductsCount: true,
        }
      )
    )
  )

  for (const supplierProduct of supplierProductGroups) {
    const matchingInventoryItems = supplierProduct.supplier.inventoryItems.filter(
      (inventoryItem) => inventoryItem.productId === supplierProduct.productId
    )
    const hasInventoryQuantity = matchingInventoryItems.length > 0
    const inventoryQuantity = sumInventoryQuantity(matchingInventoryItems)
    const offersStockQuantity = supplierProduct.offers.reduce((sum, offer) => {
      return sum + getOfferStockQuantity(offer)
    }, 0)
    const totalQuantity = hasInventoryQuantity ? inventoryQuantity : offersStockQuantity
    const inventoryMarkedOutOfStock =
      hasInventoryQuantity &&
      matchingInventoryItems.every((inventoryItem) => inventoryItem.isOutOfStock)
    const hasInStock = supplierProduct.offers.some((offer) =>
      normalizeAvailability({
        offerAvailabilityLevel: offer.availabilityLevel,
        offerIsAvailable: offer.isAvailable,
        quantity: hasInventoryQuantity ? inventoryQuantity : getOfferStockQuantity(offer),
        hasKnownStock: hasInventoryQuantity || offer.stockAvailable !== null,
        inventoryMarkedOutOfStock,
      }) === 'ACTIVE'
    )

    for (const offer of supplierProduct.offers) {
      const offerQuantity = hasInventoryQuantity ? inventoryQuantity : getOfferStockQuantity(offer)
      const availability = normalizeAvailability({
        offerAvailabilityLevel: offer.availabilityLevel,
        offerIsAvailable: offer.isAvailable,
        quantity: offerQuantity,
        hasKnownStock: hasInventoryQuantity || offer.stockAvailable !== null,
        inventoryMarkedOutOfStock,
      })
      const deliveryDays = normalizeDeliveryDays({
        availability,
        deliveryTerm: offer.deliveryTerm,
      })
      const stockLevel = normalizeStockLevel({
        quantity: offerQuantity,
        availability,
        offerAvailabilityLevel: offer.availabilityLevel,
      })

      if (deliveryDays) {
        deliveryDayCounts.set(
          deliveryDays,
          (deliveryDayCounts.get(deliveryDays) ?? 0) + 1
        )
      }

      if (stockLevel) {
        stockLevelCounts.set(stockLevel, (stockLevelCounts.get(stockLevel) ?? 0) + 1)
      }
    }

    const current = supplierCounts.get(supplierProduct.supplierId) || {
      productsCount: 0,
      totalQuantity: 0,
      hasInStock: false,
    }

    current.productsCount += 1
    current.totalQuantity += totalQuantity
    current.hasInStock = current.hasInStock || hasInStock

    supplierCounts.set(supplierProduct.supplierId, current)
  }

  return {
    categories: serializedCategoryTree,
    availability: [
      {
        value: 'ACTIVE' as const,
        label: 'В наличии',
        count: Array.from(supplierCounts.values()).filter((item) => item.hasInStock).length,
      },
      {
        value: 'ORDERABLE' as const,
        label: 'Под заказ',
        count: suppliers.length,
      },
    ],
    deliveryDays: [
      {
        value: 'today' as const,
        label: 'Сегодня',
        count: deliveryDayCounts.get('today') ?? 0,
      },
      {
        value: 'tomorrow' as const,
        label: 'Завтра',
        count: deliveryDayCounts.get('tomorrow') ?? 0,
      },
      {
        value: 'up_to_3' as const,
        label: 'До 3 дней',
        count: deliveryDayCounts.get('up_to_3') ?? 0,
      },
      {
        value: 'up_to_7' as const,
        label: 'До 7 дней',
        count: deliveryDayCounts.get('up_to_7') ?? 0,
      },
    ],
    stockLevels: [
      {
        value: 'high' as const,
        label: 'Много на складе',
        count: stockLevelCounts.get('high') ?? 0,
      },
      {
        value: 'limited' as const,
        label: 'Ограниченный остаток',
        count: stockLevelCounts.get('limited') ?? 0,
      },
    ],
    suppliers: suppliers.map((supplier) => {
      const counts = supplierCounts.get(supplier.id)

      return {
        id: supplier.id,
        name: getSupplierDisplayName(supplier),
        count: counts?.productsCount || 0,
        companyName: supplier.catalogName || supplier.business?.name || null,
        inn: supplier.business?.taxNumber || null,
        isActive: supplier.isActive,
        productsCount: counts?.productsCount || 0,
        totalQuantity: counts?.totalQuantity || 0,
        hasInStock: counts?.hasInStock || false,
      }
    }),
  }
}
