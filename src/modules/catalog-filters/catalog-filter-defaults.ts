import {
  FacetLevel,
  FacetOptionSource,
  FacetScope,
  FacetType,
  Prisma,
} from '../../generated/prisma'
import { prisma } from '../../lib/prisma'

type DefaultFacetOption = {
  value: string
  label: string
  sortOrder?: number
  metadata?: Prisma.InputJsonValue
}

type DefaultFacet = {
  key: string
  label: string
  type: FacetType
  level: FacetLevel
  scopes: FacetScope[]
  dataSource: string
  optionSource: FacetOptionSource
  categoryScope?: Prisma.InputJsonValue
  minFillRate?: string
  sortOrder: number
  options?: DefaultFacetOption[]
}

export const DEFAULT_CATALOG_FACETS: DefaultFacet[] = [
  {
    key: 'availability',
    label: 'Наличие',
    type: FacetType.CHIPS,
    level: FacetLevel.OFFER,
    scopes: [FacetScope.CATALOG, FacetScope.PRICE_IMPORT],
    dataSource: 'offer.availability',
    optionSource: FacetOptionSource.STATIC,
    sortOrder: 10,
    options: [
      { value: 'ACTIVE', label: 'В наличии', sortOrder: 10 },
      { value: 'ORDERABLE', label: 'Под заказ', sortOrder: 20 },
      { value: 'SOLD_OUT', label: 'Нет в наличии', sortOrder: 30 },
    ],
  },
  {
    key: 'delivery_days',
    label: 'Срок доставки',
    type: FacetType.CHIPS,
    level: FacetLevel.OFFER,
    scopes: [FacetScope.CATALOG],
    dataSource: 'offer.deliveryDays',
    optionSource: FacetOptionSource.STATIC,
    sortOrder: 20,
    options: [
      { value: 'today', label: 'Сегодня', sortOrder: 10 },
      { value: 'tomorrow', label: 'Завтра', sortOrder: 20 },
      { value: 'up_to_3', label: 'До 3 дней', sortOrder: 30 },
      { value: 'up_to_7', label: 'До 7 дней', sortOrder: 40 },
    ],
  },
  {
    key: 'supplier',
    label: 'Поставщик',
    type: FacetType.MULTISELECT,
    level: FacetLevel.OFFER,
    scopes: [FacetScope.CATALOG],
    dataSource: 'offer.supplierId',
    optionSource: FacetOptionSource.DYNAMIC,
    sortOrder: 30,
  },
  {
    key: 'stock_level',
    label: 'Остаток',
    type: FacetType.CHIPS,
    level: FacetLevel.OFFER,
    scopes: [FacetScope.CATALOG],
    dataSource: 'offer.stockLevel',
    optionSource: FacetOptionSource.STATIC,
    sortOrder: 40,
    options: [
      { value: 'high', label: 'Много на складе', sortOrder: 10 },
      { value: 'limited', label: 'Ограниченный остаток', sortOrder: 20 },
    ],
  },
  {
    key: 'price',
    label: 'Цена',
    type: FacetType.RANGE,
    level: FacetLevel.OFFER,
    scopes: [FacetScope.CATALOG],
    dataSource: 'offer.price',
    optionSource: FacetOptionSource.DYNAMIC,
    sortOrder: 50,
  },
  {
    key: 'brand',
    label: 'Бренд',
    type: FacetType.MULTISELECT,
    level: FacetLevel.PRODUCT,
    scopes: [
      FacetScope.CATALOG,
      FacetScope.ADMIN_CATALOG,
      FacetScope.PRICE_IMPORT,
      FacetScope.VENUE_STOCK,
      FacetScope.SUPPLIER_STOCK,
      FacetScope.MENU,
      FacetScope.INVENTORY,
    ],
    dataSource: 'product.brand',
    optionSource: FacetOptionSource.DYNAMIC,
    sortOrder: 100,
  },
  {
    key: 'producer',
    label: 'Производитель',
    type: FacetType.MULTISELECT,
    level: FacetLevel.PRODUCT,
    scopes: [FacetScope.CATALOG, FacetScope.ADMIN_CATALOG, FacetScope.PRICE_IMPORT],
    dataSource: 'product.producer',
    optionSource: FacetOptionSource.DYNAMIC,
    sortOrder: 110,
  },
  {
    key: 'country',
    label: 'Страна',
    type: FacetType.MULTISELECT,
    level: FacetLevel.PRODUCT,
    scopes: [
      FacetScope.CATALOG,
      FacetScope.ADMIN_CATALOG,
      FacetScope.PRICE_IMPORT,
      FacetScope.VENUE_STOCK,
      FacetScope.SUPPLIER_STOCK,
      FacetScope.MENU,
      FacetScope.INVENTORY,
    ],
    dataSource: 'product.country',
    optionSource: FacetOptionSource.DYNAMIC,
    sortOrder: 120,
  },
  {
    key: 'region',
    label: 'Регион',
    type: FacetType.MULTISELECT,
    level: FacetLevel.PRODUCT,
    scopes: [FacetScope.CATALOG, FacetScope.ADMIN_CATALOG, FacetScope.PRICE_IMPORT],
    dataSource: 'product.region',
    optionSource: FacetOptionSource.DYNAMIC,
    sortOrder: 130,
  },
  {
    key: 'color',
    label: 'Цвет',
    type: FacetType.CHIPS,
    level: FacetLevel.PRODUCT,
    scopes: [
      FacetScope.CATALOG,
      FacetScope.ADMIN_CATALOG,
      FacetScope.PRICE_IMPORT,
      FacetScope.VENUE_STOCK,
      FacetScope.SUPPLIER_STOCK,
      FacetScope.MENU,
      FacetScope.INVENTORY,
    ],
    dataSource: 'product.color',
    optionSource: FacetOptionSource.STATIC,
    categoryScope: {
      sections: ['ALCOHOL'],
      includeDescendants: true,
    },
    sortOrder: 140,
    options: [
      { value: 'Красное', label: 'Красное', sortOrder: 10 },
      { value: 'Белое', label: 'Белое', sortOrder: 20 },
      { value: 'Розовое', label: 'Розовое', sortOrder: 30 },
      { value: 'Оранжевое', label: 'Оранжевое', sortOrder: 40 },
    ],
  },
  {
    key: 'sugar',
    label: 'Сахар',
    type: FacetType.CHIPS,
    level: FacetLevel.PRODUCT,
    scopes: [FacetScope.CATALOG, FacetScope.ADMIN_CATALOG, FacetScope.PRICE_IMPORT],
    dataSource: 'product.sugar',
    optionSource: FacetOptionSource.STATIC,
    categoryScope: {
      sections: ['ALCOHOL'],
      includeDescendants: true,
    },
    sortOrder: 150,
    options: [
      { value: 'Сухое', label: 'Сухое', sortOrder: 10 },
      { value: 'Полусухое', label: 'Полусухое', sortOrder: 20 },
      { value: 'Полусладкое', label: 'Полусладкое', sortOrder: 30 },
      { value: 'Сладкое', label: 'Сладкое', sortOrder: 40 },
      { value: 'Брют натюр', label: 'Брют натюр', sortOrder: 50 },
      { value: 'Экстра брют', label: 'Экстра брют', sortOrder: 60 },
      { value: 'Брют', label: 'Брют', sortOrder: 70 },
      { value: 'Экстра драй', label: 'Экстра драй', sortOrder: 80 },
      { value: 'Драй', label: 'Драй', sortOrder: 90 },
      { value: 'Деми-сек', label: 'Деми-сек', sortOrder: 100 },
      { value: 'Ду', label: 'Ду', sortOrder: 110 },
    ],
  },
  {
    key: 'volume',
    label: 'Объем',
    type: FacetType.BUCKET,
    level: FacetLevel.VARIANT,
    scopes: [FacetScope.CATALOG, FacetScope.ADMIN_CATALOG, FacetScope.PRICE_IMPORT],
    dataSource: 'variant.volume',
    optionSource: FacetOptionSource.DYNAMIC,
    sortOrder: 160,
  },
  {
    key: 'packaging_type',
    label: 'Тип упаковки',
    type: FacetType.CHIPS,
    level: FacetLevel.VARIANT,
    scopes: [FacetScope.CATALOG, FacetScope.ADMIN_CATALOG, FacetScope.PRICE_IMPORT],
    dataSource: 'variant.packagingType',
    optionSource: FacetOptionSource.DYNAMIC,
    sortOrder: 170,
  },
  {
    key: 'packaging_options',
    label: 'Опции упаковки',
    type: FacetType.CHIPS,
    level: FacetLevel.PRODUCT,
    scopes: [FacetScope.CATALOG, FacetScope.ADMIN_CATALOG, FacetScope.PRICE_IMPORT],
    dataSource: 'product.attributesJson.packagingOptions',
    optionSource: FacetOptionSource.DYNAMIC,
    sortOrder: 175,
  },
  // VENUE_STOCK / SUPPLIER_STOCK / INVENTORY: InventoryItem/SupplierInventoryItem have no
  // variant sub-entity (a single row can't distinguish which ProductVariant it's stocking as),
  // so these read the stock row itself via the `stock.` dataSource prefix instead of `variant.`.
  {
    key: 'stock_quantity',
    label: 'Количество на складе',
    type: FacetType.RANGE,
    level: FacetLevel.PRODUCT,
    scopes: [FacetScope.VENUE_STOCK, FacetScope.SUPPLIER_STOCK, FacetScope.INVENTORY],
    dataSource: 'stock.quantity',
    optionSource: FacetOptionSource.DYNAMIC,
    sortOrder: 200,
  },
  {
    key: 'stock_out_of_stock',
    label: 'Нет в наличии',
    type: FacetType.TOGGLE,
    level: FacetLevel.PRODUCT,
    scopes: [FacetScope.VENUE_STOCK, FacetScope.SUPPLIER_STOCK, FacetScope.INVENTORY],
    dataSource: 'stock.isOutOfStock',
    optionSource: FacetOptionSource.DYNAMIC,
    sortOrder: 210,
  },
  {
    key: 'stock_unit',
    label: 'Единица измерения',
    type: FacetType.CHIPS,
    level: FacetLevel.PRODUCT,
    scopes: [FacetScope.VENUE_STOCK, FacetScope.SUPPLIER_STOCK, FacetScope.INVENTORY],
    dataSource: 'stock.unit',
    optionSource: FacetOptionSource.DYNAMIC,
    sortOrder: 220,
  },
  {
    key: 'menu_price',
    label: 'Цена в меню',
    type: FacetType.RANGE,
    level: FacetLevel.PRODUCT,
    scopes: [FacetScope.MENU],
    dataSource: 'menu.price',
    optionSource: FacetOptionSource.DYNAMIC,
    sortOrder: 230,
  },
  {
    key: 'menu_unit',
    label: 'Единица меню',
    type: FacetType.CHIPS,
    level: FacetLevel.PRODUCT,
    scopes: [FacetScope.MENU],
    dataSource: 'menu.unit',
    optionSource: FacetOptionSource.DYNAMIC,
    sortOrder: 240,
  },
  {
    key: 'menu_is_active',
    label: 'Активно в меню',
    type: FacetType.TOGGLE,
    level: FacetLevel.PRODUCT,
    scopes: [FacetScope.MENU],
    dataSource: 'menu.isActive',
    optionSource: FacetOptionSource.DYNAMIC,
    sortOrder: 250,
  },
  // INVENTORY: the main filtering need on a stocktake/revision screen is these derived
  // states, not raw field equality — see design doc "не посчитано"/"расхождение"/"нет в каталоге".
  {
    key: 'session_item_status',
    label: 'Статус подсчёта',
    type: FacetType.CHIPS,
    level: FacetLevel.PRODUCT,
    scopes: [FacetScope.INVENTORY],
    dataSource: 'session_item.status',
    optionSource: FacetOptionSource.STATIC,
    sortOrder: 260,
    options: [
      { value: 'NOT_COUNTED', label: 'Не посчитано', sortOrder: 10 },
      { value: 'DISCREPANCY', label: 'Расхождение', sortOrder: 20 },
      { value: 'NOT_IN_CATALOG', label: 'Нет в каталоге', sortOrder: 30 },
      { value: 'MATCHES', label: 'Совпадает', sortOrder: 40 },
    ],
  },
  {
    key: 'session_item_difference',
    label: 'Расхождение (кол-во)',
    type: FacetType.RANGE,
    level: FacetLevel.PRODUCT,
    scopes: [FacetScope.INVENTORY],
    dataSource: 'session_item.differenceQty',
    optionSource: FacetOptionSource.DYNAMIC,
    sortOrder: 270,
  },
  // PRICE_IMPORT: backed by SupplierPriceImportRow (see price-import-facets.ts) — mapping/
  // validation status live on the row itself, not inside normalizedPayload.
  {
    key: 'import_row_mapping_status',
    label: 'Статус сопоставления',
    type: FacetType.CHIPS,
    level: FacetLevel.PRODUCT,
    scopes: [FacetScope.PRICE_IMPORT],
    dataSource: 'import_row.mappingStatus',
    optionSource: FacetOptionSource.STATIC,
    sortOrder: 280,
    options: [
      { value: 'MATCHED', label: 'Сопоставлено', sortOrder: 10 },
      { value: 'LOW_CONFIDENCE', label: 'Низкая уверенность', sortOrder: 20 },
      { value: 'CANDIDATE', label: 'Кандидат', sortOrder: 30 },
      { value: 'UNMATCHED', label: 'Не сопоставлено', sortOrder: 40 },
      { value: 'IGNORED', label: 'Игнорируется', sortOrder: 50 },
    ],
  },
  {
    key: 'import_row_validation_status',
    label: 'Статус проверки',
    type: FacetType.CHIPS,
    level: FacetLevel.PRODUCT,
    scopes: [FacetScope.PRICE_IMPORT],
    dataSource: 'import_row.validationStatus',
    optionSource: FacetOptionSource.STATIC,
    sortOrder: 290,
    options: [
      { value: 'NEEDS_REVIEW', label: 'Требует проверки', sortOrder: 10 },
      { value: 'APPROVED', label: 'Одобрено', sortOrder: 20 },
      { value: 'READY_TO_PUBLISH', label: 'Готово к публикации', sortOrder: 30 },
      { value: 'PUBLISHED', label: 'Опубликовано', sortOrder: 40 },
      { value: 'CONFLICT', label: 'Конфликт', sortOrder: 50 },
      { value: 'FAILED', label: 'Ошибка', sortOrder: 60 },
    ],
  },
  {
    key: 'import_row_has_errors',
    label: 'Есть ошибки',
    type: FacetType.TOGGLE,
    level: FacetLevel.PRODUCT,
    scopes: [FacetScope.PRICE_IMPORT],
    dataSource: 'import_row.hasErrors',
    optionSource: FacetOptionSource.DYNAMIC,
    sortOrder: 300,
  },
  {
    key: 'import_row_category',
    label: 'Категория строки',
    type: FacetType.MULTISELECT,
    level: FacetLevel.PRODUCT,
    scopes: [FacetScope.PRICE_IMPORT],
    dataSource: 'import_row.rawCategory',
    optionSource: FacetOptionSource.DYNAMIC,
    sortOrder: 310,
  },
  {
    key: 'import_row_confidence',
    label: 'Confidence',
    type: FacetType.RANGE,
    level: FacetLevel.PRODUCT,
    scopes: [FacetScope.PRICE_IMPORT],
    dataSource: 'import_row.mappingConfidence',
    optionSource: FacetOptionSource.DYNAMIC,
    sortOrder: 320,
  },
]

export async function ensureDefaultCatalogFacetRegistry() {
  for (const facet of DEFAULT_CATALOG_FACETS) {
    const registryEntry = await prisma.facetRegistryEntry.upsert({
      where: {
        key: facet.key,
      },
      create: {
        key: facet.key,
        label: facet.label,
        type: facet.type,
        level: facet.level,
        scopes: facet.scopes,
        categoryScope: facet.categoryScope ?? Prisma.JsonNull,
        dataSource: facet.dataSource,
        optionSource: facet.optionSource,
        minFillRate: facet.minFillRate ?? '0.05',
        sortOrder: facet.sortOrder,
      },
      update: {
        label: facet.label,
        type: facet.type,
        level: facet.level,
        scopes: facet.scopes,
        categoryScope: facet.categoryScope ?? Prisma.JsonNull,
        dataSource: facet.dataSource,
        optionSource: facet.optionSource,
        minFillRate: facet.minFillRate ?? '0.05',
        sortOrder: facet.sortOrder,
        isActive: true,
      },
    })

    for (const option of facet.options ?? []) {
      await prisma.facetOption.upsert({
        where: {
          facetId_value: {
            facetId: registryEntry.id,
            value: option.value,
          },
        },
        create: {
          facetId: registryEntry.id,
          value: option.value,
          label: option.label,
          sortOrder: option.sortOrder ?? 0,
          metadata: option.metadata ?? Prisma.JsonNull,
        },
        update: {
          label: option.label,
          sortOrder: option.sortOrder ?? 0,
          metadata: option.metadata ?? Prisma.JsonNull,
          isActive: true,
        },
      })
    }
  }
}
