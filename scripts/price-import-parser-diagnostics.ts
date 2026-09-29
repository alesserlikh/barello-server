import assert from 'assert'
import fs from 'fs'
import path from 'path'

import { PrismaClient, PriceImportSourceFormat } from '../src/generated/prisma'
import {
  detectImportProfileFromFile,
  parseRowsFromFile,
  type ParsedPriceRow,
} from '../src/modules/price-imports/price-import-parser.service'

const DEFAULT_FIXTURES_DIR = 'C:\\Users\\aless\\OneDrive\\Desktop\\barello docs\\Прайсы в обработку'
const SUPPORTED_EXTENSIONS = new Set(['.csv', '.xls', '.xlsx', '.xml'])

function detectSourceFormat(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.csv') return PriceImportSourceFormat.CSV
  if (extension === '.xml') return PriceImportSourceFormat.XML
  return PriceImportSourceFormat.XLSX
}

function listFixtureFiles(fixturesDir: string) {
  assert.ok(fs.existsSync(fixturesDir), `Price fixtures directory does not exist: ${fixturesDir}`)

  return fs.readdirSync(fixturesDir)
    .map((fileName) => path.join(fixturesDir, fileName))
    .filter((filePath) => {
      return fs.statSync(filePath).isFile() &&
        SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase())
    })
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right), 'ru'))
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : []
}

function getRowFields(row: ParsedPriceRow) {
  const payload = objectValue(row.normalizedPayload)
  const product = objectValue(payload.product)
  const variant = objectValue(payload.variant)
  const offer = objectValue(payload.offer)
  const nameParts = objectValue(product.nameParts)

  const translatedName = stringValue(product.translatedName) ?? stringValue(nameParts.enName)
  const ruName = stringValue(product.name) ?? stringValue(product.displayName)
  const categoryPath = arrayValue(nameParts.categoryPath).join(' / ')
  const category = stringValue(product.categoryRaw) ?? row.rawCategory ?? (categoryPath || null)
  const volumeMl = numberValue(variant.volumeMl) ?? numberValue(product.volumeMl) ?? row.volumeMl
  const packagingType = stringValue(variant.packagingType)
  const unit = stringValue(variant.unit) ?? stringValue(payload.unit)
  const brand = stringValue(product.brand) ?? stringValue(product.manufacturer) ?? stringValue(payload.manufacturer)
  const country = stringValue(product.country) ?? stringValue(payload.country)
  const alcoholPercent = numberValue(product.alcoholPercent) ?? numberValue(payload.alcoholPercent) ?? numberValue(nameParts.alcoholPercent)
  const alcoholPercentMax = numberValue(product.alcoholPercentMax) ?? numberValue(nameParts.alcoholPercentMax)
  const sugar = stringValue(product.sugar) ?? stringValue(payload.sugar)
  const packQty = numberValue(variant.packQty) ?? numberValue(offer.packQty) ?? numberValue(payload.packQty)
  const price = numberValue(offer.price) ?? row.price
  const features = arrayValue(product.features)

  return {
    translatedName,
    ruName,
    category,
    volumeMl,
    packagingType,
    unit,
    brand,
    country,
    alcoholPercent,
    alcoholPercentMax,
    sugar,
    packQty,
    price,
    features,
  }
}

function hasVolumeHint(rawName: string | null) {
  if (!rawName) return false
  return /(?:^|[^а-яёa-z0-9])(?:\d+[,.]?\d*\s*(?:л|l|л\.|литр|литра|литров|мл|ml|cl|кл)|(?:0|1)[,.]\d{2})(?![а-яёa-z0-9])/iu.test(rawName)
}

function percent(value: number, total: number) {
  if (!total) return '0.0%'
  return `${((value / total) * 100).toFixed(1)}%`
}

function inc(target: Record<string, number>, key: string, condition: boolean) {
  if (condition) target[key] = (target[key] ?? 0) + 1
}

async function main() {
  const fixturesDir = process.env.PRICE_IMPORT_FIXTURES_DIR || DEFAULT_FIXTURES_DIR
  const files = listFixtureFiles(fixturesDir)
  const prisma = new PrismaClient()
  const dictionaryEntries = await prisma.catalogNameDictionaryEntry.count()
  const translationEntries = await prisma.productNameTranslation.count()
  await prisma.$disconnect()

  const summaries = []
  const totals: Record<string, number> = {}
  let totalRows = 0
  let totalVolumeHintRows = 0
  const weakExamples: Record<string, string[]> = {
    noCanonicalName: [],
    noCategory: [],
    noVolumeWithHint: [],
    noPackagingType: [],
    noBrand: [],
    noCountry: [],
    noAlcohol: [],
    noPrice: [],
  }

  for (const filePath of files) {
    const sourceFormat = detectSourceFormat(filePath)
    const detectedProfile = detectImportProfileFromFile(filePath, sourceFormat)
    const rows = await parseRowsFromFile(filePath, sourceFormat)
    const counts: Record<string, number> = {}
    let rowsWithVolumeHint = 0
    totalRows += rows.length

    for (const row of rows) {
      const fields = getRowFields(row)
      const volumeHint = hasVolumeHint(row.rawName)
      if (volumeHint) rowsWithVolumeHint += 1

      inc(counts, 'canonicalName', Boolean(fields.translatedName))
      inc(counts, 'ruName', Boolean(fields.ruName))
      inc(counts, 'category', Boolean(fields.category))
      inc(counts, 'volumeMl', fields.volumeMl !== null)
      inc(counts, 'volumeWhenHinted', !volumeHint || fields.volumeMl !== null)
      inc(counts, 'packagingType', Boolean(fields.packagingType))
      inc(counts, 'unit', Boolean(fields.unit))
      inc(counts, 'brand', Boolean(fields.brand))
      inc(counts, 'country', Boolean(fields.country))
      inc(counts, 'alcohol', fields.alcoholPercent !== null)
      inc(counts, 'sugar', Boolean(fields.sugar))
      inc(counts, 'packQty', fields.packQty !== null)
      inc(counts, 'price', fields.price !== null)
      inc(counts, 'features', fields.features.length > 0)

      const sample = `${path.basename(filePath)} #${row.rowNumber}: ${row.rawName ?? '<empty>'}`.slice(0, 240)
      if (!fields.translatedName && weakExamples.noCanonicalName.length < 8) weakExamples.noCanonicalName.push(sample)
      if (!fields.category && weakExamples.noCategory.length < 8) weakExamples.noCategory.push(sample)
      if (volumeHint && fields.volumeMl === null && weakExamples.noVolumeWithHint.length < 8) weakExamples.noVolumeWithHint.push(sample)
      if (!fields.packagingType && weakExamples.noPackagingType.length < 8) weakExamples.noPackagingType.push(sample)
      if (!fields.brand && weakExamples.noBrand.length < 8) weakExamples.noBrand.push(sample)
      if (!fields.country && weakExamples.noCountry.length < 8) weakExamples.noCountry.push(sample)
      if (fields.alcoholPercent === null && weakExamples.noAlcohol.length < 8) weakExamples.noAlcohol.push(sample)
      if (fields.price === null && weakExamples.noPrice.length < 8) weakExamples.noPrice.push(sample)
    }
    totalVolumeHintRows += rowsWithVolumeHint
    for (const [key, value] of Object.entries(counts)) {
      totals[key] = (totals[key] ?? 0) + value
    }

    summaries.push({
      fileName: path.basename(filePath),
      profile: detectedProfile.profile.code ?? detectedProfile.profile.parserKind ?? 'unknown',
      importKind: detectedProfile.profile.importKind ?? 'PRICE_WITH_OFFERS',
      rows: rows.length,
      canonicalName: percent(counts.canonicalName ?? 0, rows.length),
      ruName: percent(counts.ruName ?? 0, rows.length),
      category: percent(counts.category ?? 0, rows.length),
      volumeMl: percent(counts.volumeMl ?? 0, rows.length),
      volumeHintRows: rowsWithVolumeHint,
      volumeWhenHinted: percent(counts.volumeWhenHinted ?? 0, rows.length),
      packagingType: percent(counts.packagingType ?? 0, rows.length),
      unit: percent(counts.unit ?? 0, rows.length),
      brand: percent(counts.brand ?? 0, rows.length),
      country: percent(counts.country ?? 0, rows.length),
      alcohol: percent(counts.alcohol ?? 0, rows.length),
      sugar: percent(counts.sugar ?? 0, rows.length),
      packQty: percent(counts.packQty ?? 0, rows.length),
      price: percent(counts.price ?? 0, rows.length),
      features: percent(counts.features ?? 0, rows.length),
    })
  }

  console.info(`[price-import-parser-diagnostics] files=${files.length}`)
  console.info(`[price-import-parser-diagnostics] dictionaryEntries=${dictionaryEntries}, translationEntries=${translationEntries}`)
  console.table([{
    rows: totalRows,
    canonicalName: percent(totals.canonicalName ?? 0, totalRows),
    ruName: percent(totals.ruName ?? 0, totalRows),
    category: percent(totals.category ?? 0, totalRows),
    volumeMl: percent(totals.volumeMl ?? 0, totalRows),
    volumeHintRows: totalVolumeHintRows,
    volumeWhenHinted: percent(totals.volumeWhenHinted ?? 0, totalRows),
    packagingType: percent(totals.packagingType ?? 0, totalRows),
    unit: percent(totals.unit ?? 0, totalRows),
    brand: percent(totals.brand ?? 0, totalRows),
    country: percent(totals.country ?? 0, totalRows),
    alcohol: percent(totals.alcohol ?? 0, totalRows),
    sugar: percent(totals.sugar ?? 0, totalRows),
    packQty: percent(totals.packQty ?? 0, totalRows),
    price: percent(totals.price ?? 0, totalRows),
    features: percent(totals.features ?? 0, totalRows),
  }])
  console.table(summaries)
  console.info('[price-import-parser-diagnostics] examples')
  console.dir(weakExamples, { depth: null })
}

main().catch((error) => {
  console.error('[price-import-parser-diagnostics] failed:', error)
  process.exit(1)
})
