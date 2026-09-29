import { Router } from 'express'
import type { RequestHandler } from 'express'
import multer from 'multer'
import { requireAuth } from '../../middleware/auth'
import { apiError } from '../../lib/api-error'
import { getMyProfile, updateMyProfile } from './profile.service'
import {
  getProfileMobileContext,
  mapProfileMobileContextError,
} from './profile-mobile-context.service'
import {
  assertProfileActionAllowed,
  mapProfilePermissionError,
  type ProfileActionKey,
} from './profile-permissions.service'
import { getMySupplierProfile, updateMySupplierProfile } from './supplier-profile.service'
import { getMyVenueProfile, updateMyVenueProfile } from './venue-profile.service'
import {
  buildProfileMediaStorageKey,
  createProfileMediaFileName,
  createUploadedImageAsset,
  getProfileMediaDir,
  isSupportedImageMimeType,
} from './profile-media.service'

const profileRouter = Router()
const profileMediaUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      callback(null, getProfileMediaDir())
    },
    filename: (_req, file, callback) => {
      callback(null, createProfileMediaFileName(file.originalname, file.mimetype))
    },
  }),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 3,
  },
  fileFilter: (_req, file, callback) => {
    if (!isSupportedImageMimeType(file.mimetype)) {
      callback(new Error('Only image uploads are supported'))
      return
    }

    callback(null, true)
  },
})

function requireProfileAction(action: ProfileActionKey) {
  const middleware: RequestHandler = async (req, res, next) => {
    try {
      await assertProfileActionAllowed(req.auth!, action)
      next()
    } catch (error) {
      console.error(`Profile action denied: ${action}`, error)
      const response = mapProfilePermissionError(error)
      res.status(response.status).json(response.body)
    }
  }

  return middleware
}

async function uploadProfileMediaFiles(
  userId: string,
  files: Express.Multer.File[],
) {
  return Promise.all(
    files.map((file) =>
      createUploadedImageAsset({
        fileName: file.originalname,
        storageKey: buildProfileMediaStorageKey(file.filename),
        mimeType: file.mimetype,
        fileSize: file.size,
        uploadedByUserId: userId,
      }),
    ),
  )
}

profileRouter.get('/mobile-context', requireAuth, async (req, res) => {
  try {
    const context = await getProfileMobileContext(req.auth!)

    res.status(200).json(context)
  } catch (error) {
    console.error('GET /profile/mobile-context failed:', error)
    const response = mapProfileMobileContextError(error)
    res.status(response.status).json(response.body)
  }
})

profileRouter.get('/me', requireAuth, async (req, res) => {
  try {
    const profile = await getMyProfile(req.auth!.userId)

    res.status(200).json({
      ok: true,
      user: profile,
    })
  } catch (error) {
    console.error('GET /profile/me failed:', error)
    res.status(404).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to load profile',
    })
  }
})

profileRouter.patch('/me', requireAuth, async (req, res) => {
  try {
    const user = await updateMyProfile(req.auth!.userId, req.body)

    res.status(200).json({
      ok: true,
      user,
    })
  } catch (error) {
    console.error('PATCH /profile/me failed:', error)
    res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to update profile',
    })
  }
})

profileRouter.post(
  '/media/avatar',
  requireAuth,
  profileMediaUpload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({
          ok: false,
          error: 'Avatar file is required',
        })
        return
      }

      const [file] = await uploadProfileMediaFiles(req.auth!.userId, [req.file])

      res.status(201).json({
        ok: true,
        file,
      })
    } catch (error) {
      console.error('POST /profile/media/avatar failed:', error)
      res.status(400).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to upload avatar',
      })
    }
  }
)

profileRouter.post(
  '/media/venue-photos',
  requireAuth,
  requireProfileAction('canUploadVenuePhotos'),
  profileMediaUpload.array('files', 3),
  async (req, res) => {
    try {
      const files = Array.isArray(req.files) ? req.files : []

      if (files.length === 0) {
        res.status(400).json({
          ok: false,
          error: 'At least one venue photo is required',
        })
        return
      }

      const uploadedFiles = await uploadProfileMediaFiles(req.auth!.userId, files)

      res.status(201).json({
        ok: true,
        files: uploadedFiles,
      })
    } catch (error) {
      console.error('POST /profile/media/venue-photos failed:', error)
      res.status(400).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to upload venue photos',
      })
    }
  }
)

profileRouter.post(
  '/media/supplier-photos',
  requireAuth,
  profileMediaUpload.array('files', 3),
  async (req, res) => {
    try {
      const files = Array.isArray(req.files) ? req.files : []

      if (files.length === 0) {
        res.status(400).json({
          ok: false,
          error: 'At least one supplier photo is required',
        })
        return
      }

      const uploadedFiles = await uploadProfileMediaFiles(req.auth!.userId, files)

      res.status(201).json({
        ok: true,
        files: uploadedFiles,
      })
    } catch (error) {
      console.error('POST /profile/media/supplier-photos failed:', error)
      res.status(400).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to upload supplier photos',
      })
    }
  }
)

profileRouter.get('/supplier/me', requireAuth, async (req, res) => {
  try {
    const supplier = await getMySupplierProfile(req.auth!.userId)

    res.status(200).json({
      ok: true,
      supplier,
    })
  } catch (error) {
    console.error('GET /profile/supplier/me failed:', error)
    res.status(404).json(apiError('SUPPLIER_NOT_FOUND', error instanceof Error ? error.message : 'Failed to load supplier profile'))
  }
})

profileRouter.get('/venue/me', requireAuth, async (req, res) => {
  try {
    const venue = await getMyVenueProfile(req.auth!.userId)

    res.status(200).json({
      ok: true,
      venue,
    })
  } catch (error) {
    console.error('GET /profile/venue/me failed:', error)
    res.status(404).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to load venue profile',
    })
  }
})

profileRouter.patch('/supplier/me', requireAuth, async (req, res) => {
  try {
    const supplier = await updateMySupplierProfile(req.auth!.userId, req.body)

    res.status(200).json({
      ok: true,
      supplier,
    })
  } catch (error) {
    console.error('PATCH /profile/supplier/me failed:', error)
    res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to update supplier profile',
    })
  }
})

profileRouter.patch('/venue/me', requireAuth, async (req, res) => {
  try {
    const venue = await updateMyVenueProfile(req.auth!.userId, req.body)

    res.status(200).json({
      ok: true,
      venue,
    })
  } catch (error) {
    console.error('PATCH /profile/venue/me failed:', error)
    res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to update venue profile',
    })
  }
})

export default profileRouter
