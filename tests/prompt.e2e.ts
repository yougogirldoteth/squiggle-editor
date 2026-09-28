import { mkdir } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { applyPromptRecipe } from '../app/utils/promptRecipe'
import { buildGeometry, DEFAULT_HASH, setByte } from '../app/utils/squiggle'

const recipe = { shape: { points: [0, 0, 0.9, -0.6, 0, 0.95, -0.6, 0.1, -0.15, 0.12, -0.1, 0.08, 0.05, 0.05], tallness: 0.9 }, style: 'Slinky', texture: null, color: { startHue: 200, hueSpan: 35, reverse: false, hyper: null } }
const result = applyPromptRecipe(DEFAULT_HASH, recipe)
const hash = (page: Page) => page.locator('#hash')
const toggle = (page: Page) => page.getByRole('button', { name: 'Prompt mode', exact: true })
const field = (page: Page) => page.getByRole('textbox', { name: 'Describe your squiggle' })
const status = (page: Page) => page.locator('#prompt-status')

test.beforeEach(async ({ page }) => {
  // Every automated UI generation is mocked. Live provider checks are explicit.
  await page.route('**/api/prompt', route => route.fulfill({ json: result }))
  await page.goto('/')
  await expect.poll(() => page.locator('.squiggle-canvas__art').evaluate(element => (element as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data[3])).toBe(255)
})

test('generates, refines the current hash, exports and makes one undo step per result', async ({ page }) => {
  const requests: { hash: string; prompt: string }[] = []
  const refined = setByte(result.hash, 5, 20)
  await page.route('**/api/prompt', route => {
    requests.push(route.request().postDataJSON())
    return route.fulfill({ json: { hash: requests.length === 1 ? result.hash : refined, colorLimited: false } })
  })
  await page.getByRole('button', { name: 'Play animation' }).click()
  await toggle(page).click()
  await expect(page.getByRole('button', { name: 'Play animation' })).toHaveAttribute('aria-pressed', 'false')
  await expect(field(page)).toBeFocused()
  await field(page).fill('Two tall loops, only blue')
  expect(requests).toHaveLength(0)
  await field(page).press('Enter')
  await expect(hash(page)).toHaveValue(result.hash)
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(toggle(page)).toBeFocused()
  await toggle(page).click()
  await field(page).fill('Lower the second peak')
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  await expect(hash(page)).toHaveValue(refined)
  expect(requests).toEqual([{ hash: DEFAULT_HASH, prompt: 'Two tall loops, only blue' }, { hash: result.hash, prompt: 'Lower the second peak' }])
  await expect(page).toHaveURL(new RegExp(`hash=${refined}`))
  expect(page.url()).not.toContain('Lower')
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PNG' }).click()
  expect((await pending).suggestedFilename()).toBe(`squiggle-${refined}.png`)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(hash(page)).toHaveValue(result.hash)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(hash(page)).toHaveValue(DEFAULT_HASH)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(hash(page)).toHaveValue(result.hash)
  await field(page).press('Escape')
  await expect(toggle(page)).toBeFocused()
  await toggle(page).click()
  await expect(field(page)).toHaveValue('Lower the second peak')
})

test('cancels pending generations on edits and ignores their late responses', async ({ page }) => {
  let finish!: () => void
  let started!: () => void
  const ready = new Promise<void>(resolve => { started = resolve })
  const gate = new Promise<void>(resolve => { finish = resolve })
  await page.route('**/api/prompt', async route => {
    started()
    await gate
    await route.fulfill({ json: result }).catch(() => {})
  })
  await toggle(page).click()
  await field(page).fill('Make a wave')
  await field(page).press('Enter')
  await ready
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
  await page.getByRole('slider', { name: 'Starting hue' }).focus()
  await page.keyboard.press('ArrowRight')
  const edited = await hash(page).inputValue()
  await expect(status(page)).toContainText('Editing started')
  finish()
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)
  await expect(hash(page)).toHaveValue(edited)
  expect(edited).not.toBe(DEFAULT_HASH)
})

test('starting a point gesture cancels a pending result before the hash even changes', async ({ page }) => {
  let finish!: () => void
  const gate = new Promise<void>(resolve => { finish = resolve })
  await page.route('**/api/prompt', async route => {
    await gate
    await route.fulfill({ json: result }).catch(() => {})
  })
  await toggle(page).click()
  await field(page).fill('A mountain range')
  await field(page).press('Enter')
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
  const box = (await page.locator('.squiggle-canvas__art').boundingBox())!
  const point = buildGeometry(DEFAULT_HASH, box.width, box.height).points.find(point => point.segment === 4 && point.t === 0.5)!
  await page.mouse.move(box.x + point.x, box.y + point.y)
  await page.mouse.down()
  await expect(status(page)).toContainText('Editing started')
  finish()
  await page.mouse.up()
  await expect(hash(page)).toHaveValue(DEFAULT_HASH)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
})

test('hash drafts and held sliders cancel generation before a committed value changes', async ({ page }) => {
  const gates: (() => void)[] = []
  await page.route('**/api/prompt', async route => {
    await new Promise<void>(resolve => { gates.push(resolve) })
    await route.fulfill({ json: result }).catch(() => {})
  })
  await toggle(page).click()
  await field(page).fill('A mountain')
  await field(page).press('Enter')
  await expect.poll(() => gates.length).toBe(1)
  await hash(page).fill('0x123')
  await expect(status(page)).toContainText('Editing started')
  gates[0]!()
  await expect(hash(page)).toHaveValue('0x123')
  await hash(page).fill(DEFAULT_HASH)
  await field(page).press('Enter')
  await expect.poll(() => gates.length).toBe(2)
  const slider = page.getByRole('slider', { name: 'Starting hue' })
  const box = (await slider.boundingBox())!
  const value = Number(await slider.inputValue())
  await page.mouse.move(box.x + 9 + (box.width - 18) * value / 255, box.y + box.height / 2)
  await page.mouse.down()
  await expect(status(page)).toContainText('Editing started')
  await expect(hash(page)).toHaveValue(DEFAULT_HASH)
  gates[1]!()
  await page.mouse.up()
  await expect(hash(page)).toHaveValue(DEFAULT_HASH)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
})

test('Cancel and switching to Draw discard a request without adding undo entries', async ({ page }) => {
  const gates: (() => void)[] = []
  await page.route('**/api/prompt', async route => {
    await new Promise<void>(resolve => { gates.push(resolve) })
    await route.fulfill({ json: result }).catch(() => {})
  })
  await toggle(page).click()
  await field(page).fill('A mountain range')
  await field(page).press('Enter')
  await expect.poll(() => gates.length).toBe(1)
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true })
  await cancel.focus()
  await cancel.press('Enter')
  gates[0]!()
  await expect(status(page)).toContainText('Cancelled')
  await expect(hash(page)).toHaveValue(DEFAULT_HASH)
  await field(page).press('Enter')
  await expect.poll(() => gates.length).toBe(2)
  await page.getByRole('button', { name: 'Draw mode', exact: true }).click()
  gates[1]!()
  await expect(field(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Draw mode', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(hash(page)).toHaveValue(DEFAULT_HASH)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  await toggle(page).click()
  await expect(page.getByRole('button', { name: 'Draw mode', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await expect(field(page)).toHaveValue('A mountain range')
})

test('errors, invalid hashes and unchanged results preserve the artwork and history', async ({ page }) => {
  await toggle(page).click()
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeDisabled()
  await field(page).fill('   ')
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeDisabled()
  for (const response of [
    { status: 503, json: { statusMessage: 'Prompt mode is not available yet.' } },
    { status: 429, json: { statusMessage: 'A few too many prompts. Try again in a minute.' } },
    { status: 200, json: { hash: '<script>alert(1)</script>', colorLimited: false } },
    { status: 200, json: { hash: DEFAULT_HASH, colorLimited: false } },
  ]) {
    await page.route('**/api/prompt', route => route.fulfill(response))
    await field(page).fill(`New prompt ${response.status}`)
    await field(page).press('Enter')
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)
    await expect(status(page)).not.toContainText('Interpreting')
    await expect(hash(page)).toHaveValue(DEFAULT_HASH)
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  }
  await expect(status(page)).toContainText('Already matches')
})

test('preserves button focus for Escape and ignores IME candidate keys', async ({ page }) => {
  let finish!: () => void
  const gate = new Promise<void>(resolve => { finish = resolve })
  let calls = 0
  await page.route('**/api/prompt', async route => {
    calls++
    await gate
    await route.fulfill({ json: result }).catch(() => {})
  })
  await toggle(page).click()
  await field(page).fill('A calm wave')
  await field(page).evaluate(element => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }))
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))
  })
  await expect(field(page)).toBeFocused()
  expect(calls).toBe(0)
  const generate = page.getByRole('button', { name: 'Generate', exact: true })
  await generate.focus()
  await generate.press('Enter')
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true })
  await expect(cancel).toBeFocused()
  await expect.poll(() => calls).toBe(1)
  await page.keyboard.press('Escape')
  finish()
  await expect(status(page)).toContainText('Cancelled')
  await expect(generate).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(field(page)).toHaveCount(0)
  await expect(toggle(page)).toBeFocused()
})

test('supports code highlighting and disables prompting while custom code runs', async ({ page }) => {
  await page.getByRole('button', { name: 'Code mode', exact: true }).click()
  await toggle(page).click()
  await field(page).fill('Only blue')
  await field(page).press('Enter')
  await expect(hash(page)).toHaveValue(result.hash)
  await expect(page.getByRole('textbox', { name: 'JavaScript source' })).toBeVisible()
  const editor = page.getByRole('textbox', { name: 'JavaScript source' })
  await editor.click()
  await editor.press('ControlOrMeta+a')
  await page.keyboard.insertText('function setup() { createCanvas(200, 100); background(120); noLoop(); }')
  await page.getByRole('button', { name: 'Run code', exact: true }).click()
  await expect(field(page)).toHaveCount(0)
  await expect(toggle(page)).toBeDisabled()
  await page.getByRole('button', { name: 'Reset original code', exact: true }).click()
  await expect(toggle(page)).toBeEnabled()
})

for (const [width, height] of [[320, 568], [375, 667], [440, 956], [480, 320], [740, 360], [1440, 900]]) {
  test(`prompt controls fit ${width}×${height}, including code mode`, async ({ page }) => {
    await page.setViewportSize({ width: width!, height: height! })
    await toggle(page).click()
    await field(page).fill('Two tall loops, only blue')
    await field(page).press('Enter')
    await expect(hash(page)).toHaveValue(result.hash)
    for (const withCode of [false, true]) {
      if (withCode) await page.getByRole('button', { name: 'Code mode', exact: true }).click()
      for (const locator of [field(page), page.getByRole('button', { name: 'Try again' }), page.locator('.stage'), page.locator('.canvas-tools')]) {
        const box = (await locator.boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.y).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(width! + 1)
        expect(box.y + box.height).toBeLessThanOrEqual(height! + 1)
      }
      const controls = await page.locator('.play-tools > button').evaluateAll(elements => elements.map(element => {
        const rect = element.getBoundingClientRect()
        return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom }
      }))
      controls.slice(1).forEach((button, i) => {
        expect(button.x).toBeGreaterThanOrEqual(controls[i]!.right)
        expect(button.y).toBe(controls[0]!.y)
      })
      const stage = (await page.locator('.stage').boundingBox())!
      controls.forEach(button => {
        expect(button.x).toBeGreaterThanOrEqual(stage.x)
        expect(button.right).toBeLessThanOrEqual(stage.x + stage.width)
        expect(button.y).toBeGreaterThanOrEqual(stage.y)
        expect(button.bottom).toBeLessThanOrEqual(stage.y + stage.height)
      })
      const swatches = page.locator('.backgrounds')
      if (await swatches.isVisible()) expect((await swatches.boundingBox())!.x).toBeGreaterThanOrEqual(controls.at(-1)!.right)
      const artwork = (await page.locator('.squiggle-canvas__art').boundingBox())!
      expect(artwork.height).toBeGreaterThan(30)
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
      if ([440, 1440].includes(width!)) {
        await mkdir('work', { recursive: true })
        await page.screenshot({ path: `work/prompt-${width}${withCode ? '-code' : ''}.png` })
      }
    }
  })
}
