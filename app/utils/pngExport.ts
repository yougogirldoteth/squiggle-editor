const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10]
const maxEncodedLength = 32 * 1024 * 1024
const maxDimension = 8192
const maxPixels = 16_777_216
const invalidPng = 'The sketch returned an invalid PNG.'

/** Validate dimensions before decoding, and keep only chunks that describe pixels. */
export function parsePngExport(value: unknown) {
  const prefix = 'data:image/png;base64,'
  if (typeof value !== 'string' || value.length > maxEncodedLength || !value.startsWith(prefix)) {
    throw new Error(invalidPng)
  }
  const encoded = value.slice(prefix.length)
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) throw new Error(invalidPng)

  let binary: string
  try {
    binary = atob(encoded)
  } catch {
    throw new Error(invalidPng)
  }
  const input = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) input[index] = binary.charCodeAt(index)
  if (input.length < 33 || !pngSignature.every((value, index) => input[index] === value)) throw new Error(invalidPng)

  const view = new DataView(input.buffer)
  if (view.getUint32(8) !== 13 || String.fromCharCode(...input.subarray(12, 16)) !== 'IHDR') throw new Error(invalidPng)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  if (!width || !height) throw new Error(invalidPng)
  if (width > maxDimension || height > maxDimension || width * height > maxPixels) {
    throw new Error('PNG exports must be at most 8192 pixels per side and 16 megapixels in total.')
  }
  const bitDepth = input[24]!
  const colorType = input[25]!
  const depths: Record<number, readonly number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }
  if (!depths[colorType]?.includes(bitDepth) || input[26] !== 0 || input[27] !== 0 || input[28]! > 1) throw new Error(invalidPng)

  const chunks = [input.subarray(0, 8)]
  let offset = 8
  let count = 0
  let paletteEntries = 0
  let transparency = false
  let imageData = false
  let imageDataEnded = false
  let end = false
  while (offset < input.length) {
    if (++count > 16_384 || input.length - offset < 12) throw new Error(invalidPng)
    const length = view.getUint32(offset)
    const next = offset + length + 12
    if (next > input.length) throw new Error(invalidPng)
    const type = String.fromCharCode(...input.subarray(offset + 4, offset + 8))
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type)) throw new Error(invalidPng)
    if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') throw new Error('Animated PNG exports are not supported.')

    let keep = true
    if (type === 'IHDR') {
      if (offset !== 8 || length !== 13) throw new Error(invalidPng)
    } else if (type === 'PLTE') {
      if (paletteEntries || transparency || imageData || !length || length > 768 || length % 3 || colorType === 0 || colorType === 4) throw new Error(invalidPng)
      paletteEntries = length / 3
      if (colorType === 3 && paletteEntries > 2 ** bitDepth) throw new Error(invalidPng)
    } else if (type === 'tRNS') {
      const validLength = (colorType === 0 && length === 2)
        || (colorType === 2 && length === 6)
        || (colorType === 3 && length > 0 && length <= paletteEntries)
      if (transparency || imageData || !validLength) throw new Error(invalidPng)
      transparency = true
    } else if (type === 'IDAT') {
      if (imageDataEnded || (colorType === 3 && !paletteEntries)) throw new Error(invalidPng)
      imageData = true
    } else if (type === 'IEND') {
      if (!imageData || length !== 0 || next !== input.length) throw new Error(invalidPng)
      end = true
    } else {
      if (type[0] === type[0]!.toUpperCase()) throw new Error(invalidPng)
      keep = false
    }
    if (imageData && type !== 'IDAT') imageDataEnded = true
    if (keep) chunks.push(input.subarray(offset, next))
    offset = next
  }
  if (!end) throw new Error(invalidPng)

  const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0))
  let destination = 0
  for (const chunk of chunks) {
    bytes.set(chunk, destination)
    destination += chunk.length
  }
  return { bytes, width, height }
}

/** Never download bytes supplied by the sketch directly, even with a PNG prefix. */
export async function sanitizePngExport(value: unknown): Promise<Blob> {
  const { bytes, width, height } = parsePngExport(value)
  const blob = new Blob([bytes], { type: 'image/png' })
  let bitmap: ImageBitmap | undefined
  let objectUrl: string | undefined
  let canvas: HTMLCanvasElement | undefined
  try {
    let image: CanvasImageSource
    if (typeof createImageBitmap === 'function') {
      bitmap = await createImageBitmap(blob)
      if (bitmap.width !== width || bitmap.height !== height) throw new Error(invalidPng)
      image = bitmap
    } else {
      objectUrl = URL.createObjectURL(blob)
      const element = new Image()
      element.src = objectUrl
      await element.decode()
      if (element.naturalWidth !== width || element.naturalHeight !== height) throw new Error(invalidPng)
      image = element
    }
    canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error(invalidPng)
    context.drawImage(image, 0, 0)
    return await new Promise<Blob>((resolve, reject) => {
      canvas!.toBlob(result => result ? resolve(result) : reject(new Error(invalidPng)), 'image/png')
    })
  } catch {
    throw new Error(invalidPng)
  } finally {
    bitmap?.close()
    if (objectUrl) URL.revokeObjectURL(objectUrl)
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
    }
  }
}
