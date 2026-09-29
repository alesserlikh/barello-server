import { prisma } from '../src/lib/prisma'
import { ensureDefaultCatalogFacetRegistry } from '../src/modules/catalog-filters/catalog-filter-defaults'

async function main() {
  await ensureDefaultCatalogFacetRegistry()
  console.info('[seed-catalog-facets] default catalog facets are up to date')
}

main().catch(async (error) => {
  console.error('[seed-catalog-facets] failed:', error)
  await prisma.$disconnect()
  process.exit(1)
}).finally(async () => {
  await prisma.$disconnect()
})
