import { Router } from 'express'
import { requireAuth } from '../../middleware/auth'
import {
  createNote,
  deleteNote,
  getLatestNote,
  getNote,
  listNotes,
  mapNoteError,
  markNoteRead,
  updateNote,
} from './notes.service'

const notesRouter = Router()

function handle(error: unknown, res: any) {
  const response = mapNoteError(error)
  res.status(response.status).json(response.body)
}

notesRouter.get('/notes/latest', requireAuth, async (req, res) => {
  try {
    const note = await getLatestNote(req.auth!)
    res.status(200).json({ ok: true, note })
  } catch (error) {
    handle(error, res)
  }
})

notesRouter.get('/notes', requireAuth, async (req, res) => {
  try {
    const notes = await listNotes(req.auth!, req.query)
    res.status(200).json({ ok: true, notes })
  } catch (error) {
    handle(error, res)
  }
})

notesRouter.get('/notes/:id', requireAuth, async (req, res) => {
  try {
    const note = await getNote(req.auth!, String(req.params.id))
    res.status(200).json({ ok: true, note })
  } catch (error) {
    handle(error, res)
  }
})

notesRouter.post('/notes', requireAuth, async (req, res) => {
  try {
    const note = await createNote(req.auth!, req.body ?? {})
    res.status(201).json({ ok: true, note })
  } catch (error) {
    handle(error, res)
  }
})

notesRouter.patch('/notes/:id/read', requireAuth, async (req, res) => {
  try {
    const note = await markNoteRead(req.auth!, String(req.params.id))
    res.status(200).json({ ok: true, note })
  } catch (error) {
    handle(error, res)
  }
})

notesRouter.patch('/notes/:id', requireAuth, async (req, res) => {
  try {
    const note = await updateNote(
      req.auth!,
      String(req.params.id),
      req.body ?? {},
    )
    res.status(200).json({ ok: true, note })
  } catch (error) {
    handle(error, res)
  }
})

notesRouter.delete('/notes/:id', requireAuth, async (req, res) => {
  try {
    const result = await deleteNote(req.auth!, String(req.params.id))
    res.status(200).json({ ok: true, ...result })
  } catch (error) {
    handle(error, res)
  }
})

export default notesRouter