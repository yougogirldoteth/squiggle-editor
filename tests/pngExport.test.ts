import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { parsePngExport } from '../app/utils/pngExport'

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function chunk(type: string, data = Buffer.alloc(0)) {
  const bytes = Buffer.alloc(data.length + 12)
  bytes.writeUInt32BE(data.length)
  bytes.write(type, 4, 4, 'ascii')
  data.copy(bytes, 8)
  let crc = 0xffffffff
  for (const byte of bytes.subarray(4, -4)) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, bytes.length - 4)
  return bytes
}

function header(width = 1, height = 1, colorType = 6, bitDepth = 8) {
  const bytes = Buffer.alloc(13)
  bytes.writeUInt32BE(width)
  bytes.writeUInt32BE(height, 4)
  bytes[8] = bitDepth
  bytes[9] = colorType
  return chunk('IHDR', bytes)
}

const pixels = chunk('IDAT', deflateSync(Buffer.from([0, 100, 150, 200, 255])))
const end = chunk('IEND')
const png = (...chunks: Buffer[]) => Buffer.concat([signature, ...chunks])
const url = (bytes: Uint8Array) => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`

describe('custom PNG export validation', () => {
  it('preserves a complete static PNG for browser decoding', () => {
    const original = png(header(), pixels, end)
    const parsed = parsePngExport(url(original))
    expect(parsed.width).toBe(1)
    expect(parsed.height).toBe(1)
    expect(Buffer.from(parsed.bytes)).toEqual(original)
  })

  it('removes textual and compressed metadata before the browser decoder sees it', () => {
    const original = png(header(), chunk('tEXt', Buffer.from('Comment\0<script>not image data</script>')), chunk('iCCP', Buffer.from('untrusted compressed profile')), pixels, chunk('zTXt', Buffer.from('compressed text')), end)
    expect(Buffer.from(parsePngExport(url(original)).bytes)).toEqual(png(header(), pixels, end))
  })

  it('retains palette transparency because it affects the image pixels', () => {
    const original = png(header(1, 1, 3), chunk('PLTE', Buffer.from([100, 150, 200])), chunk('tRNS', Buffer.from([128])), chunk('IDAT', deflateSync(Buffer.from([0, 0]))), end)
    expect(Buffer.from(parsePngExport(url(original)).bytes)).toEqual(original)
  })

  it.each([undefined, null, 12, {}, '', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/png;base64,a===', 'data:image/png;base64,%%%%', 'data:image/png;base64,AAAA\n', 'data:image/png;base64,AAA'])('rejects malformed data URLs: %s', value => {
    expect(() => parsePngExport(value)).toThrow('invalid PNG')
  })

  it('rejects oversized encoded input before decoding it', () => {
    expect(() => parsePngExport('data:image/png;base64,' + 'A'.repeat(32 * 1024 * 1024))).toThrow('invalid PNG')
  })

  it('rejects a PNG signature followed by arbitrary content', () => {
    expect(() => parsePngExport(url(Buffer.concat([signature, Buffer.from('<script>not a PNG</script>')])))).toThrow('invalid PNG')
  })

  it.each([[0, 1], [1, 0], [8193, 1], [1, 8193], [4097, 4096], [0xffffffff, 0xffffffff]])('rejects unsafe dimensions %s × %s before pixel decoding', (width, height) => {
    expect(() => parsePngExport(url(png(header(width, height), pixels, end)))).toThrow()
  })

  it('accepts the maximum dimension and pixel limits for later browser decoding', () => {
    expect(parsePngExport(url(png(header(8192, 2048), pixels, end)))).toMatchObject({ width: 8192, height: 2048 })
  })

  it.each([
    [pixels, end],
    [header(), end],
    [header(), pixels],
    [header(), header(), pixels, end],
    [header(), pixels, end, chunk('tEXt')],
    [header(), pixels, chunk('tEXt'), pixels, end],
    [header(), chunk('ABCD'), pixels, end],
    [header(), chunk('1234'), pixels, end],
    [header(1, 1, 3), pixels, end],
    [header(1, 1, 6, 1), pixels, end],
    [header(), chunk('tRNS', Buffer.from([0])), pixels, end],
  ])('rejects malformed or incomplete PNG chunk structure %#', (...chunks) => {
    expect(() => parsePngExport(url(png(...chunks)))).toThrow('invalid PNG')
  })

  it('rejects truncated chunks and any data after IEND', () => {
    const original = png(header(), pixels, end)
    expect(() => parsePngExport(url(original.subarray(0, -1)))).toThrow('invalid PNG')
    expect(() => parsePngExport(url(Buffer.concat([original, Buffer.from('<script>trailing data</script>')])))).toThrow('invalid PNG')
    const impossibleLength = Buffer.from(original)
    impossibleLength.writeUInt32BE(0xffffffff, 33)
    expect(() => parsePngExport(url(impossibleLength))).toThrow('invalid PNG')
  })

  it.each(['acTL', 'fcTL', 'fdAT'])('rejects animated PNG chunk %s before decoding frames', type => {
    expect(() => parsePngExport(url(png(header(), chunk(type), pixels, end)))).toThrow('Animated PNG')
  })

  it('bounds the number of chunks even when they are individually small', () => {
    expect(() => parsePngExport(url(png(header(), ...Array.from({ length: 16_384 }, () => chunk('tEXt')), pixels, end)))).toThrow('invalid PNG')
  })
})
