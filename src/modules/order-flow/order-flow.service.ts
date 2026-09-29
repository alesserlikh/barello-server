import { Buffer } from 'buffer'
import {
  AccessLevel,
  CartStatus,
  DeliveryConfirmationDecision,
  OrderBatchStatus,
  Prisma,
  StockMovementReferenceType,
  StockMovementType,
  SupplierOrderStatus as DbSupplierOrderStatus,
  UnitType,
} from '../../generated/prisma'
import { prisma } from '../../lib/prisma'
import type { AuthPayload } from '../../middleware/auth'

type MoneyDto = { amount: number; currency: 'RUB' }
type VenueRoleDto = 'ADMIN' | 'SENIOR_STAFF' | 'LINE_STAFF'
type SupplierOrderStatusDto =
  | 'DRAFT'
  | 'PENDING_SUPPLIER'
  | 'NEEDS_CORRECTION'
  | 'CONFIRMED'
  | 'PICKING'
  | 'IN_DELIVERY'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'REJECTED_BY_SUPPLIER'
  | 'CANCELLED'
type OrderAggregateStatusDto =
  | 'NEEDS_YOUR_DECISION'
  | 'AWAITING_CONFIRMATION'
  | 'IN_PROGRESS'
  | 'AWAITING_RECEIPT'
  | 'COMPLETED'
  | 'CANCELLED'
type SupplierOrderActionDto =
  | 'CANCEL'
  | 'OPEN_CORRECTION'
  | 'CONFIRM_DELIVERY'
  | 'REPEAT'
  | 'CONTACT_SUPPLIER'

export class OrderFlowError extends Error {
  code: string
  status: number
  details: unknown

  constructor(code: string, message: string, status = 400, details: unknown = null) {
    super(message)
    this.name = 'OrderFlowError'
    this.code = code
    this.status = status
    this.details = details
  }
}

const idempotencyCache = new Map<
  string,
  { bodyHash: string; status: number; body: unknown; expiresAt: number }
>()

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function moneyFromDecimal(value: unknown, currency = 'RUB'): MoneyDto {
  const numeric = Number(value ?? 0)
  return {
    amount: Math.round((Number.isFinite(numeric) ? numeric : 0) * 100),
    currency: currency === 'RUB' ? 'RUB' : 'RUB',
  }
}

function zeroMoney(): MoneyDto {
  return { amount: 0, currency: 'RUB' }
}

function addMoney(left: MoneyDto, right: MoneyDto): MoneyDto {
  return { amount: left.amount + right.amount, currency: 'RUB' }
}

function subtractMoney(left: MoneyDto, right: MoneyDto): MoneyDto {
  return { amount: left.amount - right.amount, currency: 'RUB' }
}

function multiplyMoney(price: MoneyDto, qty: number): MoneyDto {
  return { amount: Math.round(price.amount * qty), currency: 'RUB' }
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

function normalizeUnit(value: string | null | undefined): UnitType {
  const upper = String(value || 'PCS').toUpperCase()
  if (upper in UnitType) return upper as UnitType
  if (upper === 'ШТ' || upper === 'PC' || upper === 'PIECE') return UnitType.PCS
  if (upper === 'Л') return UnitType.L
  return UnitType.PCS
}

function mapVenueRole(accessLevel: AccessLevel): VenueRoleDto {
  return accessLevel
}

function mapSupplierStatus(status: DbSupplierOrderStatus): SupplierOrderStatusDto {
  switch (status) {
    case DbSupplierOrderStatus.PENDING:
      return 'PENDING_SUPPLIER'
    case DbSupplierOrderStatus.ACCEPTED:
      return 'CONFIRMED'
    case DbSupplierOrderStatus.PROCESSING:
      return 'PICKING'
    case DbSupplierOrderStatus.SHIPPED:
      return 'IN_DELIVERY'
    case DbSupplierOrderStatus.DELIVERED:
      return 'DELIVERED'
    case DbSupplierOrderStatus.REJECTED:
      return 'REJECTED_BY_SUPPLIER'
    case DbSupplierOrderStatus.CANCELED:
      return 'CANCELLED'
    default:
      return 'PENDING_SUPPLIER'
  }
}

function mapOrderBatchStatus(status: OrderBatchStatus): OrderAggregateStatusDto {
  if (status === OrderBatchStatus.COMPLETED) return 'COMPLETED'
  if (status === OrderBatchStatus.CANCELED) return 'CANCELLED'
  return 'AWAITING_CONFIRMATION'
}

function userName(user: any) {
  const profile = user?.profile
  const name = [profile?.lastName, profile?.firstName, profile?.middleName]
    .filter(Boolean)
    .join(' ')
  return name || user?.phone || user?.email || 'Пользователь'
}

function supplierName(supplier: any) {
  return supplier?.catalogName || supplier?.business?.name || supplier?.name || 'Поставщик'
}

function productName(product: any) {
  return product?.name || product?.translatedName || 'Товар'
}

function productBrief(product: any) {
  return {
    sku: product?.barcode || product?.publicId || product?.id,
    nameEn: productName(product),
    nameRu: product?.translatedName ?? null,
    category: product?.category?.name ?? product?.rawCategory ?? '',
    volumeMl: product?.packageVolume == null ? null : toNumber(product.packageVolume),
    imageUrl: product?.mainImage?.storageKey ? `/uploads/${product.mainImage.storageKey}` : null,
  }
}

function userBrief(user: any, role: VenueRoleDto) {
  return {
    userId: user?.publicId || user?.id,
    name: userName(user),
    role,
  }
}

function supplierBrief(supplier: any) {
  return {
    supplierId: supplier?.publicId || supplier?.id,
    name: supplierName(supplier),
    logoUrl: supplier?.mainPhoto?.storageKey ? `/uploads/${supplier.mainPhoto.storageKey}` : null,
  }
}

export async function requireVenueContext(auth: AuthPayload, venueIdHeader: unknown) {
  if (auth.type !== 'user') {
    throw new OrderFlowError('FORBIDDEN_ROLE', 'Недостаточно прав', 403)
  }

  const venueId = typeof venueIdHeader === 'string' ? venueIdHeader.trim() : ''
  if (!venueId) {
    throw new OrderFlowError('VENUE_CONTEXT_REQUIRED', 'Не выбран контекст заведения', 400)
  }

  const whereVenue = isUuid(venueId)
    ? { id: venueId }
    : { publicId: venueId }

  const venue = await prisma.venue.findFirst({
    where: whereVenue,
    select: { id: true, publicId: true, name: true, address: true },
  })

  if (!venue) {
    throw new OrderFlowError('VENUE_CONTEXT_REQUIRED', 'Заведение не найдено', 400)
  }

  const membership = await prisma.userVenueMembership.findFirst({
    where: {
      userId: auth.userId,
      venueId: venue.id,
      membershipStatus: 'ACTIVE',
    },
    include: {
      user: { include: { profile: true } },
    },
  })

  if (!membership) {
    throw new OrderFlowError('FORBIDDEN_ROLE', 'Нет доступа к заведению', 403)
  }

  return {
    venue,
    membership,
    role: mapVenueRole(membership.accessLevel),
    user: membership.user,
  }
}

async function getOrCreateCart(context: Awaited<ReturnType<typeof requireVenueContext>>) {
  const existing = await prisma.cart.findFirst({
    where: { venueId: context.venue.id, status: CartStatus.ACTIVE },
    orderBy: { updatedAt: 'desc' },
  })

  if (existing) return existing

  return prisma.cart.create({
    data: {
      venueId: context.venue.id,
      createdByUserId: context.membership.userId,
      status: CartStatus.ACTIVE,
    },
  })
}

const cartInclude = {
  createdByUser: { include: { profile: true } },
  items: {
    include: {
      product: { include: { category: true, mainImage: true } },
      productVariant: true,
      offer: {
        include: {
          supplierProduct: {
            include: {
              supplier: { include: { business: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
}

async function findCartWithItems(cartId: string) {
  return prisma.cart.findUnique({
    where: { id: cartId },
    include: cartInclude,
  })
}

function cartVersion(cart: any) {
  return Math.floor(new Date(cart.updatedAt).getTime() / 1000)
}

function cartItemVersion(item: any) {
  return Math.floor(new Date(item.updatedAt).getTime() / 1000)
}

function mapCartItem(item: any, role: VenueRoleDto) {
  const qty = toNumber(item.quantity)
  const offer = item.offer
  const supplierProduct = offer?.supplierProduct
  const price = moneyFromDecimal(offer?.effectivePrice ?? offer?.discountPrice ?? offer?.price, offer?.currency)
  const maxAvailable =
    offer?.stockAvailable == null
      ? null
      : Math.max(0, Math.floor(toNumber(offer.stockAvailable)))
  const issues: string[] = []
  if (!offer?.isAvailable || !offer?.isCurrent || offer?.missingFromLatestPrice) issues.push('offer_withdrawn')
  if (maxAvailable !== null && qty > maxAvailable) issues.push('out_of_stock')

  return {
    itemId: item.id,
    version: cartItemVersion(item),
    sku: item.product?.barcode || item.product?.publicId || item.productId,
    product: productBrief(item.product),
    supplier: supplierBrief(supplierProduct?.supplier),
    alias: supplierProduct?.supplierNameAlias || item.product?.name || '',
    qty,
    packSize: Math.max(1, Math.floor(toNumber(offer?.packQty) || 1)),
    unitPrice: price,
    lineTotal: multiplyMoney(price, qty),
    maxAvailable,
    addedBy: userBrief(item.cart?.createdByUser, role),
    addedAt: item.createdAt.toISOString(),
    approvalStatus: 'approved' as const,
    issues,
  }
}

function mapCart(cart: any, role: VenueRoleDto) {
  const items = cart.items.map((item: any) => mapCartItem({ ...item, cart }, role))
  const grouped = new Map<string, any[]>()

  for (const item of items) {
    const key = item.supplier.supplierId
    grouped.set(key, [...(grouped.get(key) ?? []), item])
  }

  const groups = Array.from(grouped.values()).map((groupItems) => {
    const subtotal = groupItems.reduce((total, item) => addMoney(total, item.lineTotal), zeroMoney())
    const rawMin = Math.max(
      0,
      ...cart.items
        .filter((item: any) => {
          const supplier = item.offer?.supplierProduct?.supplier
          return (supplier?.publicId || supplier?.id) === groupItems[0].supplier.supplierId
        })
        .map((item: any) => toNumber(item.offer?.minOrderQty) * toNumber(item.offer?.price)),
    )
    const minOrderAmount = moneyFromDecimal(rawMin || 0)
    const shortfall = subtotal.amount >= minOrderAmount.amount
      ? null
      : subtractMoney(minOrderAmount, subtotal)
    const hasUnavailableItems = groupItems.some((item) => item.issues.length > 0)
    const blockers = [
      ...(shortfall ? ['below_min_order'] : []),
      ...(hasUnavailableItems ? ['has_unavailable_items'] : []),
    ]

    return {
      supplier: groupItems[0].supplier,
      items: groupItems,
      subtotal,
      minOrderAmount,
      meetsMinimum: !shortfall,
      shortfall,
      leadTimeDays: 1,
      deliveryDays: [1, 2, 3, 4, 5],
      eligibleForCheckout: blockers.length === 0,
      blockers,
    }
  })

  return {
    cartId: cart.id,
    version: cartVersion(cart),
    venueId: cart.venueId,
    groups,
    savedForLater: [],
    itemsCount: items.length,
    unitsCount: items.reduce((total: number, item: any) => total + item.qty, 0),
    total: groups.reduce((total: MoneyDto, group: any) => addMoney(total, group.subtotal), zeroMoney()),
    pendingApprovalCount: 0,
    updatedAt: cart.updatedAt.toISOString(),
    updatedBy: userBrief(cart.createdByUser, role),
  }
}

export async function getCart(context: Awaited<ReturnType<typeof requireVenueContext>>) {
  const cart = await getOrCreateCart(context)
  const fullCart = await findCartWithItems(cart.id)
  return mapCart(fullCart, context.role)
}

export async function addCartItem(
  context: Awaited<ReturnType<typeof requireVenueContext>>,
  payload: { offerId?: unknown; qty?: unknown; quantity?: unknown },
) {
  const offerId = typeof payload.offerId === 'string' ? payload.offerId : ''
  const qty = Number(payload.qty ?? payload.quantity)
  if (!offerId || !Number.isFinite(qty) || qty <= 0) {
    throw new OrderFlowError('INVALID_INPUT', 'Некорректная позиция корзины', 400)
  }

  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    include: { supplierProduct: true },
  })

  if (!offer || !offer.isAvailable || !offer.isCurrent || offer.missingFromLatestPrice) {
    throw new OrderFlowError('OFFER_UNAVAILABLE', 'Оффер недоступен', 422)
  }

  const maxAvailable = offer.stockAvailable == null ? null : toNumber(offer.stockAvailable)
  if (maxAvailable != null && qty > maxAvailable) {
    throw new OrderFlowError('QTY_EXCEEDS_AVAILABLE', 'Количество больше доступного остатка', 422, {
      maxAvailable,
    })
  }

  const cart = await getOrCreateCart(context)
  const existing = await prisma.cartItem.findFirst({
    where: { cartId: cart.id, offerId },
  })

  if (existing) {
    await prisma.cartItem.update({
      where: { id: existing.id },
      data: { quantity: new Prisma.Decimal(toNumber(existing.quantity) + qty) },
    })
  } else {
    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        productId: offer.supplierProduct.productId,
        productVariantId: offer.supplierProduct.productVariantId,
        offerId,
        quantity: new Prisma.Decimal(qty),
        unit: offer.unit || 'PCS',
      },
    })
  }

  return { cart: await getCart(context) }
}

export async function updateCartItem(
  context: Awaited<ReturnType<typeof requireVenueContext>>,
  itemId: string,
  payload: { qty?: unknown; version?: unknown },
) {
  const qty = Number(payload.qty)
  if (!Number.isFinite(qty) || qty < 0) {
    throw new OrderFlowError('INVALID_INPUT', 'Некорректное количество', 400)
  }

  const item = await prisma.cartItem.findFirst({
    where: { id: itemId, cart: { venueId: context.venue.id, status: CartStatus.ACTIVE } },
    include: { offer: true },
  })
  if (!item) throw new OrderFlowError('CART_ITEM_NOT_FOUND', 'Позиция не найдена', 404)

  const clientVersion = Number(payload.version)
  if (Number.isFinite(clientVersion) && clientVersion !== cartItemVersion(item)) {
    const cart = await getCart(context)
    const current = cart.groups.flatMap((group: any) => group.items).find((nextItem: any) => nextItem.itemId === itemId)
    throw new OrderFlowError('CART_ITEM_VERSION_CONFLICT', 'Позицию изменил другой сотрудник', 409, { current })
  }

  const maxAvailable = item.offer.stockAvailable == null ? null : toNumber(item.offer.stockAvailable)
  if (maxAvailable != null && qty > maxAvailable) {
    throw new OrderFlowError('QTY_EXCEEDS_AVAILABLE', 'Количество больше доступного остатка', 422, {
      maxAvailable,
    })
  }

  if (qty === 0) {
    await prisma.cartItem.delete({ where: { id: itemId } })
  } else {
    await prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity: new Prisma.Decimal(qty) },
    })
  }

  return { cart: await getCart(context) }
}

export async function deleteCartItem(context: Awaited<ReturnType<typeof requireVenueContext>>, itemId: string) {
  await prisma.cartItem.deleteMany({
    where: { id: itemId, cart: { venueId: context.venue.id, status: CartStatus.ACTIVE } },
  })
  return { cart: await getCart(context) }
}

export async function approveCart(context: Awaited<ReturnType<typeof requireVenueContext>>) {
  if (context.role !== 'ADMIN') {
    throw new OrderFlowError('FORBIDDEN_ROLE', 'Подтверждать позиции может только администратор', 403)
  }
  return { cart: await getCart(context) }
}

export async function previewCheckout(context: Awaited<ReturnType<typeof requireVenueContext>>) {
  const cart = await getCart(context)
  const selectedGroups = cart.groups
  const blockers = selectedGroups.flatMap((group: any) =>
    group.blockers.map((code: string) => ({
      code,
      supplierId: group.supplier.supplierId,
      shortfall: group.shortfall ?? null,
    })),
  )
  return {
    cart,
    groups: selectedGroups,
    total: cart.total,
    blockers,
    eligibleForCheckout: blockers.length === 0,
  }
}

const supplierOrderInclude = {
  supplier: { include: { business: true } },
  items: {
    include: {
      product: { include: { category: true, mainImage: true } },
      offer: true,
    },
    orderBy: { createdAt: 'asc' as const },
  },
  statusEvents: { orderBy: { createdAt: 'asc' as const }, include: { actorSupplier: true } },
  deliveryConfirmations: {
    include: { confirmedByUser: { include: { profile: true } } },
    orderBy: { createdAt: 'desc' as const },
  },
}

const orderBatchInclude = {
  createdByUser: { include: { profile: true } },
  supplierOrders: {
    include: supplierOrderInclude,
    orderBy: { createdAt: 'asc' as const },
  },
}

function availableActions(status: SupplierOrderStatusDto, role: VenueRoleDto): SupplierOrderActionDto[] {
  const actions: SupplierOrderActionDto[] = ['CONTACT_SUPPLIER']
  if (status === 'PENDING_SUPPLIER' && role === 'ADMIN') actions.unshift('CANCEL')
  if (status === 'NEEDS_CORRECTION' && role !== 'LINE_STAFF') actions.unshift('OPEN_CORRECTION')
  if (status === 'DELIVERED' && role !== 'LINE_STAFF') actions.unshift('CONFIRM_DELIVERY')
  if (status === 'COMPLETED' || status === 'CANCELLED' || status === 'REJECTED_BY_SUPPLIER') actions.unshift('REPEAT')
  return actions
}

function mapOrderLine(item: any) {
  const qtyOrdered = toNumber(item.quantity)
  const unitPrice = moneyFromDecimal(item.price, 'RUB')
  return {
    lineId: item.id,
    sku: item.product?.barcode || item.product?.publicId || item.productId,
    product: productBrief(item.product),
    alias: item.product?.name || '',
    qtyOrdered,
    qtyConfirmed: item.supplierOrder?.status === DbSupplierOrderStatus.PENDING ? null : qtyOrdered,
    qtyAccepted: item.supplierOrder?.status === DbSupplierOrderStatus.DELIVERED ? null : qtyOrdered,
    unitPrice,
    unitPriceConfirmed: item.supplierOrder?.status === DbSupplierOrderStatus.PENDING ? null : unitPrice,
    lineTotal: moneyFromDecimal(item.total, 'RUB'),
    status: 'ok' as const,
  }
}

function mapSupplierOrder(supplierOrder: any, role: VenueRoleDto) {
  const status = mapSupplierStatus(supplierOrder.status)
  const lines = supplierOrder.items.map((item: any) => mapOrderLine({ ...item, supplierOrder }))
  const ordered = lines.reduce((total: MoneyDto, line: any) => addMoney(total, line.lineTotal), zeroMoney())
  const confirmed = status === 'PENDING_SUPPLIER' ? null : ordered
  const confirmation = supplierOrder.deliveryConfirmations?.[0]
  const confirmedBy = confirmation?.confirmedByUser
    ? userBrief(confirmation.confirmedByUser, role)
    : null

  return {
    supplierOrderId: supplierOrder.id,
    orderId: supplierOrder.orderBatchId,
    supplier: supplierBrief(supplierOrder.supplier),
    status,
    lines,
    totals: {
      ordered,
      confirmed,
      accepted: status === 'COMPLETED' ? ordered : null,
    },
    delivery: {
      date: (supplierOrder.expectedDeliveryAt ?? supplierOrder.createdAt).toISOString().slice(0, 10),
      slot: null,
      address: supplierOrder.venue?.address ?? '',
      comment: null,
    },
    activeCorrectionId: status === 'NEEDS_CORRECTION' ? `corr_${supplierOrder.id}` : null,
    pickingDeadline: null,
    pickingExtensions: 0,
    pickingExtensionsMax: 2,
    expectedDeliveryAt: supplierOrder.expectedDeliveryAt?.toISOString() ?? null,
    confirmationDueAt: supplierOrder.expectedDeliveryAt?.toISOString() ?? null,
    confirmedBy,
    availableActions: availableActions(status, role),
    timeline: [
      {
        eventId: `${supplierOrder.id}:created`,
        type: 'order.created',
        at: supplierOrder.createdAt.toISOString(),
        actor: { system: true },
        payload: {},
      },
      ...(supplierOrder.statusEvents ?? []).map((event: any) => ({
        eventId: event.id,
        type: `supplier_order.${mapSupplierStatus(event.status).toLowerCase()}`,
        at: event.createdAt.toISOString(),
        actor: event.actorSupplier ? supplierBrief(event.actorSupplier) : { system: true },
        payload: event.comment ? { comment: event.comment } : {},
      })),
    ],
  }
}

function aggregateOrderStatus(supplierOrders: any[], batchStatus: OrderBatchStatus): {
  aggregateStatus: OrderAggregateStatusDto
  requiresAction: boolean
} {
  const statuses = supplierOrders.map((supplierOrder) => mapSupplierStatus(supplierOrder.status))
  if (statuses.includes('NEEDS_CORRECTION')) return { aggregateStatus: 'NEEDS_YOUR_DECISION', requiresAction: true }
  if (statuses.includes('DELIVERED')) return { aggregateStatus: 'AWAITING_RECEIPT', requiresAction: true }
  if (statuses.length && statuses.every((status) => ['COMPLETED', 'CANCELLED', 'REJECTED_BY_SUPPLIER'].includes(status)) && statuses.includes('COMPLETED')) {
    return { aggregateStatus: 'COMPLETED', requiresAction: false }
  }
  if (statuses.length && statuses.every((status) => ['CANCELLED', 'REJECTED_BY_SUPPLIER'].includes(status))) {
    return { aggregateStatus: 'CANCELLED', requiresAction: false }
  }
  if (statuses.some((status) => ['CONFIRMED', 'PICKING', 'IN_DELIVERY'].includes(status))) {
    return { aggregateStatus: 'IN_PROGRESS', requiresAction: false }
  }
  return { aggregateStatus: mapOrderBatchStatus(batchStatus), requiresAction: false }
}

function mapOrder(batch: any, role: VenueRoleDto) {
  const supplierOrders = batch.supplierOrders.map((supplierOrder: any) => mapSupplierOrder(supplierOrder, role))
  const total = supplierOrders.reduce((sum: MoneyDto, supplierOrder: any) => addMoney(sum, supplierOrder.totals.ordered), zeroMoney())
  const aggregate = aggregateOrderStatus(batch.supplierOrders, batch.status)

  return {
    orderId: batch.id,
    number: batch.id.slice(0, 8).toUpperCase(),
    createdAt: batch.createdAt.toISOString(),
    placedBy: userBrief(batch.createdByUser, role),
    pricesFixedAt: batch.createdAt.toISOString(),
    aggregateStatus: aggregate.aggregateStatus,
    requiresAction: aggregate.requiresAction,
    supplierOrders,
    total,
  }
}

function mapOrderBrief(batch: any, role: VenueRoleDto) {
  const order = mapOrder(batch, role)
  const suppliers = order.supplierOrders.map((supplierOrder: any) => supplierOrder.supplier)
  const primarySupplierOrder = order.supplierOrders.find((supplierOrder: any) =>
    supplierOrder.availableActions.some((action: SupplierOrderActionDto) => action !== 'CONTACT_SUPPLIER'),
  )
  const primaryAction = primarySupplierOrder?.availableActions.find((action: SupplierOrderActionDto) => action !== 'CONTACT_SUPPLIER') ?? null

  return {
    orderId: order.orderId,
    number: order.number,
    createdAt: order.createdAt,
    aggregateStatus: order.aggregateStatus,
    requiresAction: order.requiresAction,
    suppliers,
    supplierOrdersCount: order.supplierOrders.length,
    total: order.total,
    nearestDeliveryDate: order.supplierOrders
      .map((supplierOrder: any) => supplierOrder.delivery.date)
      .sort()[0] ?? null,
    primaryAction,
    primaryActionSupplierOrderId: primarySupplierOrder?.supplierOrderId ?? null,
  }
}

function encodeCursor(batch: any) {
  return Buffer.from(JSON.stringify({
    createdAt: batch.createdAt.toISOString(),
    id: batch.id,
  })).toString('base64url')
}

function decodeCursor(cursor: unknown) {
  if (typeof cursor !== 'string' || !cursor.trim()) return null
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (typeof parsed.createdAt === 'string' && typeof parsed.id === 'string') return parsed
  } catch {
    return null
  }
  return null
}

export async function createOrder(context: Awaited<ReturnType<typeof requireVenueContext>>) {
  if (context.role !== 'ADMIN') {
    throw new OrderFlowError('FORBIDDEN_ROLE', 'Оформлять заказ может только администратор', 403)
  }

  const cart = await getOrCreateCart(context)
  const fullCart = await findCartWithItems(cart.id)
  if (!fullCart || fullCart.items.length === 0) {
    throw new OrderFlowError('CART_EMPTY', 'Корзина пуста', 422)
  }

  const result = await prisma.$transaction(async (tx) => {
    const batch = await tx.orderBatch.create({
      data: {
        venueId: context.venue.id,
        createdByUserId: context.membership.userId,
        cartId: fullCart.id,
        status: OrderBatchStatus.SUBMITTED,
      },
    })

    const itemsBySupplier = new Map<string, any[]>()
    for (const item of fullCart.items) {
      const supplierId = item.offer.supplierProduct.supplier.id
      itemsBySupplier.set(supplierId, [...(itemsBySupplier.get(supplierId) ?? []), item])
    }

    for (const [supplierId, items] of itemsBySupplier) {
      const total = items.reduce((sum, item) => {
        const price = toNumber(item.offer.effectivePrice ?? item.offer.discountPrice ?? item.offer.price)
        return sum + price * toNumber(item.quantity)
      }, 0)
      const supplierOrder = await tx.supplierOrder.create({
        data: {
          orderBatchId: batch.id,
          venueId: context.venue.id,
          supplierId,
          status: DbSupplierOrderStatus.PENDING,
          totalAmount: new Prisma.Decimal(total),
          currency: 'RUB',
          orderedAt: new Date(),
          expectedDeliveryAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      })

      for (const item of items) {
        const price = toNumber(item.offer.effectivePrice ?? item.offer.discountPrice ?? item.offer.price)
        const qty = toNumber(item.quantity)
        await tx.supplierOrderItem.create({
          data: {
            supplierOrderId: supplierOrder.id,
            productId: item.productId,
            productVariantId: item.productVariantId,
            offerId: item.offerId,
            quantity: new Prisma.Decimal(qty),
            price: new Prisma.Decimal(price),
            unit: item.unit,
            total: new Prisma.Decimal(price * qty),
          },
        })
      }
    }

    await tx.cart.update({
      where: { id: fullCart.id },
      data: { status: CartStatus.CONVERTED },
    })

    return batch
  })

  const order = await getOrder(context, result.id)
  const nextCart = await getCart(context)
  return { order, cart: nextCart }
}

export async function listOrders(
  context: Awaited<ReturnType<typeof requireVenueContext>>,
  query: { status?: unknown; requiresAction?: unknown; limit?: unknown; cursor?: unknown },
) {
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 50)
  const cursor = decodeCursor(query.cursor)
  const batches = await prisma.orderBatch.findMany({
    where: {
      venueId: context.venue.id,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: new Date(cursor.createdAt) } },
              { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    include: orderBatchInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  })
  const page = batches.slice(0, limit)
  let items = page.map((batch) => mapOrderBrief(batch, context.role))

  if (query.status === 'history') {
    items = items.filter((item) => ['COMPLETED', 'CANCELLED'].includes(item.aggregateStatus))
  } else if (query.status === 'active') {
    items = items.filter((item) => !['COMPLETED', 'CANCELLED'].includes(item.aggregateStatus))
  }
  if (query.requiresAction === 'true' || query.requiresAction === true) {
    items = items.filter((item) => item.requiresAction)
  }

  return {
    items,
    nextCursor: batches.length > limit ? encodeCursor(page[page.length - 1]) : null,
  }
}

export async function getOrder(context: Awaited<ReturnType<typeof requireVenueContext>>, orderId: string) {
  const batch = await prisma.orderBatch.findFirst({
    where: { id: orderId, venueId: context.venue.id },
    include: orderBatchInclude,
  })
  if (!batch) throw new OrderFlowError('ORDER_NOT_FOUND', 'Заказ не найден', 404)
  return mapOrder(batch, context.role)
}

export async function getSupplierOrder(context: Awaited<ReturnType<typeof requireVenueContext>>, supplierOrderId: string) {
  const supplierOrder = await prisma.supplierOrder.findFirst({
    where: { id: supplierOrderId, venueId: context.venue.id },
    include: supplierOrderInclude,
  })
  if (!supplierOrder) throw new OrderFlowError('SUPPLIER_ORDER_NOT_FOUND', 'Поставка не найдена', 404)
  return mapSupplierOrder(supplierOrder, context.role)
}

export async function cancelSupplierOrder(
  context: Awaited<ReturnType<typeof requireVenueContext>>,
  supplierOrderId: string,
) {
  if (context.role !== 'ADMIN') throw new OrderFlowError('FORBIDDEN_ROLE', 'Недостаточно прав', 403)
  const supplierOrder = await prisma.supplierOrder.findFirst({
    where: { id: supplierOrderId, venueId: context.venue.id },
  })
  if (!supplierOrder) throw new OrderFlowError('SUPPLIER_ORDER_NOT_FOUND', 'Поставка не найдена', 404)
  if (supplierOrder.status !== DbSupplierOrderStatus.PENDING) {
    throw new OrderFlowError('SUPPLIER_ORDER_INVALID_STATE', 'Действие недоступно для этого статуса', 422)
  }
  await prisma.supplierOrder.update({
    where: { id: supplierOrderId },
    data: { status: DbSupplierOrderStatus.CANCELED },
  })
  return { supplierOrder: await getSupplierOrder(context, supplierOrderId) }
}

export async function repeatSupplierOrder(
  context: Awaited<ReturnType<typeof requireVenueContext>>,
  supplierOrderId: string,
) {
  const supplierOrder = await prisma.supplierOrder.findFirst({
    where: { id: supplierOrderId, venueId: context.venue.id },
    include: { items: true },
  })
  if (!supplierOrder) throw new OrderFlowError('SUPPLIER_ORDER_NOT_FOUND', 'Поставка не найдена', 404)
  const cart = await getOrCreateCart(context)
  for (const item of supplierOrder.items) {
    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        productId: item.productId,
        productVariantId: item.productVariantId,
        offerId: item.offerId,
        quantity: item.quantity,
        unit: item.unit,
      },
    })
  }
  return { cart: await getCart(context) }
}

export async function getCorrection(context: Awaited<ReturnType<typeof requireVenueContext>>, correctionId: string) {
  const supplierOrderId = correctionId.replace(/^corr_/, '')
  const supplierOrder = await getSupplierOrder(context, supplierOrderId)
  if (supplierOrder.status !== 'NEEDS_CORRECTION') {
    throw new OrderFlowError('CORRECTION_NOT_FOUND', 'Корректировка не найдена', 404)
  }
  const changes = supplierOrder.lines.map((line: any) => ({
    lineId: line.lineId,
    type: 'qty_reduced',
    before: { qty: line.qtyOrdered },
    after: { qty: line.qtyConfirmed ?? line.qtyOrdered },
    maxAvailable: line.qtyConfirmed ?? line.qtyOrdered,
  }))
  return {
    correctionId,
    supplierOrderId,
    version: 1,
    createdAt: supplierOrder.timeline[0]?.at ?? new Date().toISOString(),
    respondBy: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    supplierComment: null,
    changes,
    unchangedLinesCount: 0,
    projectedTotal: supplierOrder.totals.confirmed ?? supplierOrder.totals.ordered,
    minOrderAmount: zeroMoney(),
    projectedMeetsMinimum: true,
  }
}

export async function decideCorrection(
  context: Awaited<ReturnType<typeof requireVenueContext>>,
  correctionId: string,
  payload: { action?: unknown },
) {
  if (context.role === 'LINE_STAFF') throw new OrderFlowError('FORBIDDEN_ROLE', 'Недостаточно прав', 403)
  const supplierOrderId = correctionId.replace(/^corr_/, '')
  const action = payload.action === 'reject' ? 'reject' : 'revise'
  await prisma.supplierOrder.update({
    where: { id: supplierOrderId },
    data: {
      status: action === 'reject' ? DbSupplierOrderStatus.CANCELED : DbSupplierOrderStatus.PENDING,
    },
  })
  return { supplierOrder: await getSupplierOrder(context, supplierOrderId) }
}

export async function confirmDelivery(
  context: Awaited<ReturnType<typeof requireVenueContext>>,
  supplierOrderId: string,
) {
  if (context.role === 'LINE_STAFF') throw new OrderFlowError('FORBIDDEN_ROLE', 'Недостаточно прав', 403)
  const supplierOrder = await prisma.supplierOrder.findFirst({
    where: { id: supplierOrderId, venueId: context.venue.id },
    include: { items: { include: { product: true } } },
  })
  if (!supplierOrder) throw new OrderFlowError('SUPPLIER_ORDER_NOT_FOUND', 'Поставка не найдена', 404)
  if (supplierOrder.status === DbSupplierOrderStatus.DELIVERED) {
    // valid state
  } else if (supplierOrder.status === DbSupplierOrderStatus.ACCEPTED || supplierOrder.status === DbSupplierOrderStatus.SHIPPED) {
    // MVP accepts supplier orders that reached the later stages in the legacy state machine.
  } else {
    throw new OrderFlowError('SUPPLIER_ORDER_INVALID_STATE', 'Действие недоступно для этого статуса', 422)
  }

  await prisma.$transaction(async (tx) => {
    await tx.supplierOrder.update({
      where: { id: supplierOrderId },
      data: { status: DbSupplierOrderStatus.DELIVERED },
    })
    await tx.orderDeliveryConfirmation.create({
      data: {
        supplierOrderId,
        confirmedByUserId: context.membership.userId,
        decision: DeliveryConfirmationDecision.ACCEPTED,
      },
    })
    for (const line of supplierOrder.items) {
      const unit = normalizeUnit(line.unit)
      const existing = await tx.inventoryItem.findFirst({
        where: { venueId: context.venue.id, productId: line.productId, unit },
      })
      if (existing) {
        await tx.inventoryItem.update({
          where: { id: existing.id },
          data: {
            quantity: new Prisma.Decimal(toNumber(existing.quantity) + toNumber(line.quantity)),
            lastPurchasePrice: line.price,
            avgPrice: existing.avgPrice ?? line.price,
            isOutOfStock: false,
          },
        })
        await tx.stockMovement.create({
          data: {
            venueId: context.venue.id,
            inventoryItemId: existing.id,
            type: StockMovementType.PURCHASE,
            quantity: line.quantity,
            unit,
            price: line.price,
            referenceType: StockMovementReferenceType.ORDER,
            referenceId: supplierOrderId,
          },
        })
      } else {
        const inventoryItem = await tx.inventoryItem.create({
          data: {
            venueId: context.venue.id,
            productId: line.productId,
            name: line.product?.name || 'Товар',
            quantity: line.quantity,
            unit,
            lastPurchasePrice: line.price,
            avgPrice: line.price,
            isOutOfStock: false,
          },
        })
        await tx.stockMovement.create({
          data: {
            venueId: context.venue.id,
            inventoryItemId: inventoryItem.id,
            type: StockMovementType.PURCHASE,
            quantity: line.quantity,
            unit,
            price: line.price,
            referenceType: StockMovementReferenceType.ORDER,
            referenceId: supplierOrderId,
          },
        })
      }
    }
  })

  return { supplierOrder: await getSupplierOrder(context, supplierOrderId) }
}

export async function pendingConfirmation(context: Awaited<ReturnType<typeof requireVenueContext>>) {
  if (context.role === 'LINE_STAFF') throw new OrderFlowError('FORBIDDEN_ROLE', 'Недостаточно прав', 403)
  const supplierOrders = await prisma.supplierOrder.findMany({
    where: {
      venueId: context.venue.id,
      status: DbSupplierOrderStatus.DELIVERED,
      deliveryConfirmations: { none: {} },
    },
    include: supplierOrderInclude,
    orderBy: { expectedDeliveryAt: 'asc' },
  })
  return { items: supplierOrders.map((supplierOrder) => mapSupplierOrder(supplierOrder, context.role)) }
}

export async function getProductOffers(_context: Awaited<ReturnType<typeof requireVenueContext>>, sku: string) {
  const productWhere = isUuid(sku)
    ? { OR: [{ id: sku }, { barcode: sku }] }
    : { OR: [{ publicId: sku }, { barcode: sku }, { article: sku }] }
  const product = await prisma.product.findFirst({
    where: productWhere,
    include: {
      category: true,
      mainImage: true,
      supplierProducts: {
        include: {
          supplier: { include: { business: true } },
          offers: {
            where: { isCurrent: true },
            orderBy: { price: 'asc' },
          },
        },
      },
    },
  })

  if (!product) throw new OrderFlowError('PRODUCT_NOT_FOUND', 'Товар не найден', 404)

  const items = product.supplierProducts.flatMap((supplierProduct) =>
    supplierProduct.offers.map((offer) => ({
      offerId: offer.id,
      supplier: supplierBrief(supplierProduct.supplier),
      sku: product.barcode || product.publicId,
      alias: supplierProduct.supplierNameAlias || product.name,
      unitPrice: moneyFromDecimal(offer.effectivePrice ?? offer.discountPrice ?? offer.price, offer.currency),
      packSize: Math.max(1, Math.floor(toNumber(offer.packQty) || 1)),
      packPrice: offer.packQty
        ? multiplyMoney(moneyFromDecimal(offer.effectivePrice ?? offer.discountPrice ?? offer.price, offer.currency), toNumber(offer.packQty))
        : null,
      leadTimeDays: offer.deliveryDaysMin ?? offer.deliveryDaysMax ?? 1,
      maxAvailable: offer.stockAvailable == null ? null : Math.floor(toNumber(offer.stockAvailable)),
      minOrderAmount: moneyFromDecimal((toNumber(offer.minOrderQty) || 0) * toNumber(offer.price)),
      badges: [] as string[],
    })),
  )

  return { items }
}

function stableBodyHash(body: unknown) {
  return JSON.stringify(body ?? {})
}

export function readCachedIdempotentResponse(endpoint: string, key: string | undefined, body: unknown) {
  if (!key) return null
  const cacheKey = `${endpoint}:${key}`
  const cached = idempotencyCache.get(cacheKey)
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    idempotencyCache.delete(cacheKey)
    return null
  }
  if (cached.bodyHash !== stableBodyHash(body)) {
    throw new OrderFlowError('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key уже использован с другим телом', 409)
  }
  return cached
}

export function writeCachedIdempotentResponse(endpoint: string, key: string | undefined, body: unknown, status: number, responseBody: unknown) {
  if (!key) return
  idempotencyCache.set(`${endpoint}:${key}`, {
    bodyHash: stableBodyHash(body),
    status,
    body: responseBody,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  })
}
