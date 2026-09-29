import { CatalogCategorySection } from '../../generated/prisma'
import { prisma } from '../../lib/prisma'

export const CATALOG_CATEGORY_MATCH_SOURCES = [
  'EXACT_SUPPLIER_MAPPING',
  'GLOBAL_MAPPING',
  'HEURISTIC',
  'UNRESOLVED',
] as const

export type CatalogCategoryMatchSource =
  (typeof CATALOG_CATEGORY_MATCH_SOURCES)[number]

type CatalogCategoryMatchCategory = {
  id: string
  code: string | null
  name: string
  parentId: string | null
}

export type CatalogCategoryMatchResult = {
  source: CatalogCategoryMatchSource
  normalizedRawCategory: string
  category: CatalogCategoryMatchCategory | null
  confidence: number
  reason: string
}

export function normalizeRawCategory(value: unknown) {
  const normalizedValue = typeof value === 'string' ? value.trim() : ''

  if (!normalizedValue) {
    return ''
  }

  return normalizedValue
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ё/g, 'е')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s-]+/gu, '')
    .trim()
}

function transliterateCyrillic(value: string) {
  const map: Record<string, string> = {
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
    й: 'i',
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
    х: 'h',
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

  return Array.from(value.toLowerCase())
    .map((character) => map[character] ?? character)
    .join('')
}

function toCategoryCodeCandidate(value: string) {
  const transliterated = transliterateCyrillic(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')

  return transliterated
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

type HeuristicCategoryAlias = {
  aliases: string[]
  targetCodes: string[]
  targetNames: string[]
  section?: CatalogCategorySection
  confidence: number
  reason: string
  preferNames?: boolean
}

const HEURISTIC_CATEGORY_ALIASES: HeuristicCategoryAlias[] = [
  {
    aliases: [
      'тихие вина',
      'тихое вино',
      'вино',
      'вина',
      'wine',
      'still wine',
      'still wines',
    ],
    targetCodes: ['vino'],
    targetNames: ['Вина', 'Вино'],
    section: CatalogCategorySection.ALCOHOL,
    confidence: 0.88,
    reason: 'Категория определена по alias-словарю: wine/вино → Вина.',
  },
  {
    aliases: [
      'крепкий алкоголь',
      'spirits',
      'spirit',
      'strong alcohol',
      'liquor',
      'distillates',
    ],
    targetCodes: ['krepkii-alkogol'],
    targetNames: ['Крепкий алкоголь'],
    section: CatalogCategorySection.ALCOHOL,
    confidence: 0.88,
    reason: 'Категория определена по alias-словарю: spirits/крепкий алкоголь → Крепкий алкоголь.',
  },
  {
    aliases: [
      'игристые',
      'игристое',
      'игристое вино',
      'игристые вина',
      'шампанское',
      'champagne',
      'sparkling',
      'sparkling wine',
      'sparkling wines',
    ],
    targetCodes: ['vino'],
    targetNames: [
      'Игристое/Шампанское',
      'Игристое',
      'Шампанское',
      'Вина',
      'Вино',
    ],
    section: CatalogCategorySection.ALCOHOL,
    confidence: 0.84,
    reason: 'Категория определена по alias-словарю: sparkling/champagne/игристые → Игристое/Шампанское.',
    preferNames: true,
  },
  {
    aliases: [
      'масло',
      'масла',
      'оливковое масло',
      'food',
      'foods',
      'specialities',
      'specialties',
      'grocery',
      'delicatessen',
    ],
    targetCodes: [
      'produkty-i-ingredienty-dlya-bara-kuhni',
      'bezalkogolnye-napitki',
    ],
    targetNames: [
      'Продукты и ингредиенты для бара/кухни',
      'Продукты и ингредиенты для бара кухни',
      'Продукты',
      'Специалитеты',
      'Безалкогольные напитки',
    ],
    section: CatalogCategorySection.DRINKS_FOOD,
    confidence: 0.8,
    reason: 'Категория определена по alias-словарю: food/specialities/масло → food/безалкогольные категории.',
  },
  {
    aliases: ['джин'],
    targetCodes: ['krepkii-alkogol--dzhin-i-mozhzhevelovye-distillyaty'],
    targetNames: ['Джин и можжевеловые дистилляты', 'Крепкий алкоголь'],
    section: CatalogCategorySection.ALCOHOL,
    confidence: 0.86,
    reason: 'Категория определена по встроенному алкогольному alias-словарю.',
  },
  {
    aliases: ['ликер', 'ликёр'],
    targetCodes: ['krepkii-alkogol--likery'],
    targetNames: ['Ликеры', 'Ликёры', 'Крепкий алкоголь'],
    section: CatalogCategorySection.ALCOHOL,
    confidence: 0.86,
    reason: 'Категория определена по встроенному алкогольному alias-словарю.',
  },
  {
    aliases: ['сакэ', 'саке'],
    targetCodes: ['krepkii-alkogol--aziatskie-distillyaty--sake'],
    targetNames: ['Саке', 'Сакэ', 'Крепкий алкоголь'],
    section: CatalogCategorySection.ALCOHOL,
    confidence: 0.86,
    reason: 'Категория определена по встроенному алкогольному alias-словарю.',
  },
  {
    aliases: ['настойка', 'настойки'],
    targetCodes: ['krepkii-alkogol--vodka--nastoiki-na-vodke'],
    targetNames: ['Настойки на водке', 'Крепкий алкоголь'],
    section: CatalogCategorySection.ALCOHOL,
    confidence: 0.84,
    reason: 'Категория определена по встроенному алкогольному alias-словарю.',
  },
  {
    aliases: ['аперитив', 'аперитивы'],
    targetCodes: ['krepkii-alkogol--aperitivy'],
    targetNames: ['Аперитивы', 'Крепкий алкоголь'],
    section: CatalogCategorySection.ALCOHOL,
    confidence: 0.84,
    reason: 'Категория определена по встроенному алкогольному alias-словарю.',
  },
]

function buildUnresolvedMatch(
  rawCategory: string | null,
  normalizedRawCategory: string,
  reason?: string,
): CatalogCategoryMatchResult {
  return {
    source: 'UNRESOLVED',
    normalizedRawCategory,
    category: null,
    confidence: 0,
    reason: reason ?? (
      rawCategory?.trim()
        ? 'Категория не найдена ни в supplier/global mapping, ни эвристикой.'
        : 'В строке нет исходной категории.'
    ),
  }
}

function buildResolvedMatch(params: {
  source: CatalogCategoryMatchSource
  normalizedRawCategory: string
  category: CatalogCategoryMatchCategory
  confidence: number
  reason: string
}): CatalogCategoryMatchResult {
  return {
    source: params.source,
    normalizedRawCategory: params.normalizedRawCategory,
    category: params.category,
    confidence: params.confidence,
    reason: params.reason,
  }
}

function getCategoryLookupCandidates(rawCategory: string | null) {
  const rawValue = rawCategory?.trim()
  if (!rawValue) return []

  const candidates = new Set<string>([rawValue])
  const withoutSupplierPrefix = rawValue
    .replace(/^(аст|ast)\s*[/\\-]\s*/i, '')
    .replace(/^(аст|ast)\s*\(([^)]+)\)\s*$/i, '$2')
    .trim()

  if (withoutSupplierPrefix && withoutSupplierPrefix !== rawValue) {
    candidates.add(withoutSupplierPrefix)
  }

  for (const value of [rawValue, withoutSupplierPrefix]) {
    if (!value) continue

    for (const part of value.split(/[\/\\]/g)) {
      const trimmedPart = part.trim()
      if (trimmedPart) candidates.add(trimmedPart)
    }

    const dashParts = value.split(/\s*[-–—]\s*/g).map((part) => part.trim()).filter(Boolean)
    if (dashParts.length > 1) {
      candidates.add(dashParts[dashParts.length - 1])
    }
  }

  return Array.from(candidates)
}

function getCategoryPathSegments(rawCategory: string | null) {
  const rawValue = rawCategory?.trim()
  if (!rawValue) return []

  return rawValue
    .split(/[\/\\]/g)
    .map((part) => part.trim())
    .filter(Boolean)
}

function normalizeCategoryPathSlug(value: string) {
  const code = toCategoryCodeCandidate(value)
  const aliases: Record<string, string> = {
    vino: 'vino',
    vina: 'vino',
    brut: 'bryut',
  }

  return aliases[code] ?? code
}

function getCategoryPathCodeCandidates(segments: string[]) {
  const slugs = segments.map(normalizeCategoryPathSlug).filter(Boolean)
  if (slugs.length < 2) return []

  const candidates = new Set<string>()
  candidates.add(slugs.join('--'))

  if (slugs[0] === 'vino' && slugs.length > 2) {
    candidates.add(`${slugs[0]}-${slugs[1]}--${slugs.slice(2).join('--')}`)
  }

  return Array.from(candidates)
}

async function findCategoryByPath(params: {
  rawCategory: string | null
  section?: CatalogCategorySection
}): Promise<CatalogCategoryMatchCategory | null> {
  const segments = getCategoryPathSegments(params.rawCategory)
  if (segments.length < 2) return null

  for (const code of getCategoryPathCodeCandidates(segments)) {
    const category = await prisma.catalogCategory.findFirst({
      where: {
        code,
        ...(params.section ? { section: params.section } : {}),
      },
      select: {
        id: true,
        code: true,
        name: true,
        parentId: true,
      },
    })

    if (category) return category
  }

  const normalizedSegments = segments.map(normalizeRawCategory)
  const lastSegment = segments[segments.length - 1]
  const leafCandidates = await prisma.catalogCategory.findMany({
    where: {
      name: {
        equals: lastSegment,
        mode: 'insensitive',
      },
      ...(params.section ? { section: params.section } : {}),
    },
    select: {
      id: true,
      code: true,
      name: true,
      parentId: true,
    },
  })

  for (const leaf of leafCandidates) {
    const path: CatalogCategoryMatchCategory[] = []
    let cursor: CatalogCategoryMatchCategory | null = leaf

    while (cursor) {
      path.unshift(cursor)
      cursor = cursor.parentId
        ? await prisma.catalogCategory.findUnique({
            where: { id: cursor.parentId },
            select: {
              id: true,
              code: true,
              name: true,
              parentId: true,
            },
          })
        : null
    }

    const tail = path.map((item) => normalizeRawCategory(item.name)).slice(-normalizedSegments.length)
    if (
      tail.length === normalizedSegments.length &&
      tail.every((value, index) => value === normalizedSegments[index])
    ) {
      return leaf
    }
  }

  for (let end = segments.length - 1; end >= 2; end -= 1) {
    const parentPathCategory = await findCategoryByPath({
      rawCategory: segments.slice(0, end).join(' / '),
      section: params.section,
    })

    if (parentPathCategory) return parentPathCategory
  }

  return null
}

function isAlcoholCategoryCandidate(value: string) {
  return /вино|вина|винн|шампан|игрист|кава|просекко|асти|москато|ламбруско|франчакорта|спуманте|креман|петнат|зект|херес|водка|лик[её]р|виски|ром|джин|текила|коньяк|бренди|саке|сакэ|пиво|сидр|вермут|портвейн|spirits?|wine|champagne|sparkling/i.test(value)
}

function shouldConstrainDerivedCategoryToAlcohol(rawCategory: string | null, lookupCandidate: string) {
  const rawValue = rawCategory?.trim()
  return Boolean(
    rawValue &&
    lookupCandidate !== rawValue &&
    /^(аст|ast)(\s|[/\\(–—-])/i.test(rawValue),
  )
}

function shouldConstrainCategoryToAlcohol(rawCategory: string | null, lookupCandidate: string) {
  return (
    shouldConstrainDerivedCategoryToAlcohol(rawCategory, lookupCandidate) ||
    isAlcoholCategoryCandidate(lookupCandidate)
  )
}

function matchesAlias(normalizedRawCategory: string, alias: string) {
  const normalizedAlias = normalizeRawCategory(alias)
  return (
    normalizedRawCategory === normalizedAlias ||
    normalizedRawCategory.includes(normalizedAlias) ||
    normalizedAlias.includes(normalizedRawCategory)
  )
}

async function findCategoryByCodes(params: {
  codes: string[]
  section?: CatalogCategorySection
}) {
  for (const code of params.codes) {
    if (!code) continue

    const category = await prisma.catalogCategory.findFirst({
      where: {
        code,
        ...(params.section ? { section: params.section } : {}),
      },
      select: {
        id: true,
        code: true,
        name: true,
        parentId: true,
      },
    })

    if (category) return category
  }

  return null
}

async function findCategoryByNames(params: {
  names: string[]
  section?: CatalogCategorySection
}) {
  for (const name of params.names) {
    const category = await prisma.catalogCategory.findFirst({
      where: {
        name: {
          equals: name,
          mode: 'insensitive',
        },
        ...(params.section ? { section: params.section } : {}),
      },
      select: {
        id: true,
        code: true,
        name: true,
        parentId: true,
      },
    })

    if (category) return category
  }

  return null
}

async function resolveHeuristicCategory(params: {
  rawCategory: string | null
  normalizedRawCategory: string
}): Promise<CatalogCategoryMatchResult | null> {
  const pathCategory = await findCategoryByPath({
    rawCategory: params.rawCategory,
    section: shouldConstrainCategoryToAlcohol(params.rawCategory, params.rawCategory ?? '')
      ? CatalogCategorySection.ALCOHOL
      : undefined,
  })

  if (pathCategory) {
    return buildResolvedMatch({
      source: 'HEURISTIC',
      normalizedRawCategory: params.normalizedRawCategory,
      category: pathCategory,
      confidence: 0.95,
      reason: 'Категория найдена по полному пути из нормализованного прайса.',
    })
  }

  for (const alias of HEURISTIC_CATEGORY_ALIASES) {
    const aliasMatched = alias.aliases.some((candidate) =>
      matchesAlias(params.normalizedRawCategory, candidate),
    )

    if (!aliasMatched) continue

    const category = alias.preferNames
      ? await findCategoryByNames({
          names: alias.targetNames,
          section: alias.section,
        }) ??
        await findCategoryByCodes({
          codes: alias.targetCodes,
          section: alias.section,
        })
      : await findCategoryByCodes({
          codes: alias.targetCodes,
          section: alias.section,
        }) ??
        await findCategoryByNames({
          names: alias.targetNames,
          section: alias.section,
        })

    if (!category) {
      continue
    }

    return buildResolvedMatch({
      source: 'HEURISTIC',
      normalizedRawCategory: params.normalizedRawCategory,
      category,
      confidence: alias.confidence,
      reason: alias.reason,
    })
  }

  for (const lookupCandidate of getCategoryLookupCandidates(params.rawCategory)) {
    const codeCandidate = toCategoryCodeCandidate(lookupCandidate)

    if (!codeCandidate) {
      continue
    }

    const categoryByCode = await prisma.catalogCategory.findFirst({
      where: {
        code: codeCandidate,
        ...(shouldConstrainCategoryToAlcohol(params.rawCategory, lookupCandidate)
          ? { section: CatalogCategorySection.ALCOHOL }
          : {}),
      },
      select: {
        id: true,
        code: true,
        name: true,
        parentId: true,
      },
    })

    if (categoryByCode) {
      return buildResolvedMatch({
        source: 'HEURISTIC',
        normalizedRawCategory: params.normalizedRawCategory,
        category: categoryByCode,
        confidence: 0.76,
        reason: `Категория найдена эвристикой по code="${codeCandidate}".`,
      })
    }
  }

  for (const lookupCandidate of getCategoryLookupCandidates(params.rawCategory)) {
    const categoryByName = await prisma.catalogCategory.findFirst({
      where: {
        name: {
          equals: lookupCandidate,
          mode: 'insensitive',
        },
        ...(shouldConstrainCategoryToAlcohol(params.rawCategory, lookupCandidate)
          ? { section: CatalogCategorySection.ALCOHOL }
          : {}),
      },
      select: {
        id: true,
        code: true,
        name: true,
        parentId: true,
      },
    })

    if (categoryByName) {
      return buildResolvedMatch({
        source: 'HEURISTIC',
        normalizedRawCategory: params.normalizedRawCategory,
        category: categoryByName,
        confidence: 0.72,
        reason: `Категория найдена эвристикой по точному имени "${lookupCandidate}".`,
      })
    }
  }

  return null
}

export async function resolveCatalogCategoryMatch(params: {
  rawCategory: string | null
  supplierId?: string | null
}): Promise<CatalogCategoryMatchResult> {
  const normalizedRawCategory = normalizeRawCategory(params.rawCategory)

  if (!normalizedRawCategory) {
    return buildUnresolvedMatch(params.rawCategory, normalizedRawCategory)
  }

  if (params.supplierId) {
    const savedMapping = await prisma.catalogCategoryMapping.findFirst({
      where: {
        supplierId: params.supplierId,
        normalizedRawCategory,
      },
      include: {
        catalogCategory: {
          select: {
            id: true,
            code: true,
            name: true,
            parentId: true,
          },
        },
      },
    })

    if (savedMapping) {
      return buildResolvedMatch({
        source: 'EXACT_SUPPLIER_MAPPING',
        normalizedRawCategory,
        category: savedMapping.catalogCategory,
        confidence: 1,
        reason: 'Использован точный mapping категории для этого поставщика.',
      })
    }
  }

  const globalMapping = await prisma.catalogCategoryMapping.findFirst({
    where: {
      supplierId: null,
      normalizedRawCategory,
    },
    include: {
      catalogCategory: {
        select: {
          id: true,
          code: true,
          name: true,
          parentId: true,
        },
      },
    },
  })

  if (globalMapping) {
    return buildResolvedMatch({
      source: 'GLOBAL_MAPPING',
      normalizedRawCategory,
      category: globalMapping.catalogCategory,
      confidence: 0.98,
      reason: 'Использован глобальный mapping категории.',
    })
  }

  const heuristicMatch = await resolveHeuristicCategory({
    rawCategory: params.rawCategory,
    normalizedRawCategory,
  })

  if (heuristicMatch) {
    return heuristicMatch
  }

  return buildUnresolvedMatch(params.rawCategory, normalizedRawCategory)
}
