import fs from 'fs/promises'
import path from 'path'
import { prisma } from '../../lib/prisma'
import { env } from '../../config/env'
import { ContentAuthorType, ContentBannerLabel, FileAssetType, type ContentStory } from '../../generated/prisma'
import { normalizeUploadDisplayFileName } from '../price-imports/upload-file-name'

export const MODERATION_CONTENT_ADMIN_AUTHORS = [
  'Barello',
  'S_Ivashkevich',
  'R_Putilov',
  'A_Erlikh',
]

export const MODERATION_CONTENT_BANNER_LABELS = [
  ContentBannerLabel.NEW,
]

const CONTENT_STORY_LIFETIME_MS = 24 * 60 * 60 * 1000

export class ModerationContentError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message)
  }
}

type ContentFileAsset = {
  id: string
  fileName: string
  mimeType: string
  fileSize: number
  storageKey: string
}

function asText(value: unknown) {
  const text = String(value ?? '').trim()
  return text || null
}

function asBoolean(value: unknown, fallback = true) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true
    if (['false', '0', 'no', 'off'].includes(normalized)) return false
  }
  return fallback
}

function asInteger(value: unknown, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback
  const number = Number(value)
  return Number.isInteger(number) ? number : fallback
}

function getStorageKeyFromUploadedFile(file: Express.Multer.File) {
  return path
    .relative(env.uploadsRoot, file.path)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
}

function getFileAssetType(file: Express.Multer.File) {
  const mimeType = file.mimetype.toLowerCase()
  if (mimeType.startsWith('image/')) return FileAssetType.IMAGE
  if (mimeType.startsWith('video/')) return FileAssetType.VIDEO
  if (mimeType === 'application/json' || mimeType.includes('lottie')) {
    return FileAssetType.BANNER
  }
  return FileAssetType.OTHER
}

function buildContentFileUrl(storageKey: string | null | undefined) {
  if (!storageKey) return null
  const normalizedKey = storageKey
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^uploads\//, '')
  return `/uploads/${normalizedKey}`
}

function mapFileAsset(fileAsset: ContentFileAsset | null | undefined) {
  if (!fileAsset) return null
  return {
    id: fileAsset.id,
    fileName: fileAsset.fileName,
    mimeType: fileAsset.mimeType,
    fileSize: fileAsset.fileSize,
    url: buildContentFileUrl(fileAsset.storageKey),
  }
}

function buildStoryPublishWindow(isActive: boolean) {
  if (!isActive) {
    return {
      publishedAt: null,
      expiresAt: null,
    }
  }

  const publishedAt = new Date()
  return {
    publishedAt,
    expiresAt: new Date(publishedAt.getTime() + CONTENT_STORY_LIFETIME_MS),
  }
}

function isStoryPublished(story: { isActive: boolean; expiresAt: Date | null }) {
  return story.isActive && Boolean(story.expiresAt && story.expiresAt.getTime() > Date.now())
}

function getPublishedStoriesWhere() {
  return {
    isActive: true,
    expiresAt: {
      gt: new Date(),
    },
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

async function assertPublishedContentStory(storyId: string) {
  if (!storyId || !isUuid(storyId)) {
    throw new ModerationContentError(400, 'Invalid story id', { storyId })
  }

  const story = await prisma.contentStory.findFirst({
    where: {
      id: storyId,
      ...getPublishedStoriesWhere(),
    },
    select: { id: true },
  })

  if (!story) {
    throw new ModerationContentError(404, 'Story not found or expired', { storyId })
  }

  return story
}

async function createFileAsset(file: Express.Multer.File, supplierId?: string | null) {
  return prisma.fileAsset.create({
    data: {
      storageKey: getStorageKeyFromUploadedFile(file),
      fileName: normalizeUploadDisplayFileName(file.originalname),
      mimeType: file.mimetype.toLowerCase(),
      fileSize: file.size,
      type: getFileAssetType(file),
      uploadedBySupplierId: supplierId || null,
    },
  })
}

async function removeFileAsset(fileAssetId: string | null | undefined) {
  if (!fileAssetId) return

  const fileAsset = await prisma.fileAsset.findUnique({
    where: { id: fileAssetId },
    select: { id: true, storageKey: true },
  })

  if (!fileAsset) return

  await prisma.fileAsset.delete({ where: { id: fileAsset.id } }).catch(() => undefined)

  const normalizedUploadsRoot = path.resolve(env.uploadsRoot)
  const filePath = path.resolve(env.uploadsRoot, fileAsset.storageKey.replace(/^uploads\//, ''))
  if (
    filePath !== normalizedUploadsRoot &&
    filePath.startsWith(`${normalizedUploadsRoot}${path.sep}`)
  ) {
    await fs.rm(filePath, { force: true }).catch(() => undefined)
  }
}

function validateAuthorInput(input: Record<string, unknown>) {
  const authorType = (asText(input.authorType) || ContentAuthorType.ADMIN) as ContentAuthorType

  if (!Object.values(ContentAuthorType).includes(authorType)) {
    throw new ModerationContentError(400, 'authorType must be ADMIN or SUPPLIER')
  }

  if (authorType === ContentAuthorType.SUPPLIER) {
    const supplierId = asText(input.supplierId)
    if (!supplierId) {
      throw new ModerationContentError(400, 'supplierId is required for supplier stories')
    }
    return {
      authorType,
      adminAuthorName: null,
      supplierId,
    }
  }

  return {
    authorType,
    adminAuthorName: asText(input.adminAuthorName) || MODERATION_CONTENT_ADMIN_AUTHORS[0],
    supplierId: null,
  }
}

async function assertSupplierExists(supplierId: string | null | undefined) {
  if (!supplierId) return
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: { id: true },
  })
  if (!supplier) {
    throw new ModerationContentError(404, 'Supplier not found', { supplierId })
  }
}

async function getFileAssetsById(ids: string[]) {
  if (ids.length === 0) return new Map<string, ContentFileAsset>()
  const files = await prisma.fileAsset.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      fileSize: true,
      storageKey: true,
    },
  })
  return new Map(files.map((file) => [file.id, file]))
}

async function getSuppliersById(ids: string[]) {
  if (ids.length === 0) {
    return new Map<string, { id: string; publicId: string; name: string; catalogName: string | null }>()
  }
  const suppliers = await prisma.supplier.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      publicId: true,
      name: true,
      catalogName: true,
    },
  })
  return new Map(suppliers.map((supplier) => [supplier.id, supplier]))
}

export async function getModerationContent() {
  const [stories, banners, suppliers] = await Promise.all([
    prisma.contentStory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    }),
    prisma.homeBannerContent.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    }),
    getModerationContentSuppliers(),
  ])

  const fileAssetsById = await getFileAssetsById([
    ...stories.map((story) => story.fileAssetId),
    ...banners.map((banner) => banner.fileAssetId),
  ])
  const suppliersById = await getSuppliersById(
    stories
      .map((story) => story.supplierId)
      .filter((supplierId): supplierId is string => Boolean(supplierId))
  )

  return {
    ok: true,
    adminAuthors: MODERATION_CONTENT_ADMIN_AUTHORS,
    bannerLabels: MODERATION_CONTENT_BANNER_LABELS,
    suppliers,
    stories: stories.map((story) => {
      const supplier = story.supplierId ? suppliersById.get(story.supplierId) : null
      return {
        id: story.id,
        authorType: story.authorType,
        adminAuthorName: story.adminAuthorName,
        supplierId: story.supplierId,
        supplier: supplier
          ? {
              id: supplier.id,
              publicId: supplier.publicId,
              name: supplier.catalogName || supplier.name,
            }
          : null,
        authorName:
          story.authorType === ContentAuthorType.SUPPLIER
            ? supplier?.catalogName || supplier?.name || 'Supplier'
            : story.adminAuthorName || MODERATION_CONTENT_ADMIN_AUTHORS[0],
        title: story.title,
        location: story.location,
        file: mapFileAsset(fileAssetsById.get(story.fileAssetId)),
        sortOrder: story.sortOrder,
        isActive: story.isActive,
        isPublished: isStoryPublished(story),
        publishedAt: story.publishedAt?.toISOString() ?? null,
        expiresAt: story.expiresAt?.toISOString() ?? null,
        createdAt: story.createdAt.toISOString(),
        updatedAt: story.updatedAt.toISOString(),
      }
    }),
    banners: banners.map((banner) => ({
      id: banner.id,
      title: banner.title,
      label: banner.label,
      bodyText: banner.bodyText,
      lead: banner.lead,
      cta: banner.cta,
      file: mapFileAsset(fileAssetsById.get(banner.fileAssetId)),
      sortOrder: banner.sortOrder,
      isActive: banner.isActive,
      createdAt: banner.createdAt.toISOString(),
      updatedAt: banner.updatedAt.toISOString(),
    })),
  }
}

export async function getModerationContentSuppliers() {
  const suppliers = await prisma.supplier.findMany({
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      publicId: true,
      name: true,
      catalogName: true,
      isActive: true,
      business: {
        select: {
          name: true,
        },
      },
    },
  })

  return suppliers.map((supplier) => ({
    id: supplier.id,
    publicId: supplier.publicId,
    name: supplier.catalogName || supplier.name,
    legalName: supplier.business?.name || supplier.name,
    isActive: supplier.isActive,
  }))
}

type PublishedStoryRecord = ContentStory

function getStoryGroupId(story: PublishedStoryRecord) {
  if (story.authorType === ContentAuthorType.SUPPLIER) {
    return `supplier:${story.supplierId}`
  }

  return `admin:${story.adminAuthorName || MODERATION_CONTENT_ADMIN_AUTHORS[0]}`
}

export async function getPublishedContentStories() {
  const stories = await prisma.contentStory.findMany({
    where: getPublishedStoriesWhere(),
    orderBy: [{ sortOrder: 'asc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
  })
  const fileAssetsById = await getFileAssetsById(stories.map((story) => story.fileAssetId))
  const suppliersById = await getSuppliersById(
    stories
      .map((story) => story.supplierId)
      .filter((supplierId): supplierId is string => Boolean(supplierId))
  )

  const items = stories.map((story) => {
    const supplier = story.supplierId ? suppliersById.get(story.supplierId) : null
    const authorName =
      story.authorType === ContentAuthorType.SUPPLIER
        ? supplier?.catalogName || supplier?.name || 'Supplier'
        : story.adminAuthorName || MODERATION_CONTENT_ADMIN_AUTHORS[0]

    return {
      id: story.id,
      groupId: getStoryGroupId(story),
      authorType: story.authorType,
      adminAuthorName: story.adminAuthorName,
      supplierId: story.supplierId,
      supplier: supplier
        ? {
            id: supplier.id,
            publicId: supplier.publicId,
            name: supplier.catalogName || supplier.name,
          }
        : null,
      authorName,
      title: story.title,
      location: story.location,
      file: mapFileAsset(fileAssetsById.get(story.fileAssetId)),
      sortOrder: story.sortOrder,
      publishedAt: story.publishedAt?.toISOString() ?? null,
      expiresAt: story.expiresAt?.toISOString() ?? null,
      createdAt: story.createdAt.toISOString(),
    }
  })

  const groupsById = new Map<string, {
    id: string
    authorType: ContentAuthorType
    authorName: string
    supplier: { id: string; publicId: string; name: string } | null
    storyCount: number
    coverFile: ReturnType<typeof mapFileAsset>
    sortOrder: number
    stories: typeof items
  }>()

  for (const story of items) {
    const existing = groupsById.get(story.groupId)

    if (existing) {
      existing.storyCount += 1
      existing.sortOrder = Math.min(existing.sortOrder, story.sortOrder)
      existing.stories.push(story)
      continue
    }

    groupsById.set(story.groupId, {
      id: story.groupId,
      authorType: story.authorType,
      authorName: story.authorName,
      supplier: story.supplier,
      storyCount: 1,
      coverFile: story.file,
      sortOrder: story.sortOrder,
      stories: [story],
    })
  }

  return {
    ok: true,
    lifetimeHours: 24,
    stories: items,
    groups: Array.from(groupsById.values()).sort((left, right) => {
      const orderDiff = left.sortOrder - right.sortOrder
      return orderDiff || left.authorName.localeCompare(right.authorName)
    }),
  }
}

export async function recordPublishedContentStoryView(storyId: string, userId: string) {
  const story = await assertPublishedContentStory(storyId)

  await prisma.contentStoryView.upsert({
    where: {
      storyId_userId: {
        storyId: story.id,
        userId,
      },
    },
    update: {},
    create: {
      storyId: story.id,
      userId,
    },
  })

  return {
    ok: true,
    storyId: story.id,
  }
}

export async function createPublishedContentStoryReaction(
  storyId: string,
  userId: string,
  input: Record<string, unknown>
) {
  const story = await assertPublishedContentStory(storyId)
  const reaction = asText(input.reaction)

  if (!reaction || reaction.length > 24) {
    throw new ModerationContentError(400, 'Reaction is required and must be 24 characters or less')
  }

  await prisma.contentStoryReaction.create({
    data: {
      storyId: story.id,
      userId,
      reaction,
    },
  })

  return {
    ok: true,
    storyId: story.id,
  }
}

export async function createPublishedContentStoryReply(
  storyId: string,
  userId: string,
  input: Record<string, unknown>
) {
  const story = await assertPublishedContentStory(storyId)
  const message = asText(input.message)

  if (!message || message.length > 1000) {
    throw new ModerationContentError(400, 'Reply is required and must be 1000 characters or less')
  }

  await prisma.contentStoryReply.create({
    data: {
      storyId: story.id,
      userId,
      message,
    },
  })

  return {
    ok: true,
    storyId: story.id,
  }
}

export async function createModerationContentStory(
  input: Record<string, unknown>,
  file: Express.Multer.File | undefined
) {
  if (!file) throw new ModerationContentError(400, 'Story file is required')

  const author = validateAuthorInput(input)
  await assertSupplierExists(author.supplierId)
  const fileAsset = await createFileAsset(file, author.supplierId)
  const isActive = asBoolean(input.isActive, true)
  const publishWindow = buildStoryPublishWindow(isActive)

  await prisma.contentStory.create({
    data: {
      authorType: author.authorType,
      adminAuthorName: author.adminAuthorName,
      supplierId: author.supplierId,
      fileAssetId: fileAsset.id,
      title: asText(input.title),
      location: asText(input.location),
      sortOrder: asInteger(input.sortOrder, 0),
      isActive,
      publishedAt: publishWindow.publishedAt,
      expiresAt: publishWindow.expiresAt,
    },
  })

  return getModerationContent()
}

export async function updateModerationContentStory(
  storyId: string,
  input: Record<string, unknown>,
  file: Express.Multer.File | undefined
) {
  const existing = await prisma.contentStory.findUnique({ where: { id: storyId } })
  if (!existing) throw new ModerationContentError(404, 'Story not found', { storyId })

  const author =
    input.authorType === undefined &&
    input.adminAuthorName === undefined &&
    input.supplierId === undefined
      ? null
      : validateAuthorInput({
          authorType: input.authorType ?? existing.authorType,
          adminAuthorName: input.adminAuthorName ?? existing.adminAuthorName,
          supplierId: input.supplierId ?? existing.supplierId,
        })

  if (author?.supplierId) await assertSupplierExists(author.supplierId)

  const fileAsset = file
    ? await createFileAsset(file, author?.supplierId ?? existing.supplierId)
    : null
  const nextIsActive = input.isActive !== undefined
    ? asBoolean(input.isActive, existing.isActive)
    : undefined
  const publishWindow = nextIsActive === undefined
    ? null
    : buildStoryPublishWindow(nextIsActive)

  await prisma.contentStory.update({
    where: { id: storyId },
    data: {
      ...(author
        ? {
            authorType: author.authorType,
            adminAuthorName: author.adminAuthorName,
            supplierId: author.supplierId,
          }
        : {}),
      ...(fileAsset ? { fileAssetId: fileAsset.id } : {}),
      ...(input.title !== undefined ? { title: asText(input.title) } : {}),
      ...(input.location !== undefined ? { location: asText(input.location) } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: asInteger(input.sortOrder, existing.sortOrder) } : {}),
      ...(nextIsActive !== undefined
        ? {
            isActive: nextIsActive,
            publishedAt: publishWindow?.publishedAt ?? null,
            expiresAt: publishWindow?.expiresAt ?? null,
          }
        : {}),
    },
  })

  if (fileAsset) await removeFileAsset(existing.fileAssetId)
  return getModerationContent()
}

export async function republishModerationContentStory(storyId: string) {
  const existing = await prisma.contentStory.findUnique({ where: { id: storyId } })
  if (!existing) throw new ModerationContentError(404, 'Story not found', { storyId })

  const publishWindow = buildStoryPublishWindow(true)

  await prisma.contentStory.update({
    where: { id: storyId },
    data: {
      isActive: true,
      publishedAt: publishWindow.publishedAt,
      expiresAt: publishWindow.expiresAt,
    },
  })

  return getModerationContent()
}

function validateBannerInput(input: Record<string, unknown>, partial = false) {
  const title = asText(input.title)
  const label = asText(input.label) || ContentBannerLabel.NEW
  const bodyText = asText(input.bodyText)
  const lead = asText(input.lead)
  const cta = asText(input.cta)

  if (!partial || title !== null) {
    if (!title) throw new ModerationContentError(400, 'Banner title is required')
    if (title.length > 20) throw new ModerationContentError(400, 'Banner title must be 20 characters or less')
  }

  if (!Object.values(ContentBannerLabel).includes(label as ContentBannerLabel)) {
    throw new ModerationContentError(400, 'Unsupported banner label')
  }

  if (!partial || bodyText !== null) {
    if (!bodyText) throw new ModerationContentError(400, 'Banner body text is required')
  }
  if (!partial || lead !== null) {
    if (!lead) throw new ModerationContentError(400, 'Banner lead is required')
  }
  if (!partial || cta !== null) {
    if (!cta) throw new ModerationContentError(400, 'Banner CTA is required')
  }

  return { title, label, bodyText, lead, cta }
}

export async function createModerationHomeBanner(
  input: Record<string, unknown>,
  file: Express.Multer.File | undefined
) {
  if (!file) throw new ModerationContentError(400, 'Banner image is required')

  const banner = validateBannerInput(input)
  const fileAsset = await createFileAsset(file)

  await prisma.homeBannerContent.create({
    data: {
      title: banner.title!,
      label: banner.label as ContentBannerLabel,
      bodyText: banner.bodyText!,
      lead: banner.lead!,
      cta: banner.cta!,
      fileAssetId: fileAsset.id,
      sortOrder: asInteger(input.sortOrder, 0),
      isActive: asBoolean(input.isActive, true),
    },
  })

  return getModerationContent()
}

export async function updateModerationHomeBanner(
  bannerId: string,
  input: Record<string, unknown>,
  file: Express.Multer.File | undefined
) {
  const existing = await prisma.homeBannerContent.findUnique({ where: { id: bannerId } })
  if (!existing) throw new ModerationContentError(404, 'Banner not found', { bannerId })

  const banner = validateBannerInput(input, true)
  const fileAsset = file ? await createFileAsset(file) : null

  await prisma.homeBannerContent.update({
    where: { id: bannerId },
    data: {
      ...(banner.title !== null ? { title: banner.title } : {}),
      ...(input.label !== undefined ? { label: banner.label as ContentBannerLabel } : {}),
      ...(banner.bodyText !== null ? { bodyText: banner.bodyText } : {}),
      ...(banner.lead !== null ? { lead: banner.lead } : {}),
      ...(banner.cta !== null ? { cta: banner.cta } : {}),
      ...(fileAsset ? { fileAssetId: fileAsset.id } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: asInteger(input.sortOrder, existing.sortOrder) } : {}),
      ...(input.isActive !== undefined ? { isActive: asBoolean(input.isActive, existing.isActive) } : {}),
    },
  })

  if (fileAsset) await removeFileAsset(existing.fileAssetId)
  return getModerationContent()
}

export async function deleteModerationContentStory(storyId: string) {
  const existing = await prisma.contentStory.findUnique({ where: { id: storyId } })
  if (!existing) throw new ModerationContentError(404, 'Story not found', { storyId })

  await prisma.contentStory.delete({ where: { id: storyId } })
  await removeFileAsset(existing.fileAssetId)
  return getModerationContent()
}

export async function deleteModerationHomeBanner(bannerId: string) {
  const existing = await prisma.homeBannerContent.findUnique({ where: { id: bannerId } })
  if (!existing) throw new ModerationContentError(404, 'Banner not found', { bannerId })

  await prisma.homeBannerContent.delete({ where: { id: bannerId } })
  await removeFileAsset(existing.fileAssetId)
  return getModerationContent()
}
