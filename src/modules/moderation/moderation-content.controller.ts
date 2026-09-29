import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import { env } from '../../config/env'
import {
  createModerationContentStory,
  createModerationHomeBanner,
  deleteModerationContentStory,
  deleteModerationHomeBanner,
  getModerationContent,
  getModerationContentSuppliers,
  ModerationContentError,
  republishModerationContentStory,
  updateModerationContentStory,
  updateModerationHomeBanner,
} from './moderation-content.service'
import { applyImageCropToUpload } from './upload-crop'

const moderationContentRouter = Router()
const moderationContentUploadsDir = path.resolve(env.uploadsRoot, 'content')

if (!fs.existsSync(moderationContentUploadsDir)) {
  fs.mkdirSync(moderationContentUploadsDir, { recursive: true })
}

function createModerationContentUploadFileName(file: Express.Multer.File) {
  const extension = path.extname(file.originalname).toLowerCase()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}${extension}`
}

const moderationContentUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      callback(null, moderationContentUploadsDir)
    },
    filename: (_req, file, callback) => {
      callback(null, createModerationContentUploadFileName(file))
    },
  }),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    const mimeType = file.mimetype.toLowerCase()
    if (
      mimeType.startsWith('image/') ||
      mimeType.startsWith('video/') ||
      mimeType === 'application/json' ||
      mimeType.includes('lottie')
    ) {
      callback(null, true)
      return
    }

    callback(new Error('Only image, video, svg, png, and animated json uploads are supported'))
  },
})

function getBearerToken(authorizationHeader?: string) {
  if (!authorizationHeader) return null
  const [scheme, token] = authorizationHeader.split(' ')
  return scheme === 'Bearer' && token ? token : null
}

function requireModeratorAuth(req: any, res: any, next: any) {
  try {
    const token = getBearerToken(req.headers.authorization)

    if (!token) {
      res.status(401).json({ ok: false, error: 'Требуется токен авторизации' })
      return
    }

    const payload = jwt.verify(token, env.jwtSecret) as {
      moderatorId?: string
      role?: string
    }

    if (!payload?.moderatorId || payload.role !== 'PLATFORM_MODERATOR') {
      res.status(403).json({ ok: false, error: 'Требуется доступ модератора' })
      return
    }

    const moderator = env.moderators.find((item) => item.id === payload.moderatorId)

    if (!moderator) {
      res.status(403).json({ ok: false, error: 'Доступ модератора запрещён' })
      return
    }

    next()
  } catch {
    res.status(401).json({ ok: false, error: 'Недействительный или просроченный токен' })
  }
}

function sendContentError(error: unknown, res: any, next: any) {
  if (error instanceof ModerationContentError) {
    res.status(error.status).json({
      ok: false,
      error: error.message,
      details: error.details,
    })
    return
  }

  next(error)
}

function contentUpload(req: any, res: any, next: any) {
  moderationContentUpload.single('file')(req, res, (error) => {
    if (!error) {
      next()
      return
    }

    res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Не удалось загрузить файл',
    })
  })
}

moderationContentRouter.use(requireModeratorAuth)

moderationContentRouter.get('/content', async (_req, res, next) => {
  try {
    res.status(200).json(await getModerationContent())
  } catch (error) {
    next(error)
  }
})

moderationContentRouter.get('/content/suppliers', async (_req, res, next) => {
  try {
    res.status(200).json({
      ok: true,
      suppliers: await getModerationContentSuppliers(),
    })
  } catch (error) {
    next(error)
  }
})

moderationContentRouter.post('/content/stories', contentUpload, async (req, res, next) => {
  try {
    await applyImageCropToUpload(req.file, req.body ?? {})
    res.status(201).json(await createModerationContentStory(req.body ?? {}, req.file))
  } catch (error) {
    if (req.file?.path) fs.promises.rm(req.file.path, { force: true }).catch(() => undefined)
    sendContentError(error, res, next)
  }
})

moderationContentRouter.patch('/content/stories/:id', contentUpload, async (req, res, next) => {
  try {
    await applyImageCropToUpload(req.file, req.body ?? {})
    res.status(200).json(await updateModerationContentStory(req.params.id, req.body ?? {}, req.file))
  } catch (error) {
    if (req.file?.path) fs.promises.rm(req.file.path, { force: true }).catch(() => undefined)
    sendContentError(error, res, next)
  }
})

moderationContentRouter.post('/content/stories/:id/republish', async (req, res, next) => {
  try {
    res.status(200).json(await republishModerationContentStory(req.params.id))
  } catch (error) {
    sendContentError(error, res, next)
  }
})

moderationContentRouter.delete('/content/stories/:id', async (req, res, next) => {
  try {
    res.status(200).json(await deleteModerationContentStory(req.params.id))
  } catch (error) {
    sendContentError(error, res, next)
  }
})

moderationContentRouter.post('/content/banners', contentUpload, async (req, res, next) => {
  try {
    res.status(201).json(await createModerationHomeBanner(req.body ?? {}, req.file))
  } catch (error) {
    if (req.file?.path) fs.promises.rm(req.file.path, { force: true }).catch(() => undefined)
    sendContentError(error, res, next)
  }
})

moderationContentRouter.patch('/content/banners/:id', contentUpload, async (req, res, next) => {
  try {
    res.status(200).json(await updateModerationHomeBanner(req.params.id, req.body ?? {}, req.file))
  } catch (error) {
    if (req.file?.path) fs.promises.rm(req.file.path, { force: true }).catch(() => undefined)
    sendContentError(error, res, next)
  }
})

moderationContentRouter.delete('/content/banners/:id', async (req, res, next) => {
  try {
    res.status(200).json(await deleteModerationHomeBanner(req.params.id))
  } catch (error) {
    sendContentError(error, res, next)
  }
})

export default moderationContentRouter
