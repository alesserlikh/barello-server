import assert from 'assert'
import fs from 'fs'
import path from 'path'

import { PriceImportSourceFormat } from '../src/generated/prisma'
import {
  detectImportProfileFromFile,
  parseRowsFromFile,
  type ParsedPriceRow,
} from '../src/modules/price-imports/price-import-parser.service'

const DEFAULT_FIXTURES_DIR = 'C:\\Users\\aless\\OneDrive\\Desktop\\barello docs\\Прайсы в обработку'
const SNAPSHOT_PATH = path.resolve(
  process.cwd(),
  'scripts',
  '__snapshots__',
  'price-import-normalized-rows.snapshot.json',
)
const SUPPORTED_EXTENSIONS = new Set(['.csv', '.xls', '.xlsx', '.xml'])
const SAMPLE_ROWS_COUNT = 5

function getFixturesDir() {
  return process.env.PRICE_IMPORT_FIXTURES_DIR || DEFAULT_FIXTURES_DIR
}

function shouldUpdateSnapshot() {
  return process.argv.includes('--update') || process.env.UPDATE_SNAPSHOTS === '1'
}

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

function stablePayload(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value ?? null
  }

  const source = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(source).sort()) {
    const item = source[key]
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      result[key] = stablePayload(item)
    } else if (Array.isArray(item)) {
      result[key] = item.slice(0, 8)
    } else {
      result[key] = item ?? null
    }
  }

  return result
}

function compactRow(row: ParsedPriceRow) {
  const rawPayload = row.rawPayload ?? {}

  return {
    rowNumber: row.rowNumber,
    rawName: row.rawName,
    normalizedName: row.normalizedName,
    rawCategory: row.rawCategory,
    normalizedCategory: row.normalizedCategory,
    supplierSku: row.supplierSku,
    barcode: row.barcode,
    article: row.article,
    price: row.price,
    currency: row.currency,
    stock: row.stock,
    deliveryDaysMin: row.deliveryDaysMin,
    deliveryDaysMax: row.deliveryDaysMax,
    volumeMl: row.volumeMl,
    rowType: typeof rawPayload.rowType === 'string' ? rawPayload.rowType : null,
    normalizedPayload: stablePayload(row.normalizedPayload),
  }
}

async function buildSnapshot(fixturesDir: string) {
  const files = listFixtureFiles(fixturesDir)

  return {
    version: 1,
    generatedFrom: path.basename(fixturesDir),
    sampleRowsCount: SAMPLE_ROWS_COUNT,
    files: await Promise.all(files.map(async (filePath) => {
      const sourceFormat = detectSourceFormat(filePath)
      const detectedProfile = detectImportProfileFromFile(filePath, sourceFormat)
      const rows = await parseRowsFromFile(filePath, sourceFormat)

      return {
        fileName: path.basename(filePath),
        sourceFormat,
        profile: {
          code: detectedProfile.profile.code ?? null,
          parserKind: detectedProfile.profile.parserKind ?? null,
          importKind: detectedProfile.profile.importKind ?? null,
          bestSheetName: detectedProfile.structure?.bestSheetName ?? null,
        },
        summary: {
          rowsCount: rows.length,
          pricedRows: rows.filter((row) => row.price !== null).length,
          stockRows: rows.filter((row) => row.stock !== null).length,
          stocklessPricedRows: rows.filter((row) => row.price !== null && row.stock === null).length,
          productMasterRows: rows.filter((row) => row.rawPayload?.rowType === 'PRODUCT_MASTER').length,
        },
        sampleRows: rows.slice(0, SAMPLE_ROWS_COUNT).map(compactRow),
      }
    })),
  }
}

async function main() {
  const fixturesDir = getFixturesDir()
  const actualSnapshot = await buildSnapshot(fixturesDir)
  const serializedActual = `${JSON.stringify(actualSnapshot, null, 2)}\n`

  if (shouldUpdateSnapshot() || !fs.existsSync(SNAPSHOT_PATH)) {
    fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true })
    fs.writeFileSync(SNAPSHOT_PATH, serializedActual, 'utf8')
    console.info(`[price-import-normalized-snapshots] snapshot updated: ${SNAPSHOT_PATH}`)
    return
  }

  const expectedSnapshot = fs.readFileSync(SNAPSHOT_PATH, 'utf8')
  assert.strictEqual(
    serializedActual,
    expectedSnapshot,
    'Normalized price import rows snapshot changed. Run npm run test:price-import-snapshots:update if this change is intentional.',
  )

  console.info('[price-import-normalized-snapshots] snapshot matched')
}

main().catch((error) => {
  console.error('[price-import-normalized-snapshots] failed:', error)
  process.exit(1)
})
