import assert from 'assert'
import fs from 'fs'
import type { AddressInfo } from 'net'
import os from 'os'
import path from 'path'

import app from '../src/app'
import {
  CatalogCategorySection,
  PriceImportStatus,
} from '../src/generated/prisma'
import { prisma } from '../src/lib/prisma'
import {
  importPriceFile,
  publishSupplierPriceImport,
  unpublishSupplierPriceImport,
} from '../src/modules/price-imports/price-imports.service'

const TEST_PREFIX = 'price-import-catalog-smoke'
const TEST_CATEGORY_RAW = 'price import catalog smoke category'
const TEST_BARCODE = '9100000000011'

async function cleanup() {
  const suppliers = await prisma.supplier.findMany({
    where: {
      name: { startsWith: TEST_PREFIX },
    },
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
    await prisma.supplierImportImageMatch.deleteMany({
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
    where: {
      rawCategory: TEST_CATEGORY_RAW,
    },
  })
  await prisma.catalogCategory.deleteMany({
    where: {
      code: TEST_PREFIX,
    },
  })
  await prisma.business.deleteMany({
    where: {
      name: { startsWith: TEST_PREFIX },
    },
  })

  const uploadsDir = path.resolve(process.cwd(), 'uploads')
  if (fs.existsSync(uploadsDir)) {
    for (const fileName of fs.readdirSync(uploadsDir)) {
      if (fileName.includes(TEST_PREFIX)) {
        fs.rmSync(path.join(uploadsDir, fileName), { force: true })
      }
    }
  }
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
      taxNumber: `77${Date.now().toString().slice(-8)}`,
    },
  })
  const supplier = await prisma.supplier.create({
    data: {
      businessId: business.id,
      name: `${TEST_PREFIX} supplier`,
      isActive: true,
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

  return { category, supplier }
}

function createCsvFile() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${TEST_PREFIX}-`))
  const filePath = path.join(tempDir, `${TEST_PREFIX}.csv`)
  const rows = [
    'name,category,sku,barcode,price,stock,deliveryDays,volume,minOrderQty,packQty',
    `${TEST_PREFIX} wine,${TEST_CATEGORY_RAW},${TEST_PREFIX}-SKU,${TEST_BARCODE},1234.56,,2,750,6,6`,
  ]
  fs.writeFileSync(filePath, rows.join('\n'), 'utf8')

  return filePath
}

async function fetchJson(baseUrl: string, requestPath: string) {
  const response = await fetch(`${baseUrl}${requestPath}`)
  const json = await response.json() as any
  return { status: response.status, json }
}

async function main() {
  await cleanup()

  const server = app.listen(0)
  const serverReady = new Promise<void>((resolve) => server.once('listening', () => resolve()))
  let tempFilePath: string | null = null

  try {
    await serverReady
    const { supplier } = await createFixtures()
    tempFilePath = createCsvFile()
    const fileName = `${TEST_PREFIX}-${Date.now()}.csv`
    const uploaded = await importPriceFile({
      supplierId: supplier.id,
      file: {
        originalname: fileName,
        mimetype: 'text/csv',
        size: fs.statSync(tempFilePath).size,
        path: tempFilePath,
        filename: fileName,
      },
    })

    assert.notStrictEqual(uploaded.status, PriceImportStatus.PUBLISHED)
    assert.strictEqual(uploaded.rowsCount, 1)

    const previewRows = await prisma.supplierPriceImportRow.findMany({
      where: { importId: uploaded.importId },
    })
    assert.strictEqual(previewRows.length, 1)
    assert.strictEqual(previewRows[0].rawName, `${TEST_PREFIX} wine`)
    assert.strictEqual(previewRows[0].sourceSku, `${TEST_PREFIX}-SKU`)
    assert.strictEqual(previewRows[0].sourceBarcode, TEST_BARCODE)

    const published = await publishSupplierPriceImport(uploaded.importId)
    assert.strictEqual(published.import.status, PriceImportStatus.PUBLISHED)
    assert.strictEqual(published.summary.createdOffers + published.summary.updatedOffers, 1)

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
    assert.strictEqual(product.name, `${TEST_PREFIX} wine`)
    assert.strictEqual(product.supplierProducts.length, 1)
    assert.strictEqual(product.supplierProducts[0].supplierSku, `${TEST_PREFIX}-SKU`)
    assert.strictEqual(product.supplierProducts[0].offers.length, 1)
    assert.strictEqual(Number(product.supplierProducts[0].offers[0].price), 1234.56)
    assert.strictEqual(product.supplierProducts[0].offers[0].isAvailable, true)
    assert.strictEqual(product.supplierProducts[0].offers[0].stockAvailable, null)

    const address = server.address() as AddressInfo
    const baseUrl = `http://127.0.0.1:${address.port}`
    const catalog = await fetchJson(baseUrl, `/products?search=${encodeURIComponent(TEST_PREFIX)}`)

    assert.strictEqual(catalog.status, 200)
    assert.strictEqual(catalog.json.ok, true)
    assert.ok(Array.isArray(catalog.json.data.items))
    const catalogItem = catalog.json.data.items.find((item: any) => item.barcode === TEST_BARCODE)
    assert.ok(catalogItem, 'Published product was not returned by /products')
    assert.strictEqual(catalogItem.title, `${TEST_PREFIX} wine`)
    assert.strictEqual(catalogItem.supplierSku, `${TEST_PREFIX}-SKU`)
    assert.strictEqual(catalogItem.availability, 'ORDERABLE')
    assert.strictEqual(catalogItem.stockAvailable, null)
    assert.strictEqual(catalogItem.minOrderQty, 6)
    assert.strictEqual(catalogItem.packQty, 6)

    const unpublished = await unpublishSupplierPriceImport(uploaded.importId)
    assert.strictEqual(unpublished.import.status, PriceImportStatus.READY_TO_PUBLISH)
    assert.strictEqual(unpublished.summary.unpublishedOffers, 1)
    const unpublishedOffer = await prisma.offer.findFirstOrThrow({
      where: { sourceImportId: uploaded.importId },
    })
    assert.strictEqual(unpublishedOffer.isCurrent, false)
    assert.strictEqual(unpublishedOffer.isAvailable, false)
    assert.strictEqual(unpublishedOffer.missingFromLatestPrice, true)

    console.info('[price-import-catalog-integration] all checks passed')
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    }).catch(() => undefined)
    if (tempFilePath) {
      fs.rmSync(path.dirname(tempFilePath), { recursive: true, force: true })
    }
    await cleanup()
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error('[price-import-catalog-integration] failed:', error)
  process.exit(1)
})
