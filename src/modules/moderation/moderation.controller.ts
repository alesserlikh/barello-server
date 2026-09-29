import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import fs from 'fs'
import path from 'path'
import multer from 'multer'

import { env } from '../../config/env'

import {
  executeAccountDeletionRequest,
  isAccountDeletionError,
  listAccountDeletionRequests,
  type ModeratorContext,
} from '../account-deletion/account-deletion.service'
import {
  confirmExistingModerationSupplierAccount,
  createModerationSupplier,
  deleteModerationSupplier,
  deleteModerationSupplierPriceImport,
  deleteModerationUserHard,
  deleteModerationVenueFile,
  deleteModerationVenuePhoto,
  getModerationDashboard,
  getModerationVenueFilePreview,
  getModerationMemberships,
  getModerationSuppliers,
  getModerationSupplierDetail,
  getModerationSupplierPriceImportDownload,
  getModerationSupplierPriceImportOverview,
  getModerationSupplierPriceImports,
  getModerationSupplierProducts,
  suggestModerationSupplierProducts,
  updateModerationSupplierProduct,
  getModerationUserDetail,
  getModerationUsers,
  getModerationBusinessDetail,
  getModerationVenueDetail,
  getModerationVenueActiveOrders,
  getModerationVenueEmployees,
  getModerationVenues,
  isModerationStatusError,
  isModerationUserDeletionError,
  isModerationUsersFilterError,
  updateModerationMembershipAccessLevel,
  updateModerationMembershipRole,
  updateModerationMembershipStatus,
  updateModerationUserAdminGroup,
  updateModerationUserProfile,
  updateModerationSupplierActivity,
  updateModerationSupplierAccessStatus,
  updateModerationSupplier,
  importModerationSupplierPrice,
  importModerationVenueStockFile,
  replaceModerationVenueFile,
  replaceModerationSupplierPriceImport,
  rejectModerationVenuePhoto,
  searchModerationAdmin,
  uploadModerationVenueFile,
  uploadModerationVenuePhotos,
  updateModerationUserStatus,
  updateModerationVenueActivity,
  updateModerationVenueBusiness,
  updateModerationVenueDetail,
  updateModerationVenueInventorySessionStatus,
  updateModerationVenueStatus,
} from './moderation.service'
import {
  isModerationSupplierValidationError,
  parseConfirmExistingSupplierAccountDto,
  parseCreateModerationSupplierDto,
  parseUpdateModerationSupplierDto,
  parseUpdateModerationSupplierProductDto,
} from './moderation-suppliers.contract'

const moderationRouter = Router()
const moderationUploadsDir = path.resolve(process.cwd(), 'uploads')

if (!fs.existsSync(moderationUploadsDir)) {
  fs.mkdirSync(moderationUploadsDir, { recursive: true })
}

const moderationPriceUpload = multer({
  dest: moderationUploadsDir,
  limits: { fileSize: 25 * 1024 * 1024 },
})

function getSafeVenueUploadParam(value: unknown) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_')
}

function createModerationVenueUploadFileName(file: Express.Multer.File) {
  const extension = path.extname(file.originalname).toLowerCase()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}${extension}`
}

function getModerationVenueUploadDir(venueId: unknown, kind: 'photos' | 'files') {
  const dir = path.join(
    moderationUploadsDir,
    'venue-profile',
    getSafeVenueUploadParam(venueId),
    kind
  )

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  return dir
}

const moderationVenuePhotoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, callback) => {
      callback(null, getModerationVenueUploadDir(req.params.id, 'photos'))
    },
    filename: (_req, file, callback) => {
      callback(null, createModerationVenueUploadFileName(file))
    },
  }),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 3,
  },
  fileFilter: (_req, file, callback) => {
    if (!file.mimetype.toLowerCase().startsWith('image/')) {
      callback(new Error('Only image uploads are supported'))
      return
    }

    callback(null, true)
  },
})

const moderationVenueFileUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, callback) => {
      callback(null, getModerationVenueUploadDir(req.params.id, 'files'))
    },
    filename: (_req, file, callback) => {
      callback(null, createModerationVenueUploadFileName(file))
    },
  }),
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 1,
  },
})

function uploadModerationPrice(req: any, res: any, next: any) {
  moderationPriceUpload.single('file')(req, res, (error) => {
    if (!error) {
      next()
      return
    }

    res.status(400).json({
      error: {
        code: 'PRICE_IMPORT_FAILED',
        message: error instanceof Error ? error.message : 'Не удалось принять файл прайса',
        details: { field: 'file' },
      },
    })
  })
}

function sendModerationSupplierError(res: any, error: unknown) {
  if (!isModerationSupplierValidationError(error)) {
    return false
  }

  res.status(error.status).json({
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
    },
  })
  return true
}

function getBearerToken(authorizationHeader?: string) {
  if (!authorizationHeader) {
    return null
  }

  const [scheme, token] = authorizationHeader.split(' ')

  if (scheme !== 'Bearer' || !token) {
    return null
  }

  return token
}

function requireModeratorAuth(req: any, res: any, next: any) {
  try {
    const token = getBearerToken(req.headers.authorization)

    if (!token) {
      res.status(401).json({
        ok: false,
        error: 'Требуется токен авторизации',
      })
      return
    }

    const payload = jwt.verify(token, env.jwtSecret) as {
      moderatorId?: string
      role?: string
      email?: string
    }

    if (!payload?.moderatorId || payload.role !== 'PLATFORM_MODERATOR') {
      res.status(403).json({
        ok: false,
        error: 'Требуется доступ модератора',
      })
      return
    }

    const moderator = env.moderators.find(
      (item) => item.id === payload.moderatorId
    )

    if (!moderator) {
      res.status(403).json({
        ok: false,
        error: 'Доступ модератора запрещён',
      })
      return
    }

    req.moderator = {
      id: moderator.id,
      name: moderator.name,
      email: moderator.email,
      role: moderator.role,
    }

    next()
  } catch {
    res.status(401).json({
      ok: false,
      error: 'Недействительный или просроченный токен',
    })
  }
}

moderationRouter.post('/auth/login', async (req, res) => {
  const { email, password } = req.body

  if (!email || !password) {
    res.status(400).json({
      ok: false,
      error: 'Требуются email и пароль',
    })
    return
  }

  const normalizedEmail = String(email).trim().toLowerCase()

  const moderator = env.moderators.find(
    (item) => item.email.toLowerCase() === normalizedEmail
  )

  if (!moderator) {
    res.status(401).json({
      ok: false,
      error: 'Неверный email или пароль',
    })
    return
  }

  const passwordIsValid = await bcrypt.compare(
    String(password),
    moderator.passwordHash
  )

  if (!passwordIsValid) {
    res.status(401).json({
      ok: false,
      error: 'Неверный email или пароль',
    })
    return
  }

  const token = jwt.sign(
    {
      moderatorId: moderator.id,
      email: moderator.email,
      role: moderator.role,
    },
    env.jwtSecret,
    {
      expiresIn: env.jwtExpiresIn as any,
    }
  )

  res.status(200).json({
    token,
    moderator: {
      id: moderator.id,
      name: moderator.name,
      email: moderator.email,
      role: moderator.role,
    },
  })
})

moderationRouter.use(requireModeratorAuth)

moderationRouter.get('/dashboard', async (_req, res, next) => {
  try {
    res.status(200).json(await getModerationDashboard())
  } catch (error) {
    next(error)
  }
})

moderationRouter.get('/search', async (req, res, next) => {
  try {
    res.status(200).json(await searchModerationAdmin(req.query.q))
  } catch (error) {
    next(error)
  }
})

moderationRouter.get('/users', async (req, res, next) => {
  try {
    const users = await getModerationUsers(req.query)
    res.status(200).json(users)
  } catch (error) {
    if (isModerationUsersFilterError(error)) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationRouter.get('/users/:id', async (req, res, next) => {
  try {
    const { id } = req.params

    const userDetail = await getModerationUserDetail(id)

    if (!userDetail) {
      res.status(404).json({
        ok: false,
        error: 'Пользователь не найден',
      })
      return
    }

    res.status(200).json(userDetail)
  } catch (error) {
    next(error)
  }
})

moderationRouter.patch('/users/:id/profile', async (req, res, next) => {
  try {
    const { id } = req.params
    const result = await updateModerationUserProfile(id, req.body ?? {})

    res.status(200).json({
      ok: true,
      ...result,
    })
  } catch (error) {
    if (isModerationStatusError(error)) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationRouter.delete('/users/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const result = await deleteModerationUserHard(id)

    res.status(200).json(result)
  } catch (error) {
    if (isModerationUserDeletionError(error)) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})
moderationRouter.get('/account-deletion-requests', async (_req, res, next) => {
  try {
    const requests = await listAccountDeletionRequests()
    res.status(200).json(requests)
  } catch (error) {
    next(error)
  }
})

moderationRouter.post('/account-deletion-requests/:id/execute', async (req, res) => {
  try {
    const moderator = (req as any).moderator as ModeratorContext

    const result = await executeAccountDeletionRequest(
      req.params.id,
      moderator,
      req.body
    )

    res.status(200).json(result)
  } catch (error) {
    if (isAccountDeletionError(error)) {
      res.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
        },
      })
      return
    }

    console.error('POST /moderation/account-deletion-requests/:id/execute failed:', error)
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message:
          error instanceof Error ? error.message : 'Failed to execute account deletion',
      },
    })
  }
})

moderationRouter.patch('/users/:id/admin-group', async (req, res, next) => {
  try {
    const { id } = req.params
    const { adminGroup } = req.body

    if (!adminGroup) {
      res.status(400).json({
        ok: false,
        error: 'Field adminGroup is required',
      })
      return
    }

    const updatedUser = await updateModerationUserAdminGroup(id, adminGroup)

    res.status(200).json({
      ok: true,
      user: updatedUser,
    })
  } catch (error) {
    if (isModerationStatusError(error)) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})
moderationRouter.patch('/users/:id/status', async (req, res, next) => {
  try {
    const { id } = req.params
    const { status } = req.body

    if (!status) {
      res.status(400).json({
        ok: false,
        error: 'Поле status обязательно',
      })
      return
    }

    const updatedUser = await updateModerationUserStatus(id, status)

    res.status(200).json({
      ok: true,
      user: updatedUser,
    })
  } catch (error) {
    if (isModerationStatusError(error)) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationRouter.get('/venues', async (req, res, next) => {
  try {
    const venues = await getModerationVenues(req.query)
    res.status(200).json(venues)
  } catch (error) {
    next(error)
  }
})

moderationRouter.get('/venues/:id', async (req, res, next) => {
  try {
    const venueDetail = await getModerationVenueDetail(req.params.id)

    if (!venueDetail) {
      res.status(404).json({
        ok: false,
        error: 'Venue not found',
      })
      return
    }

    res.status(200).json(venueDetail)
  } catch (error) {
    next(error)
  }
})

moderationRouter.get('/venues/:id/employees', async (req, res, next) => {
  try {
    const result = await getModerationVenueEmployees(req.params.id)

    if (!result) {
      res.status(404).json({
        ok: false,
        error: 'Venue not found',
      })
      return
    }

    res.status(200).json({
      ok: true,
      ...result,
    })
  } catch (error) {
    next(error)
  }
})

moderationRouter.get('/venues/:id/active-orders', async (req, res, next) => {
  try {
    const result = await getModerationVenueActiveOrders(req.params.id)

    if (!result) {
      res.status(404).json({
        ok: false,
        error: 'Venue not found',
      })
      return
    }

    res.status(200).json({
      ok: true,
      ...result,
    })
  } catch (error) {
    next(error)
  }
})

moderationRouter.patch('/venues/:id', async (req, res, next) => {
  try {
    const venueDetail = await updateModerationVenueDetail(req.params.id, req.body ?? {})

    if (!venueDetail) {
      res.status(404).json({
        ok: false,
        error: 'Venue not found',
      })
      return
    }

    res.status(200).json({
      ok: true,
      venueDetail,
    })
  } catch (error) {
    if (isModerationStatusError(error)) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationRouter.patch('/venues/:id/business', async (req, res, next) => {
  try {
    const venueDetail = await updateModerationVenueBusiness(req.params.id, req.body ?? {})

    if (!venueDetail) {
      res.status(404).json({
        ok: false,
        error: 'Venue not found',
      })
      return
    }

    res.status(200).json({
      ok: true,
      venueDetail,
    })
  } catch (error) {
    if (isModerationStatusError(error)) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationRouter.patch('/venues/:id/inventory-sessions/:sessionId/status', async (req, res, next) => {
  try {
    const venueDetail = await updateModerationVenueInventorySessionStatus(
      req.params.id,
      req.params.sessionId,
      req.body?.status
    )

    if (!venueDetail) {
      res.status(404).json({
        ok: false,
        error: 'Venue not found',
      })
      return
    }

    res.status(200).json({
      ok: true,
      venueDetail,
    })
  } catch (error) {
    if (isModerationStatusError(error)) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationRouter.post('/venues/:id/photos', (req, res, next) => {
  moderationVenuePhotoUpload.array('files', 3)(req, res, async (uploadError) => {
    if (uploadError) {
      res.status(400).json({
        ok: false,
        error:
          uploadError instanceof Error
            ? uploadError.message
            : 'Не удалось загрузить фото',
      })
      return
    }

    try {
      const files = Array.isArray(req.files)
        ? (req.files as Express.Multer.File[])
        : []
      const venueDetail = await uploadModerationVenuePhotos(req.params.id, files)

      if (!venueDetail) {
        res.status(404).json({
          ok: false,
          error: 'Venue not found',
        })
        return
      }

      res.status(201).json({
        ok: true,
        venueDetail,
      })
    } catch (error) {
      if (isModerationStatusError(error)) {
        res.status(error.status).json({
          ok: false,
          error: error.message,
        })
        return
      }

      next(error)
    }
  })
})

moderationRouter.patch('/venues/:id/photos/:photoId/reject', async (req, res, next) => {
  try {
    const venueDetail = await rejectModerationVenuePhoto(
      req.params.id,
      req.params.photoId
    )

    if (!venueDetail) {
      res.status(404).json({
        ok: false,
        error: 'Venue not found',
      })
      return
    }

    res.status(200).json({
      ok: true,
      venueDetail,
    })
  } catch (error) {
    if (isModerationStatusError(error)) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationRouter.delete('/venues/:id/photos/:photoId', async (req, res, next) => {
  try {
    const venueDetail = await deleteModerationVenuePhoto(
      req.params.id,
      req.params.photoId
    )

    if (!venueDetail) {
      res.status(404).json({
        ok: false,
        error: 'Venue not found',
      })
      return
    }

    res.status(200).json({
      ok: true,
      venueDetail,
    })
  } catch (error) {
    if (isModerationStatusError(error)) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationRouter.post('/venues/:id/files', (req, res, next) => {
  moderationVenueFileUpload.single('file')(req, res, async (uploadError) => {
    if (uploadError) {
      res.status(400).json({
        ok: false,
        error:
          uploadError instanceof Error
            ? uploadError.message
            : 'Не удалось загрузить файл',
      })
      return
    }

    try {
      const venueDetail = await uploadModerationVenueFile(
        req.params.id,
        req.body?.purpose,
        req.file
      )

      if (!venueDetail) {
        res.status(404).json({
          ok: false,
          error: 'Venue not found',
        })
        return
      }

      res.status(201).json({
        ok: true,
        venueDetail,
      })
    } catch (error) {
      if (isModerationStatusError(error)) {
        res.status(error.status).json({
          ok: false,
          error: error.message,
        })
        return
      }

      next(error)
    }
  })
})

moderationRouter.get('/venues/:id/files/:downloadId/preview', async (req, res, next) => {
  try {
    const preview = await getModerationVenueFilePreview(
      req.params.id,
      req.params.downloadId
    )

    if (!preview) {
      res.status(404).json({
        ok: false,
        error: 'File not found',
      })
      return
    }

    res.status(200).json({
      ok: true,
      ...preview,
    })
  } catch (error) {
    if (isModerationStatusError(error)) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationRouter.delete('/venues/:id/files/:downloadId', async (req, res, next) => {
  try {
    const venueDetail = await deleteModerationVenueFile(
      req.params.id,
      req.params.downloadId
    )

    if (!venueDetail) {
      res.status(404).json({
        ok: false,
        error: 'File not found',
      })
      return
    }

    res.status(200).json({
      ok: true,
      venueDetail,
    })
  } catch (error) {
    if (isModerationStatusError(error)) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationRouter.post('/venues/:id/files/:downloadId/replace', (req, res, next) => {
  moderationVenueFileUpload.single('file')(req, res, async (uploadError) => {
    if (uploadError) {
      res.status(400).json({
        ok: false,
        error:
          uploadError instanceof Error
            ? uploadError.message
            : 'Не удалось загрузить файл',
      })
      return
    }

    try {
      const venueDetail = await replaceModerationVenueFile(
        req.params.id,
        req.params.downloadId,
        req.body?.purpose,
        req.file
      )

      if (!venueDetail) {
        res.status(404).json({
          ok: false,
          error: 'File not found',
        })
        return
      }

      res.status(200).json({
        ok: true,
        venueDetail,
      })
    } catch (error) {
      if (isModerationStatusError(error)) {
        res.status(error.status).json({
          ok: false,
          error: error.message,
        })
        return
      }

      next(error)
    }
  })
})

moderationRouter.post('/venues/:id/files/:downloadId/import-stock', async (req, res, next) => {
  try {
    const result = await importModerationVenueStockFile(
      req.params.id,
      req.params.downloadId
    )

    if (!result) {
      res.status(404).json({
        ok: false,
        error: 'File not found',
      })
      return
    }

    res.status(200).json({
      ok: true,
      ...result,
    })
  } catch (error) {
    if (isModerationStatusError(error)) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationRouter.get('/businesses/:id', async (req, res, next) => {
  try {
    const businessDetail = await getModerationBusinessDetail(req.params.id)

    if (!businessDetail) {
      res.status(404).json({
        ok: false,
        error: 'Business not found',
      })
      return
    }

    res.status(200).json(businessDetail)
  } catch (error) {
    next(error)
  }
})

moderationRouter.patch('/venues/:id/status', async (req, res, next) => {
  try {
    const venueDetail = await updateModerationVenueStatus(
      req.params.id,
      req.body?.venueStatus
    )

    if (!venueDetail) {
      res.status(404).json({
        ok: false,
        error: 'Venue not found',
      })
      return
    }

    res.status(200).json({
      ok: true,
      venueDetail,
    })
  } catch (error) {
    if (isModerationStatusError(error)) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})
moderationRouter.patch('/venues/:id/activity', async (req, res, next) => {
  try {
    const { id } = req.params
    const { isActive } = req.body

    if (typeof isActive !== 'boolean') {
      res.status(400).json({
        ok: false,
        error: 'Поле isActive должно быть булевым значением',
      })
      return
    }

    const updatedVenue = await updateModerationVenueActivity(id, isActive)

    res.status(200).json({
      ok: true,
      venue: updatedVenue,
    })
  } catch (error) {
    next(error)
  }
})

moderationRouter.post('/suppliers', async (req, res, next) => {
  try {
    const input = parseCreateModerationSupplierDto(req.body)
    const supplier = await createModerationSupplier(input, (req as any).moderator)

    res.status(201).json({
      ok: true,
      supplier,
    })
  } catch (error) {
    if (isModerationSupplierValidationError(error)) {
      res.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      })
      return
    }

    next(error)
  }
})

moderationRouter.post(
  '/suppliers/confirm-existing-account',
  async (req, res, next) => {
    try {
      const input = parseConfirmExistingSupplierAccountDto(req.body)
      const supplier = await confirmExistingModerationSupplierAccount(
        input,
        (req as any).moderator
      )

      res.status(201).json({
        ok: true,
        supplier,
      })
    } catch (error) {
      if (isModerationSupplierValidationError(error)) {
        res.status(error.status).json({
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        })
        return
      }

      next(error)
    }
  }
)

moderationRouter.get('/suppliers', async (req, res, next) => {
  try {
    const suppliers = await getModerationSuppliers(req.query)
    res.status(200).json(suppliers)
  } catch (error) {
    next(error)
  }
})

moderationRouter.get('/suppliers/:id/products', async (req, res, next) => {
  try {
    const products = await getModerationSupplierProducts(req.params.id, req.query)
    res.status(200).json(products)
  } catch (error) {
    if (!sendModerationSupplierError(res, error)) next(error)
  }
})

moderationRouter.get('/suppliers/:id/products/suggest', async (req, res, next) => {
  try {
    const suggestions = await suggestModerationSupplierProducts(req.params.id, req.query)
    res.status(200).json(suggestions)
  } catch (error) {
    if (!sendModerationSupplierError(res, error)) next(error)
  }
})

moderationRouter.patch('/suppliers/:id/products/:productId', async (req, res, next) => {
  try {
    const input = parseUpdateModerationSupplierProductDto(req.body)
    const product = await updateModerationSupplierProduct(
      req.params.id,
      req.params.productId,
      input
    )
    res.status(200).json({ ok: true, product })
  } catch (error) {
    if (!sendModerationSupplierError(res, error)) next(error)
  }
})

moderationRouter.get('/suppliers/:id', async (req, res, next) => {
  try {
    const supplier = await getModerationSupplierDetail(req.params.id)
    res.status(200).json(supplier)
  } catch (error) {
    if (!sendModerationSupplierError(res, error)) next(error)
  }
})

moderationRouter.patch('/suppliers/:id', async (req, res, next) => {
  try {
    const input = parseUpdateModerationSupplierDto(req.body)
    const supplier = await updateModerationSupplier(
      req.params.id,
      input,
      (req as any).moderator
    )
    res.status(200).json({ ok: true, supplier })
  } catch (error) {
    if (!sendModerationSupplierError(res, error)) next(error)
  }
})

moderationRouter.patch('/suppliers/:id/access-status', async (req, res, next) => {
  try {
    const supplier = await updateModerationSupplierAccessStatus(
      req.params.id,
      req.body?.accessStatus,
      (req as any).moderator
    )
    res.status(200).json({ ok: true, supplier })
  } catch (error) {
    if (!sendModerationSupplierError(res, error)) next(error)
  }
})

moderationRouter.post(
  '/suppliers/:id/price-imports',
  uploadModerationPrice,
  async (req, res, next) => {
    try {
      const imported = await importModerationSupplierPrice(
        req.params.id,
        req.file,
        (req as any).moderator,
        {
          uploadType: req.body?.uploadType === 'ORIGINAL' ? 'ORIGINAL' : 'NORMALIZED',
        }
      )
      res.status(201).json({ ok: true, import: imported })
    } catch (error) {
      if (req.file?.path) {
        await fs.promises.rm(req.file.path, { force: true }).catch(() => undefined)
      }
      if (!sendModerationSupplierError(res, error)) next(error)
    }
  }
)

moderationRouter.get('/suppliers/:id/price-imports', async (req, res, next) => {
  try {
    const imports = await getModerationSupplierPriceImports(req.params.id)
    res.status(200).json({ ok: true, imports })
  } catch (error) {
    if (!sendModerationSupplierError(res, error)) next(error)
  }
})

moderationRouter.delete(
  '/suppliers/:id/price-imports/:importId',
  async (req, res, next) => {
    try {
      const result = await deleteModerationSupplierPriceImport(
        req.params.id,
        req.params.importId,
        (req as any).moderator
      )
      res.status(200).json(result)
    } catch (error) {
      if (!sendModerationSupplierError(res, error)) next(error)
    }
  }
)

moderationRouter.get(
  '/suppliers/:id/price-imports/:importId/download',
  async (req, res, next) => {
    try {
      const file = await getModerationSupplierPriceImportDownload(
        req.params.id,
        req.params.importId
      )
      res.setHeader('Content-Type', file.mimeType)
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.fileName)}"`)
      res.download(file.absolutePath, file.fileName)
    } catch (error) {
      if (!sendModerationSupplierError(res, error)) next(error)
    }
  }
)

moderationRouter.get(
  '/suppliers/:id/price-imports/:importId',
  async (req, res, next) => {
    try {
      const overview = await getModerationSupplierPriceImportOverview(
        req.params.id,
        req.params.importId,
        {
          page: req.query.page === undefined ? undefined : Number(req.query.page),
          pageSize: req.query.pageSize === undefined ? undefined : Number(req.query.pageSize),
        }
      )
      res.status(200).json({ ok: true, ...overview })
    } catch (error) {
      if (!sendModerationSupplierError(res, error)) next(error)
    }
  }
)

moderationRouter.put(
  '/suppliers/:id/price-imports/:importId',
  uploadModerationPrice,
  async (req, res, next) => {
    try {
      const result = await replaceModerationSupplierPriceImport(
        req.params.id,
        req.params.importId,
        req.file,
        (req as any).moderator,
        {
          uploadType: req.body?.uploadType === 'ORIGINAL' ? 'ORIGINAL' : 'NORMALIZED',
        }
      )
      res.status(200).json(result)
    } catch (error) {
      if (req.file?.path) {
        await fs.promises.rm(req.file.path, { force: true }).catch(() => undefined)
      }
      if (!sendModerationSupplierError(res, error)) next(error)
    }
  }
)

moderationRouter.delete('/suppliers/:id', async (req, res, next) => {
  try {
    const result = await deleteModerationSupplier(
      req.params.id,
      (req as any).moderator
    )
    res.status(200).json(result)
  } catch (error) {
    if (!sendModerationSupplierError(res, error)) next(error)
  }
})

moderationRouter.patch('/suppliers/:id/activity', async (req, res, next) => {
  try {
    const { id } = req.params
    const { isActive } = req.body

    if (typeof isActive !== 'boolean') {
      res.status(400).json({
        ok: false,
        error: 'Поле isActive должно быть булевым значением',
      })
      return
    }

    const updatedSupplier = await updateModerationSupplierActivity(id, isActive)

    res.status(200).json({
      ok: true,
      supplier: updatedSupplier,
    })
  } catch (error) {
    next(error)
  }
})

moderationRouter.get('/memberships', async (req, res, next) => {
  try {
    const memberships = await getModerationMemberships(req.query)
    res.status(200).json(memberships)
  } catch (error) {
    next(error)
  }
})

moderationRouter.patch('/memberships/:id/status', async (req, res, next) => {
  try {
    const { id } = req.params
    const { membershipStatus } = req.body

    if (!membershipStatus) {
      res.status(400).json({
        ok: false,
        error: 'Поле membershipStatus обязательно',
      })
      return
    }

    const updatedMembership = await updateModerationMembershipStatus(
      id,
      membershipStatus
    )

    res.status(200).json({
      ok: true,
      membership: updatedMembership,
    })
  } catch (error) {
    if (isModerationStatusError(error)) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationRouter.patch('/memberships/:id/access-level', async (req, res, next) => {
  try {
    const { id } = req.params
    const { accessLevel } = req.body

    if (!accessLevel) {
      res.status(400).json({
        ok: false,
        error: 'Field accessLevel is required',
      })
      return
    }

    const updatedMembership = await updateModerationMembershipAccessLevel(
      id,
      accessLevel
    )

    res.status(200).json({
      ok: true,
      membership: updatedMembership,
    })
  } catch (error) {
    if (isModerationStatusError(error)) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationRouter.patch('/memberships/:id/role', async (req, res, next) => {
  try {
    const { id } = req.params
    const { displayRole } = req.body

    if (!displayRole) {
      res.status(400).json({
        ok: false,
        error: 'Field displayRole is required',
      })
      return
    }

    const updatedMembership = await updateModerationMembershipRole(
      id,
      displayRole
    )

    res.status(200).json({
      ok: true,
      membership: updatedMembership,
    })
  } catch (error) {
    if (isModerationStatusError(error)) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

export default moderationRouter
