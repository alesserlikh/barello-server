import { Router } from 'express'
import { requireAuth } from '../../middleware/auth'
import {
  createPublishedContentStoryReaction,
  createPublishedContentStoryReply,
  getPublishedContentStories,
  ModerationContentError,
  recordPublishedContentStoryView,
} from '../moderation/moderation-content.service'

const contentRouter = Router()

function sendContentError(error: unknown, res: any, next: any) {
  if (error instanceof ModerationContentError) {
    res.status(error.status).json({
      error: {
        code: 'CONTENT_STORY_ERROR',
        message: error.message,
        details: error.details,
      },
    })
    return
  }

  next(error)
}

function getRouteParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

contentRouter.get('/stories', requireAuth, async (_req, res, next) => {
  try {
    res.status(200).json(await getPublishedContentStories())
  } catch (error) {
    next(error)
  }
})

contentRouter.post('/stories/:id/view', requireAuth, async (req, res, next) => {
  try {
    res.status(200).json(await recordPublishedContentStoryView(getRouteParam(req.params.id), req.auth!.userId))
  } catch (error) {
    sendContentError(error, res, next)
  }
})

contentRouter.post('/stories/:id/reaction', requireAuth, async (req, res, next) => {
  try {
    res.status(200).json(
      await createPublishedContentStoryReaction(
        getRouteParam(req.params.id),
        req.auth!.userId,
        req.body ?? {}
      )
    )
  } catch (error) {
    sendContentError(error, res, next)
  }
})

contentRouter.post('/stories/:id/reply', requireAuth, async (req, res, next) => {
  try {
    res.status(200).json(
      await createPublishedContentStoryReply(
        getRouteParam(req.params.id),
        req.auth!.userId,
        req.body ?? {}
      )
    )
  } catch (error) {
    sendContentError(error, res, next)
  }
})

export default contentRouter
