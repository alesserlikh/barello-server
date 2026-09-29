import { prisma } from '../src/lib/prisma'
import { inspectProfileMediaConsistency } from '../src/modules/profile/profile-media.service'

async function main() {
  const report = await inspectProfileMediaConsistency()

  console.info(
    JSON.stringify(
      {
        summary: {
          fileAssetsMissingOnDisk: report.fileAssetsMissingOnDisk.length,
          filesOnDiskWithoutFileAsset: report.filesOnDiskWithoutFileAsset.length,
          orphanedFileAssets: report.orphanedFileAssets.length,
        },
        fileAssetsMissingOnDisk: report.fileAssetsMissingOnDisk.map((asset) => ({
          id: asset.id,
          storageKey: asset.storageKey,
          fileName: asset.fileName,
          createdAt: asset.createdAt.toISOString(),
        })),
        filesOnDiskWithoutFileAsset: report.filesOnDiskWithoutFileAsset,
        orphanedFileAssets: report.orphanedFileAssets.map((asset) => ({
          id: asset.id,
          storageKey: asset.storageKey,
          fileName: asset.fileName,
          createdAt: asset.createdAt.toISOString(),
        })),
      },
      null,
      2
    )
  )
}

main()
  .catch(async (error) => {
    console.error('[profile-media-consistency] failed:', error)
    await prisma.$disconnect()
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
