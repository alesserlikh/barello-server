import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'

import { FileAssetType, Prisma } from '../src/generated/prisma'
import { env } from '../src/config/env'
import { prisma } from '../src/lib/prisma'
import { normalizeUploadDisplayFileName } from '../src/modules/price-imports/upload-file-name'

const DEFAULT_SOURCE_DIR = String.raw`C:\Users\aless\OneDrive\Desktop\barello docs\barello img`
const APPLY_FLAG = '--apply'
const SOURCE_FLAG = '--source'
const OVERWRITE_FLAG = '--overwrite'
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])

type ParsedImageName = {
  fileName: string
  productName: string
  normalizedName: string
  volumeMl: number | null
}

type ProductCandidate = {
  id: string
  publicId: string
  name: string
  translatedName: string | null
  brand: string | null
  producer: string | null
  packageVolume: Prisma.Decimal | null
  packageVolumeUnit: string | null
  mainImageFileId: string | null
  variants: Array<{
    volume: Prisma.Decimal | null
    volumeUnit: string | null
  }>
}

type MatchCandidate = {
  id: string
  publicId: string
  name: string
  translatedName: string | null
  brand: string | null
  score: number
  volumeMatched: boolean
  mainImageFileId: string | null
}

type ImageMatch =
  | {
      status: 'matched'
      parsed: ParsedImageName
      sourcePath: string
      product: ProductCandidate
      score: number
      secondScore: number
      alreadyHasImage: boolean
    }
  | {
      status: 'unmatched' | 'ambiguous' | 'skipped'
      parsed: ParsedImageName
      sourcePath: string
      reason: string
      candidates: MatchCandidate[]
    }

function getArgValue(name: string) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null

  return process.argv[index + 1] ?? null
}

function normalizeText(value: string | null | undefined) {
  if (!value) return ''

  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ё/g, 'е')
    .replace(/Ё/g, 'Е')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\u0400-\u04ff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(value: string) {
  return normalizeText(value)
    .split(' ')
    .filter((token) => token.length > 1)
}

function parseVolumeToMl(rawValue: string, rawUnit: string) {
  const normalizedUnit = rawUnit.toLowerCase()
  const normalizedValue = rawValue.replace(',', '.')
  let value = Number(normalizedValue)

  if (!Number.isFinite(value)) return null

  if ((normalizedUnit === 'l' || normalizedUnit === 'л') && !normalizedValue.includes('.')) {
    value = normalizedValue.startsWith('0')
      ? Number(`0.${normalizedValue.slice(1)}`)
      : value
  }

  if (normalizedUnit === 'l' || normalizedUnit === 'л') {
    return Math.round(value * 1000)
  }

  return Math.round(value)
}

function parseImageName(fileName: string): ParsedImageName {
  const parsed = path.parse(fileName)
  const volumeMatch = parsed.name.match(/[-_\s](\d+(?:[.,]\d+)?)(l|ml|л|мл)$/i)
  const productName = volumeMatch
    ? parsed.name.slice(0, volumeMatch.index).replace(/[-_]+/g, ' ').trim()
    : parsed.name.replace(/[-_]+/g, ' ').trim()
  const volumeMl = volumeMatch
    ? parseVolumeToMl(volumeMatch[1], volumeMatch[2])
    : null

  return {
    fileName,
    productName,
    normalizedName: normalizeText(productName),
    volumeMl,
  }
}

function decimalToNumber(value: Prisma.Decimal | null) {
  if (value === null) return null
  const numericValue = Number(value.toString())
  return Number.isFinite(numericValue) ? numericValue : null
}

function productVolumeToMl(value: Prisma.Decimal | null, unit: string | null) {
  const numericValue = decimalToNumber(value)
  if (numericValue === null) return null

  const normalizedUnit = normalizeText(unit)
  if (normalizedUnit === 'l' || normalizedUnit === 'л') return Math.round(numericValue * 1000)
  if (normalizedUnit === 'ml' || normalizedUnit === 'мл') return Math.round(numericValue)
  if (!normalizedUnit && numericValue > 0 && numericValue <= 5) return Math.round(numericValue * 1000)
  if (!normalizedUnit) return Math.round(numericValue)

  return Math.round(numericValue)
}

function productVolumes(product: ProductCandidate) {
  return [
    productVolumeToMl(product.packageVolume, product.packageVolumeUnit),
    ...product.variants.map((variant) => productVolumeToMl(variant.volume, variant.volumeUnit)),
  ].filter((volume): volume is number => volume !== null)
}

function hasVolumeMatch(product: ProductCandidate, volumeMl: number | null) {
  if (volumeMl === null) return true
  return productVolumes(product).some((productVolumeMl) => Math.abs(productVolumeMl - volumeMl) <= 1)
}

function productSearchText(product: ProductCandidate) {
  return [
    product.brand,
    product.name,
    product.translatedName,
    product.producer,
  ].filter(Boolean).join(' ')
}

function scoreProductName(parsed: ParsedImageName, product: ProductCandidate) {
  const imageTokens = tokenize(parsed.productName)
  const productTokens = new Set(tokenize(productSearchText(product)))

  if (imageTokens.length === 0 || productTokens.size === 0) return 0

  const matchedTokens = imageTokens.filter((token) => productTokens.has(token)).length
  const coverage = matchedTokens / imageTokens.length
  const productText = normalizeText(productSearchText(product))
  const phraseBonus = parsed.normalizedName && productText.includes(parsed.normalizedName) ? 0.2 : 0

  return Math.min(1, coverage + phraseBonus)
}

function matchImageToProduct(
  parsed: ParsedImageName,
  products: ProductCandidate[],
  overwrite: boolean,
): MatchCandidate[] {
  return products
    .map((product) => ({
      id: product.id,
      publicId: product.publicId,
      name: product.name,
      translatedName: product.translatedName,
      brand: product.brand,
      score: scoreProductName(parsed, product),
      volumeMatched: hasVolumeMatch(product, parsed.volumeMl),
      mainImageFileId: product.mainImageFileId,
    }))
    .filter((candidate) => candidate.volumeMatched)
    .filter((candidate) => overwrite || !candidate.mainImageFileId)
    .sort((left, right) => right.score - left.score)
}

function buildMatch(
  parsed: ParsedImageName,
  sourcePath: string,
  products: ProductCandidate[],
  overwrite: boolean,
): ImageMatch {
  const candidates = matchImageToProduct(parsed, products, overwrite)
  const [best, second] = candidates

  if (!best) {
    return {
      status: 'unmatched',
      parsed,
      sourcePath,
      reason: parsed.volumeMl === null
        ? 'No parseable volume suffix found'
        : 'No product with matching volume and usable image slot found',
      candidates: candidates.slice(0, 5),
    }
  }

  if (best.score < 0.72) {
    return {
      status: 'unmatched',
      parsed,
      sourcePath,
      reason: `Best score ${best.score.toFixed(2)} is below 0.72`,
      candidates: candidates.slice(0, 5),
    }
  }

  if (second && second.score >= 0.72 && best.score - second.score < 0.16) {
    return {
      status: 'ambiguous',
      parsed,
      sourcePath,
      reason: `Top scores are too close: ${best.score.toFixed(2)} vs ${second.score.toFixed(2)}`,
      candidates: candidates.slice(0, 5),
    }
  }

  const product = products.find((item) => item.id === best.id)
  if (!product) {
    throw new Error(`Matched product ${best.id} was not found in memory`)
  }

  return {
    status: 'matched',
    parsed,
    sourcePath,
    product,
    score: best.score,
    secondScore: second?.score ?? 0,
    alreadyHasImage: Boolean(product.mainImageFileId),
  }
}

function mimeTypeForExtension(extension: string) {
  switch (extension.toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    default:
      return 'application/octet-stream'
  }
}

function safeStorageFileName(originalName: string) {
  const extension = path.extname(originalName).toLowerCase()
  const baseName = path.basename(originalName, extension)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `${Date.now()}-${crypto.randomUUID()}-${baseName || 'product-image'}${extension}`
}

async function copyAndAttachImage(match: Extract<ImageMatch, { status: 'matched' }>) {
  const stat = await fs.stat(match.sourcePath)
  const storageFileName = safeStorageFileName(match.parsed.fileName)
  const storageKey = `catalog-products/imported/${storageFileName}`
  const destinationPath = path.join(env.uploadsRoot, ...storageKey.split('/'))

  await fs.mkdir(path.dirname(destinationPath), { recursive: true })
  await fs.copyFile(match.sourcePath, destinationPath)

  try {
    await prisma.$transaction(async (tx) => {
      const fileAsset = await tx.fileAsset.create({
        data: {
          storageKey,
          fileName: normalizeUploadDisplayFileName(match.parsed.fileName),
          mimeType: mimeTypeForExtension(path.extname(match.parsed.fileName)),
          fileSize: stat.size,
          type: FileAssetType.IMAGE,
        },
      })

      await tx.product.update({
        where: { id: match.product.id },
        data: { mainImageFileId: fileAsset.id },
      })

      await tx.productMediaAsset.create({
        data: {
          productId: match.product.id,
          fileAssetId: fileAsset.id,
          sortOrder: 0,
        },
      })
    })
  } catch (error) {
    await fs.unlink(destinationPath).catch(() => undefined)
    throw error
  }
}

async function readSourceImages(sourceDir: string) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true })

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((fileName) => IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase()))
    .sort((left, right) => left.localeCompare(right, 'en'))
    .map((fileName) => ({
      fileName,
      sourcePath: path.join(sourceDir, fileName),
      parsed: parseImageName(fileName),
    }))
}

async function loadProducts() {
  return prisma.product.findMany({
    where: {
      mergedIntoProductId: null,
    },
    select: {
      id: true,
      publicId: true,
      name: true,
      translatedName: true,
      brand: true,
      producer: true,
      packageVolume: true,
      packageVolumeUnit: true,
      mainImageFileId: true,
      variants: {
        select: {
          volume: true,
          volumeUnit: true,
        },
      },
    },
  })
}

function printReport(matches: ImageMatch[]) {
  const summary = matches.reduce(
    (acc, match) => {
      acc[match.status] += 1
      return acc
    },
    { matched: 0, unmatched: 0, ambiguous: 0, skipped: 0 },
  )

  console.info('[catalog-images] summary:', JSON.stringify(summary))

  for (const match of matches) {
    if (match.status === 'matched') {
      console.info(
        `[catalog-images] MATCH ${match.parsed.fileName} -> ${match.product.name} (${match.product.publicId}) score=${match.score.toFixed(2)} volumeMl=${match.parsed.volumeMl}`
      )
      continue
    }

    console.info(`[catalog-images] ${match.status.toUpperCase()} ${match.parsed.fileName}: ${match.reason}`)
    for (const candidate of match.candidates.slice(0, 3)) {
      console.info(
        `  candidate ${candidate.name} (${candidate.publicId}) score=${candidate.score.toFixed(2)} volumeMatched=${candidate.volumeMatched} hasImage=${Boolean(candidate.mainImageFileId)}`
      )
    }
  }
}

async function main() {
  const sourceDir = path.resolve(getArgValue(SOURCE_FLAG) ?? DEFAULT_SOURCE_DIR)
  const apply = process.argv.includes(APPLY_FLAG)
  const overwrite = process.argv.includes(OVERWRITE_FLAG)

  const [sourceImages, products] = await Promise.all([
    readSourceImages(sourceDir),
    loadProducts(),
  ])
  const matches = sourceImages.map((image) =>
    buildMatch(image.parsed, image.sourcePath, products, overwrite)
  )

  console.info('[catalog-images] mode:', apply ? 'apply' : 'dry-run')
  console.info('[catalog-images] source:', sourceDir)
  console.info('[catalog-images] products:', products.length)
  console.info('[catalog-images] images:', sourceImages.length)
  printReport(matches)

  if (!apply) {
    console.info('[catalog-images] dry-run only. Add --apply to copy files and update product images.')
    return
  }

  const matched = matches.filter(
    (match): match is Extract<ImageMatch, { status: 'matched' }> => match.status === 'matched'
  )

  for (const match of matched) {
    await copyAndAttachImage(match)
  }

  console.info(`[catalog-images] applied: ${matched.length}`)
}

main()
  .catch((error) => {
    console.error('[catalog-images] failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
