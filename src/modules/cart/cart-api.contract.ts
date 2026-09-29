import type { ApiSuccessEnvelope } from '../../lib/api-contract'

export const CART_ITEM_STATUSES = [
  'ACTIVE',
  'REQUIRES_APPROVAL',
  'REMOVED',
] as const

export type CartItemStatusDto = (typeof CART_ITEM_STATUSES)[number]

export type AddCartItemDto = {
  venueId: string
  offerId: string
  productId: string
  productVariantId: string
  quantity: number
  unit: string
}

export type CartItemDto = AddCartItemDto & {
  id: string
  cartId: string
  status: CartItemStatusDto
  addedByUserId: string
  createdAt: string
  updatedAt: string
}

export type CartDto = {
  id: string
  venueId: string
  status: 'ACTIVE' | 'SUBMITTED' | 'CANCELLED'
  items: CartItemDto[]
  createdAt: string
  updatedAt: string
}

export type AddCartItemResponseDto = ApiSuccessEnvelope<{ cart: CartDto }>

