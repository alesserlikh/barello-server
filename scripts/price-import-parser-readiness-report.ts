import fs from 'fs'
import path from 'path'
import { PriceImportSourceFormat } from '../src/generated/prisma'
import {
  detectImportProfileFromFile,
  parseRowsFromFile,
} from '../src/modules/price-imports/price-import-parser.service'

const DEFAULT_FIXTURES_DIR = 'C:\\Users\\aless\\OneDrive\\Desktop\\barello docs\\Прайсы в обработку'
const SUPPORTED_EXTENSIONS = new Set(['.csv', '.xls', '.xlsx', '.xml'])

function detectSourceFormat(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.csv') return PriceImportSourceFormat.CSV
  if (extension === '.xml') return PriceImportSourceFormat.XML
  return PriceImportSourceFormat.XLSX
}

function listFiles(fixturesDir: string) {
  return fs.readdirSync(fixturesDir)
    .map((fileName) => path.join(fixturesDir, fileName))
    .filter((filePath) => fs.statSync(filePath).isFile() && SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
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

function percent(value: number, total: number) {
  return total ? `${((value / total) * 100).toFixed(1)}%` : '0.0%'
}

function inc(target: Record<string, number>, key: string, condition: boolean) {
  if (condition) {
    target[key] = (target[key] ?? 0) + 1
  }
}

function hasVolumeHint(rawName: string | null) {
  if (!rawName) return false
  return /(?:^|[^а-яёa-z0-9])(?:\d+[,.]?\d*\s*(?:л|l|литр|литра|литров|мл|ml|cl|кл)|(?:0|1)[,.]\d{2})(?![а-яёa-z0-9])/iu.test(rawName)
}

function addExample(examples: Record<string, string[]>, key: string, value: string, limit = 8) {
  if (examples[key].length < limit) {
    examples[key].push(value.slice(0, 220))
  }
}

async function main() {
  const fixturesDir = process.env.PRICE_IMPORT_FIXTURES_DIR || DEFAULT_FIXTURES_DIR
  const files = listFiles(fixturesDir)
  const totals: Record<string, number> = {}
  const issueTotals: Record<string, number> = {}
  const byFile: Array<Record<string, unknown>> = []
  const examples: Record<string, string[]> = {
    incompleteCore: [],
    categoryIssue: [],
    countryIssue: [],
    noMeasureWhenHinted: [],
    noBrand: [],
    noCountry: [],
  }
  let totalRows = 0

  for (const filePath of files) {
    const sourceFormat = detectSourceFormat(filePath)
    const detectedProfile = detectImportProfileFromFile(filePath, sourceFormat)
    const rows = await parseRowsFromFile(filePath, sourceFormat)
    const counts: Record<string, number> = {}
    totalRows += rows.length

    for (const row of rows) {
      const payload = objectValue(row.normalizedPayload)
      const product = objectValue(payload.product)
      const variant = objectValue(payload.variant)
      const offer = objectValue(payload.offer)
      const mapping = objectValue(payload.mapping)
      const nameParts = objectValue(product.nameParts)
      const issues = arrayValue(mapping.issues).filter((issue): issue is string => typeof issue === 'string')

      for (const issue of issues) {
        issueTotals[issue] = (issueTotals[issue] ?? 0) + 1
      }

      const volumeHint = hasVolumeHint(row.rawName)
      const translatedName = stringValue(product.translatedName) ?? stringValue(nameParts.enName)
      const ruName = stringValue(product.name) ?? stringValue(product.displayName)
      const category = stringValue(product.categoryRaw) ?? row.rawCategory ?? (arrayValue(nameParts.categoryPath).join(' / ') || null)
      const variantMeasure = numberValue(variant.volumeMl) !== null ||
        numberValue(variant.weightG) !== null ||
        numberValue(variant.unitCount) !== null
      const measure = variantMeasure || stringValue(variant.measureLabel) !== null || !volumeHint
      const brand = stringValue(product.brand) ?? stringValue(product.manufacturer)
      const country = stringValue(product.country)
      const alcohol = numberValue(product.alcoholPercent) !== null || numberValue(nameParts.alcoholPercent) !== null
      const price = numberValue(offer.price) !== null || row.price !== null
      const isProductMaster = detectedProfile.profile.importKind === 'PRODUCT_MASTER'
      const completeCore = Boolean(ruName && category && measure && brand && country && (isProductMaster || price))

      inc(counts, 'translatedName', Boolean(translatedName))
      inc(counts, 'ruName', Boolean(ruName))
      inc(counts, 'category', Boolean(category))
      inc(counts, 'measure', measure)
      inc(counts, 'variantMeasure', variantMeasure)
      inc(counts, 'packagingType', Boolean(stringValue(variant.packagingType)))
      inc(counts, 'setSize', numberValue(variant.setSize) !== null)
      inc(counts, 'rawValue', numberValue(variant.rawValue) !== null)
      inc(counts, 'brand', Boolean(brand))
      inc(counts, 'country', Boolean(country))
      inc(counts, 'alcohol', alcohol)
      inc(counts, 'price', price)
      inc(counts, 'completeCore', completeCore)
      inc(counts, 'categorySignals', arrayValue(nameParts.categorySignals).length > 0)
      inc(counts, 'geoSignals', arrayValue(nameParts.geoSignals).length > 0)
      inc(counts, 'brandSignals', arrayValue(nameParts.brandSignals).length > 0)
      inc(counts, 'issues', issues.length > 0)

      const sample = `${path.basename(filePath)} #${row.rowNumber}: ${row.rawName ?? '<empty>'}`
      if (!completeCore) addExample(examples, 'incompleteCore', sample, 10)
      if (issues.some((issue) => issue.includes('CATEGORY'))) addExample(examples, 'categoryIssue', sample)
      if (issues.some((issue) => issue.includes('COUNTRY') || issue.includes('GEO'))) addExample(examples, 'countryIssue', sample)
      if (volumeHint && !variantMeasure) addExample(examples, 'noMeasureWhenHinted', sample)
      if (!brand) addExample(examples, 'noBrand', sample)
      if (!country) addExample(examples, 'noCountry', sample)
    }

    for (const [key, value] of Object.entries(counts)) {
      totals[key] = (totals[key] ?? 0) + value
    }

    byFile.push({
      fileName: path.basename(filePath),
      profile: detectedProfile.profile.code ?? detectedProfile.profile.parserKind ?? 'unknown',
      importKind: detectedProfile.profile.importKind ?? 'PRICE_WITH_OFFERS',
      rows: rows.length,
      completeCore: percent(counts.completeCore ?? 0, rows.length),
      translatedName: percent(counts.translatedName ?? 0, rows.length),
      category: percent(counts.category ?? 0, rows.length),
      measure: percent(counts.measure ?? 0, rows.length),
      variantMeasure: percent(counts.variantMeasure ?? 0, rows.length),
      brand: percent(counts.brand ?? 0, rows.length),
      country: percent(counts.country ?? 0, rows.length),
      alcohol: percent(counts.alcohol ?? 0, rows.length),
      price: percent(counts.price ?? 0, rows.length),
      brandSignals: percent(counts.brandSignals ?? 0, rows.length),
      geoSignals: percent(counts.geoSignals ?? 0, rows.length),
      categorySignals: percent(counts.categorySignals ?? 0, rows.length),
      issues: percent(counts.issues ?? 0, rows.length),
    })
  }

  console.info(`[price-import-parser-readiness-report] files=${files.length}, rows=${totalRows}`)
  console.table([{
    rows: totalRows,
    completeCore: percent(totals.completeCore ?? 0, totalRows),
    translatedName: percent(totals.translatedName ?? 0, totalRows),
    category: percent(totals.category ?? 0, totalRows),
    measure: percent(totals.measure ?? 0, totalRows),
    variantMeasure: percent(totals.variantMeasure ?? 0, totalRows),
    packagingType: percent(totals.packagingType ?? 0, totalRows),
    brand: percent(totals.brand ?? 0, totalRows),
    country: percent(totals.country ?? 0, totalRows),
    alcohol: percent(totals.alcohol ?? 0, totalRows),
    price: percent(totals.price ?? 0, totalRows),
    brandSignals: percent(totals.brandSignals ?? 0, totalRows),
    geoSignals: percent(totals.geoSignals ?? 0, totalRows),
    categorySignals: percent(totals.categorySignals ?? 0, totalRows),
    issues: percent(totals.issues ?? 0, totalRows),
  }])
  console.table(byFile)
  console.info('[price-import-parser-readiness-report] issues')
  console.table(Object.entries(issueTotals)
    .map(([issue, count]) => ({ issue, count, share: percent(count, totalRows) }))
    .sort((left, right) => right.count - left.count))
  console.info('[price-import-parser-readiness-report] examples')
  console.dir(examples, { depth: null })
}

main().catch((error) => {
  console.error('[price-import-parser-readiness-report] failed:', error)
  process.exit(1)
})
