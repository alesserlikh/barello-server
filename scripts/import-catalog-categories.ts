import fs from 'fs'
import path from 'path'

import { CatalogCategorySection, PrismaClient } from '../src/generated/prisma'

const prisma = new PrismaClient()

type ParsedCategoryNode = {
  name: string
  level: number
  parentPathKey: string | null
  pathSegments: string[]
  sortOrder: number
}

type ImportResult = {
  importedCount: number
  reusedCount: number
  updatedCodesCount: number
  removedCount: number
  movedProductsCount: number
}

type CategoryTreeInputNode = {
  name: unknown
  level?: unknown
  children?: unknown
}

const DEFAULT_SOURCE_PATH = path.join(process.cwd(), 'uploads', 'categories.json')

const ALCOHOL_ROOT_CODES = new Set([
  'vino',
  'pivo',
  'gotovye-alkogolnye-napitki-rtd',
  'krepkii-alkogol',
])

const DRINKS_FOOD_ROOT_CODES = new Set([
  'bezalkogolnye-napitki',
  'soki-nektary-morsy',
  'gazirovannye-napitki',
  'holodnyi-chai-kombucha-fermentirovannye-napitki',
  'kofe-chai-kakao',
  'siropy-toppingi-osnovy-dlya-kokteilei',
  'bezalkogolnye-alternativy-alkogolya',
  'produkty-i-ingredienty-dlya-bara-kuhni',
  'spetsii-sahar-sol',
  'sneki',
])

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
}

function normalizeCategoryName(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function slugifySegment(value: string) {
  const transliterated = Array.from(value.toLowerCase())
    .map((character) => CYRILLIC_TO_LATIN[character] ?? character)
    .join('')

  const withoutDiacritics = transliterated
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')

  const slug = withoutDiacritics
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')

  return slug || 'category'
}

function buildCategoryCode(pathSegments: string[]) {
  return pathSegments.map(slugifySegment).join('--')
}

function buildPathKey(pathSegments: string[]) {
  return pathSegments.join(' > ')
}

function resolveCategorySection(pathSegments: string[]) {
  const rootCode = slugifySegment(pathSegments[0] || '')

  if (ALCOHOL_ROOT_CODES.has(rootCode)) {
    return CatalogCategorySection.ALCOHOL
  }

  if (DRINKS_FOOD_ROOT_CODES.has(rootCode)) {
    return CatalogCategorySection.DRINKS_FOOD
  }

  return CatalogCategorySection.NONFOOD
}

function parseCategoryJsonTree(content: string) {
  const parsedContent: unknown = JSON.parse(content)

  if (!Array.isArray(parsedContent)) {
    throw new Error('Category JSON root must be an array')
  }

  const parsedNodes: ParsedCategoryNode[] = []
  const siblingsCounterByParentPath = new Map<string, number>()

  function visitNode(
    rawNode: CategoryTreeInputNode,
    level: number,
    parentPathSegments: string[]
  ) {
    if (!rawNode || typeof rawNode !== 'object') {
      throw new Error(`Invalid category node at level ${level}`)
    }

    if (typeof rawNode.name !== 'string') {
      throw new Error(`Category node name must be a string at level ${level}`)
    }

    const name = normalizeCategoryName(rawNode.name)

    if (!name) {
      throw new Error(`Category node name cannot be empty at level ${level}`)
    }

    if (rawNode.level !== undefined && rawNode.level !== level) {
      throw new Error(
        `Category level mismatch for "${name}": expected ${level}, received ${String(rawNode.level)}`
      )
    }

    const pathSegments = [...parentPathSegments, name]
    const parentPathKey =
      parentPathSegments.length > 0 ? buildPathKey(parentPathSegments) : null
    const siblingsCounterKey = parentPathKey ?? '__root__'
    const nextSortOrder = siblingsCounterByParentPath.get(siblingsCounterKey) ?? 0

    parsedNodes.push({
      name,
      level,
      parentPathKey,
      pathSegments,
      sortOrder: nextSortOrder,
    })
    siblingsCounterByParentPath.set(siblingsCounterKey, nextSortOrder + 1)

    const children = rawNode.children ?? []

    if (!Array.isArray(children)) {
      throw new Error(`Category children must be an array for "${name}"`)
    }

    for (const childNode of children) {
      visitNode(childNode as CategoryTreeInputNode, level + 1, pathSegments)
    }
  }

  for (const rootNode of parsedContent) {
    visitNode(rootNode as CategoryTreeInputNode, 1, [])
  }

  return parsedNodes
}

function parseCategoryTree(content: string) {
  const lines = content.split(/\r?\n/)
  const parsedNodes: ParsedCategoryNode[] = []
  const stack: ParsedCategoryNode[] = []
  const siblingsCounterByParentPath = new Map<string, number>()

  for (const rawLine of lines) {
    const line = rawLine.trim()

    if (!line) {
      continue
    }

    const match = rawLine.match(/^(\-+)\s*(.+?)\s*$/)

    if (!match) {
      throw new Error(`Invalid category tree line: "${rawLine}"`)
    }

    const level = match[1].length
    const name = normalizeCategoryName(match[2])

    while (stack.length >= level) {
      stack.pop()
    }

    const parentNode = stack[stack.length - 1] ?? null
    const pathSegments = parentNode ? [...parentNode.pathSegments, name] : [name]
    const parentPathKey = parentNode ? buildPathKey(parentNode.pathSegments) : null
    const siblingsCounterKey = parentPathKey ?? '__root__'
    const nextSortOrder = siblingsCounterByParentPath.get(siblingsCounterKey) ?? 0
    const node: ParsedCategoryNode = {
      name,
      level,
      parentPathKey,
      pathSegments,
      sortOrder: nextSortOrder,
    }

    parsedNodes.push(node)
    stack.push(node)
    siblingsCounterByParentPath.set(siblingsCounterKey, nextSortOrder + 1)
  }

  return parsedNodes
}

function parseCategorySource(content: string, sourcePath: string) {
  if (path.extname(sourcePath).toLowerCase() === '.json') {
    return parseCategoryJsonTree(content)
  }

  return parseCategoryTree(content)
}

async function ensureCatalogCategory(params: {
  name: string
  code: string
  section: CatalogCategorySection
  sortOrder: number
  parentId: string | null
}) {
  const existingByCode = await prisma.catalogCategory.findUnique({
    where: {
      code: params.code,
    },
    select: {
      id: true,
      name: true,
      code: true,
      parentId: true,
      section: true,
      sortOrder: true,
    },
  })

  const existing =
    existingByCode ??
    (await prisma.catalogCategory.findFirst({
      where: {
        name: params.name,
        parentId: params.parentId,
      },
      select: {
        id: true,
        name: true,
        code: true,
        parentId: true,
        section: true,
        sortOrder: true,
      },
    }))

  if (!existing) {
    const created = await prisma.catalogCategory.create({
      data: {
        name: params.name,
        code: params.code,
        section: params.section,
        sortOrder: params.sortOrder,
        parentId: params.parentId,
      },
      select: {
        id: true,
      },
    })

    return {
      id: created.id,
      created: true,
      updatedCode: false,
    }
  }

  const shouldUpdate =
    existing.name !== params.name ||
    existing.code !== params.code ||
    existing.parentId !== params.parentId ||
    existing.section !== params.section ||
    existing.sortOrder !== params.sortOrder

  if (shouldUpdate) {
    await prisma.catalogCategory.update({
      where: { id: existing.id },
      data: {
        name: params.name,
        code: params.code,
        section: params.section,
        sortOrder: params.sortOrder,
        parentId: params.parentId,
      },
    })

    return {
      id: existing.id,
      created: false,
      updatedCode: existing.code !== params.code,
    }
  }

  return {
    id: existing.id,
    created: false,
    updatedCode: false,
  }
}

async function removeObsoleteCategories(importedIds: Set<string>) {
  const obsoleteCategories = await prisma.catalogCategory.findMany({
    where: {
      id: {
        notIn: [...importedIds],
      },
    },
    select: {
      id: true,
      name: true,
      parentId: true,
    },
  })

  if (obsoleteCategories.length === 0) {
    return {
      removedCount: 0,
      movedProductsCount: 0,
    }
  }

  const currentTopLevelCategories = await prisma.catalogCategory.findMany({
    where: {
      id: {
        in: [...importedIds],
      },
      parentId: null,
    },
    select: {
      id: true,
      name: true,
    },
  })

  const replacementByOldName = new Map<string, string | null>([
    ['Вино', currentTopLevelCategories.find((category) => category.name === 'Вина')?.id ?? null],
    ['Пиво', currentTopLevelCategories.find((category) => category.name === 'Пиво')?.id ?? null],
    ['Алкоголь', null],
  ])

  let movedProductsCount = 0

  for (const obsoleteCategory of obsoleteCategories) {
    const replacementCategoryId =
      replacementByOldName.get(obsoleteCategory.name) ?? null

    const updatedProducts = await prisma.product.updateMany({
      where: {
        categoryId: obsoleteCategory.id,
      },
      data: {
        categoryId: replacementCategoryId,
      },
    })

    movedProductsCount += updatedProducts.count
  }

  const obsoleteById = new Map(
    obsoleteCategories.map((category) => [category.id, category.parentId])
  )
  const depthCache = new Map<string, number>()

  function resolveDepth(categoryId: string): number {
    const cachedDepth = depthCache.get(categoryId)

    if (cachedDepth !== undefined) {
      return cachedDepth
    }

    const parentId = obsoleteById.get(categoryId) ?? null

    if (!parentId || !obsoleteById.has(parentId)) {
      depthCache.set(categoryId, 1)
      return 1
    }

    const depth = resolveDepth(parentId) + 1
    depthCache.set(categoryId, depth)
    return depth
  }

  const sortedObsoleteCategories = [...obsoleteCategories].sort(
    (left, right) => resolveDepth(right.id) - resolveDepth(left.id)
  )

  for (const obsoleteCategory of sortedObsoleteCategories) {
    await prisma.catalogCategory.delete({
      where: {
        id: obsoleteCategory.id,
      },
    })
  }

  return {
    removedCount: obsoleteCategories.length,
    movedProductsCount,
  }
}

async function importCatalogCategories(sourcePath: string): Promise<ImportResult> {
  const content = fs.readFileSync(sourcePath, 'utf8')
  const parsedNodes = parseCategorySource(content, sourcePath)
  const createdCategoryIds = new Map<string, string>()

  let importedCount = 0
  let reusedCount = 0
  let updatedCodesCount = 0

  for (const node of parsedNodes) {
    const parentId = node.parentPathKey
      ? createdCategoryIds.get(node.parentPathKey) ?? null
      : null

    if (node.parentPathKey && !parentId) {
      throw new Error(`Parent category not found for path ${node.parentPathKey}`)
    }

    const result = await ensureCatalogCategory({
      name: node.name,
      code: buildCategoryCode(node.pathSegments),
      section: resolveCategorySection(node.pathSegments),
      sortOrder: node.sortOrder,
      parentId,
    })

    createdCategoryIds.set(buildPathKey(node.pathSegments), result.id)

    if (result.created) {
      importedCount += 1
    } else {
      reusedCount += 1
    }

    if (result.updatedCode) {
      updatedCodesCount += 1
    }
  }

  const { removedCount, movedProductsCount } = await removeObsoleteCategories(
    new Set(createdCategoryIds.values())
  )

  return {
    importedCount,
    reusedCount,
    updatedCodesCount,
    removedCount,
    movedProductsCount,
  }
}

async function main() {
  const sourcePath = process.argv[2]
    ? path.resolve(process.argv[2])
    : DEFAULT_SOURCE_PATH

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Category tree file not found: ${sourcePath}`)
  }

  const result = await importCatalogCategories(sourcePath)
  const totalCategories = await prisma.catalogCategory.count()

  console.info(
    JSON.stringify(
      {
        sourcePath,
        totalCategories,
        ...result,
      },
      null,
      2
    )
  )
}

main()
  .catch(async (error) => {
    console.error('[import-catalog-categories] failed:', error)
    await prisma.$disconnect()
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
