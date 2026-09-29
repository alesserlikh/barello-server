import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import helmet from 'helmet'

import { env } from './config/env'
import { normalizeApiErrors } from './http/error-normalization'
import {
  authAuditMiddleware,
  authRateLimiter,
  buildRequestLogContext,
  moderationLoginRateLimiter,
  refreshRateLimiter,
  requestIdMiddleware,
} from './http/security'

import productsRouter from './modules/products/public-products.controller'
import catalogRouter from './modules/catalog/catalog.controller'
import contentRouter from './modules/content/content.controller'
import suppliersRouter from './modules/products/suppliers.controller'
import categoriesRouter from './modules/products/public-categories.controller'
import authRouter from './modules/auth/auth.controller'
import authAccountDeletionRouter from './modules/auth/auth-account-deletion.controller'
import authProfileCompletionRouter from './modules/auth/auth-profile-completion.controller'
import companiesRouter from './modules/companies/companies.controller'
import profileRouter from './modules/profile/profile.controller'
import emailVerificationRouter from './modules/profile/email-verification.controller'
import priceImportsRouter from './modules/price-imports/price-imports.controller'
import moderationRouter from './modules/moderation/moderation.controller'
import moderationCatalogRouter from './modules/moderation/moderation-catalog.controller'
import moderationContentRouter from './modules/moderation/moderation-content.controller'
import registrationRouter from './modules/auth/registration.controller'
import staffInvitationsRouter from './modules/auth/staff-invitations.controller'
import homeContextRouter from './modules/auth/home-context.controller'
import venueContextRouter from './modules/venues/venue-context.controller'
import supplierContextRouter from './modules/suppliers/supplier-context.controller'
import { getUploadsRootDir } from './modules/profile/profile-media.service'
import notificationsRouter from './modules/notifications/notifications.controller'
import tasksRouter from './modules/tasks/tasks.controller'
import notesRouter from './modules/notes/notes.controller'
import downloadsRouter from './modules/downloads/downloads.controller'
import supplierPriceImportsRouter from './modules/price-imports/supplier-price-imports.controller'
import orderFlowRouter, { orderProductsRouter } from './modules/order-flow/order-flow.controller'

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', env.trustProxy)

const clientDistPath = path.resolve(process.cwd(), '..', 'client', 'dist')
const clientIndexPath = path.join(clientDistPath, 'index.html')
const uploadsRootDir = getUploadsRootDir()
const hasClientDist =
  fs.existsSync(clientDistPath) && fs.existsSync(clientIndexPath)
const apiRoutePrefixes = [
  '/auth',
  '/profile',
  '/notifications',
  '/tasks',
  '/notes',
  '/downloads',
  '/products',
  '/cart',
  '/checkout',
  '/orders',
  '/supplier-orders',
  '/corrections',
  '/stream',
  '/catalog',
  '/content',
  '/suppliers',
  '/categories',
  '/companies',
  '/price-imports',
  '/moderation',
  '/registration-drafts',
  '/staff-invitations',
  '/venues',
  '/me',
  '/email-verification',
  '/home-context',
  '/health',
]

function isApiRequestPath(requestPath: string) {
  return apiRoutePrefixes.some(
    (prefix) => requestPath === prefix || requestPath.startsWith(`${prefix}/`)
  )
}

const allowedOrigins = new Set(
  [
    env.clientUrl,
    env.adminClientUrl,
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'http://127.0.0.1:5175',
    'https://barello.ru',
    'https://admin.barello.ru',
  ]
    .filter(Boolean)
    .map((origin) => origin.replace(/\/$/, ''))
)

const corsOptions: cors.CorsOptions = {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true)
      return
    }

    const normalizedOrigin = origin.replace(/\/$/, '')

    if (allowedOrigins.has(normalizedOrigin)) {
      callback(null, true)
      return
    }

    callback(null, false)
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Venue-Id', 'Idempotency-Key'],
}

app.use(requestIdMiddleware)
app.use(normalizeApiErrors)
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
    hsts: env.nodeEnv === 'production',
  })
)
app.use(cors(corsOptions))
app.options('/{*splat}', cors(corsOptions))
app.use(authAuditMiddleware)

app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: false, limit: '100kb' }))

app.use('/auth/login', authRateLimiter)
app.use('/auth/refresh', refreshRateLimiter)
app.use('/moderation/auth/login', moderationLoginRateLimiter)

if (hasClientDist) {
  app.use(express.static(clientDistPath))
}

if (fs.existsSync(uploadsRootDir)) {
  app.use('/uploads', express.static(uploadsRootDir))
}

app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'barello-server',
  })
})

app.use('/moderation', moderationRouter)
app.use('/moderation', moderationCatalogRouter)
app.use('/moderation', moderationContentRouter)

app.use(registrationRouter)
app.use(staffInvitationsRouter)
app.use(homeContextRouter)
app.use(venueContextRouter)
app.use(supplierContextRouter)
app.use(emailVerificationRouter)
app.use('/auth', authProfileCompletionRouter)
app.use('/auth', authAccountDeletionRouter)
app.use('/auth', authRouter)
app.use('/companies', companiesRouter)
app.use('/profile', profileRouter)
app.use(notificationsRouter)
app.use(tasksRouter)
app.use(notesRouter)
app.use(downloadsRouter)
app.use('/catalog', catalogRouter)
app.use('/content', contentRouter)
app.use('/products', orderProductsRouter)
app.use('/products', productsRouter)
app.use('/suppliers', suppliersRouter)
app.use('/categories', categoriesRouter)
app.use(orderFlowRouter)
app.use('/price-imports', priceImportsRouter)
app.use('/supplier/price-imports', supplierPriceImportsRouter)

app.get('/{*splat}', (req, res, next) => {
  if (
    !hasClientDist ||
    req.method !== 'GET' ||
    isApiRequestPath(req.path) ||
    path.extname(req.path) ||
    !req.accepts('html')
  ) {
    next()
    return
  }

  res.sendFile(clientIndexPath)
})

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: `Route not found: ${req.method} ${req.path}`,
  })
})

app.use(
  (
    error: unknown,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error('Unhandled error:', {
      ...buildRequestLogContext(req),
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      errorStack: error instanceof Error ? error.stack : undefined,
    })

    res.status(500).json({
      ok: false,
      error: 'Internal server error',
      requestId: req.requestId ?? null,
    })
  }
)

export default app
