import type { NextFunction, Request, Response } from 'express'
import { apiError } from '../lib/api-error'
import { localizeApiErrorMessage } from '../lib/api-error-messages'

const FALLBACK_CODES: Array<[string, string]> = [
  ['/profile', 'PROFILE_REQUEST_FAILED'],
  ['/notifications', 'NOTIFICATION_REQUEST_FAILED'],
  ['/tasks', 'TASK_REQUEST_FAILED'],
  ['/notes', 'NOTE_REQUEST_FAILED'],
  ['/downloads', 'DOWNLOAD_REQUEST_FAILED'],
]

function fallbackCode(path: string) {
  return FALLBACK_CODES.find(([prefix]) => path === prefix || path.startsWith(prefix + '/'))?.[1] ?? 'REQUEST_FAILED'
}

export function normalizeApiErrors(req: Request, res: Response, next: NextFunction) {
  const sendJson = res.json.bind(res)
  res.json = ((body: unknown) => {
    if (res.statusCode < 400) return sendJson(body)
    if (body && typeof body === 'object' && 'error' in body) {
      const record = body as Record<string, unknown>
      const current = record.error
      const normalized = current && typeof current === 'object'
        ? {
            ...(current as Record<string, unknown>),
            message: localizeApiErrorMessage(
              typeof (current as Record<string, unknown>).code === 'string'
                ? (current as Record<string, unknown>).code as string
                : fallbackCode(req.path),
              (current as Record<string, unknown>).message
            ),
            details: (current as Record<string, unknown>).details ?? null,
          }
        : apiError(fallbackCode(req.path), typeof current === 'string' ? current : 'Request failed').error
      const { ok: _ok, ...rest } = record
      return sendJson({ ok: false, ...rest, error: normalized })
    }
    return sendJson(apiError(fallbackCode(req.path), 'Request failed'))
  }) as Response['json']
  next()
}
