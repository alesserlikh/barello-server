import fs from 'fs/promises'
import sharp from 'sharp'

export type UploadCropInput = {
  cropX?: unknown
  cropY?: unknown
  cropWidth?: unknown
  cropHeight?: unknown
}

function asFiniteNumber(value: unknown) {
  if (value === undefined || value === null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function parseUploadCrop(input: UploadCropInput) {
  const left = asFiniteNumber(input.cropX)
  const top = asFiniteNumber(input.cropY)
  const width = asFiniteNumber(input.cropWidth)
  const height = asFiniteNumber(input.cropHeight)

  if (left === null && top === null && width === null && height === null) return null
  if (left === null || top === null || width === null || height === null) return null
  if (left < 0 || top < 0 || width <= 0 || height <= 0) return null

  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(width),
    height: Math.round(height),
  }
}

export async function applyImageCropToUpload(
  file: Express.Multer.File | undefined,
  input: UploadCropInput
) {
  const crop = parseUploadCrop(input)
  if (!file || !crop || !file.mimetype.toLowerCase().startsWith('image/')) return

  const metadata = await sharp(file.path).metadata()
  const imageWidth = metadata.width ?? 0
  const imageHeight = metadata.height ?? 0

  if (!imageWidth || !imageHeight) return

  const left = Math.min(crop.left, imageWidth - 1)
  const top = Math.min(crop.top, imageHeight - 1)
  const width = Math.min(crop.width, imageWidth - left)
  const height = Math.min(crop.height, imageHeight - top)

  if (width <= 0 || height <= 0) return

  const output = await sharp(file.path)
    .rotate()
    .extract({ left, top, width, height })
    .toBuffer()

  await fs.writeFile(file.path, output)
  file.size = output.byteLength
}
