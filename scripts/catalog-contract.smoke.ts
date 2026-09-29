import assert from 'assert'
import { randomUUID } from 'crypto'
import type { AddressInfo } from 'net'

import app from '../src/app'
import {
  CatalogCategorySection,
  OfferAvailabilityLevel,
  ProductCatalogStatus,
} from '../src/generated/prisma'
import { prisma } from '../src/lib/prisma'

const TEST_PREFIX = 'catalog-contract-visibility'

async function fetchJson(baseUrl: string, path: string) {
  const response = await fetch(`${baseUrl}${path}`)
  const json = (await response.json()) as any

  return {
    status: response.status,
    json,
  }
}

async function cleanupFixtures() {
  await prisma.product.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } })
  await prisma.supplier.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } })
  await prisma.catalogCategory.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } })
}

async function createVisibilityFixture(params: { withOffer: boolean }) {
  const suffix = randomUUID()
  const supplier = await prisma.supplier.create({
    data: {
      name: `${TEST_PREFIX}-supplier-${suffix}`,
      catalogName: `${TEST_PREFIX}-supplier`,
      isActive: true,
    },
  })
  const category = await prisma.catalogCategory.create({
    data: {
      name: `${TEST_PREFIX}-category-${suffix}`,
      code: `${TEST_PREFIX}-${params.withOffer ? 'offer' : 'no-offer'}-${suffix}`,
      section: CatalogCategorySection.ALCOHOL,
      isTagActive: true,
      showInQuickFilters: false,
      isHidden: false,
    },
  })
  const product = await prisma.product.create({
    data: {
      name: `${TEST_PREFIX}-product-${params.withOffer ? 'offer' : 'no-offer'}-${suffix}`,
      translatedName: `${TEST_PREFIX}-product-${params.withOffer ? 'offer' : 'no-offer'}-${suffix}`,
      categoryId: category.id,
      status: ProductCatalogStatus.CONFIRMED,
      isConfirmed: true,
      isHidden: false,
      variants: {
        create: {
          volume: '0.75',
          volumeUnit: 'l',
          packagingType: 'glass',
        },
      },
    },
    include: {
      variants: true,
    },
  })
  const supplierProduct = await prisma.supplierProduct.create({
    data: {
      supplierId: supplier.id,
      productId: product.id,
      productVariantId: product.variants[0].id,
    },
  })

  if (params.withOffer) {
    await prisma.offer.create({
      data: {
        supplierProductId: supplierProduct.id,
        price: '1000',
        currency: 'RUB',
        unit: 'bottle',
        stockAvailable: '10',
        stockTotal: '10',
        deliveryDaysMin: 1,
        deliveryDaysMax: 1,
        availabilityLevel: OfferAvailabilityLevel.IN_STOCK,
        isAvailable: true,
        isCurrent: true,
        missingFromLatestPrice: false,
      },
    })
  }

  return { category, product }
}

async function createCategoryFlagFixture() {
  const suffix = randomUUID()
  const parent = await prisma.catalogCategory.create({
    data: {
      name: `${TEST_PREFIX}-inactive-parent-${suffix}`,
      code: `${TEST_PREFIX}-inactive-parent-${suffix}`,
      section: CatalogCategorySection.NONFOOD,
      isTagActive: false,
      showInQuickFilters: true,
      isHidden: false,
    },
  })
  const catalogOnlyChild = await prisma.catalogCategory.create({
    data: {
      name: `${TEST_PREFIX}-catalog-child-${suffix}`,
      code: `${TEST_PREFIX}-catalog-child-${suffix}`,
      section: CatalogCategorySection.NONFOOD,
      parentId: parent.id,
      isTagActive: true,
      showInQuickFilters: false,
      isHidden: false,
    },
  })
  const quickChild = await prisma.catalogCategory.create({
    data: {
      name: `${TEST_PREFIX}-quick-child-${suffix}`,
      code: `${TEST_PREFIX}-quick-child-${suffix}`,
      section: CatalogCategorySection.NONFOOD,
      parentId: parent.id,
      isTagActive: true,
      showInQuickFilters: true,
      isHidden: false,
    },
  })

  return { parent, catalogOnlyChild, quickChild }
}

function flattenCategoryTree(categories: any[]): any[] {
  return categories.flatMap((category) => [
    category,
    ...flattenCategoryTree(Array.isArray(category.children) ? category.children : []),
  ])
}

async function main() {
  await cleanupFixtures()
  const server = app.listen(0)

  try {
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve())
    })

    const address = server.address() as AddressInfo
    const baseUrl = `http://127.0.0.1:${address.port}`

    const categories = await fetchJson(baseUrl, '/categories')
    assert.strictEqual(categories.status, 200)
    assert.strictEqual(categories.json.ok, true)
    assert.ok(Array.isArray(categories.json.data.items))
    assert.strictEqual(typeof categories.json.data.total, 'number')

    if (categories.json.data.items[0]) {
      const category = categories.json.data.items[0]

      assert.strictEqual(typeof category.id, 'string')
      assert.strictEqual(typeof category.name, 'string')
      assert.ok(category.parentId === null || typeof category.parentId === 'string')
      assert.strictEqual(typeof category.level, 'number')
      assert.strictEqual(typeof category.productsCount, 'number')
    }

    const secondLevelCategories = await fetchJson(
      baseUrl,
      '/categories?level=2&includeChildren=true'
    )
    assert.strictEqual(secondLevelCategories.status, 200)
    assert.strictEqual(secondLevelCategories.json.ok, true)
    assert.strictEqual(secondLevelCategories.json.data.level, 2)
    assert.strictEqual(secondLevelCategories.json.data.includeChildren, true)
    assert.ok(Array.isArray(secondLevelCategories.json.data.items))

    const invalidLevel = await fetchJson(baseUrl, '/categories?level=bad')
    assert.strictEqual(invalidLevel.status, 400)
    assert.strictEqual(invalidLevel.json.ok, false)

    const filters = await fetchJson(baseUrl, '/categories/filters')
    assert.strictEqual(filters.status, 200)
    assert.strictEqual(filters.json.ok, true)
    assert.ok(Array.isArray(filters.json.data.categories))
    assert.ok(Array.isArray(filters.json.data.availability))
    assert.ok(Array.isArray(filters.json.data.deliveryDays))
    assert.ok(Array.isArray(filters.json.data.stockLevels))
    assert.ok(Array.isArray(filters.json.data.suppliers))

    const products = await fetchJson(baseUrl, '/products')
    assert.strictEqual(products.status, 200)
    assert.strictEqual(products.json.ok, true)
    assert.ok(Array.isArray(products.json.data.items))
    assert.strictEqual(typeof products.json.data.total, 'number')
    assert.strictEqual(typeof products.json.data.page, 'number')
    assert.strictEqual(typeof products.json.data.pageSize, 'number')
    assert.strictEqual(typeof products.json.data.hasMore, 'boolean')
    assert.ok(products.json.data.query)
    assert.strictEqual(typeof products.json.data.query.page, 'number')
    assert.ok('search' in products.json.data.query)

    if (products.json.data.items[0]) {
      const product = products.json.data.items[0]

      assert.strictEqual(typeof product.id, 'string')
      assert.strictEqual(typeof product.name, 'string')
      assert.ok(product.categoryId === null || typeof product.categoryId === 'string')
      assert.strictEqual(typeof product.available, 'boolean')
      assert.ok(Array.isArray(product.offers))

      if (product.offers[0]) {
        assert.ok(
          product.offers[0].deliveryDays === undefined ||
            product.offers[0].deliveryDays === null ||
            typeof product.offers[0].deliveryDays === 'string'
        )
        assert.ok(
          product.offers[0].stockLevel === undefined ||
            product.offers[0].stockLevel === null ||
            typeof product.offers[0].stockLevel === 'string'
        )
      }
    }

    const searchAlias = await fetchJson(baseUrl, '/products?search=wine&availability=IN_STOCK')
    assert.strictEqual(searchAlias.status, 200)
    assert.strictEqual(searchAlias.json.ok, true)

    const invalidDeliveryDays = await fetchJson(baseUrl, '/products?deliveryDays=bad')
    assert.strictEqual(invalidDeliveryDays.status, 400)
    assert.strictEqual(invalidDeliveryDays.json.ok, false)

    const invalidStockLevels = await fetchJson(baseUrl, '/products?stockLevels=bad')
    assert.strictEqual(invalidStockLevels.status, 400)
    assert.strictEqual(invalidStockLevels.json.ok, false)

    const invalidAvailability = await fetchJson(baseUrl, '/products?availability=bad')
    assert.strictEqual(invalidAvailability.status, 400)
    assert.strictEqual(invalidAvailability.json.ok, false)

    const invalidCategoryId = await fetchJson(baseUrl, '/products?categoryId=bad-id')
    assert.strictEqual(invalidCategoryId.status, 400)
    assert.strictEqual(invalidCategoryId.json.ok, false)

    const invalidIsPromo = await fetchJson(baseUrl, '/products?isPromo=bad')
    assert.strictEqual(invalidIsPromo.status, 400)
    assert.strictEqual(invalidIsPromo.json.ok, false)

    const invalidPageSize = await fetchJson(baseUrl, '/products?pageSize=999')
    assert.strictEqual(invalidPageSize.status, 400)
    assert.strictEqual(invalidPageSize.json.ok, false)

    const catalogFacets = await fetchJson(baseUrl, '/catalog/facets')
    assert.strictEqual(catalogFacets.status, 200)
    assert.strictEqual(catalogFacets.json.ok, true)
    assert.ok(Array.isArray(catalogFacets.json.facets))
    assert.ok(catalogFacets.json.appliedFacets)

    const catalogProducts = await fetchJson(
      baseUrl,
      `/catalog/products?limit=5&facets=${encodeURIComponent(JSON.stringify({
        availability: ['ACTIVE'],
        price: { max: 5000 },
      }))}`
    )
    assert.strictEqual(catalogProducts.status, 200)
    assert.strictEqual(catalogProducts.json.ok, true)
    assert.ok(Array.isArray(catalogProducts.json.items))
    assert.ok(Array.isArray(catalogProducts.json.facets))
    assert.strictEqual(typeof catalogProducts.json.total, 'number')
    assert.strictEqual(catalogProducts.json.limit, 5)
    assert.deepStrictEqual(catalogProducts.json.appliedFacets.availability, ['ACTIVE'])
    assert.deepStrictEqual(catalogProducts.json.appliedFacets.price, { min: null, max: 5000 })

    const invalidCatalogFacets = await fetchJson(baseUrl, '/catalog/products?facets={bad')
    assert.strictEqual(invalidCatalogFacets.status, 400)
    assert.strictEqual(invalidCatalogFacets.json.ok, false)

    const visibleFixture = await createVisibilityFixture({ withOffer: true })
    const unavailableFixture = await createVisibilityFixture({ withOffer: false })
    const categoryFlagFixture = await createCategoryFlagFixture()

    const categoriesWithQuickFilterDisabled = await fetchJson(
      baseUrl,
      `/categories?includeProductsCount=true&search=${TEST_PREFIX}`
    )
    assert.strictEqual(categoriesWithQuickFilterDisabled.status, 200)
    assert.strictEqual(categoriesWithQuickFilterDisabled.json.ok, true)
    const visibleCategory = categoriesWithQuickFilterDisabled.json.data.items.find(
      (item: any) => item.id === visibleFixture.category.id
    )
    assert.ok(
      visibleCategory,
      'category with showInQuickFilters=false and isTagActive=true must stay visible in /categories'
    )
    assert.strictEqual(
      visibleCategory.productsCount,
      1,
      'category count must include only publicly visible products with active supplier offer'
    )

    const categoryTree = await fetchJson(baseUrl, '/categories?includeChildren=true')
    const flatCategoryTree = flattenCategoryTree(categoryTree.json.data.items)
    const promotedCatalogChild = flatCategoryTree.find(
      (item: any) => item.id === categoryFlagFixture.catalogOnlyChild.id
    )
    assert.ok(
      promotedCatalogChild,
      'an active category must stay in the catalog tree when its parent is inactive'
    )
    assert.strictEqual(
      promotedCatalogChild.parentId,
      null,
      'an active category with an inactive parent must be promoted to a public tree root'
    )
    assert.ok(
      !flatCategoryTree.some((item: any) => item.id === categoryFlagFixture.parent.id),
      'an inactive category must be excluded from the catalog tree'
    )

    const filtersWithCategoryFlags = await fetchJson(baseUrl, '/categories/filters')
    const flatFilterCategoryTree = flattenCategoryTree(
      filtersWithCategoryFlags.json.data.categories
    )
    assert.ok(
      flatFilterCategoryTree.some(
        (item: any) => item.id === categoryFlagFixture.catalogOnlyChild.id
      ),
      'the filters category tree must use the same active-category policy as /categories'
    )
    assert.ok(
      !flatFilterCategoryTree.some((item: any) => item.id === categoryFlagFixture.parent.id),
      'the filters category tree must exclude inactive categories'
    )

    const quickOnlyCategories = await fetchJson(baseUrl, '/categories?quickOnly=true')
    assert.strictEqual(quickOnlyCategories.status, 200)
    assert.strictEqual(quickOnlyCategories.json.ok, true)
    assert.ok(
      !quickOnlyCategories.json.data.items.some((item: any) => item.id === visibleFixture.category.id),
      'category with showInQuickFilters=false must be excluded only from quick categories'
    )
    assert.ok(
      !quickOnlyCategories.json.data.items.some(
        (item: any) => item.id === categoryFlagFixture.catalogOnlyChild.id
      ),
      'an active category without the quick-filter flag must not enter quick categories'
    )
    assert.ok(
      quickOnlyCategories.json.data.items.some(
        (item: any) => item.id === categoryFlagFixture.quickChild.id
      ),
      'an active category with the quick-filter flag must enter quick categories'
    )
    assert.ok(
      !quickOnlyCategories.json.data.items.some(
        (item: any) => item.id === categoryFlagFixture.parent.id
      ),
      'an inactive category must not enter quick categories even when its quick-filter flag is set'
    )

    const visibleProductResponse = await fetchJson(
      baseUrl,
      `/products?search=${encodeURIComponent(visibleFixture.product.name)}`
    )
    assert.strictEqual(visibleProductResponse.status, 200)
    assert.strictEqual(visibleProductResponse.json.ok, true)
    assert.ok(
      visibleProductResponse.json.data.items.some((item: any) => item.id === visibleFixture.product.id),
      'confirmed product with public category and active offer must appear in /products'
    )

    const unavailableProductResponse = await fetchJson(
      baseUrl,
      `/products?search=${encodeURIComponent(unavailableFixture.product.name)}`
    )
    assert.strictEqual(unavailableProductResponse.status, 200)
    assert.strictEqual(unavailableProductResponse.json.ok, true)
    assert.ok(
      !unavailableProductResponse.json.data.items.some((item: any) => item.id === unavailableFixture.product.id),
      'confirmed product without active offer must not appear in /products under current policy'
    )

    console.info('[catalog-contract-smoke] all checks passed')
  } finally {
    await cleanupFixtures()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  }
}

main().catch((error) => {
  console.error('[catalog-contract-smoke] failed:', error)
  process.exit(1)
})
