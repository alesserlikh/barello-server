import { NameDictionaryKind, NameTranslationSource, Prisma } from '../../generated/prisma'
import { prisma } from '../../lib/prisma'

const CACHE_TTL_MS = 60_000
const CYRILLIC_SHORT_I_PLACEHOLDER = '\uE000'
const REAL_WORD_LEFT_BOUNDARY = '(?<![\\u0430-\\u044f\\u0451a-z0-9])'
const REAL_WORD_RIGHT_BOUNDARY = '(?![\\u0430-\\u044f\\u0451a-z0-9])'
const CATEGORY_KEYWORD_DEFAULT_WEIGHT = 0.45
const CATEGORY_KEYWORD_CONFIDENCE_OFFSET = 0.25
const CATEGORY_KEYWORD_CONFIRMATION_BONUS = 0.05
const CATEGORY_KEYWORD_MIN_CONFIDENCE = 0.6
const GEO_MARKER_DEFAULT_WEIGHT = 0.45

export type CategorySignal = {
  source: 'CATEGORY_PREFIX' | 'CATEGORY_KEYWORD' | 'GEO_MARKER'
  pattern: string
  categoryPath: string[]
  weight: number
  attrs: Record<string, unknown>
}

export type GeoMarkerSignal = {
  source: 'GEO_MARKER'
  pattern: string
  country: string
  region: string | null
  categoryPath: string[] | null
  weight: number
}

export type BrandSignal = {
  source: 'BRAND'
  pattern: string
  canonical: string
  producer: string | null
  segment: string | null
  position: number
  score: number
  secondaryBrand: string | null
}

export type DecomposedNameParts = {
  ruName: string | null
  enName: string | null
  enSource: 'SUPPLIER_PROVIDED' | 'TRANSLATION_MEMORY' | 'GENERATED' | null
  enConfidence: number | null
  categoryPath: string[] | null
  categoryAttrs: Record<string, unknown>
  categorySignals: CategorySignal[]
  categoryConfidence: number | null
  country: string | null
  region: string | null
  geoAmbiguous: boolean
  geoSignals: GeoMarkerSignal[]
  brand: string | null
  producer: string | null
  brandSegment: string | null
  brandSignals: BrandSignal[]
  volumeMl: number | null
  alcoholPercent: number | null
  alcoholPercentMax: number | null
  vintage: number | null
  features: string[]
  strippedTokens: string[]
}

export type NameDictionaries = {
  categoryPrefixes: Array<{
    normalizedPattern: string
    patternWordsCount: number
    categoryPath: string[]
    attrs: Record<string, unknown>
    priority: number
  }>
  categoryKeywords: Array<{
    normalizedPattern: string
    categoryPath: string[]
    attrs: Record<string, unknown>
    weight: number
    priority: number
  }>
  geoMarkers: Array<{
    normalizedPattern: string
    country: string
    region: string | null
    categoryPath: string[] | null
    weight: number
    priority: number
  }>
  brands: Array<{
    normalizedPattern: string
    canonical: string
    producer: string | null
    segment: string | null
    priority: number
  }>
  features: Array<{
    normalizedPattern: string
    code: string
    label: string | null
    keepInName: boolean
    impliedVolumeMl: number | null
    requiresVolumeConfirmation: boolean
    priority: number
  }>
  tradeTerms: Array<{
    normalizedPattern: string
    en: string
    priority: number
  }>
}

type DictionaryCache = {
  data: NameDictionaries
  loadedAt: number
}

let cache: DictionaryCache | null = null
let cacheLoadPromise: Promise<NameDictionaries> | null = null

export function normalizeText(value: string | null | undefined) {
  const normalizedValue = typeof value === 'string' ? value.trim() : ''

  if (!normalizedValue) {
    return null
  }

  const normalized = normalizedValue
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/Р№/g, CYRILLIC_SHORT_I_PLACEHOLDER)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(new RegExp(CYRILLIC_SHORT_I_PLACEHOLDER, 'g'), 'Р№')
    .replace(/[^\p{L}\p{N}\s%.,/-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return normalized || null
}

function jsonObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function sortByLongestPattern<T extends { normalizedPattern: string; priority: number }>(items: T[]) {
  return items.sort((a, b) => (
    b.normalizedPattern.length - a.normalizedPattern.length ||
    b.priority - a.priority
  ))
}

export async function loadNameDictionaries(): Promise<NameDictionaries> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.data
  }

  if (cacheLoadPromise) {
    return cacheLoadPromise
  }

  cacheLoadPromise = loadNameDictionariesUncached()
    .then((data) => {
      cache = { data, loadedAt: Date.now() }
      return data
    })
    .finally(() => {
      cacheLoadPromise = null
    })

  return cacheLoadPromise
}

async function loadNameDictionariesUncached(): Promise<NameDictionaries> {
  const entries = await prisma.catalogNameDictionaryEntry.findMany({
    where: { isActive: true },
    orderBy: [{ priority: 'desc' }, { normalizedPattern: 'desc' }],
  })

  const dictionaries: NameDictionaries = {
    categoryPrefixes: [],
    categoryKeywords: [],
    geoMarkers: [],
    brands: [],
    features: [],
    tradeTerms: [],
  }

  for (const entry of entries) {
    const payload = jsonObject(entry.payloadJson)
    const normalizedPattern = normalizeText(entry.normalizedPattern || entry.pattern)

    if (!normalizedPattern) {
      continue
    }

    if (entry.kind === NameDictionaryKind.CATEGORY_PREFIX) {
      const categoryPath = stringList(payload.categoryPath)
      if (!categoryPath.length) {
        continue
      }

      dictionaries.categoryPrefixes.push({
        normalizedPattern,
        patternWordsCount: normalizedPattern.split(/\s+/).filter(Boolean).length,
        categoryPath,
        attrs: jsonObject(payload.attrs as Prisma.JsonValue | null | undefined),
        priority: entry.priority,
      })
    }

    if (entry.kind === NameDictionaryKind.CATEGORY_KEYWORD) {
      const categoryPath = stringList(payload.categoryPath)
      if (!categoryPath.length) {
        continue
      }

      const weight = typeof payload.weight === 'number' && Number.isFinite(payload.weight)
        ? Math.max(0, Math.min(1, payload.weight))
        : CATEGORY_KEYWORD_DEFAULT_WEIGHT

      dictionaries.categoryKeywords.push({
        normalizedPattern,
        categoryPath,
        attrs: jsonObject(payload.attrs as Prisma.JsonValue | null | undefined),
        weight,
        priority: entry.priority,
      })
    }

    if (entry.kind === NameDictionaryKind.FEATURE) {
      const code = typeof payload.code === 'string' ? payload.code.trim() : ''
      if (!code) {
        continue
      }

      dictionaries.features.push({
        normalizedPattern,
        code,
        label: typeof payload.label === 'string' && payload.label.trim() ? payload.label.trim() : null,
        keepInName: payload.keepInName === true,
        impliedVolumeMl: typeof payload.impliedVolumeMl === 'number' && Number.isFinite(payload.impliedVolumeMl)
          ? Math.round(payload.impliedVolumeMl)
          : null,
        requiresVolumeConfirmation: payload.requiresVolumeConfirmation === true,
        priority: entry.priority,
      })
    }

    if (entry.kind === NameDictionaryKind.GEO_MARKER) {
      const country = typeof payload.country === 'string' ? payload.country.trim() : ''
      if (!country) {
        continue
      }

      const region = typeof payload.region === 'string' && payload.region.trim()
        ? payload.region.trim()
        : null
      const categoryPath = stringList(payload.impliesCategoryPath ?? payload.categoryPath)
      const weight = typeof payload.weight === 'number' && Number.isFinite(payload.weight)
        ? Math.max(0, Math.min(1, payload.weight))
        : GEO_MARKER_DEFAULT_WEIGHT

      dictionaries.geoMarkers.push({
        normalizedPattern,
        country,
        region,
        categoryPath: categoryPath.length ? categoryPath : null,
        weight,
        priority: entry.priority,
      })
    }

    if (entry.kind === NameDictionaryKind.BRAND) {
      const canonical = typeof payload.canonical === 'string' ? payload.canonical.trim() : ''
      if (!canonical) {
        continue
      }

      dictionaries.brands.push({
        normalizedPattern,
        canonical,
        producer: typeof payload.producer === 'string' && payload.producer.trim() ? payload.producer.trim() : null,
        segment: typeof payload.segment === 'string' && payload.segment.trim() ? payload.segment.trim() : null,
        priority: entry.priority,
      })
    }

    if (entry.kind === NameDictionaryKind.TRADE_TERM) {
      const en = typeof payload.en === 'string' ? payload.en.trim() : ''
      if (!en) {
        continue
      }

      dictionaries.tradeTerms.push({
        normalizedPattern,
        en,
        priority: entry.priority,
      })
    }
  }

  sortByLongestPattern(dictionaries.categoryPrefixes)
  sortByLongestPattern(dictionaries.categoryKeywords)
  sortByLongestPattern(dictionaries.geoMarkers)
  sortByLongestPattern(dictionaries.brands)
  sortByLongestPattern(dictionaries.features)
  sortByLongestPattern(dictionaries.tradeTerms)

  return dictionaries
}

function isMostlyLatin(value: string) {
  const latin = (value.match(/[a-z]/gi) || []).length
  const cyrillic = (value.match(/[а-яё]/gi) || []).length
  return latin > cyrillic * 2 && latin >= 3
}

function extractBalancedParentheses(text: string) {
  const segments: Array<{ start: number; end: number; content: string }> = []
  let depth = 0
  let start = -1

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]

    if (character === '(') {
      if (depth === 0) {
        start = index
      }
      depth += 1
      continue
    }

    if (character === ')') {
      if (depth === 0) {
        continue
      }

      depth -= 1
      if (depth === 0 && start >= 0) {
        segments.push({
          start,
          end: index,
          content: text.slice(start + 1, index),
        })
        start = -1
      }
    }
  }

  return segments
}

export function splitBilingualName(raw: string): {
  ru: string
  en: string | null
  source: 'NEWLINE' | 'PARENTHESES' | null
  strippedTokens: string[]
} {
  const strippedTokens: string[] = []
  const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean)

  if (lines.length > 1) {
    const latinLines = lines.filter(isMostlyLatin)
    const cyrillicLines = lines.filter((line) => !isMostlyLatin(line))

    if (latinLines.length && cyrillicLines.length) {
      strippedTokens.push(...latinLines)
      return {
        ru: cyrillicLines.join(' '),
        en: latinLines.join(' '),
        source: 'NEWLINE',
        strippedTokens,
      }
    }
  }

  const segments = extractBalancedParentheses(raw)
  for (const segment of segments) {
    if (isMostlyLatin(segment.content)) {
      const en = segment.content.replace(/^["'В«\s]+|["'В»\s]+$/g, '')
      strippedTokens.push(raw.slice(segment.start, segment.end + 1))

      return {
        ru: raw.slice(0, segment.start) + ' ' + raw.slice(segment.end + 1),
        en,
        source: 'PARENTHESES',
        strippedTokens,
      }
    }
  }

  return { ru: raw, en: null, source: null, strippedTokens }
}

export function extractVolume(text: string): {
  volumeMl: number | null
  residual: string
  strippedTokens: string[]
} {
  let volumeMl: number | null = null
  const strippedTokens: string[] = []
  let residual = text.replace(
    /(\d+(?:[.,]\d+)?)\s*(мл|ml)\.?(?![а-яёa-z])/gi,
    (match, rawNumber) => {
      if (volumeMl !== null) {
        return match
      }

      const parsed = Number.parseFloat(String(rawNumber).replace(',', '.'))
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return match
      }

      volumeMl = Math.round(parsed)
      strippedTokens.push(match)
      return ''
    },
  )

  if (volumeMl === null) {
    residual = residual.replace(
      /(\d+(?:[.,]\d+)?)\s*(л|l)\.?(?![а-яёa-z])/gi,
      (match, rawNumber) => {
        const liters = Number.parseFloat(String(rawNumber).replace(',', '.'))
        if (!Number.isFinite(liters) || liters <= 0 || liters > 20 || volumeMl !== null) {
          return match
        }

        volumeMl = Math.round(liters * 1000)
        strippedTokens.push(match)
        return ''
      },
    )
  }

  return { volumeMl, residual, strippedTokens }
}

export function extractAbv(text: string): {
  min: number | null
  max: number | null
  residual: string
  strippedTokens: string[]
} {
  let min: number | null = null
  let max: number | null = null
  const strippedTokens: string[] = []
  const residual = text.replace(
    /(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:[-–—]\s*(\d{1,2}(?:[.,]\d{1,2})?))?\s*%(\s*об\.?)?/gi,
    (match, rawMin, rawMax) => {
      if (min !== null) {
        return match
      }

      const parsedMin = Number.parseFloat(String(rawMin).replace(',', '.'))
      const parsedMax = rawMax ? Number.parseFloat(String(rawMax).replace(',', '.')) : parsedMin
      if (
        !Number.isFinite(parsedMin) ||
        !Number.isFinite(parsedMax) ||
        parsedMin < 0.5 ||
        parsedMin > 96 ||
        parsedMax < 0.5 ||
        parsedMax > 96 ||
        parsedMax < parsedMin
      ) {
        return match
      }

      min = parsedMin
      max = parsedMax
      strippedTokens.push(match)
      return ''
    },
  )

  return { min, max, residual, strippedTokens }
}

export function extractVintage(text: string): {
  vintage: number | null
  residual: string
  strippedTokens: string[]
} {
  let vintage: number | null = null
  const strippedTokens: string[] = []
  const maxYear = new Date().getFullYear()
  const residual = text.replace(
    /(?<![0-9])((?:19[5-9]|20[0-2])\d)(?:\s*г\.?(?:ода)?)?(?![0-9])/gi,
    (match, rawYear) => {
      if (vintage !== null) {
        return match
      }

      const year = Number(rawYear)
      if (!Number.isInteger(year) || year > maxYear) {
        return match
      }

      vintage = year
      strippedTokens.push(match)
      return ''
    },
  )

  return { vintage, residual, strippedTokens }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function featurePatternToRegexSource(normalizedPattern: string) {
  return escapeRegex(normalizedPattern)
    .replace(/\\\//g, '\\s*[\\/.]?\\s*')
    .replace(/\s+/g, '\\s+')
}

function isVolumeConfirmedByFeature(volumeMl: number | null, impliedVolumeMl: number | null) {
  if (!impliedVolumeMl) {
    return true
  }

  if (volumeMl === null) {
    return true
  }

  const tolerance = Math.max(25, impliedVolumeMl * 0.05)
  return Math.abs(volumeMl - impliedVolumeMl) <= tolerance
}

export function extractFeatures(text: string, dict: NameDictionaries, volumeMl: number | null = null): {
  features: string[]
  impliedVolumeMl: number | null
  residual: string
  strippedTokens: string[]
} {
  const features: string[] = []
  const strippedTokens: string[] = []
  let impliedVolumeMl: number | null = null
  let residual = text

  for (const feature of dict.features) {
    if (
      feature.requiresVolumeConfirmation &&
      !isVolumeConfirmedByFeature(volumeMl, feature.impliedVolumeMl)
    ) {
      continue
    }

    const rx = new RegExp(
      `${REAL_WORD_LEFT_BOUNDARY}${featurePatternToRegexSource(feature.normalizedPattern)}${REAL_WORD_RIGHT_BOUNDARY}\\.?`,
      'gi',
    )

    residual = residual.replace(rx, (match) => {
      if (!features.includes(feature.code)) {
        features.push(feature.code)
      }

      if (feature.impliedVolumeMl !== null && impliedVolumeMl === null) {
        impliedVolumeMl = feature.impliedVolumeMl
      }

      if (feature.keepInName) {
        return match
      }

      strippedTokens.push(match)
      return ''
    })
  }

  return { features, impliedVolumeMl, residual, strippedTokens }
}

export function cleanupName(value: string) {
  return value
    .replace(/\(\s*\)|"\s*"|В«\s*В»/g, ' ')
    .replace(/\s*[,;]\s*(?=[,;.]|$)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.;:\-–—]+|[\s,.;:\-–—]+$/g, '')
    .trim()
}

export function extractCategoryPrefix(text: string, dict: NameDictionaries): {
  categoryPath: string[] | null
  attrs: Record<string, unknown>
  signal: CategorySignal | null
  residual: string
  strippedTokens: string[]
} {
  const normalized = normalizeText(text)

  if (!normalized) {
    return { categoryPath: null, attrs: {}, signal: null, residual: text, strippedTokens: [] }
  }

  for (const entry of dict.categoryPrefixes) {
    const isMatch = normalized === entry.normalizedPattern ||
      normalized.startsWith(`${entry.normalizedPattern} `)

    if (!isMatch) {
      continue
    }

    const words = text.trim().split(/\s+/)
    const strippedToken = words.slice(0, entry.patternWordsCount).join(' ')
    const residual = words.slice(entry.patternWordsCount).join(' ')

    return {
      categoryPath: entry.categoryPath,
      attrs: entry.attrs,
      signal: {
        source: 'CATEGORY_PREFIX',
        pattern: entry.normalizedPattern,
        categoryPath: entry.categoryPath,
        weight: 1,
        attrs: entry.attrs,
      },
      residual,
      strippedTokens: strippedToken ? [strippedToken] : [],
    }
  }

  return { categoryPath: null, attrs: {}, signal: null, residual: text, strippedTokens: [] }
}

export function extractCategoryKeywords(text: string, dict: NameDictionaries): CategorySignal[] {
  const normalized = normalizeText(text)
  if (!normalized) {
    return []
  }

  const signals: CategorySignal[] = []
  const matchedPatterns = new Set<string>()

  for (const keyword of dict.categoryKeywords) {
    if (matchedPatterns.has(keyword.normalizedPattern)) {
      continue
    }

    const rx = new RegExp(
      `${REAL_WORD_LEFT_BOUNDARY}${featurePatternToRegexSource(keyword.normalizedPattern)}${REAL_WORD_RIGHT_BOUNDARY}`,
      'gi',
    )

    if (!rx.test(normalized)) {
      continue
    }

    matchedPatterns.add(keyword.normalizedPattern)
    signals.push({
      source: 'CATEGORY_KEYWORD',
      pattern: keyword.normalizedPattern,
      categoryPath: keyword.categoryPath,
      weight: keyword.weight,
      attrs: keyword.attrs,
    })
  }

  return signals
}

export function extractGeoMarkers(text: string, dict: NameDictionaries): GeoMarkerSignal[] {
  const normalized = normalizeText(text)
  if (!normalized) {
    return []
  }

  const signals: GeoMarkerSignal[] = []
  const matchedPatterns = new Set<string>()

  for (const marker of dict.geoMarkers) {
    if (matchedPatterns.has(marker.normalizedPattern)) {
      continue
    }

    const rx = new RegExp(
      `${REAL_WORD_LEFT_BOUNDARY}${featurePatternToRegexSource(marker.normalizedPattern)}${REAL_WORD_RIGHT_BOUNDARY}`,
      'gi',
    )

    if (!rx.test(normalized)) {
      continue
    }

    matchedPatterns.add(marker.normalizedPattern)
    signals.push({
      source: 'GEO_MARKER',
      pattern: marker.normalizedPattern,
      country: marker.country,
      region: marker.region,
      categoryPath: marker.categoryPath,
      weight: marker.weight,
    })
  }

  return signals
}

export function extractBrandSignals(text: string, dict: NameDictionaries): BrandSignal[] {
  const normalized = normalizeText(text)
  if (!normalized) {
    return []
  }

  const signals: BrandSignal[] = []
  const matchedCanonical = new Set<string>()

  for (const brand of dict.brands) {
    const rx = new RegExp(
      `${REAL_WORD_LEFT_BOUNDARY}${featurePatternToRegexSource(brand.normalizedPattern)}${REAL_WORD_RIGHT_BOUNDARY}`,
      'gi',
    )
    const match = rx.exec(normalized)
    if (!match) {
      continue
    }

    const canonicalKey = normalizeText(brand.canonical) ?? brand.canonical.toLowerCase()
    if (matchedCanonical.has(canonicalKey)) {
      continue
    }
    matchedCanonical.add(canonicalKey)

    const prefixBeforeMatch = normalized.slice(0, match.index).trim()
    const position = prefixBeforeMatch ? prefixBeforeMatch.split(/\s+/).filter(Boolean).length : 0
    const positionBonus = position <= 2 ? 1000 : 0

    signals.push({
      source: 'BRAND',
      pattern: brand.normalizedPattern,
      canonical: brand.canonical,
      producer: brand.producer,
      segment: brand.segment,
      position,
      score: positionBonus + brand.priority + brand.normalizedPattern.length,
      secondaryBrand: null,
    })
  }

  return signals.sort((a, b) => (
    b.score - a.score ||
    a.position - b.position ||
    b.pattern.length - a.pattern.length
  ))
}

function resolveBrandSignals(signals: BrandSignal[]): {
  brand: string | null
  producer: string | null
  segment: string | null
  brandSignals: BrandSignal[]
} {
  if (!signals.length) {
    return { brand: null, producer: null, segment: null, brandSignals: [] }
  }

  const [winner, secondary] = signals
  const normalizedSignals = signals.map((signal, index) => ({
    ...signal,
    secondaryBrand: index === 0 && secondary ? secondary.canonical : null,
  }))

  return {
    brand: winner.canonical,
    producer: winner.producer,
    segment: winner.segment,
    brandSignals: normalizedSignals,
  }
}

function resolveGeoMarkers(signals: GeoMarkerSignal[]): {
  country: string | null
  region: string | null
  isAmbiguous: boolean
} {
  if (!signals.length) {
    return { country: null, region: null, isAmbiguous: false }
  }

  const countries = new Set(signals.map((signal) => normalizeText(signal.country) ?? signal.country.toLowerCase()))
  if (countries.size > 1) {
    return { country: null, region: null, isAmbiguous: true }
  }

  const winner = signals
    .slice()
    .sort((a, b) => (
      b.pattern.length - a.pattern.length ||
      b.weight - a.weight
    ))[0]

  return {
    country: winner.country,
    region: winner.region,
    isAmbiguous: false,
  }
}

function categoryPathKey(categoryPath: string[]) {
  return categoryPath.join('\u0000')
}

function mergeWinningCategoryAttrs(signals: CategorySignal[]) {
  const attrs: Record<string, unknown> = {}
  const grapeSorts: string[] = []

  for (const signal of signals) {
    for (const [key, value] of Object.entries(signal.attrs)) {
      if (value === undefined || value === null || value === '') {
        continue
      }

      if (key === 'grape' && typeof value === 'string') {
        if (!grapeSorts.includes(value)) {
          grapeSorts.push(value)
        }
        continue
      }

      if (attrs[key] === undefined) {
        attrs[key] = value
      }
    }
  }

  if (grapeSorts.length) {
    attrs.grapeSorts = grapeSorts
    if (grapeSorts.length === 1) {
      attrs.grape = grapeSorts[0]
    }
  }

  return attrs
}

export function scoreCategorySignals(signals: CategorySignal[]): {
  categoryPath: string[] | null
  attrs: Record<string, unknown>
  confidence: number | null
} {
  const prefixSignal = signals.find((signal) => signal.source === 'CATEGORY_PREFIX')
  if (prefixSignal) {
    return {
      categoryPath: prefixSignal.categoryPath,
      attrs: prefixSignal.attrs,
      confidence: 1,
    }
  }

  const keywordSignals = signals.filter((signal) => (
    signal.source === 'CATEGORY_KEYWORD' ||
    signal.source === 'GEO_MARKER'
  ))
  if (!keywordSignals.length) {
    return { categoryPath: null, attrs: {}, confidence: null }
  }

  const byCategory = new Map<string, { categoryPath: string[]; signals: CategorySignal[] }>()
  for (const signal of keywordSignals) {
    const key = categoryPathKey(signal.categoryPath)
    const group = byCategory.get(key)
    if (group) {
      group.signals.push(signal)
    } else {
      byCategory.set(key, { categoryPath: signal.categoryPath, signals: [signal] })
    }
  }

  let winner: { categoryPath: string[]; signals: CategorySignal[]; confidence: number } | null = null

  for (const group of byCategory.values()) {
    const maxWeight = Math.max(...group.signals.map((signal) => signal.weight))
    const confirmationBonus = group.signals.length > 1 ? CATEGORY_KEYWORD_CONFIRMATION_BONUS : 0
    const confidence = Math.min(
      0.95,
      maxWeight + CATEGORY_KEYWORD_CONFIDENCE_OFFSET + confirmationBonus,
    )

    if (
      !winner ||
      confidence > winner.confidence ||
      (
        confidence === winner.confidence &&
        group.categoryPath.length > winner.categoryPath.length
      )
    ) {
      winner = { ...group, confidence }
    }
  }

  if (!winner || winner.confidence < CATEGORY_KEYWORD_MIN_CONFIDENCE) {
    return {
      categoryPath: null,
      attrs: {},
      confidence: winner?.confidence ?? null,
    }
  }

  return {
    categoryPath: winner.categoryPath,
    attrs: mergeWinningCategoryAttrs(winner.signals),
    confidence: winner.confidence,
  }
}

function replaceTradeTerm(candidate: string, normalizedPattern: string, replacement: string) {
  const rx = new RegExp(
    `${REAL_WORD_LEFT_BOUNDARY}${escapeRegex(normalizedPattern).replace(/\s+/g, '\\s+')}${REAL_WORD_RIGHT_BOUNDARY}`,
    'gi',
  )
  return candidate.replace(rx, replacement)
}

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
}

function transliterateCyrillicToLatin(value: string) {
  return value
    .split('')
    .map((char) => {
      const lower = char.toLowerCase()
      const replacement = CYRILLIC_TO_LATIN[lower]
      if (replacement === undefined) return char
      return char === lower
        ? replacement
        : `${replacement.charAt(0).toUpperCase()}${replacement.slice(1)}`
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function resolveCanonicalName(
  ruName: string | null,
  supplierEn: string | null,
  dict: NameDictionaries,
): Promise<{
  enName: string | null
  enSource: DecomposedNameParts['enSource']
  enConfidence: number | null
}> {
  if (supplierEn?.trim()) {
    return {
      enName: cleanupName(supplierEn),
      enSource: 'SUPPLIER_PROVIDED',
      enConfidence: 1,
    }
  }

  if (!ruName?.trim()) {
    return { enName: null, enSource: null, enConfidence: null }
  }

  const normalizedRu = normalizeText(ruName)
  if (!normalizedRu) {
    return { enName: null, enSource: null, enConfidence: null }
  }

  const memory = await prisma.productNameTranslation.findUnique({
    where: { normalizedRu },
  })

  if (memory) {
    return {
      enName: memory.enName,
      enSource: memory.source === NameTranslationSource.GENERATED ? 'GENERATED' : 'TRANSLATION_MEMORY',
      enConfidence: Number(memory.confidence),
    }
  }

  let candidate = normalizedRu
  let replacedCount = 0

  for (const term of dict.tradeTerms) {
    const before = candidate
    candidate = replaceTradeTerm(candidate, term.normalizedPattern, term.en)
    if (candidate !== before) {
      replacedCount += 1
    }
  }

  if (replacedCount === 0) {
    return { enName: null, enSource: null, enConfidence: null }
  }

  const cyrillicLeft = /[\u0430-\u044f\u0451]/i.test(candidate)
  const generatedName = cyrillicLeft ? transliterateCyrillicToLatin(candidate) : candidate
  const confidence = cyrillicLeft ? 0.45 : Math.min(0.6 + replacedCount * 0.08, 0.9)

  return {
    enName: cleanupName(generatedName),
    enSource: 'GENERATED',
    enConfidence: confidence,
  }
}

export async function decomposeName(rawName: string | null): Promise<DecomposedNameParts | null> {
  if (!rawName?.trim()) {
    return null
  }

  const dict = await loadNameDictionaries()
  const strippedTokens: string[] = []

  const bilingual = splitBilingualName(rawName)
  strippedTokens.push(...bilingual.strippedTokens)
  let text = bilingual.ru

  const volume = extractVolume(text)
  text = volume.residual
  strippedTokens.push(...volume.strippedTokens)

  const abv = extractAbv(text)
  text = abv.residual
  strippedTokens.push(...abv.strippedTokens)

  const vintage = extractVintage(text)
  text = vintage.residual
  strippedTokens.push(...vintage.strippedTokens)

  const features = extractFeatures(text, dict, volume.volumeMl)
  text = features.residual
  strippedTokens.push(...features.strippedTokens)

  text = cleanupName(text)

  const category = extractCategoryPrefix(text, dict)
  strippedTokens.push(...category.strippedTokens)

  const ruName = cleanupName(category.residual) || null
  const geoSignals = extractGeoMarkers(ruName ?? category.residual, dict)
  const geo = resolveGeoMarkers(geoSignals)
  const brand = resolveBrandSignals(extractBrandSignals(ruName ?? category.residual, dict))
  const categorySignals = [
    ...(category.signal ? [category.signal] : []),
    ...extractCategoryKeywords(ruName ?? category.residual, dict),
    ...geoSignals.flatMap((signal): CategorySignal[] => {
      if (!signal.categoryPath?.length) {
        return []
      }

      return [{
        source: 'GEO_MARKER',
        pattern: signal.pattern,
        categoryPath: signal.categoryPath,
        weight: signal.weight,
        attrs: {
          country: signal.country,
          ...(signal.region ? { region: signal.region } : {}),
        },
      }]
    }),
  ]
  const categoryScore = scoreCategorySignals(categorySignals)
  const canonical = await resolveCanonicalName(
    ruName,
    bilingual.en ? cleanupName(bilingual.en) : null,
    dict,
  )

  return {
    ruName,
    enName: canonical.enName,
    enSource: canonical.enSource,
    enConfidence: canonical.enConfidence,
    categoryPath: categoryScore.categoryPath,
    categoryAttrs: categoryScore.attrs,
    categorySignals,
    categoryConfidence: categoryScore.confidence,
    country: geo.country,
    region: geo.region,
    geoAmbiguous: geo.isAmbiguous,
    geoSignals,
    brand: brand.brand,
    producer: brand.producer,
    brandSegment: brand.segment,
    brandSignals: brand.brandSignals,
    volumeMl: volume.volumeMl ?? features.impliedVolumeMl,
    alcoholPercent: abv.min,
    alcoholPercentMax: abv.max,
    vintage: vintage.vintage,
    features: features.features,
    strippedTokens: strippedTokens.map(cleanupName).filter(Boolean),
  }
}

export function clearNameDictionariesCache() {
  cache = null
  cacheLoadPromise = null
}
