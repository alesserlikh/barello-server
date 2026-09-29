import fs from 'fs'
import path from 'path'
import { NameDictionaryKind, Prisma } from '../src/generated/prisma'
import { prisma } from '../src/lib/prisma'
import {
  clearNameDictionariesCache,
  normalizeText,
} from '../src/modules/price-imports/name-decomposer.service'

type RawTradeTermSeedEntry = {
  pattern?: unknown
  normalizedPattern?: unknown
  payload?: unknown
  payloadJson?: unknown
  source?: unknown
  priority?: unknown
  isActive?: unknown
}

type TradeTermSeedEntry = {
  index: number
  pattern: string
  normalizedPattern: string
  payloadJson: Prisma.InputJsonObject
  priority: number
  isActive: boolean
}

const DEFAULT_SEED_PATH = path.resolve(__dirname, '../prisma/seeds/trade-term.seed.json')
const ERROR_PRINT_LIMIT = 100
const SOURCE_PRIORITY: Record<string, number> = {
  CURATED: 3000,
  GRAPE_IMPORT: 2000,
  MINED_BILINGUAL: 1000,
}

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

function parsePriority(value: unknown, source: string | null, normalizedPattern: string) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }

  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Math.trunc(Number(value))
  }

  return (source ? SOURCE_PRIORITY[source] ?? 0 : 0) + normalizedPattern.length
}

function assertNoErrors(title: string, errors: string[]) {
  if (!errors.length) {
    return
  }

  console.error(`[seed-trade-term] ${title}: ${errors.length}`)
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
  const entries: TradeTermSeedEntry[] = []

  parsed.forEach((item, itemIndex) => {
    const rawEntry = asPlainObject(item) as RawTradeTermSeedEntry
    const payload = asPlainObject(rawEntry.payloadJson ?? rawEntry.payload)
    const pattern = typeof rawEntry.pattern === 'string' ? rawEntry.pattern.trim() : ''
    const normalizedSource = typeof rawEntry.normalizedPattern === 'string'
      ? rawEntry.normalizedPattern
      : pattern
    const normalizedPattern = normalizeText(normalizedSource)
    const en = typeof payload.en === 'string' ? payload.en.trim() : ''
    const source = typeof rawEntry.source === 'string' && rawEntry.source.trim()
      ? rawEntry.source.trim().toUpperCase()
      : typeof payload.source === 'string' && payload.source.trim()
        ? payload.source.trim().toUpperCase()
        : null

    if (!pattern) {
      errors.push(`#${itemIndex + 1}: pattern is required`)
    }

    if (!normalizedPattern) {
      errors.push(`#${itemIndex + 1}: normalizedPattern is empty`)
    }

    if (!en) {
      errors.push(`#${itemIndex + 1}: payload.en is required`)
    }

    if (source && !SOURCE_PRIORITY[source]) {
      errors.push(`#${itemIndex + 1}: source "${source}" is invalid`)
    }

    if (!pattern || !normalizedPattern || !en || (source && !SOURCE_PRIORITY[source])) {
      return
    }

    const payloadJson: Record<string, Prisma.InputJsonValue> = { en }
    if (source) {
      payloadJson.source = source
    }

    entries.push({
      index: itemIndex + 1,
      pattern,
      normalizedPattern,
      payloadJson: payloadJson as Prisma.InputJsonObject,
      priority: parsePriority(rawEntry.priority, source, normalizedPattern),
      isActive: typeof rawEntry.isActive === 'boolean' ? rawEntry.isActive : true,
    })
  })

  assertNoErrors('Invalid seed entries', errors)
  return entries
}

function getEntrySourcePriority(entry: TradeTermSeedEntry) {
  const source = typeof entry.payloadJson.source === 'string' ? entry.payloadJson.source : ''
  return SOURCE_PRIORITY[source] ?? 0
}

function dedupeEntries(entries: TradeTermSeedEntry[]) {
  const byPattern = new Map<string, TradeTermSeedEntry>()
  const duplicateWarnings: string[] = []

  for (const entry of entries) {
    const existing = byPattern.get(entry.normalizedPattern)
    if (!existing) {
      byPattern.set(entry.normalizedPattern, entry)
      continue
    }

    const existingPriority = getEntrySourcePriority(existing)
    const nextPriority = getEntrySourcePriority(entry)
    if (nextPriority > existingPriority) {
      byPattern.set(entry.normalizedPattern, entry)
      duplicateWarnings.push(
        `#${entry.index} replaced #${existing.index} for normalizedPattern "${entry.normalizedPattern}"`,
      )
    } else {
      duplicateWarnings.push(
        `#${entry.index} skipped duplicate normalizedPattern "${entry.normalizedPattern}" from #${existing.index}`,
      )
    }
  }

  if (duplicateWarnings.length) {
    console.warn(`[seed-trade-term] Duplicate TRADE_TERM patterns collapsed: ${duplicateWarnings.length}`)
    for (const warning of duplicateWarnings.slice(0, ERROR_PRINT_LIMIT)) {
      console.warn(`  - ${warning}`)
    }
  }

  return Array.from(byPattern.values())
}

async function upsertEntries(entries: TradeTermSeedEntry[]) {
  await prisma.$transaction(
    entries.map((entry) => prisma.catalogNameDictionaryEntry.upsert({
      where: {
        kind_normalizedPattern: {
          kind: NameDictionaryKind.TRADE_TERM,
          normalizedPattern: entry.normalizedPattern,
        },
      },
      create: {
        kind: NameDictionaryKind.TRADE_TERM,
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
  const entries = dedupeEntries(readSeedFile(seedPath))

  if (!apply) {
    const sources = entries.reduce<Record<string, number>>((acc, entry) => {
      const source = typeof entry.payloadJson.source === 'string' ? entry.payloadJson.source : 'UNSPECIFIED'
      acc[source] = (acc[source] ?? 0) + 1
      return acc
    }, {})
    console.info(
      `[seed-trade-term] dry-run ok: ${entries.length} entries validated from ${path.relative(process.cwd(), seedPath)}. Sources: ${JSON.stringify(sources)}. Run with --apply to upsert.`,
    )
    return
  }

  await upsertEntries(entries)
  clearNameDictionariesCache()
  console.info(`[seed-trade-term] upserted ${entries.length} TRADE_TERM entries`)
  console.info('[seed-trade-term] in-process name dictionary cache cleared')
}

main().catch(async (error) => {
  if (!(error instanceof SeedValidationError)) {
    console.error('[seed-trade-term] failed:', error)
  }
  await prisma.$disconnect()
  process.exit(1)
}).finally(async () => {
  await prisma.$disconnect()
})
