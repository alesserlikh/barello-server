import { FacetScope, Prisma } from '../../generated/prisma'
import { prisma } from '../../lib/prisma'
import type { AuthPayload } from '../../middleware/auth'

const DEFAULT_PRESET_NAME = '__catalog_remembered_facets'

type FilterPreferencePayload = {
  rememberedFacetKeys?: unknown
  rememberedFacets?: unknown
}

function normalizeRememberedFacetKeys(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return Array.from(new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean),
  ))
}

function readPreferencePayload(value: Prisma.JsonValue | null): FilterPreferencePayload {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as FilterPreferencePayload
    : {}
}

function normalizeRememberedFacets(value: unknown): Prisma.InputJsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const result: Record<string, unknown> = {}

  for (const [key, facetValue] of Object.entries(value)) {
    if (!key.trim()) {
      continue
    }

    if (Array.isArray(facetValue)) {
      const list = facetValue
        .filter((item): item is string | number | boolean =>
          ['string', 'number', 'boolean'].includes(typeof item),
        )
        .map(String)
        .filter(Boolean)

      if (list.length) {
        result[key] = list
      }
      continue
    }

    if (typeof facetValue === 'boolean') {
      result[key] = facetValue
      continue
    }

    if (facetValue && typeof facetValue === 'object' && !Array.isArray(facetValue)) {
      const range = facetValue as Record<string, unknown>
      const min = typeof range.min === 'number' && Number.isFinite(range.min) ? range.min : null
      const max = typeof range.max === 'number' && Number.isFinite(range.max) ? range.max : null

      if (min != null || max != null) {
        result[key] = { min, max }
      }
    }
  }

  return result as Prisma.InputJsonObject
}

function serializePreferences(
  rememberedFacetKeys: string[],
  rememberedFacets: Prisma.InputJsonObject,
): Prisma.InputJsonObject {
  return { rememberedFacetKeys, rememberedFacets }
}

export async function getCatalogFilterPreferences(auth: AuthPayload) {
  const preset = await prisma.userCatalogFilterPreset.findFirst({
    where: {
      userId: auth.userId,
      scope: FacetScope.CATALOG,
      name: DEFAULT_PRESET_NAME,
      isDefault: true,
    },
  })

  const payload = readPreferencePayload(preset?.query as Prisma.JsonValue | null)

  return {
    rememberedFacetKeys: normalizeRememberedFacetKeys(payload.rememberedFacetKeys),
    rememberedFacets: normalizeRememberedFacets(payload.rememberedFacets),
  }
}

export async function updateCatalogFilterPreferences(
  auth: AuthPayload,
  input: Record<string, unknown>,
) {
  const rememberedFacetKeys = normalizeRememberedFacetKeys(input.rememberedFacetKeys)
  const rememberedFacets = normalizeRememberedFacets(input.rememberedFacets)
  const existing = await prisma.userCatalogFilterPreset.findFirst({
    where: {
      userId: auth.userId,
      scope: FacetScope.CATALOG,
      name: DEFAULT_PRESET_NAME,
      isDefault: true,
    },
    select: { id: true },
  })

  const data = {
    query: serializePreferences(rememberedFacetKeys, rememberedFacets),
  }

  if (existing) {
    await prisma.userCatalogFilterPreset.update({
      where: { id: existing.id },
      data,
    })
  } else {
    await prisma.userCatalogFilterPreset.create({
      data: {
        userId: auth.userId,
        scope: FacetScope.CATALOG,
        name: DEFAULT_PRESET_NAME,
        isDefault: true,
        ...data,
      },
    })
  }

  return { rememberedFacetKeys, rememberedFacets }
}
