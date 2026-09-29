import fs from 'fs'
import path from 'path'
import { NameDictionaryKind, Prisma } from '../src/generated/prisma'
import { prisma } from '../src/lib/prisma'
import {
  clearNameDictionariesCache,
  normalizeText,
} from '../src/modules/price-imports/name-decomposer.service'

type RawSeedEntry = {
  pattern?: unknown
  normalizedPattern?: unknown
  categoryPath?: unknown
  weight?: unknown
  attrs?: unknown
  priority?: unknown
  isActive?: unknown
}

type SeedEntry = {
  index: number
  pattern: string
  normalizedPattern: string
  categoryPath: string[]
  weight: number
  attrs: Record<string, unknown>
  priority: number
  isActive: boolean
}

type CatalogCategoryNode = {
  id: string
  name: string
  parentId: string | null
}

const DEFAULT_SEED_PATH = path.resolve(__dirname, '../prisma/seeds/category-keyword.seed.json')
const ERROR_PRINT_LIMIT = 100
const DEFAULT_WEIGHT = 0.45

class SeedValidationError extends Error {}

function parseArgs(argv: string[]) {
  let seedPath = DEFAULT_SEED_PATH
  let apply = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--apply') {
      apply = true
      continue
    }

    if (arg === '--dry-run') {
      apply = false
      continue
    }

    if (arg === '--seed') {
      const next = argv[index + 1]
      if (!next) {
        throw new Error('--seed requires a file path')
      }
      seedPath = path.resolve(process.cwd(), next)
      index += 1
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return { seedPath, apply }
}

function asPlainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function parseWeight(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_WEIGHT
  }

  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parsePriority(value: unknown, weight: number, normalizedPattern: string) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }

  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Math.trunc(Number(value))
  }

  return Math.round(weight * 1000) + normalizedPattern.length
}

function pathLabel(categoryPath: string[]) {
  return categoryPath.join(' / ')
}

function assertNoErrors(title: string, errors: string[]) {
  if (!errors.length) {
    return
  }

  console.error(`[seed-category-keyword] ${title}: ${errors.length}`)
  for (const error of errors.slice(0, ERROR_PRINT_LIMIT)) {
    console.error(`  - ${error}`)
  }
  if (errors.length > ERROR_PRINT_LIMIT) {
    console.error(`  ... ${errors.length - ERROR_PRINT_LIMIT} more`)
  }
  throw new SeedValidationError(`${title}: ${errors.length}`)
}

function readSeedFile(seedPath: string) {
  const raw = fs.readFileSync(seedPath, 'utf8')
  const parsed = JSON.parse(raw) as unknown

  if (!Array.isArray(parsed)) {
    throw new Error('Seed file must contain a JSON array')
  }

  const errors: string[] = []
  const entries: SeedEntry[] = []

  parsed.forEach((item, itemIndex) => {
    const rawEntry = asPlainObject(item) as RawSeedEntry
    const pattern = typeof rawEntry.pattern === 'string' ? rawEntry.pattern.trim() : ''
    const normalizedSource = typeof rawEntry.normalizedPattern === 'string'
      ? rawEntry.normalizedPattern
      : pattern
    const normalizedPattern = normalizeText(normalizedSource)
    const categoryPath = Array.isArray(rawEntry.categoryPath)
      ? rawEntry.categoryPath
        .filter((segment): segment is string => typeof segment === 'string')
        .map((segment) => segment.trim())
        .filter(Boolean)
      : []
    const weight = parseWeight(rawEntry.weight)
    const attrs = asPlainObject(rawEntry.attrs)

    if (!pattern) {
      errors.push(`#${itemIndex + 1}: pattern is required`)
    }

    if (!normalizedPattern) {
      errors.push(`#${itemIndex + 1}: normalizedPattern is empty`)
    }

    if (normalizedPattern && normalizedPattern.length < 2) {
      errors.push(`#${itemIndex + 1}: normalizedPattern "${normalizedPattern}" is too short`)
    }

    if (!categoryPath.length) {
      errors.push(`#${itemIndex + 1}: categoryPath must be a non-empty string array`)
    }

    if (weight === null || weight < 0 || weight > 1) {
      errors.push(`#${itemIndex + 1}: weight must be a number from 0 to 1`)
    }

    if (rawEntry.attrs !== undefined && (
      rawEntry.attrs === null ||
      typeof rawEntry.attrs !== 'object' ||
      Array.isArray(rawEntry.attrs)
    )) {
      errors.push(`#${itemIndex + 1}: attrs must be an object`)
    }

    if (!pattern || !normalizedPattern || !categoryPath.length || weight === null) {
      return
    }

    entries.push({
      index: itemIndex + 1,
      pattern,
      normalizedPattern,
      categoryPath,
      weight,
      attrs,
      priority: parsePriority(rawEntry.priority, weight, normalizedPattern),
      isActive: typeof rawEntry.isActive === 'boolean' ? rawEntry.isActive : true,
    })
  })

  assertNoErrors('Invalid seed entries', errors)
  return entries
}

function categoryKey(parentId: string | null, name: string) {
  return `${parentId ?? 'root'}:${normalizeText(name) ?? name.trim().toLowerCase()}`
}

async function loadCategoryIndex() {
  const categories = await prisma.catalogCategory.findMany({
    select: {
      id: true,
      name: true,
      parentId: true,
    },
  })

  const byParentAndName = new Map<string, CatalogCategoryNode>()
  const duplicateKeys: string[] = []

  for (const category of categories) {
    const key = categoryKey(category.parentId, category.name)
    const existing = byParentAndName.get(key)

    if (existing) {
      duplicateKeys.push(
        `siblings "${existing.name}" and "${category.name}" share normalized name under parent ${category.parentId ?? 'root'}`,
      )
      continue
    }

    byParentAndName.set(key, category)
  }

  assertNoErrors('Ambiguous catalog category names', duplicateKeys)
  return byParentAndName
}

function validateUniquePatterns(entries: SeedEntry[]) {
  const byPattern = new Map<string, SeedEntry>()
  const errors: string[] = []

  for (const entry of entries) {
    const existing = byPattern.get(entry.normalizedPattern)
    if (!existing) {
      byPattern.set(entry.normalizedPattern, entry)
      continue
    }

    errors.push(
      `#${entry.index} duplicates normalizedPattern "${entry.normalizedPattern}" from #${existing.index}`,
    )
  }

  assertNoErrors('Duplicate CATEGORY_KEYWORD patterns', errors)
}

function validateCategoryPaths(
  entries: SeedEntry[],
  byParentAndName: Map<string, CatalogCategoryNode>,
) {
  const errorsByPath = new Map<string, string>()

  for (const entry of entries) {
    let parentId: string | null = null

    for (const [segmentIndex, segment] of entry.categoryPath.entries()) {
      const category = byParentAndName.get(categoryKey(parentId, segment))

      if (!category) {
        errorsByPath.set(
          pathLabel(entry.categoryPath),
          `#${entry.index}: missing category segment "${segment}" at depth ${segmentIndex + 1} in "${pathLabel(entry.categoryPath)}"`,
        )
        break
      }

      parentId = category.id
    }
  }

  assertNoErrors('Unknown category paths', Array.from(errorsByPath.values()))
}

async function upsertEntries(entries: SeedEntry[]) {
  await prisma.$transaction(
    entries.map((entry) => {
      const payloadJson: Prisma.InputJsonObject = {
        categoryPath: entry.categoryPath,
        weight: entry.weight,
        attrs: entry.attrs as Prisma.InputJsonObject,
      }

      return prisma.catalogNameDictionaryEntry.upsert({
        where: {
          kind_normalizedPattern: {
            kind: NameDictionaryKind.CATEGORY_KEYWORD,
            normalizedPattern: entry.normalizedPattern,
          },
        },
        create: {
          kind: NameDictionaryKind.CATEGORY_KEYWORD,
          pattern: entry.pattern,
          normalizedPattern: entry.normalizedPattern,
          payloadJson,
          priority: entry.priority,
          isActive: entry.isActive,
        },
        update: {
          pattern: entry.pattern,
          payloadJson,
          priority: entry.priority,
          isActive: entry.isActive,
        },
      })
    }),
  )
}

async function main() {
  const { seedPath, apply } = parseArgs(process.argv.slice(2))
  const entries = readSeedFile(seedPath)
  validateUniquePatterns(entries)

  const categoryIndex = await loadCategoryIndex()
  validateCategoryPaths(entries, categoryIndex)

  if (!apply) {
    console.info(
      `[seed-category-keyword] dry-run ok: ${entries.length} entries validated from ${path.relative(process.cwd(), seedPath)}. Run with --apply to upsert.`,
    )
    return
  }

  await upsertEntries(entries)
  clearNameDictionariesCache()
  console.info(`[seed-category-keyword] upserted ${entries.length} CATEGORY_KEYWORD entries`)
  console.info('[seed-category-keyword] in-process name dictionary cache cleared')
}

main().catch(async (error) => {
  if (!(error instanceof SeedValidationError)) {
    console.error('[seed-category-keyword] failed:', error)
  }
  await prisma.$disconnect()
  process.exit(1)
}).finally(async () => {
  await prisma.$disconnect()
})
