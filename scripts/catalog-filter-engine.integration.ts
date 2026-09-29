import assert from 'assert'
import { randomUUID } from 'crypto'
import type { AddressInfo } from 'net'

import {
  CatalogCategorySection,
  FacetScope,
  OfferAvailabilityLevel,
  ProductCatalogStatus,
} from '../src/generated/prisma'
import { prisma } from '../src/lib/prisma'
import { ensureDefaultCatalogFacetRegistry } from '../src/modules/catalog-filters/catalog-filter-defaults'
import {
  buildCatalogFacetProductWhere,
  getCatalogFacets,
  UNSPECIFIED_FACET_VALUE,
} from '../src/modules/catalog-filters/catalog-filter-engine.service'
import app from '../src/app'

const TEST_PREFIX = 'catalog-filter-engine'

async function cleanup() {
  await prisma.product.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } })
  await prisma.supplier.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } })
  await prisma.catalogCategory.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } })
}

async function createProductWithOffer(params: {
  supplierId: string
  name: string
  country: string
  brand?: string
  color?: string | null
  categoryId?: string
  deliveryDaysMax: number
  stockAvailable: number
  price?: string
  isHidden?: boolean
  isConfirmed?: boolean
  status?: ProductCatalogStatus
}) {
  const product = await prisma.product.create({
    data: {
      name: params.name,
      translatedName: params.name,
      country: params.country,
      brand: params.brand ?? `${TEST_PREFIX}-brand`,
      color: params.color === undefined ? null : params.color,
      categoryId: params.categoryId,
      status: params.status ?? ProductCatalogStatus.CONFIRMED,
      isConfirmed: params.isConfirmed ?? true,
      isHidden: params.isHidden ?? false,
      variants: {
        create: {
          volume: '0.75',
          volumeUnit: 'l',
          packagingType: 'glass',
        },
      },
    },
    include: { variants: true },
  })

  const supplierProduct = await prisma.supplierProduct.create({
    data: {
      supplierId: params.supplierId,
      productId: product.id,
      productVariantId: product.variants[0].id,
    },
  })

  await prisma.offer.create({
    data: {
      supplierProductId: supplierProduct.id,
      price: params.price ?? '1000',
      currency: 'RUB',
      unit: 'bottle',
      stockAvailable: params.stockAvailable,
      stockTotal: params.stockAvailable,
      deliveryDaysMin: params.deliveryDaysMax,
      deliveryDaysMax: params.deliveryDaysMax,
      availabilityLevel: OfferAvailabilityLevel.IN_STOCK,
      isAvailable: true,
      isCurrent: true,
      missingFromLatestPrice: false,
    },
  })

  return product
}

async function createProductWithSplitOffers(params: {
  supplierId: string
  name: string
  country: string
  categoryId?: string
}) {
  const product = await prisma.product.create({
    data: {
      name: params.name,
      translatedName: params.name,
      country: params.country,
      brand: `${TEST_PREFIX}-brand`,
      categoryId: params.categoryId,
      status: ProductCatalogStatus.CONFIRMED,
      isConfirmed: true,
      isHidden: false,
      variants: {
        create: { volume: '0.75', volumeUnit: 'l', packagingType: 'glass' },
      },
    },
    include: { variants: true },
  })

  const supplierProduct = await prisma.supplierProduct.create({
    data: {
      supplierId: params.supplierId,
      productId: product.id,
      productVariantId: product.variants[0].id,
    },
  })

  await prisma.offer.createMany({
    data: [
      {
        supplierProductId: supplierProduct.id,
        price: '7000',
        currency: 'RUB',
        unit: 'bottle',
        stockAvailable: 12,
        stockTotal: 12,
        deliveryDaysMin: 1,
        deliveryDaysMax: 1,
        availabilityLevel: OfferAvailabilityLevel.IN_STOCK,
        isAvailable: true,
        isCurrent: true,
        missingFromLatestPrice: false,
      },
      {
        supplierProductId: supplierProduct.id,
        price: '4000',
        currency: 'RUB',
        unit: 'bottle',
        stockAvailable: 12,
        stockTotal: 12,
        deliveryDaysMin: 7,
        deliveryDaysMax: 7,
        availabilityLevel: OfferAvailabilityLevel.IN_STOCK,
        isAvailable: true,
        isCurrent: true,
        missingFromLatestPrice: false,
      },
    ],
  })

  return product
}

async function createProductWithSplitVariants(params: {
  supplierId: string
  name: string
  country: string
  categoryId: string
}) {
  const product = await prisma.product.create({
    data: {
      name: params.name,
      translatedName: params.name,
      country: params.country,
      brand: `${TEST_PREFIX}-brand`,
      categoryId: params.categoryId,
      status: ProductCatalogStatus.CONFIRMED,
      isConfirmed: true,
      isHidden: false,
      variants: {
        create: [
          { volume: '0.75', volumeUnit: 'l', packagingType: 'can' },
          { volume: '0.33', volumeUnit: 'l', packagingType: 'glass' },
        ],
      },
    },
    include: { variants: true },
  })

  const supplierProduct = await prisma.supplierProduct.create({
    data: {
      supplierId: params.supplierId,
      productId: product.id,
      productVariantId: product.variants[0].id,
    },
  })

  await prisma.offer.create({
    data: {
      supplierProductId: supplierProduct.id,
      price: '1000',
      currency: 'RUB',
      unit: 'bottle',
      stockAvailable: 10,
      stockTotal: 10,
      deliveryDaysMin: 1,
      deliveryDaysMax: 1,
      availabilityLevel: OfferAvailabilityLevel.IN_STOCK,
      isAvailable: true,
      isCurrent: true,
      missingFromLatestPrice: false,
    },
  })

  return product
}

async function fetchJson(baseUrl: string, path: string) {
  const response = await fetch(`${baseUrl}${path}`)
  const json = (await response.json()) as any
  return { status: response.status, json }
}

async function main() {
  await cleanup()
  await ensureDefaultCatalogFacetRegistry()

  const server = app.listen(0)
  const serverReady = new Promise<void>((resolve) => server.once('listening', () => resolve()))

  try {
    await serverReady
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    const supplierA = await prisma.supplier.create({
      data: { name: `${TEST_PREFIX}-supplier-a-${randomUUID()}`, catalogName: `${TEST_PREFIX}-supplier-a`, isActive: true },
    })
    const supplierB = await prisma.supplier.create({
      data: { name: `${TEST_PREFIX}-supplier-b-${randomUUID()}`, catalogName: `${TEST_PREFIX}-supplier-b`, isActive: true },
    })

    // Категории созданы заранее (а не только в §3/§4), т.к. getCatalogProducts (реальный
    // листинг за /catalog/products) требует categoryId: { not: null } — товары без категории
    // в публичный список не попадают, даже если проходят facet-фильтр движка.
    const parentCategory = await prisma.catalogCategory.create({
      data: {
        name: `${TEST_PREFIX} parent`,
        code: `${TEST_PREFIX}-parent`,
        section: CatalogCategorySection.ALCOHOL,
        isTagActive: true,
        showInQuickFilters: true,
        isHidden: false,
      },
    })
    const childCategory = await prisma.catalogCategory.create({
      data: {
        name: `${TEST_PREFIX} child`,
        code: `${TEST_PREFIX}-child`,
        section: CatalogCategorySection.ALCOHOL,
        parentId: parentCategory.id,
        isTagActive: true,
        showInQuickFilters: true,
        isHidden: false,
      },
    })

    // ==================================================================
    // §1. OR внутри фасета, AND между фасетами
    // ==================================================================
    const orAndFrance = await createProductWithOffer({
      supplierId: supplierA.id,
      name: `${TEST_PREFIX}-or-and-france-${randomUUID()}`,
      country: 'France',
      brand: `${TEST_PREFIX}-brand-X`,
      categoryId: childCategory.id,
      deliveryDaysMax: 3,
      stockAvailable: 5,
    })
    const orAndItaly = await createProductWithOffer({
      supplierId: supplierA.id,
      name: `${TEST_PREFIX}-or-and-italy-${randomUUID()}`,
      country: 'Italy',
      brand: `${TEST_PREFIX}-brand-X`,
      categoryId: childCategory.id,
      deliveryDaysMax: 3,
      stockAvailable: 5,
    })
    const orAndSpainOtherBrand = await createProductWithOffer({
      supplierId: supplierA.id,
      name: `${TEST_PREFIX}-or-and-spain-${randomUUID()}`,
      country: 'Spain',
      brand: `${TEST_PREFIX}-brand-Y`,
      categoryId: childCategory.id,
      deliveryDaysMax: 3,
      stockAvailable: 5,
    })
    const orAndFranceOtherBrand = await createProductWithOffer({
      supplierId: supplierA.id,
      name: `${TEST_PREFIX}-or-and-france-y-${randomUUID()}`,
      country: 'France',
      brand: `${TEST_PREFIX}-brand-Y`,
      categoryId: childCategory.id,
      deliveryDaysMax: 3,
      stockAvailable: 5,
    })

    const orAndWhere = await buildCatalogFacetProductWhere({
      scope: FacetScope.CATALOG,
      selectedFacets: {
        // OR внутри фасета "country": France ИЛИ Italy
        country: ['France', 'Italy'],
        // AND с фасетом "brand": и то, и другое — brand-X
        brand: [`${TEST_PREFIX}-brand-X`],
      },
    })
    const orAndProducts = await prisma.product.findMany({ where: orAndWhere, select: { id: true } })
    const orAndIds = orAndProducts.map((p) => p.id)

    assert.ok(orAndIds.includes(orAndFrance.id), '§1: Франция + brand-X должна пройти (OR внутри country)')
    assert.ok(orAndIds.includes(orAndItaly.id), '§1: Италия + brand-X должна пройти (OR внутри country)')
    assert.ok(!orAndIds.includes(orAndSpainOtherBrand.id), '§1: Испания не входит в OR-набор country — должна быть отсеяна')
    assert.ok(
      !orAndIds.includes(orAndFranceOtherBrand.id),
      '§1: Франция проходит OR по country, но brand-Y не проходит AND по brand — должна быть отсеяна'
    )
    console.info('OK §1: OR внутри фасета, AND между фасетами')

    // ==================================================================
    // §2. offer-фильтры применяются к одному offer (не к разным офферам вперемешку)
    // ==================================================================
    const matchingProduct = await createProductWithOffer({
      supplierId: supplierA.id,
      name: `${TEST_PREFIX}-matching-${randomUUID()}`,
      country: 'France',
      categoryId: childCategory.id,
      deliveryDaysMax: 1,
      stockAvailable: 12,
    })
    const splitOfferProduct = await createProductWithOffer({
      supplierId: supplierA.id,
      name: `${TEST_PREFIX}-split-${randomUUID()}`,
      country: 'Italy',
      categoryId: childCategory.id,
      deliveryDaysMax: 7,
      stockAvailable: 12,
    })
    const splitMultiOfferProduct = await createProductWithSplitOffers({
      supplierId: supplierA.id,
      name: `${TEST_PREFIX}-split-multi-offer-${randomUUID()}`,
      country: 'Spain',
      categoryId: childCategory.id,
    })
    await createProductWithOffer({
      supplierId: supplierB.id,
      name: `${TEST_PREFIX}-split-second-offer-${randomUUID()}`,
      country: 'Italy',
      categoryId: childCategory.id,
      deliveryDaysMax: 1,
      stockAvailable: 12,
    })

    const offerWhere = await buildCatalogFacetProductWhere({
      scope: FacetScope.CATALOG,
      selectedFacets: {
        supplier: [supplierA.id],
        availability: ['ACTIVE'],
        delivery_days: ['tomorrow'],
        price: { max: 5000 },
      },
    })
    const offerProducts = await prisma.product.findMany({ where: offerWhere, select: { id: true } })
    const offerProductIds = offerProducts.map((p) => p.id)

    assert.ok(offerProductIds.includes(matchingProduct.id), '§2: товар с одним подходящим offer должен пройти')
    assert.ok(!offerProductIds.includes(splitOfferProduct.id), '§2: offer с доставкой 7 дней не должен пройти delivery_days=tomorrow')
    assert.ok(
      !offerProductIds.includes(splitMultiOfferProduct.id),
      '§2: два разных офферов (один дешёвый+долгий, другой дорогой+быстрый) не должны склеиваться в один проходящий результат'
    )
    console.info('OK §2: offer-фильтры применяются к одному offer')

    // ==================================================================
    // §3. category scope наследуется (родитель -> потомок)
    // ==================================================================
    const matchingVariantProduct = await createProductWithOffer({
      supplierId: supplierA.id,
      name: `${TEST_PREFIX}-matching-variant-${randomUUID()}`,
      country: 'France',
      categoryId: childCategory.id,
      deliveryDaysMax: 1,
      stockAvailable: 12,
    })
    const splitVariantProduct = await createProductWithSplitVariants({
      supplierId: supplierA.id,
      name: `${TEST_PREFIX}-split-variant-${randomUUID()}`,
      country: 'France',
      categoryId: childCategory.id,
    })
    const variantWhere = await buildCatalogFacetProductWhere({
      scope: FacetScope.CATALOG,
      categoryId: childCategory.id,
      selectedFacets: {
        volume: ['0.75'],
        packaging_type: ['glass'],
      },
    })
    const variantIds = (
      await prisma.product.findMany({ where: variantWhere, select: { id: true } })
    ).map((p) => p.id)
    assert.ok(
      variantIds.includes(matchingVariantProduct.id),
      '§2b: one variant with volume=0.75 and packagingType=glass must match'
    )
    assert.ok(
      !variantIds.includes(splitVariantProduct.id),
      '§2b: separate variants must not be combined into one matching variant'
    )

    const variantFacets = await getCatalogFacets({
      scope: FacetScope.CATALOG,
      categoryId: childCategory.id,
      selectedFacets: { volume: ['0.75'] },
      includeHiddenFacets: true,
    })
    const packagingFacet = variantFacets.facets.find((facet) => facet.key === 'packaging_type')
    const glassOption = packagingFacet?.options.find((option) => option.value === 'glass')
    const variantProductsResponse = await fetchJson(
      baseUrl,
      `/catalog/products?categoryId=${childCategory.id}&facet.volume=0.75&facet.packaging_type=glass&limit=100`
    )
    assert.strictEqual(variantProductsResponse.status, 200, '§2b: /catalog/products must respond 200')
    assert.ok(glassOption, '§2b: packaging_type=glass must be present in counters')
    assert.strictEqual(
      variantProductsResponse.json.total,
      glassOption!.count,
      '§2b: packaging_type=glass count with volume=0.75 must match product results'
    )
    console.info('OK §2b: variant filters and counters use one variant row')

    const parentCategoryProductsResponse = await fetchJson(
      baseUrl,
      `/catalog/products?categoryIds=${parentCategory.id}&limit=100`
    )
    assert.strictEqual(parentCategoryProductsResponse.status, 200, 'category parent query must respond 200')
    assert.ok(
      parentCategoryProductsResponse.json.items.some((item: any) => item.id === matchingVariantProduct.id),
      'category parent query must include child category products'
    )
    const narrowedCategoryProductsResponse = await fetchJson(
      baseUrl,
      `/catalog/products?categoryIds=${parentCategory.id}&categoryIds=${childCategory.id}&limit=100`
    )
    assert.strictEqual(narrowedCategoryProductsResponse.status, 200, 'category parent+child query must respond 200')
    assert.deepStrictEqual(
      narrowedCategoryProductsResponse.json.appliedCategoryIds,
      [childCategory.id],
      'selected parent category must collapse to selected child category'
    )
    console.info('OK category subtree expansion and deepest-node narrowing')

    const offerFacets = await getCatalogFacets({
      scope: FacetScope.CATALOG,
      selectedFacets: {
        availability: ['ACTIVE'],
        delivery_days: ['tomorrow'],
        price: { max: 5000 },
      },
      includeHiddenFacets: true,
    })
    const supplierFacet = offerFacets.facets.find((facet) => facet.key === 'supplier')
    const supplierAOption = supplierFacet?.options.find((option) => option.value === supplierA.id)
    const offerProductsResponse = await fetchJson(
      baseUrl,
      `/catalog/products?facet.supplier=${supplierA.id}&facet.availability=ACTIVE&facet.delivery_days=tomorrow&facets=${encodeURIComponent(JSON.stringify({ price: { max: 5000 } }))}&limit=100`
    )
    assert.strictEqual(offerProductsResponse.status, 200, '§2c: /catalog/products must respond 200')
    assert.ok(supplierAOption, '§2c: supplierA must be present in counters')
    assert.strictEqual(
      offerProductsResponse.json.total,
      supplierAOption!.count,
      '§2c: supplierA count with availability+delivery+price must match product results'
    )
    console.info('OK §2c: offer filters and counters use one offer row')

    const scopedFacet = await prisma.facetRegistryEntry.create({
      data: {
        key: `${TEST_PREFIX}-scoped-facet`,
        label: 'Test scoped facet',
        type: 'CHIPS',
        level: 'PRODUCT',
        scopes: [FacetScope.CATALOG],
        categoryId: parentCategory.id,
        dataSource: 'product.country',
        optionSource: 'DYNAMIC',
        minFillRate: '0',
        sortOrder: 999,
      },
    })

    const childScopedFacets = await getCatalogFacets({
      scope: FacetScope.CATALOG,
      categoryId: childCategory.id,
      includeHiddenFacets: true,
    })
    assert.ok(
      childScopedFacets.facets.some((facet) => facet.key === scopedFacet.key),
      '§3: фасет, объявленный на родительской категории (facet.categoryId=parent), должен быть виден при запросе дочерней категории'
    )
    console.info('OK §3: category scope наследуется от родителя к потомку')

    await prisma.facetRegistryEntry.delete({ where: { id: scopedFacet.id } })

    // ==================================================================
    // §4. hidden/inactive category не попадает в public
    // ==================================================================
    const hiddenCategory = await prisma.catalogCategory.create({
      data: {
        name: `${TEST_PREFIX} hidden`,
        code: `${TEST_PREFIX}-hidden`,
        section: CatalogCategorySection.ALCOHOL,
        isTagActive: true,
        showInQuickFilters: true,
        isHidden: true,
      },
    })
    const productInHiddenCategory = await createProductWithOffer({
      supplierId: supplierA.id,
      name: `${TEST_PREFIX}-in-hidden-category-${randomUUID()}`,
      country: 'Portugal',
      categoryId: hiddenCategory.id,
      deliveryDaysMax: 1,
      stockAvailable: 5,
    })

    const publicWhereWithHiddenCategory = await buildCatalogFacetProductWhere({ scope: FacetScope.CATALOG })
    const publicProductsAll = await prisma.product.findMany({ where: publicWhereWithHiddenCategory, select: { id: true } })
    assert.ok(
      !publicProductsAll.some((p) => p.id === productInHiddenCategory.id),
      '§4: товар в скрытой (isHidden) категории не должен проходить публичный CATALOG-фильтр'
    )

    const adminWhereWithHiddenCategory = await buildCatalogFacetProductWhere({ scope: FacetScope.ADMIN_CATALOG })
    const adminProductsAll = await prisma.product.findMany({ where: adminWhereWithHiddenCategory, select: { id: true } })
    assert.ok(
      adminProductsAll.some((p) => p.id === productInHiddenCategory.id),
      '§4: тот же товар должен быть виден в ADMIN_CATALOG (админка не режет по скрытой категории)'
    )
    console.info('OK §4: hidden category не попадает в public, но видна в ADMIN_CATALOG')

    // ==================================================================
    // §5. selected facet не исчезает при counters = 1 (гистерезис)
    // ==================================================================
    const onlyFranceLeft = await getCatalogFacets({
      scope: FacetScope.CATALOG,
      selectedFacets: {
        country: ['France'],
        brand: [`${TEST_PREFIX}-brand-X`], // сужаем так, что для country среди подходящих товаров останется только France
      },
    })
    const countryFacetNarrowed = onlyFranceLeft.facets.find((facet) => facet.key === 'country')
    assert.ok(countryFacetNarrowed, '§5: фасет country должен остаться в списке, даже если применённый выбор сузил варианты')
    assert.ok(
      countryFacetNarrowed!.options.some((option) => option.value === 'France' && option.selected),
      '§5: выбранное значение France должно остаться selected=true, даже если это единственный оставшийся вариант'
    )
    console.info('OK §5: selected facet не исчезает при counters = 1')

    // ==================================================================
    // §6. "Не указано" работает для NULL
    // ==================================================================
    const colorRed = await createProductWithOffer({
      supplierId: supplierA.id,
      name: `${TEST_PREFIX}-color-red-${randomUUID()}`,
      country: 'France',
      color: 'Красное',
      categoryId: childCategory.id,
      deliveryDaysMax: 1,
      stockAvailable: 5,
    })
    const colorNull = await createProductWithOffer({
      supplierId: supplierA.id,
      name: `${TEST_PREFIX}-color-null-${randomUUID()}`,
      country: 'France',
      color: null,
      categoryId: childCategory.id,
      deliveryDaysMax: 1,
      stockAvailable: 5,
    })

    const colorFacets = await getCatalogFacets({
      scope: FacetScope.CATALOG,
      categoryId: childCategory.id,
      includeHiddenFacets: true,
    })
    const colorFacet = colorFacets.facets.find((facet) => facet.key === 'color')
    assert.ok(colorFacet, '§6: фасет color должен резолвиться для категории секции ALCOHOL')
    const unspecifiedOption = colorFacet!.options.find((option) => option.value === UNSPECIFIED_FACET_VALUE)
    assert.ok(unspecifiedOption, '§6: при частичной заполненности должна появляться опция "Не указано"')
    assert.ok(unspecifiedOption!.count >= 1, '§6: счётчик "Не указано" должен учитывать товар с color=NULL')

    const withoutUnspecifiedWhere = await buildCatalogFacetProductWhere({
      scope: FacetScope.CATALOG,
      categoryId: childCategory.id,
      selectedFacets: { color: ['Красное'] },
    })
    const withoutUnspecifiedIds = (await prisma.product.findMany({ where: withoutUnspecifiedWhere, select: { id: true } })).map((p) => p.id)
    assert.ok(withoutUnspecifiedIds.includes(colorRed.id), '§6: явный выбор "Красное" должен вернуть товар с этим цветом')
    assert.ok(!withoutUnspecifiedIds.includes(colorNull.id), '§6: явный выбор "Красное" НЕ должен возвращать товар с color=NULL по умолчанию')

    const withUnspecifiedWhere = await buildCatalogFacetProductWhere({
      scope: FacetScope.CATALOG,
      categoryId: childCategory.id,
      selectedFacets: { color: [UNSPECIFIED_FACET_VALUE] },
    })
    const withUnspecifiedIds = (await prisma.product.findMany({ where: withUnspecifiedWhere, select: { id: true } })).map((p) => p.id)
    assert.ok(withUnspecifiedIds.includes(colorNull.id), '§6: явный выбор "Не указано" должен вернуть товар с color=NULL')
    assert.ok(!withUnspecifiedIds.includes(colorRed.id), '§6: явный выбор "Не указано" не должен возвращать товар с заполненным color')
    console.info('OK §6: "Не указано" работает для NULL')

    // ==================================================================
    // §7. /catalog/facets и /catalog/products дают согласованные counts/items
    // ==================================================================
    const facetsResponse = await fetchJson(baseUrl, `/catalog/facets?facet.country=France`)
    assert.strictEqual(facetsResponse.status, 200, '§7: /catalog/facets должен отвечать 200')
    const brandFacetFromHttp = facetsResponse.json.facets.find((facet: any) => facet.key === 'brand')
    assert.ok(brandFacetFromHttp, '§7: /catalog/facets должен вернуть фасет brand при фильтре по country=France')
    const brandXOption = brandFacetFromHttp.options.find((option: any) => option.value === `${TEST_PREFIX}-brand-X`)
    assert.ok(brandXOption, '§7: среди опций brand при country=France должен быть brand-X')

    const productsResponse = await fetchJson(
      baseUrl,
      `/catalog/products?facet.country=France&facet.brand=${encodeURIComponent(`${TEST_PREFIX}-brand-X`)}&limit=100`
    )
    assert.strictEqual(productsResponse.status, 200, '§7: /catalog/products должен отвечать 200')
    assert.strictEqual(
      productsResponse.json.total,
      brandXOption.count,
      '§7: total из /catalog/products должен совпадать со count опции brand-X, посчитанным в /catalog/facets (при том же country=France)'
    )
    assert.strictEqual(
      productsResponse.json.items.length,
      productsResponse.json.total,
      '§7: при limit больше total все найденные товары должны быть возвращены в items'
    )
    console.info('OK §7: /catalog/facets и /catalog/products дают согласованные counts/items')

    // ==================================================================
    // §8. admin catalog видит больше, чем public catalog
    // ==================================================================
    const legacyProductsResponse = await fetchJson(
      baseUrl,
      `/products?facet.country=France&facet.brand=${encodeURIComponent(`${TEST_PREFIX}-brand-X`)}&limit=100`
    )
    assert.strictEqual(legacyProductsResponse.status, 200, '§7b: legacy /products must respond 200')
    assert.strictEqual(
      legacyProductsResponse.json.data.total,
      productsResponse.json.total,
      '§7b: legacy /products facet filtering must match /catalog/products total'
    )
    assert.ok(
      Array.isArray(legacyProductsResponse.json.data.facets),
      '§7b: legacy /products must expose data.facets for dynamic filter UI'
    )
    assert.deepStrictEqual(
      legacyProductsResponse.json.data.appliedFacets.brand,
      [`${TEST_PREFIX}-brand-X`],
      '§7b: legacy /products must expose data.appliedFacets'
    )
    console.info('OK §7b: legacy /products supports facet query and response metadata')

    const draftProduct = await createProductWithOffer({
      supplierId: supplierA.id,
      name: `${TEST_PREFIX}-draft-${randomUUID()}`,
      country: 'Germany',
      deliveryDaysMax: 1,
      stockAvailable: 5,
      status: ProductCatalogStatus.NEEDS_REVIEW,
      isConfirmed: false,
    })
    const hiddenProduct = await createProductWithOffer({
      supplierId: supplierA.id,
      name: `${TEST_PREFIX}-hidden-product-${randomUUID()}`,
      country: 'Germany',
      deliveryDaysMax: 1,
      stockAvailable: 5,
      isHidden: true,
    })

    const publicIds = (
      await prisma.product.findMany({ where: await buildCatalogFacetProductWhere({ scope: FacetScope.CATALOG }), select: { id: true } })
    ).map((p) => p.id)
    const adminIds = (
      await prisma.product.findMany({
        where: await buildCatalogFacetProductWhere({ scope: FacetScope.ADMIN_CATALOG }),
        select: { id: true },
      })
    ).map((p) => p.id)

    assert.ok(!publicIds.includes(draftProduct.id), '§8: неподтверждённый (NEEDS_REVIEW) товар не должен быть в публичном каталоге')
    assert.ok(!publicIds.includes(hiddenProduct.id), '§8: скрытый товар не должен быть в публичном каталоге')
    assert.ok(adminIds.includes(draftProduct.id), '§8: ADMIN_CATALOG должен видеть неподтверждённый товар')
    assert.ok(adminIds.includes(hiddenProduct.id), '§8: ADMIN_CATALOG должен видеть скрытый товар')
    assert.ok(
      adminIds.length > publicIds.length,
      '§8: ADMIN_CATALOG в сумме должен видеть строго больше товаров, чем публичный CATALOG'
    )
    console.info('OK §8: admin catalog видит больше, чем public catalog')

    console.info('\n[catalog-filter-engine] все проверки (§1-§8) прошли успешно')
  } finally {
    server.close()
    await cleanup()
    await prisma.$disconnect()
  }
}

main().catch(async (error) => {
  console.error('[catalog-filter-engine] failed:', error)
  await prisma.$disconnect()
  process.exit(1)
})
