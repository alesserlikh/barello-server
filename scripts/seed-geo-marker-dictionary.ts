import fs from 'fs'
import path from 'path'
import { NameDictionaryKind, Prisma } from '../src/generated/prisma'
import { prisma } from '../src/lib/prisma'
import {
  clearNameDictionariesCache,
  normalizeText,
} from '../src/modules/price-imports/name-decomposer.service'

type RawGeoMarkerSeedEntry = {
  pattern?: unknown
  normalizedPattern?: unknown
  payload?: unknown
  payloadJson?: unknown
  priority?: unknown
  isActive?: unknown
}

type GeoMarkerSeedEntry = {
  index: number
  pattern: string
  normalizedPattern: string
  country: string
  region: string | null
  impliesCategoryPath: string[]
  weight: number
  priority: number
  isActive: boolean
}

type CatalogCategoryNode = {
  id: string
  name: string
  parentId: string | null
}

const DEFAULT_SEED_PATH = path.resolve(__dirname, '../prisma/seeds/geo-marker.seed.json')
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

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
    : []
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

function assertNoErrors(title: string, errors: string[]) {
  if (!errors.length) {
    return
  }

  console.error(`[seed-geo-marker] ${title}: ${errors.length}`)
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
  const entries: GeoMarkerSeedEntry[] = []

  parsed.forEach((item, itemIndex) => {
    const rawEntry = asPlainObject(item) as RawGeoMarkerSeedEntry
    const payload = asPlainObject(rawEntry.payloadJson ?? rawEntry.payload)
    const pattern = typeof rawEntry.pattern === 'string' ? rawEntry.pattern.trim() : ''
    const normalizedSource = typeof rawEntry.normalizedPattern === 'string'
      ? rawEntry.normalizedPattern
      : pattern
    const normalizedPattern = normalizeText(normalizedSource)
    const country = typeof payload.country === 'string' ? payload.country.trim() : ''
    const region = typeof payload.region === 'string' && payload.region.trim()
      ? payload.region.trim()
      : null
    const impliesCategoryPath = stringList(payload.impliesCategoryPath ?? payload.categoryPath)
    const weight = parseWeight(payload.weight)

    if (!pattern) {
      errors.push(`#${itemIndex + 1}: pattern is required`)
    }

    if (!normalizedPattern) {
      errors.push(`#${itemIndex + 1}: normalizedPattern is empty`)
    }

    if (normalizedPattern && normalizedPattern.length < 2) {
      errors.push(`#${itemIndex + 1}: normalizedPattern "${normalizedPattern}" is too short`)
    }

    if (!country) {
      errors.push(`#${itemIndex + 1}: payload.country is required`)
    }

    if (weight === null || weight < 0 || weight > 1) {
      errors.push(`#${itemIndex + 1}: payload.weight must be a number from 0 to 1`)
    }

    if (!pattern || !normalizedPattern || !country || weight === null) {
      return
    }

    entries.push({
      index: itemIndex + 1,
      pattern,
      normalizedPattern,
      country,
      region,
      impliesCategoryPath,
      weight,
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

function pathLabel(categoryPath: string[]) {
  return categoryPath.join(' / ')
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

function validateUniquePatterns(entries: GeoMarkerSeedEntry[]) {
  const byPattern = new Map<string, GeoMarkerSeedEntry>()
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

  assertNoErrors('Duplicate GEO_MARKER patterns', errors)
}

function validateCategoryPaths(
  entries: GeoMarkerSeedEntry[],
  byParentAndName: Map<string, CatalogCategoryNode>,
) {
  const errorsByPath = new Map<string, string>()

  for (const entry of entries) {
    if (!entry.impliesCategoryPath.length) {
      continue
    }

    let parentId: string | null = null

    for (const [segmentIndex, segment] of entry.impliesCategoryPath.entries()) {
      const category = byParentAndName.get(categoryKey(parentId, segment))

      if (!category) {
        errorsByPath.set(
          pathLabel(entry.impliesCategoryPath),
          `#${entry.index}: missing category segment "${segment}" at depth ${segmentIndex + 1} in "${pathLabel(entry.impliesCategoryPath)}"`,
        )
        break
      }

      parentId = category.id
    }
  }

  assertNoErrors('Unknown category paths', Array.from(errorsByPath.values()))
}

async function upsertEntries(entries: GeoMarkerSeedEntry[]) {
  await prisma.$transaction(
    entries.map((entry) => {
      const payloadJson: Prisma.InputJsonObject = {
        country: entry.country,
        region: entry.region,
        impliesCategoryPath: entry.impliesCategoryPath,
        weight: entry.weight,
      }

      return prisma.catalogNameDictionaryEntry.upsert({
        where: {
          kind_normalizedPattern: {
            kind: NameDictionaryKind.GEO_MARKER,
            normalizedPattern: entry.normalizedPattern,
          },
        },
        create: {
          kind: NameDictionaryKind.GEO_MARKER,
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
    const countries = new Set(entries.map((entry) => entry.country))
    console.info(
      `[seed-geo-marker] dry-run ok: ${entries.length} entries, ${countries.size} countries validated from ${path.relative(process.cwd(), seedPath)}. Run with --apply to upsert.`,
    )
    return
  }

  await upsertEntries(entries)
  clearNameDictionariesCache()
  console.info(`[seed-geo-marker] upserted ${entries.length} GEO_MARKER entries`)
  console.info('[seed-geo-marker] in-process name dictionary cache cleared')
}

main().catch(async (error) => {
  if (!(error instanceof SeedValidationError)) {
    console.error('[seed-geo-marker] failed:', error)
  }
  await prisma.$disconnect()
  process.exit(1)
}).finally(async () => {
  await prisma.$disconnect()
})
