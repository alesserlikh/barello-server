import fs from 'fs'
import path from 'path'
import { NameDictionaryKind, Prisma } from '../src/generated/prisma'
import { prisma } from '../src/lib/prisma'
import {
  clearNameDictionariesCache,
  normalizeText,
} from '../src/modules/price-imports/name-decomposer.service'

type RawFeatureSeedEntry = {
  pattern?: unknown
  normalizedPattern?: unknown
  payload?: unknown
  payloadJson?: unknown
  priority?: unknown
  isActive?: unknown
}

type FeatureSeedEntry = {
  index: number
  pattern: string
  normalizedPattern: string
  payloadJson: Prisma.InputJsonObject
  priority: number
  isActive: boolean
}

const DEFAULT_SEED_PATH = path.resolve(__dirname, '../prisma/seeds/feature.seed.json')
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

  console.error(`[seed-feature] ${title}: ${errors.length}`)
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
  const entries: FeatureSeedEntry[] = []

  parsed.forEach((item, itemIndex) => {
    const rawEntry = asPlainObject(item) as RawFeatureSeedEntry
    const pattern = typeof rawEntry.pattern === 'string' ? rawEntry.pattern.trim() : ''
    const normalizedSource = typeof rawEntry.normalizedPattern === 'string'
      ? rawEntry.normalizedPattern
      : pattern
    const normalizedPattern = normalizeText(normalizedSource)
    const payload = asPlainObject(rawEntry.payloadJson ?? rawEntry.payload)
    const code = typeof payload.code === 'string' ? payload.code.trim() : ''
    const label = typeof payload.label === 'string' ? payload.label.trim() : ''
    const group = typeof payload.group === 'string' ? payload.group.trim() : ''
    const keepInName = payload.keepInName === true
    const requiresVolumeConfirmation = payload.requiresVolumeConfirmation === true
    const impliedVolumeMl = payload.impliedVolumeMl === undefined || payload.impliedVolumeMl === null || payload.impliedVolumeMl === ''
      ? null
      : Number(payload.impliedVolumeMl)

    if (!pattern) {
      errors.push(`#${itemIndex + 1}: pattern is required`)
    }

    if (!normalizedPattern) {
      errors.push(`#${itemIndex + 1}: normalizedPattern is empty`)
    }

    if (!code) {
      errors.push(`#${itemIndex + 1}: payload.code is required`)
    } else if (!/^[A-Z0-9_]+$/.test(code)) {
      errors.push(`#${itemIndex + 1}: payload.code "${code}" must be SCREAMING_SNAKE_CASE`)
    }

    if (!label) {
      errors.push(`#${itemIndex + 1}: payload.label is required`)
    }

    if (payload.group !== undefined && !group) {
      errors.push(`#${itemIndex + 1}: payload.group must be a non-empty string when provided`)
    }

    if (payload.keepInName !== undefined && typeof payload.keepInName !== 'boolean') {
      errors.push(`#${itemIndex + 1}: payload.keepInName must be boolean`)
    }

    if (payload.requiresVolumeConfirmation !== undefined && typeof payload.requiresVolumeConfirmation !== 'boolean') {
      errors.push(`#${itemIndex + 1}: payload.requiresVolumeConfirmation must be boolean`)
    }

    if (
      impliedVolumeMl !== null &&
      (!Number.isFinite(impliedVolumeMl) || impliedVolumeMl <= 0 || impliedVolumeMl > 100_000)
    ) {
      errors.push(`#${itemIndex + 1}: payload.impliedVolumeMl must be a positive number`)
    }

    if (requiresVolumeConfirmation && impliedVolumeMl === null) {
      errors.push(`#${itemIndex + 1}: requiresVolumeConfirmation requires impliedVolumeMl`)
    }

    if (!pattern || !normalizedPattern || !code || !label || (
      impliedVolumeMl !== null &&
      (!Number.isFinite(impliedVolumeMl) || impliedVolumeMl <= 0 || impliedVolumeMl > 100_000)
    )) {
      return
    }

    const payloadJson: Record<string, Prisma.InputJsonValue> = {
      code,
      label,
      keepInName,
    }

    if (group) {
      payloadJson.group = group
    }
    if (impliedVolumeMl !== null) {
      payloadJson.impliedVolumeMl = Math.round(impliedVolumeMl)
    }
    if (requiresVolumeConfirmation) {
      payloadJson.requiresVolumeConfirmation = true
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

function validateUniquePatterns(entries: FeatureSeedEntry[]) {
  const byPattern = new Map<string, FeatureSeedEntry>()
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

  assertNoErrors('Duplicate FEATURE patterns', errors)
}

async function upsertEntries(entries: FeatureSeedEntry[]) {
  await prisma.$transaction(
    entries.map((entry) => prisma.catalogNameDictionaryEntry.upsert({
      where: {
        kind_normalizedPattern: {
          kind: NameDictionaryKind.FEATURE,
          normalizedPattern: entry.normalizedPattern,
        },
      },
      create: {
        kind: NameDictionaryKind.FEATURE,
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
    const codes = new Set(entries.map((entry) => String(entry.payloadJson.code)))
    console.info(
      `[seed-feature] dry-run ok: ${entries.length} entries, ${codes.size} feature codes validated from ${path.relative(process.cwd(), seedPath)}. Run with --apply to upsert.`,
    )
    return
  }

  await upsertEntries(entries)
  clearNameDictionariesCache()
  console.info(`[seed-feature] upserted ${entries.length} FEATURE entries`)
  console.info('[seed-feature] in-process name dictionary cache cleared')
}

main().catch(async (error) => {
  if (!(error instanceof SeedValidationError)) {
    console.error('[seed-feature] failed:', error)
  }
  await prisma.$disconnect()
  process.exit(1)
}).finally(async () => {
  await prisma.$disconnect()
})
