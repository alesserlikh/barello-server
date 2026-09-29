import { PrismaClient } from '../src/generated/prisma'

const prisma = new PrismaClient()
const MAX_FINDINGS = 50
const SKIPPED_TABLES = new Set(['_prisma_migrations'])
const TEXT_COLUMN_TYPES = new Set(['text', 'character varying', 'character'])
const COMMON_CYRILLIC_MOJIBAKE_MARKERS = [
  'Рђ',
  'Р‘',
  'Р’',
  'Р“',
  'Р”',
  'Р•',
  'Р–',
  'Р—',
  'Р™',
  'Рљ',
  'Р›',
  'Рњ',
  'Рќ',
  'Рћ',
  'Рџ',
  'Р ',
  'РЎ',
  'Рў',
  'РЈ',
  'Р¤',
  'РҐ',
  'Р¦',
  'Р§',
  'РЁ',
  'Р©',
  'РЄ',
  'Р«',
  'Р¬',
  'Р­',
  'Р®',
  'РЇ',
]

type TableRow = {
  table_name: string
}

type ColumnRow = {
  column_name: string
  data_type: string
}

type ScanRow = {
  row_id: unknown
  value: string | null
}

type Finding = {
  table: string
  column: string
  rowId: string
  value: string
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`
}

function hasMojibake(value: string) {
  if (value.includes('\uFFFD')) return true
  if (value.includes('\u0432\u0402')) return true
  if (value.includes('РІР‚В¦')) return true
  if (COMMON_CYRILLIC_MOJIBAKE_MARKERS.some((marker) => value.includes(marker))) return true
  if (/[ÐÑ][\u0080-\u00ff\u0400-\u04ff]/.test(value)) return true
  if (/[`'"][^`'"\n]*\?{3,}[^`'"\n]*[`'"]/.test(value)) return true
  if ((value.match(/[РС][\u0080-\u00ff\u2018-\u203a]/g) ?? []).length >= 1) return true

  return false
}

async function getTextColumns(tableName: string) {
  const columns = await prisma.$queryRaw<ColumnRow[]>`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${tableName}
    ORDER BY ordinal_position
  `

  return {
    hasId: columns.some((column) => column.column_name === 'id'),
    textColumns: columns
      .filter((column) => TEXT_COLUMN_TYPES.has(column.data_type))
      .map((column) => column.column_name),
  }
}

async function scanColumn(tableName: string, columnName: string, hasId: boolean) {
  const rowIdExpression = hasId ? `${quoteIdentifier('id')}::text` : 'ctid::text'
  const query = `
    SELECT ${rowIdExpression} AS row_id, ${quoteIdentifier(columnName)}::text AS value
    FROM ${quoteIdentifier(tableName)}
    WHERE ${quoteIdentifier(columnName)} IS NOT NULL
    LIMIT 10000
  `

  return prisma.$queryRawUnsafe<ScanRow[]>(query)
}

async function main() {
  const tables = await prisma.$queryRaw<TableRow[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `
  const findings: Finding[] = []

  for (const { table_name: tableName } of tables) {
    if (SKIPPED_TABLES.has(tableName)) continue

    const { hasId, textColumns } = await getTextColumns(tableName)

    for (const columnName of textColumns) {
      const rows = await scanColumn(tableName, columnName, hasId)

      for (const row of rows) {
        if (typeof row.value !== 'string' || !hasMojibake(row.value)) continue

        findings.push({
          table: tableName,
          column: columnName,
          rowId: String(row.row_id),
          value: row.value.slice(0, 160),
        })

        if (findings.length >= MAX_FINDINGS) break
      }

      if (findings.length >= MAX_FINDINGS) break
    }

    if (findings.length >= MAX_FINDINGS) break
  }

  if (findings.length > 0) {
    console.error('DB mojibake-like text found:')
    for (const finding of findings) {
      console.error(
        `${finding.table}.${finding.column} row=${finding.rowId}: ${finding.value}`
      )
    }
    process.exit(1)
  }

  console.log('No DB mojibake-like text found in scanned public text columns.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
