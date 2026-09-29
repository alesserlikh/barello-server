import path from 'path'
import { TextDecoder } from 'util'

const WINDOWS_RESERVED_FILE_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
])

function basename(value: string) {
  return path.basename(String(value || '').replace(/\\/g, '/')).trim()
}

function looksLikeUtf8DecodedAsLatin1(value: string) {
  return /[ÃÂÐÑ]/.test(value)
}

function looksLikeCp1251DecodedAsLatin1(value: string) {
  return /[À-ÿ]/.test(value) && !/[А-Яа-яЁё]/.test(value)
}

function decodeMojibake(value: string) {
  if (!value) {
    return value
  }

  if (looksLikeUtf8DecodedAsLatin1(value)) {
    try {
      const decoded = Buffer.from(value, 'latin1').toString('utf8')
      if (decoded && decoded !== value && !decoded.includes('\uFFFD')) {
        return decoded
      }
    } catch {
      // Keep the original value.
    }
  }

  if (looksLikeCp1251DecodedAsLatin1(value)) {
    try {
      const decoded = new TextDecoder('windows-1251').decode(
        Buffer.from(value, 'latin1'),
      )
      if (decoded && decoded !== value && !decoded.includes('\uFFFD')) {
        return decoded
      }
    } catch {
      // Keep the original value.
    }
  }

  return value
}

export function normalizeUploadDisplayFileName(value: string | null | undefined) {
  const decoded = basename(decodeMojibake(value || ''))
    .replace(/[\u0000-\u001f\u007f]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return decoded || 'file'
}

export function normalizeUploadSafeBaseName(value: string | null | undefined) {
  const displayName = normalizeUploadDisplayFileName(value)
  const extension = path.extname(displayName).toLowerCase()
  const nameWithoutExtension = displayName.slice(
    0,
    displayName.length - extension.length,
  )
  const safeName = nameWithoutExtension
    .normalize('NFC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-z0-9а-я._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')

  const normalizedSafeName =
    !safeName || WINDOWS_RESERVED_FILE_NAMES.has(safeName) ? 'file' : safeName

  return `${normalizedSafeName}${extension || ''}`
}