import { FacetScope, FacetType, Prisma } from '../../../generated/prisma'
import { prisma } from '../../../lib/prisma'
import {
  CatalogFacetDto,
  CatalogFacetSelectedValues,
  computeScopeFacets,
  FacetRegistryRecord,
  hasFacetSelection,
  loadFacetRegistryEntries,
  matchesRangeValue,
  matchesValueSelection,
  normalizeRange,
  normalizeStringArray,
} from '../facet-shared'

/**
 * PRICE_IMPORT scope, backed by SupplierPriceImportRow (not CatalogNormalizedRow — that
 * model is defined in the schema but nothing in the app ever writes to it; the real
 * price-import pipeline reads/writes SupplierPriceImportRow.normalizedPayload end to end,
 * so building facets over the dead table would have nothing to query). Most attribute
 * facets (product./variant./offer.*) read out of the row's normalizedPayload JSON, which
 * is where the parser actually puts brand/country/color/sugar/volume/price/etc. before a
 * product match exists. `import_row.*` reads columns native to the row itself
 * (mappingStatus, validationStatus, mappingConfidence, whether it has an error).
 */

type ImportRowRecord = {
  id: string
  mappingStatus: string
  validationStatus: string
  mappingConfidence: Prisma.Decimal | null
  errorText: string | null
  normalizedPayload: Prisma.JsonValue | null
} & Record<string, unknown>

export type PriceImportFacetQuery = {
  importId: string
  rowId?: string | null
  categoryId?: string | null
  search?: string | null
  selectedFacets?: CatalogFacetSelectedValues | null
  includeHiddenFacets?: boolean
}

function payloadObject(payload: Prisma.JsonValue | null, key?: string) {
  const root = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {}
  if (!key) return root
  const nested = root[key]
  return nested && typeof nested === 'object' && !Array.isArray(nested) ? (nested as Record<string, unknown>) : {}
}

function payloadFieldValue(payload: Record<string, unknown>, fallback: Record<string, unknown>, key: string) {
  const value = payload[key] ?? fallback[key]
  if (value === null || value === undefined || Array.isArray(value) || typeof value === 'object') return null
  return String(value)
}

/** `product.`/`variant.`/`offer.` dataSource read out of normalizedPayload's matching sub-object. */
function readPayloadFieldValue(record: ImportRowRecord, dataSource: string) {
  const [prefix, ...rest] = dataSource.split('.')
  const field = rest.join('.')
  const root = payloadObject(record.normalizedPayload)
  const nested = payloadObject(record.normalizedPayload, prefix)
  if (prefix === 'variant' && field === 'volume') {
    return payloadFieldValue(nested, root, 'volume') ?? payloadFieldValue(nested, root, 'volumeMl')
  }
  return payloadFieldValue(nested, root, field)
}

function readImportRowFieldValues(record: ImportRowRecord, facet: FacetRegistryRecord): string[] {
  if (facet.dataSource.startsWith('import_row.')) {
    const field = facet.dataSource.replace('import_row.', '')

    if (field === 'hasErrors') {
      return record.errorText ? ['true'] : []
    }

    const value = record[field]
    if (value === null || value === undefined || Array.isArray(value)) return []
    return [String(value)]
  }

  if (
    facet.dataSource.startsWith('product.') ||
    facet.dataSource.startsWith('variant.') ||
    facet.dataSource.startsWith('offer.')
  ) {
    const value = readPayloadFieldValue(record, facet.dataSource)
    return value ? [value] : []
  }

  return []
}

function importRowMatchesFacet(record: ImportRowRecord, facet: FacetRegistryRecord, selection: unknown) {
  if (!hasFacetSelection(facet, selection)) return true
  const value = readImportRowFieldValues(record, facet)[0] ?? null
  return facet.type === FacetType.RANGE
    ? matchesRangeValue(value, selection)
    : matchesValueSelection(value, selection)
}

async function loadRecords(importId: string, search?: string | null): Promise<ImportRowRecord[]> {
  const rows = await prisma.supplierPriceImportRow.findMany({
    where: {
      importId,
      ...(search?.trim()
        ? {
            OR: [
              { rawName: { contains: search.trim(), mode: 'insensitive' } },
              { normalizedName: { contains: search.trim(), mode: 'insensitive' } },
            ],
          }
        : {}),
    },
  })

  return rows as unknown as ImportRowRecord[]
}

// PRICE_IMPORT rows aren't in the CatalogCategory tree yet (rawCategory is free text until
// matched), so unlike every other scope there is no category-subtree resolution here.
export async function getPriceImportFacets(query: PriceImportFacetQuery): Promise<{
  facets: CatalogFacetDto[]
  appliedFacets: CatalogFacetSelectedValues
}> {
  const selectedFacets = query.selectedFacets ?? {}
  const facets = await loadFacetRegistryEntries(FacetScope.PRICE_IMPORT, query.categoryId)
  const records = await loadRecords(query.importId, query.search)

  return computeScopeFacets({
    facets,
    records,
    selectedFacets,
    includeHiddenFacets: query.includeHiddenFacets,
    readValues: readImportRowFieldValues,
    matchesOtherSelections: (record, allFacets, selected, ignoredFacetKey) => {
      for (const facet of allFacets) {
        if (facet.key === ignoredFacetKey) continue
        if (!importRowMatchesFacet(record, facet, selected[facet.key])) return false
      }
      return true
    },
  })
}

function buildImportRowFieldWhere(
  facet: FacetRegistryRecord,
  selection: unknown
): Prisma.SupplierPriceImportRowWhereInput | null {
  if (!hasFacetSelection(facet, selection)) return null

  if (facet.dataSource.startsWith('import_row.')) {
    const field = facet.dataSource.replace('import_row.', '')

    if (field === 'hasErrors') {
      return normalizeStringArray(selection).includes('true') ? { errorText: { not: null } } : null
    }

    if (facet.type === FacetType.RANGE) {
      const range = normalizeRange(selection)
      if (!range) return null
      return {
        [field]: {
          ...(range.min !== null ? { gte: range.min } : {}),
          ...(range.max !== null ? { lte: range.max } : {}),
        },
      } as Prisma.SupplierPriceImportRowWhereInput
    }

    return { [field]: { in: normalizeStringArray(selection) } } as Prisma.SupplierPriceImportRowWhereInput
  }

  // product./variant./offer.* live inside normalizedPayload JSON. RANGE filtering (e.g.
  // vintage/alcoholPercent/volumeMl) isn't pushed to SQL here, same limitation the CATALOG
  // engine already has for attributesJson-backed ranges (buildProductFacetWhere) — counting
  // and display still work via readImportRowFieldValues, only the DB-level predicate is
  // skipped for these.
  if (facet.type === FacetType.RANGE) return null

  const [prefix, ...rest] = facet.dataSource.split('.')
  const field = rest.join('.')
  const values = normalizeStringArray(selection)
  if (!values.length) return null
  const jsonFields = prefix === 'variant' && field === 'volume'
    ? ['volume', 'volumeMl']
    : [field]

  return {
    OR: values.flatMap((value) => {
      const jsonValues: Array<string | number> = [value]
      const numericValue = Number(value)
      if (Number.isFinite(numericValue)) jsonValues.push(numericValue)
      return jsonFields.flatMap((jsonField) =>
        jsonValues.map((jsonValue) => ({
          normalizedPayload: {
            path: [prefix, jsonField],
            equals: jsonValue,
          },
        }))
      )
    }),
  } as Prisma.SupplierPriceImportRowWhereInput
}

export async function buildPriceImportRowWhere(
  query: PriceImportFacetQuery
): Promise<Prisma.SupplierPriceImportRowWhereInput> {
  const facets = await loadFacetRegistryEntries(FacetScope.PRICE_IMPORT, query.categoryId)
  const selectedFacets = query.selectedFacets ?? {}
  const and: Prisma.SupplierPriceImportRowWhereInput[] = []
  const search = query.search?.trim()

  for (const facet of facets) {
    const where = buildImportRowFieldWhere(facet, selectedFacets[facet.key])
    if (where) and.push(where)
  }

  return {
    importId: query.importId,
    ...(query.rowId ? { id: query.rowId } : {}),
    ...(search
      ? {
          OR: [
            { rawName: { contains: search, mode: 'insensitive' } },
            { normalizedName: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(and.length ? { AND: and } : {}),
  }
}
