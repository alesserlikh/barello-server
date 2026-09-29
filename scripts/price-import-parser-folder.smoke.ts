import assert from 'assert'
import fs from 'fs'
import path from 'path'

import { PriceImportSourceFormat } from '../src/generated/prisma'
import {
  detectImportProfileFromFile,
  parseRowsFromFile,
} from '../src/modules/price-imports/price-import-parser.service'

const DEFAULT_FIXTURES_DIR = 'C:\\Users\\aless\\OneDrive\\Desktop\\barello docs\\Прайсы в обработку'
const SUPPORTED_EXTENSIONS = new Set(['.csv', '.xls', '.xlsx', '.xml'])

function getFixturesDir() {
  return process.env.PRICE_IMPORT_FIXTURES_DIR || DEFAULT_FIXTURES_DIR
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

async function main() {
  const fixturesDir = getFixturesDir()
  const files = listFixtureFiles(fixturesDir)

  assert.ok(files.length > 0, `No price files found in ${fixturesDir}`)

  const results = await Promise.all(files.map(async (filePath) => {
    const sourceFormat = detectSourceFormat(filePath)
    const detectedProfile = detectImportProfileFromFile(filePath, sourceFormat)
    const rows = await parseRowsFromFile(filePath, sourceFormat)
    const pricedRows = rows.filter((row) => row.price !== null).length
    const namedRows = rows.filter((row) => row.rawName?.trim()).length
    const stocklessPricedRows = rows.filter((row) => row.price !== null && row.stock === null).length

    assert.ok(rows.length > 0, `Parser returned 0 rows for ${path.basename(filePath)}`)
    assert.ok(namedRows > 0, `Parser returned no named rows for ${path.basename(filePath)}`)

    return {
      fileName: path.basename(filePath),
      profile: detectedProfile.profile.code ?? detectedProfile.profile.parserKind ?? 'unknown',
      importKind: detectedProfile.profile.importKind ?? 'PRICE_WITH_OFFERS',
      rows: rows.length,
      pricedRows,
      stocklessPricedRows,
    }
  }))

  console.table(results)
  console.info(`[price-import-parser-folder-smoke] parsed ${results.length} files from ${fixturesDir}`)
}

main().catch((error) => {
  console.error('[price-import-parser-folder-smoke] failed:', error)
  process.exit(1)
})
