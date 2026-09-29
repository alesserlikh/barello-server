import {
  MembershipStatus,
  NoteScope,
  type Prisma,
} from '../../generated/prisma'
import { apiError } from '../../lib/api-error'
import { prisma } from '../../lib/prisma'
import type { AuthPayload } from '../../middleware/auth'
import { getProfilePermissionsForAuth } from '../profile/profile-permissions.service'

export type NoteErrorCode =
  | 'NOTE_NOT_FOUND'
  | 'NOTE_FORBIDDEN'
  | 'NOTE_INVALID_SCOPE'

export class NoteError extends Error {
  code: NoteErrorCode
  status: number

  constructor(code: NoteErrorCode, message: string, status = 400) {
    super(message)
    this.name = 'NoteError'
    this.code = code
    this.status = status
  }
}

type NoteView = {
  id: string
  title: string
  content: string
  scope: NoteScope
  venueId: string | null
  authorUserId: string
  createdAt: Date
  updatedAt: Date
  accesses: Array<{ readAt: Date | null }>
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function noteSelect(userId: string) {
  return {
    id: true,
    title: true,
    content: true,
    scope: true,
    venueId: true,
    authorUserId: true,
    createdAt: true,
    updatedAt: true,
    accesses: {
      where: { userId },
      select: { readAt: true },
      take: 1,
    },
  } satisfies Prisma.UserNoteSelect
}

function mapNote(note: NoteView, userId: string) {
  return {
    id: note.id,
    title: note.title,
    body: note.content || null,
    scope: note.scope,
    venueId: note.venueId,
    createdById: note.authorUserId,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    unread:
      note.authorUserId === userId
        ? false
        : note.accesses[0]?.readAt == null,
  }
}

function notFound(): never {
  throw new NoteError('NOTE_NOT_FOUND', 'Note was not found', 404)
}

function forbidden(message = 'Note access is forbidden'): never {
  throw new NoteError('NOTE_FORBIDDEN', message, 403)
}

function assertNoteId(noteId: string) {
  if (!UUID_PATTERN.test(noteId)) notFound()
}

function parseScope(value: unknown, fallback?: NoteScope): NoteScope {
  if (value === undefined && fallback) return fallback
  if (value === undefined) return NoteScope.PRIVATE

  if (
    value === NoteScope.PRIVATE ||
    value === NoteScope.VENUE ||
    value === NoteScope.BARELLO_TEAM
  ) {
    return value
  }

  throw new NoteError(
    'NOTE_INVALID_SCOPE',
    'scope must be PRIVATE, VENUE or BARELLO_TEAM',
  )
}

async function getNoteAccess(auth: AuthPayload) {
  if (auth.type !== 'user') forbidden('Notes section is forbidden')

  const profileAccess = await getProfilePermissionsForAuth(auth).catch(() => {
    forbidden('Notes section is forbidden')
  })

  if (!profileAccess.permissions.profileSections.notes) {
    forbidden('Notes section is forbidden')
  }

  const [user, memberships] = await Promise.all([
    prisma.user.findUnique({
      where: { id: auth.userId },
      select: { activeVenueId: true },
    }),
    prisma.userVenueMembership.findMany({
      where: {
        userId: auth.userId,
        membershipStatus: MembershipStatus.ACTIVE,
      },
      select: { venueId: true },
    }),
  ])

  if (!user) forbidden('Notes section is forbidden')

  return {
    userId: auth.userId,
    activeVenueId: user.activeVenueId,
    venueIds: memberships.map((membership) => membership.venueId),
    permissions: profileAccess.permissions,
  }
}

type NoteAccess = Awaited<ReturnType<typeof getNoteAccess>>

function accessibleWhere(access: NoteAccess): Prisma.UserNoteWhereInput {
  return {
    OR: [
      { authorUserId: access.userId },
      ...(access.venueIds.length
        ? [{
            scope: NoteScope.VENUE,
            venueId: { in: access.venueIds },
          }]
        : []),
      {
        scope: NoteScope.BARELLO_TEAM,
        accesses: { some: { userId: access.userId } },
      },
    ],
  }
}

async function ensureVenueAccess(access: NoteAccess, venueId: string) {
  if (!access.venueIds.includes(venueId)) {
    forbidden('Venue note access is forbidden')
  }
}

async function resolveVenueId(
  access: NoteAccess,
  scope: NoteScope,
  value: unknown,
) {
  if (scope !== NoteScope.VENUE) return null

  const venueId =
    typeof value === 'string' && value
      ? value
      : access.activeVenueId

  if (!venueId) {
    throw new NoteError(
      'NOTE_INVALID_SCOPE',
      'venueId is required for VENUE scope',
    )
  }

  await ensureVenueAccess(access, venueId)
  return venueId
}

function assertCanUseScope(access: NoteAccess, scope: NoteScope) {
  if (
    scope !== NoteScope.PRIVATE &&
    !access.permissions.actions.canCreateSharedNote
  ) {
    forbidden('Shared note creation is forbidden')
  }
}

function readRequiredText(
  body: Record<string, unknown>,
  field: 'title' | 'body',
) {
  const value = body[field]
  if (typeof value !== 'string' || !value.trim()) {
    forbidden(field + ' is required')
  }
  return value.trim()
}

async function findExisting(noteId: string) {
  assertNoteId(noteId)
  const note = await prisma.userNote.findUnique({
    where: { id: noteId },
    select: {
      id: true,
      authorUserId: true,
      scope: true,
      venueId: true,
    },
  })
  if (!note) notFound()
  return note
}

async function getAccessibleNote(
  access: NoteAccess,
  noteId: string,
): Promise<NoteView> {
  const existing = await findExisting(noteId)
  const note = await prisma.userNote.findFirst({
    where: { id: existing.id, ...accessibleWhere(access) },
    select: noteSelect(access.userId),
  })
  if (!note) forbidden()
  return note
}

export async function getLatestNote(auth: AuthPayload) {
  const access = await getNoteAccess(auth)
  const note = await prisma.userNote.findFirst({
    where: {
      AND: [
        accessibleWhere(access),
        { scope: { in: [NoteScope.PRIVATE, NoteScope.VENUE] } },
      ],
    },
    select: noteSelect(access.userId),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })

  return note ? mapNote(note, access.userId) : null
}

export async function listNotes(
  auth: AuthPayload,
  params: { scope?: unknown; venueId?: unknown },
) {
  const access = await getNoteAccess(auth)
  const scope =
    params.scope === undefined ? undefined : parseScope(params.scope)
  const venueId =
    typeof params.venueId === 'string' && params.venueId
      ? params.venueId
      : undefined

  if (venueId) await ensureVenueAccess(access, venueId)

  const notes = await prisma.userNote.findMany({
    where: {
      AND: [
        accessibleWhere(access),
        ...(scope ? [{ scope }] : []),
        ...(venueId ? [{ venueId }] : []),
      ],
    },
    select: noteSelect(access.userId),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })

  return notes.map((note) => mapNote(note, access.userId))
}

export async function getNote(auth: AuthPayload, noteId: string) {
  const access = await getNoteAccess(auth)
  const note = await getAccessibleNote(access, noteId)
  return mapNote(note, access.userId)
}

export async function createNote(
  auth: AuthPayload,
  body: Record<string, unknown>,
) {
  const access = await getNoteAccess(auth)
  if (!access.permissions.actions.canCreateNote) {
    forbidden('Note creation is forbidden')
  }

  const scope = parseScope(body.scope)
  assertCanUseScope(access, scope)
  const venueId = await resolveVenueId(access, scope, body.venueId)

  const note = await prisma.userNote.create({
    data: {
      title: readRequiredText(body, 'title'),
      content: readRequiredText(body, 'body'),
      scope,
      venueId,
      authorUserId: access.userId,
    },
    select: noteSelect(access.userId),
  })

  return mapNote(note, access.userId)
}

export async function updateNote(
  auth: AuthPayload,
  noteId: string,
  body: Record<string, unknown>,
) {
  const access = await getNoteAccess(auth)
  const existing = await findExisting(noteId)
  if (existing.authorUserId !== access.userId) forbidden('Updating note is forbidden')

  const scope = parseScope(body.scope, existing.scope)
  assertCanUseScope(access, scope)
  const venueId = await resolveVenueId(
    access,
    scope,
    body.venueId === undefined ? existing.venueId : body.venueId,
  )

  const title =
    body.title === undefined
      ? undefined
      : readRequiredText(body, 'title')
  const content =
    body.body === undefined
      ? undefined
      : readRequiredText(body, 'body')
  const accessChanged =
    scope !== existing.scope || venueId !== existing.venueId

  const note = await prisma.$transaction(async (tx) => {
    if (accessChanged) {
      await tx.userNoteAccess.deleteMany({ where: { noteId } })
    }

    return tx.userNote.update({
      where: { id: noteId },
      data: {
        scope,
        venueId,
        ...(title === undefined ? {} : { title }),
        ...(content === undefined ? {} : { content }),
      },
      select: noteSelect(access.userId),
    })
  })

  return mapNote(note, access.userId)
}

export async function markNoteRead(auth: AuthPayload, noteId: string) {
  const access = await getNoteAccess(auth)
  const note = await getAccessibleNote(access, noteId)

  if (note.authorUserId !== access.userId) {
    const now = new Date()
    await prisma.userNoteAccess.upsert({
      where: {
        noteId_userId: { noteId, userId: access.userId },
      },
      create: {
        noteId,
        userId: access.userId,
        readAt: now,
      },
      update: { readAt: now },
    })
  }

  return getNote(auth, noteId)
}

export async function deleteNote(auth: AuthPayload, noteId: string) {
  const access = await getNoteAccess(auth)
  const existing = await findExisting(noteId)
  if (existing.authorUserId !== access.userId) forbidden('Deleting note is forbidden')

  await prisma.userNote.delete({ where: { id: noteId } })
  return { id: noteId }
}

export function mapNoteError(error: unknown) {
  if (error instanceof NoteError) {
    return { status: error.status, body: apiError(error.code, error.message) }
  }

  return {
    status: 500,
    body: apiError('NOTE_REQUEST_FAILED', 'Note request failed'),
  }
}