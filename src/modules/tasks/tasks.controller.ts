import { Router } from 'express'
import { requireAuth } from '../../middleware/auth'
import {
  createTask,
  getTaskSettings,
  listTasks,
  mapTaskError,
  updateTask,
  updateTaskSettings,
} from './tasks.service'

const tasksRouter = Router()

function handle(error: unknown, res: any) {
  const response = mapTaskError(error)
  res.status(response.status).json(response.body)
}

tasksRouter.get('/tasks/settings', requireAuth, async (req, res) => {
  try {
    const settings = await getTaskSettings(req.auth!)
    res.status(200).json({ ok: true, settings })
  } catch (error) {
    handle(error, res)
  }
})

tasksRouter.patch('/tasks/settings', requireAuth, async (req, res) => {
  try {
    const settings = await updateTaskSettings(req.auth!, req.body ?? {})
    res.status(200).json({ ok: true, settings })
  } catch (error) {
    handle(error, res)
  }
})

tasksRouter.get('/tasks', requireAuth, async (req, res) => {
  try {
    const result = await listTasks(req.auth!, req.query)
    res.status(200).json({ ok: true, ...result })
  } catch (error) {
    handle(error, res)
  }
})

tasksRouter.post('/tasks', requireAuth, async (req, res) => {
  try {
    const task = await createTask(req.auth!, req.body ?? {})
    res.status(201).json({ ok: true, task })
  } catch (error) {
    handle(error, res)
  }
})

tasksRouter.patch('/tasks/:id', requireAuth, async (req, res) => {
  try {
    const task = await updateTask(req.auth!, String(req.params.id), req.body ?? {})
    res.status(200).json({ ok: true, task })
  } catch (error) {
    handle(error, res)
  }
})

export default tasksRouter