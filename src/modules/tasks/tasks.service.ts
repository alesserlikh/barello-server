import {
  MembershipStatus,
  TaskStatus,
  TaskVisibility,
  type Prisma,
} from '../../generated/prisma'
import { apiError } from '../../lib/api-error'
import { prisma } from '../../lib/prisma'
import type { AuthPayload } from '../../middleware/auth'
import { getProfilePermissionsForAuth } from '../profile/profile-permissions.service'

export type TaskPeriod = 'week' | 'month'
export type TaskErrorCode =
  | 'TASK_NOT_FOUND'
  | 'TASK_FORBIDDEN'
  | 'TASK_ASSIGNEE_FORBIDDEN'
  | 'TASK_INVALID_DUE_DATE'

export class TaskError extends Error {
  code: TaskErrorCode
  status: number

  constructor(code: TaskErrorCode, message: string, status = 400) {
    super(message)
    this.name = 'TaskError'
    this.code = code
    this.status = status
  }
}

const taskInclude = {
  venue: { select: { id: true, name: true } },
  assignee: {
    select: {
      id: true,
      profile: { select: { firstName: true, lastName: true, middleName: true } },
    },
  },
} satisfies Prisma.UserTaskInclude

type TaskView = Prisma.UserTaskGetPayload<{ include: typeof taskInclude }>

function fullName(profile: TaskView['assignee']['profile']) {
  if (!profile) return null
  return [profile.lastName, profile.firstName, profile.middleName]
    .filter(Boolean)
    .join(' ')
}

function mapStatus(status: TaskStatus): 'OPEN' | 'DONE' | 'CANCELLED' {
  if (status === TaskStatus.DONE) return 'DONE'
  if (status === TaskStatus.CANCELED) return 'CANCELLED'
  return 'OPEN'
}

function parseStatus(value: unknown): TaskStatus | undefined {
  if (value === undefined) return undefined
  if (value === 'OPEN') return TaskStatus.TODO
  if (value === 'DONE') return TaskStatus.DONE
  if (value === 'CANCELLED') return TaskStatus.CANCELED
  throw new TaskError('TASK_FORBIDDEN', 'Unsupported task status')
}

function mapTask(task: TaskView) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    venueId: task.venueId,
    venueName: task.venue?.name ?? null,
    dueAt: task.dueDate!.toISOString(),
    status: mapStatus(task.status),
    visibility: task.visibility,
    assigneeId: task.assigneeUserId,
    assigneeName: fullName(task.assignee.profile),
    createdById: task.creatorUserId,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  }
}

function parseDate(value: unknown, fallback = new Date()) {
  if (value === undefined || value === null || value === '') {
    return new Date(Date.UTC(
      fallback.getUTCFullYear(),
      fallback.getUTCMonth(),
      fallback.getUTCDate(),
    ))
  }

  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TaskError('TASK_INVALID_DUE_DATE', 'Date must use YYYY-MM-DD format')
  }

  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new TaskError('TASK_INVALID_DUE_DATE', 'Date is invalid')
  }
  return date
}

function parseDueAt(value: unknown) {
  if (typeof value !== 'string') {
    throw new TaskError('TASK_INVALID_DUE_DATE', 'dueAt is required')
  }
  const dueAt = new Date(value)
  if (Number.isNaN(dueAt.getTime())) {
    throw new TaskError('TASK_INVALID_DUE_DATE', 'dueAt is invalid')
  }
  return dueAt
}

function getRange(period: TaskPeriod, anchor: Date) {
  if (period === 'week') {
    const day = anchor.getUTCDay()
    const offset = day === 0 ? -6 : 1 - day
    const start = new Date(anchor)
    start.setUTCDate(start.getUTCDate() + offset)
    const end = new Date(start)
    end.setUTCDate(end.getUTCDate() + 7)
    return { start, end }
  }

  const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1))
  const end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1))
  return { start, end }
}

async function getTaskAccess(auth: AuthPayload) {
  if (auth.type !== 'user') {
    throw new TaskError('TASK_FORBIDDEN', 'Tasks section is forbidden', 403)
  }
  const access = await getProfilePermissionsForAuth(auth).catch(() => {
    throw new TaskError('TASK_FORBIDDEN', 'Tasks section is forbidden', 403)
  })
  if (!access.permissions.profileSections.tasks) {
    throw new TaskError('TASK_FORBIDDEN', 'Tasks section is forbidden', 403)
  }
  const memberships = await prisma.userVenueMembership.findMany({
    where: { userId: auth.userId, membershipStatus: MembershipStatus.ACTIVE },
    select: { venueId: true },
  })
  return {
    userId: auth.userId,
    venueIds: memberships.map((membership) => membership.venueId),
    accessLevel: access.accessLevel,
    permissions: access.permissions,
  }
}

async function ensureVenueAccess(userId: string, venueId: string) {
  const membership = await prisma.userVenueMembership.findFirst({
    where: { userId, venueId, membershipStatus: MembershipStatus.ACTIVE },
    select: { id: true },
  })
  if (!membership) throw new TaskError('TASK_FORBIDDEN', 'Venue is forbidden', 403)
}

async function ensureAssigneeAllowed(params: {
  creatorUserId: string
  assigneeUserId: string
  venueId: string | null
  canAssignTask: boolean
}) {
  if (params.assigneeUserId === params.creatorUserId) return
  if (!params.canAssignTask) {
    throw new TaskError(
      'TASK_ASSIGNEE_FORBIDDEN',
      'Assigning another user is forbidden',
      403,
    )
  }
  if (params.venueId) {
    await ensureVenueAccess(params.assigneeUserId, params.venueId)
    return
  }
  const assignee = await prisma.user.findUnique({
    where: { id: params.assigneeUserId },
    select: { id: true },
  })
  if (!assignee) {
    throw new TaskError('TASK_ASSIGNEE_FORBIDDEN', 'Assignee is unavailable', 403)
  }
}

async function ensureOnboardingTasks(userId: string) {
  const today = new Date()
  today.setUTCHours(18, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  await prisma.userTask.createMany({
    data: [
      {
        title: 'Заполнить профиль',
        description: 'Добавьте основные данные профиля',
        creatorUserId: userId,
        assigneeUserId: userId,
        dueDate: today,
        visibility: TaskVisibility.PRIVATE,
        onboardingKey: 'complete-profile',
      },
      {
        title: 'Добавить email',
        description: 'Добавьте и подтвердите email',
        creatorUserId: userId,
        assigneeUserId: userId,
        dueDate: tomorrow,
        visibility: TaskVisibility.PRIVATE,
        onboardingKey: 'verify-email',
      },
    ],
    skipDuplicates: true,
  })
}

function accessibleWhere(access: Awaited<ReturnType<typeof getTaskAccess>>) {
  return {
    OR: [
      { assigneeUserId: access.userId },
      { creatorUserId: access.userId },
      ...(access.venueIds.length
        ? [{ visibility: TaskVisibility.VENUE, venueId: { in: access.venueIds } }]
        : []),
    ],
  } satisfies Prisma.UserTaskWhereInput
}

function buildDays(start: Date, end: Date, tasks: TaskView[]) {
  const byDate = new Map<string, { open: boolean; done: boolean }>()
  for (const task of tasks) {
    const date = task.dueDate!.toISOString().slice(0, 10)
    const current = byDate.get(date) ?? { open: false, done: false }
    if (task.status === TaskStatus.DONE) current.done = true
    else if (task.status !== TaskStatus.CANCELED) current.open = true
    byDate.set(date, current)
  }
  const days = []
  for (const cursor = new Date(start); cursor < end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10)
    const state = byDate.get(date)
    days.push({
      date,
      hasOpenTasks: state?.open ?? false,
      hasDoneTasks: state?.done ?? false,
    })
  }
  return days
}

export async function listTasks(
  auth: AuthPayload,
  params: { period?: unknown; date?: unknown; venueId?: unknown },
) {
  const access = await getTaskAccess(auth)
  await ensureOnboardingTasks(access.userId)
  const period: TaskPeriod = params.period === undefined ? 'week' : params.period as TaskPeriod
  if (period !== 'week' && period !== 'month') {
    throw new TaskError('TASK_INVALID_DUE_DATE', 'period must be week or month')
  }
  const anchor = parseDate(params.date)
  const { start, end } = getRange(period, anchor)
  const venueId = typeof params.venueId === 'string' && params.venueId ? params.venueId : null
  if (venueId) await ensureVenueAccess(access.userId, venueId)

  const tasks = await prisma.userTask.findMany({
    where: {
      AND: [
        accessibleWhere(access),
        { dueDate: { gte: start, lt: end } },
        ...(venueId ? [{ venueId }] : []),
      ],
    },
    include: taskInclude,
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
  })
  const mapped = tasks.map(mapTask)
  return {
    period,
    date: anchor.toISOString().slice(0, 10),
    range: { from: start.toISOString(), to: end.toISOString() },
    tasks: mapped,
    days: buildDays(start, end, tasks),
    summary: {
      openCount: mapped.filter((task) => task.status === 'OPEN').length,
      doneCount: mapped.filter((task) => task.status === 'DONE').length,
      cancelledCount: mapped.filter((task) => task.status === 'CANCELLED').length,
    },
  }
}

export async function createTask(auth: AuthPayload, body: Record<string, unknown>) {
  const access = await getTaskAccess(auth)
  if (!access.permissions.actions.canCreateTask) {
    throw new TaskError('TASK_FORBIDDEN', 'Creating tasks is forbidden', 403)
  }
  if (typeof body.title !== 'string' || !body.title.trim()) {
    throw new TaskError('TASK_FORBIDDEN', 'Task title is required')
  }
  const venueId = typeof body.venueId === 'string' && body.venueId ? body.venueId : null
  if (venueId) await ensureVenueAccess(access.userId, venueId)
  const visibility = body.visibility === 'VENUE' ? TaskVisibility.VENUE : TaskVisibility.PRIVATE
  if (visibility === TaskVisibility.VENUE && !access.permissions.actions.canCreateSharedTask) {
    throw new TaskError('TASK_FORBIDDEN', 'Shared task creation is forbidden', 403)
  }
  const assigneeUserId =
    typeof body.assigneeId === 'string' && body.assigneeId
      ? body.assigneeId
      : access.userId
  await ensureAssigneeAllowed({
    creatorUserId: access.userId,
    assigneeUserId,
    venueId,
    canAssignTask: access.permissions.actions.canAssignTask,
  })
  const task = await prisma.userTask.create({
    data: {
      title: body.title.trim(),
      description: typeof body.description === 'string' ? body.description.trim() || null : null,
      creatorUserId: access.userId,
      assigneeUserId,
      venueId,
      dueDate: parseDueAt(body.dueAt),
      visibility,
    },
    include: taskInclude,
  })
  return mapTask(task)
}

export async function updateTask(
  auth: AuthPayload,
  taskId: string,
  body: Record<string, unknown>,
) {
  const access = await getTaskAccess(auth)
  const existing = await prisma.userTask.findFirst({
    where: { id: taskId, ...accessibleWhere(access) },
  })
  if (!existing) throw new TaskError('TASK_NOT_FOUND', 'Task was not found', 404)
  if (existing.creatorUserId !== access.userId && existing.assigneeUserId !== access.userId) {
    throw new TaskError('TASK_FORBIDDEN', 'Updating task is forbidden', 403)
  }
  const assigneeUserId =
    typeof body.assigneeId === 'string' && body.assigneeId
      ? body.assigneeId
      : existing.assigneeUserId
  const venueId =
    body.venueId === null
      ? null
      : typeof body.venueId === 'string' && body.venueId
        ? body.venueId
        : existing.venueId
  if (venueId && venueId !== existing.venueId) {
    await ensureVenueAccess(access.userId, venueId)
  }
  const visibility =
    body.visibility === 'PRIVATE'
      ? TaskVisibility.PRIVATE
      : body.visibility === 'VENUE'
        ? TaskVisibility.VENUE
        : existing.visibility
  if (visibility === TaskVisibility.VENUE && !access.permissions.actions.canCreateSharedTask) {
    throw new TaskError('TASK_FORBIDDEN', 'Shared task update is forbidden', 403)
  }
  await ensureAssigneeAllowed({
    creatorUserId: access.userId,
    assigneeUserId,
    venueId,
    canAssignTask: access.permissions.actions.canAssignTask,
  })
  const task = await prisma.userTask.update({
    where: { id: taskId },
    data: {
      ...(typeof body.title === 'string' && body.title.trim()
        ? { title: body.title.trim() }
        : {}),
      ...(body.description === null || typeof body.description === 'string'
        ? { description: typeof body.description === 'string' ? body.description.trim() || null : null }
        : {}),
      ...(body.dueAt !== undefined ? { dueDate: parseDueAt(body.dueAt) } : {}),
      ...(body.status !== undefined ? { status: parseStatus(body.status) } : {}),
      assigneeUserId,
      venueId,
      visibility,
    },
    include: taskInclude,
  })
  return mapTask(task)
}

export async function getTaskSettings(auth: AuthPayload) {
  const access = await getTaskAccess(auth)
  return prisma.userTaskSettings.upsert({
    where: { userId: access.userId },
    create: { userId: access.userId },
    update: {},
    select: {
      weekStartsOn: true,
      showCompleted: true,
      notificationsEnabled: true,
    },
  })
}

export async function updateTaskSettings(
  auth: AuthPayload,
  body: Record<string, unknown>,
) {
  const access = await getTaskAccess(auth)
  const weekStartsOn = body.weekStartsOn
  if (
    weekStartsOn !== undefined &&
    (!Number.isInteger(weekStartsOn) || Number(weekStartsOn) < 0 || Number(weekStartsOn) > 6)
  ) {
    throw new TaskError('TASK_FORBIDDEN', 'weekStartsOn must be between 0 and 6')
  }
  return prisma.userTaskSettings.upsert({
    where: { userId: access.userId },
    create: {
      userId: access.userId,
      ...(weekStartsOn !== undefined ? { weekStartsOn: Number(weekStartsOn) } : {}),
      ...(typeof body.showCompleted === 'boolean' ? { showCompleted: body.showCompleted } : {}),
      ...(typeof body.notificationsEnabled === 'boolean'
        ? { notificationsEnabled: body.notificationsEnabled }
        : {}),
    },
    update: {
      ...(weekStartsOn !== undefined ? { weekStartsOn: Number(weekStartsOn) } : {}),
      ...(typeof body.showCompleted === 'boolean' ? { showCompleted: body.showCompleted } : {}),
      ...(typeof body.notificationsEnabled === 'boolean'
        ? { notificationsEnabled: body.notificationsEnabled }
        : {}),
    },
    select: {
      weekStartsOn: true,
      showCompleted: true,
      notificationsEnabled: true,
    },
  })
}

export async function getTasksWeekSummary(auth: AuthPayload) {
  const result = await listTasks(auth, { period: 'week' })
  return { summary: result.summary, days: result.days }
}

export function mapTaskError(error: unknown) {
  if (error instanceof TaskError) {
    return { status: error.status, body: apiError(error.code, error.message) }
  }

  return {
    status: 500,
    body: apiError('TASK_REQUEST_FAILED', 'Task request failed'),
  }
}