import { prisma } from '../src/lib/prisma'
import {
  normalizeUploadDisplayFileName,
  normalizeUploadSafeBaseName,
} from '../src/modules/price-imports/upload-file-name'

const shouldWrite = process.argv.includes('--write')

type Change = {
  model: string
  id: string
  field: string
  before: string | null
  after: string | null
}

const changes: Change[] = []

function pushChange(
  model: string,
  id: string,
  field: string,
  before: string | null,
  after: string | null,
) {
  if (before !== after) {
    changes.push({ model, id, field, before, after })
  }
}

async function repairFileAssets() {
  const items = await prisma.fileAsset.findMany({
    select: { id: true, fileName: true },
  })

  for (const item of items) {
    const nextFileName = normalizeUploadDisplayFileName(item.fileName)
    pushChange('FileAsset', item.id, 'fileName', item.fileName, nextFileName)

    if (shouldWrite && item.fileName !== nextFileName) {
      await prisma.fileAsset.update({
        where: { id: item.id },
        data: { fileName: nextFileName },
      })
    }
  }
}

async function repairSupplierPriceImports() {
  const items = await prisma.supplierPriceImport.findMany({
    select: { id: true, originalFileName: true },
  })

  for (const item of items) {
    if (!item.originalFileName) {
      continue
    }

    const nextOriginalFileName = normalizeUploadDisplayFileName(
      item.originalFileName,
    )
    pushChange(
      'SupplierPriceImport',
      item.id,
      'originalFileName',
      item.originalFileName,
      nextOriginalFileName,
    )

    if (shouldWrite && item.originalFileName !== nextOriginalFileName) {
      await prisma.supplierPriceImport.update({
        where: { id: item.id },
        data: { originalFileName: nextOriginalFileName },
      })
    }
  }
}

async function repairSupplierImportImageMatches() {
  const items = await prisma.supplierImportImageMatch.findMany({
    select: {
      id: true,
      originalFileName: true,
      normalizedFileName: true,
    },
  })

  for (const item of items) {
    const nextOriginalFileName = normalizeUploadDisplayFileName(
      item.originalFileName,
    )
    const nextNormalizedFileName = normalizeUploadSafeBaseName(
      nextOriginalFileName,
    )

    pushChange(
      'SupplierImportImageMatch',
      item.id,
      'originalFileName',
      item.originalFileName,
      nextOriginalFileName,
    )
    pushChange(
      'SupplierImportImageMatch',
      item.id,
      'normalizedFileName',
      item.normalizedFileName,
      nextNormalizedFileName,
    )

    if (
      shouldWrite &&
      (item.originalFileName !== nextOriginalFileName ||
        item.normalizedFileName !== nextNormalizedFileName)
    ) {
      await prisma.supplierImportImageMatch.update({
        where: { id: item.id },
        data: {
          originalFileName: nextOriginalFileName,
          normalizedFileName: nextNormalizedFileName,
        },
      })
    }
  }
}

async function main() {
  await repairFileAssets()
  await repairSupplierPriceImports()
  await repairSupplierImportImageMatches()

  const grouped = changes.reduce<Record<string, number>>((acc, change) => {
    const key = `${change.model}.${change.field}`
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})

  console.info(
    `[repair-upload-file-names] mode=${shouldWrite ? 'write' : 'dry-run'} changes=${changes.length}`,
  )
  console.table(grouped)

  for (const change of changes.slice(0, 50)) {
    console.info(
      `${change.model}.${change.field} ${change.id}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`,
    )
  }

  if (!shouldWrite && changes.length > 0) {
    console.info('Run with --write to persist these changes.')
  }
}

main()
  .catch((error) => {
    console.error('[repair-upload-file-names] failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })