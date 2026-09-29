import {
  PrismaClient,
  UserStatus,
  AccessLevel,
  MembershipStatus,
  DisplayRole,
  OfferAvailabilityLevel,
  ContractSupplierStatus,
  PriceImportSourceFormat,
  Prisma,
} from '../src/generated/prisma'

const prisma = new PrismaClient()

async function ensureCatalogCategory(params: {
  name: string
  code: string
  parentId: string | null
}) {
  const existing = await prisma.catalogCategory.findFirst({
    where: {
      name: params.name,
      parentId: params.parentId,
    },
  })

  if (!existing) {
    return prisma.catalogCategory.create({
      data: {
        name: params.name,
        code: params.code,
        parentId: params.parentId,
      },
    })
  }

  if (existing.code !== params.code) {
    return prisma.catalogCategory.update({
      where: { id: existing.id },
      data: { code: params.code },
    })
  }

  return existing
}

async function ensureProductVariant(params: {
  productId: string
  volume: number | null
  volumeUnit: string | null
  packageSize?: number | null
  packageSizeUnit?: string | null
}) {
  const existing = await prisma.productVariant.findFirst({
    where: {
      productId: params.productId,
      volume: params.volume,
      volumeUnit: params.volumeUnit,
    },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  })

  if (existing) {
    return prisma.productVariant.update({
      where: { id: existing.id },
      data: {
        isDefault: true,
        packageSize: params.packageSize ?? undefined,
        packageSizeUnit: params.packageSizeUnit ?? undefined,
      },
    })
  }

  return prisma.productVariant.create({
    data: {
      productId: params.productId,
      volume: params.volume,
      volumeUnit: params.volumeUnit,
      packageSize: params.packageSize ?? undefined,
      packageSizeUnit: params.packageSizeUnit ?? undefined,
      isDefault: true,
    },
  })
}

async function ensureSupplierImportProfile(params: {
  code: string
  name: string
  rulesJson: Prisma.InputJsonObject
  isDefault?: boolean
}) {
  const existing = await prisma.supplierImportProfile.findFirst({
    where: {
      supplierId: null,
      code: params.code,
      version: 1,
    },
  })

  const data = {
    supplierId: null,
    code: params.code,
    name: params.name,
    version: 1,
    isActive: true,
    isDefault: params.isDefault ?? false,
    sourceFormat: PriceImportSourceFormat.XLSX,
    rulesJson: params.rulesJson,
    confirmedAt: new Date(),
  }

  if (existing) {
    return prisma.supplierImportProfile.update({
      where: { id: existing.id },
      data,
    })
  }

  return prisma.supplierImportProfile.create({ data })
}

async function seedSupplierImportProfiles() {
  const baseRules = {
    parser: {
      sheetDetection: 'profile',
      headerDetection: 'keywords',
      rowClassification: ['context', 'product', 'continuation', 'ignored'],
    },
    identity: {
      primary: ['barcode'],
      supplierScoped: ['supplierArticle', 'supplierSku', 'code7'],
      fallback: ['normalizedName', 'volumeMl', 'vintage', 'packageType'],
      confidence: { autoMatchFrom: 95, reviewFrom: 80 },
    },
    publishing: {
      closePreviousOffers: true,
      markMissingOffersUnavailable: true,
      doNotOverwriteProductSilently: true,
    },
  }

  const profiles = [
    {
      code: 'default',
      name: 'Default supplier price profile',
      isDefault: true,
      rulesJson: {
        ...baseRules,
        sheets: { include: ['*'], exclude: [] },
        columns: {
          name: ['name', 'название', 'товар'],
          price: ['price', 'цена'],
          stock: ['stock', 'остаток', 'количество'],
          barcode: ['barcode', 'штрихкод'],
          supplierArticle: ['article', 'артикул', 'код'],
        },
      },
    },
    {
      code: 'beluga',
      name: 'Beluga price profile',
      rulesJson: {
        ...baseRules,
        sheets: { include: ['Крепкий алкоголь', 'ВИНО'], exclude: [] },
        identity: {
          ...baseRules.identity,
          primary: [],
          fallback: ['supplierId', 'sheetName', 'normalizedName', 'volumeMl', 'vintage', 'packageType'],
        },
        contextRows: ['category', 'country', 'region', 'producer'],
      },
    },
    {
      code: 'simple',
      name: 'Simple price profile',
      rulesJson: {
        ...baseRules,
        sheets: { include: ['*'], exclude: ['титул', 'toc', 'оглавление'] },
        repeatedHeaders: true,
        inheritPreviousNameForVariantRows: true,
        columns: { supplierArticle: ['Код'], price: ['Цена'], name: ['Наименование'] },
      },
    },
    {
      code: 'ast',
      name: 'AST price profile',
      rulesJson: {
        ...baseRules,
        header: { strategy: 'multiRow' },
        columns: { supplierArticle: ['код', 'code'], supplierCode7: ['code7'], priceTiers: ['цена*'] },
        warehouses: { strategy: 'multipleColumns', includeReserves: true },
      },
    },
    {
      code: 'vinoterra',
      name: 'Vinoterra price profile',
      rulesJson: {
        ...baseRules,
        header: { strategy: 'multiRow' },
        supplierArticle: { parseAlternativesInParentheses: true },
      },
    },
    {
      code: 'ladoga',
      name: 'Ladoga price profile',
      rulesJson: {
        ...baseRules,
        mergeRows: { continuationRows: true, inheritContext: true },
      },
    },
    {
      code: 'smak',
      name: 'SMAK price profile',
      rulesJson: {
        ...baseRules,
        columns: { barcode: ['штрихкод'], stock: ['Количество (шт)'] },
        stock: { ambiguousQuantityNeedsReview: true },
      },
    },
  ]

  for (const profile of profiles) {
    await ensureSupplierImportProfile(profile)
  }
}

async function main() {
  const cuisines = ['Бар', 'Винный бар', 'Ресторан', 'Гастробар']

  for (const name of cuisines) {
    await prisma.cuisineType.upsert({
      where: { name },
      update: {},
      create: { name },
    })
  }

  const alcohol = await ensureCatalogCategory({
    name: 'Алкоголь',
    code: 'alcohol',
    parentId: null,
  })

  const wine = await ensureCatalogCategory({
    name: 'Вино',
    code: 'wine',
    parentId: alcohol.id,
  })

  const beer = await ensureCatalogCategory({
    name: 'Пиво',
    code: 'beer',
    parentId: alcohol.id,
  })

  const business = await prisma.business.upsert({
    where: { taxNumber: '7700000000' },
    update: {},
    create: {
      name: 'Demo Hospitality Group',
      taxNumber: '7700000000',
      legalAddress: 'Москва, ул. Примерная, 1',
    },
  })

  const venue = await prisma.venue.upsert({
    where: { id: '11111111-1111-1111-1111-111111111111' },
    update: {},
    create: {
      id: '11111111-1111-1111-1111-111111111111',
      businessId: business.id,
      name: 'Demo Wine Bar',
      city: 'Москва',
      address: 'ул. Примерная, 10',
      phone: '+79990000000',
      email: 'bar@example.com',
      website: 'https://example.com',
      contactPersonName: 'Александра',
      seatsCount: 40,
      showAdminContactsToSuppliers: true,
      isActive: true,
    },
  })

  const wineBarCuisine = await prisma.cuisineType.findFirstOrThrow({
    where: { name: 'Винный бар' },
  })

  await prisma.venueCuisineType.upsert({
    where: {
      venueId_cuisineTypeId: {
        venueId: venue.id,
        cuisineTypeId: wineBarCuisine.id,
      },
    },
    update: {},
    create: {
      venueId: venue.id,
      cuisineTypeId: wineBarCuisine.id,
    },
  })

  const user = await prisma.user.upsert({
    where: { email: 'owner@barello.demo' },
    update: {},
    create: {
      email: 'owner@barello.demo',
      passwordHash: 'demo_hash',
      status: UserStatus.ACTIVE,
      profile: {
        create: {
          firstName: 'Александра',
          lastName: 'Demo',
        },
      },
    },
    include: {
      profile: true,
    },
  })

  await prisma.userVenueMembership.upsert({
    where: {
      userId_venueId: {
        userId: user.id,
        venueId: venue.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      venueId: venue.id,
      displayRole: DisplayRole.OWNER,
      accessLevel: AccessLevel.ADMIN,
      membershipStatus: MembershipStatus.ACTIVE,
      joinedAt: new Date(),
      confirmedByUserId: user.id,
    },
  })

  let supplier = await prisma.supplier.findFirst({
    where: { email: 'supplier@barello.demo' },
  })

  if (!supplier) {
    supplier = await prisma.supplier.create({
      data: {
        name: 'Demo Supplier',
        city: 'Москва',
        address: 'ул. Складская, 5',
        contactName: 'Менеджер поставщика',
        phone: '+79991111111',
        email: 'supplier@barello.demo',
        website: 'https://supplier.example.com',
        passwordHash: 'demo_hash',
        isActive: true,
      },
    })
  }

  await prisma.contractSupplier.upsert({
    where: {
      venueId_supplierId: {
        venueId: venue.id,
        supplierId: supplier.id,
      },
    },
    update: {},
    create: {
      venueId: venue.id,
      supplierId: supplier.id,
      priority: 1,
      isActive: true,
      status: ContractSupplierStatus.ACTIVE,
    },
  })

  const productWine = await prisma.product.upsert({
    where: { barcode: '460000000001' },
    update: {},
    create: {
      name: 'Вино красное сухое Demo',
      categoryId: wine.id,
      description: 'Тестовая позиция вина',
      barcode: '460000000001',
      manufacturer: 'Demo Winery',
      translatedName: 'Demo Red Dry Wine',
      packageVolume: 0.75,
      packageVolumeUnit: 'L',
      packageQuantity: 1,
      isPromo: false,
    },
  })

  const productBeer = await prisma.product.upsert({
    where: { barcode: '460000000002' },
    update: {},
    create: {
      name: 'Эль светлый Demo',
      categoryId: beer.id,
      description: 'Тестовая позиция пива',
      barcode: '460000000002',
      manufacturer: 'Demo Brewery',
      translatedName: 'Demo Pale Ale',
      packageVolume: 0.5,
      packageVolumeUnit: 'L',
      packageQuantity: 1,
      isPromo: false,
    },
  })

  const productBeer2 = await prisma.product.upsert({
    where: { barcode: '460000000003' },
    update: {},
    create: {
      name: 'Стаут Demo',
      categoryId: beer.id,
      description: 'Тестовая позиция стаута',
      barcode: '460000000003',
      manufacturer: 'Demo Brewery',
      translatedName: 'Demo Stout',
      packageVolume: 0.33,
      packageVolumeUnit: 'L',
      packageQuantity: 1,
      isPromo: true,
    },
  })

  const productWineVariant = await ensureProductVariant({
    productId: productWine.id,
    volume: 0.75,
    volumeUnit: 'L',
    packageSize: 1,
    packageSizeUnit: 'PCS',
  })
  const productBeerVariant = await ensureProductVariant({
    productId: productBeer.id,
    volume: 0.5,
    volumeUnit: 'L',
    packageSize: 1,
    packageSizeUnit: 'PCS',
  })
  const productBeer2Variant = await ensureProductVariant({
    productId: productBeer2.id,
    volume: 0.33,
    volumeUnit: 'L',
    packageSize: 1,
    packageSizeUnit: 'PCS',
  })

  const supplierProductWine = await prisma.supplierProduct.upsert({
    where: {
      supplierId_productId_productVariantId: {
        supplierId: supplier.id,
        productId: productWine.id,
        productVariantId: productWineVariant.id,
      },
    },
    update: {},
    create: {
      supplierId: supplier.id,
      productId: productWine.id,
      productVariantId: productWineVariant.id,
      supplierSku: 'WINE-001',
    },
  })

  const supplierProductBeer = await prisma.supplierProduct.upsert({
    where: {
      supplierId_productId_productVariantId: {
        supplierId: supplier.id,
        productId: productBeer.id,
        productVariantId: productBeerVariant.id,
      },
    },
    update: {},
    create: {
      supplierId: supplier.id,
      productId: productBeer.id,
      productVariantId: productBeerVariant.id,
      supplierSku: 'BEER-001',
    },
  })

  const supplierProductBeer2 = await prisma.supplierProduct.upsert({
    where: {
      supplierId_productId_productVariantId: {
        supplierId: supplier.id,
        productId: productBeer2.id,
        productVariantId: productBeer2Variant.id,
      },
    },
    update: {},
    create: {
      supplierId: supplier.id,
      productId: productBeer2.id,
      productVariantId: productBeer2Variant.id,
      supplierSku: 'BEER-002',
    },
  })

  await prisma.offer.createMany({
    data: [
      {
        supplierProductId: supplierProductWine.id,
        price: 1290,
        currency: 'RUB',
        unit: 'bottle',
        minOrderQty: 1,
        availabilityLevel: OfferAvailabilityLevel.IN_STOCK,
        deliveryTerm: '1-2 дня',
        specialOfferText: 'Контрактная цена',
        isAvailable: true,
      },
      {
        supplierProductId: supplierProductBeer.id,
        price: 210,
        currency: 'RUB',
        unit: 'bottle',
        minOrderQty: 12,
        availabilityLevel: OfferAvailabilityLevel.IN_STOCK,
        deliveryTerm: 'На следующий день',
        isAvailable: true,
      },
      {
        supplierProductId: supplierProductBeer2.id,
        price: 260,
        currency: 'RUB',
        unit: 'bottle',
        minOrderQty: 6,
        availabilityLevel: OfferAvailabilityLevel.LOW_STOCK,
        specialOfferText: 'Промо-лот',
        isAvailable: true,
      },
    ],
    skipDuplicates: true,
  })

  await seedSupplierImportProfiles()

  console.log('Seed completed successfully')
}

main()
  .catch((error) => {
    console.error('Seed failed:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
