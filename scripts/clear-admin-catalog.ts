import {
  CatalogImportRowValidationStatus,
  PriceImportRowMappingStatus,
  PriceImportStatus,
} from '../src/generated/prisma'
import { prisma } from '../src/lib/prisma'

type CatalogCounts = Awaited<ReturnType<typeof getCatalogCounts>>

const shouldApply = process.env.CLEAR_ADMIN_CATALOG_APPLY === 'true'

async function getCatalogCounts() {
  const [
    products,
    variants,
    supplierProducts,
    offers,
    aliases,
    mediaAssets,
    productCandidates,
    normalizedRows,
    matchCandidates,
    validationIssues,
    publishBatches,
    imageMatches,
    favorites,
    sponsoredPlacements,
    productSuggestions,
    cartItems,
    orderItems,
    inventoryItems,
    supplierInventoryItems,
    menuItems,
    importRows,
    imports,
  ] = await Promise.all([
    prisma.product.count(),
    prisma.productVariant.count(),
    prisma.supplierProduct.count(),
    prisma.offer.count(),
    prisma.supplierProductAlias.count(),
    prisma.productMediaAsset.count(),
    prisma.productCandidate.count(),
    prisma.catalogNormalizedRow.count(),
    prisma.catalogMatchCandidate.count(),
    prisma.catalogValidationIssue.count(),
    prisma.catalogPublishBatch.count(),
    prisma.supplierImportImageMatch.count(),
    prisma.userFavoriteProduct.count(),
    prisma.sponsoredProductPlacement.count(),
    prisma.catalogSearchSuggestion.count({ where: { productId: { not: null } } }),
    prisma.cartItem.count(),
    prisma.supplierOrderItem.count(),
    prisma.inventoryItem.count({ where: { productId: { not: null } } }),
    prisma.supplierInventoryItem.count({ where: { productId: { not: null } } }),
    prisma.menuItem.count({ where: { productId: { not: null } } }),
    prisma.supplierPriceImportRow.count(),
    prisma.supplierPriceImport.count(),
  ])

  return {
    catalog: {
      products,
      variants,
      supplierProducts,
      offers,
      aliases,
      mediaAssets,
      productCandidates,
      normalizedRows,
      matchCandidates,
      validationIssues,
      publishBatches,
      imageMatches,
      favorites,
      sponsoredPlacements,
      productSuggestions,
    },
    dependencies: {
      cartItems,
      orderItems,
      inventoryItems,
      supplierInventoryItems,
      menuItems,
    },
    preservedImports: {
      importRows,
      imports,
    },
  }
}

function hasOrderBlocker(counts: CatalogCounts) {
  return counts.dependencies.orderItems > 0
}

async function clearCatalogProjection() {
  return prisma.$transaction(async (tx) => {
    await tx.supplierPriceImportRow.updateMany({
      data: {
        mappedProductId: null,
        mappedProductVariantId: null,
        mappedSupplierProductId: null,
        mappedOfferId: null,
        mappingStatus: PriceImportRowMappingStatus.PARSED,
        mappingConfidence: null,
        validationStatus: CatalogImportRowValidationStatus.RAW,
        approvedAt: null,
        publishedAt: null,
        errorText: null,
      },
    })

    await tx.supplierPriceImport.updateMany({
      data: {
        status: PriceImportStatus.PROCESSED,
        matchedRows: 0,
        failedRows: 0,
        issuesCount: 0,
        criticalIssuesCount: 0,
        publishedAt: null,
        errorText: null,
      },
    })

    await tx.catalogValidationIssue.deleteMany()
    await tx.catalogMatchCandidate.deleteMany()
    await tx.productCandidate.deleteMany()
    await tx.supplierImportImageMatch.deleteMany()
    await tx.catalogPublishBatch.deleteMany()
    await tx.catalogNormalizedRow.deleteMany()
    await tx.sponsoredProductPlacement.deleteMany()
    await tx.catalogSearchSuggestion.updateMany({
      where: { productId: { not: null } },
      data: { productId: null },
    })
    await tx.supplierProductAlias.deleteMany()
    await tx.productMediaAsset.deleteMany()
    await tx.offer.deleteMany()
    await tx.supplierProduct.deleteMany()
    await tx.productVariant.deleteMany()
    await tx.product.deleteMany()
  })
}

async function main() {
  const before = await getCatalogCounts()
  console.info('[clear-admin-catalog] mode:', shouldApply ? 'apply' : 'dry-run')
  console.info('[clear-admin-catalog] before:')
  console.info(JSON.stringify(before, null, 2))

  if (hasOrderBlocker(before)) {
    throw new Error(
      `Catalog cleanup blocked: ${before.dependencies.orderItems} supplier order items reference products/offers.`
    )
  }

  if (!shouldApply) {
    console.info('[clear-admin-catalog] dry-run only. Set CLEAR_ADMIN_CATALOG_APPLY=true to delete catalog data.')
    return
  }

  await clearCatalogProjection()

  const after = await getCatalogCounts()
  console.info('[clear-admin-catalog] after:')
  console.info(JSON.stringify(after, null, 2))
}

main()
  .catch((error) => {
    console.error('[clear-admin-catalog] failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
