import { mkdir, readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { DEFAULT_HASH, parseHash } from '../app/utils/squiggle'

const hashInput = (page: Page) => page.getByRole('textbox', { name: 'Hash' })
const drawButton = (page: Page) => page.getByRole('button', { name: 'Draw mode', exact: true })
const surface = (page: Page) => page.getByRole('application', { name: 'Draw a squiggle', exact: true })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect.poll(() => page.locator('.squiggle-canvas__art').evaluate(element => (element as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data[3])).toBe(255)
})

async function startStroke(page: Page, variant = 0) {
  const rect = (await surface(page).boundingBox())!
  const points = Array.from({ length: 37 }, (_, i) => ({
    x: rect.x + rect.width * (0.12 + 0.76 * i / 36),
    y: rect.y + rect.height * (0.5 + 0.22 * Math.sin(i / 36 * Math.PI * (6 + variant))),
  }))
  await page.mouse.move(points[0]!.x, points[0]!.y)
  await page.mouse.down()
  for (const point of points.slice(1)) await page.mouse.move(point.x, point.y)
  return points
}

test('draws on release, preserves style, exports a clean image and makes one undo step', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('button', { name: 'Play animation' }).click()
  await drawButton(page).click()
  await expect(page.getByRole('button', { name: 'Play animation' })).toHaveAttribute('aria-pressed', 'false')
  await expect(surface(page)).toBeFocused()
  await startStroke(page)
  await expect(hashInput(page)).toHaveValue(DEFAULT_HASH)
  await expect(page.locator('.draw-stroke')).toBeVisible()
  await page.mouse.up()
  await expect(hashInput(page)).not.toHaveValue(DEFAULT_HASH)
  await expect(page.locator('.draw-comparison')).toBeVisible()
  const fitted = await hashInput(page).inputValue()
  const before = parseHash(DEFAULT_HASH), after = parseHash(fitted)
  for (let i = 21; i < 32; i++) if (i !== 26 && i !== 27) expect(after[i]).toBe(before[i])
  await expect(page).toHaveURL(new RegExp(`hash=${fitted}`))
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PNG' }).click()
  const download = await pending
  expect(download.suggestedFilename()).toBe(`squiggle-${fitted}.png`)
  const png = await readFile((await download.path())!)
  expect(png.readUInt32BE(16)).toBe(3000)
  expect(png.readUInt32BE(20)).toBe(2000)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(hashInput(page)).toHaveValue(DEFAULT_HASH)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(hashInput(page)).toHaveValue(fitted)
  await drawButton(page).click()
  await expect(surface(page)).toHaveCount(0)
  await expect(page.locator('.squiggle-canvas__guides')).toHaveCount(0)
  const cleanDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PNG' }).click()
  expect(await readFile((await (await cleanDownload).path())!)).toEqual(png)
  await page.reload()
  await expect(hashInput(page)).toHaveValue(fitted)
  expect(errors).toEqual([])
})

test('taps and vertical strokes do not edit; Escape cancels a stroke and then closes Draw', async ({ page }) => {
  await drawButton(page).click()
  await surface(page).click({ position: { x: 80, y: 80 } })
  await expect(hashInput(page)).toHaveValue(DEFAULT_HASH)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  const rect = (await surface(page).boundingBox())!
  await page.mouse.move(rect.x + 80, rect.y + 60)
  await page.mouse.down()
  await page.mouse.move(rect.x + 80, rect.y + 200, { steps: 10 })
  await page.mouse.up()
  await expect(hashInput(page)).toHaveValue(DEFAULT_HASH)
  await startStroke(page)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(hashInput(page)).toHaveValue(DEFAULT_HASH)
  await expect(surface(page)).toBeVisible()
  await expect(page.locator('.draw-stroke')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(drawButton(page)).toHaveAttribute('aria-pressed', 'false')
  await expect(drawButton(page)).toBeFocused()
})

test('each drawing is a separate edit and undo first cancels an unfinished stroke', async ({ page }) => {
  await drawButton(page).click()
  await startStroke(page)
  await page.mouse.up()
  const first = await hashInput(page).inputValue()
  await startStroke(page, 2)
  await page.mouse.up()
  const second = await hashInput(page).inputValue()
  expect(second).not.toBe(first)
  await startStroke(page, 4)
  await page.keyboard.press('Control+z')
  await page.mouse.up()
  await expect(hashInput(page)).toHaveValue(second)
  await page.keyboard.press('Control+z')
  await expect(hashInput(page)).toHaveValue(first)
  await page.keyboard.press('Control+z')
  await expect(hashInput(page)).toHaveValue(DEFAULT_HASH)
})

test('resize, blur, lost capture and changes to controls discard unfinished strokes', async ({ page }) => {
  await drawButton(page).click()
  for (const interruption of ['resize', 'blur', 'capture', 'control']) {
    await startStroke(page)
    if (interruption === 'resize') await page.setViewportSize({ width: 1250, height: 780 })
    if (interruption === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    if (interruption === 'capture') await surface(page).evaluate(element => {
      for (let id = 1; id < 10; id++) if (element.hasPointerCapture(id)) element.releasePointerCapture(id)
    })
    if (interruption === 'control') {
      await page.getByRole('slider', { name: 'Starting hue' }).focus()
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('Tab')
    }
    await expect(page.locator('.draw-stroke')).toHaveCount(0)
    const retained = await hashInput(page).inputValue()
    await page.mouse.up()
    await expect(hashInput(page)).toHaveValue(retained)
    if (interruption !== 'control') expect(retained).toBe(DEFAULT_HASH)
  }
})

test('pointer capture finishes a stroke outside the canvas and a new stroke still works', async ({ page }) => {
  await drawButton(page).click()
  await startStroke(page)
  await page.mouse.move(20, 20)
  await page.mouse.up()
  await expect(hashInput(page)).not.toHaveValue(DEFAULT_HASH)
  const first = await hashInput(page).inputValue()
  await startStroke(page, 2)
  await page.mouse.up()
  await expect(hashInput(page)).not.toHaveValue(first)
})

test('Draw works with the original code pane, but is disabled for a custom running script', async ({ page }) => {
  await page.getByRole('button', { name: 'Code mode' }).click()
  const code = page.locator('.cm-content')
  await expect(code).toBeVisible()
  await drawButton(page).click()
  await startStroke(page)
  await page.mouse.up()
  await expect(hashInput(page)).not.toHaveValue(DEFAULT_HASH)
  await code.fill('function setup() { createCanvas(100, 100); background(200); noLoop(); }')
  await page.getByRole('button', { name: 'Run code', exact: true }).click()
  await expect(drawButton(page)).toBeDisabled()
  await expect(surface(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'Reset original code', exact: true }).click()
  await expect(drawButton(page)).toBeEnabled()
})

test('drawing tools fit narrow and landscape layouts with and without code', async ({ page }) => {
  test.setTimeout(120_000)
  await mkdir('work', { recursive: true })
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 940, height: 768 }, { width: 901, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 568, height: 320 }, { width: 480, height: 320 }]) {
    await page.setViewportSize(viewport)
    for (const code of [false, true]) {
      const toggle = page.getByRole('button', { name: 'Code mode' })
      if (await toggle.getAttribute('aria-pressed') !== String(code)) await toggle.click()
      if (await drawButton(page).getAttribute('aria-pressed') !== 'true') await drawButton(page).click()
      const tools = await page.locator('.canvas-tools button:visible').evaluateAll(elements => elements.map(element => {
        const rect = element.getBoundingClientRect()
        return { label: element.getAttribute('aria-label'), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
      }))
      for (const [i, a] of tools.entries()) {
        expect(a.left).toBeGreaterThanOrEqual(0)
        expect(a.right).toBeLessThanOrEqual(viewport.width)
        expect(a.bottom).toBeLessThanOrEqual(viewport.height)
        for (const b of tools.slice(i + 1)) expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, `${a.label} overlaps ${b.label} at ${viewport.width}, code=${code}`).toBe(true)
      }
      await startStroke(page)
      await page.mouse.up()
      await expect(page.locator('.draw-overlay')).toHaveClass(/is-fitted/)
      await page.waitForTimeout(200)
      await page.screenshot({ path: `work/draw-${viewport.width}-${viewport.height}${code ? '-code' : ''}.png` })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true)
    }
  }
})

test('Escape belongs to the code editor while it has focus, and View playback leaves Draw', async ({ page }) => {
  await page.getByRole('button', { name: 'Code mode' }).click()
  await drawButton(page).click()
  const code = page.getByRole('textbox', { name: 'JavaScript source' })
  await code.click()
  await code.press('ControlOrMeta+f')
  await expect(page.locator('.cm-search')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.cm-search')).toHaveCount(0)
  await expect(drawButton(page)).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('tab', { name: 'View', exact: true }).click()
  const art = page.locator('.squiggle-canvas__art')
  const originalPixels = await art.evaluate(element => (element as HTMLCanvasElement).toDataURL())
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(drawButton(page)).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => art.evaluate(element => (element as HTMLCanvasElement).toDataURL())).not.toBe(originalPixels)
})

test('native phone touch fits on release, cancels interruptions, and does not scroll', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
  try {
    const page = await context.newPage()
    await page.goto('/')
    await expect.poll(() => page.locator('.squiggle-canvas__art').evaluate(element => (element as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data[3])).toBe(255)
    await drawButton(page).tap()
    const session = await context.newCDPSession(page)
    const rect = (await surface(page).boundingBox())!
    for (const cancel of [true, false]) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x + 30, y: rect.y + rect.height / 2, id: 1 }] })
      await page.waitForTimeout(60)
      for (let i = 1; i <= 20; i++) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: rect.x + 30 + (rect.width - 60) * i / 20, y: rect.y + rect.height * (0.5 + 0.2 * Math.sin(i / 20 * Math.PI * 6)), id: 1 }] })
        await page.waitForTimeout(16)
      }
      await expect(hashInput(page)).toHaveValue(DEFAULT_HASH)
      await page.waitForTimeout(32)
      await session.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] })
      if (cancel) await expect(hashInput(page)).toHaveValue(DEFAULT_HASH)
      else await expect(hashInput(page)).not.toHaveValue(DEFAULT_HASH)
    }
    await expect(page.locator('.draw-comparison')).toHaveCSS('animation-name', 'none')
    await expect(page.locator('.draw-comparison')).toHaveCount(0, { timeout: 3000 })
    await page.getByRole('button', { name: 'Undo', exact: true }).tap()
    await expect(hashInput(page)).toHaveValue(DEFAULT_HASH)
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 })
  } finally { await context.close() }
})
