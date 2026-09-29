import fs from 'fs'
import path from 'path'

import { prisma } from '../src/lib/prisma'
import {
  findOrphanedFileAssets,
  getUploadsRootDir,
} from '../src/modules/profile/profile-media.service'

function hasFlag(flag: string) {
  return process.argv.includes(flag)
}

function readNumberFlag(flag: string, fallback: number) {
  const index = process.argv.indexOf(flag)

  if (index === -1) {
    return fallback
  }

  const rawValue = process.argv[index + 1]
  const parsedValue = Number(rawValue)

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    throw new Error(`Invalid value for ${flag}: ${rawValue}`)
  }

  return parsedValue
}

async function main() {
  const shouldDelete = hasFlag('--delete')
  const minAgeHours = readNumberFlag('--min-age-hours', 24)
  const minCreatedAt = new Date(Date.now() - minAgeHours * 60 * 60 * 1000)

  const orphanedAssets = (await findOrphanedFileAssets()).filter(
    (asset) => asset.createdAt <= minCreatedAt
  )

  if (orphanedAssets.length === 0) {
    console.info(
      `[orphaned-file-assets] no orphaned assets older than ${minAgeHours}h`
    )
    return
  }

  console.info(
    `[orphaned-file-assets] found ${orphanedAssets.length} orphaned asset(s) older than ${minAgeHours}h`
  )

  for (const asset of orphanedAssets) {
    console.info(
      JSON.stringify({
        id: asset.id,
        storageKey: asset.storageKey,
        fileName: asset.fileName,
        createdAt: asset.createdAt.toISOString(),
      })
    )
  }

  if (!shouldDelete) {
    console.info(
      '[orphaned-file-assets] dry-run mode; pass --delete to remove database records and local files'
    )
    return
  }

  const uploadsRootDir = getUploadsRootDir()

  for (const asset of orphanedAssets) {
    const absoluteFilePath = path.join(
      uploadsRootDir,
      ...asset.storageKey.split('/').filter(Boolean)
    )

    if (fs.existsSync(absoluteFilePath)) {
      fs.unlinkSync(absoluteFilePath)
    }
  }

  await prisma.fileAsset.deleteMany({
    where: {
      id: {
        in: orphanedAssets.map((asset) => asset.id),
      },
    },
  })

  console.info(
    `[orphaned-file-assets] deleted ${orphanedAssets.length} orphaned asset(s)`
  )
}

main()
  .catch(async (error) => {
    console.error('[orphaned-file-assets] failed:', error)
    await prisma.$disconnect()
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
