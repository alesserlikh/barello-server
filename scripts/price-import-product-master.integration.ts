import assert from 'assert'

import {
  CatalogCategorySection,
  FileAssetType,
  PriceImportRowMappingStatus,
  PriceImportSourceFormat,
  PriceImportStatus,
  SupplierPriceImportKind,
} from '../src/generated/prisma'
import { prisma } from '../src/lib/prisma'
import { publishSupplierPriceImport } from '../src/modules/price-imports/price-imports.service'

const TEST_PREFIX = 'price-import-product-master-smoke'
const TEST_CATEGORY_RAW = 'price import product master category'
const TEST_BARCODE = '9100000000028'

async function cleanup() {
  const suppliers = await prisma.supplier.findMany({
    where: { name: { startsWith: TEST_PREFIX } },
    select: { id: true },
  })
  const supplierIds = suppliers.map((supplier) => supplier.id)

  if (supplierIds.length) {
    await prisma.offer.deleteMany({
      where: {
        supplierProduct: {
          supplierId: { in: supplierIds },
        },
      },
    })
    await prisma.supplierProductAlias.deleteMany({
      where: { supplierId: { in: supplierIds } },
    })
    await prisma.supplierProduct.deleteMany({
      where: { supplierId: { in: supplierIds } },
    })
    await prisma.productCandidate.deleteMany({
      where: { supplierId: { in: supplierIds } },
    })
    await prisma.supplierPriceImportIssue.deleteMany({
      where: { supplierId: { in: supplierIds } },
    })
    await prisma.supplierPriceImport.deleteMany({
      where: { supplierId: { in: supplierIds } },
    })
    await prisma.catalogCategoryMapping.deleteMany({
      where: { supplierId: { in: supplierIds } },
    })
    await prisma.fileAsset.deleteMany({
      where: {
        OR: [
          { uploadedBySupplierId: { in: supplierIds } },
          { storageKey: { contains: TEST_PREFIX } },
          { fileName: { contains: TEST_PREFIX } },
        ],
      },
    })
    await prisma.supplier.deleteMany({
      where: { id: { in: supplierIds } },
    })
  }

  await prisma.product.deleteMany({
    where: {
      OR: [
        { name: { startsWith: TEST_PREFIX } },
        { barcode: TEST_BARCODE },
      ],
    },
  })
  await prisma.catalogCategoryMapping.deleteMany({
    where: { rawCategory: TEST_CATEGORY_RAW },
  })
  await prisma.catalogCategory.deleteMany({
    where: { code: TEST_PREFIX },
  })
  await prisma.business.deleteMany({
    where: { name: { startsWith: TEST_PREFIX } },
  })
}

async function createFixtures() {
  const category = await prisma.catalogCategory.create({
    data: {
      name: `${TEST_PREFIX} category`,
      code: TEST_PREFIX,
      section: CatalogCategorySection.ALCOHOL,
      isTagActive: true,
      showInQuickFilters: true,
      isHidden: false,
    },
  })
  const business = await prisma.business.create({
    data: {
      name: `${TEST_PREFIX} business`,
      taxNumber: `78${Date.now().toString().slice(-8)}`,
    },
  })
  const supplier = await prisma.supplier.create({
    data: {
      businessId: business.id,
      name: `${TEST_PREFIX} supplier`,
      isActive: true,
    },
  })
  const fileAsset = await prisma.fileAsset.create({
    data: {
      storageKey: `uploads/${TEST_PREFIX}.csv`,
      fileName: `${TEST_PREFIX}.csv`,
      mimeType: 'text/csv',
      fileSize: 1,
      type: FileAssetType.SPREADSHEET,
      uploadedBySupplierId: supplier.id,
    },
  })

  await prisma.catalogCategoryMapping.create({
    data: {
      supplierId: supplier.id,
      rawCategory: TEST_CATEGORY_RAW,
      normalizedRawCategory: TEST_CATEGORY_RAW,
      catalogCategoryId: category.id,
    },
  })

  return { supplier, fileAsset }
}

async function main() {
  await cleanup()

  try {
    const { supplier, fileAsset } = await createFixtures()
    const priceImport = await prisma.supplierPriceImport.create({
      data: {
        supplierId: supplier.id,
        fileAssetId: fileAsset.id,
        sourceFormat: PriceImportSourceFormat.CSV,
        importKind: SupplierPriceImportKind.PRODUCT_MASTER,
        status: PriceImportStatus.READY_TO_PUBLISH,
        originalFileName: fileAsset.fileName,
        rowsCount: 1,
        parsedRows: 1,
        processedRows: 1,
        rows: {
          create: {
            rowIndex: 1,
            rowType: 'PRODUCT_MASTER',
            rawName: `${TEST_PREFIX} product`,
            normalizedName: `${TEST_PREFIX} product`,
            rawCategory: TEST_CATEGORY_RAW,
            mappingStatus: PriceImportRowMappingStatus.PARSED,
            sourceBarcode: TEST_BARCODE,
            sourceSku: `${TEST_PREFIX}-SKU`,
            rawPayload: {
              rowType: 'PRODUCT_MASTER',
            },
            normalizedPayload: {
              product: {
                categoryRaw: TEST_CATEGORY_RAW,
                name: `${TEST_PREFIX} product`,
              },
              variant: {
                volumeMl: 750,
                volumeUnit: 'ml',
              },
              offer: {
                price: null,
                stockAvailable: null,
              },
            },
          },
        },
      },
    })

    const published = await publishSupplierPriceImport(priceImport.id)

    assert.strictEqual(published.import.status, PriceImportStatus.PUBLISHED)
    assert.strictEqual(published.summary.productMasterRows, 1)
    assert.strictEqual(published.summary.createdOffers, 0)
    assert.strictEqual(published.summary.updatedOffers, 0)

    const product = await prisma.product.findUnique({
      where: { barcode: TEST_BARCODE },
      include: {
        supplierProducts: {
          include: {
            offers: true,
          },
        },
      },
    })

    assert.ok(product)
    assert.strictEqual(product.name, `${TEST_PREFIX} product`)
    assert.strictEqual(product.supplierProducts.length, 1)
    assert.strictEqual(product.supplierProducts[0].supplierSku, `${TEST_PREFIX}-SKU`)
    assert.strictEqual(product.supplierProducts[0].offers.length, 0)

    const offersCount = await prisma.offer.count({
      where: {
        supplierProduct: {
          supplierId: supplier.id,
        },
      },
    })
    assert.strictEqual(offersCount, 0)

    console.info('[price-import-product-master-integration] all checks passed')
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error('[price-import-product-master-integration] failed:', error)
  process.exit(1)
})
