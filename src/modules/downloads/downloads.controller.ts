import { Router } from 'express'
import multer from 'multer'

import { requireAuth } from '../../middleware/auth'
import {
  createDownload,
  createDownloadStorageName,
  DownloadError,
  getDownload,
  getDownloadsDir,
  listDownloads,
  mapDownloadError,
  MAX_DOWNLOAD_FILE_SIZE,
  updateDownload,
  validateDownloadFile,
} from './downloads.service'

const downloadsRouter = Router()

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      callback(null, getDownloadsDir())
    },
    filename: (_req, file, callback) => {
      callback(null, createDownloadStorageName(file.originalname))
    },
  }),
  limits: {
    fileSize: MAX_DOWNLOAD_FILE_SIZE,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    try {
      validateDownloadFile(file)
      callback(null, true)
    } catch (error) {
      callback(error as Error)
    }
  },
})

function handle(error: unknown, res: any) {
  if (error instanceof multer.MulterError) {
    error = new DownloadError(
      'DOWNLOAD_INVALID_FILE',
      error.code === 'LIMIT_FILE_SIZE'
        ? 'File size must not exceed 20 MB'
        : 'Invalid file upload',
    )
  }

  const response = mapDownloadError(error)
  res.status(response.status).json(response.body)
}

function uploadSingle(req: any, res: any, next: any) {
  upload.single('file')(req, res, (error: unknown) => {
    if (error) {
      handle(error, res)
      return
    }
    next()
  })
}

downloadsRouter.get('/downloads', requireAuth, async (req, res) => {
  try {
    const downloads = await listDownloads(req.auth!, req.query)
    res.status(200).json({ ok: true, downloads })
  } catch (error) {
    handle(error, res)
  }
})

downloadsRouter.get('/downloads/:id', requireAuth, async (req, res) => {
  try {
    const download = await getDownload(
      req.auth!,
      String(req.params.id),
    )
    res.status(200).json({ ok: true, download })
  } catch (error) {
    handle(error, res)
  }
})

downloadsRouter.post(
  '/downloads',
  requireAuth,
  uploadSingle,
  async (req, res) => {
    try {
      if (!req.file) {
        throw new DownloadError(
          'DOWNLOAD_INVALID_FILE',
          'file is required',
        )
      }

      const download = await createDownload(
        req.auth!,
        req.body ?? {},
        req.file,
      )
      res.status(201).json({ ok: true, download })
    } catch (error) {
      if (req.file?.path) {
        await import('fs').then((fs) =>
          fs.promises.unlink(req.file!.path).catch(() => undefined),
        )
      }
      handle(error, res)
    }
  },
)

downloadsRouter.patch('/downloads/:id', requireAuth, async (req, res) => {
  try {
    const download = await updateDownload(
      req.auth!,
      String(req.params.id),
      req.body ?? {},
    )
    res.status(200).json({ ok: true, download })
  } catch (error) {
    handle(error, res)
  }
})

export default downloadsRouter