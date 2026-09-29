import { Router } from 'express'
import { requireAuth } from '../../middleware/auth'
import { apiError } from '../../lib/api-error'
import {
  addCartItem,
  approveCart,
  cancelSupplierOrder,
  confirmDelivery,
  createOrder,
  decideCorrection,
  deleteCartItem,
  getCart,
  getCorrection,
  getOrder,
  getProductOffers,
  getSupplierOrder,
  listOrders,
  OrderFlowError,
  pendingConfirmation,
  previewCheckout,
  readCachedIdempotentResponse,
  repeatSupplierOrder,
  requireVenueContext,
  updateCartItem,
  writeCachedIdempotentResponse,
} from './order-flow.service'

const orderFlowRouter = Router()
const orderProductsRouter = Router()

function sendOrderError(res: import('express').Response, error: unknown) {
  if (error instanceof OrderFlowError) {
    res.status(error.status).json(apiError(error.code, error.message, error.details))
    return
  }

  console.error('Order flow request failed:', error)
  res.status(500).json(apiError('ORDER_FLOW_REQUEST_FAILED', 'Не удалось выполнить запрос заказов'))
}

async function withVenueContext(
  req: import('express').Request,
  res: import('express').Response,
  handler: (context: Awaited<ReturnType<typeof requireVenueContext>>) => Promise<void>,
) {
  try {
    const context = await requireVenueContext(req.auth!, req.headers['x-venue-id'])
    await handler(context)
  } catch (error) {
    sendOrderError(res, error)
  }
}

function idempotencyKey(req: import('express').Request) {
  const value = req.headers['idempotency-key']
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function param(req: import('express').Request, key: string) {
  return String(req.params[key] ?? '')
}

async function sendIdempotent(
  req: import('express').Request,
  res: import('express').Response,
  endpoint: string,
  status: number,
  buildBody: () => Promise<unknown>,
) {
  const key = idempotencyKey(req)
  const cached = readCachedIdempotentResponse(endpoint, key, req.body)
  if (cached) {
    res.status(cached.status).json(cached.body)
    return
  }

  const body = await buildBody()
  writeCachedIdempotentResponse(endpoint, key, req.body, status, body)
  res.status(status).json(body)
}

orderFlowRouter.get('/cart', requireAuth, async (req, res) => {
  await withVenueContext(req, res, async (context) => {
    res.status(200).json(await getCart(context))
  })
})

orderFlowRouter.post('/cart/items', requireAuth, async (req, res) => {
  await withVenueContext(req, res, async (context) => {
    res.status(201).json(await addCartItem(context, req.body ?? {}))
  })
})

orderFlowRouter.patch('/cart/items/:itemId', requireAuth, async (req, res) => {
  await withVenueContext(req, res, async (context) => {
    res.status(200).json(await updateCartItem(context, param(req, 'itemId'), req.body ?? {}))
  })
})

orderFlowRouter.delete('/cart/items/:itemId', requireAuth, async (req, res) => {
  await withVenueContext(req, res, async (context) => {
    res.status(200).json(await deleteCartItem(context, param(req, 'itemId')))
  })
})

orderFlowRouter.post('/cart/approve', requireAuth, async (req, res) => {
  await withVenueContext(req, res, async (context) => {
    res.status(200).json(await approveCart(context))
  })
})

orderFlowRouter.post('/checkout/preview', requireAuth, async (req, res) => {
  await withVenueContext(req, res, async (context) => {
    res.status(200).json(await previewCheckout(context))
  })
})

orderFlowRouter.post('/orders', requireAuth, async (req, res) => {
  await withVenueContext(req, res, async (context) => {
    await sendIdempotent(req, res, 'POST /orders', 201, async () => createOrder(context))
  })
})

orderFlowRouter.get('/orders', requireAuth, async (req, res) => {
  await withVenueContext(req, res, async (context) => {
    res.status(200).json(await listOrders(context, req.query))
  })
})

orderFlowRouter.get('/orders/:orderId', requireAuth, async (req, res) => {
  await withVenueContext(req, res, async (context) => {
    res.status(200).json(await getOrder(context, param(req, 'orderId')))
  })
})

orderFlowRouter.get('/supplier-orders/pending-confirmation', requireAuth, async (req, res) => {
  await withVenueContext(req, res, async (context) => {
    res.status(200).json(await pendingConfirmation(context))
  })
})

orderFlowRouter.get('/supplier-orders/:supplierOrderId', requireAuth, async (req, res) => {
  await withVenueContext(req, res, async (context) => {
    res.status(200).json(await getSupplierOrder(context, param(req, 'supplierOrderId')))
  })
})

orderFlowRouter.post('/supplier-orders/:supplierOrderId/cancel', requireAuth, async (req, res) => {
  await withVenueContext(req, res, async (context) => {
    res.status(200).json(await cancelSupplierOrder(context, param(req, 'supplierOrderId')))
  })
})

orderFlowRouter.post('/supplier-orders/:supplierOrderId/repeat', requireAuth, async (req, res) => {
  await withVenueContext(req, res, async (context) => {
    res.status(200).json(await repeatSupplierOrder(context, param(req, 'supplierOrderId')))
  })
})

orderFlowRouter.post('/supplier-orders/:supplierOrderId/confirm-delivery', requireAuth, async (req, res) => {
  await withVenueContext(req, res, async (context) => {
    await sendIdempotent(
      req,
      res,
      `POST /supplier-orders/${param(req, 'supplierOrderId')}/confirm-delivery`,
      200,
      async () => confirmDelivery(context, param(req, 'supplierOrderId')),
    )
  })
})

orderFlowRouter.get('/corrections/:correctionId', requireAuth, async (req, res) => {
  await withVenueContext(req, res, async (context) => {
    res.status(200).json(await getCorrection(context, param(req, 'correctionId')))
  })
})

orderFlowRouter.post('/corrections/:correctionId/decision', requireAuth, async (req, res) => {
  await withVenueContext(req, res, async (context) => {
    await sendIdempotent(
      req,
      res,
      `POST /corrections/${param(req, 'correctionId')}/decision`,
      200,
      async () => decideCorrection(context, param(req, 'correctionId'), req.body ?? {}),
    )
  })
})

orderFlowRouter.get('/stream', requireAuth, async (req, res) => {
  try {
    await requireVenueContext(req.auth!, req.headers['x-venue-id'])
    res.writeHead(200, {
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream',
    })
    res.write('retry: 3000\n\n')
    res.write(`event: connected\ndata: ${JSON.stringify({ topics: req.query.topics ?? null })}\n\n`)
  } catch (error) {
    sendOrderError(res, error)
  }
})

orderProductsRouter.get('/:sku/offers', requireAuth, async (req, res) => {
  await withVenueContext(req, res, async (context) => {
    res.status(200).json(await getProductOffers(context, param(req, 'sku')))
  })
})

export { orderProductsRouter }
export default orderFlowRouter
