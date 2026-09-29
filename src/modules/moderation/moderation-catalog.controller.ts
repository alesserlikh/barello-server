import { Router } from 'express'
import jwt from 'jsonwebtoken'
import fs from 'fs'
import path from 'path'
import multer from 'multer'
import { env } from '../../config/env'
import {
  CatalogFacetAdminError,
  createModerationCatalogFacet,
  deleteModerationCatalogFacet,
  getModerationCatalogFacetById,
  getModerationCatalogFacetPreview,
  getModerationCatalogFacets,
  updateModerationCatalogFacet,
} from '../catalog-filters/catalog-facet-admin.service'
import {
  addModerationCatalogProductAlias,
  confirmModerationCatalogProduct,
  createModerationCatalogCategory,
  createModerationCatalogCategoryMapping,
  createModerationCatalogNameDictionaryEntry,
  deleteModerationCatalogCategory,
  deleteModerationCatalogCategoryMapping,
  deleteModerationCatalogNameDictionaryEntry,
  exportModerationCatalogProductsXlsx,
  getModerationCatalogProductDetail,
  getModerationCatalogProductCard,
  getModerationCatalogMediaPreviewFile,
  getModerationCatalogProducts,
  getModerationCatalogCategories,
  getModerationCatalogCategoryMappings,
  getModerationCatalogFacetOptions,
  getModerationCatalogFilters,
  getModerationCatalogNameDictionary,
  getModerationCatalogNameTranslations,
  hideModerationCatalogProduct,
  mergeModerationCatalogProduct,
  ModerationCatalogError,
  rejectModerationCatalogProductImageCandidate,
  setModerationCatalogProductMainImage,
  splitMergeModerationCatalogProduct,
  suggestModerationCatalogProducts,
  unhideModerationCatalogProduct,
  updateModerationCatalogIssue,
  updateModerationCatalogProduct,
  updateModerationCatalogProductStatus,
  updateModerationCatalogCategoriesBulk,
  updateModerationCatalogCategory,
  updateModerationCatalogCategoryMapping,
  updateModerationCatalogNameDictionaryEntry,
  updateModerationCatalogProductCategory,
  uploadModerationCatalogProductMainImage,
  uploadModerationCatalogProductMedia,
  deleteModerationCatalogProductMedia,
} from './moderation.service'
import { applyImageCropToUpload } from './upload-crop'

const moderationCatalogRouter = Router()
const moderationCatalogUploadsDir = path.resolve(env.uploadsRoot, 'catalog-products')

if (!fs.existsSync(moderationCatalogUploadsDir)) {
  fs.mkdirSync(moderationCatalogUploadsDir, { recursive: true })
}

function getSafeProductUploadParam(value: unknown) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_')
}

function createModerationCatalogUploadFileName(file: Express.Multer.File) {
  const extension = path.extname(file.originalname).toLowerCase()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}${extension}`
}

function getModerationCatalogProductUploadDir(productId: unknown) {
  const dir = path.join(
    moderationCatalogUploadsDir,
    getSafeProductUploadParam(productId)
  )

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  return dir
}

const moderationProductMainImageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, callback) => {
      callback(null, getModerationCatalogProductUploadDir(req.params.id))
    },
    filename: (_req, file, callback) => {
      callback(null, createModerationCatalogUploadFileName(file))
    },
  }),
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    if (!file.mimetype.toLowerCase().startsWith('image/')) {
      callback(new Error('Only image uploads are supported'))
      return
    }

    callback(null, true)
  },
})

const moderationProductMediaUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, callback) => {
      callback(null, getModerationCatalogProductUploadDir(req.params.id))
    },
    filename: (_req, file, callback) => {
      callback(null, createModerationCatalogUploadFileName(file))
    },
  }),
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    const mimeType = file.mimetype.toLowerCase()
    if (!mimeType.startsWith('image/') && !mimeType.startsWith('video/')) {
      callback(new Error('Only image and video uploads are supported'))
      return
    }

    callback(null, true)
  },
})

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
    }

    if (!payload?.moderatorId || payload.role !== 'PLATFORM_MODERATOR') {
      res.status(403).json({
        ok: false,
        error: 'Требуется доступ модератора',
      })
      return
    }

    const moderator = env.moderators.find((item) => item.id === payload.moderatorId)

    if (!moderator) {
      res.status(403).json({
        ok: false,
        error: 'Доступ модератора запрещён',
      })
      return
    }

    next()
  } catch {
    res.status(401).json({
      ok: false,
      error: 'Недействительный или просроченный токен',
    })
  }
}

moderationCatalogRouter.use(requireModeratorAuth)

function sendModerationCatalogError(error: unknown, res: any, next: any) {
  if (error instanceof ModerationCatalogError || error instanceof CatalogFacetAdminError) {
    res.status(error.status).json({
      ok: false,
      error: error.message,
    })
    return
  }

  next(error)
}

moderationCatalogRouter.get('/catalog/categories', async (req, res, next) => {
  try {
    const categories = await getModerationCatalogCategories(req.query)
    res.status(200).json(categories)
  } catch (error) {
    next(error)
  }
})

moderationCatalogRouter.post('/catalog/categories', async (req, res, next) => {
  try {
    const category = await createModerationCatalogCategory(req.body ?? {})
    res.status(201).json({
      ok: true,
      category,
    })
  } catch (error) {
    if (error instanceof ModerationCatalogError) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationCatalogRouter.patch('/catalog/categories/bulk', async (req, res, next) => {
  try {
    const result = await updateModerationCatalogCategoriesBulk(req.body ?? {})
    res.status(200).json(result)
  } catch (error) {
    if (error instanceof ModerationCatalogError) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationCatalogRouter.patch('/catalog/categories/:id', async (req, res, next) => {
  try {
    const category = await updateModerationCatalogCategory(req.params.id, req.body ?? {})
    res.status(200).json({
      ok: true,
      category,
    })
  } catch (error) {
    if (error instanceof ModerationCatalogError) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationCatalogRouter.delete('/catalog/categories/:id', async (req, res, next) => {
  try {
    const result = await deleteModerationCatalogCategory(req.params.id)
    res.status(200).json(result)
  } catch (error) {
    if (error instanceof ModerationCatalogError) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationCatalogRouter.get('/catalog/filters', async (_req, res, next) => {
  try {
    const filters = await getModerationCatalogFilters()
    res.status(200).json(filters)
  } catch (error) {
    next(error)
  }
})

moderationCatalogRouter.get('/catalog/facets', async (req, res, next) => {
  try {
    const facets = await getModerationCatalogFacets(req.query)
    res.status(200).json(facets)
  } catch (error) {
    sendModerationCatalogError(error, res, next)
  }
})

moderationCatalogRouter.get('/catalog/facets/preview', async (req, res, next) => {
  try {
    const preview = await getModerationCatalogFacetPreview(req.query)
    res.status(200).json(preview)
  } catch (error) {
    sendModerationCatalogError(error, res, next)
  }
})

// Facets-with-live-counts for the admin "Товары" filter bar (ADMIN_CATALOG scope, so
// unconfirmed/hidden products are never excluded — distinct from the registry CRUD
// listing above, which returns static facet definitions without counts).
moderationCatalogRouter.get('/catalog/facets/options', async (req, res, next) => {
  try {
    const facets = (await getModerationCatalogFacetOptions(req.query)) as any
    res.status(200).json({
      ok: true,
      facets: facets.facets,
      appliedFacets: facets.appliedFacets,
    })
  } catch (error) {
    sendModerationCatalogError(error, res, next)
  }
})

// Must stay after /catalog/facets/preview and /catalog/facets/options — all three are GET,
// and an Express param route registered first would shadow these literal paths.
moderationCatalogRouter.get('/catalog/facets/:id', async (req, res, next) => {
  try {
    const result = await getModerationCatalogFacetById(req.params.id)
    res.status(200).json(result)
  } catch (error) {
    sendModerationCatalogError(error, res, next)
  }
})

moderationCatalogRouter.post('/catalog/facets', async (req, res, next) => {
  try {
    const facet = await createModerationCatalogFacet(req.body ?? {})
    res.status(201).json({
      ok: true,
      facet,
    })
  } catch (error) {
    sendModerationCatalogError(error, res, next)
  }
})

moderationCatalogRouter.patch('/catalog/facets/:id', async (req, res, next) => {
  try {
    const facet = await updateModerationCatalogFacet(req.params.id, req.body ?? {})
    res.status(200).json({
      ok: true,
      facet,
    })
  } catch (error) {
    sendModerationCatalogError(error, res, next)
  }
})

moderationCatalogRouter.delete('/catalog/facets/:id', async (req, res, next) => {
  try {
    const result = await deleteModerationCatalogFacet(req.params.id)
    res.status(200).json(result)
  } catch (error) {
    sendModerationCatalogError(error, res, next)
  }
})

moderationCatalogRouter.get('/catalog/category-mappings', async (req, res, next) => {
  try {
    const mappings = await getModerationCatalogCategoryMappings({
      supplierId:
        typeof req.query.supplierId === 'string' ? req.query.supplierId : undefined,
    })
    res.status(200).json(mappings)
  } catch (error) {
    next(error)
  }
})

moderationCatalogRouter.get('/catalog/name-dictionary', async (req, res, next) => {
  try {
    const result = await getModerationCatalogNameDictionary(req.query)
    res.status(200).json(result)
  } catch (error) {
    sendModerationCatalogError(error, res, next)
  }
})

moderationCatalogRouter.post('/catalog/name-dictionary', async (req, res, next) => {
  try {
    const entry = await createModerationCatalogNameDictionaryEntry(req.body ?? {})
    res.status(201).json({
      ok: true,
      entry,
    })
  } catch (error) {
    sendModerationCatalogError(error, res, next)
  }
})

moderationCatalogRouter.patch('/catalog/name-dictionary/:id', async (req, res, next) => {
  try {
    const entry = await updateModerationCatalogNameDictionaryEntry(req.params.id, req.body ?? {})
    res.status(200).json({
      ok: true,
      entry,
    })
  } catch (error) {
    sendModerationCatalogError(error, res, next)
  }
})

moderationCatalogRouter.delete('/catalog/name-dictionary/:id', async (req, res, next) => {
  try {
    const result = await deleteModerationCatalogNameDictionaryEntry(req.params.id)
    res.status(200).json(result)
  } catch (error) {
    sendModerationCatalogError(error, res, next)
  }
})

moderationCatalogRouter.get('/catalog/name-translations', async (req, res, next) => {
  try {
    const result = await getModerationCatalogNameTranslations(req.query)
    res.status(200).json(result)
  } catch (error) {
    sendModerationCatalogError(error, res, next)
  }
})

moderationCatalogRouter.get('/catalog/products', async (req, res, next) => {
  try {
    const products = await getModerationCatalogProducts(req.query)
    res.status(200).json(products)
  } catch (error) {
    if (error instanceof ModerationCatalogError) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationCatalogRouter.get('/catalog/products/suggest', async (req, res, next) => {
  try {
    const suggestions = await suggestModerationCatalogProducts(req.query)
    res.status(200).json(suggestions)
  } catch (error) {
    if (error instanceof ModerationCatalogError) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationCatalogRouter.get('/catalog/products/export/xlsx', async (_req, res, next) => {
  try {
    const exportFile = await exportModerationCatalogProductsXlsx()
    const encodedFileName = encodeURIComponent(exportFile.fileName)

    res.setHeader('Content-Type', exportFile.mimeType)
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${exportFile.fileName}"; filename*=UTF-8''${encodedFileName}`
    )
    res.setHeader('Content-Length', exportFile.buffer.length)
    res.status(200).send(exportFile.buffer)
  } catch (error) {
    next(error)
  }
})

moderationCatalogRouter.post('/catalog/category-mappings', async (req, res, next) => {
  try {
    const mapping = await createModerationCatalogCategoryMapping(req.body ?? {})
    res.status(201).json({
      ok: true,
      mapping,
    })
  } catch (error) {
    if (error instanceof ModerationCatalogError) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationCatalogRouter.patch('/catalog/category-mappings/:id', async (req, res, next) => {
  try {
    const mapping = await updateModerationCatalogCategoryMapping(
      req.params.id,
      req.body ?? {}
    )
    res.status(200).json({
      ok: true,
      mapping,
    })
  } catch (error) {
    if (error instanceof ModerationCatalogError) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationCatalogRouter.patch('/catalog/products/:id/category', async (req, res, next) => {
  try {
    const product = await updateModerationCatalogProductCategory(
      req.params.id,
      req.body ?? {}
    )
    res.status(200).json({
      ok: true,
      product,
    })
  } catch (error) {
    if (error instanceof ModerationCatalogError) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationCatalogRouter.get('/catalog/products/:id/card', async (req, res, next) => {
  try {
    const productCard = await getModerationCatalogProductCard(req.params.id)
    if (!productCard) {
      res.status(404).json({
        ok: false,
        error: 'Product not found',
      })
      return
    }

    res.status(200).json(productCard)
  } catch (error) {
    next(error)
  }
})

moderationCatalogRouter.get('/catalog/products/:id', async (req, res, next) => {
  try {
    const product = await getModerationCatalogProductDetail(req.params.id)
    if (!product) {
      res.status(404).json({
        ok: false,
        error: 'Product not found',
      })
      return
    }

    res.status(200).json(product)
  } catch (error) {
    next(error)
  }
})

moderationCatalogRouter.patch('/catalog/products/:id', async (req, res, next) => {
  try {
    const product = await updateModerationCatalogProduct(req.params.id, req.body ?? {})
    res.status(200).json({
      ok: true,
      product,
    })
  } catch (error) {
    if (error instanceof ModerationCatalogError) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationCatalogRouter.post('/catalog/products/:id/confirm', async (req, res, next) => {
  try {
    const product = await confirmModerationCatalogProduct(req.params.id)
    res.status(200).json({
      ok: true,
      product,
    })
  } catch (error) {
    if (error instanceof ModerationCatalogError) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationCatalogRouter.patch('/catalog/products/:id/status', async (req, res, next) => {
  try {
    const product = await updateModerationCatalogProductStatus(req.params.id, req.body ?? {})
    res.status(200).json({
      ok: true,
      product,
    })
  } catch (error) {
    if (error instanceof ModerationCatalogError) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationCatalogRouter.post('/catalog/products/:id/hide', async (req, res, next) => {
  try {
    const product = await hideModerationCatalogProduct(req.params.id)
    res.status(200).json({
      ok: true,
      product,
    })
  } catch (error) {
    if (error instanceof ModerationCatalogError) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationCatalogRouter.post('/catalog/products/:id/unhide', async (req, res, next) => {
  try {
    const product = await unhideModerationCatalogProduct(req.params.id)
    res.status(200).json({
      ok: true,
      product,
    })
  } catch (error) {
    if (error instanceof ModerationCatalogError) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationCatalogRouter.post('/catalog/products/:id/aliases', async (req, res, next) => {
  try {
    const alias = await addModerationCatalogProductAlias(req.params.id, req.body ?? {})
    res.status(201).json({
      ok: true,
      alias,
    })
  } catch (error) {
    if (error instanceof ModerationCatalogError) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationCatalogRouter.post('/catalog/products/:id/media/main', async (req, res, next) => {
  try {
    const productCard = await setModerationCatalogProductMainImage(req.params.id, req.body ?? {})
    res.status(200).json({
      ok: true,
      productCard,
    })
  } catch (error) {
    if (error instanceof ModerationCatalogError) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationCatalogRouter.post('/catalog/products/:id/media/main/upload', (req, res, next) => {
  moderationProductMainImageUpload.single('file')(req, res, async (uploadError) => {
    if (uploadError) {
      res.status(400).json({
        ok: false,
        error: uploadError instanceof Error ? uploadError.message : 'Image upload failed',
      })
      return
    }

    try {
      await applyImageCropToUpload(req.file, req.body ?? {})
      const productCard = await uploadModerationCatalogProductMainImage(
        req.params.id,
        req.file
      )
      res.status(201).json({
        ok: true,
        productCard,
      })
    } catch (error) {
      if (error instanceof ModerationCatalogError) {
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

moderationCatalogRouter.post('/catalog/products/:id/media', (req, res, next) => {
  moderationProductMediaUpload.single('file')(req, res, async (uploadError) => {
    if (uploadError) {
      res.status(400).json({
        ok: false,
        error: uploadError instanceof Error ? uploadError.message : 'Media upload failed',
      })
      return
    }

    try {
      await applyImageCropToUpload(req.file, req.body ?? {})
      const productCard = await uploadModerationCatalogProductMedia(
        req.params.id,
        req.file
      )
      res.status(201).json({
        ok: true,
        productCard,
      })
    } catch (error) {
      if (error instanceof ModerationCatalogError) {
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

moderationCatalogRouter.get('/catalog/media/:fileId/preview', async (req, res, next) => {
  try {
    const mediaFile = await getModerationCatalogMediaPreviewFile(req.params.fileId)
    res.setHeader('Content-Type', mediaFile.mimeType || 'application/octet-stream')
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(mediaFile.fileName)}"`)
    res.setHeader('Accept-Ranges', 'bytes')
    res.sendFile(mediaFile.absolutePath)
  } catch (error) {
    if (error instanceof ModerationCatalogError) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationCatalogRouter.delete('/catalog/products/:id/media/:fileId', async (req, res, next) => {
  try {
    const productCard = await deleteModerationCatalogProductMedia(
      req.params.id,
      req.params.fileId
    )
    res.status(200).json({
      ok: true,
      productCard,
    })
  } catch (error) {
    if (error instanceof ModerationCatalogError) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationCatalogRouter.post('/catalog/products/:id/media/candidates/:matchId/reject', async (req, res, next) => {
  try {
    const productCard = await rejectModerationCatalogProductImageCandidate(
      req.params.id,
      req.params.matchId
    )
    res.status(200).json({
      ok: true,
      productCard,
    })
  } catch (error) {
    if (error instanceof ModerationCatalogError) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationCatalogRouter.post('/catalog/products/:id/merge', async (req, res, next) => {
  try {
    const productCard = await mergeModerationCatalogProduct(req.params.id, req.body ?? {})
    res.status(200).json({
      ok: true,
      productCard,
    })
  } catch (error) {
    if (error instanceof ModerationCatalogError) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationCatalogRouter.post('/catalog/products/:id/split-merge', async (req, res, next) => {
  try {
    const productCard = await splitMergeModerationCatalogProduct(req.params.id)
    res.status(200).json({
      ok: true,
      productCard,
    })
  } catch (error) {
    if (error instanceof ModerationCatalogError) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationCatalogRouter.patch('/catalog/issues/:id', async (req, res, next) => {
  try {
    const issue = await updateModerationCatalogIssue(req.params.id, req.body ?? {})
    res.status(200).json({
      ok: true,
      issue,
    })
  } catch (error) {
    if (error instanceof ModerationCatalogError) {
      res.status(error.status).json({
        ok: false,
        error: error.message,
      })
      return
    }

    next(error)
  }
})

moderationCatalogRouter.delete(
  '/catalog/category-mappings/:id',
  async (req, res, next) => {
    try {
      const result = await deleteModerationCatalogCategoryMapping(req.params.id)
      res.status(200).json(result)
    } catch (error) {
      if (error instanceof ModerationCatalogError) {
        res.status(error.status).json({
          ok: false,
          error: error.message,
        })
        return
      }

      next(error)
    }
  }
)

export default moderationCatalogRouter
