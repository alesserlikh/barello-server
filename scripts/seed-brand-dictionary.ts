import fs from 'fs'
import path from 'path'
import { NameDictionaryKind, Prisma } from '../src/generated/prisma'
import { prisma } from '../src/lib/prisma'
import {
  clearNameDictionariesCache,
  normalizeText,
} from '../src/modules/price-imports/name-decomposer.service'

type RawBrandSeedEntry = {
  pattern?: unknown
  normalizedPattern?: unknown
  payload?: unknown
  payloadJson?: unknown
  priority?: unknown
  isActive?: unknown
}

type BrandSeedEntry = {
  index: number
  pattern: string
  normalizedPattern: string
  payloadJson: Prisma.InputJsonObject
  priority: number
  isActive: boolean
}

const DEFAULT_SEED_PATH = path.resolve(__dirname, '../prisma/seeds/brand.seed.json')
const ERROR_PRINT_LIMIT = 100

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

function parsePriority(value: unknown, normalizedPattern: string) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }

  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Math.trunc(Number(value))
  }

  return normalizedPattern.length
}

function assertNoErrors(title: string, errors: string[]) {
  if (!errors.length) {
    return
  }

  console.error(`[seed-brand] ${title}: ${errors.length}`)
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
  const entries: BrandSeedEntry[] = []

  parsed.forEach((item, itemIndex) => {
    const rawEntry = asPlainObject(item) as RawBrandSeedEntry
    const payload = asPlainObject(rawEntry.payloadJson ?? rawEntry.payload)
    const pattern = typeof rawEntry.pattern === 'string' ? rawEntry.pattern.trim() : ''
    const normalizedSource = typeof rawEntry.normalizedPattern === 'string'
      ? rawEntry.normalizedPattern
      : pattern
    const normalizedPattern = normalizeText(normalizedSource)
    const canonical = typeof payload.canonical === 'string' ? payload.canonical.trim() : ''
    const producer = typeof payload.producer === 'string' && payload.producer.trim()
      ? payload.producer.trim()
      : null
    const segment = typeof payload.segment === 'string' && payload.segment.trim()
      ? payload.segment.trim()
      : null

    if (!pattern) {
      errors.push(`#${itemIndex + 1}: pattern is required`)
    }

    if (!normalizedPattern) {
      errors.push(`#${itemIndex + 1}: normalizedPattern is empty`)
    }

    if (normalizedPattern && normalizedPattern.length < 2) {
      errors.push(`#${itemIndex + 1}: normalizedPattern "${normalizedPattern}" is too short`)
    }

    if (!canonical) {
      errors.push(`#${itemIndex + 1}: payload.canonical is required`)
    }

    if ('country' in payload) {
      errors.push(`#${itemIndex + 1}: payload.country is not allowed for BRAND; use BrandAssociation(COUNTRY)`)
    }

    if (!pattern || !normalizedPattern || !canonical || 'country' in payload) {
      return
    }

    const payloadJson: Record<string, Prisma.InputJsonValue> = { canonical }
    if (producer) {
      payloadJson.producer = producer
    }
    if (segment) {
      payloadJson.segment = segment
    }

    entries.push({
      index: itemIndex + 1,
      pattern,
      normalizedPattern,
      payloadJson: payloadJson as Prisma.InputJsonObject,
      priority: parsePriority(rawEntry.priority, normalizedPattern),
      isActive: typeof rawEntry.isActive === 'boolean' ? rawEntry.isActive : true,
    })
  })

  assertNoErrors('Invalid seed entries', errors)
  return entries
}

function validateUniquePatterns(entries: BrandSeedEntry[]) {
  const byPattern = new Map<string, BrandSeedEntry>()
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

  assertNoErrors('Duplicate BRAND patterns', errors)
}

async function upsertEntries(entries: BrandSeedEntry[]) {
  await prisma.$transaction(
    entries.map((entry) => prisma.catalogNameDictionaryEntry.upsert({
      where: {
        kind_normalizedPattern: {
          kind: NameDictionaryKind.BRAND,
          normalizedPattern: entry.normalizedPattern,
        },
      },
      create: {
        kind: NameDictionaryKind.BRAND,
        pattern: entry.pattern,
        normalizedPattern: entry.normalizedPattern,
        payloadJson: entry.payloadJson,
        priority: entry.priority,
        isActive: entry.isActive,
      },
      update: {
        pattern: entry.pattern,
        payloadJson: entry.payloadJson,
        priority: entry.priority,
        isActive: entry.isActive,
      },
    })),
  )
}

async function main() {
  const { seedPath, apply } = parseArgs(process.argv.slice(2))
  const entries = readSeedFile(seedPath)
  validateUniquePatterns(entries)

  if (!apply) {
    const brands = new Set(entries.map((entry) => {
      const canonical = entry.payloadJson.canonical
      return typeof canonical === 'string' ? canonical : ''
    }))
    console.info(
      `[seed-brand] dry-run ok: ${entries.length} patterns, ${brands.size} brands validated from ${path.relative(process.cwd(), seedPath)}. Run with --apply to upsert.`,
    )
    return
  }

  await upsertEntries(entries)
  clearNameDictionariesCache()
  console.info(`[seed-brand] upserted ${entries.length} BRAND entries`)
  console.info('[seed-brand] in-process name dictionary cache cleared')
}

main().catch(async (error) => {
  if (!(error instanceof SeedValidationError)) {
    console.error('[seed-brand] failed:', error)
  }
  await prisma.$disconnect()
  process.exit(1)
}).finally(async () => {
  await prisma.$disconnect()
})
