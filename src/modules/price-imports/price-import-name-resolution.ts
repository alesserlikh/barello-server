export type ResolvedPriceImportProductNames = {
  canonicalName: string | null
  russianName: string | null
  displayName: string | null
  translatedName: string | null
  isRussianProduced: boolean
}

export function payloadRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function payloadText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function hasCyrillic(value: string | null | undefined) {
  return Boolean(value && /[\u0400-\u04FF]/.test(value))
}

export function hasLatin(value: string | null | undefined) {
  return Boolean(value && /[A-Za-z]/.test(value))
}

const CYRILLIC_LATIN_LOOKALIKE_MAP: Record<string, string> = {
  '\u0410': 'A',
  '\u0412': 'B',
  '\u0415': 'E',
  '\u041a': 'K',
  '\u041c': 'M',
  '\u041d': 'H',
  '\u041e': 'O',
  '\u0420': 'P',
  '\u0421': 'C',
  '\u0422': 'T',
  '\u0425': 'X',
  '\u0430': 'a',
  '\u0432': 'b',
  '\u0435': 'e',
  '\u043a': 'k',
  '\u043c': 'm',
  '\u043d': 'h',
  '\u043e': 'o',
  '\u0440': 'p',
  '\u0441': 'c',
  '\u0442': 't',
  '\u0445': 'x',
}

export function normalizeEnglishLikeName(value: string | null | undefined) {
  const text = payloadText(value)
  if (!text || !hasLatin(text)) {
    return null
  }

  const normalized = text.replace(/[\u0410\u0412\u0415\u041a\u041c\u041d\u041e\u0420\u0421\u0422\u0425\u0430\u0432\u0435\u043a\u043c\u043d\u043e\u0440\u0441\u0442\u0445]/g, (char) => (
    CYRILLIC_LATIN_LOOKALIKE_MAP[char] ?? char
  ))

  return hasCyrillic(normalized) ? null : normalized
}

export function isEnglishLikeName(value: string | null | undefined) {
  return Boolean(normalizeEnglishLikeName(value))
}

export function isRussianCountryName(value: string | null | undefined) {
  if (!value) {
    return false
  }

  const normalized = value.trim().toLowerCase()
  return (
    /\brussia\b/.test(normalized) ||
    /\brussian federation\b/.test(normalized) ||
    normalized === 'rf' ||
    normalized === '\u0440\u0444' ||
    normalized.includes('\u0440\u043e\u0441\u0441\u0438')
  )
}

function firstMatching(
  values: Array<string | null | undefined>,
  predicate: (value: string) => boolean,
) {
  for (const value of values) {
    const text = payloadText(value)
    if (text && predicate(text)) {
      return text
    }
  }

  return null
}

function firstMapped(
  values: Array<string | null | undefined>,
  mapper: (value: string | null | undefined) => string | null,
) {
  for (const value of values) {
    const mapped = mapper(value)
    if (mapped) {
      return mapped
    }
  }

  return null
}

export function getPriceImportProductPayload(payload: Record<string, unknown>) {
  return payloadRecord(payload.product)
}

export function getPriceImportNameParts(payload: Record<string, unknown>) {
  return payloadRecord(getPriceImportProductPayload(payload).nameParts)
}

export function isRussianProducedPayload(payload: Record<string, unknown>) {
  const productPayload = getPriceImportProductPayload(payload)
  const nameParts = getPriceImportNameParts(payload)

  return [
    payloadText(productPayload.country),
    payloadText(payload.country),
    payloadText(nameParts.country),
  ].some(isRussianCountryName)
}

export function resolvePriceImportProductNames(
  payload: Record<string, unknown>,
  options: {
    rawName?: string | null
    normalizedName?: string | null
    isRussianProduced?: boolean
  } = {},
): ResolvedPriceImportProductNames {
  const productPayload = getPriceImportProductPayload(payload)
  const nameParts = getPriceImportNameParts(payload)
  const isRussianProduced = options.isRussianProduced ?? isRussianProducedPayload(payload)

  const russianName = firstMatching([
    payloadText(nameParts.ruName),
    payloadText(productPayload.russianName),
    payloadText(productPayload.canonicalName),
    payloadText(productPayload.translatedName),
    payloadText(productPayload.displayName),
    payloadText(productPayload.originalName),
    payloadText(productPayload.name),
    options.rawName,
    options.normalizedName,
  ], hasCyrillic)

  const englishName = firstMapped([
    payloadText(productPayload.canonicalName),
    payloadText(nameParts.enName),
    payloadText(productPayload.name),
  ], normalizeEnglishLikeName)

  if (isRussianProduced) {
    return {
      canonicalName: russianName,
      russianName: null,
      displayName: null,
      translatedName: null,
      isRussianProduced,
    }
  }

  return {
    canonicalName: englishName,
    russianName,
    displayName: russianName,
    translatedName: russianName,
    isRussianProduced,
  }
}
