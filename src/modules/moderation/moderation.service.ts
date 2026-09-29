import { prisma } from '../../lib/prisma'
import { externalIdWhere } from '../../lib/public-id'
import fs from 'fs/promises'
import path from 'path'
import {
  createHash,
  randomUUID,
} from 'crypto'
import {
  AccessLevel,
  AccountType,
  AuditActorType,
  BusinessDownloadPurpose,
  BusinessDownloadStatus,
  CatalogCategorySection,
  DisplayRole,
  FileAssetType,
  NameDictionaryKind,
  NameTranslationSource,
  OfferAvailabilityLevel,
  PriceImportIssueStatus,
  PriceImportStatus,
  MembershipStatus,
  InventorySessionStatus,
  OrderBatchStatus,
  PriceImportIssueSeverity,
  PriceImportRowMappingStatus,
  ProductCatalogStatus,
  Prisma,
  SupplierOrderStatus,
  SupplierImportImageMatchStatus,
  SupplierProductAliasType,
  UnitType,
  UserAdminGroup,
  UserStatus,
  VerificationCodeType,
  VenuePhotoStatus,
  VenueStatus,
  FacetScope,
} from '../../generated/prisma'
import XLSX from 'xlsx'
import {
  buildCatalogFacetProductWhere,
  getCatalogFacets,
} from '../catalog-filters/catalog-filter-engine.service'
import { FacetQueryError, parseFacetSelectionFromQuery } from '../catalog-filters/facet-shared'
import { getCatalogFilters } from '../products/catalog-data.service'
import { normalizeRawCategory } from '../price-imports/category-mappings.service'
import { importPriceFile } from '../price-imports/price-imports.service'
import { clearNameDictionariesCache, normalizeText } from '../price-imports/name-decomposer.service'
import { normalizeUploadDisplayFileName } from '../price-imports/upload-file-name'
import { env } from '../../config/env'
import { sendEmailVerificationLink } from '../../lib/email'
import {
  findFileAssetViewById,
  mapFileAssetToView,
} from '../profile/profile-media.service'
import {
  type ConfirmExistingSupplierAccountDto,
  type CreateModerationSupplierDto,
  type ModerationCatalogProductPublicVisibilityDto,
  type ModerationCatalogProductPublicVisibilityReason,
  type DeleteModerationSupplierPriceImportResponseDto,
  type ModerationSupplierAccessStatus,
  type ModerationCatalogProductDetailDto,
  type ModerationCatalogProductsResponseDto,
  type ModerationProductCardDto,
  type ModerationSupplierDetailDto,
  type ModerationSupplierDto,
  type ModerationSupplierListResponseDto,
  type ModerationSupplierPriceImportDto,
  type ModerationSupplierPriceImportOverviewDto,
  type ModerationSupplierProductsResponseDto,
  type UpdateModerationSupplierProductDto,
  type UpdateModerationCatalogProductDto,
  type UpdateModerationSupplierDto,
  ModerationSupplierValidationError,
} from './moderation-suppliers.contract'
import type {
  ModerationDashboardResponseDto,
  ModerationDashboardTaskDto,
  ModerationDashboardTaskPriority,
} from './moderation-dashboard.contract'
import type {
  ModerationSearchResponseDto,
  ModerationSearchResultDto,
} from './moderation-search.contract'

export class ModerationCatalogError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ModerationCatalogError'
    this.status = status
  }
}

export class ModerationStatusError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'ModerationStatusError'
    this.status = status
  }
}

export class ModerationUserDeletionError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ModerationUserDeletionError'
    this.status = status
  }
}

export class ModerationUsersFilterError extends Error {
  status: number

  constructor(message: string) {
    super(message)
    this.name = 'ModerationUsersFilterError'
    this.status = 400
  }
}

export function isModerationStatusError(
  error: unknown
): error is ModerationStatusError {
  return error instanceof ModerationStatusError
}

export function isModerationUserDeletionError(
  error: unknown
): error is ModerationUserDeletionError {
  return error instanceof ModerationUserDeletionError
}

export function isModerationUsersFilterError(
  error: unknown
): error is ModerationUsersFilterError {
  return error instanceof ModerationUsersFilterError
}

type RegistrationAccountGroup =
  | 'VENUE'
  | 'SUPPLIER'
  | 'BOTH'
  | 'UNIDENTIFIED'

type RegistrationAccountGroupFilter = RegistrationAccountGroup | 'ALL'
type UserAdminGroupFilter = UserAdminGroup | 'ALL'

type ModerationUsersFilters = {
  accountGroup: RegistrationAccountGroupFilter
  adminGroup: UserAdminGroupFilter
}

type ModerationSortDirection = 'asc' | 'desc'

function normalizeModerationSortDirection(value: unknown): ModerationSortDirection {
  return value === 'desc' ? 'desc' : 'asc'
}

function getModerationSortKey(query: { sort?: unknown } = {}) {
  return typeof query.sort === 'string' && query.sort.trim() ? query.sort.trim() : null
}

function compareModerationValues(left: unknown, right: unknown, type: 'text' | 'number' | 'date' | 'boolean' = 'text') {
  const leftEmpty = left === null || left === undefined || left === ''
  const rightEmpty = right === null || right === undefined || right === ''
  if (leftEmpty && rightEmpty) return 0
  if (leftEmpty) return 1
  if (rightEmpty) return -1

  if (type === 'number') {
    return Number(left ?? 0) - Number(right ?? 0)
  }

  if (type === 'date') {
    return new Date(left as any).getTime() - new Date(right as any).getTime()
  }

  if (type === 'boolean') {
    return Number(Boolean(left)) - Number(Boolean(right))
  }

  return String(left).localeCompare(String(right), 'ru', {
    sensitivity: 'base',
    numeric: true,
  })
}

function sortModerationDtoList<T>(
  items: T[],
  query: { sort?: unknown; sortDirection?: unknown } | undefined,
  sorters: Record<string, { type?: 'text' | 'number' | 'date' | 'boolean'; accessor: (item: T) => unknown }>
) {
  const sortKey = getModerationSortKey(query)
  if (!sortKey || !sorters[sortKey]) return items

  const direction = normalizeModerationSortDirection(query?.sortDirection) === 'desc' ? -1 : 1
  const sorter = sorters[sortKey]

  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const result = compareModerationValues(
        sorter.accessor(left.item),
        sorter.accessor(right.item),
        sorter.type ?? 'text'
      )
      return result === 0 ? left.index - right.index : result * direction
    })
    .map(({ item }) => item)
}

const DASHBOARD_TASK_PRIORITY_WEIGHT: Record<ModerationDashboardTaskPriority, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
}

function buildDashboardTask(params: Omit<ModerationDashboardTaskDto, 'updatedAt'> & {
  updatedAt?: Date | null
}): ModerationDashboardTaskDto | null {
  if (!params.count) return null

  return {
    id: params.id,
    type: params.type,
    priority: params.priority,
    title: params.title,
    description: params.description,
    count: params.count,
    targetPage: params.targetPage,
    actionLabel: params.actionLabel,
    sampleLabels: params.sampleLabels,
    updatedAt: params.updatedAt?.toISOString() ?? null,
  }
}

function sortDashboardTasks(tasks: ModerationDashboardTaskDto[]) {
  return tasks.slice().sort((left, right) => {
    const priorityDiff =
      DASHBOARD_TASK_PRIORITY_WEIGHT[right.priority] - DASHBOARD_TASK_PRIORITY_WEIGHT[left.priority]
    if (priorityDiff !== 0) return priorityDiff

    const countDiff = right.count - left.count
    if (countDiff !== 0) return countDiff

    return String(left.title).localeCompare(String(right.title), 'ru')
  })
}

function getDashboardUserLabel(user: any) {
  const fullName = formatUserFullName(user)
  return fullName && fullName !== '—'
    ? fullName
    : user?.phone || user?.email || user?.publicId || 'Пользователь без имени'
}

export async function getModerationDashboard(): Promise<ModerationDashboardResponseDto> {
  const unpublishedPriceStatuses = [
    PriceImportStatus.PARSED,
    PriceImportStatus.HAS_ISSUES,
    PriceImportStatus.READY_TO_PUBLISH,
    PriceImportStatus.PARTIALLY_PUBLISHED,
  ]

  const [
    usersCount,
    venuesCount,
    suppliersCount,
    membershipsCount,
    catalogCategoriesCount,
    catalogProductsCount,
    catalogFilters,
    unconfirmedUsersCount,
    pendingMembershipsCount,
    openPriceImportIssuesCount,
    failedPriceImportsCount,
    unpublishedPriceImportsCount,
    productsNeedReviewCount,
    productsWithoutCategoryCount,
    unconfirmedUsers,
    pendingMemberships,
    openPriceImportIssues,
    failedPriceImports,
    unpublishedPriceImports,
    productsNeedReview,
    productsWithoutCategory,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.venue.count(),
    prisma.supplier.count(),
    prisma.userVenueMembership.count(),
    prisma.catalogCategory.count(),
    prisma.product.count({ where: { mergedIntoProductId: null } }),
    getCatalogFilters(),
    prisma.user.count({ where: { status: UserStatus.UNIDENTIFIED } }),
    prisma.userVenueMembership.count({ where: { membershipStatus: MembershipStatus.PENDING } }),
    prisma.supplierPriceImportIssue.count({ where: { status: PriceImportIssueStatus.OPEN } }),
    prisma.supplierPriceImport.count({ where: { status: PriceImportStatus.FAILED } }),
    prisma.supplierPriceImport.count({ where: { status: { in: unpublishedPriceStatuses } } }),
    prisma.product.count({
      where: {
        status: { in: [ProductCatalogStatus.DRAFT, ProductCatalogStatus.NEEDS_REVIEW] },
        mergedIntoProductId: null,
      },
    }),
    prisma.product.count({
      where: {
        categoryId: null,
        mergedIntoProductId: null,
      },
    }),
    prisma.user.findMany({
      where: { status: UserStatus.UNIDENTIFIED },
      orderBy: { createdAt: 'desc' },
      take: 3,
      include: { profile: true },
    }),
    prisma.userVenueMembership.findMany({
      where: { membershipStatus: MembershipStatus.PENDING },
      orderBy: { createdAt: 'desc' },
      take: 3,
      include: {
        user: { include: { profile: true } },
        venue: { select: { name: true } },
      },
    }),
    prisma.supplierPriceImportIssue.findMany({
      where: { status: PriceImportIssueStatus.OPEN },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: 3,
      include: {
        supplier: { select: { name: true, catalogName: true } },
        import: { select: { originalFileName: true } },
      },
    }),
    prisma.supplierPriceImport.findMany({
      where: { status: PriceImportStatus.FAILED },
      orderBy: { updatedAt: 'desc' },
      take: 3,
      include: {
        supplier: { select: { name: true, catalogName: true } },
      },
    }),
    prisma.supplierPriceImport.findMany({
      where: { status: { in: unpublishedPriceStatuses } },
      orderBy: { updatedAt: 'desc' },
      take: 3,
      include: {
        supplier: { select: { name: true, catalogName: true } },
      },
    }),
    prisma.product.findMany({
      where: {
        status: { in: [ProductCatalogStatus.DRAFT, ProductCatalogStatus.NEEDS_REVIEW] },
        mergedIntoProductId: null,
      },
      orderBy: { updatedAt: 'desc' },
      take: 3,
      select: { name: true, translatedName: true, article: true, updatedAt: true },
    }),
    prisma.product.findMany({
      where: {
        categoryId: null,
        mergedIntoProductId: null,
      },
      orderBy: { updatedAt: 'desc' },
      take: 3,
      select: { name: true, translatedName: true, article: true, updatedAt: true },
    }),
  ])

  const tasks = [
    buildDashboardTask({
      id: 'unconfirmed-users',
      type: 'USER_REGISTRATION',
      priority: 'HIGH',
      title: 'Пользователи ждут подтверждения',
      description: 'Нужно проверить аккаунты без определённого типа и подтвердить их роль в платформе.',
      count: unconfirmedUsersCount,
      targetPage: 'users',
      actionLabel: 'Открыть пользователей',
      sampleLabels: unconfirmedUsers.map(getDashboardUserLabel),
      updatedAt: unconfirmedUsers[0]?.createdAt ?? null,
    }),
    buildDashboardTask({
      id: 'pending-memberships',
      type: 'MEMBERSHIP_ACCESS',
      priority: 'HIGH',
      title: 'Доступы сотрудников ожидают решения',
      description: 'Нужно подтвердить или отклонить заявки сотрудников на доступ к заведениям.',
      count: pendingMembershipsCount,
      targetPage: 'employees',
      actionLabel: 'Открыть доступы',
      sampleLabels: pendingMemberships.map((membership) =>
        [getDashboardUserLabel(membership.user), membership.venue?.name].filter(Boolean).join(' · ')
      ),
      updatedAt: pendingMemberships[0]?.createdAt ?? null,
    }),
    buildDashboardTask({
      id: 'open-price-import-issues',
      type: 'PRICE_IMPORT_ISSUES',
      priority: 'CRITICAL',
      title: 'Неустранённые ошибки прайсов',
      description: 'Есть открытые ошибки и предупреждения импорта, которые мешают чистой публикации данных.',
      count: openPriceImportIssuesCount,
      targetPage: 'suppliers',
      actionLabel: 'Открыть поставщиков',
      sampleLabels: openPriceImportIssues.map((issue) =>
        [
          issue.supplier.catalogName || issue.supplier.name,
          issue.import.originalFileName,
          issue.message,
        ].filter(Boolean).join(' · ')
      ),
      updatedAt: openPriceImportIssues[0]?.createdAt ?? null,
    }),
    buildDashboardTask({
      id: 'failed-price-imports',
      type: 'PRICE_IMPORT_FAILED',
      priority: 'CRITICAL',
      title: 'Прайсы завершились ошибкой',
      description: 'Нужно открыть поставщика, проверить файл, маппинг колонок или загрузить прайс заново.',
      count: failedPriceImportsCount,
      targetPage: 'suppliers',
      actionLabel: 'Открыть поставщиков',
      sampleLabels: failedPriceImports.map((priceImport) =>
        [
          priceImport.supplier.catalogName || priceImport.supplier.name,
          priceImport.originalFileName,
          priceImport.errorText,
        ].filter(Boolean).join(' · ')
      ),
      updatedAt: failedPriceImports[0]?.updatedAt ?? null,
    }),
    buildDashboardTask({
      id: 'unpublished-price-imports',
      type: 'PRICE_IMPORT_UNPUBLISHED',
      priority: 'MEDIUM',
      title: 'Прайсы загружены, но не опубликованы',
      description: 'Нужно проверить предпросмотр, устранить спорные строки и опубликовать актуальные предложения.',
      count: unpublishedPriceImportsCount,
      targetPage: 'suppliers',
      actionLabel: 'Открыть поставщиков',
      sampleLabels: unpublishedPriceImports.map((priceImport) =>
        [
          priceImport.supplier.catalogName || priceImport.supplier.name,
          priceImport.originalFileName,
          priceImport.status,
        ].filter(Boolean).join(' · ')
      ),
      updatedAt: unpublishedPriceImports[0]?.updatedAt ?? null,
    }),
    buildDashboardTask({
      id: 'products-need-review',
      type: 'CATALOG_PRODUCT_REVIEW',
      priority: 'MEDIUM',
      title: 'Товары требуют проверки',
      description: 'В каталоге есть черновики или карточки со статусом проверки.',
      count: productsNeedReviewCount,
      targetPage: 'products',
      actionLabel: 'Открыть товары',
      sampleLabels: productsNeedReview.map((product) => product.translatedName || product.name || product.article || 'Без названия'),
      updatedAt: productsNeedReview[0]?.updatedAt ?? null,
    }),
    buildDashboardTask({
      id: 'products-without-category',
      type: 'CATALOG_PRODUCT_CATEGORY',
      priority: 'LOW',
      title: 'Товары без категории',
      description: 'Нужно назначить раздел каталога, чтобы товары корректно попадали в фильтры и витрину.',
      count: productsWithoutCategoryCount,
      targetPage: 'products',
      actionLabel: 'Открыть товары',
      sampleLabels: productsWithoutCategory.map((product) => product.translatedName || product.name || product.article || 'Без названия'),
      updatedAt: productsWithoutCategory[0]?.updatedAt ?? null,
    }),
  ].filter((task): task is ModerationDashboardTaskDto => Boolean(task))

  return {
    stats: {
      users: usersCount,
      venues: venuesCount,
      suppliers: suppliersCount,
      memberships: membershipsCount,
      catalogCategories: catalogCategoriesCount,
      catalogProducts: catalogProductsCount,
      catalogSuppliers: Array.isArray(catalogFilters.suppliers) ? catalogFilters.suppliers.length : 0,
    },
    tasks: sortDashboardTasks(tasks),
    generatedAt: new Date().toISOString(),
  }
}

const MODERATION_SEARCH_LIMIT_PER_GROUP = 5
const MODERATION_SEARCH_TOTAL_LIMIT = 24

function normalizeModerationSearchQuery(query: unknown) {
  return typeof query === 'string' ? query.trim().replace(/\s+/g, ' ') : ''
}

function buildContainsFilter(query: string) {
  return {
    contains: query,
    mode: 'insensitive' as const,
  }
}

function joinSearchDescription(values: Array<unknown>) {
  return values
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map((value) => String(value))
    .join(' · ')
}

function normalizeSearchTargetText(value: unknown) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim()
}

function createModerationSearchResult(params: ModerationSearchResultDto): ModerationSearchResultDto {
  return params
}

export async function searchModerationAdmin(query: unknown): Promise<ModerationSearchResponseDto> {
  const normalizedQuery = normalizeModerationSearchQuery(query)
  if (normalizedQuery.length < 2) {
    return {
      query: normalizedQuery,
      results: [],
    }
  }

  const contains = buildContainsFilter(normalizedQuery)
  const [
    users,
    venues,
    suppliers,
    memberships,
    products,
    categories,
  ] = await Promise.all([
    prisma.user.findMany({
      where: {
        OR: [
          { publicId: contains },
          { phone: contains },
          { email: contains },
          { profile: { is: { firstName: contains } } },
          { profile: { is: { lastName: contains } } },
          { profile: { is: { middleName: contains } } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: MODERATION_SEARCH_LIMIT_PER_GROUP,
      include: { profile: true },
    }),
    prisma.venue.findMany({
      where: {
        OR: [
          { publicId: contains },
          { name: contains },
          { city: contains },
          { address: contains },
          { phone: contains },
          { email: contains },
          { contactPersonName: contains },
          { business: { is: { name: contains } } },
          { business: { is: { taxNumber: contains } } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: MODERATION_SEARCH_LIMIT_PER_GROUP,
      include: { business: true },
    }),
    prisma.supplier.findMany({
      where: {
        OR: [
          { publicId: contains },
          { name: contains },
          { catalogName: contains },
          { city: contains },
          { address: contains },
          { contactName: contains },
          { business: { is: { name: contains } } },
          { business: { is: { taxNumber: contains } } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: MODERATION_SEARCH_LIMIT_PER_GROUP,
      include: { business: true },
    }),
    prisma.userVenueMembership.findMany({
      where: {
        OR: [
          { publicId: contains },
          { user: { is: { publicId: contains } } },
          { user: { is: { phone: contains } } },
          { user: { is: { email: contains } } },
          { user: { is: { profile: { is: { firstName: contains } } } } },
          { user: { is: { profile: { is: { lastName: contains } } } } },
          { venue: { is: { name: contains } } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: MODERATION_SEARCH_LIMIT_PER_GROUP,
      include: {
        user: { include: { profile: true } },
        venue: { select: { name: true, city: true } },
      },
    }),
    prisma.product.findMany({
      where: {
        mergedIntoProductId: null,
        OR: [
          { publicId: contains },
          { name: contains },
          { translatedName: contains },
          { article: contains },
          { brand: contains },
          { producer: contains },
          { country: contains },
          { category: { is: { name: contains } } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: MODERATION_SEARCH_LIMIT_PER_GROUP,
      include: { category: { select: { name: true } } },
    }),
    prisma.catalogCategory.findMany({
      where: {
        OR: [
          { name: contains },
          { code: contains },
          { parent: { is: { name: contains } } },
        ],
      },
      orderBy: [
        { parentId: 'asc' },
        { sortOrder: 'asc' },
        { name: 'asc' },
      ],
      take: MODERATION_SEARCH_LIMIT_PER_GROUP,
      include: { parent: { select: { name: true } } },
    }),
  ])

  const normalizedTargetQuery = normalizeSearchTargetText(normalizedQuery)
  const moderatorResults = env.moderators
    .filter((moderator) => {
      const haystack = normalizeSearchTargetText([
        moderator.id,
        moderator.name,
        moderator.email,
        moderator.role,
      ].join(' '))
      return haystack.includes(normalizedTargetQuery)
    })
    .slice(0, 3)
    .map((moderator) =>
      createModerationSearchResult({
        id: moderator.id,
        type: 'MODERATOR',
        pageId: 'dashboard',
        label: moderator.name,
        description: joinSearchDescription([moderator.email, moderator.role]),
        sectionLabel: 'Администратор',
        value: moderator.name,
      })
    )

  const results: ModerationSearchResultDto[] = [
    ...moderatorResults,
    ...users.map((user) =>
      createModerationSearchResult({
        id: user.id,
        type: 'USER',
        pageId: 'users',
        label: getDashboardUserLabel(user),
        description: joinSearchDescription([user.phone, user.email, user.publicId]),
        sectionLabel: 'Пользователи',
        value: getDashboardUserLabel(user),
      })
    ),
    ...venues.map((venue) =>
      createModerationSearchResult({
        id: venue.id,
        type: 'VENUE',
        pageId: 'venues',
        label: venue.name,
        description: joinSearchDescription([venue.business?.name, venue.business?.taxNumber, venue.city]),
        sectionLabel: 'Заведения',
        value: venue.name,
      })
    ),
    ...suppliers.map((supplier) =>
      createModerationSearchResult({
        id: supplier.id,
        type: 'SUPPLIER',
        pageId: 'suppliers',
        label: supplier.catalogName || supplier.name,
        description: joinSearchDescription([supplier.business?.name, supplier.business?.taxNumber, supplier.city]),
        sectionLabel: 'Поставщики',
        value: supplier.catalogName || supplier.name,
      })
    ),
    ...memberships.map((membership) =>
      createModerationSearchResult({
        id: membership.id,
        type: 'EMPLOYEE',
        pageId: 'employees',
        label: getDashboardUserLabel(membership.user),
        description: joinSearchDescription([membership.venue?.name, membership.venue?.city, membership.membershipStatus]),
        sectionLabel: 'Сотрудники',
        value: getDashboardUserLabel(membership.user),
      })
    ),
    ...products.map((product) =>
      createModerationSearchResult({
        id: product.id,
        type: 'PRODUCT',
        pageId: 'products',
        label: product.translatedName || product.name || product.article || product.publicId,
        description: joinSearchDescription([product.article, product.brand, product.category?.name, product.status]),
        sectionLabel: 'Товары',
        value: product.translatedName || product.name || product.article || product.publicId,
      })
    ),
    ...categories.map((category) =>
      createModerationSearchResult({
        id: category.id,
        type: 'CATEGORY',
        pageId: 'catalog-categories',
        label: category.name,
        description: joinSearchDescription([category.parent?.name, category.code, category.section]),
        sectionLabel: 'Категории каталога',
        value: category.name,
      })
    ),
  ]

  const sortedResults = results
    .map((result, index) => {
      const label = normalizeSearchTargetText(result.label)
      const value = normalizeSearchTargetText(result.value)
      const description = normalizeSearchTargetText(result.description)
      const score =
        label === normalizedTargetQuery || value === normalizedTargetQuery
          ? 100
          : label.startsWith(normalizedTargetQuery) || value.startsWith(normalizedTargetQuery)
            ? 80
            : label.includes(normalizedTargetQuery) || value.includes(normalizedTargetQuery)
              ? 60
              : description.includes(normalizedTargetQuery)
                ? 30
                : 10

      return { result, index, score }
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, MODERATION_SEARCH_TOTAL_LIMIT)
    .map((item) => item.result)

  return {
    query: normalizedQuery,
    results: sortedResults,
  }
}

type RegistrationAccountGroupSource = {
  accountType?: AccountType | null
  memberships?: unknown[] | null
  supplierMemberships?: unknown[] | null
  registrationDrafts?: Array<{
    selectedAccountType?: AccountType | null
  }> | null
}

const MAX_CATEGORY_DEPTH = 5
const ALCOHOL_ROOT_NAMES = new Set([
  'Вина',
  'Пиво',
  'Готовые алкогольные напитки / RTD',
  'Крепкий алкоголь',
])
const DRINKS_FOOD_ROOT_NAMES = new Set([
  'Безалкогольные напитки',
  'Соки, нектары, морсы',
  'Газированные напитки',
  'Холодный чай, комбуча, ферментированные напитки',
  'Кофе, чай, какао',
  'Сиропы, топпинги, основы для коктейлей',
  'Безалкогольные альтернативы алкоголя',
  'Продукты и ингредиенты для бара / кухни',
  'Специи, сахар, соль',
  'Снэки',
])
const DRINKS_FOOD_ROOT_NAME_PATTERN =
  /напит|ингредиент|снэк|сироп|кофе|чай|какао|сок|морс|сахар|соль|продукт/i

function normalizeCategoryCode(code: unknown) {
  if (code === undefined) {
    return undefined
  }

  if (code === null) {
    return null
  }

  const normalizedCode =
    typeof code === 'string'
      ? code
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
      : ''

  if (!normalizedCode) {
    throw new ModerationCatalogError(
      400,
      'Category code must contain latin letters, numbers, or hyphens'
    )
  }

  return normalizedCode
}

function normalizeCategorySection(section: unknown) {
  if (section === undefined || section === null || section === '') {
    return undefined
  }

  if (typeof section !== 'string') {
    throw new ModerationCatalogError(400, 'Category section is invalid')
  }

  const normalizedSection = section
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')

  if (
    normalizedSection !== CatalogCategorySection.ALCOHOL &&
    normalizedSection !== CatalogCategorySection.DRINKS_FOOD &&
    normalizedSection !== CatalogCategorySection.NONFOOD
  ) {
    throw new ModerationCatalogError(400, 'Category section is invalid')
  }

  return normalizedSection as CatalogCategorySection
}

function normalizeCategorySortOrder(sortOrder: unknown) {
  if (sortOrder === undefined || sortOrder === null || sortOrder === '') {
    return undefined
  }

  const numericValue =
    typeof sortOrder === 'number'
      ? sortOrder
      : typeof sortOrder === 'string'
        ? Number(sortOrder.trim())
        : Number.NaN

  if (!Number.isInteger(numericValue) || numericValue < 0) {
    throw new ModerationCatalogError(
      400,
      'Category sort order must be a non-negative integer'
    )
  }

  return numericValue
}

function normalizeCategoryTagActivity(value: unknown) {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'boolean') {
    throw new ModerationCatalogError(400, 'Category tag activity flag must be boolean')
  }

  return value
}

function normalizeCategoryHiddenFlag(value: unknown) {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'boolean') {
    throw new ModerationCatalogError(400, 'Category hidden flag must be boolean')
  }

  return value
}

type CatalogCategoryTreeNode = {
  id: string
  parentId: string | null
  section: CatalogCategorySection
}

type ModerationCatalogCategoryRecord = {
  id: string
  name: string
  code: string | null
  section: CatalogCategorySection
  sortOrder: number
  isTagActive: boolean
  showInQuickFilters: boolean
  isHidden: boolean
  parentId: string | null
  createdAt: Date
  updatedAt: Date
  parent: {
    id: string
    name: string
    code: string | null
    section: CatalogCategorySection
  } | null
  childrenCount: number
  directProductsCount: number
  productsCount: number
}

type ModerationCatalogCategoryListItem = {
  id: string
  name: string
  code: string | null
  section: CatalogCategorySection
  sortOrder: number
  isTagActive: boolean
  showInQuickFilters: boolean
  isHidden: boolean
  depth: number
  parentId: string | null
  parent: ModerationCatalogCategoryRecord['parent']
  childrenCount: number
  directProductsCount: number
  productsCount: number
  createdAt: Date
  updatedAt: Date
}

function buildCategoryChildrenMap(
  categories: Array<{
    id: string
    parentId: string | null
  }>
) {
  const childrenMap = new Map<string | null, string[]>()

  for (const category of categories) {
    const currentChildren = childrenMap.get(category.parentId) ?? []
    currentChildren.push(category.id)
    childrenMap.set(category.parentId, currentChildren)
  }

  return childrenMap
}

function buildCategoryDepthMap(
  categories: Array<{
    id: string
    parentId: string | null
  }>
) {
  const categoriesById = new Map(categories.map((category) => [category.id, category]))
  const depthMap = new Map<string, number>()

  function resolveDepth(categoryId: string): number {
    const cachedDepth = depthMap.get(categoryId)

    if (cachedDepth !== undefined) {
      return cachedDepth
    }

    const category = categoriesById.get(categoryId)

    if (!category || !category.parentId) {
      depthMap.set(categoryId, 1)
      return 1
    }

    const parentDepth = categoriesById.has(category.parentId)
      ? resolveDepth(category.parentId)
      : 0
    const depth = parentDepth + 1
    depthMap.set(categoryId, depth)
    return depth
  }

  for (const category of categories) {
    resolveDepth(category.id)
  }

  return depthMap
}

function collectCategorySubtreeIds(
  rootCategoryId: string,
  childrenMap: Map<string | null, string[]>
) {
  const subtreeIds: string[] = []
  const stack = [rootCategoryId]

  while (stack.length > 0) {
    const categoryId = stack.pop()!
    subtreeIds.push(categoryId)

    const childIds = childrenMap.get(categoryId) ?? []

    for (const childId of childIds) {
      stack.push(childId)
    }
  }

  return subtreeIds
}

function resolveCategorySubtreeHeight(
  rootCategoryId: string,
  childrenMap: Map<string | null, string[]>
) {
  function visit(categoryId: string): number {
    const childIds = childrenMap.get(categoryId) ?? []

    if (childIds.length === 0) {
      return 1
    }

    let maxHeight = 1

    for (const childId of childIds) {
      maxHeight = Math.max(maxHeight, visit(childId) + 1)
    }

    return maxHeight
  }

  return visit(rootCategoryId)
}

function buildAggregatedProductsCountMap(
  categories: Array<{
    id: string
    parentId: string | null
    _count: {
      products: number
    }
  }>
) {
  const childrenMap = buildCategoryChildrenMap(categories)
  const directProductsCountMap = new Map(
    categories.map((category) => [category.id, category._count.products])
  )
  const aggregatedProductsCountMap = new Map<string, number>()

  function resolveAggregatedCount(categoryId: string): number {
    const cachedCount = aggregatedProductsCountMap.get(categoryId)

    if (cachedCount !== undefined) {
      return cachedCount
    }

    let totalCount = directProductsCountMap.get(categoryId) ?? 0
    const childIds = childrenMap.get(categoryId) ?? []

    for (const childId of childIds) {
      totalCount += resolveAggregatedCount(childId)
    }

    aggregatedProductsCountMap.set(categoryId, totalCount)
    return totalCount
  }

  for (const category of categories) {
    resolveAggregatedCount(category.id)
  }

  return aggregatedProductsCountMap
}

function serializeModerationCatalogCategory(
  category: ModerationCatalogCategoryRecord,
  depthMap: Map<string, number>
): ModerationCatalogCategoryListItem {
  return {
    id: category.id,
    name: category.name,
    code: category.code,
    section: category.section,
    sortOrder: category.sortOrder,
    isTagActive: category.isTagActive,
    showInQuickFilters: category.showInQuickFilters,
    isHidden: category.isHidden,
    depth: depthMap.get(category.id) ?? 1,
    parentId: category.parentId,
    parent: category.parent,
    childrenCount: category.childrenCount,
    directProductsCount: category.directProductsCount,
    productsCount: category.productsCount,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  }
}

function normalizeRootCategoryName(name: string) {
  return name.replace(/^-+\s*/, '').replace(/\s+/g, ' ').trim()
}

function inferRootCategorySection(name: string) {
  const normalizedName = normalizeRootCategoryName(name)

  if (ALCOHOL_ROOT_NAMES.has(normalizedName)) {
    return CatalogCategorySection.ALCOHOL
  }

  if (
    DRINKS_FOOD_ROOT_NAMES.has(normalizedName) ||
    DRINKS_FOOD_ROOT_NAME_PATTERN.test(normalizedName)
  ) {
    return CatalogCategorySection.DRINKS_FOOD
  }

  return CatalogCategorySection.NONFOOD
}

async function listModerationCatalogCategoryRecords() {
  const categories = await prisma.catalogCategory.findMany({
    orderBy: [
      { parentId: 'asc' },
      { sortOrder: 'asc' },
      { name: 'asc' },
    ],
    include: {
      parent: {
        select: {
          id: true,
          name: true,
          code: true,
          section: true,
          isHidden: true,
          isTagActive: true,
        },
      },
      _count: {
        select: {
          children: true,
          products: true,
        },
      },
    },
  })

  const depthMap = buildCategoryDepthMap(categories)
  const aggregatedProductsCountMap = buildAggregatedProductsCountMap(categories)
  const normalizedCategories: ModerationCatalogCategoryRecord[] = categories.map((category) => ({
    id: category.id,
    name: category.name,
    code: category.code,
    section: category.section,
    sortOrder: category.sortOrder,
    isTagActive: category.isTagActive,
    showInQuickFilters: category.showInQuickFilters,
    isHidden: category.isHidden,
    parentId: category.parentId,
    parent: category.parent,
    childrenCount: category._count.children,
    directProductsCount: category._count.products,
    productsCount: aggregatedProductsCountMap.get(category.id) ?? 0,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  }))

  return normalizedCategories.map((category) =>
    serializeModerationCatalogCategory(category, depthMap)
  )
}

async function getSerializedModerationCatalogCategoryOrThrow(categoryId: string) {
  const categories = await listModerationCatalogCategoryRecords()
  const category = categories.find((item) => item.id === categoryId)

  if (!category) {
    throw new ModerationCatalogError(404, 'Категория не найдена')
  }

  return category
}

async function listCatalogCategoryTreeNodes(): Promise<CatalogCategoryTreeNode[]> {
  return await prisma.catalogCategory.findMany({
    select: {
      id: true,
      parentId: true,
      section: true,
    },
  })
}

async function resolveNextCategorySortOrder(
  parentId: string | null,
  excludeCategoryId?: string
) {
  const siblingWithMaxSortOrder = await prisma.catalogCategory.findFirst({
    where: {
      parentId,
      ...(excludeCategoryId
        ? {
            id: {
              not: excludeCategoryId,
            },
          }
        : {}),
    },
    orderBy: [
      { sortOrder: 'desc' },
      { createdAt: 'desc' },
    ],
    select: {
      sortOrder: true,
    },
  })

  return (siblingWithMaxSortOrder?.sortOrder ?? -1) + 1
}

async function ensureCategoryDepthLimit(params: {
  categoryId?: string
  nextParentId: string | null
}) {
  const categories = await listCatalogCategoryTreeNodes()
  const childrenMap = buildCategoryChildrenMap(categories)
  const depthMap = buildCategoryDepthMap(categories)
  const targetDepth = params.nextParentId
    ? (depthMap.get(params.nextParentId) ?? 0) + 1
    : 1

  if (!params.categoryId) {
    if (targetDepth > MAX_CATEGORY_DEPTH) {
      throw new ModerationCatalogError(
        400,
        `Category nesting depth must not exceed ${MAX_CATEGORY_DEPTH} levels`
      )
    }

    return
  }

  const subtreeHeight = resolveCategorySubtreeHeight(params.categoryId, childrenMap)

  if (targetDepth + subtreeHeight - 1 > MAX_CATEGORY_DEPTH) {
    throw new ModerationCatalogError(
      400,
      `Category nesting depth must not exceed ${MAX_CATEGORY_DEPTH} levels`
    )
  }
}

function formatUserProfile(profile: any, avatar?: any) {
  if (!profile) {
    return null
  }

  return {
    id: profile.id,
    firstName: profile.firstName,
    lastName: profile.lastName,
    middleName: profile.middleName,
    avatarFileId: profile.avatarFileId,
    avatar: avatar ?? null,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  }
}

function formatUserFullName(user: any) {
  const profile = user?.profile

  if (!profile) {
    return '—'
  }

  return [profile.lastName, profile.firstName, profile.middleName]
    .filter(Boolean)
    .join(' ')
}

async function getUserEmailVerificationView(user: {
  id: string
  email: string | null
  emailVerifiedAt: Date | null
}) {
  if (!user.email) {
    return {
      status: 'MISSING' as const,
      email: null,
      emailVerifiedAt: null,
      pendingEmail: null,
      pendingEmailExpiresAt: null,
    }
  }

  if (user.emailVerifiedAt) {
    return {
      status: 'VERIFIED' as const,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
      pendingEmail: null,
      pendingEmailExpiresAt: null,
    }
  }

  const pendingVerification = await prisma.verificationCode.findFirst({
    where: {
      userId: user.id,
      type: VerificationCodeType.EMAIL_VERIFY,
      usedAt: null,
      expiresAt: {
        gt: new Date(),
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    select: {
      target: true,
      expiresAt: true,
    },
  })

  return {
    status: pendingVerification ? 'PENDING' as const : 'UNVERIFIED' as const,
    email: user.email,
    emailVerifiedAt: null,
    pendingEmail: pendingVerification?.target ?? null,
    pendingEmailExpiresAt: pendingVerification?.expiresAt ?? null,
  }
}

function resolveRegistrationAccountGroup(
  user: RegistrationAccountGroupSource
): RegistrationAccountGroup {
  const hasVenueMemberships = (user.memberships?.length ?? 0) > 0
  const hasSupplierMemberships = (user.supplierMemberships?.length ?? 0) > 0

  if (hasVenueMemberships && hasSupplierMemberships) {
    return 'BOTH'
  }

  if (hasVenueMemberships) {
    return 'VENUE'
  }

  if (hasSupplierMemberships) {
    return 'SUPPLIER'
  }

  if (user.accountType === AccountType.VENUE_STAFF) {
    return 'VENUE'
  }

  if (user.accountType === AccountType.SUPPLIER_STAFF) {
    return 'SUPPLIER'
  }

  const draftAccountTypes =
    user.registrationDrafts
      ?.map((draft) => draft.selectedAccountType)
      .filter(Boolean) ?? []
  const hasVenueDraft = draftAccountTypes.includes(AccountType.VENUE_STAFF)
  const hasSupplierDraft = draftAccountTypes.includes(AccountType.SUPPLIER_STAFF)

  if (hasVenueDraft && hasSupplierDraft) {
    return 'BOTH'
  }

  if (hasVenueDraft) {
    return 'VENUE'
  }

  if (hasSupplierDraft) {
    return 'SUPPLIER'
  }

  return 'UNIDENTIFIED'
}

function getQueryValue(value: unknown) {
  if (Array.isArray(value)) {
    return value[0]
  }

  return value
}

function normalizeModerationUsersFilters(input?: {
  accountGroup?: unknown
  adminGroup?: unknown
}): ModerationUsersFilters {
  const rawAccountGroup = getQueryValue(input?.accountGroup)
  const rawAdminGroup = getQueryValue(input?.adminGroup)
  const accountGroup =
    typeof rawAccountGroup === 'string' && rawAccountGroup.trim()
      ? rawAccountGroup.trim().toUpperCase()
      : 'ALL'
  const adminGroup =
    typeof rawAdminGroup === 'string' && rawAdminGroup.trim()
      ? rawAdminGroup.trim().toUpperCase()
      : 'ALL'
  const allowedAccountGroups: RegistrationAccountGroupFilter[] = [
    'ALL',
    'VENUE',
    'SUPPLIER',
    'BOTH',
    'UNIDENTIFIED',
  ]
  const allowedAdminGroups = [
    'ALL',
    ...Object.values(UserAdminGroup),
  ] as UserAdminGroupFilter[]

  if (!allowedAccountGroups.includes(accountGroup as RegistrationAccountGroupFilter)) {
    throw new ModerationUsersFilterError('Unknown accountGroup')
  }

  if (!allowedAdminGroups.includes(adminGroup as UserAdminGroupFilter)) {
    throw new ModerationUsersFilterError('Unknown adminGroup')
  }

  return {
    accountGroup: accountGroup as RegistrationAccountGroupFilter,
    adminGroup: adminGroup as UserAdminGroupFilter,
  }
}

function formatBusinessSummary(business: any) {
  if (!business) {
    return null
  }

  return {
    id: business.id,
    name: business.name,
    taxNumber: business.taxNumber,
    legalAddress: business.legalAddress,
    createdAt: business.createdAt,
    updatedAt: business.updatedAt,
  }
}

function getUserDisplayName(user: any) {
  return formatUserFullName(user) || null
}

function getVenueOwnerMembership(memberships: any[] | undefined) {
  return (
    memberships?.find((membership) => membership.displayRole === DisplayRole.OWNER) ??
    memberships?.find((membership) => membership.accessLevel === AccessLevel.ADMIN) ??
    memberships?.[0] ??
    null
  )
}

export async function getModerationUsers(input?: {
  accountGroup?: unknown
  adminGroup?: unknown
  sort?: unknown
  sortDirection?: unknown
}) {
  const filters = normalizeModerationUsersFilters(input)
  const users = await prisma.user.findMany({
    where:
      filters.adminGroup === 'ALL'
        ? undefined
        : {
            adminGroup: filters.adminGroup,
          },
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      profile: true,
      memberships: {
        include: {
          venue: {
            include: {
              business: true,
            },
          },
        },
      },
      supplierMemberships: {
        include: {
          supplier: {
            include: {
              business: true,
            },
          },
        },
      },
      registrationDrafts: {
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          selectedAccountType: true,
        },
      },
    },
  })

  const items = users
    .map((user: any) => {
      const registrationAccountGroup = resolveRegistrationAccountGroup(user)

      return {
        id: user.id,
        publicId: user.publicId,
        tableId: user.publicId,
        fullName: formatUserFullName(user) || null,
        displayName: getUserDisplayName(user),
        profile: formatUserProfile(user.profile),
        phone: user.phone,
        email: user.email,
        emailVerifiedAt: user.emailVerifiedAt,
        accountType: user.accountType,
        status: user.status,
        role: user.adminGroup,
        adminGroup: user.adminGroup,
        registrationAccountGroup,
        membershipsCount: user.memberships?.length || 0,
        venuesCount: user.memberships?.length || 0,
        venueMembershipsCount: user.memberships?.length || 0,
        supplierMembershipsCount: user.supplierMemberships?.length || 0,
        linkedVenues: (user.memberships ?? []).map((membership: any) => ({
          id: membership.venue.id,
          publicId: membership.venue.publicId,
          name: membership.venue.name,
          city: membership.venue.city,
          address: membership.venue.address,
          business: formatBusinessSummary(membership.venue.business),
          membershipStatus: membership.membershipStatus,
          displayRole: membership.displayRole,
          accessLevel: membership.accessLevel,
        })),
        linkedSuppliers: (user.supplierMemberships ?? []).map((membership: any) => ({
          id: membership.supplier.id,
          publicId: membership.supplier.publicId,
          name: membership.supplier.name,
          city: membership.supplier.city,
          address: membership.supplier.address,
          business: formatBusinessSummary(membership.supplier.business),
          membershipStatus: membership.status,
          displayRole: membership.displayRole,
          accessLevel: membership.accessLevel,
        })),
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
      }
    })
    .filter(
      (user) =>
        filters.accountGroup === 'ALL' ||
        user.registrationAccountGroup === filters.accountGroup
    )

  return sortModerationDtoList(items, input, {
    profile: { accessor: (user) => user.fullName || user.displayName },
    registrationAccountGroup: { accessor: (user) => user.registrationAccountGroup },
    adminGroup: { accessor: (user) => user.adminGroup },
    status: { accessor: (user) => user.status },
    membershipsCount: { type: 'number', accessor: (user) => user.venuesCount ?? user.membershipsCount ?? 0 },
    lastLoginAt: { type: 'date', accessor: (user) => user.lastLoginAt },
    createdAt: { type: 'date', accessor: (user) => user.createdAt },
  })
}

async function rebuildCatalogCategoryPaths(client: Prisma.TransactionClient | typeof prisma = prisma) {
  await client.$executeRaw`
    WITH RECURSIVE category_tree AS (
      SELECT
        "id",
        "parentId",
        ('/' || "id"::text || '/') AS "path",
        1 AS "depth"
      FROM "CatalogCategory"
      WHERE "parentId" IS NULL

      UNION ALL

      SELECT
        child."id",
        child."parentId",
        (category_tree."path" || child."id"::text || '/') AS "path",
        category_tree."depth" + 1 AS "depth"
      FROM "CatalogCategory" child
      JOIN category_tree ON child."parentId" = category_tree."id"
    )
    UPDATE "CatalogCategory" category
    SET
      "path" = category_tree."path",
      "depth" = category_tree."depth"
    FROM category_tree
    WHERE category."id" = category_tree."id"
  `
}

export async function getModerationUserDetail(userId: string) {
  const user = await prisma.user.findUnique({
    where: {
      ...externalIdWhere(userId, '1'),
    },
    include: {
      profile: true,
      memberships: {
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          venue: {
            include: {
              business: true,
            },
          },
          confirmedByUser: {
            include: {
              profile: true,
            },
          },
        },
      },
      supplierMemberships: {
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          supplier: {
            include: {
              business: true,
            },
          },
        },
      },
      registrationDrafts: {
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          selectedAccountType: true,
        },
      },
      authSessions: {
        orderBy: {
          createdAt: 'desc',
        },
      },
      auditLogsActor: {
        orderBy: {
          createdAt: 'desc',
        },
        take: 50,
        include: {
          actorUser: {
            include: {
              profile: true,
            },
          },
          actorSupplier: true,
        },
      },
    },
  })

  if (!user) {
    return null
  }

  const [avatar, emailVerification] = await Promise.all([
    findFileAssetViewById(user.profile?.avatarFileId),
    getUserEmailVerificationView(user),
  ])

  return {
    user: {
      id: user.id,
      publicId: user.publicId,
      profile: formatUserProfile(user.profile, avatar),
      phone: user.phone,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
      emailVerification,
      status: user.status,
      adminGroup: user.adminGroup,
      registrationAccountGroup: resolveRegistrationAccountGroup(user),
      membershipsCount: user.memberships?.length || 0,
      venueMembershipsCount: user.memberships?.length || 0,
      supplierMembershipsCount: user.supplierMemberships?.length || 0,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },

    memberships: user.memberships.map((membership: any) => ({
      id: membership.id,
      userId: membership.userId,
      venueId: membership.venueId,
      venue: {
        id: membership.venue.id,
        publicId: membership.venue.publicId,
        name: membership.venue.name,
        city: membership.venue.city,
        address: membership.venue.address,
        business: membership.venue.business
          ? {
              id: membership.venue.business.id,
              name: membership.venue.business.name,
              taxNumber: membership.venue.business.taxNumber,
              legalAddress: membership.venue.business.legalAddress,
            }
          : null,
      },
      displayRole: membership.displayRole,
      accessLevel: membership.accessLevel,
      membershipStatus: membership.membershipStatus,
      joinedAt: membership.joinedAt,
      confirmedByUserId: membership.confirmedByUserId,
      confirmedBy: membership.confirmedByUser
        ? {
            id: membership.confirmedByUser.id,
            publicId: membership.confirmedByUser.publicId,
            name: formatUserFullName(membership.confirmedByUser),
            phone: membership.confirmedByUser.phone,
            email: membership.confirmedByUser.email,
            emailVerifiedAt: membership.confirmedByUser.emailVerifiedAt,
          }
        : null,
      createdAt: membership.createdAt,
      updatedAt: membership.updatedAt,
    })),

    supplierMemberships: user.supplierMemberships.map((membership: any) => ({
      id: membership.id,
      userId: membership.userId,
      supplierId: membership.supplierId,
      supplier: {
        id: membership.supplier.id,
        publicId: membership.supplier.publicId,
        businessId: membership.supplier.businessId,
        name: membership.supplier.name,
        city: membership.supplier.city,
        address: membership.supplier.address,
        contactName: membership.supplier.contactName,
        phone: membership.supplier.phone,
        email: membership.supplier.email,
        website: membership.supplier.website,
        isActive: membership.supplier.isActive,
        business: formatBusinessSummary(membership.supplier.business),
      },
      displayRole: membership.displayRole,
      accessLevel: membership.accessLevel,
      membershipStatus: membership.status,
      notifyByEmail: membership.notifyByEmail,
      notifyByMessenger: membership.notifyByMessenger,
      messengerType: membership.messengerType,
      messengerContact: membership.messengerContact,
      joinedAt: membership.joinedAt,
      createdAt: membership.createdAt,
      updatedAt: membership.updatedAt,
    })),

    sessions: user.authSessions.map((session: any) => ({
      id: session.id,
      expiresAt: session.expiresAt,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    })),

    auditLog: user.auditLogsActor.map((item: any) => ({
      id: item.id,
      actorType: item.actorType,
      actorUserId: item.actorUserId,
      actorSupplierId: item.actorSupplierId,
      actorName:
        item.actorType === 'USER'
          ? formatUserFullName(item.actorUser)
          : item.actorSupplier?.name || item.actorType,
      entityType: item.entityType,
      entityId: item.entityId,
      action: item.action,
      payload: item.payload,
      createdAt: item.createdAt,
    })),
  }
}

function normalizeModerationUserStatus(status: unknown): UserStatus {
  const normalizedStatus = typeof status === 'string' ? status.trim().toUpperCase() : ''
  const allowedStatuses = Object.values(UserStatus)

  if (!allowedStatuses.includes(normalizedStatus as UserStatus)) {
    throw new ModerationStatusError(
      `Неизвестный статус пользователя: ${
        typeof status === 'string' ? status : String(status)
      }. Допустимые значения: ${allowedStatuses.join(', ')}`
    )
  }

  return normalizedStatus as UserStatus
}

function normalizeModerationUserAdminGroup(adminGroup: unknown): UserAdminGroup {
  const normalizedAdminGroup =
    typeof adminGroup === 'string' ? adminGroup.trim().toUpperCase() : ''
  const allowedAdminGroups = Object.values(UserAdminGroup)

  if (!allowedAdminGroups.includes(normalizedAdminGroup as UserAdminGroup)) {
    throw new ModerationStatusError(
      `Unknown adminGroup. Allowed values: ${allowedAdminGroups.join(', ')}`
    )
  }

  return normalizedAdminGroup as UserAdminGroup
}

function normalizeModerationMembershipStatus(
  membershipStatus: unknown
): MembershipStatus {
  const normalizedStatus =
    typeof membershipStatus === 'string'
      ? membershipStatus.trim().toUpperCase()
      : ''
  const allowedStatuses = Object.values(MembershipStatus)

  if (!allowedStatuses.includes(normalizedStatus as MembershipStatus)) {
    throw new ModerationStatusError(
      `Неизвестный статус связи пользователя с заведением: ${
        typeof membershipStatus === 'string'
          ? membershipStatus
          : String(membershipStatus)
      }. Допустимые значения: ${allowedStatuses.join(', ')}`
    )
  }

  return normalizedStatus as MembershipStatus
}

function normalizeModerationAccessLevel(accessLevel: unknown): AccessLevel {
  const normalizedAccessLevel =
    typeof accessLevel === 'string' ? accessLevel.trim().toUpperCase() : ''
  const allowedAccessLevels = Object.values(AccessLevel)

  if (!allowedAccessLevels.includes(normalizedAccessLevel as AccessLevel)) {
    throw new ModerationStatusError(
      `Unknown accessLevel. Allowed values: ${allowedAccessLevels.join(', ')}`
    )
  }

  return normalizedAccessLevel as AccessLevel
}

function normalizeModerationDisplayRole(displayRole: unknown): DisplayRole {
  const normalizedDisplayRole =
    typeof displayRole === 'string' ? displayRole.trim().toUpperCase() : ''
  const allowedRoles = Object.values(DisplayRole)

  if (!allowedRoles.includes(normalizedDisplayRole as DisplayRole)) {
    throw new ModerationStatusError(
      `Unknown displayRole. Allowed values: ${allowedRoles.join(', ')}`
    )
  }

  return normalizedDisplayRole as DisplayRole
}

function normalizeModerationVenueStatus(venueStatus: unknown): VenueStatus {
  const normalizedVenueStatus =
    typeof venueStatus === 'string' ? venueStatus.trim().toUpperCase() : ''

  if (
    normalizedVenueStatus !== VenueStatus.ACTIVE &&
    normalizedVenueStatus !== VenueStatus.BLOCKED
  ) {
    throw new ModerationStatusError(
      'Неизвестный статус заведения. Допустимые значения: ACTIVE, BLOCKED'
    )
  }

  return normalizedVenueStatus as VenueStatus
}

function normalizeModerationVenueFilePurpose(purpose: unknown): BusinessDownloadPurpose {
  const normalizedPurpose =
    typeof purpose === 'string' ? purpose.trim().toUpperCase() : ''

  if (
    normalizedPurpose === BusinessDownloadPurpose.ANALYTICS ||
    normalizedPurpose === BusinessDownloadPurpose.MENU ||
    normalizedPurpose === BusinessDownloadPurpose.STOCK
  ) {
    return normalizedPurpose as BusinessDownloadPurpose
  }

  throw new ModerationStatusError(
    'Некорректное назначение файла. Допустимые значения: ANALYTICS, MENU, STOCK'
  )
}

function getStorageKeyFromUploadedFile(file: Express.Multer.File) {
  return path
    .relative(env.uploadsRoot, file.path)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
}

function getFileAssetTypeByMimeType(mimeType: string): FileAssetType {
  const normalizedMimeType = mimeType.toLowerCase()

  if (normalizedMimeType.startsWith('image/')) {
    return FileAssetType.IMAGE
  }

  if (normalizedMimeType.startsWith('video/')) {
    return FileAssetType.VIDEO
  }

  if (
    normalizedMimeType.includes('spreadsheet') ||
    normalizedMimeType.includes('excel') ||
    normalizedMimeType === 'text/csv'
  ) {
    return FileAssetType.SPREADSHEET
  }

  return FileAssetType.DOCUMENT
}

function getFilePathFromStorageKey(storageKey: string | null | undefined) {
  if (!storageKey) return null
  const normalizedStorageKey = storageKey
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^uploads\//, '')
  return path.resolve(env.uploadsRoot, normalizedStorageKey)
}

async function getExistingFilePathFromStorageKey(storageKey: string | null | undefined) {
  if (!storageKey) return null
  const normalizedStorageKey = storageKey
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')

  const candidates = [
    path.resolve(env.uploadsRoot, normalizedStorageKey.replace(/^uploads\//, '')),
    path.resolve(process.cwd(), normalizedStorageKey),
  ]
  const normalizedUploadsRoot = path.resolve(env.uploadsRoot)

  for (const candidate of Array.from(new Set(candidates))) {
    const normalizedCandidate = path.resolve(candidate)
    if (
      normalizedCandidate !== normalizedUploadsRoot &&
      !normalizedCandidate.startsWith(`${normalizedUploadsRoot}${path.sep}`)
    ) {
      continue
    }

    const stat = await fs.stat(normalizedCandidate).catch(() => null)
    if (stat?.isFile()) return normalizedCandidate
  }

  return null
}

async function unlinkFileAssetStorage(fileAsset: { storageKey?: string | null } | null | undefined) {
  const filePath = getFilePathFromStorageKey(fileAsset?.storageKey)
  if (!filePath) return

  await fs.unlink(filePath).catch(() => undefined)
}

function normalizeStockImportName(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

function normalizeStockImportNameKey(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function parseStockImportNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value == null) return null

  const normalized = String(value)
    .replace(/\s+/g, '')
    .replace(',', '.')
    .match(/-?\d+(?:\.\d+)?/)

  if (!normalized) return null

  const number = Number(normalized[0])
  return Number.isFinite(number) ? number : null
}

function mapStockImportUnit(value: unknown): UnitType {
  const unit = String(value ?? '').trim().toLowerCase()

  if (unit.includes('кг') || unit === 'kg') return UnitType.KG
  if (unit.includes('мл') || unit === 'ml') return UnitType.ML
  if (unit.includes('лит') || unit === 'л' || unit === 'l') return UnitType.L
  if (unit.includes('гр') || unit === 'г' || unit === 'g') return UnitType.G

  return UnitType.PCS
}

type VenueStockImportRow = {
  rowNumber: number
  code: string | null
  name: string
  quantity: number
  unit: UnitType
  purchaseAmount: number | null
  unitPrice: number | null
  issues: string[]
}

function parseVenueStockWorkbook(filePath: string) {
  const workbook = XLSX.readFile(filePath)
  const sheetName = workbook.SheetNames[0]

  if (!sheetName) {
    throw new ModerationStatusError('Файл не содержит листов')
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    defval: null,
    blankrows: false,
  })

  const parsedRows: VenueStockImportRow[] = []

  rows.forEach((row, index) => {
    const code = normalizeStockImportName(row[1])
    const name = normalizeStockImportName(row[2])
    const unit = mapStockImportUnit(row[4])
    const quantity = parseStockImportNumber(row[5])
    const purchaseAmount = parseStockImportNumber(row[6])
    const issues: string[] = []

    if (!name || !code || code.toLowerCase().startsWith('итого')) return
    if (name.toLowerCase().includes('наименование')) return
    if (!Number.isFinite(Number(code))) return

    if (quantity == null) {
      issues.push('Не указано количество')
    }

    parsedRows.push({
      rowNumber: index + 1,
      code,
      name,
      quantity: quantity ?? 0,
      unit,
      purchaseAmount,
      unitPrice:
        purchaseAmount != null && quantity != null && quantity > 0
          ? Math.round((purchaseAmount / quantity) * 100) / 100
          : null,
      issues,
    })
  })

  return {
    sheetName,
    rows: parsedRows,
    stats: {
      totalRows: rows.length,
      parsedRows: parsedRows.length,
      validRows: parsedRows.filter((row) => row.issues.length === 0).length,
      invalidRows: parsedRows.filter((row) => row.issues.length > 0).length,
    },
  }
}

function mapDisplayRoleToAccessLevel(displayRole: DisplayRole): AccessLevel {
  switch (displayRole) {
    case DisplayRole.OWNER:
    case DisplayRole.ADMINISTRATOR:
    case DisplayRole.BAR_MANAGER:
      return AccessLevel.ADMIN
    case DisplayRole.SENIOR_BARTENDER:
    case DisplayRole.SOMMELIER:
      return AccessLevel.SENIOR_STAFF
    case DisplayRole.BARTENDER:
    case DisplayRole.WAITER:
    default:
      return AccessLevel.LINE_STAFF
  }
}

function normalizeNullableString(value: unknown) {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') return undefined

  const normalized = value.trim()
  return normalized || null
}

function normalizeRequiredProfileName(value: unknown, fieldName: string) {
  const normalized = normalizeNullableString(value)

  if (!normalized) {
    throw new ModerationStatusError(`${fieldName} is required`)
  }

  return normalized
}

function normalizeModerationEmail(value: unknown) {
  const normalized = normalizeNullableString(value)
  if (normalized === undefined || normalized === null) return normalized

  const email = normalized.toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ModerationStatusError('Введите корректный email')
  }

  return email
}

function normalizeModerationPhone(value: unknown) {
  const normalized = normalizeNullableString(value)
  if (normalized === undefined || normalized === null) return normalized

  const phone = normalized.replace(/[^\d+]/g, '')
  if (!/^\+?\d{10,15}$/.test(phone)) {
    throw new ModerationStatusError('Введите корректный телефон')
  }

  return phone
}

function generateEmailVerificationToken() {
  return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
}

function hashEmailVerificationToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function buildModerationEmailVerificationUrl(token: string) {
  const baseUrl = env.apiPublicUrl.replace(/\/$/, '')
  return `${baseUrl}/email-verification/confirm?token=${encodeURIComponent(token)}`
}

async function sendModerationEmailVerification(userId: string, email: string) {
  const token = generateEmailVerificationToken()
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000)

  await prisma.$transaction(async (tx) => {
    await tx.verificationCode.updateMany({
      where: {
        userId,
        type: VerificationCodeType.EMAIL_VERIFY,
        usedAt: null,
      },
      data: {
        usedAt: new Date(),
      },
    })

    await tx.verificationCode.create({
      data: {
        target: email,
        type: VerificationCodeType.EMAIL_VERIFY,
        code: hashEmailVerificationToken(token),
        userId,
        expiresAt,
      },
    })

    await tx.notification.create({
      data: {
        userId,
        title: 'Подтвердите новый email',
        description: 'Администратор изменил email аккаунта. Подтвердите новый адрес по ссылке из письма.',
        type: 'ACCOUNT_EMAIL_CHANGED',
        relatedEntityType: 'USER',
        relatedEntityId: userId,
        relatedEntityRoute: 'profile',
      },
    })
  })

  await sendEmailVerificationLink({
    to: email,
    verificationUrl: buildModerationEmailVerificationUrl(token),
    expiresAt,
  })

  return expiresAt
}

function formatModerationUserForMutation(user: any) {
  return {
    id: user.id,
    publicId: user.publicId,
    tableId: user.publicId,
    fullName: formatUserFullName(user) || null,
    displayName: getUserDisplayName(user),
    profile: formatUserProfile(user.profile),
    phone: user.phone,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt,
    status: user.status,
    adminGroup: user.adminGroup,
    accountType: user.accountType,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}

export async function updateModerationUserProfile(
  userId: string,
  input: {
    firstName?: unknown
    lastName?: unknown
    middleName?: unknown
    phone?: unknown
    email?: unknown
  }
) {
  const existingUser = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  })

  if (!existingUser) {
    throw new ModerationStatusError('Пользователь не найден', 404)
  }

  const firstName =
    input.firstName === undefined
      ? undefined
      : normalizeRequiredProfileName(input.firstName, 'firstName')
  const lastName =
    input.lastName === undefined
      ? undefined
      : normalizeRequiredProfileName(input.lastName, 'lastName')
  const middleName = normalizeNullableString(input.middleName)
  const phone = normalizeModerationPhone(input.phone)
  const email = normalizeModerationEmail(input.email)

  if (phone !== undefined && phone !== existingUser.phone) {
    const duplicatePhone = phone
      ? await prisma.user.findFirst({
          where: {
            phone,
            id: { not: userId },
          },
          select: { id: true },
        })
      : null

    if (duplicatePhone) {
      throw new ModerationStatusError('Этот телефон уже используется другим пользователем', 409)
    }
  }

  if (email !== undefined && email !== existingUser.email) {
    const duplicateEmail = email
      ? await prisma.user.findFirst({
          where: {
            email,
            id: { not: userId },
          },
          select: { id: true },
        })
      : null

    if (duplicateEmail) {
      throw new ModerationStatusError('Этот email уже используется другим пользователем', 409)
    }
  }

  const emailChanged = email !== undefined && email !== existingUser.email
  const phoneChanged = phone !== undefined && phone !== existingUser.phone

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(phone !== undefined ? { phone } : {}),
      ...(email !== undefined
        ? {
            email,
            emailVerifiedAt: emailChanged ? null : existingUser.emailVerifiedAt,
          }
        : {}),
      ...(firstName !== undefined || lastName !== undefined || middleName !== undefined
        ? {
            profile: existingUser.profile
              ? {
                  update: {
                    ...(firstName !== undefined ? { firstName } : {}),
                    ...(lastName !== undefined ? { lastName } : {}),
                    ...(middleName !== undefined ? { middleName } : {}),
                  },
                }
              : {
                  create: {
                    firstName: firstName ?? '—',
                    lastName: lastName ?? '—',
                    middleName: middleName ?? null,
                  },
                },
          }
        : {}),
    },
    include: {
      profile: true,
    },
  })

  if (phoneChanged) {
    await prisma.notification.create({
      data: {
        userId,
        title: 'Изменен номер телефона',
        description: 'Администратор изменил номер телефона аккаунта. При следующем входе подтвердите новый номер кодом авторизации.',
        type: 'ACCOUNT_PHONE_CHANGED',
        relatedEntityType: 'USER',
        relatedEntityId: userId,
        relatedEntityRoute: 'profile',
      },
    })
  }

  const pendingEmailVerificationExpiresAt =
    emailChanged && email ? await sendModerationEmailVerification(userId, email) : null

  return {
    user: formatModerationUserForMutation(updatedUser),
    pendingEmailVerificationExpiresAt,
  }
}

export async function updateModerationUserStatus(
  userId: string,
  status: unknown
) {
  const userStatus = normalizeModerationUserStatus(status)

  return prisma.user.update({
    where: {
      id: userId,
    },
    data: {
      status: userStatus,
    },
  })
}

export async function updateModerationUserAdminGroup(
  userId: string,
  adminGroup: unknown
) {
  const userAdminGroup = normalizeModerationUserAdminGroup(adminGroup)

  return prisma.user.update({
    where: {
      id: userId,
    },
    data: {
      adminGroup: userAdminGroup,
    },
    select: {
      id: true,
      adminGroup: true,
    },
  })
}

export async function deleteModerationUserHard(userId: string) {
  const existingUser = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      phone: true,
      email: true,
    },
  })

  if (!existingUser) {
    throw new ModerationUserDeletionError(404, 'Пользователь не найден')
  }

  const deleted = await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const counts: Record<string, number> = {}

      counts.orderDeliveryConfirmations = (
        await tx.orderDeliveryConfirmation.deleteMany({
          where: {
            confirmedByUserId: userId,
          },
        })
      ).count

      counts.inventoryReservations = (
        await tx.inventoryReservation.deleteMany({
          where: {
            reservedByUserId: userId,
          },
        })
      ).count

      counts.menuItemAnalogs = (
        await tx.menuItemAnalog.deleteMany({
          where: {
            assignedByUserId: userId,
          },
        })
      ).count

      counts.salesReportImports = (
        await tx.salesReportImport.deleteMany({
          where: {
            uploadedByUserId: userId,
          },
        })
      ).count

      counts.inventorySessions = (
        await tx.inventorySession.deleteMany({
          where: {
            createdByUserId: userId,
          },
        })
      ).count

      counts.inventorySessionItemsUnlinked = (
        await tx.inventorySessionItem.updateMany({
          where: {
            countedByUserId: userId,
          },
          data: {
            countedByUserId: null,
          },
        })
      ).count

      counts.menuItemTagsUnlinked = (
        await tx.menuItemTag.updateMany({
          where: {
            createdByUserId: userId,
          },
          data: {
            createdByUserId: null,
          },
        })
      ).count

      counts.fileAssetsUnlinked = (
        await tx.fileAsset.updateMany({
          where: {
            uploadedByUserId: userId,
          },
          data: {
            uploadedByUserId: null,
          },
        })
      ).count

      counts.auditLogsUnlinked = (
        await tx.auditLog.updateMany({
          where: {
            actorUserId: userId,
          },
          data: {
            actorUserId: null,
          },
        })
      ).count

      counts.confirmedMembershipsUnlinked = (
        await tx.userVenueMembership.updateMany({
          where: {
            confirmedByUserId: userId,
          },
          data: {
            confirmedByUserId: null,
          },
        })
      ).count

      counts.acceptedInvitationsUnlinked = (
        await tx.staffInvitation.updateMany({
          where: {
            acceptedByUserId: userId,
          },
          data: {
            acceptedByUserId: null,
          },
        })
      ).count

      counts.verificationCodes = (
        await tx.verificationCode.deleteMany({
          where: {
            userId,
          },
        })
      ).count

      counts.companyModerationRequests = (
        await tx.companyModerationRequest.deleteMany({
          where: {
            userId,
          },
        })
      ).count

      counts.registrationDrafts = (
        await tx.registrationDraft.deleteMany({
          where: {
            userId,
          },
        })
      ).count

      counts.createdStaffInvitations = (
        await tx.staffInvitation.deleteMany({
          where: {
            inviterUserId: userId,
          },
        })
      ).count

      counts.userTasks = (
        await tx.userTask.deleteMany({
          where: {
            OR: [
              {
                creatorUserId: userId,
              },
              {
                assigneeUserId: userId,
              },
            ],
          },
        })
      ).count

      counts.orderBatches = (
        await tx.orderBatch.deleteMany({
          where: {
            createdByUserId: userId,
          },
        })
      ).count

      counts.carts = (
        await tx.cart.deleteMany({
          where: {
            createdByUserId: userId,
          },
        })
      ).count

      counts.userNotes = (
        await tx.userNote.deleteMany({
          where: {
            authorUserId: userId,
          },
        })
      ).count

      counts.userNoteAccesses = (
        await tx.userNoteAccess.deleteMany({
          where: {
            userId,
          },
        })
      ).count

      counts.authSessions = (
        await tx.authSession.deleteMany({
          where: {
            userId,
          },
        })
      ).count

      counts.userVenueMemberships = (
        await tx.userVenueMembership.deleteMany({
          where: {
            userId,
          },
        })
      ).count

      counts.supplierMemberships = (
        await tx.supplierMembership.deleteMany({
          where: {
            userId,
          },
        })
      ).count

      counts.favoriteProducts = (
        await tx.userFavoriteProduct.deleteMany({
          where: {
            userId,
          },
        })
      ).count

      counts.accountDeletionRequests = (
        await tx.accountDeletionRequest.deleteMany({
          where: {
            userId,
          },
        })
      ).count

      counts.userProfiles = (
        await tx.userProfile.deleteMany({
          where: {
            userId,
          },
        })
      ).count

      await tx.user.delete({
        where: {
          id: userId,
        },
      })

      return counts
    },
    {
      timeout: 30000,
    }
  )

  return {
    ok: true,
    deletedUser: existingUser,
    deleted,
  }
}

export async function getModerationVenues(query: { sort?: unknown; sortDirection?: unknown } = {}) {
  const venues = await prisma.venue.findMany({
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      business: true,
      memberships: {
        include: {
          user: {
            include: {
              profile: true,
            },
          },
        },
      },
      supplierOrders: {
        where: {
          status: {
            notIn: [
              SupplierOrderStatus.DELIVERED,
              SupplierOrderStatus.REJECTED,
              SupplierOrderStatus.CANCELED,
            ],
          },
        },
        select: {
          id: true,
        },
      },
      _count: {
        select: {
          supplierOrders: true,
        },
      },
    },
  })

  const items = venues.map((venue: any) => {
    const ownerMembership = getVenueOwnerMembership(venue.memberships)
    const owner = ownerMembership?.user ?? null
    const ownerFirstLastName = owner?.profile
      ? [owner.profile.firstName, owner.profile.lastName].filter(Boolean).join(' ')
      : null

    return {
      id: venue.id,
      publicId: venue.publicId,
      tableId: venue.publicId,
      businessId: venue.businessId,
      business: venue.business
        ? {
            id: venue.business.id,
            name: venue.business.name,
            taxNumber: venue.business.taxNumber,
            legalAddress: venue.business.legalAddress,
          }
        : null,
      name: venue.name,
      displayName: venue.name,
      inn: venue.business?.taxNumber ?? null,
      ownerName: getUserDisplayName(owner),
      ownerFirstLastName: ownerFirstLastName || getUserDisplayName(owner),
      ownerId: owner?.id ?? null,
      ownerPublicId: owner?.publicId ?? null,
      ownerDisplayId: owner?.publicId ?? owner?.id ?? null,
      accountStatus: venue.venueStatus,
      city: venue.city,
      address: venue.address,
      contactPersonName: venue.contactPersonName,
      phone: venue.phone,
      email: venue.email,
      seatsCount: venue.seatsCount,
      employeesCount: venue.memberships?.length || 0,
      ordersCount: venue.supplierOrders?.length ?? venue._count?.supplierOrders ?? 0,
      showAdminContactsToSuppliers: venue.showAdminContactsToSuppliers,
      isActive: venue.isActive,
      venueStatus: venue.venueStatus,
      createdAt: venue.createdAt,
      updatedAt: venue.updatedAt,
    }
  })

  return sortModerationDtoList(items, query, {
    displayName: { accessor: (venue) => venue.displayName || venue.name },
    ownerName: { accessor: (venue) => venue.ownerFirstLastName || venue.ownerName },
    accountStatus: { accessor: (venue) => venue.accountStatus || venue.venueStatus },
    createdAt: { type: 'date', accessor: (venue) => venue.createdAt },
    updatedAt: { type: 'date', accessor: (venue) => venue.updatedAt },
    employeesCount: { type: 'number', accessor: (venue) => venue.employeesCount ?? 0 },
    ordersCount: { type: 'number', accessor: (venue) => venue.ordersCount ?? 0 },
  })
}

export async function getModerationVenueEmployees(venueId: string) {
  const venue = await prisma.venue.findUnique({
    where: {
      ...externalIdWhere(venueId, '3'),
    },
    select: {
      id: true,
      publicId: true,
      name: true,
    },
  })

  if (!venue) return null

  const memberships = await prisma.userVenueMembership.findMany({
    where: {
      venueId: venue.id,
    },
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      user: {
        include: {
          profile: true,
        },
      },
    },
  })

  return {
    venue,
    employees: memberships.map((membership: any) => ({
      id: membership.id,
      userId: membership.userId,
      userPublicId: membership.user.publicId,
      employeeName: formatUserFullName(membership.user),
      role: membership.displayRole,
      displayRole: membership.displayRole,
      accessLevel: membership.accessLevel,
      membershipStatus: membership.membershipStatus,
      createdAt: membership.createdAt,
      updatedAt: membership.updatedAt,
    })),
  }
}

export async function getModerationVenueActiveOrders(venueId: string) {
  const venue = await prisma.venue.findUnique({
    where: {
      ...externalIdWhere(venueId, '3'),
    },
    select: {
      id: true,
      publicId: true,
      name: true,
    },
  })

  if (!venue) return null

  const orderBatches = await prisma.orderBatch.findMany({
    where: {
      venueId: venue.id,
      status: {
        notIn: [OrderBatchStatus.COMPLETED, OrderBatchStatus.CANCELED],
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      supplierOrders: {
        where: {
          status: {
            notIn: [
              SupplierOrderStatus.DELIVERED,
              SupplierOrderStatus.REJECTED,
              SupplierOrderStatus.CANCELED,
            ],
          },
        },
        include: {
          items: {
            select: {
              id: true,
              total: true,
            },
          },
        },
      },
    },
  })

  return {
    venue,
    orders: orderBatches
      .filter((orderBatch: any) => orderBatch.supplierOrders.length > 0)
      .map((orderBatch: any) => {
        const itemsCount = orderBatch.supplierOrders.reduce(
          (total: number, supplierOrder: any) => total + supplierOrder.items.length,
          0
        )
        const totalAmount = orderBatch.supplierOrders.reduce(
          (total: number, supplierOrder: any) => {
            const orderAmount =
              supplierOrder.totalAmount != null
                ? Number(supplierOrder.totalAmount)
                : supplierOrder.items.reduce(
                    (itemsTotal: number, item: any) => itemsTotal + Number(item.total ?? 0),
                    0
                  )

            return total + orderAmount
          },
          0
        )
        const statuses = Array.from(
          new Set(orderBatch.supplierOrders.map((supplierOrder: any) => supplierOrder.status))
        )

        return {
          id: orderBatch.id,
          orderNumber: orderBatch.id.slice(0, 8).toUpperCase(),
          orderDate: orderBatch.createdAt,
          status:
            statuses.length === 1
              ? statuses[0]
              : orderBatch.status,
          batchStatus: orderBatch.status,
          itemsCount,
          totalAmount,
          currency: orderBatch.supplierOrders[0]?.currency ?? 'RUB',
          supplierOrdersCount: orderBatch.supplierOrders.length,
          createdAt: orderBatch.createdAt,
          updatedAt: orderBatch.updatedAt,
        }
      }),
  }
}

function formatVenuePhoto(photo: any) {
  return {
    id: photo.id,
    fileAssetId: photo.fileAssetId,
    sortOrder: photo.sortOrder,
    status: photo.status,
    rejectedAt: photo.rejectedAt,
    createdAt: photo.createdAt,
    fileAsset: photo.fileAsset ? mapFileAssetToView(photo.fileAsset) : null,
  }
}

function formatBusinessDownload(download: any) {
  return {
    id: download.id,
    venueId: download.venueId,
    fileAssetId: download.fileAssetId,
    purpose: download.purpose,
    status: download.status,
    processingError: download.processingError,
    uploadedByUserId: download.uploadedByUserId,
    uploadedBy: download.uploadedBy
      ? {
          id: download.uploadedBy.id,
          publicId: download.uploadedBy.publicId,
          name: formatUserFullName(download.uploadedBy),
          phone: download.uploadedBy.phone,
          email: download.uploadedBy.email,
        }
      : null,
    fileAsset: download.fileAsset ? mapFileAssetToView(download.fileAsset) : null,
    createdAt: download.createdAt,
    updatedAt: download.updatedAt,
  }
}

function formatVenueOrderBatch(orderBatch: any) {
  const supplierOrders = orderBatch.supplierOrders ?? []

  return {
    id: orderBatch.id,
    venueId: orderBatch.venueId,
    createdByUserId: orderBatch.createdByUserId,
    createdBy: orderBatch.createdByUser
      ? {
          id: orderBatch.createdByUser.id,
          publicId: orderBatch.createdByUser.publicId,
          name: formatUserFullName(orderBatch.createdByUser),
          phone: orderBatch.createdByUser.phone,
          email: orderBatch.createdByUser.email,
        }
      : null,
    status: orderBatch.status,
    supplierOrdersCount: supplierOrders.length,
    totalAmount: supplierOrders.reduce((total: number, supplierOrder: any) => {
      const amount = supplierOrder.totalAmount
      return total + (amount ? Number(amount) : 0)
    }, 0),
    createdAt: orderBatch.createdAt,
    updatedAt: orderBatch.updatedAt,
  }
}

function formatInventorySession(session: any) {
  return {
    id: session.id,
    venueId: session.venueId,
    createdByUserId: session.createdByUserId,
    createdBy: session.createdByUser
      ? {
          id: session.createdByUser.id,
          publicId: session.createdByUser.publicId,
          name: formatUserFullName(session.createdByUser),
          phone: session.createdByUser.phone,
          email: session.createdByUser.email,
        }
      : null,
    status: session.status,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    itemsCount: session._count?.items ?? 0,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
}

function formatVenueDetail(venue: any) {
  const ownerMembership = getVenueOwnerMembership(venue.memberships)
  const owner = ownerMembership?.user ?? null
  const inventorySessions = venue.inventorySessions.map(formatInventorySession)
  const currentInventorySession =
    inventorySessions.find((session: any) =>
      [InventorySessionStatus.IN_PROGRESS, InventorySessionStatus.SUBMITTED_FOR_REVIEW].includes(
        session.status
      )
    ) ?? null

  return {
    venue: {
      id: venue.id,
      publicId: venue.publicId,
      businessId: venue.businessId,
      business: formatBusinessSummary(venue.business),
      name: venue.name,
      city: venue.city,
      address: venue.address,
      latitude: venue.latitude,
      longitude: venue.longitude,
      phone: venue.phone,
      email: venue.email,
      website: venue.website,
      contactPersonName: venue.contactPersonName,
      seatsCount: venue.seatsCount,
      description: venue.description,
      venueType: venue.venueType,
      mainPhotoFileId: venue.mainPhotoFileId,
      showPhoneInCard: venue.showPhoneInCard,
      showAdminContactsToSuppliers: venue.showAdminContactsToSuppliers,
      ownerId: owner?.id ?? null,
      ownerPublicId: owner?.publicId ?? null,
      ownerDisplayId: owner?.publicId ?? owner?.id ?? null,
      ownerStatus: venue.ownerStatus,
      venueStatus: venue.venueStatus,
      isActive: venue.isActive,
      createdAt: venue.createdAt,
      updatedAt: venue.updatedAt,
    },
    memberships: venue.memberships.map((membership: any) => ({
      id: membership.id,
      userId: membership.userId,
      user: {
        id: membership.user.id,
        publicId: membership.user.publicId,
        name: formatUserFullName(membership.user),
        profile: formatUserProfile(membership.user.profile),
        phone: membership.user.phone,
        email: membership.user.email,
        emailVerifiedAt: membership.user.emailVerifiedAt,
        status: membership.user.status,
        accountType: membership.user.accountType,
      },
      displayRole: membership.displayRole,
      accessLevel: membership.accessLevel,
      membershipStatus: membership.membershipStatus,
      joinedAt: membership.joinedAt,
      confirmedByUserId: membership.confirmedByUserId,
      confirmedBy: membership.confirmedByUser
        ? {
            id: membership.confirmedByUser.id,
            name: formatUserFullName(membership.confirmedByUser),
            phone: membership.confirmedByUser.phone,
            email: membership.confirmedByUser.email,
            emailVerifiedAt: membership.confirmedByUser.emailVerifiedAt,
          }
        : null,
      createdAt: membership.createdAt,
      updatedAt: membership.updatedAt,
    })),
    photos: venue.photos.map(formatVenuePhoto),
    cuisineTypes: venue.cuisineLinks.map((link: any) => ({
      id: link.cuisineType.id,
      name: link.cuisineType.name,
      createdAt: link.cuisineType.createdAt,
    })),
    orderHistory: venue.orderBatches.map(formatVenueOrderBatch),
    uploadedFiles: venue.businessDownloads.map(formatBusinessDownload),
    inventorySessions,
    currentInventorySession,
    counts: venue._count,
  }
}

export async function getModerationVenueDetail(venueId: string) {
  const venue = await prisma.venue.findUnique({
    where: {
      ...externalIdWhere(venueId, '3'),
    },
    include: {
      business: true,
      memberships: {
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          user: {
            include: {
              profile: true,
            },
          },
          confirmedByUser: {
            include: {
              profile: true,
            },
          },
        },
      },
      photos: {
        orderBy: {
          sortOrder: 'asc',
        },
        include: {
          fileAsset: true,
        },
      },
      businessDownloads: {
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          fileAsset: true,
          uploadedBy: {
            include: {
              profile: true,
            },
          },
        },
      },
      orderBatches: {
        orderBy: {
          createdAt: 'desc',
        },
        take: 20,
        include: {
          createdByUser: {
            include: {
              profile: true,
            },
          },
          supplierOrders: true,
        },
      },
      inventorySessions: {
        orderBy: {
          startedAt: 'desc',
        },
        take: 20,
        include: {
          createdByUser: {
            include: {
              profile: true,
            },
          },
          _count: {
            select: {
              items: true,
            },
          },
        },
      },
      cuisineLinks: {
        include: {
          cuisineType: true,
        },
      },
      _count: {
        select: {
          tasks: true,
          notes: true,
          carts: true,
          orderBatches: true,
          supplierOrders: true,
          inventoryItems: true,
          menuItems: true,
        },
      },
    },
  })

  if (!venue) {
    return null
  }

  return formatVenueDetail(venue)
}

export async function getModerationBusinessDetail(businessId: string) {
  const business = await prisma.business.findUnique({
    where: {
      id: businessId,
    },
    include: {
      venues: {
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          _count: {
            select: {
              memberships: true,
            },
          },
        },
      },
      supplier: {
        include: {
          memberships: true,
          categories: true,
          supplierProducts: true,
        },
      },
      registrationDrafts: {
        orderBy: {
          createdAt: 'desc',
        },
        take: 20,
      },
      companyModerationRequests: {
        orderBy: {
          createdAt: 'desc',
        },
        take: 20,
        include: {
          user: {
            include: {
              profile: true,
            },
          },
        },
      },
      _count: {
        select: {
          venues: true,
          registrationDrafts: true,
          companyModerationRequests: true,
        },
      },
    },
  })

  if (!business) {
    return null
  }

  return {
    business: formatBusinessSummary(business),
    venues: business.venues.map((venue: any) => ({
      id: venue.id,
      businessId: venue.businessId,
      name: venue.name,
      city: venue.city,
      address: venue.address,
      contactPersonName: venue.contactPersonName,
      phone: venue.phone,
      email: venue.email,
      seatsCount: venue.seatsCount,
      ownerStatus: venue.ownerStatus,
      venueStatus: venue.venueStatus,
      isActive: venue.isActive,
      employeesCount: venue._count.memberships,
      createdAt: venue.createdAt,
      updatedAt: venue.updatedAt,
    })),
    supplier: business.supplier
      ? {
          id: business.supplier.id,
          businessId: business.supplier.businessId,
          name: business.supplier.name,
          city: business.supplier.city,
          address: business.supplier.address,
          contactName: business.supplier.contactName,
          phone: business.supplier.phone,
          email: business.supplier.email,
          website: business.supplier.website,
          isActive: business.supplier.isActive,
          membershipsCount: business.supplier.memberships.length,
          categoriesCount: business.supplier.categories.length,
          supplierProductsCount: business.supplier.supplierProducts.length,
          createdAt: business.supplier.createdAt,
          updatedAt: business.supplier.updatedAt,
        }
      : null,
    registrationDrafts: business.registrationDrafts.map((draft: any) => ({
      id: draft.id,
      flowType: draft.flowType,
      status: draft.status,
      userId: draft.userId,
      fullName: draft.fullName,
      phone: draft.phone,
      selectedAccountType: draft.selectedAccountType,
      existingCompanyType: draft.existingCompanyType,
      existingCompanyId: draft.existingCompanyId,
      venueId: draft.venueId,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      completedAt: draft.completedAt,
    })),
    companyModerationRequests: business.companyModerationRequests.map((request: any) => ({
      id: request.id,
      userId: request.userId,
      user: {
        id: request.user.id,
        name: formatUserFullName(request.user),
        profile: formatUserProfile(request.user.profile),
        phone: request.user.phone,
        email: request.user.email,
        emailVerifiedAt: request.user.emailVerifiedAt,
        status: request.user.status,
      },
      draftId: request.draftId,
      businessId: request.businessId,
      requestedCompanyType: request.requestedCompanyType,
      requestedVenueRole: request.requestedVenueRole,
      requestedAccessLevel: request.requestedAccessLevel,
      inn: request.inn,
      companyName: request.companyName,
      companyAddress: request.companyAddress,
      source: request.source,
      status: request.status,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    })),
    counts: business._count,
  }
}

export async function updateModerationVenueActivity(
  venueId: string,
  isActive: boolean
) {
  return prisma.venue.update({
    where: {
      id: venueId,
    },
    data: {
      isActive,
      venueStatus: isActive ? VenueStatus.ACTIVE : VenueStatus.BLOCKED,
    },
  })
}

export async function updateModerationVenueStatus(
  venueId: string,
  venueStatus: unknown
) {
  const normalizedVenueStatus = normalizeModerationVenueStatus(venueStatus)
  const venue = await prisma.venue.update({
    where: {
      ...externalIdWhere(venueId, '3'),
    },
    data: {
      venueStatus: normalizedVenueStatus,
      isActive: normalizedVenueStatus === VenueStatus.ACTIVE,
    },
  })

  return getModerationVenueDetail(venue.id)
}

export async function updateModerationVenueDetail(
  venueId: string,
  input: Record<string, unknown>
) {
  const seatsCount = input.seatsCount
  const data: Prisma.VenueUpdateInput = {}

  if ('name' in input) {
    const name = normalizeNullableString(input.name)
    if (!name) throw new ModerationStatusError('Название заведения обязательно')
    data.name = name
  }

  if ('city' in input) {
    const city = normalizeNullableString(input.city)
    if (!city) throw new ModerationStatusError('Город обязателен')
    data.city = city
  }

  for (const field of [
    'address',
    'phone',
    'email',
    'website',
    'contactPersonName',
    'description',
    'venueType',
  ] as const) {
    if (field in input) {
      data[field] = normalizeNullableString(input[field]) as any
    }
  }

  if ('showPhoneInCard' in input) {
    if (typeof input.showPhoneInCard !== 'boolean') {
      throw new ModerationStatusError('Поле showPhoneInCard должно быть булевым')
    }
    data.showPhoneInCard = input.showPhoneInCard
  }

  if ('showAdminContactsToSuppliers' in input) {
    if (typeof input.showAdminContactsToSuppliers !== 'boolean') {
      throw new ModerationStatusError(
        'Поле showAdminContactsToSuppliers должно быть булевым'
      )
    }
    data.showAdminContactsToSuppliers = input.showAdminContactsToSuppliers
  }

  if ('seatsCount' in input) {
    if (seatsCount === null || seatsCount === '' || seatsCount === undefined) {
      data.seatsCount = null
    } else {
      const normalizedSeatsCount = Number(seatsCount)
      if (!Number.isInteger(normalizedSeatsCount) || normalizedSeatsCount < 0) {
        throw new ModerationStatusError(
          'Поле seatsCount должно быть неотрицательным целым числом'
        )
      }
      data.seatsCount = normalizedSeatsCount
    }
  }

  if (Object.keys(data).length === 0) {
    throw new ModerationStatusError('Нет данных для обновления')
  }

  const venue = await prisma.venue.update({
    where: {
      ...externalIdWhere(venueId, '3'),
    },
    data,
  })

  return getModerationVenueDetail(venue.id)
}

export async function updateModerationVenueBusiness(
  venueId: string,
  input: Record<string, unknown>
) {
  const venue = await prisma.venue.findUnique({
    where: {
      ...externalIdWhere(venueId, '3'),
    },
    select: {
      id: true,
      businessId: true,
    },
  })

  if (!venue) {
    return null
  }

  const data: Prisma.BusinessUpdateInput = {}

  if ('name' in input) {
    const name = normalizeNullableString(input.name)
    if (!name) throw new ModerationStatusError('Название юрлица обязательно')
    data.name = name
  }

  if ('taxNumber' in input) {
    const taxNumber = normalizeNullableString(input.taxNumber)
    if (!taxNumber) throw new ModerationStatusError('ИНН обязателен')
    data.taxNumber = taxNumber
  }

  if ('legalAddress' in input) {
    data.legalAddress = normalizeNullableString(input.legalAddress)
  }

  if (Object.keys(data).length === 0) {
    throw new ModerationStatusError('Нет данных для обновления')
  }

  try {
    await prisma.business.update({
      where: {
        id: venue.businessId,
      },
      data,
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ModerationStatusError('Юрлицо с таким ИНН уже существует')
      }
    }

    throw error
  }

  return getModerationVenueDetail(venue.id)
}

export async function updateModerationVenueInventorySessionStatus(
  venueId: string,
  sessionId: string,
  status: unknown
) {
  const normalizedStatus =
    typeof status === 'string' ? status.trim().toUpperCase() : ''

  if (
    ![
      InventorySessionStatus.IN_PROGRESS,
      InventorySessionStatus.SUBMITTED_FOR_REVIEW,
      InventorySessionStatus.CLOSED,
    ].includes(normalizedStatus as InventorySessionStatus)
  ) {
    throw new ModerationStatusError('Некорректный статус ревизии')
  }

  const venue = await prisma.venue.findUnique({
    where: {
      ...externalIdWhere(venueId, '3'),
    },
    select: {
      id: true,
    },
  })

  if (!venue) {
    return null
  }

  const result = await prisma.inventorySession.updateMany({
    where: {
      id: sessionId,
      venueId: venue.id,
    },
    data: {
      status: normalizedStatus as InventorySessionStatus,
      completedAt:
        normalizedStatus === InventorySessionStatus.CLOSED
          ? new Date()
          : null,
    },
  })

  if (result.count === 0) {
    throw new ModerationStatusError('Ревизия не найдена', 404)
  }

  return getModerationVenueDetail(venue.id)
}

export async function uploadModerationVenuePhotos(
  venueId: string,
  files: Express.Multer.File[]
) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new ModerationStatusError('Нужно выбрать хотя бы одно фото')
  }

  const venue = await prisma.venue.findUnique({
    where: {
      ...externalIdWhere(venueId, '3'),
    },
    include: {
      photos: {
        where: {
          status: VenuePhotoStatus.ACTIVE,
        },
        orderBy: {
          sortOrder: 'asc',
        },
      },
    },
  })

  if (!venue) {
    await Promise.all(files.map((file) => fs.unlink(file.path).catch(() => undefined)))
    return null
  }

  if (venue.photos.length + files.length > 3) {
    await Promise.all(files.map((file) => fs.unlink(file.path).catch(() => undefined)))
    throw new ModerationStatusError('В карточку заведения можно загрузить не больше 3 фото')
  }

  try {
    await prisma.$transaction(async (tx) => {
      let sortOrder = venue.photos.length

      for (const file of files) {
        const fileAsset = await tx.fileAsset.create({
          data: {
            storageKey: getStorageKeyFromUploadedFile(file),
            fileName: normalizeUploadDisplayFileName(file.originalname),
            mimeType: file.mimetype.toLowerCase(),
            fileSize: file.size,
            type: FileAssetType.IMAGE,
          },
        })

        await tx.venuePhoto.create({
          data: {
            venueId: venue.id,
            fileAssetId: fileAsset.id,
            sortOrder,
          },
        })

        if (!venue.mainPhotoFileId && sortOrder === 0) {
          await tx.venue.update({
            where: { id: venue.id },
            data: { mainPhotoFileId: fileAsset.id },
          })
        }

        sortOrder += 1
      }
    })
  } catch (error) {
    await Promise.all(files.map((file) => fs.unlink(file.path).catch(() => undefined)))
    throw error
  }

  return getModerationVenueDetail(venue.id)
}

export async function uploadModerationVenueFile(
  venueId: string,
  purpose: unknown,
  file: Express.Multer.File | undefined
) {
  if (!file) {
    throw new ModerationStatusError('Файл обязателен')
  }

  const normalizedPurpose = normalizeModerationVenueFilePurpose(purpose)
  const venue = await prisma.venue.findUnique({
    where: {
      ...externalIdWhere(venueId, '3'),
    },
    select: {
      id: true,
    },
  })

  if (!venue) {
    await fs.unlink(file.path).catch(() => undefined)
    return null
  }

  try {
    await prisma.$transaction(async (tx) => {
      const fileAsset = await tx.fileAsset.create({
        data: {
          storageKey: getStorageKeyFromUploadedFile(file),
          fileName: normalizeUploadDisplayFileName(file.originalname),
          mimeType: file.mimetype.toLowerCase(),
          fileSize: file.size,
          type: getFileAssetTypeByMimeType(file.mimetype),
        },
      })

      await tx.businessDownload.create({
        data: {
          venueId: venue.id,
          fileAssetId: fileAsset.id,
          purpose: normalizedPurpose,
        },
      })
    })
  } catch (error) {
    await fs.unlink(file.path).catch(() => undefined)
    throw error
  }

  return getModerationVenueDetail(venue.id)
}

export async function getModerationVenueFilePreview(
  venueId: string,
  downloadId: string
) {
  const venue = await prisma.venue.findUnique({
    where: {
      ...externalIdWhere(venueId, '3'),
    },
    select: {
      id: true,
    },
  })

  if (!venue) return null

  const download = await prisma.businessDownload.findFirst({
    where: {
      id: downloadId,
      venueId: venue.id,
    },
    include: {
      fileAsset: true,
      uploadedBy: {
        include: {
          profile: true,
        },
      },
    },
  })

  if (!download) return null

  const filePath = getFilePathFromStorageKey(download.fileAsset?.storageKey)

  if (!filePath) {
    throw new ModerationStatusError('Файл не найден')
  }

  const parsed =
    download.purpose === BusinessDownloadPurpose.STOCK
      ? parseVenueStockWorkbook(filePath)
      : { sheetName: null, rows: [], stats: null }

  return {
    file: formatBusinessDownload(download),
    preview: {
      sheetName: parsed.sheetName,
      rows: parsed.rows.slice(0, 100),
      hasMore: parsed.rows.length > 100,
      stats: parsed.stats,
    },
  }
}

export async function deleteModerationVenueFile(
  venueId: string,
  downloadId: string
) {
  const venue = await prisma.venue.findUnique({
    where: {
      ...externalIdWhere(venueId, '3'),
    },
    select: {
      id: true,
    },
  })

  if (!venue) return null

  const download = await prisma.businessDownload.findFirst({
    where: {
      id: downloadId,
      venueId: venue.id,
    },
    include: {
      fileAsset: true,
    },
  })

  if (!download) return null

  await prisma.$transaction(async (tx) => {
    await tx.businessDownload.delete({
      where: {
        id: download.id,
      },
    })

    await tx.fileAsset.delete({
      where: {
        id: download.fileAssetId,
      },
    })
  })

  await unlinkFileAssetStorage(download.fileAsset)

  return getModerationVenueDetail(venue.id)
}

export async function replaceModerationVenueFile(
  venueId: string,
  downloadId: string,
  purpose: unknown,
  file: Express.Multer.File | undefined
) {
  if (!file) {
    throw new ModerationStatusError('Файл обязателен')
  }

  const normalizedPurpose = normalizeModerationVenueFilePurpose(purpose)
  const venue = await prisma.venue.findUnique({
    where: {
      ...externalIdWhere(venueId, '3'),
    },
    select: {
      id: true,
    },
  })

  if (!venue) {
    await fs.unlink(file.path).catch(() => undefined)
    return null
  }

  const existingDownload = await prisma.businessDownload.findFirst({
    where: {
      id: downloadId,
      venueId: venue.id,
    },
    include: {
      fileAsset: true,
    },
  })

  if (!existingDownload) {
    await fs.unlink(file.path).catch(() => undefined)
    return null
  }

  try {
    await prisma.$transaction(async (tx) => {
      const fileAsset = await tx.fileAsset.create({
        data: {
          storageKey: getStorageKeyFromUploadedFile(file),
          fileName: normalizeUploadDisplayFileName(file.originalname),
          mimeType: file.mimetype.toLowerCase(),
          fileSize: file.size,
          type: getFileAssetTypeByMimeType(file.mimetype),
        },
      })

      await tx.businessDownload.update({
        where: {
          id: existingDownload.id,
        },
        data: {
          fileAssetId: fileAsset.id,
          purpose: normalizedPurpose,
          status: BusinessDownloadStatus.UPLOADED,
          processingError: null,
        },
      })

      await tx.fileAsset.delete({
        where: {
          id: existingDownload.fileAssetId,
        },
      })
    })
  } catch (error) {
    await fs.unlink(file.path).catch(() => undefined)
    throw error
  }

  await unlinkFileAssetStorage(existingDownload.fileAsset)

  return getModerationVenueDetail(venue.id)
}

export async function importModerationVenueStockFile(
  venueId: string,
  downloadId: string
) {
  const venue = await prisma.venue.findUnique({
    where: {
      ...externalIdWhere(venueId, '3'),
    },
    select: {
      id: true,
    },
  })

  if (!venue) return null

  const download = await prisma.businessDownload.findFirst({
    where: {
      id: downloadId,
      venueId: venue.id,
    },
    include: {
      fileAsset: true,
    },
  })

  if (!download) return null

  if (download.purpose !== BusinessDownloadPurpose.STOCK) {
    throw new ModerationStatusError('Импорт склада доступен только для файлов с назначением STOCK')
  }

  const filePath = getFilePathFromStorageKey(download.fileAsset?.storageKey)

  if (!filePath) {
    throw new ModerationStatusError('Файл не найден')
  }

  const parsed = parseVenueStockWorkbook(filePath)
  const validRows = parsed.rows.filter((row) => row.issues.length === 0)

  const existingItems = await prisma.inventoryItem.findMany({
    where: {
      venueId: venue.id,
      productId: null,
    },
  })
  const existingByName = new Map(
    existingItems.map((item) => [normalizeStockImportNameKey(item.name), item])
  )

  let created = 0
  let updated = 0

  await prisma.$transaction(async (tx) => {
    for (const row of validRows) {
      const existing = existingByName.get(normalizeStockImportNameKey(row.name))
      const data = {
        name: row.name,
        quantity: row.quantity,
        unit: row.unit,
        avgPrice: row.unitPrice,
        lastPurchasePrice: row.unitPrice,
        isOutOfStock: row.quantity <= 0,
      }

      if (existing) {
        await tx.inventoryItem.update({
          where: {
            id: existing.id,
          },
          data,
        })
        updated += 1
      } else {
        await tx.inventoryItem.create({
          data: {
            venueId: venue.id,
            ...data,
          },
        })
        created += 1
      }
    }

    await tx.businessDownload.update({
      where: {
        id: download.id,
      },
      data: {
        status: BusinessDownloadStatus.DONE,
        processingError: null,
      },
    })
  })

  return {
    venueDetail: await getModerationVenueDetail(venue.id),
    importResult: {
      created,
      updated,
      skipped: parsed.rows.length - validRows.length,
      total: parsed.rows.length,
    },
  }
}

export async function deleteModerationVenuePhoto(
  venueId: string,
  photoId: string
) {
  const venue = await prisma.venue.findUnique({
    where: {
      ...externalIdWhere(venueId, '3'),
    },
    select: {
      id: true,
      mainPhotoFileId: true,
    },
  })

  if (!venue) return null

  const photo = await prisma.venuePhoto.findFirst({
    where: {
      id: photoId,
      venueId: venue.id,
    },
    include: {
      fileAsset: true,
    },
  })

  if (!photo) {
    throw new ModerationStatusError('Фото не найдено', 404)
  }

  await prisma.$transaction(async (tx) => {
    if (venue.mainPhotoFileId === photo.fileAssetId) {
      await tx.venue.update({
        where: { id: venue.id },
        data: { mainPhotoFileId: null },
      })
    }

    await tx.venuePhoto.delete({
      where: { id: photo.id },
    })

    await tx.fileAsset.delete({
      where: { id: photo.fileAssetId },
    })
  })

  if (photo.fileAsset?.storageKey) {
    const filePath = path.resolve(env.uploadsRoot, photo.fileAsset.storageKey)
    await fs.unlink(filePath).catch(() => undefined)
  }

  return getModerationVenueDetail(venue.id)
}

export async function rejectModerationVenuePhoto(
  venueId: string,
  photoId: string
) {
  const venue = await prisma.venue.findUnique({
    where: {
      ...externalIdWhere(venueId, '3'),
    },
    select: {
      id: true,
      mainPhotoFileId: true,
    },
  })

  if (!venue) return null

  const photo = await prisma.venuePhoto.findFirst({
    where: {
      id: photoId,
      venueId: venue.id,
    },
    select: {
      id: true,
      fileAssetId: true,
    },
  })

  if (!photo) {
    throw new ModerationStatusError('Фото не найдено', 404)
  }

  await prisma.$transaction(async (tx) => {
    if (venue.mainPhotoFileId === photo.fileAssetId) {
      await tx.venue.update({
        where: { id: venue.id },
        data: { mainPhotoFileId: null },
      })
    }

    await tx.venuePhoto.update({
      where: { id: photo.id },
      data: {
        status: VenuePhotoStatus.REJECTED,
        rejectedAt: new Date(),
      },
    })
  })

  return getModerationVenueDetail(venue.id)
}

const moderationSupplierInclude = Prisma.validator<Prisma.SupplierInclude>()({
  business: true,
  categories: true,
  supplierProducts: {
    include: {
      offers: true,
    },
  },
  sponsoredPlacements: {
    where: {
      isActive: true,
    },
  },
  priceImports: {
    orderBy: {
      createdAt: 'desc',
    },
    take: 1,
    include: {
      fileAsset: {
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          fileSize: true,
        },
      },
    },
  },
  memberships: {
    orderBy: {
      createdAt: 'asc',
    },
    include: {
      user: {
        include: {
          profile: true,
        },
      },
    },
  },
  _count: {
    select: {
      priceImports: true,
    },
  },
})

type ModerationSupplierRecord = Prisma.SupplierGetPayload<{
  include: typeof moderationSupplierInclude
}>

function toIsoString(value: Date | null | undefined) {
  return value?.toISOString() ?? null
}

function getSupplierPriceImportUploadType(value: Prisma.JsonValue | null | undefined): 'ORIGINAL' | 'NORMALIZED' {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const uploadType = (value as Record<string, unknown>).uploadType
    if (uploadType === 'ORIGINAL') return 'ORIGINAL'
    if (uploadType === 'NORMALIZED') return 'NORMALIZED'
  }

  return 'NORMALIZED'
}

function formatModerationSupplier(
  supplier: ModerationSupplierRecord
): ModerationSupplierDto {
  const supplierProducts = supplier.supplierProducts ?? []
  const offersCount = supplierProducts.reduce(
    (total, supplierProduct) => total + supplierProduct.offers.length,
    0
  )
  const lastPriceImport = supplier.priceImports[0] ?? null
  const ownerMembership =
    supplier.memberships.find(
      (membership) => membership.accessLevel === AccessLevel.ADMIN
    ) ?? supplier.memberships[0] ?? null
  const owner = ownerMembership?.user ?? null
  const ownerFullName = owner?.profile
    ? [owner.profile.lastName, owner.profile.firstName, owner.profile.middleName]
        .filter(Boolean)
        .join(' ')
    : null
  const hasActiveAccount =
    owner?.status === UserStatus.ACTIVE &&
    ownerMembership?.status === MembershipStatus.ACTIVE

  return {
    id: supplier.id,
    publicId: supplier.publicId,
    tableId: supplier.publicId,
    businessId: supplier.businessId,
    inn: supplier.business?.taxNumber ?? null,
    name: supplier.name,
    displayName: supplier.catalogName || supplier.name,
    companyName: supplier.name,
    catalogName: supplier.catalogName,
    city: supplier.city,
    address: supplier.address,
    contactName: supplier.contactName,
    ownerFullName,
    ownerName: ownerFullName,
    ownerPhone: owner?.phone ?? null,
    owner: owner
      ? {
          id: owner.id,
          publicId: owner.publicId,
          fullName: ownerFullName,
          loginPhone: owner.phone,
          status: owner.status,
          accountType: owner.accountType,
          lastLoginAt: toIsoString(owner.lastLoginAt),
        }
      : null,
    hasActiveAccount,
    accountStatus: hasActiveAccount ? 'ACTIVE' : owner?.status ?? 'UNIDENTIFIED',
    membershipId: ownerMembership?.id ?? null,
    membershipStatus: ownerMembership?.status ?? null,
    membershipAccessLevel: ownerMembership?.accessLevel ?? null,
    membershipJoinedAt: toIsoString(ownerMembership?.joinedAt),
    loginPhone: owner?.phone ?? null,
    companyPhone: supplier.phone,
    phone: supplier.phone,
    email: supplier.email,
    website: supplier.website,
    accessStatus:
      owner?.status === UserStatus.BLOCKED || !supplier.isActive
        ? 'BLOCKED'
        : 'ACTIVE',
    lastLoginAt: toIsoString(owner?.lastLoginAt),
    categoriesCount: supplier.categories.length,
    supplierProductsCount: supplierProducts.length,
    productsCount: supplierProducts.length,
    offersCount,
    promoCount: supplier.sponsoredPlacements.length,
    priceImportsCount: supplier._count.priceImports,
    lastPriceImportAt: toIsoString(lastPriceImport?.createdAt),
    lastPriceImport: lastPriceImport
      ? {
          id: lastPriceImport.id,
          fileName: lastPriceImport.fileAsset?.fileName ?? lastPriceImport.originalFileName ?? null,
          uploadType: getSupplierPriceImportUploadType(lastPriceImport.mappingConfigJson),
          status: lastPriceImport.status,
          createdAt: lastPriceImport.createdAt.toISOString(),
          rowsCount: lastPriceImport.rowsCount,
          failedRows: lastPriceImport.failedRows,
          errorText: lastPriceImport.errorText,
        }
      : null,
    isActive: supplier.isActive,
    createdAt: supplier.createdAt.toISOString(),
    updatedAt: supplier.updatedAt.toISOString(),
  }
}

function supplierError(params: {
  code: string
  message: string
  status?: number
  details?: unknown
}) {
  return new ModerationSupplierValidationError(params)
}

async function findModerationSupplierOrThrow(supplierId: string) {
  const supplier = await prisma.supplier.findUnique({
    where: externalIdWhere(supplierId, '2'),
    include: moderationSupplierInclude,
  })

  if (!supplier) {
    throw supplierError({
      code: 'SUPPLIER_NOT_FOUND',
      message: 'Поставщик не найден',
      status: 404,
      details: { supplierId },
    })
  }

  return supplier
}

export async function getModerationSupplierDetail(
  supplierId: string
): Promise<ModerationSupplierDetailDto> {
  const supplier = await findModerationSupplierOrThrow(supplierId)
  const priceImports = await getModerationSupplierPriceImports(supplierId)

  return {
    ...formatModerationSupplier(supplier),
    priceImports,
  }
}

function decimalToNumber(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) return null
  return Number(value)
}

export async function getModerationSupplierProducts(
  supplierId: string,
  query: Record<string, unknown> = {}
): Promise<ModerationSupplierProductsResponseDto> {
  await findModerationSupplierOrThrow(supplierId)
  const searchQuery = typeof query.query === 'string' ? query.query.trim() : ''
  const where: Prisma.SupplierProductWhereInput = {
    supplierId,
    ...(searchQuery
      ? {
          OR: [
            { product: { name: { contains: searchQuery, mode: 'insensitive' } } },
            { product: { translatedName: { contains: searchQuery, mode: 'insensitive' } } },
            { product: { article: { contains: searchQuery, mode: 'insensitive' } } },
            { product: { barcode: { contains: searchQuery, mode: 'insensitive' } } },
            { product: { brand: { contains: searchQuery, mode: 'insensitive' } } },
            { product: { producer: { contains: searchQuery, mode: 'insensitive' } } },
            { supplierSku: { contains: searchQuery, mode: 'insensitive' } },
          ],
        }
      : {}),
  }

  const [total, supplierProducts] = await prisma.$transaction([
    prisma.supplierProduct.count({ where }),
    prisma.supplierProduct.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        product: {
          include: {
            category: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
          },
        },
        productVariant: true,
        offers: {
          orderBy: [
            { isCurrent: 'desc' },
            { updatedAt: 'desc' },
          ],
        },
      },
    }),
  ])

  const sourceImportIds = [
    ...new Set(
      supplierProducts
        .flatMap((supplierProduct) =>
          supplierProduct.offers
            .map((offer) => offer.sourceImportId)
            .filter((sourceImportId): sourceImportId is string => Boolean(sourceImportId))
        )
    ),
  ]
  const sourceImports = sourceImportIds.length
    ? await prisma.supplierPriceImport.findMany({
        where: {
          id: { in: sourceImportIds },
          supplierId,
        },
        select: {
          id: true,
          originalFileName: true,
          fileAssetId: true,
          fileAsset: {
            select: {
              id: true,
              fileName: true,
              mimeType: true,
              fileSize: true,
              storageKey: true,
            },
          },
        },
      })
    : []
  const sourceImportsById = new Map(sourceImports.map((item) => [item.id, item]))

  return {
    items: supplierProducts.map((supplierProduct) => {
      const latestSourceOffer = supplierProduct.offers.find((offer) => offer.sourceImportId) ?? null
      const sourceImport = latestSourceOffer?.sourceImportId
        ? sourceImportsById.get(latestSourceOffer.sourceImportId) ?? null
        : null
      const variantVolume = supplierProduct.productVariant
        ? normalizeModerationVolumeForDisplay(
            supplierProduct.productVariant.volume,
            supplierProduct.productVariant.volumeUnit,
          )
        : null

      return {
        id: supplierProduct.id,
        productId: supplierProduct.productId,
        productName: supplierProduct.product.name,
        category: supplierProduct.product.category
          ? {
              id: supplierProduct.product.category.id,
              name: supplierProduct.product.category.name,
              code: supplierProduct.product.category.code,
            }
          : null,
        supplierSku: supplierProduct.supplierSku,
        barcode: supplierProduct.product.barcode,
        variant: supplierProduct.productVariant
          ? {
              id: supplierProduct.productVariant.id,
              volume: variantVolume?.volume ?? null,
              volumeUnit: variantVolume?.volumeUnit ?? null,
              packageSize: decimalToNumber(supplierProduct.productVariant.packageSize),
              packageSizeUnit: supplierProduct.productVariant.packageSizeUnit,
              isDefault: supplierProduct.productVariant.isDefault,
            }
          : null,
        offers: supplierProduct.offers.map((offer) => ({
          id: offer.id,
          price: Number(offer.effectivePrice ?? offer.price),
          currency: offer.currency,
          availability: offer.availabilityLevel,
          stockAvailable: decimalToNumber(offer.stockAvailable),
          deliveryTerm: offer.deliveryTerm,
        })),
        sourceImportId: latestSourceOffer?.sourceImportId ?? null,
        sourceImportRowId:
          latestSourceOffer?.sourceImportRowId ??
          supplierProduct.sourceImportRowId ??
          null,
        sourceImport: sourceImport
          ? {
              id: sourceImport.id,
              fileAssetId: sourceImport.fileAssetId,
              fileName:
                sourceImport.originalFileName ??
                sourceImport.fileAsset?.fileName ??
                null,
              file: sourceImport.fileAsset
                ? {
                    id: sourceImport.fileAsset.id,
                    fileName: sourceImport.fileAsset.fileName,
                    mimeType: sourceImport.fileAsset.mimeType,
                    fileSize: sourceImport.fileAsset.fileSize,
                    url: buildModerationFileUrl(sourceImport.fileAsset.storageKey),
                  }
                : null,
            }
          : null,
        updatedAt: supplierProduct.updatedAt.toISOString(),
      }
    }),
    total,
  }
}

export async function updateModerationSupplierProduct(
  supplierId: string,
  supplierProductId: string,
  input: UpdateModerationSupplierProductDto
) {
  await findModerationSupplierOrThrow(supplierId)

  const supplierProduct = await prisma.supplierProduct.findFirst({
    where: { id: supplierProductId, supplierId },
    include: {
      offers: {
        orderBy: [
          { isCurrent: 'desc' },
          { updatedAt: 'desc' },
        ],
        take: 1,
      },
    },
  })

  if (!supplierProduct) {
    throw new ModerationSupplierValidationError({
      code: 'SUPPLIER_PRODUCT_NOT_FOUND',
      status: 404,
      message: 'Товар поставщика не найден',
      details: { supplierId, supplierProductId },
    })
  }

  const offerId = input.offerId ?? supplierProduct.offers[0]?.id ?? null

  await prisma.$transaction(async (tx) => {
    if (input.supplierSku !== undefined) {
      await tx.supplierProduct.update({
        where: { id: supplierProduct.id },
        data: { supplierSku: input.supplierSku },
      })
    }

    const offerData: Prisma.OfferUpdateInput = {}
    if (input.price !== undefined && input.price !== null) {
      const price = new Prisma.Decimal(input.price.toFixed(2))
      offerData.price = price
      offerData.effectivePrice = price
    }
    if (input.currency !== undefined && input.currency !== null) {
      offerData.currency = input.currency
    }
    if (input.stockAvailable !== undefined) {
      offerData.stockAvailable = input.stockAvailable === null
        ? null
        : new Prisma.Decimal(input.stockAvailable.toFixed(3))
    }
    if (input.availability !== undefined && input.availability !== null) {
      offerData.availabilityLevel = input.availability as OfferAvailabilityLevel
      offerData.isAvailable = input.availability !== OfferAvailabilityLevel.OUT_OF_STOCK
    }
    if (input.deliveryTerm !== undefined) {
      offerData.deliveryTerm = input.deliveryTerm
    }

    if (Object.keys(offerData).length > 0) {
      if (!offerId) {
        throw new ModerationSupplierValidationError({
          code: 'SUPPLIER_PRODUCT_OFFER_REQUIRED',
          message: 'У товара поставщика нет оффера для исправления',
          details: { supplierProductId },
        })
      }

      const offer = await tx.offer.findFirst({
        where: {
          id: offerId,
          supplierProductId: supplierProduct.id,
        },
        select: { id: true },
      })

      if (!offer) {
        throw new ModerationSupplierValidationError({
          code: 'SUPPLIER_PRODUCT_OFFER_NOT_FOUND',
          status: 404,
          message: 'Оффер товара поставщика не найден',
          details: { supplierProductId, offerId },
        })
      }

      await tx.offer.update({
        where: { id: offer.id },
        data: offerData,
      })
    }
  })

  const products = await getModerationSupplierProducts(supplierId, {
    query: supplierProduct.supplierSku ?? '',
  })
  return products.items.find((item) => item.id === supplierProduct.id) ?? null
}

function normalizeSuggestionLimit(value: unknown, fallback = 5, max = 10) {
  const parsed = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : fallback
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(Math.floor(parsed), max)
}

export async function suggestModerationSupplierProducts(
  supplierId: string,
  query: Record<string, unknown>
) {
  await findModerationSupplierOrThrow(supplierId)
  const searchQuery = typeof query.query === 'string' ? query.query.trim() : ''
  if (searchQuery.length < 2) {
    return { items: [] }
  }

  const products = await prisma.supplierProduct.findMany({
    where: {
      supplierId,
      OR: [
        { product: { name: { contains: searchQuery, mode: 'insensitive' } } },
        { product: { translatedName: { contains: searchQuery, mode: 'insensitive' } } },
        { product: { article: { contains: searchQuery, mode: 'insensitive' } } },
        { product: { barcode: { contains: searchQuery, mode: 'insensitive' } } },
        { product: { brand: { contains: searchQuery, mode: 'insensitive' } } },
        { product: { producer: { contains: searchQuery, mode: 'insensitive' } } },
        { supplierSku: { contains: searchQuery, mode: 'insensitive' } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    take: normalizeSuggestionLimit(query.limit, 5, 5),
    select: {
      id: true,
      productId: true,
      supplierSku: true,
      product: {
        select: {
          publicId: true,
          name: true,
          translatedName: true,
          category: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  })

  return {
    items: products.map((item) => ({
      id: item.id,
      productId: item.productId,
      publicId: item.product.publicId,
      label: item.product.name,
      secondaryLabel:
        item.product.translatedName ||
        item.product.category?.name ||
        item.supplierSku ||
        null,
    })),
  }
}

export async function getModerationSupplierPriceImports(
  supplierId: string
): Promise<ModerationSupplierPriceImportDto[]> {
  await findModerationSupplierOrThrow(supplierId)

  const imports = await prisma.supplierPriceImport.findMany({
    where: { supplierId },
    orderBy: { createdAt: 'desc' },
  })
  const fileAssets = await prisma.fileAsset.findMany({
    where: { id: { in: imports.map((item) => item.fileAssetId) } },
    select: { id: true, fileName: true, mimeType: true, fileSize: true },
  })
  const filesById = new Map(fileAssets.map((file) => [file.id, file]))

  return imports.map((item) => ({
    id: item.id,
    supplierId: item.supplierId,
    sourceFormat: item.sourceFormat,
    uploadType: getSupplierPriceImportUploadType(item.mappingConfigJson),
    status: item.status,
    rowsCount: item.rowsCount,
    processedRows: item.processedRows,
    failedRows: item.failedRows,
    errorText: item.errorText,
    fileAssetId: item.fileAssetId,
    file: filesById.get(item.fileAssetId) ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }))
}

export async function getModerationSupplierPriceImportOverview(
  supplierId: string,
  importId: string,
  pagination?: { page?: number; pageSize?: number }
): Promise<ModerationSupplierPriceImportOverviewDto> {
  const page = pagination?.page ?? 1
  const pageSize = pagination?.pageSize ?? 100

  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
    throw supplierError({
      code: 'PRICE_IMPORT_PAGINATION_INVALID',
      message: 'Неверные параметры пагинации',
      details: { page, pageSize },
    })
  }

  const priceImport = (await getModerationSupplierPriceImports(supplierId)).find(
    (item) => item.id === importId
  )

  if (!priceImport) {
    throw supplierError({
      code: 'PRICE_IMPORT_NOT_FOUND',
      message: 'Прайс не найден',
      status: 404,
      details: { supplierId, importId },
    })
  }

  const [allRows, rows] = await Promise.all([
    prisma.supplierPriceImportRow.findMany({
      where: { importId },
      select: { rawCategory: true, mappingStatus: true },
    }),
    prisma.supplierPriceImportRow.findMany({
      where: { importId },
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        rawName: true,
        rawCategory: true,
        mappingStatus: true,
        errorText: true,
      },
    }),
  ])

  const categories = new Map<string, number>()
  let matched = 0
  let unmatched = 0
  let failed = 0

  for (const row of allRows) {
    const category = row.rawCategory?.trim() || 'Без категории'
    categories.set(category, (categories.get(category) ?? 0) + 1)

    if (
      row.mappingStatus === PriceImportRowMappingStatus.MATCHED ||
      row.mappingStatus === PriceImportRowMappingStatus.MANUAL_MATCHED
    ) matched += 1
    else if (row.mappingStatus === PriceImportRowMappingStatus.UNMATCHED) unmatched += 1
    else failed += 1
  }

  return {
    import: priceImport,
    stats: {
      categories: {
        total: categories.size,
        items: [...categories.entries()]
          .map(([name, productsCount]) => ({ name, productsCount }))
          .sort((left, right) => right.productsCount - left.productsCount || left.name.localeCompare(right.name)),
      },
      products: { total: allRows.length, matched, unmatched, failed },
    },
    rows: {
      items: rows,
      total: allRows.length,
      page,
      pageSize,
      hasMore: page * pageSize < allRows.length,
    },
  }
}

export async function deleteModerationSupplierPriceImport(
  supplierId: string,
  importId: string,
  moderator?: { id: string; email: string; name: string }
): Promise<DeleteModerationSupplierPriceImportResponseDto> {
  await findModerationSupplierOrThrow(supplierId)

  const priceImport = await prisma.supplierPriceImport.findFirst({
    where: { id: importId, supplierId },
    select: { id: true, fileAssetId: true },
  })

  if (!priceImport) {
    throw supplierError({
      code: 'PRICE_IMPORT_NOT_FOUND',
      message: 'Прайс не найден',
      status: 404,
      details: { supplierId, importId },
    })
  }

  const fileAsset = await prisma.fileAsset.findUnique({
    where: { id: priceImport.fileAssetId },
    select: { id: true, storageKey: true, fileName: true },
  })

  try {
    await prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.SYSTEM,
          entityType: 'SupplierPriceImport',
          entityId: priceImport.id,
          action: 'MODERATION_SUPPLIER_PRICE_IMPORT_DELETED',
          payload: {
            supplierId,
            fileAssetId: fileAsset?.id ?? null,
            fileName: fileAsset?.fileName ?? null,
            moderatorId: moderator?.id ?? null,
            moderatorEmail: moderator?.email ?? null,
          },
        },
      })
      await tx.supplierPriceImport.delete({ where: { id: priceImport.id } })

      if (fileAsset) {
        await tx.fileAsset.delete({ where: { id: fileAsset.id } })
      }
    })
  } catch (error) {
    if (error instanceof ModerationSupplierValidationError) throw error

    throw supplierError({
      code: 'PRICE_IMPORT_DELETE_CONFLICT',
      message: 'Прайс не удалось удалить',
      status: 409,
      details: {
        supplierId,
        importId,
        cause: error instanceof Error ? error.message : 'Unknown delete error',
      },
    })
  }

  if (fileAsset?.storageKey) {
    const uploadsRoot = path.resolve(process.cwd(), 'uploads')
    const filePath = path.resolve(process.cwd(), fileAsset.storageKey)

    if (filePath.startsWith(`${uploadsRoot}${path.sep}`)) {
      await fs.rm(filePath, { force: true }).catch(() => undefined)
    }
  }

  return {
    ok: true as const,
    importId,
    supplier: await getModerationSupplierDetail(supplierId),
  }
}

export async function replaceModerationSupplierPriceImport(
  supplierId: string,
  importId: string,
  file: {
    originalname: string
    mimetype: string
    size: number
    path: string
    filename: string
  } | undefined,
  moderator?: { id: string; email: string; name: string },
  options: { uploadType?: 'ORIGINAL' | 'NORMALIZED' } = {},
) {
  const existing = await prisma.supplierPriceImport.findFirst({
    where: { id: importId, supplierId },
    select: { id: true },
  })

  if (!existing) {
    throw supplierError({
      code: 'PRICE_IMPORT_NOT_FOUND',
      message: 'Прайс не найден',
      status: 404,
      details: { supplierId, importId },
    })
  }

  const imported = await importModerationSupplierPrice(supplierId, file, moderator, options)

  try {
    await deleteModerationSupplierPriceImport(supplierId, importId, moderator)
  } catch (error) {
    await deleteModerationSupplierPriceImport(
      supplierId,
      imported.importId,
      moderator
    ).catch(() => undefined)
    throw error
  }

  return {
    ok: true as const,
    replacedImportId: importId,
    import: {
      ...imported,
      supplier: await getModerationSupplierDetail(supplierId),
    },
  }
}

export async function updateModerationSupplierAccessStatus(
  supplierId: string,
  accessStatus: ModerationSupplierAccessStatus,
  moderator?: { id: string; email: string; name: string }
) {
  if (accessStatus !== 'ACTIVE' && accessStatus !== 'BLOCKED') {
    throw supplierError({
      code: 'ACCESS_STATUS_INVALID',
      message: 'Статус доступа должен быть ACTIVE или BLOCKED',
      details: { field: 'accessStatus' },
    })
  }

  await findModerationSupplierOrThrow(supplierId)
  const isActive = accessStatus === 'ACTIVE'

  await prisma.$transaction(async (tx) => {
    await tx.supplier.update({
      where: { id: supplierId },
      data: { isActive },
    })

    const ownerMemberships = await tx.supplierMembership.findMany({
      where: { supplierId, accessLevel: AccessLevel.ADMIN },
      select: { id: true, userId: true, joinedAt: true },
    })

    await tx.supplierMembership.updateMany({
      where: { id: { in: ownerMemberships.map((item) => item.id) } },
      data: {
        status: isActive ? MembershipStatus.ACTIVE : MembershipStatus.REVOKED,
        ...(isActive ? { joinedAt: new Date() } : {}),
      },
    })

    await tx.user.updateMany({
      where: { id: { in: ownerMemberships.map((item) => item.userId) } },
      data: { status: isActive ? UserStatus.ACTIVE : UserStatus.BLOCKED },
    })

    if (!isActive) {
      await tx.authSession.deleteMany({
        where: { userId: { in: ownerMemberships.map((item) => item.userId) } },
      })
    }

    await tx.auditLog.create({
      data: {
        actorType: AuditActorType.SYSTEM,
        entityType: 'Supplier',
        entityId: supplierId,
        action: 'MODERATION_SUPPLIER_ACCESS_STATUS_CHANGED',
        payload: {
          moderatorId: moderator?.id ?? null,
          moderatorEmail: moderator?.email ?? null,
          accessStatus,
        },
      },
    })
  })

  return getModerationSupplierDetail(supplierId)
}

export async function updateModerationSupplier(
  supplierId: string,
  input: UpdateModerationSupplierDto,
  moderator?: { id: string; email: string; name: string }
) {
  const supplier = await findModerationSupplierOrThrow(supplierId)
  const ownerMembership =
    supplier.memberships.find(
      (membership) => membership.accessLevel === AccessLevel.ADMIN
    ) ?? supplier.memberships[0] ?? null
  const owner = ownerMembership?.user ?? null

  if (!supplier.businessId || !owner) {
    throw supplierError({
      code: 'SUPPLIER_UPDATE_CONFLICT',
      message: 'У поставщика отсутствует компания или владелец',
      status: 409,
      details: { supplierId },
    })
  }

  const [businessConflict, phoneConflict] = await Promise.all([
    prisma.business.findFirst({
      where: { taxNumber: input.inn, id: { not: supplier.businessId } },
      select: { id: true },
    }),
    prisma.user.findFirst({
      where: { phone: input.ownerPhone, id: { not: owner.id } },
      select: { id: true },
    }),
  ])

  if (businessConflict) {
    throw supplierError({
      code: 'INN_ALREADY_EXISTS',
      message: 'Компания с этим ИНН уже существует',
      status: 409,
      details: { field: 'inn', businessId: businessConflict.id },
    })
  }

  if (phoneConflict) {
    throw supplierError({
      code: 'PHONE_ALREADY_REGISTERED',
      message: 'Этот номер уже используется',
      status: 409,
      details: { field: 'ownerPhone', userId: phoneConflict.id },
    })
  }

  await prisma.$transaction(async (tx) => {
    await tx.business.update({
      where: { id: supplier.businessId! },
      data: {
        taxNumber: input.inn,
        name: input.companyName,
        legalAddress: input.address,
      },
    })
    await tx.supplier.update({
      where: { id: supplierId },
      data: {
        name: input.companyName,
        catalogName: input.catalogName ?? null,
        city: input.city,
        address: input.address,
        contactName: input.ownerFullName ?? null,
        phone: input.companyPhone,
      },
    })
    await tx.user.update({
      where: { id: owner.id },
      data: { phone: input.ownerPhone },
    })

    if (input.ownerFullName) {
      const ownerProfile = splitOwnerFullName(input.ownerFullName)
      await tx.userProfile.upsert({
        where: { userId: owner.id },
        create: { userId: owner.id, ...ownerProfile },
        update: ownerProfile,
      })
    } else {
      await tx.userProfile.deleteMany({ where: { userId: owner.id } })
    }

    await tx.auditLog.create({
      data: {
        actorType: AuditActorType.SYSTEM,
        entityType: 'Supplier',
        entityId: supplierId,
        action: 'MODERATION_SUPPLIER_UPDATED',
        payload: {
          moderatorId: moderator?.id ?? null,
          moderatorEmail: moderator?.email ?? null,
          fields: [
            'inn',
            'companyName',
            'catalogName',
            'ownerFullName',
            'ownerPhone',
            'companyPhone',
            'city',
            'address',
          ],
        },
      },
    })
  })

  return getModerationSupplierDetail(supplierId)
}

export async function getModerationSupplierPriceImportDownload(
  supplierId: string,
  importId: string
) {
  const supplier = await findModerationSupplierOrThrow(supplierId)
  const priceImport = await prisma.supplierPriceImport.findFirst({
    where: {
      id: importId,
      supplierId: supplier.id,
    },
    include: {
      fileAsset: {
        select: {
          id: true,
          fileName: true,
          storageKey: true,
          mimeType: true,
        },
      },
    },
  })

  if (!priceImport?.fileAsset) {
    throw supplierError({
      code: 'PRICE_IMPORT_NOT_FOUND',
      message: 'Прайс не найден',
      status: 404,
      details: { supplierId, importId },
    })
  }

  const absolutePath = await getExistingFilePathFromStorageKey(priceImport.fileAsset.storageKey)
  if (!absolutePath) {
    throw supplierError({
      code: 'PRICE_IMPORT_FILE_NOT_FOUND',
      message: 'Файл прайса не найден на диске',
      status: 404,
      details: { supplierId, importId, fileAssetId: priceImport.fileAsset.id },
    })
  }

  return {
    absolutePath,
    fileName: priceImport.fileAsset.fileName || priceImport.originalFileName || 'supplier-price',
    mimeType: priceImport.fileAsset.mimeType || 'application/octet-stream',
  }
}

export async function importModerationSupplierPrice(
  supplierId: string,
  file: {
    originalname: string
    mimetype: string
    size: number
    path: string
    filename: string
  } | undefined,
  moderator?: { id: string; email: string; name: string },
  options: { uploadType?: 'ORIGINAL' | 'NORMALIZED' } = {},
) {
  if (!file) {
    throw supplierError({
      code: 'PRICE_FILE_REQUIRED',
      message: 'Файл прайса обязателен',
      details: { field: 'file' },
    })
  }

  await findModerationSupplierOrThrow(supplierId)

  try {
    const displayFileName = normalizeUploadDisplayFileName(file.originalname)
    const imported = await importPriceFile({ supplierId, file, uploadType: options.uploadType })

    await prisma.auditLog.create({
      data: {
        actorType: AuditActorType.SYSTEM,
        entityType: 'SupplierPriceImport',
        entityId: imported.importId,
        action: 'MODERATION_SUPPLIER_PRICE_IMPORTED',
        payload: {
          supplierId,
          moderatorId: moderator?.id ?? null,
          moderatorEmail: moderator?.email ?? null,
          fileName: displayFileName,
          uploadType: options.uploadType ?? 'NORMALIZED',
        },
      },
    })

    return {
      ...imported,
      supplier: await getModerationSupplierDetail(supplierId),
    }
  } catch (error) {
    if (
      error instanceof ModerationSupplierValidationError &&
      error.code === 'SUPPLIER_NOT_FOUND'
    ) {
      throw error
    }

    throw supplierError({
      code: 'PRICE_IMPORT_FAILED',
      message: error instanceof Error ? error.message : 'Не удалось загрузить прайс',
      status: 400,
      details: { supplierId, fileName: normalizeUploadDisplayFileName(file.originalname) },
    })
  }
}

export async function deleteModerationSupplier(
  supplierId: string,
  moderator?: { id: string; email: string; name: string }
) {
  const supplier = await findModerationSupplierOrThrow(supplierId)
  const businessId = supplier.businessId
  const memberships = supplier.memberships.map((item) => ({
    userId: item.userId,
  }))
  const priceImports = await prisma.supplierPriceImport.findMany({
    where: { supplierId },
    select: { fileAssetId: true },
  })
  const priceFileAssets = await prisma.fileAsset.findMany({
    where: { id: { in: priceImports.map((item) => item.fileAssetId) } },
    select: { id: true, storageKey: true },
  })

  try {
    const result = await prisma.$transaction(async (tx) => {
      const usersToArchive: string[] = []

      for (const membership of memberships) {
        const [venueMemberships, otherSupplierMemberships] = await Promise.all([
          tx.userVenueMembership.count({ where: { userId: membership.userId } }),
          tx.supplierMembership.count({
            where: { userId: membership.userId, supplierId: { not: supplierId } },
          }),
        ])

        if (venueMemberships === 0 && otherSupplierMemberships === 0) {
          usersToArchive.push(membership.userId)
        }
      }

      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.SYSTEM,
          entityType: 'Supplier',
          entityId: supplierId,
          action: 'MODERATION_SUPPLIER_DELETED',
          payload: {
            moderatorId: moderator?.id ?? null,
            moderatorEmail: moderator?.email ?? null,
            supplierName: supplier.name,
            businessId,
            archivedUserIds: usersToArchive,
          },
        },
      })

      await tx.supplierMembership.deleteMany({ where: { supplierId } })
      await tx.supplier.delete({ where: { id: supplierId } })

      if (usersToArchive.length > 0) {
        await tx.authSession.deleteMany({
          where: { userId: { in: usersToArchive } },
        })
        await tx.user.updateMany({
          where: { id: { in: usersToArchive } },
          data: { status: UserStatus.ARCHIVED },
        })
      }

      if (priceImports.length > 0) {
        await tx.fileAsset.deleteMany({
          where: { id: { in: priceImports.map((item) => item.fileAssetId) } },
        })
      }

      let businessDeleted = false

      if (businessId) {
        const business = await tx.business.findUnique({
          where: { id: businessId },
          include: {
            _count: {
              select: {
                venues: true,
                registrationDrafts: true,
                companyModerationRequests: true,
              },
            },
          },
        })

        if (
          business &&
          business._count.venues === 0 &&
          business._count.registrationDrafts === 0 &&
          business._count.companyModerationRequests === 0
        ) {
          await tx.business.delete({ where: { id: businessId } })
          businessDeleted = true
        }
      }

      return { usersToArchive, businessDeleted }
    })

    const uploadsRoot = path.resolve(process.cwd(), 'uploads')
    await Promise.all(
      priceFileAssets.map(async (file) => {
        const filePath = path.resolve(process.cwd(), file.storageKey)

        if (filePath.startsWith(`${uploadsRoot}${path.sep}`)) {
          await fs.rm(filePath, { force: true }).catch(() => undefined)
        }
      })
    )

    return {
      ok: true as const,
      supplierId,
      archivedUserIds: result.usersToArchive,
      businessDeleted: result.businessDeleted,
    }
  } catch (error) {
    if (error instanceof ModerationSupplierValidationError) throw error

    throw supplierError({
      code: 'SUPPLIER_DELETE_CONFLICT',
      message: 'Поставщик не может быть удалён из-за связанных данных',
      status: 409,
      details: {
        supplierId,
        cause: error instanceof Error ? error.message : 'Unknown delete error',
      },
    })
  }
}

function splitOwnerFullName(fullName: string) {
  const [lastName, firstName, ...middleNameParts] = fullName.split(' ')

  return {
    lastName,
    firstName,
    middleName: middleNameParts.join(' ') || undefined,
  }
}

type ExistingSupplierBusiness = {
  id: string
  supplier: { id: string } | null
} | null

type ExistingSupplierOwner = {
  id: string
  accountType: AccountType
  memberships: Array<{ id: string }>
  supplierMemberships: Array<{ supplierId: string }>
} | null

function throwSupplierCreationConflict(
  business: ExistingSupplierBusiness,
  user: ExistingSupplierOwner
) {
  const targetSupplierId = business?.supplier?.id

  if (
    targetSupplierId &&
    user?.supplierMemberships.some(
      (membership) => membership.supplierId === targetSupplierId
    )
  ) {
    throw new ModerationSupplierValidationError({
      code: 'SUPPLIER_MEMBERSHIP_EXISTS',
      message: 'Пользователь уже связан с этим поставщиком',
      status: 409,
      details: { supplierId: targetSupplierId, userId: user.id },
    })
  }

  if (business) {
    throw new ModerationSupplierValidationError({
      code: 'INN_ALREADY_EXISTS',
      message: 'Компания с этим ИНН уже существует',
      status: 409,
      details: { field: 'inn', supplierId: targetSupplierId ?? null },
    })
  }

  if (user) {
    const hasOtherMemberships =
      user.memberships.length > 0 || user.supplierMemberships.length > 0

    throw new ModerationSupplierValidationError({
      code: hasOtherMemberships
        ? 'PHONE_ACCOUNT_CONFLICT'
        : 'PHONE_ALREADY_REGISTERED',
      message: hasOtherMemberships
        ? 'Пользователь уже принадлежит заведению или другому поставщику'
        : 'Этот номер уже используется',
      status: 409,
      details: {
        field: 'ownerPhone',
        userId: user.id,
        confirmationEndpoint:
          '/moderation/suppliers/confirm-existing-account',
      },
    })
  }
}

async function findSupplierCreationConflicts(inn: string, ownerPhone: string) {
  return Promise.all([
    prisma.business.findUnique({
      where: { taxNumber: inn },
      select: {
        id: true,
        supplier: { select: { id: true } },
      },
    }),
    prisma.user.findUnique({
      where: { phone: ownerPhone },
      select: {
        id: true,
        accountType: true,
        memberships: { select: { id: true } },
        supplierMemberships: { select: { supplierId: true } },
      },
    }),
  ])
}

export async function createModerationSupplier(
  input: CreateModerationSupplierDto,
  moderator?: { id: string; email: string; name: string }
) {
  const [existingBusiness, existingUser] =
    await findSupplierCreationConflicts(input.inn, input.ownerPhone)

  throwSupplierCreationConflict(existingBusiness, existingUser)

  const supplierId = await prisma.$transaction(async (tx) => {
    const business = await tx.business.create({
      data: {
        taxNumber: input.inn,
        name: input.companyName,
        legalAddress: input.address,
      },
    })
    const isActive = input.accessStatus === 'ACTIVE'
    const ownerProfile = input.ownerFullName
      ? splitOwnerFullName(input.ownerFullName)
      : null
    const user = await tx.user.create({
      data: {
        phone: input.ownerPhone,
        status: isActive ? UserStatus.ACTIVE : UserStatus.BLOCKED,
        accountType: AccountType.SUPPLIER_STAFF,
        ...(ownerProfile
          ? {
              profile: {
                create: ownerProfile,
              },
            }
          : {}),
      },
    })
    const supplier = await tx.supplier.create({
      data: {
        businessId: business.id,
        name: input.companyName,
        catalogName: input.catalogName ?? null,
        city: input.city,
        address: input.address,
        contactName: input.ownerFullName,
        phone: input.companyPhone,
        isActive,
      },
    })

    await tx.supplierMembership.create({
      data: {
        userId: user.id,
        supplierId: supplier.id,
        displayRole: 'SUPPLIER_ADMIN',
        accessLevel: AccessLevel.ADMIN,
        status: MembershipStatus.ACTIVE,
        joinedAt: new Date(),
      },
    })

    await tx.auditLog.create({
      data: {
        actorType: AuditActorType.SYSTEM,
        entityType: 'Supplier',
        entityId: supplier.id,
        action: 'MODERATION_SUPPLIER_CREATED',
        payload: {
          moderatorId: moderator?.id ?? null,
          moderatorEmail: moderator?.email ?? null,
          ownerUserId: user.id,
          accessStatus: input.accessStatus,
        },
      },
    })

    return supplier.id
  }).catch(async (error: unknown) => {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const [business, user] = await findSupplierCreationConflicts(
        input.inn,
        input.ownerPhone
      )
      throwSupplierCreationConflict(business, user)
    }

    throw error
  })

  const supplier = await prisma.supplier.findUniqueOrThrow({
    where: { id: supplierId },
    include: moderationSupplierInclude,
  })

  return formatModerationSupplier(supplier)
}

export async function confirmExistingModerationSupplierAccount(
  input: ConfirmExistingSupplierAccountDto,
  moderator?: { id: string; email: string; name: string }
) {
  const [existingBusiness, existingUser] =
    await findSupplierCreationConflicts(input.inn, input.ownerPhone)

  if (!existingUser) {
    throw new ModerationSupplierValidationError({
      code: 'PHONE_NOT_REGISTERED',
      message: 'Пользователь с этим номером не найден',
      status: 404,
      details: { field: 'ownerPhone' },
    })
  }

  const existingSupplierId = existingBusiness?.supplier?.id

  if (
    existingSupplierId &&
    existingUser.supplierMemberships.some(
      (membership) => membership.supplierId === existingSupplierId
    )
  ) {
    throw new ModerationSupplierValidationError({
      code: 'SUPPLIER_MEMBERSHIP_EXISTS',
      message: 'Пользователь уже связан с этим поставщиком',
      status: 409,
      details: { supplierId: existingSupplierId, userId: existingUser.id },
    })
  }

  if (existingBusiness && !existingSupplierId) {
    throw new ModerationSupplierValidationError({
      code: 'INN_ALREADY_EXISTS',
      message: 'Компания с этим ИНН уже существует и не является поставщиком',
      status: 409,
      details: { field: 'inn' },
    })
  }

  const supplierId = await prisma.$transaction(async (tx) => {
    let targetSupplierId = existingSupplierId

    if (!targetSupplierId) {
      const business = await tx.business.create({
        data: {
          taxNumber: input.inn,
          name: input.companyName,
          legalAddress: input.address,
        },
      })
      const supplier = await tx.supplier.create({
        data: {
          businessId: business.id,
          name: input.companyName,
          catalogName: input.catalogName ?? null,
          city: input.city,
          address: input.address,
          contactName: input.ownerFullName,
          phone: input.companyPhone,
          isActive: input.accessStatus === 'ACTIVE',
        },
      })
      targetSupplierId = supplier.id
    } else if (input.catalogName !== undefined) {
      await tx.supplier.update({
        where: { id: targetSupplierId },
        data: { catalogName: input.catalogName ?? null },
      })
    }

    if (input.ownerFullName) {
      const profile = await tx.userProfile.findUnique({
        where: { userId: existingUser.id },
        select: { id: true },
      })

      if (!profile) {
        await tx.userProfile.create({
          data: {
            userId: existingUser.id,
            ...splitOwnerFullName(input.ownerFullName),
          },
        })
      }
    }

    if (existingUser.accountType === AccountType.UNIDENTIFIED) {
      await tx.user.update({
        where: { id: existingUser.id },
        data: { accountType: AccountType.SUPPLIER_STAFF },
      })
    }

    await tx.supplierMembership.create({
      data: {
        userId: existingUser.id,
        supplierId: targetSupplierId,
        displayRole: 'SUPPLIER_ADMIN',
        accessLevel: AccessLevel.ADMIN,
        status: MembershipStatus.ACTIVE,
        joinedAt: new Date(),
      },
    })

    await tx.auditLog.create({
      data: {
        actorType: AuditActorType.SYSTEM,
        entityType: 'Supplier',
        entityId: targetSupplierId,
        action: 'MODERATION_EXISTING_SUPPLIER_ACCOUNT_LINKED',
        payload: {
          moderatorId: moderator?.id ?? null,
          moderatorEmail: moderator?.email ?? null,
          ownerUserId: existingUser.id,
          hadVenueMemberships: existingUser.memberships.length > 0,
          previousSupplierMemberships:
            existingUser.supplierMemberships.length,
        },
      },
    })

    return targetSupplierId
  }).catch(async (error: unknown) => {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const [business, user] = await findSupplierCreationConflicts(
        input.inn,
        input.ownerPhone
      )
      throwSupplierCreationConflict(business, user)
    }

    throw error
  })

  const supplier = await prisma.supplier.findUniqueOrThrow({
    where: { id: supplierId },
    include: moderationSupplierInclude,
  })

  return formatModerationSupplier(supplier)
}

export async function getModerationSuppliers(
  query: { sort?: unknown; sortDirection?: unknown } = {}
): Promise<ModerationSupplierListResponseDto> {
  const suppliers = await prisma.supplier.findMany({
    orderBy: {
      createdAt: 'desc',
    },
    include: moderationSupplierInclude,
  })

  const items = suppliers.map(formatModerationSupplier)
  return sortModerationDtoList(items, query, {
    displayName: { accessor: (supplier) => supplier.displayName || supplier.name || supplier.companyName },
    ownerName: { accessor: (supplier) => supplier.ownerName || supplier.ownerFullName },
    accountStatus: { accessor: (supplier) => supplier.accountStatus || supplier.accessStatus },
    createdAt: { type: 'date', accessor: (supplier) => supplier.createdAt },
    lastLoginAt: { type: 'date', accessor: (supplier) => supplier.lastLoginAt },
    lastPriceImport: { type: 'date', accessor: (supplier) => supplier.lastPriceImport?.createdAt },
    categoriesCount: { type: 'number', accessor: (supplier) => supplier.categoriesCount ?? 0 },
    productsCount: { type: 'number', accessor: (supplier) => supplier.productsCount ?? supplier.supplierProductsCount ?? 0 },
  })
}
export async function updateModerationSupplierActivity(
  supplierId: string,
  isActive: boolean
) {
  return prisma.supplier.update({
    where: {
      id: supplierId,
    },
    data: {
      isActive,
    },
  })
}

const moderationMembershipInclude = {
  user: {
    include: {
      profile: true,
    },
  },
  venue: true,
  confirmedByUser: {
    include: {
      profile: true,
    },
  },
}

function formatModerationMembership(membership: any) {
  return {
    id: membership.id,
    publicId: membership.publicId,
    tableId: membership.publicId,
    userId: membership.userId,
    userPublicId: membership.user.publicId,
    userName: getUserDisplayName(membership.user),
    user: {
      id: membership.user.id,
      publicId: membership.user.publicId,
      profile: formatUserProfile(membership.user.profile),
      phone: membership.user.phone,
      email: membership.user.email,
      emailVerifiedAt: membership.user.emailVerifiedAt,
      status: membership.user.status,
    },
    venueId: membership.venueId,
    venuePublicId: membership.venue.publicId,
    venueName: membership.venue.name,
    venue: {
      id: membership.venue.id,
      publicId: membership.venue.publicId,
      name: membership.venue.name,
      city: membership.venue.city,
    },
    displayRole: membership.displayRole,
    role: membership.displayRole,
    accessLevel: membership.accessLevel,
    membershipStatus: membership.membershipStatus,
    joinedAt: membership.joinedAt,
    loginAt: membership.joinedAt,
    confirmedBy: membership.confirmedByUser
      ? formatUserFullName(membership.confirmedByUser)
      : '-',
    confirmedByName: membership.confirmedByUser
      ? getUserDisplayName(membership.confirmedByUser)
      : null,
    createdAt: membership.createdAt,
  }
}

export async function getModerationMemberships(query: { sort?: unknown; sortDirection?: unknown } = {}) {
  const memberships = await prisma.userVenueMembership.findMany({
    orderBy: {
      createdAt: 'desc',
    },
    include: moderationMembershipInclude,
  })

  const items = memberships.map(formatModerationMembership)
  return sortModerationDtoList(items, query, {
    user: { accessor: (membership) => membership.userName },
    venue: { accessor: (membership) => membership.venueName },
    role: { accessor: (membership) => membership.role || membership.displayRole },
    accessLevel: { accessor: (membership) => membership.accessLevel },
    membershipStatus: { accessor: (membership) => membership.membershipStatus },
    loginAt: { type: 'date', accessor: (membership) => membership.loginAt },
    createdAt: { type: 'date', accessor: (membership) => membership.createdAt },
  })
}

export async function updateModerationMembershipStatus(
  membershipId: string,
  membershipStatus: unknown
) {
  const normalizedMembershipStatus =
    normalizeModerationMembershipStatus(membershipStatus)

  const updatedMembership = await prisma.userVenueMembership.update({
    where: {
      id: membershipId,
    },
    data: {
      membershipStatus: normalizedMembershipStatus,
      joinedAt:
        normalizedMembershipStatus === MembershipStatus.ACTIVE
          ? new Date()
          : undefined,
    },
    include: moderationMembershipInclude,
  })

  return formatModerationMembership(updatedMembership)
}

export async function updateModerationMembershipAccessLevel(
  membershipId: string,
  accessLevel: unknown
) {
  const normalizedAccessLevel = normalizeModerationAccessLevel(accessLevel)

  const updatedMembership = await prisma.userVenueMembership.update({
    where: {
      id: membershipId,
    },
    data: {
      accessLevel: normalizedAccessLevel,
    },
    include: moderationMembershipInclude,
  })

  return formatModerationMembership(updatedMembership)
}

export async function updateModerationMembershipRole(
  membershipId: string,
  displayRole: unknown
) {
  const normalizedDisplayRole = normalizeModerationDisplayRole(displayRole)
  const accessLevel = mapDisplayRoleToAccessLevel(normalizedDisplayRole)

  const updatedMembership = await prisma.userVenueMembership.update({
    where: {
      id: membershipId,
    },
    data: {
      displayRole: normalizedDisplayRole,
      accessLevel,
    },
    include: moderationMembershipInclude,
  })

  return formatModerationMembership(updatedMembership)
}

export async function getModerationCatalogFilters() {
  return getCatalogFilters()
}

export async function getModerationCatalogCategories(query: { sort?: unknown; sortDirection?: unknown } = {}) {
  const items = await listModerationCatalogCategoryRecords()
  return sortModerationDtoList(items, query, {
    name: { accessor: (category) => category.name },
    parent: { accessor: (category) => category.parent?.name },
    childrenCount: { type: 'number', accessor: (category) => category.childrenCount ?? 0 },
    productsCount: { type: 'number', accessor: (category) => category.productsCount ?? 0 },
    showInQuickFilters: { type: 'boolean', accessor: (category) => category.showInQuickFilters },
    updatedAt: { type: 'date', accessor: (category) => category.updatedAt },
  })
}

async function ensureCategoryParent(parentId: string | null) {
  if (!parentId) {
    return null
  }

  const parent = await prisma.catalogCategory.findUnique({
    where: { id: parentId },
    select: {
      id: true,
      section: true,
    },
  })

  if (!parent) {
    throw new ModerationCatalogError(400, 'Родительская категория не найдена')
  }

  return parent
}

async function ensureCatalogCategoryExists(categoryId: string) {
  const category = await prisma.catalogCategory.findUnique({
    where: { id: categoryId },
    select: {
      id: true,
      code: true,
      name: true,
    },
  })

  if (!category) {
    throw new ModerationCatalogError(404, 'Category not found')
  }

  return category
}

async function ensureSupplierExists(supplierId: string) {
  const supplier = await prisma.supplier.findUnique({
    where: externalIdWhere(supplierId, '2'),
    select: {
      id: true,
      publicId: true,
      name: true,
    },
  })

  if (!supplier) {
    throw new ModerationCatalogError(404, 'Supplier not found')
  }

  return supplier
}

async function ensureProductExists(productId: string) {
  const product = await prisma.product.findUnique({
    where: externalIdWhere(productId, '0'),
    select: {
      id: true,
      publicId: true,
      name: true,
      categoryId: true,
      rawCategory: true,
    },
  })

  if (!product) {
    throw new ModerationCatalogError(404, 'Product not found')
  }

  return product
}

async function ensureNoCategoryCycle(params: {
  categoryId: string
  nextParentId: string | null
}) {
  const { categoryId, nextParentId } = params

  if (!nextParentId) {
    return
  }

  if (nextParentId === categoryId) {
    throw new ModerationCatalogError(400, 'Категория не может быть родителем самой себе')
  }

  let cursorParentId: string | null = nextParentId

  while (cursorParentId) {
    if (cursorParentId === categoryId) {
      throw new ModerationCatalogError(
        400,
        'Нельзя назначить дочернюю категорию родителем для ее предка'
      )
    }

    const currentParent: { parentId: string | null } | null =
      await prisma.catalogCategory.findUnique({
      where: { id: cursorParentId },
      select: { parentId: true },
      })

    if (!currentParent) {
      break
    }

    cursorParentId = currentParent.parentId
  }
}

function normalizeCategoryName(name: unknown) {
  const normalizedName = typeof name === 'string' ? name.trim() : ''

  if (!normalizedName) {
    throw new ModerationCatalogError(400, 'Название категории обязательно')
  }

  return normalizedName
}

export async function createModerationCatalogCategory(input: {
  name: unknown
  code?: unknown
  section?: unknown
  sortOrder?: unknown
  isTagActive?: unknown
  showInQuickFilters?: unknown
  isHidden?: unknown
  parentId?: unknown
}) {
  const name = normalizeCategoryName(input.name)
  const code = normalizeCategoryCode(input.code)
  const sectionInput = normalizeCategorySection(input.section)
  const sortOrderInput = normalizeCategorySortOrder(input.sortOrder)
  const isTagActive = normalizeCategoryTagActivity(input.isTagActive) ?? true
  const showInQuickFilters =
    normalizeCategoryTagActivity(input.showInQuickFilters) ?? false
  const isHidden = normalizeCategoryHiddenFlag(input.isHidden) ?? false
  const parentId =
    typeof input.parentId === 'string' && input.parentId.trim()
      ? input.parentId
      : null

  const parentCategory = await ensureCategoryParent(parentId)
  await ensureCategoryDepthLimit({
    nextParentId: parentId,
  })

  const section =
    parentCategory?.section ??
    sectionInput ??
    inferRootCategorySection(name)
  const sortOrder =
    sortOrderInput ?? (await resolveNextCategorySortOrder(parentId))

  try {
    const createdCategory = await prisma.$transaction(async (tx) => {
      const category = await tx.catalogCategory.create({
        data: {
          name,
          code: code ?? null,
          section,
          sortOrder,
          isTagActive,
          showInQuickFilters,
          isHidden,
          parentId,
        },
      })

      await rebuildCatalogCategoryPaths(tx)

      return category
    })

    return await getSerializedModerationCatalogCategoryOrThrow(createdCategory.id)
  } catch (error: any) {
    if (error?.code === 'P2002') {
      throw new ModerationCatalogError(
        409,
        'Категория с таким названием уже существует на этом уровне'
      )
    }

    throw error
  }
}

export async function updateModerationCatalogCategory(
  categoryId: string,
  input: {
    name?: unknown
    code?: unknown
    section?: unknown
    sortOrder?: unknown
    isTagActive?: unknown
    showInQuickFilters?: unknown
    isHidden?: unknown
    parentId?: unknown
  }
) {
  const existingCategory = await prisma.catalogCategory.findUnique({
    where: { id: categoryId },
    select: {
      id: true,
      name: true,
      code: true,
      section: true,
      sortOrder: true,
      isTagActive: true,
      showInQuickFilters: true,
      isHidden: true,
      parentId: true,
    },
  })

  if (!existingCategory) {
    throw new ModerationCatalogError(404, 'Категория не найдена')
  }

  const nextName =
    input.name === undefined ? existingCategory.name : normalizeCategoryName(input.name)
  const nextCode =
    input.code === undefined ? existingCategory.code : normalizeCategoryCode(input.code)
  const nextSectionInput = normalizeCategorySection(input.section)
  const nextSortOrderInput = normalizeCategorySortOrder(input.sortOrder)
  const nextIsTagActive =
    input.isTagActive === undefined
      ? existingCategory.isTagActive
      : (normalizeCategoryTagActivity(input.isTagActive) ??
          existingCategory.isTagActive)
  const nextShowInQuickFilters =
    input.showInQuickFilters === undefined
      ? existingCategory.showInQuickFilters
      : (normalizeCategoryTagActivity(input.showInQuickFilters) ??
          existingCategory.showInQuickFilters)
  const nextIsHidden =
    input.isHidden === undefined
      ? existingCategory.isHidden
      : normalizeCategoryHiddenFlag(input.isHidden)
  const nextParentId =
    input.parentId === undefined
      ? existingCategory.parentId
      : typeof input.parentId === 'string' && input.parentId.trim()
        ? input.parentId
        : null

  if (nextParentId === categoryId) {
    throw new ModerationCatalogError(400, 'Категория не может быть родителем самой себе')
  }

  const parentCategory = await ensureCategoryParent(nextParentId)
  await ensureNoCategoryCycle({
    categoryId,
    nextParentId,
  })
  await ensureCategoryDepthLimit({
    categoryId,
    nextParentId,
  })

  const treeNodes = await listCatalogCategoryTreeNodes()
  const childrenMap = buildCategoryChildrenMap(treeNodes)
  const nextSection =
    parentCategory?.section ?? nextSectionInput ?? existingCategory.section
  const nextSortOrder =
    nextSortOrderInput ??
    (nextParentId !== existingCategory.parentId
      ? await resolveNextCategorySortOrder(nextParentId, categoryId)
      : existingCategory.sortOrder)
  const shouldCascadeSection = nextSection !== existingCategory.section
  const descendantIds = shouldCascadeSection
    ? collectCategorySubtreeIds(categoryId, childrenMap).filter((id) => id !== categoryId)
    : []

  try {
    const updatedCategory = await prisma.$transaction(async (tx) => {
      const nextCategory = await tx.catalogCategory.update({
        where: { id: categoryId },
        data: {
          name: nextName,
          code: nextCode,
          section: nextSection,
          sortOrder: nextSortOrder,
          isTagActive: nextIsTagActive,
          showInQuickFilters: nextShowInQuickFilters,
          isHidden: nextIsHidden,
          parentId: nextParentId,
        },
      })

      if (shouldCascadeSection && descendantIds.length > 0) {
        await tx.catalogCategory.updateMany({
          where: {
            id: {
              in: descendantIds,
            },
          },
          data: {
            section: nextSection,
          },
        })
      }

      if (nextParentId !== existingCategory.parentId) {
        await rebuildCatalogCategoryPaths(tx)
      }

      return nextCategory
    })

    return await getSerializedModerationCatalogCategoryOrThrow(updatedCategory.id)
  } catch (error: any) {
    if (error?.code === 'P2002') {
      throw new ModerationCatalogError(
        409,
        'Категория с таким названием уже существует на этом уровне'
      )
    }

    throw error
  }
}

export async function updateModerationCatalogCategoriesBulk(input: {
  categoryIds?: unknown
  isTagActive?: unknown
  showInQuickFilters?: unknown
}) {
  if (!Array.isArray(input.categoryIds)) {
    throw new ModerationCatalogError(400, 'Category ids must be an array')
  }

  const categoryIds = Array.from(
    new Set(
      input.categoryIds
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
    )
  )

  if (categoryIds.length === 0) {
    throw new ModerationCatalogError(400, 'Category ids are required')
  }

  const data: {
    isTagActive?: boolean
    showInQuickFilters?: boolean
  } = {}

  if (input.isTagActive !== undefined) {
    data.isTagActive = normalizeCategoryTagActivity(input.isTagActive)
  }

  if (input.showInQuickFilters !== undefined) {
    data.showInQuickFilters = normalizeCategoryTagActivity(input.showInQuickFilters)
  }

  if (
    data.isTagActive === undefined &&
    data.showInQuickFilters === undefined
  ) {
    throw new ModerationCatalogError(400, 'No category flags provided')
  }

  const existingCategories = await prisma.catalogCategory.findMany({
    where: {
      id: {
        in: categoryIds,
      },
    },
    select: {
      id: true,
    },
  })
  const existingIds = new Set(existingCategories.map((category) => category.id))
  const missingIds = categoryIds.filter((categoryId) => !existingIds.has(categoryId))

  if (missingIds.length > 0) {
    throw new ModerationCatalogError(404, 'Category not found')
  }

  const updateResult = await prisma.catalogCategory.updateMany({
    where: {
      id: {
        in: categoryIds,
      },
    },
    data,
  })

  const updatedIds = new Set(categoryIds)
  const categories = (await listModerationCatalogCategoryRecords()).filter((category) =>
    updatedIds.has(category.id)
  )

  return {
    ok: true,
    updatedCount: updateResult.count,
    categories,
  }
}

export async function deleteModerationCatalogCategory(categoryId: string) {
  const category = await prisma.catalogCategory.findUnique({
    where: { id: categoryId },
    include: {
      _count: {
        select: {
          children: true,
          products: true,
        },
      },
    },
  })

  if (!category) {
    throw new ModerationCatalogError(404, 'Категория не найдена')
  }

  if (category._count.children > 0) {
    throw new ModerationCatalogError(
      409,
      'Нельзя удалить категорию, у которой есть дочерние категории'
    )
  }

  if (category._count.products > 0) {
    throw new ModerationCatalogError(
      409,
      'Нельзя удалить категорию, к которой привязаны товары'
    )
  }

  await prisma.catalogCategory.delete({
    where: { id: categoryId },
  })

  return {
    ok: true,
  }
}

function toModerationCatalogCategoryMappingDto(mapping: {
  id: string
  supplierId: string | null
  supplier: { id: string; name: string } | null
  rawCategory: string
  normalizedRawCategory: string
  catalogCategoryId: string
  catalogCategory: {
    id: string
    code: string | null
    name: string
    parentId: string | null
  }
  createdAt: Date
  updatedAt: Date
}) {
  const source = mapping.supplierId
    ? 'EXACT_SUPPLIER_MAPPING'
    : 'GLOBAL_MAPPING'

  return {
    id: mapping.id,
    supplierId: mapping.supplierId,
    supplier: mapping.supplier,
    rawCategory: mapping.rawCategory,
    normalizedRawCategory: mapping.normalizedRawCategory,
    catalogCategoryId: mapping.catalogCategoryId,
    catalogCategory: mapping.catalogCategory,
    source,
    confidence: mapping.supplierId ? 1 : 0.98,
    reason: mapping.supplierId
      ? 'Точный mapping категории для поставщика.'
      : 'Глобальный mapping категории.',
    createdAt: mapping.createdAt,
    updatedAt: mapping.updatedAt,
  }
}

export async function getModerationCatalogCategoryMappings(input?: {
  supplierId?: string
}) {
  const mappings = await prisma.catalogCategoryMapping.findMany({
    where:
      input?.supplierId
        ? {
            supplierId: input.supplierId,
          }
        : undefined,
    orderBy: [
      { updatedAt: 'desc' },
      { createdAt: 'desc' },
    ],
    include: {
      supplier: {
        select: {
          id: true,
          name: true,
        },
      },
      catalogCategory: {
        select: {
          id: true,
          code: true,
          name: true,
          parentId: true,
        },
      },
    },
  })

  return mappings.map(toModerationCatalogCategoryMappingDto)
}

function parseNameDictionaryKind(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ModerationCatalogError(400, 'Dictionary kind is required')
  }

  const normalizedValue = value.trim().toUpperCase()
  if (!Object.values(NameDictionaryKind).includes(normalizedValue as NameDictionaryKind)) {
    throw new ModerationCatalogError(400, 'Dictionary kind is invalid')
  }

  return normalizedValue as NameDictionaryKind
}

function parseOptionalNameDictionaryKind(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined
  return parseNameDictionaryKind(value)
}

function parseNameTranslationSource(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') {
    throw new ModerationCatalogError(400, 'Translation source is invalid')
  }

  const normalizedValue = value.trim().toUpperCase()
  if (!Object.values(NameTranslationSource).includes(normalizedValue as NameTranslationSource)) {
    throw new ModerationCatalogError(400, 'Translation source is invalid')
  }

  return normalizedValue as NameTranslationSource
}

function parseNameDictionaryPayload(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ModerationCatalogError(400, 'payloadJson must be an object')
  }

  return value as Prisma.InputJsonObject
}

function parseNameDictionaryPriority(value: unknown, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    throw new ModerationCatalogError(400, 'priority must be a number')
  }

  return Math.trunc(parsed)
}

function parseOptionalBooleanValue(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalizedValue = value.trim().toLowerCase()
    if (normalizedValue === 'true') return true
    if (normalizedValue === 'false') return false
  }

  throw new ModerationCatalogError(400, 'Boolean value is invalid')
}

function serializeNameDictionaryEntry(entry: {
  id: string
  kind: NameDictionaryKind
  pattern: string
  normalizedPattern: string
  payloadJson: Prisma.JsonValue
  priority: number
  isActive: boolean
  createdByUserId: string | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: entry.id,
    kind: entry.kind,
    pattern: entry.pattern,
    normalizedPattern: entry.normalizedPattern,
    payloadJson: entry.payloadJson,
    priority: entry.priority,
    isActive: entry.isActive,
    createdByUserId: entry.createdByUserId,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}

export async function getModerationCatalogNameDictionary(query: Record<string, unknown>) {
  const kind = parseOptionalNameDictionaryKind(query.kind)
  const isActive = parseOptionalBooleanValue(query.isActive)
  const search = typeof query.q === 'string' && query.q.trim() ? query.q.trim() : null
  const limit = parsePaginationValue(query.limit, 100, 500)
  const offset = parsePaginationValue(query.offset, 0, 100_000)

  const where: Prisma.CatalogNameDictionaryEntryWhereInput = {
    ...(kind ? { kind } : {}),
    ...(isActive !== undefined ? { isActive } : {}),
    ...(search
      ? {
          OR: [
            { pattern: { contains: search, mode: Prisma.QueryMode.insensitive } },
            { normalizedPattern: { contains: normalizeText(search) ?? search, mode: Prisma.QueryMode.insensitive } },
          ],
        }
      : {}),
  }

  const [items, total] = await Promise.all([
    prisma.catalogNameDictionaryEntry.findMany({
      where,
      orderBy: [{ kind: 'asc' }, { priority: 'desc' }, { normalizedPattern: 'asc' }],
      skip: offset,
      take: limit,
    }),
    prisma.catalogNameDictionaryEntry.count({ where }),
  ])

  return {
    ok: true,
    items: items.map(serializeNameDictionaryEntry),
    total,
    limit,
    offset,
  }
}

export async function createModerationCatalogNameDictionaryEntry(input: {
  kind?: unknown
  pattern?: unknown
  normalizedPattern?: unknown
  payloadJson?: unknown
  priority?: unknown
  isActive?: unknown
  createdByUserId?: unknown
}) {
  const kind = parseNameDictionaryKind(input.kind)
  const pattern = typeof input.pattern === 'string' ? input.pattern.trim() : ''
  if (!pattern) {
    throw new ModerationCatalogError(400, 'pattern is required')
  }

  const normalizedPattern =
    (typeof input.normalizedPattern === 'string' && normalizeText(input.normalizedPattern)) ||
    normalizeText(pattern)

  if (!normalizedPattern) {
    throw new ModerationCatalogError(400, 'normalizedPattern is required')
  }

  try {
    const entry = await prisma.catalogNameDictionaryEntry.create({
      data: {
        kind,
        pattern,
        normalizedPattern,
        payloadJson: parseNameDictionaryPayload(input.payloadJson),
        priority: parseNameDictionaryPriority(input.priority),
        isActive: parseOptionalBooleanValue(input.isActive) ?? true,
        createdByUserId:
          typeof input.createdByUserId === 'string' && input.createdByUserId.trim()
            ? input.createdByUserId.trim()
            : null,
      },
    })
    clearNameDictionariesCache()
    return serializeNameDictionaryEntry(entry)
  } catch (error: any) {
    if (error?.code === 'P2002') {
      throw new ModerationCatalogError(409, 'Dictionary entry already exists')
    }
    throw error
  }
}

export async function updateModerationCatalogNameDictionaryEntry(
  id: string,
  input: {
    kind?: unknown
    pattern?: unknown
    normalizedPattern?: unknown
    payloadJson?: unknown
    priority?: unknown
    isActive?: unknown
  },
) {
  const existing = await prisma.catalogNameDictionaryEntry.findUnique({
    where: { id },
  })
  if (!existing) {
    throw new ModerationCatalogError(404, 'Dictionary entry not found')
  }

  const nextPattern =
    input.pattern === undefined
      ? existing.pattern
      : typeof input.pattern === 'string' && input.pattern.trim()
        ? input.pattern.trim()
        : ''
  if (!nextPattern) {
    throw new ModerationCatalogError(400, 'pattern is required')
  }

  const normalizedPatternInput =
    input.normalizedPattern === undefined
      ? existing.normalizedPattern
      : typeof input.normalizedPattern === 'string'
        ? normalizeText(input.normalizedPattern)
        : null
  const nextNormalizedPattern = normalizedPatternInput || normalizeText(nextPattern)
  if (!nextNormalizedPattern) {
    throw new ModerationCatalogError(400, 'normalizedPattern is required')
  }

  try {
    const entry = await prisma.catalogNameDictionaryEntry.update({
      where: { id },
      data: {
        kind: input.kind === undefined ? existing.kind : parseNameDictionaryKind(input.kind),
        pattern: nextPattern,
        normalizedPattern: nextNormalizedPattern,
        payloadJson:
          input.payloadJson === undefined
            ? undefined
            : parseNameDictionaryPayload(input.payloadJson),
        priority:
          input.priority === undefined
            ? undefined
            : parseNameDictionaryPriority(input.priority, existing.priority),
        isActive:
          input.isActive === undefined
            ? undefined
            : parseOptionalBooleanValue(input.isActive),
      },
    })
    clearNameDictionariesCache()
    return serializeNameDictionaryEntry(entry)
  } catch (error: any) {
    if (error?.code === 'P2002') {
      throw new ModerationCatalogError(409, 'Dictionary entry already exists')
    }
    throw error
  }
}

export async function deleteModerationCatalogNameDictionaryEntry(id: string) {
  const existing = await prisma.catalogNameDictionaryEntry.findUnique({
    where: { id },
    select: { id: true },
  })
  if (!existing) {
    throw new ModerationCatalogError(404, 'Dictionary entry not found')
  }

  await prisma.catalogNameDictionaryEntry.delete({ where: { id } })
  clearNameDictionariesCache()
  return { ok: true }
}

function jsonRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function payloadStringValue(payload: Record<string, unknown>, key: string) {
  const value = payload[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function payloadNumberValue(payload: Record<string, unknown>, key: string) {
  const value = payload[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export async function getModerationCatalogNameTranslations(query: Record<string, unknown>) {
  const source = parseNameTranslationSource(query.source)
  const search = typeof query.q === 'string' && query.q.trim() ? query.q.trim() : null
  const includeConfirmed = query.includeConfirmed === 'true' || query.status === 'all'
  const limit = parsePaginationValue(query.limit, 100, 500)
  const offset = parsePaginationValue(query.offset, 0, 100_000)

  const translationWhere: Prisma.ProductNameTranslationWhereInput = {
    ...(source ? { source } : {}),
    ...(search
      ? {
          OR: [
            { ruName: { contains: search, mode: Prisma.QueryMode.insensitive } },
            { enName: { contains: search, mode: Prisma.QueryMode.insensitive } },
            { normalizedRu: { contains: normalizeText(search) ?? search, mode: Prisma.QueryMode.insensitive } },
          ],
        }
      : {}),
  }

  const [translations, translationTotal, reviewRows] = await Promise.all([
    includeConfirmed
      ? prisma.productNameTranslation.findMany({
          where: translationWhere,
          orderBy: [{ confirmedAt: 'desc' }, { updatedAt: 'desc' }],
          skip: offset,
          take: limit,
        })
      : Promise.resolve([]),
    includeConfirmed
      ? prisma.productNameTranslation.count({ where: translationWhere })
      : Promise.resolve(0),
    prisma.supplierPriceImportRow.findMany({
      where: {
        validationStatus: 'NEEDS_REVIEW',
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: Math.min(limit * 3, 500),
    }),
  ])

  const queueItems = reviewRows
    .map((row) => {
      const payload = jsonRecord(row.normalizedPayload)
      const productPayload = jsonRecord(payload.product as Prisma.JsonValue | null | undefined)
      const nameParts = jsonRecord(productPayload.nameParts as Prisma.JsonValue | null | undefined)
      const ruName =
        payloadStringValue(nameParts, 'ruName') ||
        payloadStringValue(productPayload, 'name') ||
        payloadStringValue(productPayload, 'displayName')
      const enName =
        payloadStringValue(productPayload, 'translatedName') ||
        payloadStringValue(nameParts, 'enName')
      const enSource = payloadStringValue(nameParts, 'enSource')
      const enConfidence = payloadNumberValue(nameParts, 'enConfidence')

      if (!ruName || !enName || !enSource) return null
      if (source && enSource !== source && !(source !== NameTranslationSource.GENERATED && enSource === 'TRANSLATION_MEMORY')) {
        return null
      }
      if (
        search &&
        !`${ruName} ${enName}`.toLowerCase().includes(search.toLowerCase())
      ) {
        return null
      }

      return {
        type: 'IMPORT_ROW',
        importId: row.importId,
        rowId: row.id,
        rawName: row.rawName,
        ruName,
        enName,
        enSource,
        enConfidence,
        normalizedRu: normalizeText(ruName),
        updatedAt: row.updatedAt,
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(offset, offset + limit)

  return {
    ok: true,
    queue: queueItems,
    translations: translations.map((translation) => ({
      id: translation.id,
      normalizedRu: translation.normalizedRu,
      ruName: translation.ruName,
      enName: translation.enName,
      source: translation.source,
      confidence: Number(translation.confidence),
      confirmedAt: translation.confirmedAt,
      createdAt: translation.createdAt,
      updatedAt: translation.updatedAt,
    })),
    total: queueItems.length + translationTotal,
    translationsTotal: translationTotal,
    limit,
    offset,
  }
}

export async function createModerationCatalogCategoryMapping(input: {
  supplierId?: unknown
  rawCategory: unknown
  catalogCategoryId: unknown
}) {
  const supplierId =
    typeof input.supplierId === 'string' && input.supplierId.trim()
      ? input.supplierId.trim()
      : null
  const rawCategory = typeof input.rawCategory === 'string' ? input.rawCategory.trim() : ''
  const normalizedRawCategory = normalizeRawCategory(rawCategory)
  const catalogCategoryId =
    typeof input.catalogCategoryId === 'string' && input.catalogCategoryId.trim()
      ? input.catalogCategoryId.trim()
      : ''

  if (!normalizedRawCategory) {
    throw new ModerationCatalogError(400, 'Raw category is required')
  }

  if (!catalogCategoryId) {
    throw new ModerationCatalogError(400, 'Catalog category is required')
  }

  if (supplierId) {
    await ensureSupplierExists(supplierId)
  }
  await ensureCatalogCategoryExists(catalogCategoryId)

  const existingMapping = await prisma.catalogCategoryMapping.findFirst({
    where: {
      supplierId,
      normalizedRawCategory,
    },
    select: { id: true },
  })

  if (existingMapping) {
    throw new ModerationCatalogError(
      409,
      supplierId
        ? 'Mapping for this supplier and raw category already exists'
        : 'Global mapping for this raw category already exists'
    )
  }

  const mapping = await prisma.catalogCategoryMapping.create({
    data: {
      supplierId,
      rawCategory,
      normalizedRawCategory,
      catalogCategoryId,
    },
    include: {
      supplier: {
        select: {
          id: true,
          name: true,
        },
      },
      catalogCategory: {
        select: {
          id: true,
          code: true,
          name: true,
          parentId: true,
        },
      },
    },
  })

  return toModerationCatalogCategoryMappingDto(mapping)
}

export async function updateModerationCatalogCategoryMapping(
  mappingId: string,
  input: {
    supplierId?: unknown
    rawCategory?: unknown
    catalogCategoryId?: unknown
  }
) {
  const existingMapping = await prisma.catalogCategoryMapping.findUnique({
    where: { id: mappingId },
    select: {
      id: true,
      supplierId: true,
      rawCategory: true,
      normalizedRawCategory: true,
      catalogCategoryId: true,
    },
  })

  if (!existingMapping) {
    throw new ModerationCatalogError(404, 'Mapping not found')
  }

  const nextSupplierId =
    input.supplierId === undefined
      ? existingMapping.supplierId
      : typeof input.supplierId === 'string' && input.supplierId.trim()
        ? input.supplierId.trim()
        : null
  const nextRawCategory =
    input.rawCategory === undefined
      ? existingMapping.rawCategory
      : typeof input.rawCategory === 'string'
        ? input.rawCategory.trim()
        : ''
  const nextNormalizedRawCategory = normalizeRawCategory(nextRawCategory)
  const nextCatalogCategoryId =
    input.catalogCategoryId === undefined
      ? existingMapping.catalogCategoryId
      : typeof input.catalogCategoryId === 'string' && input.catalogCategoryId.trim()
        ? input.catalogCategoryId.trim()
        : ''

  if (!nextNormalizedRawCategory) {
    throw new ModerationCatalogError(400, 'Raw category is required')
  }

  if (!nextCatalogCategoryId) {
    throw new ModerationCatalogError(400, 'Catalog category is required')
  }

  if (nextSupplierId) {
    await ensureSupplierExists(nextSupplierId)
  }
  await ensureCatalogCategoryExists(nextCatalogCategoryId)

  const conflictingMapping = await prisma.catalogCategoryMapping.findFirst({
    where: {
      id: {
        not: mappingId,
      },
      supplierId: nextSupplierId,
      normalizedRawCategory: nextNormalizedRawCategory,
    },
    select: { id: true },
  })

  if (conflictingMapping) {
    throw new ModerationCatalogError(
      409,
      nextSupplierId
        ? 'Mapping for this supplier and raw category already exists'
        : 'Global mapping for this raw category already exists'
    )
  }

  const mapping = await prisma.catalogCategoryMapping.update({
    where: { id: mappingId },
    data: {
      supplierId: nextSupplierId,
      rawCategory: nextRawCategory,
      normalizedRawCategory: nextNormalizedRawCategory,
      catalogCategoryId: nextCatalogCategoryId,
    },
    include: {
      supplier: {
        select: {
          id: true,
          name: true,
        },
      },
      catalogCategory: {
        select: {
          id: true,
          code: true,
          name: true,
          parentId: true,
        },
      },
    },
  })

  return toModerationCatalogCategoryMappingDto(mapping)
}

export async function deleteModerationCatalogCategoryMapping(mappingId: string) {
  const existingMapping = await prisma.catalogCategoryMapping.findUnique({
    where: { id: mappingId },
    select: { id: true },
  })

  if (!existingMapping) {
    throw new ModerationCatalogError(404, 'Mapping not found')
  }

  await prisma.catalogCategoryMapping.delete({
    where: { id: mappingId },
  })

  return {
    ok: true,
  }
}

export async function updateModerationCatalogProductCategory(
  productId: string,
  input: {
    categoryId?: unknown
  }
) {
  const product = await ensureProductExists(productId)

  const nextCategoryId =
    input.categoryId === null || input.categoryId === undefined
      ? null
      : typeof input.categoryId === 'string' && input.categoryId.trim()
        ? input.categoryId.trim()
        : null

  if (nextCategoryId) {
    await ensureCatalogCategoryExists(nextCategoryId)
  }

  const updatedProduct = await prisma.product.update({
    where: { id: productId },
    data: {
      categoryId: nextCategoryId,
    },
    select: {
      id: true,
      name: true,
      categoryId: true,
      rawCategory: true,
      category: {
        select: {
          id: true,
          code: true,
          name: true,
          parentId: true,
        },
      },
    },
  })

  if (nextCategoryId && product.rawCategory) {
    await prisma.supplierPriceImportRow.updateMany({
      where: {
        mappedProductId: productId,
        rawCategory: product.rawCategory,
        mappingStatus: PriceImportRowMappingStatus.UNMATCHED,
      },
      data: {
        mappingStatus: PriceImportRowMappingStatus.MANUAL_MATCHED,
        errorText: null,
      },
    })
  }

  return updatedProduct
}

function buildModerationFileUrl(storageKey: string | null | undefined) {
  if (!storageKey) return null
  const normalizedKey = storageKey
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^uploads\//, '')

  return `/uploads/${normalizedKey}`
}

function formatModerationProductVolume(
  volume: Prisma.Decimal | number | null,
  unit: string | null
) {
  if (volume === null || volume === undefined) return null
  const numericVolume = typeof volume === 'number' ? volume : Number(volume)
  if (!Number.isFinite(numericVolume)) return null
  const normalizedUnit = (unit || '').trim().toLowerCase()

  if (normalizedUnit === 'ml' || normalizedUnit === '\u043c\u043b') {
    return `${Number((numericVolume / 1000).toFixed(3))} \u043b`
  }

  if (normalizedUnit === 'l' || normalizedUnit === '\u043b') {
    return `${Number(numericVolume.toFixed(3))} \u043b`
  }

  return `${Number(numericVolume.toFixed(3))}${unit ? ` ${unit}` : ''}`
}

function normalizeModerationVolumeForDisplay(
  volume: Prisma.Decimal | number | null | undefined,
  unit: string | null | undefined
) {
  if (volume === null || volume === undefined) {
    return { volume: null, volumeUnit: null }
  }

  const numericVolume = typeof volume === 'number' ? volume : Number(volume)
  if (!Number.isFinite(numericVolume)) {
    return { volume: null, volumeUnit: null }
  }

  const normalizedUnit = (unit || '').trim().toLowerCase()
  if (normalizedUnit === 'ml' || normalizedUnit === 'мл') {
    return {
      volume: Number((numericVolume / 1000).toFixed(3)),
      volumeUnit: 'л',
    }
  }

  if (normalizedUnit === 'l' || normalizedUnit === 'л') {
    return {
      volume: Number(numericVolume.toFixed(3)),
      volumeUnit: 'л',
    }
  }

  const normalizedVolume = numericVolume >= 20 ? numericVolume / 1000 : numericVolume
  return {
    volume: Number(normalizedVolume.toFixed(3)),
    volumeUnit: 'л',
  }
}

function parseModerationProductVolume(value: unknown) {
  if (value === undefined) return undefined
  if (value === null || value === '') return { value: null, unit: null }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return {
      value: new Prisma.Decimal((value <= 20 ? value * 1000 : value).toFixed(3)),
      unit: 'ml',
    }
  }

  if (typeof value !== 'string') {
    throw new ModerationCatalogError(400, 'Volume is invalid')
  }

  const normalizedValue = value.trim().replace(',', '.').toLowerCase()
  const match = normalizedValue.match(/^(\d+(?:\.\d+)?)\s*(л|l|мл|ml)?$/i)
  if (!match) {
    throw new ModerationCatalogError(400, 'Volume must look like "0.75 л" or "750 мл"')
  }

  const numericValue = Number(match[1])
  const unit = match[2] || (numericValue <= 20 ? 'л' : 'мл')
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    throw new ModerationCatalogError(400, 'Volume is invalid')
  }

  const isLiter = unit === 'л' || unit === 'l'
  return {
    value: new Prisma.Decimal((isLiter ? numericValue * 1000 : numericValue).toFixed(3)),
    unit: 'ml',
  }
}

function parseNullableTextField(value: unknown, fieldName: string) {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') {
    throw new ModerationCatalogError(400, `${fieldName} must be a string`)
  }

  return value.trim() || null
}

function parseBooleanField(value: unknown, fieldName: string) {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    throw new ModerationCatalogError(400, `${fieldName} must be boolean`)
  }

  return value
}

function parseNumberField(value: unknown, fieldName: string) {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(',', '.')) : Number.NaN
  if (!Number.isFinite(parsed)) {
    throw new ModerationCatalogError(400, `${fieldName} must be a number`)
  }

  return parsed
}

function parseAttributesJsonField(value: unknown, fieldName: string) {
  if (value === undefined) return undefined
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ModerationCatalogError(400, `${fieldName} must be an object or null`)
  }

  return value as Prisma.InputJsonObject
}

function serializeAttributesJson(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function normalizeStringListAttribute(value: unknown) {
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

function parseStringListInput(value: unknown, fieldName: string) {
  if (value === undefined) return undefined
  if (value === null) return []
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item !== 'string') {
        throw new ModerationCatalogError(400, `${fieldName} must contain strings`)
      }
      return item.trim()
    }).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean)
  }

  throw new ModerationCatalogError(400, `${fieldName} is invalid`)
}

function getPackagingOptionsFromAttributes(attributesJson: Prisma.JsonValue | null) {
  return normalizeStringListAttribute(serializeAttributesJson(attributesJson)?.packagingOptions)
}

function getPackagingTypeFromProduct(product: {
  attributesJson?: Prisma.JsonValue | null
  variants?: Array<{ packagingType: string | null; isDefault?: boolean; updatedAt?: Date }>
}) {
  const defaultVariant = product.variants?.find((variant) => variant.isDefault) ?? product.variants?.[0] ?? null
  const attrValue = serializeAttributesJson(product.attributesJson ?? null)?.packagingType
  return defaultVariant?.packagingType ?? (typeof attrValue === 'string' && attrValue.trim() ? attrValue.trim() : null)
}

function normalizeCatalogProductStatus(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') {
    throw new ModerationCatalogError(400, 'Product status is invalid')
  }
  const normalizedValue = value.trim().toUpperCase()
  if (!Object.values(ProductCatalogStatus).includes(normalizedValue as ProductCatalogStatus)) {
    throw new ModerationCatalogError(400, 'Product status is invalid')
  }

  return normalizedValue as ProductCatalogStatus
}

function getCatalogProductIssueWhere(productId: string): Prisma.CatalogValidationIssueWhereInput {
  return {
    status: PriceImportIssueStatus.OPEN,
    OR: [
      { productId },
      {
        supplierProduct: {
          productId,
        },
      },
    ],
  }
}

function getModerationCatalogProductPublicVisibility(product: {
  status: ProductCatalogStatus
  isConfirmed: boolean
  isHidden: boolean
  mergedIntoProductId: string | null
  categoryId: string | null
  category: { isHidden: boolean; isTagActive: boolean } | null
  supplierProducts: Array<{
    supplier?: { isActive: boolean } | null
    offers: Array<{
      isCurrent: boolean
      isAvailable: boolean
      missingFromLatestPrice: boolean
    }>
  }>
}): ModerationCatalogProductPublicVisibilityDto {
  const reasons: ModerationCatalogProductPublicVisibilityReason[] = []

  if (product.status !== ProductCatalogStatus.CONFIRMED || !product.isConfirmed) {
    reasons.push('NOT_CONFIRMED')
  }

  if (product.isHidden) {
    reasons.push('PRODUCT_HIDDEN')
  }

  if (product.mergedIntoProductId) {
    reasons.push('MERGED')
  }

  if (!product.categoryId || !product.category) {
    reasons.push('NO_CATEGORY')
  } else {
    if (product.category.isHidden) {
      reasons.push('CATEGORY_HIDDEN')
    }
    if (!product.category.isTagActive) {
      reasons.push('CATEGORY_INACTIVE')
    }
  }

  const hasSupplierProducts = product.supplierProducts.length > 0
  const hasActiveSupplier = product.supplierProducts.some(
    (supplierProduct) => supplierProduct.supplier?.isActive
  )
  const hasActiveSupplierOffer = product.supplierProducts.some(
    (supplierProduct) =>
      supplierProduct.supplier?.isActive &&
      supplierProduct.offers.some(
        (offer) =>
          offer.isCurrent &&
          offer.isAvailable
      )
  )

  if (hasSupplierProducts && !hasActiveSupplier) {
    reasons.push('SUPPLIER_INACTIVE')
  }

  if (!hasActiveSupplierOffer) {
    reasons.push('NO_ACTIVE_SUPPLIER_OFFER')
  }

  return {
    isVisibleInPublicCatalog: reasons.length === 0,
    reasons,
  }
}

async function serializeModerationCatalogProductListItem(product: {
  id: string
  publicId: string
  name: string
  translatedName: string | null
  article: string | null
  barcode: string | null
  description: string | null
  attributesJson: Prisma.JsonValue | null
  packageVolume: Prisma.Decimal | null
  packageVolumeUnit: string | null
  status: ProductCatalogStatus
  isConfirmed: boolean
  isHidden: boolean
  mergedIntoProductId: string | null
  categoryId: string | null
  updatedAt: Date
  category: { id: string; name: string; isHidden: boolean; isTagActive: boolean } | null
  mainImage: { id: string; fileName: string; storageKey: string } | null
  variants: Array<{ packagingType: string | null; isDefault: boolean; updatedAt: Date }>
  supplierProducts: Array<{
    supplierId: string
    supplier: { isActive: boolean }
    offers: Array<{
      id: string
      isCurrent: boolean
      isAvailable: boolean
      missingFromLatestPrice: boolean
    }>
  }>
  sponsoredPlacements: Array<{ id: string }>
}) {
  const supplierIds = new Set(product.supplierProducts.map((supplierProduct) => supplierProduct.supplierId))
  const activeOffersCount = product.supplierProducts.reduce(
    (count, supplierProduct) => count + supplierProduct.offers.length,
    0
  )
  const issuesCount = await prisma.catalogValidationIssue.count({
    where: getCatalogProductIssueWhere(product.id),
  })

  return {
    id: product.id,
    publicId: product.publicId,
    tableId: product.publicId,
    category: product.category
      ? {
          id: product.category.id,
          name: product.category.name,
        }
      : null,
    article: product.article,
    barcode: product.barcode,
    canonicalName: product.name,
    russianName: product.translatedName,
    volume: formatModerationProductVolume(product.packageVolume, product.packageVolumeUnit),
    packagingType: getPackagingTypeFromProduct(product),
    packagingOptions: getPackagingOptionsFromAttributes(product.attributesJson),
    description: product.description,
    imageUrl: buildModerationFileUrl(product.mainImage?.storageKey),
    image: product.mainImage
      ? {
          id: product.mainImage.id,
          fileName: product.mainImage.fileName,
          url: buildModerationFileUrl(product.mainImage.storageKey) || '',
        }
      : null,
    hasImage: Boolean(product.mainImage),
    suppliersCount: supplierIds.size,
    activeOffersCount,
    promoCount: product.sponsoredPlacements.length,
    status: product.status,
    publicVisibility: getModerationCatalogProductPublicVisibility(product),
    issuesCount,
    conflictsCount: issuesCount,
    updatedAt: product.updatedAt.toISOString(),
  }
}

function buildModerationCatalogProductsWhere(query: Record<string, unknown>): Prisma.ProductWhereInput {
  const searchQuery = typeof query.query === 'string' ? query.query.trim() : ''
  const categoryId = typeof query.categoryId === 'string' && query.categoryId.trim()
    ? query.categoryId.trim()
    : null
  const supplierId = typeof query.supplierId === 'string' && query.supplierId.trim()
    ? query.supplierId.trim()
    : null
  const status = normalizeCatalogProductStatus(query.status)
  const hasIssues = parseOptionalBooleanQuery(query.hasIssues)
  const hasImage = parseOptionalBooleanQuery(query.hasImage)
  const hasOffers = parseOptionalBooleanQuery(query.hasOffers)
  const where: Prisma.ProductWhereInput = {}
  const andConditions: Prisma.ProductWhereInput[] = []

  if (searchQuery) {
    andConditions.push({
      OR: [
        { name: { contains: searchQuery, mode: 'insensitive' } },
        { translatedName: { contains: searchQuery, mode: 'insensitive' } },
        { article: { contains: searchQuery, mode: 'insensitive' } },
        { barcode: { contains: searchQuery, mode: 'insensitive' } },
        { brand: { contains: searchQuery, mode: 'insensitive' } },
        { producer: { contains: searchQuery, mode: 'insensitive' } },
        { variants: { some: { packagingType: { contains: searchQuery, mode: 'insensitive' } } } },
        { attributesJson: { path: ['packagingType'], string_contains: searchQuery } },
        { attributesJson: { path: ['packagingOptions'], array_contains: [searchQuery] } },
      ],
    })
  }

  if (categoryId) {
    andConditions.push({ categoryId })
  }

  if (status) {
    andConditions.push({ status })
  }

  if (supplierId) {
    andConditions.push({
      supplierProducts: {
        some: {
          supplierId,
        },
      },
    })
  }

  if (hasImage !== undefined) {
    andConditions.push(hasImage ? { mainImageFileId: { not: null } } : { mainImageFileId: null })
  }

  if (hasOffers !== undefined) {
    andConditions.push({
      supplierProducts: {
        some: {
          offers: hasOffers
            ? { some: { isCurrent: true } }
            : { none: { isCurrent: true } },
        },
      },
    })
  }

  if (hasIssues !== undefined) {
    const issuesWhere: Prisma.ProductWhereInput = {
      OR: [
        { catalogValidationIssues: { some: { status: PriceImportIssueStatus.OPEN } } },
        {
          supplierProducts: {
            some: {
              catalogValidationIssues: {
                some: { status: PriceImportIssueStatus.OPEN },
              },
            },
          },
        },
      ],
    }
    andConditions.push(hasIssues ? issuesWhere : { NOT: issuesWhere })
  }

  if (andConditions.length) {
    where.AND = andConditions
  }

  return where
}

function parseOptionalBooleanQuery(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalizedValue = value.trim().toLowerCase()
    if (normalizedValue === 'true' || normalizedValue === '1') return true
    if (normalizedValue === 'false' || normalizedValue === '0') return false
  }

  throw new ModerationCatalogError(400, 'Boolean query parameter is invalid')
}

function parsePaginationValue(value: unknown, fallback: number, max: number) {
  const parsed = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : fallback
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return Math.min(Math.floor(parsed), max)
}

function buildModerationCatalogProductOrderBy(sort: unknown): Prisma.ProductOrderByWithRelationInput[] {
  const normalizedSort = typeof sort === 'string' ? sort.trim() : ''
  if (normalizedSort === 'name' || normalizedSort === 'canonicalName') return [{ name: 'asc' }]
  if (normalizedSort === '-name' || normalizedSort === '-canonicalName') return [{ name: 'desc' }]
  if (normalizedSort === 'category') return [{ category: { name: 'asc' } }, { name: 'asc' }]
  if (normalizedSort === '-category') return [{ category: { name: 'desc' } }, { name: 'asc' }]
  if (normalizedSort === 'volume') return [{ packageVolume: 'asc' }, { name: 'asc' }]
  if (normalizedSort === '-volume') return [{ packageVolume: 'desc' }, { name: 'asc' }]
  if (normalizedSort === 'updatedAt') return [{ updatedAt: 'asc' }]
  if (normalizedSort === '-updatedAt' || !normalizedSort) return [{ updatedAt: 'desc' }]
  if (normalizedSort === 'status') return [{ status: 'asc' }, { updatedAt: 'desc' }]
  if (normalizedSort === '-status') return [{ status: 'desc' }, { updatedAt: 'desc' }]

  throw new ModerationCatalogError(400, 'Unsupported product sort')
}

function parseModerationCatalogProductDtoSort(sort: unknown) {
  const normalizedSort = typeof sort === 'string' ? sort.trim() : ''
  const direction = normalizedSort.startsWith('-') ? 'desc' : 'asc'
  const key = normalizedSort.replace(/^-/, '')
  const dtoSortKeys = new Set([
    'category',
    'canonicalName',
    'name',
    'volume',
    'hasImage',
    'status',
    'suppliersCount',
    'promoCount',
    'conflictsCount',
    'updatedAt',
  ])

  return dtoSortKeys.has(key) ? { sort: key === 'name' ? 'canonicalName' : key, sortDirection: direction } : null
}

function isModerationCatalogProductDtoOnlySort(sort: unknown) {
  const parsed = parseModerationCatalogProductDtoSort(sort)
  if (!parsed) return false
  return ['hasImage', 'suppliersCount', 'promoCount', 'conflictsCount'].includes(String(parsed.sort))
}

export async function getModerationCatalogProducts(
  query: Record<string, unknown>
): Promise<ModerationCatalogProductsResponseDto> {
  const offset = parsePaginationValue(query.offset, 0, 100000)
  const limit = parsePaginationValue(query.limit, 50, 200)
  const categoryId = typeof query.categoryId === 'string' && query.categoryId.trim()
    ? query.categoryId.trim()
    : undefined
  let selectedFacets: ReturnType<typeof parseFacetSelectionFromQuery>
  try {
    selectedFacets = parseFacetSelectionFromQuery(query)
  } catch (error) {
    if (error instanceof FacetQueryError) {
      throw new ModerationCatalogError(400, error.message)
    }
    throw error
  }
  const facetProductWhere = await buildCatalogFacetProductWhere({
    scope: FacetScope.ADMIN_CATALOG,
    categoryId,
    selectedFacets,
  })
  const where: Prisma.ProductWhereInput = {
    AND: [buildModerationCatalogProductsWhere(query), facetProductWhere],
  }
  const dtoSort = parseModerationCatalogProductDtoSort(query.sort)
  const useDtoSort = isModerationCatalogProductDtoOnlySort(query.sort)
  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: useDtoSort
        ? buildModerationCatalogProductOrderBy(undefined)
        : buildModerationCatalogProductOrderBy(query.sort),
      skip: useDtoSort ? undefined : offset,
      take: useDtoSort ? undefined : limit,
      include: {
        category: {
          select: {
            id: true,
            name: true,
            isHidden: true,
            isTagActive: true,
          },
        },
        mainImage: {
          select: {
            id: true,
            fileName: true,
            storageKey: true,
          },
        },
        variants: {
          orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
          select: {
            packagingType: true,
            isDefault: true,
            updatedAt: true,
          },
        },
        supplierProducts: {
          select: {
            supplierId: true,
            supplier: {
              select: {
                isActive: true,
              },
            },
            offers: {
              where: { isCurrent: true },
              select: {
                id: true,
                isCurrent: true,
                isAvailable: true,
                missingFromLatestPrice: true,
              },
            },
          },
        },
        sponsoredPlacements: {
          where: {
            isActive: true,
          },
          select: {
            id: true,
          },
        },
      },
    }),
  ])

  if (useDtoSort && dtoSort) {
    const serializedItems = await Promise.all(products.map(serializeModerationCatalogProductListItem))
    const sortedItems = sortModerationDtoList(serializedItems, dtoSort, {
      hasImage: { type: 'boolean', accessor: (product) => product.hasImage },
      suppliersCount: { type: 'number', accessor: (product) => product.suppliersCount },
      promoCount: { type: 'number', accessor: (product) => product.promoCount },
      conflictsCount: { type: 'number', accessor: (product) => product.conflictsCount },
    })

    return {
      items: sortedItems.slice(offset, offset + limit),
      total,
      offset,
      limit,
    }
  }

  return {
    items: await Promise.all(products.map(serializeModerationCatalogProductListItem)),
    total,
    offset,
    limit,
  }
}

export async function getModerationCatalogFacetOptions(query: Record<string, unknown>) {
  const categoryId = typeof query.categoryId === 'string' && query.categoryId.trim()
    ? query.categoryId.trim()
    : undefined
  const search = typeof query.query === 'string' && query.query.trim()
    ? query.query.trim()
    : undefined

  let selectedFacets: ReturnType<typeof parseFacetSelectionFromQuery>
  try {
    selectedFacets = parseFacetSelectionFromQuery(query)
  } catch (error) {
    if (error instanceof FacetQueryError) {
      throw new ModerationCatalogError(400, error.message)
    }
    throw error
  }

  const legacyFilterQuery = { ...query }
  delete legacyFilterQuery.categoryId
  delete legacyFilterQuery.query
  delete legacyFilterQuery.facets
  for (const key of Object.keys(legacyFilterQuery)) {
    if (key.startsWith('facet.')) delete legacyFilterQuery[key]
  }

  return getCatalogFacets({
    scope: FacetScope.ADMIN_CATALOG,
    categoryId,
    search,
    selectedFacets,
    productWhere: buildModerationCatalogProductsWhere(legacyFilterQuery),
  })
}

export async function suggestModerationCatalogProducts(
  query: Record<string, unknown>
) {
  const searchQuery = typeof query.query === 'string' ? query.query.trim() : ''
  if (searchQuery.length < 2) {
    return { items: [] }
  }

  const products = await prisma.product.findMany({
    where: {
      OR: [
        { name: { contains: searchQuery, mode: 'insensitive' } },
        { translatedName: { contains: searchQuery, mode: 'insensitive' } },
        { article: { contains: searchQuery, mode: 'insensitive' } },
        { barcode: { contains: searchQuery, mode: 'insensitive' } },
        { brand: { contains: searchQuery, mode: 'insensitive' } },
        { producer: { contains: searchQuery, mode: 'insensitive' } },
        { variants: { some: { packagingType: { contains: searchQuery, mode: 'insensitive' } } } },
        { attributesJson: { path: ['packagingType'], string_contains: searchQuery } },
        { attributesJson: { path: ['packagingOptions'], array_contains: [searchQuery] } },
      ],
    },
    orderBy: [{ updatedAt: 'desc' }],
    take: normalizeSuggestionLimit(query.limit, 5, 5),
    select: {
      id: true,
      publicId: true,
      name: true,
      translatedName: true,
      category: {
        select: {
          name: true,
        },
      },
    },
  })

  return {
    items: products.map((product) => ({
      id: product.id,
      publicId: product.publicId,
      label: product.name,
      secondaryLabel: product.translatedName || product.category?.name || null,
    })),
  }
}

function joinExportValues(values: Array<string | null | undefined>) {
  const normalizedValues = values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)

  return normalizedValues.length ? [...new Set(normalizedValues)].join('; ') : null
}

function formatExportDate(value: Date | null | undefined) {
  return value ? value.toISOString() : null
}

export async function exportModerationCatalogProductsXlsx() {
  const products = await prisma.product.findMany({
    orderBy: [{ name: 'asc' }, { updatedAt: 'desc' }],
    include: {
      category: {
        select: {
          id: true,
          name: true,
          code: true,
          isHidden: true,
          isTagActive: true,
        },
      },
      variants: {
        orderBy: { isDefault: 'desc' },
        select: {
          volume: true,
          volumeUnit: true,
          packageSize: true,
          packageSizeUnit: true,
          isDefault: true,
        },
      },
      supplierProducts: {
        include: {
          supplier: {
            select: {
              publicId: true,
              name: true,
              catalogName: true,
              isActive: true,
            },
          },
          offers: {
            where: { isCurrent: true },
            select: {
              price: true,
              effectivePrice: true,
              currency: true,
              stockAvailable: true,
              availabilityLevel: true,
              updatedAt: true,
            },
          },
        },
      },
    },
  })

  const rows = products.map((product) => {
    const currentOffers = product.supplierProducts.flatMap((supplierProduct) =>
      supplierProduct.offers.map((offer) => ({
        ...offer,
        supplierName:
          supplierProduct.supplier.catalogName ||
          supplierProduct.supplier.name ||
          supplierProduct.supplier.publicId,
      }))
    )
    const prices = currentOffers
      .map((offer) => Number(offer.effectivePrice ?? offer.price))
      .filter((price) => Number.isFinite(price))
    const stockTotal = currentOffers.reduce((total, offer) => {
      const stock = decimalToNumber(offer.stockAvailable)
      return total + (stock ?? 0)
    }, 0)
    const defaultVariant = product.variants.find((variant) => variant.isDefault) ?? product.variants[0] ?? null
    const exportVolume = normalizeModerationVolumeForDisplay(
      product.packageVolume ?? defaultVariant?.volume,
      product.packageVolumeUnit ?? defaultVariant?.volumeUnit,
    )

    return {
      'ID товара': product.publicId,
      'UUID товара': product.id,
      'Каноническое название': product.name,
      'Русское название': product.translatedName,
      'Категория': product.category?.name ?? null,
      'Код категории': product.category?.code ?? null,
      'Артикул': product.article,
      'Штрихкод': product.barcode,
      'Бренд': product.brand,
      'Производитель': product.producer,
      'Страна': product.country,
      'Регион': product.region,
      'Год': product.vintage ?? product.manufacturedYear,
      'Алкоголь, %': decimalToNumber(product.alcoholPercent),
      'Цвет': product.color,
      'Сахар': product.sugar,
      'Объём': exportVolume.volume,
      'Единица объёма': exportVolume.volumeUnit,
      'Размер упаковки': decimalToNumber(defaultVariant?.packageSize),
      'Единица упаковки': defaultVariant?.packageSizeUnit ?? null,
      'Описание': product.description,
      'Статус каталога': product.status,
      'Скрыт': product.isHidden ? 'Да' : 'Нет',
      'Подтверждён': product.isConfirmed ? 'Да' : 'Нет',
      'Поставщики': joinExportValues(currentOffers.map((offer) => offer.supplierName)),
      'Поставщиков': product.supplierProducts.length,
      'Активных предложений': currentOffers.length,
      'Минимальная цена': prices.length ? Math.min(...prices) : null,
      'Максимальная цена': prices.length ? Math.max(...prices) : null,
      'Валюты': joinExportValues(currentOffers.map((offer) => offer.currency)),
      'Остаток суммарно': currentOffers.length ? stockTotal : null,
      'Доступность': joinExportValues(currentOffers.map((offer) => offer.availabilityLevel)),
      'Создан': formatExportDate(product.createdAt),
      'Обновлён': formatExportDate(product.updatedAt),
    }
  })

  const worksheet = XLSX.utils.json_to_sheet(rows)
  worksheet['!cols'] = [
    { wch: 12 },
    { wch: 38 },
    { wch: 42 },
    { wch: 36 },
    { wch: 24 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 20 },
    { wch: 24 },
    { wch: 18 },
    { wch: 18 },
    { wch: 10 },
    { wch: 12 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 14 },
    { wch: 16 },
    { wch: 18 },
    { wch: 44 },
    { wch: 18 },
  ]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Catalog')

  const buffer = XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
  }) as Buffer
  const datePart = new Date().toISOString().slice(0, 10)

  return {
    buffer,
    fileName: `barello-canonical-catalog-${datePart}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }
}

async function getModerationCategoryPath(categoryId: string | null) {
  if (!categoryId) return []

  const pathItems: Array<{ id: string; name: string }> = []
  let currentCategoryId: string | null = categoryId
  const visited = new Set<string>()

  while (currentCategoryId && !visited.has(currentCategoryId)) {
    visited.add(currentCategoryId)
    const category: { id: string; name: string; parentId: string | null } | null =
      await prisma.catalogCategory.findUnique({
      where: { id: currentCategoryId },
      select: { id: true, name: true, parentId: true },
    })

    if (!category) break
    pathItems.unshift({ id: category.id, name: category.name })
    currentCategoryId = category.parentId
  }

  return pathItems
}

function buildProductCardAttribute(params: {
  key: string
  label: string
  group: string
  value: unknown
  facetKeys?: string[]
}) {
  return {
    key: params.key,
    label: params.label,
    group: params.group,
    value: params.value ?? null,
    source: params.value === null || params.value === undefined ? null : 'PIPELINE' as const,
    locked: false,
    facetKeys: params.facetKeys ?? [],
  }
}

function getProductCardAttributes(product: {
  article: string | null
  barcode: string | null
  name: string
  translatedName: string | null
  description: string | null
  brand: string | null
  producer: string | null
  manufacturer: string | null
  country: string | null
  region: string | null
  vintage: number | null
  manufacturedYear: number | null
  alcoholPercent: Prisma.Decimal | null
  color: string | null
  sugar: string | null
  grapeSorts: Prisma.JsonValue | null
  attributesJson: Prisma.JsonValue | null
  packageVolume: Prisma.Decimal | null
  packageVolumeUnit: string | null
  variants?: Array<{ packagingType: string | null; isDefault?: boolean; updatedAt?: Date }>
}) {
  const packagingType = getPackagingTypeFromProduct(product)
  const packagingOptions = getPackagingOptionsFromAttributes(product.attributesJson)
  const baseAttributes = [
    buildProductCardAttribute({
      key: 'article',
      label: 'Артикул',
      group: 'Идентификация',
      value: product.article,
    }),
    buildProductCardAttribute({
      key: 'barcode',
      label: 'Штрихкод',
      group: 'Идентификация',
      value: product.barcode,
    }),
    buildProductCardAttribute({
      key: 'name',
      label: 'Каноническое название',
      group: 'Названия',
      value: product.name,
      facetKeys: ['search'],
    }),
    buildProductCardAttribute({
      key: 'translatedName',
      label: 'Русское название',
      group: 'Названия',
      value: product.translatedName,
      facetKeys: ['search'],
    }),
    buildProductCardAttribute({
      key: 'description',
      label: 'Описание',
      group: 'Названия',
      value: product.description,
    }),
    buildProductCardAttribute({
      key: 'brand',
      label: 'Бренд',
      group: 'Происхождение',
      value: product.brand,
      facetKeys: ['brand'],
    }),
    buildProductCardAttribute({
      key: 'producer',
      label: 'Производитель',
      group: 'Происхождение',
      value: product.producer ?? product.manufacturer,
      facetKeys: ['producer'],
    }),
    buildProductCardAttribute({
      key: 'country',
      label: 'Страна',
      group: 'Происхождение',
      value: product.country,
      facetKeys: ['country'],
    }),
    buildProductCardAttribute({
      key: 'region',
      label: 'Регион',
      group: 'Происхождение',
      value: product.region,
      facetKeys: ['region'],
    }),
    buildProductCardAttribute({
      key: 'vintage',
      label: 'Год',
      group: 'Характеристики',
      value: product.vintage ?? product.manufacturedYear,
      facetKeys: ['vintage'],
    }),
    buildProductCardAttribute({
      key: 'alcoholPercent',
      label: 'Алкоголь, %',
      group: 'Характеристики',
      value: decimalToNumber(product.alcoholPercent),
      facetKeys: ['alcoholPercent'],
    }),
    buildProductCardAttribute({
      key: 'color',
      label: 'Цвет',
      group: 'Характеристики',
      value: product.color,
      facetKeys: ['color'],
    }),
    buildProductCardAttribute({
      key: 'sugar',
      label: 'Сахар',
      group: 'Характеристики',
      value: product.sugar,
      facetKeys: ['sugar'],
    }),
    buildProductCardAttribute({
      key: 'grapeSorts',
      label: 'Сорта винограда',
      group: 'Характеристики',
      value: product.grapeSorts,
      facetKeys: ['grapeSorts'],
    }),
    buildProductCardAttribute({
      key: 'packageVolume',
      label: 'Объём',
      group: 'Упаковка',
      value: formatModerationProductVolume(product.packageVolume, product.packageVolumeUnit),
      facetKeys: ['volume'],
    }),
    buildProductCardAttribute({
      key: 'packagingType',
      label: 'Тип упаковки',
      group: 'Упаковка',
      value: packagingType,
      facetKeys: ['packaging_type'],
    }),
    buildProductCardAttribute({
      key: 'packagingOptions',
      label: 'Опции упаковки',
      group: 'Упаковка',
      value: packagingOptions,
      facetKeys: ['packaging_options'],
    }),
  ]
  const existingKeys = new Set(baseAttributes.map((attribute) => attribute.key))
  const extraAttributes = Object.entries(serializeAttributesJson(product.attributesJson) ?? {})
    .filter(([key]) => !existingKeys.has(key))
    .map(([key, value]) =>
      buildProductCardAttribute({
        key,
        label: key,
        group: 'Attributes',
        value,
        facetKeys: [key],
      })
    )

  return [...baseAttributes, ...extraAttributes]
}

function getProductCardCompleteness(product: {
  name: string
  translatedName: string | null
  categoryId: string | null
  barcode: string | null
  brand: string | null
  producer: string | null
  manufacturer: string | null
  country: string | null
  packageVolume: Prisma.Decimal | null
  attributesJson: Prisma.JsonValue | null
  variants?: Array<{ packagingType: string | null; isDefault?: boolean; updatedAt?: Date }>
  mainImageFileId: string | null
}) {
  const packagingType = getPackagingTypeFromProduct(product)
  const packagingOptions = getPackagingOptionsFromAttributes(product.attributesJson)
  const checks = [
    { key: 'category', label: 'Категория', filled: Boolean(product.categoryId) },
    { key: 'name', label: 'Каноническое название', filled: Boolean(product.name?.trim()) },
    { key: 'translatedName', label: 'Русское название', filled: Boolean(product.translatedName?.trim()) },
    { key: 'barcode', label: 'Штрихкод', filled: Boolean(product.barcode?.trim()) },
    { key: 'brand', label: 'Бренд', filled: Boolean(product.brand?.trim()) },
    { key: 'producer', label: 'Производитель', filled: Boolean(product.producer?.trim() || product.manufacturer?.trim()) },
    { key: 'country', label: 'Страна', filled: Boolean(product.country?.trim()) },
    { key: 'volume', label: 'Объём', filled: Boolean(product.packageVolume) },
    { key: 'image', label: 'Изображение', filled: Boolean(product.mainImageFileId) },
  ]
  checks.splice(checks.length - 1, 0,
    { key: 'packagingType', label: 'Тип упаковки', filled: Boolean(packagingType) },
    { key: 'packagingOptions', label: 'Опции упаковки', filled: packagingOptions.length > 0 },
  )
  const filledCount = checks.filter((check) => check.filled).length

  return {
    percent: Math.round((filledCount / checks.length) * 100),
    missingFacetFields: checks
      .filter((check) => !check.filled)
      .map((check) => check.label),
  }
}

function getProductCardStatusReasons(params: {
  status: ProductCatalogStatus
  completeness: { missingFacetFields: string[] }
  openIssues: Array<{ severity: PriceImportIssueSeverity }>
  hasOffers: boolean
}) {
  const reasons: string[] = []
  const hasBlockingIssue = params.openIssues.some(
    (issue) => issue.severity === PriceImportIssueSeverity.ERROR || issue.severity === PriceImportIssueSeverity.CRITICAL
  )

  if (params.completeness.missingFacetFields.length) {
    reasons.push(`Не заполнены поля: ${params.completeness.missingFacetFields.join(', ')}`)
  }
  if (hasBlockingIssue) {
    reasons.push('Есть открытые блокирующие конфликты')
  }
  if (!params.hasOffers) {
    reasons.push('Нет активных предложений поставщиков')
  }
  if (params.status === ProductCatalogStatus.HIDDEN) {
    reasons.push('Товар скрыт из каталога')
  }
  if (params.status === ProductCatalogStatus.MERGED) {
    reasons.push('Товар объединён с другой карточкой')
  }

  return reasons
}

function mapProductCardIssue(issue: {
  id: string
  type: string
  severity: PriceImportIssueSeverity
  status: PriceImportIssueStatus
  fieldName: string | null
  message: string
  sourceValue: Prisma.JsonValue | null
  catalogValue: Prisma.JsonValue | null
  suggestedAction: string | null
}) {
  return {
    id: issue.id,
    type: issue.type,
    severity: issue.severity,
    status: issue.status,
    fieldName: issue.fieldName,
    message: issue.message,
    sourceValue: issue.sourceValue,
    catalogValue: issue.catalogValue,
    suggestedAction: issue.suggestedAction,
  }
}

function mapProductCardImage(fileAsset: {
  id: string
  fileName: string
  storageKey: string
} | null | undefined) {
  if (!fileAsset) return null

  return {
    id: fileAsset.id,
    fileName: fileAsset.fileName,
    url: buildModerationFileUrl(fileAsset.storageKey) || '',
  }
}

function mapProductCardVideo(fileAsset: {
  id: string
  fileName: string
  storageKey: string
  mimeType: string
} | null | undefined) {
  if (!fileAsset) return null

  return {
    id: fileAsset.id,
    fileName: fileAsset.fileName,
    mimeType: fileAsset.mimeType,
    url: buildModerationFileUrl(fileAsset.storageKey) || '',
  }
}

const PRODUCT_FIELD_LABELS: Record<string, string> = {
  name: 'Каноническое название',
  translatedName: 'Русское название',
  description: 'Описание',
  article: 'Артикул',
  barcode: 'Штрихкод',
  brand: 'Бренд',
  producer: 'Производитель',
  manufacturer: 'Производитель',
  country: 'Страна',
  region: 'Регион',
  vintage: 'Год',
  alcoholPercent: 'Алкоголь, %',
  color: 'Цвет',
  sugar: 'Сахар',
  grapeSorts: 'Сорта винограда',
  packageVolume: 'Объём',
  packageVolumeUnit: 'Единица объёма',
  categoryId: 'Категория',
  mainImageFileId: 'Основное изображение',
  status: 'Статус',
  isHidden: 'Скрыт',
  isConfirmed: 'Подтвержден',
  mergedIntoProductId: 'Объединен с товаром',
}

function normalizeAuditValue(value: unknown) {
  if (value instanceof Prisma.Decimal) return Number(value)
  if (value instanceof Date) return value.toISOString()
  return value
}

function getProductAuditSnapshot(product: Record<string, unknown>) {
  const snapshot: Record<string, unknown> = {
    name: product.name,
    translatedName: product.translatedName ?? null,
    description: product.description ?? null,
    article: product.article ?? null,
    barcode: product.barcode ?? null,
    brand: product.brand ?? null,
    producer: product.producer ?? null,
    manufacturer: product.manufacturer ?? null,
    country: product.country ?? null,
    region: product.region ?? null,
    vintage: product.vintage ?? null,
    alcoholPercent: normalizeAuditValue(product.alcoholPercent),
    color: product.color ?? null,
    sugar: product.sugar ?? null,
    grapeSorts: product.grapeSorts ?? null,
    packageVolume: normalizeAuditValue(product.packageVolume),
    packageVolumeUnit: product.packageVolumeUnit ?? null,
    categoryId: product.categoryId ?? null,
    mainImageFileId: product.mainImageFileId ?? null,
    status: product.status,
    isHidden: product.isHidden,
    isConfirmed: product.isConfirmed,
    mergedIntoProductId: product.mergedIntoProductId ?? null,
  }
  if ('attributesJson' in product) {
    snapshot.attributesJson = product.attributesJson ?? null
  }

  return snapshot
}

async function getProductAuditRecord(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
      translatedName: true,
      description: true,
      article: true,
      barcode: true,
      brand: true,
      producer: true,
      manufacturer: true,
      country: true,
      region: true,
      vintage: true,
      alcoholPercent: true,
      color: true,
      sugar: true,
      grapeSorts: true,
      packageVolume: true,
      packageVolumeUnit: true,
      categoryId: true,
      mainImageFileId: true,
      status: true,
      isConfirmed: true,
      isHidden: true,
      mergedIntoProductId: true,
      attributesJson: true,
    },
  })

  if (!product) throw new ModerationCatalogError(404, 'Product not found')
  return product
}

function buildAuditChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>
) {
  return Object.keys(after)
    .filter((field) => JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null))
    .map((field) => ({
      field,
      label: PRODUCT_FIELD_LABELS[field] ?? field,
      before: before[field] ?? null,
      after: after[field] ?? null,
    }))
}

async function writeProductAuditLog(
  productId: string,
  action: string,
  payload: Prisma.InputJsonValue
) {
  await prisma.auditLog.create({
    data: {
      actorType: AuditActorType.SYSTEM,
      entityType: 'PRODUCT',
      entityId: productId,
      action,
      payload,
    },
  })
}

function buildProductFieldOverrides(auditLogs: Array<{
  payload: Prisma.JsonValue | null
  createdAt: Date
}>) {
  const overrides = new Map<string, {
    field: string
    label: string
    value: unknown
    updatedAt: string
    source: 'MODERATOR'
  }>()

  for (const auditLog of auditLogs) {
    const payload = auditLog.payload
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue
    const changes = (payload as { changes?: unknown }).changes
    if (!Array.isArray(changes)) continue

    for (const change of changes) {
      if (!change || typeof change !== 'object' || Array.isArray(change)) continue
      const field = typeof (change as { field?: unknown }).field === 'string'
        ? (change as { field: string }).field
        : ''
      if (!field || overrides.has(field)) continue

      overrides.set(field, {
        field,
        label: PRODUCT_FIELD_LABELS[field] ?? field,
        value: (change as { after?: unknown }).after ?? null,
        updatedAt: auditLog.createdAt.toISOString(),
        source: 'MODERATOR',
      })
    }
  }

  return Array.from(overrides.values())
}

function mapProductAuditLog(auditLog: {
  id: string
  action: string
  payload: Prisma.JsonValue | null
  createdAt: Date
}) {
  const payload = auditLog.payload && typeof auditLog.payload === 'object' && !Array.isArray(auditLog.payload)
    ? auditLog.payload as { changes?: unknown }
    : null
  const changes = Array.isArray(payload?.changes) ? payload.changes : []
  const firstChange = changes.find((change) => change && typeof change === 'object' && !Array.isArray(change)) as
    | { field?: string; before?: unknown; after?: unknown }
    | undefined

  return {
    id: auditLog.id,
    at: auditLog.createdAt.toISOString(),
    actor: 'Админпанель',
    action: auditLog.action,
    field: firstChange?.field,
    before: firstChange?.before,
    after: firstChange?.after,
  }
}

export async function getModerationCatalogProductCard(
  productId: string
): Promise<ModerationProductCardDto | null> {
  const product = await prisma.product.findUnique({
    where: externalIdWhere(productId, '0'),
    include: {
      category: {
        select: {
          id: true,
          name: true,
          code: true,
          section: true,
          isHidden: true,
          isTagActive: true,
        },
      },
      mainImage: {
        select: {
          id: true,
          fileName: true,
          storageKey: true,
        },
      },
      variants: {
        orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
        include: {
          supplierProducts: {
            include: {
              offers: {
                where: { isCurrent: true },
                select: {
                  id: true,
                  effectivePrice: true,
                  price: true,
                  currency: true,
                },
              },
            },
          },
        },
      },
      supplierProducts: {
        include: {
          supplier: {
            select: {
              id: true,
              publicId: true,
              name: true,
              catalogName: true,
              isActive: true,
            },
          },
          productVariant: {
            select: {
              id: true,
            },
          },
          aliases: {
            include: {
              supplier: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
            orderBy: { updatedAt: 'desc' },
          },
          offers: {
            where: { isCurrent: true },
            orderBy: [{ updatedAt: 'desc' }],
          },
        },
        orderBy: { updatedAt: 'desc' },
      },
      catalogValidationIssues: {
        where: { status: PriceImportIssueStatus.OPEN },
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      },
      importImageMatches: {
        where: {
          status: {
            in: [
              SupplierImportImageMatchStatus.PENDING,
              SupplierImportImageMatchStatus.MATCHED,
              SupplierImportImageMatchStatus.CONFIRMED,
            ],
          },
        },
        include: {
          fileAsset: {
            select: {
              id: true,
              fileName: true,
              storageKey: true,
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: 12,
      },
      mediaAssets: {
        include: {
          fileAsset: {
            select: {
              id: true,
              fileName: true,
              storageKey: true,
              mimeType: true,
              type: true,
            },
          },
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      },
      mergedProducts: {
        select: {
          id: true,
          publicId: true,
          name: true,
        },
        take: 10,
      },
      favoriteByUsers: {
        select: { id: true },
      },
    },
  })

  if (!product) return null

  const supplierProductIds = product.supplierProducts.map((supplierProduct) => supplierProduct.id)
  const offerIds = product.supplierProducts.flatMap((supplierProduct) =>
    supplierProduct.offers.map((offer) => offer.id)
  )
  const relatedIssueConditions: Prisma.CatalogValidationIssueWhereInput[] = [
    ...(supplierProductIds.length ? [{ supplierProductId: { in: supplierProductIds } }] : []),
    ...(offerIds.length ? [{ offerId: { in: offerIds } }] : []),
  ]
  const duplicateConditions: Prisma.ProductWhereInput[] = [
    ...(product.barcode ? [{ barcode: product.barcode }] : []),
    { name: { equals: product.name, mode: Prisma.QueryMode.insensitive } },
    ...(product.translatedName
      ? [{ translatedName: { equals: product.translatedName, mode: Prisma.QueryMode.insensitive } }]
      : []),
  ]
  const [categoryPath, relatedIssues, duplicateProducts, auditLogs] = await Promise.all([
    getModerationCategoryPath(product.categoryId),
    relatedIssueConditions.length
      ? prisma.catalogValidationIssue.findMany({
          where: {
            status: PriceImportIssueStatus.OPEN,
            OR: relatedIssueConditions,
          },
          orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        })
      : Promise.resolve([]),
    prisma.product.findMany({
      where: {
        id: { not: product.id },
        OR: duplicateConditions,
      },
      select: {
        id: true,
        publicId: true,
        name: true,
        barcode: true,
      },
      take: 10,
    }),
    prisma.auditLog.findMany({
      where: {
        entityType: 'PRODUCT',
        entityId: product.id,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        action: true,
        payload: true,
        createdAt: true,
      },
    }),
  ])
  const openIssues = [...product.catalogValidationIssues, ...relatedIssues]
  const attributes = getProductCardAttributes(product)
  const completeness = getProductCardCompleteness(product)
  const offers = product.supplierProducts.flatMap((supplierProduct) =>
    supplierProduct.offers.map((offer) => ({
      id: offer.id,
      variantId: supplierProduct.productVariant.id,
      supplier: {
        id: supplierProduct.supplier.id,
        publicId: supplierProduct.supplier.publicId,
        name: supplierProduct.supplier.catalogName || supplierProduct.supplier.name,
      },
      price: {
        amount: Number(offer.effectivePrice ?? offer.price),
        currency: offer.currency,
      },
      stockAvailable: decimalToNumber(offer.stockAvailable),
      status: offer.availabilityLevel,
      deliveryDaysMin: offer.deliveryDaysMin,
      deliveryDaysMax: offer.deliveryDaysMax,
      minOrderQty: decimalToNumber(offer.minOrderQty),
      packQty: decimalToNumber(offer.packQty),
      supplierSku: supplierProduct.supplierSku,
      updatedAt: offer.updatedAt.toISOString(),
      sourceImportId: offer.sourceImportId ?? supplierProduct.sourceImportId,
    }))
  )

  return {
    product: {
      id: product.id,
      publicId: product.publicId,
      status: product.status,
      statusReasons: getProductCardStatusReasons({
        status: product.status,
        completeness,
        openIssues,
        hasOffers: offers.length > 0,
      }),
      publicVisibility: getModerationCatalogProductPublicVisibility(product),
      completeness,
      name: product.name,
      translatedName: product.translatedName,
      originalName: product.rawCategory,
      category: product.category
        ? {
            id: product.category.id,
            name: product.category.name,
            code: product.category.code,
            section: product.category.section,
            path: categoryPath,
          }
        : null,
      attributes,
      attributesJson: serializeAttributesJson(product.attributesJson),
      fieldOverrides: buildProductFieldOverrides(auditLogs),
      features: [],
      description: product.description,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    },
    variants: product.variants.map((variant) => {
      const variantOffers = variant.supplierProducts.flatMap((supplierProduct) =>
        supplierProduct.offers.map((offer) => ({
          amount: Number(offer.effectivePrice ?? offer.price),
          currency: offer.currency,
        }))
      )
      const priceFrom = variantOffers.length
        ? variantOffers.reduce((lowest, current) =>
            current.amount < lowest.amount ? current : lowest
          )
        : null
      const variantVolume = normalizeModerationVolumeForDisplay(variant.volume, variant.volumeUnit)

      return {
        id: variant.id,
        volume: variantVolume.volume,
        volumeUnit: variantVolume.volumeUnit,
        packageSize: decimalToNumber(variant.packageSize),
        packageSizeUnit: variant.packageSizeUnit,
        packagingType: variant.packagingType,
        isDefault: variant.isDefault,
        offersCount: variantOffers.length,
        priceFrom,
      }
    }),
    offers,
    media: {
      main: mapProductCardImage(product.mainImage),
      gallery: [
        ...(product.mainImage ? [mapProductCardImage(product.mainImage)!] : []),
        ...product.mediaAssets
          .filter((mediaAsset) => mediaAsset.fileAsset.type === FileAssetType.IMAGE)
          .map((mediaAsset) => mapProductCardImage(mediaAsset.fileAsset))
          .filter((item): item is NonNullable<typeof item> => Boolean(item)),
      ].filter((image, index, images) =>
        images.findIndex((candidate) => candidate.id === image.id) === index
      ),
      videos: product.mediaAssets
        .filter((mediaAsset) => mediaAsset.fileAsset.type === FileAssetType.VIDEO)
        .map((mediaAsset) => mapProductCardVideo(mediaAsset.fileAsset))
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
      candidates: product.importImageMatches
        .map((match) => {
          const image = mapProductCardImage(match.fileAsset)
          if (!image) return null

          return {
            id: match.id,
            image,
            score: decimalToNumber(match.confidence),
            status: match.status,
            sourceImportId: match.importId,
          }
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    },
    issues: openIssues.map(mapProductCardIssue),
    duplicates: [
      ...product.mergedProducts.map((mergedProduct) => ({
        productId: mergedProduct.id,
        publicId: mergedProduct.publicId,
        name: mergedProduct.name,
        similarity: 100,
        differingFields: [],
      })),
      ...duplicateProducts.map((duplicateProduct) => ({
        productId: duplicateProduct.id,
        publicId: duplicateProduct.publicId,
        name: duplicateProduct.name,
        similarity: duplicateProduct.barcode && duplicateProduct.barcode === product.barcode ? 100 : 90,
        differingFields: [],
      })),
    ],
    aliases: product.supplierProducts.flatMap((supplierProduct) =>
      supplierProduct.aliases.map((alias) => ({
        id: alias.id,
        supplierId: alias.supplierId,
        supplierName: alias.supplier.name,
        type: alias.aliasType,
        value: alias.rawValue,
        confidence: decimalToNumber(alias.confidence),
      }))
    ),
    audit: auditLogs.map(mapProductAuditLog),
    analytics: {
      views: 0,
      favorites: product.favoriteByUsers.length,
      shipments: 0,
      repeatPurchases: 0,
      defects: 0,
      rating: null,
    },
  }
}

export async function getModerationCatalogProductDetail(
  productId: string
): Promise<ModerationCatalogProductDetailDto | null> {
  const product = await prisma.product.findUnique({
    where: externalIdWhere(productId, '0'),
    include: {
      category: {
        select: {
          id: true,
          name: true,
          code: true,
          isHidden: true,
          isTagActive: true,
        },
      },
      mainImage: {
        select: {
          id: true,
          fileName: true,
          storageKey: true,
        },
      },
      variants: {
        orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
        select: {
          packagingType: true,
          isDefault: true,
          updatedAt: true,
        },
      },
      supplierProducts: {
        include: {
          supplier: {
            select: { id: true, publicId: true, name: true, isActive: true },
          },
          aliases: {
            include: {
              supplier: {
                select: { id: true, publicId: true, name: true },
              },
            },
            orderBy: { updatedAt: 'desc' },
          },
          offers: {
            where: { isCurrent: true },
            orderBy: { updatedAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { updatedAt: 'desc' },
      },
      catalogValidationIssues: {
        where: { status: PriceImportIssueStatus.OPEN },
        orderBy: { createdAt: 'desc' },
      },
      favoriteByUsers: {
        select: { id: true },
      },
    },
  })

  if (!product) return null
  const packagingType = getPackagingTypeFromProduct(product)
  const packagingOptions = getPackagingOptionsFromAttributes(product.attributesJson)

  const supplierProductIds = product.supplierProducts.map((supplierProduct) => supplierProduct.id)
  const supplierProductIssues = supplierProductIds.length
    ? await prisma.catalogValidationIssue.findMany({
        where: {
          supplierProductId: { in: supplierProductIds },
          status: PriceImportIssueStatus.OPEN,
        },
        orderBy: { createdAt: 'desc' },
      })
    : []

  return {
    id: product.id,
    publicId: product.publicId,
    category: product.category
      ? {
          id: product.category.id,
          name: product.category.name,
          code: product.category.code,
        }
      : null,
    article: product.article,
    barcode: product.barcode,
    canonicalName: product.name,
    russianName: product.translatedName,
    description: product.description,
    image: product.mainImage
      ? {
          id: product.mainImage.id,
          fileName: product.mainImage.fileName,
          url: buildModerationFileUrl(product.mainImage.storageKey) || '',
        }
      : null,
    brand: product.brand,
    producer: product.producer,
    country: product.country,
    region: product.region,
    year: product.vintage ?? product.manufacturedYear,
    alcoholPercent: product.alcoholPercent ? Number(product.alcoholPercent) : null,
    volume: formatModerationProductVolume(product.packageVolume, product.packageVolumeUnit),
    packagingType,
    packagingOptions,
    attributesJson: serializeAttributesJson(product.attributesJson),
    suppliers: product.supplierProducts.map((supplierProduct) => {
      const currentOffer = supplierProduct.offers[0] ?? null
      const stockPayload = currentOffer?.stockPayload && typeof currentOffer.stockPayload === 'object' && !Array.isArray(currentOffer.stockPayload)
        ? currentOffer.stockPayload as Record<string, unknown>
        : {}
      const catalogAvailability =
        typeof stockPayload.catalogAvailability === 'string'
          ? stockPayload.catalogAvailability
          : currentOffer?.isAvailable
            ? 'ACTIVE'
            : currentOffer
              ? 'SOLD_OUT'
              : null

      return {
        supplierId: supplierProduct.supplier.id,
        supplierPublicId: supplierProduct.supplier.publicId,
        supplierName: supplierProduct.supplier.name,
        supplierSku: supplierProduct.supplierSku,
        price: currentOffer?.price ? Number(currentOffer.price) : null,
        stockAvailable: currentOffer?.stockAvailable ? Number(currentOffer.stockAvailable) : null,
        availability: catalogAvailability,
        sourceImportId: supplierProduct.sourceImportId ?? currentOffer?.sourceImportId ?? null,
      }
    }),
    aliases: product.supplierProducts.flatMap((supplierProduct) =>
      supplierProduct.aliases.map((alias) => ({
        id: alias.id,
        supplierId: alias.supplierId,
        supplierPublicId: alias.supplier.publicId,
        supplierName: alias.supplier.name,
        supplierProductId: alias.supplierProductId,
        aliasType: alias.aliasType,
        rawValue: alias.rawValue,
        normalizedValue: alias.normalizedValue,
        confidence: alias.confidence ? Number(alias.confidence) : null,
        isActive: alias.isActive,
      }))
    ),
    issues: [...product.catalogValidationIssues, ...supplierProductIssues].map((issue) => ({
      id: issue.id,
      type: issue.type,
      severity: issue.severity,
      status: issue.status,
      fieldName: issue.fieldName,
      message: issue.message,
      sourceValue: issue.sourceValue,
      catalogValue: issue.catalogValue,
      suggestedAction: issue.suggestedAction,
    })),
    analytics: {
      views: 0,
      favorites: product.favoriteByUsers.length,
      shipments: 0,
      repeatPurchases: 0,
      defects: 0,
      rating: null,
    },
    publicVisibility: getModerationCatalogProductPublicVisibility(product),
  }
}

export async function updateModerationCatalogProduct(
  productId: string,
  input: UpdateModerationCatalogProductDto
) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
      translatedName: true,
      description: true,
      article: true,
      barcode: true,
      brand: true,
      producer: true,
      manufacturer: true,
      country: true,
      region: true,
      vintage: true,
      alcoholPercent: true,
      color: true,
      sugar: true,
      grapeSorts: true,
      packageVolume: true,
      packageVolumeUnit: true,
      categoryId: true,
      mainImageFileId: true,
      status: true,
      isConfirmed: true,
      isHidden: true,
      mergedIntoProductId: true,
      attributesJson: true,
    },
  })

  if (!product) {
    throw new ModerationCatalogError(404, 'Product not found')
  }

  const data: Prisma.ProductUpdateInput = {}
  const canonicalName = parseNullableTextField(input.canonicalName, 'canonicalName')
  if (canonicalName !== undefined) {
    if (!canonicalName) {
      throw new ModerationCatalogError(400, 'canonicalName is required')
    }
    data.name = canonicalName
  }

  const russianName = parseNullableTextField(input.russianName, 'russianName')
  if (russianName !== undefined) data.translatedName = russianName

  const description = parseNullableTextField(input.description, 'description')
  if (description !== undefined) data.description = description

  const article = parseNullableTextField(input.article, 'article')
  if (article !== undefined) data.article = article

  const barcode = parseNullableTextField(input.barcode, 'barcode')
  if (barcode !== undefined) data.barcode = barcode

  const brand = parseNullableTextField(input.brand, 'brand')
  if (brand !== undefined) data.brand = brand

  const producer = parseNullableTextField(input.producer, 'producer')
  if (producer !== undefined) data.producer = producer

  const manufacturer = parseNullableTextField(input.manufacturer, 'manufacturer')
  if (manufacturer !== undefined) data.manufacturer = manufacturer

  const country = parseNullableTextField(input.country, 'country')
  if (country !== undefined) data.country = country

  const region = parseNullableTextField(input.region, 'region')
  if (region !== undefined) data.region = region

  const year = parseNumberField(input.year, 'year')
  if (year !== undefined) data.vintage = year === null ? null : Math.round(year)

  const alcoholPercent = parseNumberField(input.alcoholPercent, 'alcoholPercent')
  if (alcoholPercent !== undefined) {
    data.alcoholPercent = alcoholPercent === null
      ? null
      : new Prisma.Decimal(alcoholPercent.toFixed(2))
  }

  const color = parseNullableTextField(input.color, 'color')
  if (color !== undefined) data.color = color

  const sugar = parseNullableTextField(input.sugar, 'sugar')
  if (sugar !== undefined) data.sugar = sugar

  const grapeSorts = parseStringListInput(input.grapeSorts, 'grapeSorts')
  if (grapeSorts !== undefined) {
    data.grapeSorts = grapeSorts.length ? grapeSorts : Prisma.JsonNull
  }

  const volume = parseModerationProductVolume(input.volume)
  if (volume !== undefined) {
    data.packageVolume = volume.value
    data.packageVolumeUnit = volume.unit
  }

  const attributesJson = parseAttributesJsonField(input.attributesJson, 'attributesJson')
  const packagingType = parseNullableTextField(input.packagingType, 'packagingType')
  const packagingOptions = parseStringListInput(input.packagingOptions, 'packagingOptions')
  if (attributesJson !== undefined || packagingType !== undefined || packagingOptions !== undefined) {
    const nextAttributes: Record<string, unknown> =
      attributesJson === undefined
        ? { ...(serializeAttributesJson(product.attributesJson) ?? {}) }
        : attributesJson === null
          ? {}
          : { ...attributesJson }

    if (packagingType !== undefined) {
      if (packagingType) nextAttributes.packagingType = packagingType
      else delete nextAttributes.packagingType
    }
    if (packagingOptions !== undefined) {
      if (packagingOptions.length) nextAttributes.packagingOptions = packagingOptions
      else delete nextAttributes.packagingOptions
    }

    data.attributesJson = Object.keys(nextAttributes).length
      ? nextAttributes as Prisma.InputJsonObject
      : Prisma.JsonNull
  }

  if (input.categoryId !== undefined) {
    const categoryId =
      typeof input.categoryId === 'string' && input.categoryId.trim()
        ? input.categoryId.trim()
        : null
    if (categoryId) await ensureCatalogCategoryExists(categoryId)
    data.category = categoryId ? { connect: { id: categoryId } } : { disconnect: true }
  }

  if (input.imageFileId !== undefined) {
    const imageFileId =
      typeof input.imageFileId === 'string' && input.imageFileId.trim()
        ? input.imageFileId.trim()
        : null
    if (imageFileId) {
      const image = await prisma.fileAsset.findUnique({
        where: { id: imageFileId },
        select: { id: true },
      })
      if (!image) throw new ModerationCatalogError(404, 'Image file not found')
    }
    data.mainImage = imageFileId ? { connect: { id: imageFileId } } : { disconnect: true }
  }

  const isHidden = parseBooleanField(input.isHidden, 'isHidden')
  const isConfirmed = parseBooleanField(input.isConfirmed, 'isConfirmed')
  if (isHidden !== undefined) {
    data.isHidden = isHidden
    data.hiddenAt = isHidden ? new Date() : null
  }
  if (isConfirmed !== undefined) {
    data.isConfirmed = isConfirmed
    data.confirmedAt = isConfirmed ? new Date() : null
  }
  if (isHidden === true) {
    data.status = ProductCatalogStatus.HIDDEN
  } else if (isConfirmed === true) {
    data.status = ProductCatalogStatus.CONFIRMED
  } else if (isHidden === false || isConfirmed === false) {
    data.status = isConfirmed === false ? ProductCatalogStatus.NEEDS_REVIEW : undefined
  }

  const updatedProduct = await prisma.product.update({
    where: { id: productId },
    data,
    select: {
      id: true,
      name: true,
      translatedName: true,
      description: true,
      article: true,
      barcode: true,
      brand: true,
      producer: true,
      manufacturer: true,
      country: true,
      region: true,
      vintage: true,
      alcoholPercent: true,
      color: true,
      sugar: true,
      grapeSorts: true,
      packageVolume: true,
      packageVolumeUnit: true,
      categoryId: true,
      mainImageFileId: true,
      status: true,
      isConfirmed: true,
      isHidden: true,
      mergedIntoProductId: true,
      attributesJson: true,
    },
  })
  if (packagingType !== undefined) {
    const defaultVariant = await prisma.productVariant.findFirst({
      where: { productId },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
      select: { id: true },
    })
    if (defaultVariant) {
      await prisma.productVariant.update({
        where: { id: defaultVariant.id },
        data: { packagingType: packagingType || null },
      })
    }
  }

  const changes = buildAuditChanges(
    getProductAuditSnapshot(product),
    getProductAuditSnapshot(updatedProduct)
  )
  if (changes.length) {
    await writeProductAuditLog(productId, 'CATALOG_PRODUCT_UPDATED', { changes })
  }

  return getModerationCatalogProductDetail(productId)
}

export async function confirmModerationCatalogProduct(productId: string) {
  const beforeProduct = await getProductAuditRecord(productId)
  const updatedProduct = await prisma.product.update({
    where: { id: productId },
    data: {
      status: ProductCatalogStatus.CONFIRMED,
      isConfirmed: true,
      confirmedAt: new Date(),
      isHidden: false,
      hiddenAt: null,
    },
    select: {
      id: true,
      name: true,
      translatedName: true,
      description: true,
      brand: true,
      producer: true,
      country: true,
      region: true,
      vintage: true,
      alcoholPercent: true,
      packageVolume: true,
      packageVolumeUnit: true,
      categoryId: true,
      mainImageFileId: true,
      status: true,
      isConfirmed: true,
      isHidden: true,
      mergedIntoProductId: true,
    },
  })
  await writeProductAuditLog(productId, 'CATALOG_PRODUCT_CONFIRMED', {
    changes: buildAuditChanges(
      getProductAuditSnapshot(beforeProduct),
      getProductAuditSnapshot(updatedProduct)
    ),
  })

  return getModerationCatalogProductDetail(productId)
}

export async function hideModerationCatalogProduct(productId: string) {
  const beforeProduct = await getProductAuditRecord(productId)
  const updatedProduct = await prisma.product.update({
    where: { id: productId },
    data: {
      status: ProductCatalogStatus.HIDDEN,
      isHidden: true,
      hiddenAt: new Date(),
    },
    select: {
      id: true,
      name: true,
      translatedName: true,
      description: true,
      brand: true,
      producer: true,
      country: true,
      region: true,
      vintage: true,
      alcoholPercent: true,
      packageVolume: true,
      packageVolumeUnit: true,
      categoryId: true,
      mainImageFileId: true,
      status: true,
      isConfirmed: true,
      isHidden: true,
      mergedIntoProductId: true,
    },
  })
  await writeProductAuditLog(productId, 'CATALOG_PRODUCT_HIDDEN', {
    changes: buildAuditChanges(
      getProductAuditSnapshot(beforeProduct),
      getProductAuditSnapshot(updatedProduct)
    ),
  })

  return getModerationCatalogProductDetail(productId)
}

export async function unhideModerationCatalogProduct(productId: string) {
  const product = await getProductAuditRecord(productId)

  const updatedProduct = await prisma.product.update({
    where: { id: productId },
    data: {
      status: product.isConfirmed
        ? ProductCatalogStatus.CONFIRMED
        : ProductCatalogStatus.NEEDS_REVIEW,
      isHidden: false,
      hiddenAt: null,
    },
    select: {
      id: true,
      name: true,
      translatedName: true,
      description: true,
      brand: true,
      producer: true,
      country: true,
      region: true,
      vintage: true,
      alcoholPercent: true,
      packageVolume: true,
      packageVolumeUnit: true,
      categoryId: true,
      mainImageFileId: true,
      status: true,
      isConfirmed: true,
      isHidden: true,
      mergedIntoProductId: true,
    },
  })
  await writeProductAuditLog(productId, 'CATALOG_PRODUCT_UNHIDDEN', {
    changes: buildAuditChanges(
      getProductAuditSnapshot(product),
      getProductAuditSnapshot(updatedProduct)
    ),
  })

  return getModerationCatalogProductDetail(productId)
}

export async function updateModerationCatalogProductStatus(
  productId: string,
  input: { status?: unknown; action?: unknown }
) {
  const rawStatus = typeof input.status === 'string'
    ? input.status
    : typeof input.action === 'string'
      ? input.action
      : ''
  const status = rawStatus.trim().toUpperCase()

  if (!status) {
    throw new ModerationCatalogError(400, 'Product status is required')
  }

  if (status === 'RESTORE' || status === 'RETURN') {
    return unhideModerationCatalogProduct(productId)
  }

  if (status === ProductCatalogStatus.CONFIRMED) {
    return confirmModerationCatalogProduct(productId)
  }

  if (status === ProductCatalogStatus.HIDDEN) {
    return hideModerationCatalogProduct(productId)
  }

  if (status !== ProductCatalogStatus.ARCHIVED && status !== ProductCatalogStatus.NEEDS_REVIEW) {
    throw new ModerationCatalogError(400, 'Product status is invalid')
  }

  const beforeProduct = await getProductAuditRecord(productId)
  const data: Prisma.ProductUpdateInput =
    status === ProductCatalogStatus.ARCHIVED
      ? {
          status: ProductCatalogStatus.ARCHIVED,
          isHidden: true,
          hiddenAt: new Date(),
        }
      : {
          status: ProductCatalogStatus.NEEDS_REVIEW,
          isConfirmed: false,
          confirmedAt: null,
          isHidden: false,
          hiddenAt: null,
        }
  const updatedProduct = await prisma.product.update({
    where: { id: productId },
    data,
    select: {
      id: true,
      name: true,
      translatedName: true,
      description: true,
      article: true,
      barcode: true,
      brand: true,
      producer: true,
      manufacturer: true,
      country: true,
      region: true,
      vintage: true,
      alcoholPercent: true,
      color: true,
      sugar: true,
      grapeSorts: true,
      packageVolume: true,
      packageVolumeUnit: true,
      categoryId: true,
      mainImageFileId: true,
      status: true,
      isConfirmed: true,
      isHidden: true,
      mergedIntoProductId: true,
    },
  })
  await writeProductAuditLog(productId, 'CATALOG_PRODUCT_STATUS_UPDATED', {
    changes: buildAuditChanges(
      getProductAuditSnapshot(beforeProduct),
      getProductAuditSnapshot(updatedProduct)
    ),
  })

  return getModerationCatalogProductDetail(productId)
}

export async function setModerationCatalogProductMainImage(
  productId: string,
  input: { imageFileId?: unknown }
) {
  const beforeProduct = await getProductAuditRecord(productId)
  const imageFileId = typeof input.imageFileId === 'string' && input.imageFileId.trim()
    ? input.imageFileId.trim()
    : ''

  if (!imageFileId) throw new ModerationCatalogError(400, 'imageFileId is required')

  const image = await prisma.fileAsset.findUnique({
    where: { id: imageFileId },
    select: { id: true },
  })
  if (!image) throw new ModerationCatalogError(404, 'Image file not found')

  const updatedProduct = await prisma.product.update({
    where: { id: productId },
    data: {
      mainImageFileId: imageFileId,
      importImageMatches: {
        updateMany: {
          where: { fileAssetId: imageFileId },
          data: {
            status: SupplierImportImageMatchStatus.CONFIRMED,
            confirmedAt: new Date(),
          },
        },
      },
    },
    select: {
      id: true,
      name: true,
      translatedName: true,
      description: true,
      article: true,
      barcode: true,
      brand: true,
      producer: true,
      manufacturer: true,
      country: true,
      region: true,
      vintage: true,
      alcoholPercent: true,
      color: true,
      sugar: true,
      grapeSorts: true,
      packageVolume: true,
      packageVolumeUnit: true,
      categoryId: true,
      mainImageFileId: true,
      status: true,
      isConfirmed: true,
      isHidden: true,
      mergedIntoProductId: true,
    },
  })

  await writeProductAuditLog(productId, 'CATALOG_PRODUCT_MAIN_IMAGE_SET', {
    changes: buildAuditChanges(
      getProductAuditSnapshot(beforeProduct),
      getProductAuditSnapshot(updatedProduct)
    ),
  })

  return getModerationCatalogProductCard(productId)
}

async function createModerationProductFileAsset(
  tx: Prisma.TransactionClient,
  file: Express.Multer.File,
  expectedTypes: FileAssetType[]
) {
  const fileType = getFileAssetTypeByMimeType(file.mimetype)
  if (!expectedTypes.includes(fileType)) {
    throw new ModerationCatalogError(
      400,
      expectedTypes.includes(FileAssetType.VIDEO)
        ? 'Only image and video uploads are supported'
        : 'Only image uploads are supported'
    )
  }

  return tx.fileAsset.create({
    data: {
      storageKey: getStorageKeyFromUploadedFile(file),
      fileName: normalizeUploadDisplayFileName(file.originalname),
      mimeType: file.mimetype.toLowerCase(),
      fileSize: file.size,
      type: fileType,
    },
  })
}

export async function uploadModerationCatalogProductMainImage(
  productId: string,
  file: Express.Multer.File | undefined
) {
  if (!file) throw new ModerationCatalogError(400, 'Image file is required')
  const beforeProduct = await getProductAuditRecord(productId)

  try {
    await prisma.$transaction(async (tx) => {
      const fileAsset = await createModerationProductFileAsset(tx, file, [FileAssetType.IMAGE])
      await tx.product.update({
        where: { id: productId },
        data: { mainImageFileId: fileAsset.id },
      })
    })
  } catch (error) {
    await fs.unlink(file.path).catch(() => undefined)
    throw error
  }

  const afterProduct = await getProductAuditRecord(productId)
  await writeProductAuditLog(productId, 'CATALOG_PRODUCT_MAIN_IMAGE_UPLOADED', {
    changes: buildAuditChanges(
      getProductAuditSnapshot(beforeProduct),
      getProductAuditSnapshot(afterProduct)
    ),
  })

  return getModerationCatalogProductCard(productId)
}

export async function uploadModerationCatalogProductMedia(
  productId: string,
  file: Express.Multer.File | undefined
) {
  if (!file) throw new ModerationCatalogError(400, 'Media file is required')
  await getProductAuditRecord(productId)

  try {
    await prisma.$transaction(async (tx) => {
      const fileAsset = await createModerationProductFileAsset(tx, file, [
        FileAssetType.IMAGE,
        FileAssetType.VIDEO,
      ])
      const mediaCount = await tx.productMediaAsset.count({ where: { productId } })
      await tx.productMediaAsset.create({
        data: {
          productId,
          fileAssetId: fileAsset.id,
          sortOrder: mediaCount,
        },
      })
    })
  } catch (error) {
    await fs.unlink(file.path).catch(() => undefined)
    throw error
  }

  await writeProductAuditLog(productId, 'CATALOG_PRODUCT_MEDIA_UPLOADED', {
    changes: [{
      field: 'mediaAssets',
      before: null,
      after: normalizeUploadDisplayFileName(file.originalname),
    }],
  })

  return getModerationCatalogProductCard(productId)
}

export async function deleteModerationCatalogProductMedia(
  productId: string,
  mediaFileId: string
) {
  await getProductAuditRecord(productId)
  const mediaAsset = await prisma.productMediaAsset.findFirst({
    where: {
      productId,
      fileAssetId: mediaFileId,
    },
    include: {
      fileAsset: true,
    },
  })
  if (!mediaAsset) throw new ModerationCatalogError(404, 'Media file not found')

  await prisma.$transaction(async (tx) => {
    await tx.product.updateMany({
      where: {
        id: productId,
        mainImageFileId: mediaAsset.fileAssetId,
      },
      data: { mainImageFileId: null },
    })
    await tx.productMediaAsset.delete({ where: { id: mediaAsset.id } })
    await tx.fileAsset.delete({ where: { id: mediaAsset.fileAssetId } }).catch(() => undefined)
  })
  await unlinkFileAssetStorage(mediaAsset.fileAsset)
  await writeProductAuditLog(productId, 'CATALOG_PRODUCT_MEDIA_DELETED', {
    changes: [{
      field: 'mediaAssets',
      before: mediaAsset.fileAsset.fileName,
      after: null,
    }],
  })

  return getModerationCatalogProductCard(productId)
}

export async function getModerationCatalogMediaPreviewFile(fileId: string) {
  const fileAsset = await prisma.fileAsset.findUnique({
    where: { id: fileId },
    select: {
      id: true,
      fileName: true,
      storageKey: true,
      mimeType: true,
      type: true,
    },
  })

  if (!fileAsset) throw new ModerationCatalogError(404, 'Media file not found')
  if (fileAsset.type !== FileAssetType.IMAGE && fileAsset.type !== FileAssetType.VIDEO) {
    throw new ModerationCatalogError(400, 'Only image and video previews are supported')
  }

  const absolutePath = await getExistingFilePathFromStorageKey(fileAsset.storageKey)
  if (!absolutePath) throw new ModerationCatalogError(404, 'Media file not found on disk')

  return {
    id: fileAsset.id,
    fileName: fileAsset.fileName,
    mimeType: fileAsset.mimeType,
    type: fileAsset.type,
    absolutePath,
  }
}

export async function rejectModerationCatalogProductImageCandidate(
  productId: string,
  matchId: string
) {
  await getProductAuditRecord(productId)

  const match = await prisma.supplierImportImageMatch.findFirst({
    where: {
      id: matchId,
      matchedProductId: productId,
    },
    select: {
      id: true,
      fileAssetId: true,
      status: true,
    },
  })
  if (!match) throw new ModerationCatalogError(404, 'Image candidate not found')

  await prisma.supplierImportImageMatch.update({
    where: { id: match.id },
    data: { status: SupplierImportImageMatchStatus.REJECTED },
  })
  await writeProductAuditLog(productId, 'CATALOG_PRODUCT_IMAGE_REJECTED', {
    changes: [{
      field: 'imageCandidate',
      label: 'Кандидат изображения',
      before: match.status,
      after: SupplierImportImageMatchStatus.REJECTED,
    }],
    imageFileId: match.fileAssetId,
  })

  return getModerationCatalogProductCard(productId)
}

export async function mergeModerationCatalogProduct(
  productId: string,
  input: { targetProductId?: unknown }
) {
  const beforeProduct = await getProductAuditRecord(productId)
  const targetProductId = typeof input.targetProductId === 'string' && input.targetProductId.trim()
    ? input.targetProductId.trim()
    : ''
  if (!targetProductId) throw new ModerationCatalogError(400, 'targetProductId is required')
  if (targetProductId === productId) {
    throw new ModerationCatalogError(400, 'Product cannot be merged into itself')
  }

  const targetProduct = await prisma.product.findUnique({
    where: externalIdWhere(targetProductId, '0'),
    select: { id: true, status: true },
  })
  if (!targetProduct) throw new ModerationCatalogError(404, 'Target product not found')
  if (targetProduct.id === productId) {
    throw new ModerationCatalogError(400, 'Product cannot be merged into itself')
  }
  if (targetProduct.status === ProductCatalogStatus.MERGED) {
    throw new ModerationCatalogError(400, 'Target product is already merged')
  }

  const updatedProduct = await prisma.product.update({
    where: { id: productId },
    data: {
      mergedIntoProductId: targetProduct.id,
      status: ProductCatalogStatus.MERGED,
      isHidden: true,
      hiddenAt: new Date(),
    },
    select: {
      id: true,
      name: true,
      translatedName: true,
      description: true,
      brand: true,
      producer: true,
      country: true,
      region: true,
      vintage: true,
      alcoholPercent: true,
      packageVolume: true,
      packageVolumeUnit: true,
      categoryId: true,
      mainImageFileId: true,
      status: true,
      isConfirmed: true,
      isHidden: true,
      mergedIntoProductId: true,
    },
  })

  await writeProductAuditLog(productId, 'CATALOG_PRODUCT_MERGED', {
    targetProductId: targetProduct.id,
    changes: buildAuditChanges(
      getProductAuditSnapshot(beforeProduct),
      getProductAuditSnapshot(updatedProduct)
    ),
  })

  return getModerationCatalogProductCard(productId)
}

export async function splitMergeModerationCatalogProduct(productId: string) {
  const beforeProduct = await getProductAuditRecord(productId)
  if (!beforeProduct.mergedIntoProductId && beforeProduct.status !== ProductCatalogStatus.MERGED) {
    throw new ModerationCatalogError(400, 'Product is not merged')
  }

  const updatedProduct = await prisma.product.update({
    where: { id: productId },
    data: {
      mergedIntoProductId: null,
      status: ProductCatalogStatus.NEEDS_REVIEW,
      isHidden: false,
      hiddenAt: null,
    },
    select: {
      id: true,
      name: true,
      translatedName: true,
      description: true,
      brand: true,
      producer: true,
      country: true,
      region: true,
      vintage: true,
      alcoholPercent: true,
      packageVolume: true,
      packageVolumeUnit: true,
      categoryId: true,
      mainImageFileId: true,
      status: true,
      isConfirmed: true,
      isHidden: true,
      mergedIntoProductId: true,
    },
  })

  await writeProductAuditLog(productId, 'CATALOG_PRODUCT_SPLIT_MERGE', {
    changes: buildAuditChanges(
      getProductAuditSnapshot(beforeProduct),
      getProductAuditSnapshot(updatedProduct)
    ),
  })

  return getModerationCatalogProductCard(productId)
}

function normalizeAliasType(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ModerationCatalogError(400, 'aliasType is required')
  }
  const normalizedValue = value.trim().toUpperCase()
  if (!Object.values(SupplierProductAliasType).includes(normalizedValue as SupplierProductAliasType)) {
    throw new ModerationCatalogError(400, 'aliasType is invalid')
  }

  return normalizedValue as SupplierProductAliasType
}

function normalizeAliasValue(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export async function addModerationCatalogProductAlias(
  productId: string,
  input: {
    supplierId?: unknown
    supplierProductId?: unknown
    aliasType?: unknown
    rawValue?: unknown
    confidence?: unknown
  }
) {
  await ensureProductExists(productId)
  const supplierId = typeof input.supplierId === 'string' && input.supplierId.trim()
    ? input.supplierId.trim()
    : ''
  if (!supplierId) throw new ModerationCatalogError(400, 'supplierId is required')
  await ensureSupplierExists(supplierId)

  const rawValue = typeof input.rawValue === 'string' ? input.rawValue.trim() : ''
  if (!rawValue) throw new ModerationCatalogError(400, 'rawValue is required')

  const aliasType = normalizeAliasType(input.aliasType)
  const confidence = parseNumberField(input.confidence, 'confidence')
  const supplierProductId = typeof input.supplierProductId === 'string' && input.supplierProductId.trim()
    ? input.supplierProductId.trim()
    : null
  const supplierProduct = supplierProductId
    ? await prisma.supplierProduct.findFirst({
        where: { id: supplierProductId, supplierId, productId },
        select: { id: true },
      })
    : await prisma.supplierProduct.findFirst({
        where: { supplierId, productId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      })

  if (supplierProductId && !supplierProduct) {
    throw new ModerationCatalogError(404, 'Supplier product not found for this product')
  }

  const normalizedValue = normalizeAliasValue(rawValue)
  const alias = await prisma.supplierProductAlias.upsert({
    where: {
      supplierId_aliasType_normalizedValue: {
        supplierId,
        aliasType,
        normalizedValue,
      },
    },
    create: {
      supplierId,
      supplierProductId: supplierProduct?.id ?? null,
      aliasType,
      rawValue,
      normalizedValue,
      confidence: confidence === undefined || confidence === null
        ? null
        : new Prisma.Decimal(Math.max(0, Math.min(1, confidence)).toFixed(2)),
      isActive: true,
    },
    update: {
      supplierProductId: supplierProduct?.id ?? null,
      rawValue,
      confidence: confidence === undefined
        ? undefined
        : confidence === null
          ? null
          : new Prisma.Decimal(Math.max(0, Math.min(1, confidence)).toFixed(2)),
      isActive: true,
    },
  })

  await writeProductAuditLog(productId, 'CATALOG_PRODUCT_ALIAS_ADDED', {
    aliasId: alias.id,
    supplierId,
    changes: [{
      field: 'aliases',
      label: 'Алиасы',
      before: null,
      after: {
        aliasType,
        rawValue,
        confidence: confidence ?? null,
      },
    }],
  })

  return alias
}

export async function updateModerationCatalogIssue(
  issueId: string,
  input: {
    status?: unknown
    resolution?: unknown
  }
) {
  const issue = await prisma.catalogValidationIssue.findUnique({
    where: { id: issueId },
    select: { id: true, productId: true, status: true },
  })
  if (!issue) {
    throw new ModerationCatalogError(404, 'Issue not found')
  }

  const status = typeof input.status === 'string' ? input.status.trim().toUpperCase() : ''
  if (status !== PriceImportIssueStatus.RESOLVED && status !== PriceImportIssueStatus.IGNORED) {
    throw new ModerationCatalogError(400, 'Issue status must be RESOLVED or IGNORED')
  }

  const updatedIssue = await prisma.catalogValidationIssue.update({
    where: { id: issueId },
    data: {
      status,
      resolvedAt: new Date(),
      resolutionJson:
        input.resolution && typeof input.resolution === 'object' && !Array.isArray(input.resolution)
          ? input.resolution as Prisma.InputJsonValue
          : { source: 'MODERATION_CATALOG_API' },
    },
  })

  if (updatedIssue.productId) {
    await writeProductAuditLog(updatedIssue.productId, 'CATALOG_PRODUCT_ISSUE_UPDATED', {
      issueId,
      changes: [{
        field: `issue:${issueId}`,
        label: 'Проблема качества данных',
        before: issue.status,
        after: status,
      }],
    })
  }

  return updatedIssue
}
