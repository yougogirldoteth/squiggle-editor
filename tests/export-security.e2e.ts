import { expect, test, type Page } from '@playwright/test'

async function runCustom(page: Page, source: string) {
  await page.goto('/?code=1')
  const editor = page.getByRole('textbox', { name: 'JavaScript source' })
  await editor.click()
  await editor.press('ControlOrMeta+a')
  await page.keyboard.insertText(source)
  await page.getByRole('button', { name: 'Run code', exact: true }).click()
  await expect(page.frameLocator('iframe').locator('canvas')).toBeVisible()
}

const sketch = (extra = '') => `function setup() {
  pixelDensity(1);
  createCanvas(3, 2);
  background(12, 34, 56);
  noLoop();
  ${extra}
}`

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer) {
  const result = Buffer.alloc(12 + data.length)
  result.writeUInt32BE(data.length, 0)
  result.write(type, 4, 'ascii')
  data.copy(result, 8)
  result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4)
  return result
}

function pngChunks(bytes: Buffer) {
  const types: string[] = []
  for (let offset = 8; offset < bytes.length;) {
    types.push(bytes.toString('ascii', offset + 4, offset + 8))
    offset += bytes.readUInt32BE(offset) + 12
  }
  return types
}

// Keep every browser probe confined to this editor and its bundled runtime.
test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.origin === origin || ['data:', 'blob:'].includes(url.protocol) ? route.continue() : route.abort()
  })
})

test('custom export rejects a PNG signature followed by arbitrary non-image bytes', async ({ page }) => {
  const downloads: string[] = []
  page.on('download', download => downloads.push(download.suggestedFilename()))
  const payload = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('<html>not an image</html>')])
  await runCustom(page, sketch(`document.querySelector('canvas').toDataURL = () => ${JSON.stringify(`data:image/png;base64,${payload.toString('base64')}`)};`))
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click()
  await expect(page.locator('.toast[role="status"]')).toContainText(/invalid PNG/i)
  expect(downloads).toEqual([])
})

test('custom export removes PNG metadata while preserving the rendered pixels', async ({ page }) => {
  await runCustom(page, sketch())
  const original = await page.frameLocator('iframe').locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL('image/png'))
  const png = Buffer.from(original.split(',')[1]!, 'base64')
  const marker = 'Export-test-comment\0This must not reach the downloaded file.'
  const modified = Buffer.concat([png.subarray(0, 33), chunk('tEXt', Buffer.from(marker)), png.subarray(33)])
  await page.frameLocator('iframe').locator('canvas').evaluate((canvas, data) => {
    (canvas as HTMLCanvasElement).toDataURL = () => data
  }, `data:image/png;base64,${modified.toString('base64')}`)
  const exportHash = await page.getByRole('textbox', { name: 'Hash', exact: true }).inputValue()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(`squiggle-custom-${exportHash}.png`)
  const stream = await download.createReadStream()
  const parts: Buffer[] = []
  for await (const part of stream!) parts.push(Buffer.from(part))
  const clean = Buffer.concat(parts)
  expect(pngChunks(clean)).not.toContain('tEXt')
  expect(clean.includes(Buffer.from(marker))).toBe(false)
  const pixels = await page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0)
    const result = { width: canvas.width, height: canvas.height, data: [...context.getImageData(0, 0, canvas.width, canvas.height).data] }
    bitmap.close()
    return result
  }, clean.toString('base64'))
  expect(pixels).toEqual({ width: 3, height: 2, data: Array.from({ length: 6 }, () => [12, 34, 56, 255]).flat() })
})

test('custom export rejects oversized PNG dimensions before browser decoding', async ({ page }) => {
  const downloads: string[] = []
  page.on('download', download => downloads.push(download.suggestedFilename()))
  await runCustom(page, sketch())
  const original = await page.frameLocator('iframe').locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL('image/png'))
  const png = Buffer.from(original.split(',')[1]!, 'base64')
  png.writeUInt32BE(0x7fffffff, 16)
  png.writeUInt32BE(0x7fffffff, 20)
  png.writeUInt32BE(crc32(png.subarray(12, 29)), 29)
  await page.frameLocator('iframe').locator('canvas').evaluate((canvas, data) => {
    (canvas as HTMLCanvasElement).toDataURL = () => data
  }, `data:image/png;base64,${png.toString('base64')}`)
  await page.evaluate(() => {
    const original = window.createImageBitmap
    ;(window as any).exportBitmapCalls = 0
    window.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) => {
      ;(window as any).exportBitmapCalls++
      return original(...args)
    }) as typeof createImageBitmap
  })
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click()
  await expect(page.locator('.toast[role="status"]')).toContainText(/PNG/i)
  expect(await page.evaluate(() => (window as any).exportBitmapCalls)).toBe(0)
  expect(downloads).toEqual([])
})

test('resetting custom code cancels an export already waiting on image decoding', async ({ page }) => {
  const downloads: string[] = []
  page.on('download', download => downloads.push(download.suggestedFilename()))
  await runCustom(page, sketch())
  await page.evaluate(() => {
    const original = window.createImageBitmap
    ;(window as any).exportBitmapCalls = 0
    window.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) => new Promise<ImageBitmap>((resolve, reject) => {
      ;(window as any).exportBitmapCalls++
      ;(window as any).releaseExportBitmap = () => original(...args).then(resolve, reject)
    })) as typeof createImageBitmap
    const encode = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      return encode.call(this, result => {
        callback(result)
        queueMicrotask(() => { (window as any).exportEncodeFinished = true })
      }, ...args)
    }
  })
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click()
  await page.waitForFunction(() => typeof (window as any).releaseExportBitmap === 'function')
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click()
  await expect(page.locator('.toast[role="status"]')).toContainText(/already in progress/i)
  expect(await page.evaluate(() => (window as any).exportBitmapCalls)).toBe(1)
  await page.getByRole('button', { name: 'Reset original code', exact: true }).click()
  await expect(page.locator('iframe')).toHaveCount(0)
  await expect(page.locator('.toast[role="status"]')).toContainText(/preview was closed/i)
  await page.evaluate(async () => { await (window as any).releaseExportBitmap() })
  // Observe completion instead of racing the asynchronous PNG encoder.
  await page.waitForFunction(() => (window as any).exportEncodeFinished === true)
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
  expect(downloads).toEqual([])
  await expect(page.getByRole('application', { name: 'Squiggle canvas' })).toBeVisible()
})
