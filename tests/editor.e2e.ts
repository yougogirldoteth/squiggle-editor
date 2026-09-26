import { mkdir, readFile } from 'node:fs/promises'
import { expect, test as base, type Locator, type Page } from '@playwright/test'
import { buildGeometry, decodeHash, DEFAULT_HASH, dragCurve, nearestCurvePoint, setByte, setType, toHash, TYPES } from '../app/utils/squiggle'

const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [async ({ page }, use) => {
    const errors = watchErrors(page)
    await use(errors)
    expect(errors, 'No uncaught browser or console errors').toEqual([])
  }, { auto: true }],
})

function watchErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  return errors
}

const artworkHash = (page: Page) => page.getByRole('textbox', { name: 'Hash' })
const artwork = (page: Page) => page.getByRole('application', { name: 'Squiggle canvas' })

async function openEditor(page: Page) {
  await page.goto('/')
  await expect(artwork(page)).toBeVisible()
  await expect(artworkHash(page)).toHaveValue(DEFAULT_HASH)
  // SSR already contains the controls. Wait for the mounted canvas to paint
  // before sending input, so hydration cannot discard the first interaction.
  await expect.poll(() => artwork(page).evaluate(element =>
    (element as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data[3],
  )).toBe(255)
  await settleCanvas(page)
}

async function settleCanvas(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

async function beginHueRoll(page: Page, value: number) {
  return page.getByRole('slider', { name: 'Starting hue' }).evaluate(async (element, nextValue) => {
    const input = element as HTMLInputElement
    input.value = String(nextValue)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
    const nativeValue = (document.getElementById('hash') as HTMLTextAreaElement).value
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const root = document.querySelector('.hash-input')!
    const slots = Array.from(root.querySelectorAll('.hash-input__slot'))
    const animations = root.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running' || animation.pending)
    const animatedSlots = [...new Set(animations.map(animation => {
      const target = (animation.effect as KeyframeEffect).target as Element
      return slots.indexOf(target.closest('.hash-input__slot')!)
    }))].sort((a, b) => a - b)
    // Inspect the actual in-flight roll without relying on driver timing versus
    // a short CSS duration. Focusing the field cancels these paused animations.
    animations.forEach(animation => animation.pause())
    return {
      nativeValue,
      currentText: slots.map(slot => slot.querySelector('.hash-input__current')!.textContent).join(''),
      rollingSlots: slots.flatMap((slot, index) => slot.classList.contains('is-rolling') ? [index] : []),
      animatedSlots,
      animationCount: animations.length,
    }
  }, value)
}

async function curvePosition(page: Page) {
  const bounds = (await artwork(page).boundingBox())!
  const hash = await artworkHash(page).inputValue()
  const geometry = buildGeometry(hash, bounds.width, bounds.height)
  const point = geometry.points.find(point => point.segment === 4 && Math.abs(point.t - 0.5) < 0.00001)!
  return { x: bounds.x + point.x, y: bounds.y + point.y }
}

async function canvasPixels(page: Page) {
  await settleCanvas(page)
  return artwork(page).evaluate(element => (element as HTMLCanvasElement).toDataURL('image/png'))
}

function changedBytes(before: string, after: string) {
  const original = decodeHash(before).bytes
  return decodeHash(after).bytes.flatMap((value, index) => value === original[index] ? [] : [index])
}

async function downloadPng(page: Page, saveName?: string) {
  const pendingDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PNG' }).click()
  const download = await pendingDownload
  expect(download.suggestedFilename()).toBe('squiggle.png')
  const png = await readFile((await download.path())!)
  expect(png.subarray(1, 4).toString()).toBe('PNG')
  expect(png.readUInt32BE(16)).toBe(3000)
  expect(png.readUInt32BE(20)).toBe(2000)
  if (saveName) {
    await mkdir('work', { recursive: true })
    await download.saveAs(`work/${saveName}`)
  }
  return png
}

async function pngInkBounds(page: Page, png: Buffer) {
  return page.evaluate(async (url) => {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1, ink = 0
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const offset = (y * canvas.width + x) * 4
        if (pixels[offset] === 255 && pixels[offset + 1] === 255 && pixels[offset + 2] === 255) continue
        minX = Math.min(minX, x); minY = Math.min(minY, y)
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
        ink++
      }
    }
    return { minX, minY, maxX, maxY, ink }
  }, `data:image/png;base64,${png.toString('base64')}`)
}

test('essential controls fit desktop, narrow phones, and phone landscape without page scrolling', async ({ page }) => {
  test.setTimeout(180_000)
  await mkdir('work', { recursive: true })
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 768, height: 768 },
    { width: 360, height: 640 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 320, height: 568 },
    { width: 480, height: 320 },
    { width: 568, height: 320 },
    { width: 640, height: 360 },
    { width: 667, height: 375 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    await openEditor(page)
    const overflow = await page.evaluate(() => ({
      x: document.documentElement.scrollWidth - innerWidth,
      y: document.documentElement.scrollHeight - innerHeight,
    }))
    expect(overflow, `${viewport.width} × ${viewport.height}`).toEqual({ x: 0, y: 0 })
    for (const type of TYPES) await expect(page.getByRole('button', { name: type, exact: true })).toBeInViewport({ ratio: 1 })
    for (const name of ['Starting hue', 'Color spread']) await expect(page.getByRole('slider', { name })).toBeInViewport({ ratio: 1 })
    for (const name of ['Reverse', 'Hyper', 'Copy hash', 'Export PNG', 'Play animation', 'Reset squiggle', 'White background', 'Gray background', 'Dark background']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 })
    }
    await expect(artworkHash(page)).toBeInViewport({ ratio: 1 })
    const hashField = await artworkHash(page).evaluate(element => ({
      length: (element as HTMLInputElement | HTMLTextAreaElement).value.length,
      overflowX: element.scrollWidth - element.clientWidth,
      overflowY: element.scrollHeight - element.clientHeight,
    }))
    expect(hashField.length).toBe(66)
    expect(hashField.overflowX, 'Every hash character fits horizontally').toBeLessThanOrEqual(1)
    expect(hashField.overflowY, 'Every hash line fits vertically').toBeLessThanOrEqual(1)
    await expect(page.locator('footer')).toHaveCount(0)
    await expect(page.getByRole('contentinfo')).toHaveCount(0)
    const hashBounds = (await page.locator('.hash-section').boundingBox())!
    const controlsBounds = (await page.getByRole('region', { name: 'Editor controls' }).boundingBox())!
    const canvasBounds = (await artwork(page).boundingBox())!
    expect(hashBounds.y + hashBounds.height, 'Hash appears above the parameter controls').toBeLessThanOrEqual(controlsBounds.y + 1)
    expect(hashBounds.y + hashBounds.height, 'Hash appears above the artwork').toBeLessThanOrEqual(canvasBounds.y + 1)
    const overlay = page.locator('.hash-input__overlay')
    await expect(overlay).toBeVisible()
    const visualHash = await overlay.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      const slots = Array.from(element.querySelectorAll('.hash-input__slot'))
      return {
        value: slots.map(slot => slot.querySelector('.hash-input__current')!.textContent).join(''),
        clipped: slots.flatMap((slot, index) => {
          const rect = slot.getBoundingClientRect()
          return rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1 ? [index] : []
        }),
      }
    })
    expect(visualHash.value).toBe(DEFAULT_HASH)
    expect(visualHash.clipped, 'Every animated hash character fits its field').toEqual([])
    if (viewport.width > 650) {
      const heading = (await page.locator('.type-heading').boundingBox())!
      const tabs = (await page.getByRole('tablist', { name: 'Parameters' }).boundingBox())!
      expect(Math.abs(heading.y - tabs.y), 'Type and Parameters start on the same row').toBeLessThanOrEqual(1)
      expect(Math.abs(heading.height - tabs.height), 'Type and Parameters have aligned baselines').toBeLessThanOrEqual(1)
    }
    await expect.poll(async () => page.getByRole('complementary', { name: 'Squiggle type' }).locator('canvas.type-preview').evaluateAll(elements => elements.map(element => {
      const preview = element as HTMLCanvasElement
      const data = preview.getContext('2d')!.getImageData(0, 0, preview.width, preview.height).data
      let colored = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3]! > 0 && Math.max(data[i]!, data[i + 1]!, data[i + 2]!) - Math.min(data[i]!, data[i + 1]!, data[i + 2]!) > 20) colored++
      }
      const bounds = preview.getBoundingClientRect()
      return colored > 0 && bounds.width > 0 && bounds.height > 0
    })), { message: 'All six type previews render real colored artwork' }).toEqual([true, true, true, true, true, true])
    expect(await page.locator('canvas.type-preview').evaluateAll(elements => elements.map(element => element.getAttribute('title')?.match(/#(\d+)/)?.[1]))).toEqual(['0', '20', '5', '10', '74', '7'])
    await expect(artwork(page)).toBeInViewport({ ratio: 1 })
    const bounds = (await artwork(page).boundingBox())!
    expect(bounds.width).toBeGreaterThan(200)
    expect(bounds.height).toBeGreaterThan(viewport.height <= 320 ? 120 : viewport.width > viewport.height ? 160 : 180)
    if (viewport.width === 1440) await page.screenshot({ path: 'work/polish-desktop.png' })
    for (const [tab, labels] of [
      ['Color', ['Starting hue', 'Color spread']],
      ['Shape', ['Length', 'Height', 'Point height']],
      ['Texture', ['Spacing', 'Rib color']],
      ['View', ['Speed', 'Background']],
    ] as const) {
      await page.getByRole('tab', { name: tab, exact: true }).click()
      const panel = page.getByRole('tabpanel', { name: tab, exact: true })
      await expect(panel).toBeInViewport({ ratio: 1 })
      expect(await panel.locator('input[type="range"]').evaluateAll(inputs => inputs.map(input => input.getAttribute('aria-label')))).toEqual(labels)
      const clippedControls = await panel.locator('input, button').evaluateAll(elements => elements.filter(element => {
        const rect = element.getBoundingClientRect()
        return rect.width <= 0 || rect.height <= 0 || rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight
      }).map(element => element.getAttribute('aria-label') || element.textContent))
      expect(clippedControls, `${tab} controls at ${viewport.width} × ${viewport.height}`).toEqual([])
      expect(await page.evaluate(() => [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight])).toEqual([0, 0])
      if (tab === 'Shape' && viewport.width === 390) await page.screenshot({ path: 'work/polish-mobile.png' })
      if (tab === 'Shape' && viewport.width === 320) await page.screenshot({ path: 'work/polish-small.png' })
    }
  }
})

test('hash rolling animates only changed characters while the native value updates immediately', async ({ page }) => {
  await openEditor(page)
  const hue = decodeHash(DEFAULT_HASH).bytes[29]! + 1
  const expected = setByte(DEFAULT_HASH, 29, hue)
  const changedCharacters = Array.from(expected).flatMap((character, index) => character === DEFAULT_HASH[index] ? [] : [index])
  const roll = await beginHueRoll(page, hue)
  expect(roll.nativeValue).toBe(expected)
  expect(roll.currentText).toBe(expected)
  expect(roll.rollingSlots).toEqual(changedCharacters)
  expect(roll.animatedSlots).toEqual(changedCharacters)
  expect(roll.animationCount).toBe(changedCharacters.length * 2)
  await artworkHash(page).focus()
})

test('hash rolling rapid changes keep the latest value without queued old rolls', async ({ page }) => {
  await openEditor(page)
  const values = [110, 251, 172, 33]
  const result = await page.getByRole('slider', { name: 'Starting hue' }).evaluate(async (element, nextValues) => {
    const input = element as HTMLInputElement
    const native = document.getElementById('hash') as HTMLTextAreaElement
    const root = document.querySelector('.hash-input')!
    const frames: { native: string; visual: string; active: number }[] = []
    for (const value of nextValues) {
      input.value = String(value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
      frames.push({
        native: native.value,
        visual: Array.from(root.querySelectorAll('.hash-input__current'), node => node.textContent).join(''),
        active: root.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running' || animation.pending).length,
      })
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    }
    await Promise.all(root.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => undefined)))
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    return {
      frames,
      native: native.value,
      visual: Array.from(root.querySelectorAll('.hash-input__current'), node => node.textContent).join(''),
      active: root.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running' || animation.pending).length,
      opacity: Array.from(root.querySelectorAll('.hash-input__current'), node => getComputedStyle(node).opacity),
    }
  }, values)
  result.frames.forEach((frame, index) => {
    const expected = setByte(DEFAULT_HASH, 29, values[index]!)
    expect(frame.native).toBe(expected)
    expect(frame.visual).toBe(expected)
    expect(frame.active, 'At most two changing hex digits have an outgoing and incoming glyph').toBeLessThanOrEqual(4)
  })
  const latest = setByte(DEFAULT_HASH, 29, values.at(-1)!)
  expect(result.native).toBe(latest)
  expect(result.visual).toBe(latest)
  expect(result.active).toBe(0)
  expect(result.opacity.every(opacity => opacity === '1')).toBe(true)
})

test('hash rolling stops while focusing, typing, and importing through the native field', async ({ page }) => {
  await openEditor(page)
  const roll = await beginHueRoll(page, 106)
  expect(roll.animationCount).toBeGreaterThan(0)
  await artworkHash(page).focus()
  await expect(page.locator('.hash-input__overlay')).toHaveCount(0)
  expect(await page.locator('.hash-input').evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running' || animation.pending).length)).toBe(0)
  const imported = setByte(DEFAULT_HASH, 9, 73)
  await artworkHash(page).fill(imported)
  await expect(artworkHash(page)).toHaveValue(imported)
  await expect(page.locator('.hash-input__overlay')).toHaveCount(0)
  await artworkHash(page).press('Enter')
  await expect(artworkHash(page)).toHaveValue(imported)
  await expect(artworkHash(page)).toHaveAttribute('aria-invalid', 'false')
  await expect(page.locator('.hash-input__overlay')).toHaveCount(0)
  await page.getByRole('tab', { name: 'Color', exact: true }).focus()
  await expect(page.locator('.hash-input__overlay')).toBeVisible()
  expect(await page.locator('.hash-input__current').allTextContents()).toEqual(Array.from(imported))
  expect(await page.locator('.hash-input').evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running' || animation.pending).length)).toBe(0)
})

test('hash rolling respects reduced motion and keeps native editing available', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openEditor(page)
  await page.getByRole('slider', { name: 'Starting hue' }).press('End')
  await expect(artworkHash(page)).toHaveValue(setByte(DEFAULT_HASH, 29, 255))
  await expect(page.locator('.hash-input__overlay')).toHaveCount(0)
  const nativeState = await artworkHash(page).evaluate(element => ({
    color: getComputedStyle(element).color,
    masked: element.classList.contains('is-masked'),
    animations: element.closest('.hash-input')!.getAnimations({ subtree: true }).length,
  }))
  expect(nativeState.masked).toBe(false)
  expect(nativeState.color).not.toBe('rgba(0, 0, 0, 0)')
  expect(nativeState.animations).toBe(0)
  await artworkHash(page).fill(DEFAULT_HASH)
  await artworkHash(page).press('Enter')
  await expect(artworkHash(page)).toHaveValue(DEFAULT_HASH)
})

test('hash rolling does not animate the initial hash restored from the URL', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as Window & { hashRollStarts: string[] }
    state.hashRollStarts = []
    document.addEventListener('animationstart', (event) => {
      if ((event.target as Element).closest('.hash-input')) state.hashRollStarts.push(event.animationName)
    }, true)
  })
  const initial = setType(setByte(DEFAULT_HASH, 29, 251), 'Ribbed')
  await page.goto(`/?hash=${initial}`)
  await expect(artworkHash(page)).toHaveValue(initial)
  await expect(page.locator('.hash-input__overlay')).toBeVisible()
  await settleCanvas(page)
  expect(await page.locator('.hash-input__current').allTextContents()).toEqual(Array.from(initial))
  expect(await page.evaluate(() => (window as Window & { hashRollStarts: string[] }).hashRollStarts)).toEqual([])
  expect(await page.locator('.hash-input').evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0)
})

test('all six types and Hyper produce the corresponding representable hash traits', async ({ page }) => {
  await openEditor(page)
  for (const type of TYPES) {
    await page.getByRole('button', { name: type, exact: true }).click()
    expect(decodeHash(await artworkHash(page).inputValue()).type).toBe(type)
    await expect(page.getByRole('button', { name: type, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Hyper', exact: true }).click()
    expect(decodeHash(await artworkHash(page).inputValue()).hyper).toBe(true)
    await expect(page.getByRole('slider', { name: 'Color spread' })).toBeDisabled()
    await page.getByRole('button', { name: 'Hyper', exact: true }).click()
    expect(decodeHash(await artworkHash(page).inputValue()).hyper).toBe(false)
    await expect(page.getByRole('slider', { name: 'Color spread' })).toBeEnabled()
  }
  const reverseBefore = decodeHash(await artworkHash(page).inputValue()).reverse
  await page.getByRole('button', { name: 'Reverse', exact: true }).click()
  expect(decodeHash(await artworkHash(page).inputValue()).reverse).toBe(!reverseBefore)
})

test('hue and spread controls update hash bytes through native keyboard input', async ({ page }) => {
  await openEditor(page)
  await page.getByRole('slider', { name: 'Starting hue' }).press('Home')
  await page.getByRole('slider', { name: 'Starting hue' }).press('ArrowRight')
  expect(decodeHash(await artworkHash(page).inputValue()).bytes[29]).toBe(1)
  await page.getByRole('slider', { name: 'Color spread' }).press('End')
  expect(decodeHash(await artworkHash(page).inputValue()).bytes[28]).toBe(255)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
})

test('starting hue follows the fixed rainbow and inverse-encodes the hash when reversed', async ({ page }) => {
  await openEditor(page)
  const slider = page.getByRole('slider', { name: 'Starting hue' })
  const degrees = page.locator('output[for="hue"]')
  const rainbow = await slider.evaluate(element => getComputedStyle(element, '::-webkit-slider-runnable-track').backgroundImage)
  await page.getByRole('button', { name: 'Reverse', exact: true }).click()
  const reversed = await artworkHash(page).inputValue()
  expect(changedBytes(DEFAULT_HASH, reversed)).toEqual([30])
  await expect(slider).toHaveValue('150')
  await expect(degrees).toHaveText('212°')
  expect(await slider.evaluate(element => getComputedStyle(element, '::-webkit-slider-runnable-track').backgroundImage)).toBe(rainbow)

  for (const [reverse, expectedBytes] of [[true, [255, 170, 85, 0]], [false, [0, 85, 170, 255]]] as const) {
    if (!reverse) {
      const before = await artworkHash(page).inputValue()
      await page.getByRole('button', { name: 'Reverse', exact: true }).click()
      expect(changedBytes(before, await artworkHash(page).inputValue())).toEqual([30])
    }
    for (const [index, hue] of [0, 85, 170, 255].entries()) {
      const before = await artworkHash(page).inputValue()
      await slider.evaluate((element, value) => {
        const input = element as HTMLInputElement
        input.value = String(value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }, hue)
      await expect(slider).toHaveValue(String(hue))
      await expect(degrees).toHaveText(`${index * 120}°`)
      const after = await artworkHash(page).inputValue()
      expect(decodeHash(after).bytes[29]).toBe(expectedBytes[index])
      expect(decodeHash(after).reverse).toBe(reverse)
      expect(changedBytes(before, after).every(byte => byte === 29)).toBe(true)
    }
  }
})

test('invalid imports preserve artwork and a valid Fuzzy hash reconstructs identical pixels from its URL', async ({ page }) => {
  await openEditor(page)
  const original = await canvasPixels(page)
  await artworkHash(page).fill('0xnot-a-hash')
  await artworkHash(page).press('Enter')
  await expect(page.getByRole('alert')).toHaveText('Use 0x followed by 64 hexadecimal characters.')
  await expect(artworkHash(page)).toHaveAttribute('aria-invalid', 'true')
  expect(await canvasPixels(page)).toBe(original)

  const imported = setType(setByte(DEFAULT_HASH, 7, 40), 'Fuzzy')
  await artworkHash(page).fill(imported)
  await artworkHash(page).press('Enter')
  await expect(artworkHash(page)).toHaveValue(imported)
  await expect(artworkHash(page)).toHaveAttribute('aria-invalid', 'false')
  await expect(page.getByRole('button', { name: 'Fuzzy', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await artworkHash(page).evaluate(element => {
    const field = element as HTMLInputElement | HTMLTextAreaElement
    field.setSelectionRange(field.value.length, field.value.length)
  })
  await artworkHash(page).press('Backspace')
  await expect(artworkHash(page)).not.toHaveValue(imported)
  await artworkHash(page).press('ControlOrMeta+z')
  await expect(artworkHash(page)).toHaveValue(imported)
  await expect(page.getByRole('button', { name: 'Fuzzy', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Gray background' }).click()
  const beforeReload = await canvasPixels(page)
  await expect.poll(() => new URL(page.url()).searchParams.get('hash')).toBe(imported)
  await expect.poll(() => new URL(page.url()).searchParams.get('bg')).toBe('969696')
  await page.reload()
  await expect(artworkHash(page)).toHaveValue(imported)
  await expect(page.getByRole('button', { name: 'Gray background' })).toHaveAttribute('aria-pressed', 'true')
  expect(await canvasPixels(page)).toBe(beforeReload)
})

test('curve drags create one undo step, support redo and Escape cancellation, and allow keyboard editing', async ({ page }) => {
  await openEditor(page)
  let point = await curvePosition(page)
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await expect(page.locator('.hash-input__overlay')).toHaveCount(0)
  await page.mouse.move(point.x, point.y + 44, { steps: 5 })
  await expect(artworkHash(page)).not.toHaveValue(DEFAULT_HASH)
  await expect(artworkHash(page)).not.toHaveClass(/is-masked/)
  await page.mouse.move(1, point.y + 44)
  await page.mouse.up()
  await expect(page.locator('.hash-input__slot')).toHaveCount(66)
  const draggedHash = await artworkHash(page).inputValue()
  expect(draggedHash).not.toBe(DEFAULT_HASH)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(artworkHash(page)).toHaveValue(DEFAULT_HASH)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(artworkHash(page)).toHaveValue(draggedHash)

  point = await curvePosition(page)
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x, point.y - 35, { steps: 3 })
  await expect(artworkHash(page)).not.toHaveValue(draggedHash)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(artworkHash(page)).toHaveValue(draggedHash)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(artworkHash(page)).toHaveValue(DEFAULT_HASH)

  await artwork(page).focus()
  await artwork(page).press('ArrowRight')
  await artwork(page).press('ArrowUp')
  const nudged = await artworkHash(page).inputValue()
  const differences = decodeHash(nudged).bytes.map((byte, i) => byte - decodeHash(DEFAULT_HASH).bytes[i]!).filter(Boolean)
  expect(differences).toEqual([-1])
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(artworkHash(page)).toHaveValue(DEFAULT_HASH)
})

test('visible handles on Color directly edit one point without shifting neighboring bytes', async ({ page }) => {
  await openEditor(page)
  await expect(page.getByRole('tab', { name: 'Color', exact: true })).toHaveAttribute('aria-selected', 'true')
  const bounds = (await artwork(page).boundingBox())!
  const startHash = setByte(DEFAULT_HASH, 0, 128)
  await artworkHash(page).fill(startHash)
  await artworkHash(page).press('Enter')
  await artwork(page).focus()
  const control = buildGeometry(startHash, bounds.width, bounds.height).controls[0]!
  const x = bounds.x + control.x
  const y = bounds.y + control.y
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + 30, { steps: 8 })
  await expect.poll(async () => changedBytes(startHash, await artworkHash(page).inputValue())).toEqual([0])
  await page.mouse.up()
  await expect(page.locator('.squiggle-canvas__guides circle.is-selected')).toHaveAttribute('cx', String(control.x))
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(artworkHash(page)).toHaveValue(startHash)
})

test('genuine touch drags edit on phones and keep their position when the browser interrupts touch', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3021', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  const errors = watchErrors(page)
  let completed = false
  try {
    await openEditor(page)
    await page.evaluate(() => {
      const events: unknown[] = []
      ;(window as any).touchDiagnostics = events
      for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click', 'focus', 'blur']) {
        window.addEventListener(type, event => {
          if (events.length >= 256) return
          const target = event.target instanceof Element ? event.target : null
          events.push({
            type, time: event.timeStamp, prevented: event.defaultPrevented,
            target: target?.tagName, button: target?.closest('button')?.getAttribute('aria-label'),
            pointerId: 'pointerId' in event ? event.pointerId : undefined,
            focused: document.hasFocus(), active: document.activeElement?.tagName,
            hash: (document.getElementById('hash') as HTMLTextAreaElement).value,
            canUndo: !document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')?.disabled,
          })
        })
      }
    })
    const session = await context.newCDPSession(page)
    // Use one ordered native touch stream for both the drag and the controls.
    const tapControl = async (control: Locator) => {
      await expect(control).toBeVisible()
      await expect(control).toBeEnabled()
      const bounds = (await control.boundingBox())!
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, id: 4 }],
      })
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    let point = await curvePosition(page)
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y + 38, id: 1 }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(artworkHash(page)).not.toHaveValue(DEFAULT_HASH)
    await tapControl(page.getByRole('button', { name: 'Undo', exact: true }))
    await expect(artworkHash(page)).toHaveValue(DEFAULT_HASH)

    point = await curvePosition(page)
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 2 }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y - 25, id: 2 }] })
    await expect(artworkHash(page)).not.toHaveValue(DEFAULT_HASH)
    const interruptedHash = await artworkHash(page).inputValue()
    await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    await expect(artworkHash(page)).toHaveValue(interruptedHash)
    await tapControl(page.getByRole('button', { name: 'Undo', exact: true }))
    await expect(artworkHash(page)).toHaveValue(DEFAULT_HASH)

    await tapControl(page.getByRole('tab', { name: 'Shape', exact: true }))
    const bounds = (await artwork(page).boundingBox())!
    const lastIndex = buildGeometry(DEFAULT_HASH, bounds.width, bounds.height).controls.length - 1
    const endpointHash = setByte(setByte(DEFAULT_HASH, 0, 128), lastIndex, 128)
    await artworkHash(page).fill(endpointHash)
    await artworkHash(page).press('Enter')
    for (const [index, direction] of [[0, 1], [lastIndex, -1]] as const) {
      const control = buildGeometry(endpointHash, bounds.width, bounds.height).controls[index]!
      point = { x: bounds.x + control.x, y: bounds.y + control.y }
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 3 }] })
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y + 24 * direction, id: 3 }] })
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      const edited = await artworkHash(page).inputValue()
      expect(changedBytes(endpointHash, edited)).toEqual([index])
      await expect(page.getByRole('slider', { name: 'Point height' })).toHaveValue(String(255 - decodeHash(edited).bytes[index]!))
      await expect(page.getByRole('button', { name: index === 0 ? 'Previous point' : 'Next point' })).toBeDisabled()
      await tapControl(page.getByRole('button', { name: 'Undo', exact: true }))
      await expect(artworkHash(page)).toHaveValue(endpointHash)
    }
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 })
    expect(errors, 'No errors in the touch-enabled browser context').toEqual([])
    completed = true
  } finally {
    try {
      if (!completed && !page.isClosed()) {
        const events = await page.evaluate(() => (window as any).touchDiagnostics ?? [])
        await testInfo.attach('native-touch-events', { body: JSON.stringify(events, null, 2), contentType: 'application/json' })
      }
    } catch { /* Diagnostics must not hide the original failure if the browser crashed. */ }
    await context.close()
  }
})

test('animation and backgrounds leave the hash intact, and PNG exports at a stable 3000 by 2000 resolution', async ({ page }) => {
  await openEditor(page)
  const beforeAnimation = await canvasPixels(page)
  await page.getByRole('button', { name: 'Play animation' }).click()
  await expect.poll(() => canvasPixels(page)).not.toBe(beforeAnimation)
  await page.getByRole('button', { name: 'Pause animation' }).click()
  await page.getByRole('tab', { name: 'View', exact: true }).click()
  await page.getByRole('slider', { name: 'Speed', exact: true }).press('End')
  await page.getByRole('slider', { name: 'Background', exact: true }).press('End')
  await expect(artworkHash(page)).toHaveValue(DEFAULT_HASH)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  await expect.poll(() => new URL(page.url()).searchParams.get('speed')).toBe('20')
  await expect.poll(() => new URL(page.url()).searchParams.get('bg')).toBe('000000')
  await page.reload()
  await expect(artworkHash(page)).toHaveValue(DEFAULT_HASH)
  await page.getByRole('tab', { name: 'View', exact: true }).click()
  await expect(page.getByRole('slider', { name: 'Speed', exact: true })).toHaveValue('20')
  await expect(page.getByRole('slider', { name: 'Background', exact: true })).toHaveValue('10')
  await settleCanvas(page)
  const corner = await artwork(page).evaluate(element => Array.from((element as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data))
  expect(corner).toEqual([0, 0, 0, 255])
  await downloadPng(page)
})

test('print exports match across viewports and contain extreme marks of every type inside a fixed margin', async ({ page }) => {
  test.setTimeout(240_000)
  await openEditor(page)
  const desktop = await downloadPng(page, 'export-normal.png')
  await page.setViewportSize({ width: 390, height: 844 })
  await settleCanvas(page)
  const phone = await downloadPng(page, 'export-normal-phone.png')
  expect(phone.equals(desktop), 'Export composition is independent of the editor viewport').toBe(true)

  const bytes = decodeHash(DEFAULT_HASH).bytes
  // Paired extremes produce larger spline overshoot than alternating extremes.
  for (let index = 0; index < 22; index++) bytes[index] = index % 4 < 2 ? 255 : 0
  bytes[26] = 255
  bytes[27] = 0
  const extreme = toHash(bytes)
  for (const type of TYPES) {
    const hash = setType(extreme, type)
    await artworkHash(page).fill(hash)
    await artworkHash(page).press('Enter')
    await expect(artworkHash(page)).toHaveValue(hash)
    const png = await downloadPng(page, `export-${type.toLowerCase()}-extreme.png`)
    const bounds = await pngInkBounds(page, png)
    expect(bounds.ink, `${type} contains visible artwork`).toBeGreaterThan(1000)
    expect(bounds.minX, `${type} left edge`).toBeGreaterThan(0)
    expect(bounds.minY, `${type} top edge`).toBeGreaterThan(0)
    expect(bounds.maxX, `${type} right edge`).toBeLessThan(2999)
    expect(bounds.maxY, `${type} bottom edge`).toBeLessThan(1999)
  }
  // A second seed checks Fuzzy's different accepted jitter samples as well.
  const fuzzy = setByte(setType(extreme, 'Fuzzy'), 0, 254)
  await artworkHash(page).fill(fuzzy)
  await artworkHash(page).press('Enter')
  const bounds = await pngInkBounds(page, await downloadPng(page, 'export-fuzzy.png'))
  expect(bounds.minY).toBeGreaterThan(0)
  expect(bounds.maxY).toBeLessThan(1999)
})

test('Fuzzy mouse and touch bursts flush release and interrupted movement as one undoable gesture', async ({ browser, page }) => {
  test.setTimeout(120_000)
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3021', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const touchPage = await context.newPage()
  const touchErrors = watchErrors(touchPage)
  const touchSession = await context.newCDPSession(touchPage)
  const fuzzy = setType(DEFAULT_HASH, 'Fuzzy')
  const timings: Record<string, number> = {}
  try {
    for (const [target, kind] of [[page, 'mouse'], [touchPage, 'touch']] as const) {
      await target.goto(`/?hash=${fuzzy}`)
      await expect(artworkHash(target)).toHaveValue(fuzzy)
      await settleCanvas(target)
      const begin = async () => {
        const point = await curvePosition(target)
        await artwork(target).evaluate(element => {
          element.addEventListener('pointerdown', event => {
            const pointer = event as PointerEvent
            element.setAttribute('data-test-pointer', JSON.stringify({ pointerId: pointer.pointerId, pointerType: pointer.pointerType, x: pointer.clientX, y: pointer.clientY }))
          }, { once: true })
        })
        if (kind === 'mouse') {
          await target.mouse.move(point.x, point.y)
          await target.mouse.down()
        } else {
          await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] })
        }
        return point
      }
      const burst = async (cancel: boolean) => artwork(target).evaluate((element, cancel) => {
        const pointer = JSON.parse(element.getAttribute('data-test-pointer')!) as { pointerId: number; pointerType: string; x: number; y: number }
        const rect = element.getBoundingClientRect()
        const start = performance.now()
        // One JavaScript task guarantees there is no animation frame between
        // the pending move samples and release/cancel of the captured pointer.
        for (const delta of [7, 18, 29]) element.dispatchEvent(new PointerEvent('pointermove', {
          pointerId: pointer.pointerId, pointerType: pointer.pointerType, isPrimary: true,
          clientX: pointer.x, clientY: pointer.y + delta, buttons: 1, bubbles: true, cancelable: true,
        }))
        element.dispatchEvent(new PointerEvent(cancel ? 'pointercancel' : 'pointerup', {
          pointerId: pointer.pointerId, pointerType: pointer.pointerType, isPrimary: true,
          clientX: pointer.x, clientY: pointer.y + 37, buttons: 0, bubbles: true, cancelable: true,
        }))
        return { x: pointer.x - rect.x, y: pointer.y - rect.y, width: rect.width, height: rect.height, milliseconds: performance.now() - start }
      }, cancel)
      const release = async (cancel = false) => {
        if (kind === 'mouse') await target.mouse.up()
        else await touchSession.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] })
      }

      await begin()
      const result = await burst(false)
      await release()
      const nearest = nearestCurvePoint(fuzzy, result.width, result.height, result.x, result.y)
      await expect(artworkHash(target)).toHaveValue(dragCurve(fuzzy, result.width, result.height, nearest.segment, nearest.t, 37))
      timings[kind] = result.milliseconds
      const undo = target.getByRole('button', { name: 'Undo', exact: true })
      if (kind === 'touch') await undo.tap()
      else await undo.click()
      await expect(artworkHash(target)).toHaveValue(fuzzy)
      await expect(undo).toBeDisabled()

      const point = await begin()
      if (kind === 'mouse') await target.mouse.move(point.x, point.y + 10)
      else await touchSession.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y + 10, id: 1 }] })
      await settleCanvas(target)
      await expect(artworkHash(target)).not.toHaveValue(fuzzy)
      const interrupted = await burst(true)
      await release(true)
      const interruptedPoint = nearestCurvePoint(fuzzy, interrupted.width, interrupted.height, interrupted.x, interrupted.y)
      await expect(artworkHash(target)).toHaveValue(dragCurve(fuzzy, interrupted.width, interrupted.height, interruptedPoint.segment, interruptedPoint.t, 29))
      await expect(undo).toBeEnabled()
      if (kind === 'touch') await undo.tap()
      else await undo.click()
      await expect(artworkHash(target)).toHaveValue(fuzzy)
      await expect(undo).toBeDisabled()
    }
    expect(touchErrors).toEqual([])
    await test.info().attach('fuzzy-pointer-burst-timing', { body: JSON.stringify(timings), contentType: 'application/json' })
  } finally {
    await context.close()
  }
})

test('interrupted drags keep the last position through capture loss, resizing and window blur', async ({ page }) => {
  for (const interruption of ['capture', 'resize', 'blur'] as const) {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openEditor(page)
    const point = await curvePosition(page)
    await artwork(page).evaluate(element => {
      element.addEventListener('pointerdown', event => {
        element.setAttribute('data-test-pointer-id', String((event as PointerEvent).pointerId))
      }, { once: true })
    })
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await page.mouse.move(point.x, point.y + 32, { steps: 4 })
    await settleCanvas(page)
    await expect(artworkHash(page)).not.toHaveValue(DEFAULT_HASH)
    const moved = await artworkHash(page).inputValue()
    if (interruption === 'capture') {
      await artwork(page).evaluate(element => element.releasePointerCapture(Number(element.getAttribute('data-test-pointer-id'))))
      // Native lostpointercapture is delivered with the next pointer event.
      await page.mouse.move(point.x + 1, point.y + 32)
    }
    if (interruption === 'resize') await page.setViewportSize({ width: 1440, height: 850 })
    if (interruption === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await expect(page.locator('.squiggle-canvas')).not.toHaveClass(/is-dragging/)
    await expect(artworkHash(page)).toHaveValue(moved)
    await page.mouse.up()
    await expect(artworkHash(page)).toHaveValue(moved)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(artworkHash(page)).toHaveValue(DEFAULT_HASH)
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  }
})

test('clicking outside the canvas clears handles even on Shape and canvas focus never adds a frame', async ({ page }) => {
  await page.goto('/?code=1')
  await expect(page.getByRole('textbox', { name: 'JavaScript source' })).toBeVisible()
  await page.getByRole('tab', { name: 'Shape', exact: true }).click()
  for (const target of [
    page.getByRole('heading', { name: 'Squiggle Editor' }),
    page.getByRole('slider', { name: 'Height', exact: true }),
    page.getByRole('button', { name: 'White background', exact: true }),
    page.getByRole('textbox', { name: 'JavaScript source' }),
  ]) {
    const point = await curvePosition(page)
    await page.mouse.click(point.x, point.y)
    await expect(page.locator('.squiggle-canvas__guides')).toBeVisible()
    expect(await artwork(page).evaluate(element => getComputedStyle(element).outlineStyle)).toBe('none')
    await target.click()
    await expect(page.locator('.squiggle-canvas__guides')).toHaveCount(0)
    await expect(artwork(page)).not.toBeFocused()
  }
  await page.keyboard.press('Tab')
  await artwork(page).focus()
  await expect(page.locator('.squiggle-canvas__guides circle.is-selected')).toBeVisible()
  expect(await artwork(page).evaluate(element => getComputedStyle(element).outlineStyle)).toBe('none')
  await artwork(page).press('ArrowRight')
  const before = await artworkHash(page).inputValue()
  await artwork(page).press('ArrowUp')
  await expect(artworkHash(page)).not.toHaveValue(before)
})

test('Shape controls update only their represented byte, preserve selection, and undo cleanly', async ({ page }) => {
  await openEditor(page)
  await page.getByRole('tab', { name: 'Shape', exact: true }).click()
  for (const [label, index, key, value] of [
    ['Length', 26, 'Home', 0],
    ['Height', 27, 'End', 0],
    ['Point height', 8, 'End', 0],
  ] as const) {
    await page.getByRole('slider', { name: label, exact: true }).press(key)
    const edited = await artworkHash(page).inputValue()
    expect(changedBytes(DEFAULT_HASH, edited)).toEqual([index])
    expect(decodeHash(edited).bytes[index]).toBe(value)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(artworkHash(page)).toHaveValue(DEFAULT_HASH)
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await expect(artworkHash(page)).toHaveValue(edited)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(artworkHash(page)).toHaveValue(DEFAULT_HASH)
  }
  await page.getByRole('button', { name: 'Next point', exact: true }).click()
  await expect(artworkHash(page)).toHaveValue(DEFAULT_HASH)
  await page.getByRole('slider', { name: 'Point height', exact: true }).press('Home')
  const nextPointHash = await artworkHash(page).inputValue()
  expect(changedBytes(DEFAULT_HASH, nextPointHash)).toEqual([9])
  expect(decodeHash(nextPointHash).bytes[9]).toBe(255)
})

test('Texture controls are contextual and preserve every unrelated byte when editing Ribbed', async ({ page }) => {
  await openEditor(page)
  await page.getByRole('tab', { name: 'Texture', exact: true }).click()
  await expect(page.getByRole('slider', { name: 'Spacing' })).toBeDisabled()
  await expect(page.getByRole('slider', { name: 'Rib color' })).toBeDisabled()
  await page.getByRole('complementary', { name: 'Squiggle type' }).getByRole('button', { name: 'Ribbed', exact: true }).click()
  const ribbedHash = await artworkHash(page).inputValue()
  await page.getByRole('slider', { name: 'Spacing' }).press('Home')
  expect(changedBytes(ribbedHash, await artworkHash(page).inputValue())).toEqual([24])
  expect(decodeHash(await artworkHash(page).inputValue()).bytes[24]).toBe(0)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(artworkHash(page)).toHaveValue(ribbedHash)
  await page.getByRole('slider', { name: 'Rib color' }).press('End')
  expect(changedBytes(ribbedHash, await artworkHash(page).inputValue())).toEqual([25])
  expect(decodeHash(await artworkHash(page).inputValue()).bytes[25]).toBe(255)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(artworkHash(page)).toHaveValue(ribbedHash)
})

async function copySketch(page: Page) {
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { (window as any).copiedSketch = value } } }))
  await page.getByRole('button', { name: 'Copy code', exact: true }).click()
  return page.evaluate(() => (window as any).copiedSketch as string)
}

async function editSketch(page: Page, source: string) {
  const code = page.getByRole('textbox', { name: 'JavaScript source' })
  await code.click()
  await code.press('ControlOrMeta+a')
  if (source) await page.keyboard.insertText(source)
  else await code.press('Backspace')
}

async function expectLineVisible(page: Page, line: ReturnType<Page['locator']>) {
  await expect(line).toBeVisible()
  await expect.poll(async () => {
    const bounds = (await line.boundingBox())!
    const viewport = (await page.locator('.cm-scroller').boundingBox())!
    return bounds.y >= viewport.y && bounds.y + bounds.height <= viewport.y + viewport.height
  }).toBe(true)
}

test('code mode displays the verified script and follows the original expressions when controls change', async ({ page }) => {
  await openEditor(page)
  const toggle = page.getByRole('button', { name: 'Code mode', exact: true })
  await toggle.click()
  const code = page.getByRole('textbox', { name: 'JavaScript source' })
  await expect(code).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.cm-line.is-changed')).toHaveCount(0)
  const canvasBounds = (await artwork(page).boundingBox())!
  const panelBounds = (await page.locator('.code-panel').boundingBox())!
  expect(panelBounds.x).toBeGreaterThan(canvasBounds.x + canvasBounds.width)
  await settleCanvas(page)

  const hue = page.getByRole('slider', { name: 'Starting hue' })
  await hue.focus()
  await hue.press('ArrowRight')
  const updated = await artworkHash(page).inputValue()
  const line = page.locator('.cm-line').filter({ hasText: 'let startColor = decPairs[29];' })
  await expect(line).toHaveClass(/is-changed/)
  await expectLineVisible(page, line)
  await expect(hue).toBeFocused()
  await expect(page).toHaveURL(/code=1/)
  const source = await copySketch(page)
  const original = (await readFile('app/data/snowfro-script.formatted.js', 'utf8')).trimEnd()
  expect(source).toBe(original)
  await expect(line).not.toHaveClass(/is-changed/)
  await hue.press('ArrowRight')
  await expect(line).toHaveClass(/is-changed/)
  await expect(page.getByRole('link', { name: 'On-chain', exact: true })).toBeVisible()
  await toggle.click()
  await expect(code).toHaveCount(0)
  await expect(artworkHash(page)).not.toHaveValue(updated)
})

test('code mode keeps phone canvas, controls and editable source available together', async ({ page }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 751, height: 1324 }, { width: 844, height: 390 }, { width: 568, height: 320 }]) {
    await page.setViewportSize(viewport)
    await page.goto('/?code=1')
    await expect(page.locator('.code-panel')).toBeInViewport({ ratio: 1 })
    await expect(artwork(page)).toBeInViewport({ ratio: 1 })
    const canvasBounds = (await artwork(page).boundingBox())!
    expect(canvasBounds.width).toBeGreaterThan(150)
    expect(canvasBounds.height).toBeGreaterThan(90)
    for (const name of ['Code mode', 'Copy code', 'Run code', 'Play animation', 'Reset squiggle', ...TYPES]) await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 })
    for (const tab of ['Color', 'Shape', 'Texture', 'View']) {
      await page.getByRole('tab', { name: tab, exact: true }).click()
      await expect(page.getByRole('tabpanel', { name: tab, exact: true })).toBeInViewport({ ratio: 1 })
    }
    expect(await page.evaluate(() => [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight])).toEqual([0, 0])
    await page.getByRole('tab', { name: 'View', exact: true }).click()
    await settleCanvas(page)
    await page.getByRole('slider', { name: 'Speed', exact: true }).focus()
    await page.getByRole('slider', { name: 'Speed', exact: true }).press('ArrowRight')
    const line = page.locator('.cm-line').filter({ hasText: 'let speed = 1;' })
    await expect(line).toHaveClass(/is-changed/)
    await expectLineVisible(page, line)
  }
})

test('code following respects manual scrolling and reduced motion during rapid edits', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?code=1')
  const code = page.locator('.cm-scroller')
  await expect(code).toBeVisible()
  await settleCanvas(page)
  await code.evaluate(element => {
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: 500, bubbles: true }))
    element.scrollTop = element.scrollHeight
  })
  await settleCanvas(page)
  const scrollTop = await code.evaluate(element => element.scrollTop)
  await page.getByRole('slider', { name: 'Starting hue' }).evaluate(async element => {
    const input = element as HTMLInputElement
    for (const value of [20, 40, 60, 80, 100]) {
      input.value = String(value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    }
  })
  await page.waitForTimeout(300)
  expect(await code.evaluate(element => element.scrollTop)).toBe(scrollTop)
  expect(await page.locator('.code-panel').evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0)
  const source = await copySketch(page)
  expect(source).toBe((await readFile('app/data/snowfro-script.formatted.js', 'utf8')).trimEnd())
})

test('original source runs custom drawing logic with separate token data, preserves drafts and resets', async ({ page }) => {
  await page.goto('/?code=1')
  await expect(page.getByRole('textbox', { name: 'JavaScript source' })).toBeVisible()
  const original = await copySketch(page)
  expect(original).toBe((await readFile('app/data/snowfro-script.formatted.js', 'utf8')).trimEnd())
  const current = await copySketch(page)
  const custom = current.replace('let wt = 2;', 'let wt = 4;') + '\ndocument.body.dataset.width = String(wt);\ndocument.body.dataset.hash = tokenData.hashes[0];'
  await editSketch(page, custom)
  await expect(artwork(page)).toBeVisible()
  await page.getByRole('button', { name: 'Run code', exact: true }).click()
  const frame = page.frameLocator('iframe')
  await expect(frame.locator('canvas')).toBeVisible()
  await expect(page.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts')
  await expect(artwork(page)).toHaveCount(0)
  await expect(page.getByText('Custom code', { exact: true })).toBeVisible()
  expect(await frame.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL())).toMatch(/^data:image\/png/)

  // A new draft must not run just because a form control updates the committed code.
  await editSketch(page, custom.replace('let wt = 4;', 'let wt = 6;'))
  await page.getByRole('slider', { name: 'Starting hue' }).press('ArrowRight')
  await expect(frame.locator('body')).toHaveAttribute('data-width', '4')
  await expect(frame.locator('body')).toHaveAttribute('data-hash', await artworkHash(page).inputValue())
  expect(await copySketch(page)).toContain('let wt = 6;')
  await page.getByRole('button', { name: 'Code mode', exact: true }).click()
  await expect(frame.locator('canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Code mode', exact: true }).click()
  expect(await copySketch(page)).toContain('let wt = 6;')
  await page.getByRole('button', { name: 'Run code', exact: true }).click()
  await expect(page.frameLocator('iframe').locator('body')).toHaveAttribute('data-width', '6')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('squiggle-custom.png')
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport)
    await expect.poll(async () => {
      const canvas = await page.frameLocator('iframe').locator('canvas').boundingBox()
      const iframe = await page.locator('iframe').boundingBox()
      if (!canvas || !iframe) return false
      return canvas.width <= iframe.width + 1 && canvas.height <= iframe.height + 1
    }).toBe(true)
    await expect(page.getByRole('button', { name: 'Reset original code', exact: true })).toBeInViewport({ ratio: 1 })
  }
  await page.getByRole('button', { name: 'Reset original code', exact: true }).click()
  await expect(artwork(page)).toBeVisible()
  await expect(page.locator('iframe')).toHaveCount(0)
  expect(await copySketch(page)).toBe(original)
})

test('custom sketch view controls preserve animation phase and the running frame', async ({ page }) => {
  await page.goto('/?code=1')
  await expect(page.getByRole('textbox', { name: 'JavaScript source' })).toBeVisible()
  const custom = (await copySketch(page)).replace('let wt = 2;', 'let wt = 3;')
  await editSketch(page, custom)
  await page.getByRole('button', { name: 'Run code', exact: true }).click()
  await expect(page.frameLocator('iframe').locator('canvas')).toBeVisible()
  const frame = (await page.locator('iframe').elementHandle())!
  const running = (await frame.contentFrame())!
  const state = () => running.evaluate(() => ({
    phase: eval('index') as number,
    playing: eval('loops') as boolean,
    speed: eval('speed') as number,
    background: eval('backgroundArray[0]') as string,
    backgroundIndex: eval('backgroundIndex') as number,
  }))
  // Original p5 handlers and editor controls must remain usable together.
  await page.frameLocator('iframe').locator('canvas').click()
  await expect.poll(async () => (await state()).playing).toBe(true)
  await page.getByRole('button', { name: 'Play animation', exact: true }).click()
  await expect.poll(async () => (await state()).phase).toBeGreaterThan(5)
  const beforePause = (await state()).phase
  await page.getByRole('button', { name: 'Pause animation', exact: true }).click()
  await expect.poll(async () => (await state()).playing).toBe(false)
  const paused = (await state()).phase
  expect(paused).toBeGreaterThanOrEqual(beforePause)
  await page.getByRole('tab', { name: 'View', exact: true }).click()
  await page.getByRole('slider', { name: 'Speed', exact: true }).press('ArrowRight')
  await expect.poll(async () => (await state()).speed).toBe(1.1)
  await page.locator('iframe').focus()
  await page.keyboard.press('Space')
  await expect.poll(async () => (await state()).backgroundIndex).toBe(1)
  await page.getByRole('button', { name: 'Gray background', exact: true }).click()
  await expect.poll(async () => (await state()).background).toBe('#969696')
  await expect.poll(async () => (await state()).backgroundIndex).toBe(0)
  expect((await state()).phase).toBe(paused)
  await page.getByRole('button', { name: 'Play animation', exact: true }).click()
  await expect.poll(async () => (await state()).phase).toBeGreaterThan(paused)
  expect(running.isDetached()).toBe(false)
  expect(await copySketch(page)).toBe(custom)
})

test('background controls repaint a stopped custom sketch without restarting it', async ({ page }) => {
  await page.goto('/?code=1')
  await expect(page.getByRole('textbox', { name: 'JavaScript source' })).toBeVisible()
  const custom = (await copySketch(page)).replace('function setup() {', 'function setup() {\n  noLoop();')
  await editSketch(page, custom)
  await page.getByRole('button', { name: 'Run code', exact: true }).click()
  const canvas = page.frameLocator('iframe').locator('canvas')
  await expect(canvas).toBeVisible()
  const pixel = () => canvas.evaluate(element => [...(element as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data])
  await expect.poll(pixel).toEqual([255, 255, 255, 255])
  const running = (await (await page.locator('iframe').elementHandle())!.contentFrame())!
  await page.getByRole('button', { name: 'Gray background', exact: true }).click()
  await expect.poll(pixel).toEqual([150, 150, 150, 255])
  expect(running.isDetached()).toBe(false)
  expect(await running.evaluate(() => (window as any).p5.instance._loop)).toBe(false)
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click()
  const exported = await readFile((await (await pending).path())!)
  expect(`data:image/png;base64,${exported.toString('base64')}`).toBe(await canvas.evaluate(element => (element as HTMLCanvasElement).toDataURL('image/png')))
})

test('custom code errors stay recoverable and edited scripts cannot reach the editor document', async ({ page }) => {
  await page.goto('/?code=1')
  await expect(page.getByRole('textbox', { name: 'JavaScript source' })).toBeVisible()
  await editSketch(page, 'function setup( {')
  await page.getByRole('button', { name: 'Run code', exact: true }).click()
  await expect(page.locator('.code-panel__error')).toContainText(/Unexpected|SyntaxError/)
  await editSketch(page, 'function setup() { throw new Error("Try another shape"); }')
  await page.getByRole('button', { name: 'Run code', exact: true }).click()
  await expect(page.locator('.code-panel__error')).toContainText('Try another shape')
  await editSketch(page, `function setup() {
    createCanvas(160, 100);
    background(220);
    try { parent.document.body.dataset.changedBySketch = 'yes'; }
    catch { document.body.dataset.isolated = 'yes'; }
  }`)
  await page.getByRole('button', { name: 'Run code', exact: true }).click()
  await expect(page.frameLocator('iframe').locator('body')).toHaveAttribute('data-isolated', 'yes')
  expect(await page.locator('body').getAttribute('data-changed-by-sketch')).toBeNull()
  await expect(page.locator('.code-panel__error')).toBeEmpty()
  await page.getByRole('button', { name: 'Reset original code', exact: true }).click()
  await expect(artwork(page)).toBeVisible()
})


test('controls preserve custom declarations and an empty draft survives closing the pane', async ({ page }) => {
  await page.goto('/?code=1')
  await expect(page.getByRole('textbox', { name: 'JavaScript source' })).toBeVisible()
  const original = await copySketch(page)
  const draft = original.replace('let speed = 1;', 'let speed = 3;')
    + '\nwindow.addEventListener("load", () => { document.body.dataset.speed = String(speed); });'
  await editSketch(page, draft)
  await page.getByRole('button', { name: 'Gray background', exact: true }).click()
  expect(await copySketch(page)).toBe(draft)
  await page.getByRole('button', { name: 'Run code', exact: true }).click()
  await expect(page.frameLocator('iframe').locator('body')).toHaveAttribute('data-speed', '3')
  await expect(artworkHash(page)).toHaveValue(DEFAULT_HASH)

  await editSketch(page, '')
  await page.getByRole('button', { name: 'Code mode', exact: true }).click()
  await page.getByRole('button', { name: 'Code mode', exact: true }).click()
  expect(await copySketch(page)).toBe('')
  await page.getByRole('button', { name: 'Run code', exact: true }).click()
  await expect(page.locator('.code-panel__error')).toContainText('did not create a canvas')
  await expect(artwork(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'Reset original code', exact: true }).click()
  await expect(artwork(page)).toBeVisible()
})

test('code follows successive control targets promptly on desktop and phones', async ({ page }) => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await page.goto('/?code=1')
    await expect(page.getByRole('textbox', { name: 'JavaScript source' })).toBeVisible()
    await settleCanvas(page)
    const timings = await page.evaluate(async () => {
      const follow = async (tab: string, id: string, prefix: string) => {
        document.getElementById(`tab-${tab}`)!.click()
        await Promise.resolve()
        const input = document.getElementById(id) as HTMLInputElement
        input.focus()
        const started = performance.now()
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
        input.value = String(Number(input.value) + 1)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        return new Promise<number>(resolve => {
          const measure = () => {
            const scroller = document.querySelector('.cm-scroller')!.getBoundingClientRect()
            const line = [...document.querySelectorAll('.cm-line')].find(line => line.textContent!.trim().startsWith(prefix))
            const bounds = line?.getBoundingClientRect()
            if (bounds && line!.classList.contains('is-changed') && bounds.top >= scroller.top && bounds.bottom <= scroller.bottom) resolve(performance.now() - started)
            else if (performance.now() - started > 1500) resolve(1500)
            else requestAnimationFrame(measure)
          }
          requestAnimationFrame(measure)
        })
      }
      // Reversing direction before a previous smooth scroll would have finished
      // must follow the current input, without a timer queue or cooldown.
      return [
        await follow('Shape', 'point-height', 'map(decPairs[j],'),
        await follow('Color', 'hue', 'let startColor ='),
        await follow('Shape', 'height', 'ht = map(decPairs[27]'),
        await follow('View', 'speed', 'let speed ='),
      ]
    })
    for (const elapsed of timings) expect(elapsed).toBeLessThan(150)
    await test.info().attach(`follow-latency-${viewport.width}`, { body: JSON.stringify(timings), contentType: 'application/json' })
  }
})

test('code following resumes when controls take focus from selected code', async ({ page }) => {
  await page.goto('/?code=1')
  const editor = page.getByRole('textbox', { name: 'JavaScript source' })
  await expect(editor).toBeVisible()
  await editor.click()
  await editor.press('ControlOrMeta+a')
  const source = (await readFile('app/data/snowfro-script.formatted.js', 'utf8')).trimEnd()
  await page.getByRole('tab', { name: 'Shape', exact: true }).click()
  await page.getByRole('button', { name: 'Next point', exact: true }).click()
  const pointLine = page.locator('.cm-line').filter({ hasText: 'map(decPairs[j], 0, 255,' })
  await expectLineVisible(page, pointLine)
  await page.getByRole('slider', { name: 'Height', exact: true }).press('ArrowRight')
  await expectLineVisible(page, page.locator('.cm-line').filter({ hasText: 'ht = map(decPairs[27]' }))
  expect(await copySketch(page)).toBe(source)
})

test('point gestures resume code following immediately and keep the target steady while dragging', async ({ page }) => {
  await page.goto('/?code=1')
  await expect(page.getByRole('textbox', { name: 'JavaScript source' })).toBeVisible()
  await settleCanvas(page)
  const scroller = page.locator('.cm-scroller')
  const readElsewhere = async () => {
    await scroller.evaluate(element => {
      element.dispatchEvent(new WheelEvent('wheel', { deltaY: 2000, bubbles: true }))
      element.scrollTop = element.scrollHeight
    })
    await settleCanvas(page)
  }
  await readElsewhere()
  await page.getByRole('tab', { name: 'Shape', exact: true }).click()
  await page.getByRole('button', { name: 'Next point', exact: true }).click()
  const pointLine = page.locator('.cm-line').filter({ hasText: 'map(decPairs[j], 0, 255,' })
  await expectLineVisible(page, pointLine)
  await readElsewhere()
  const point = await curvePosition(page)
  await page.mouse.move(point.x, point.y)
  await page.evaluate(() => {
    const canvas = document.querySelector('[aria-label="Squiggle canvas"]')!
    ;(window as any).pointFollow = new Promise<number>(resolve => canvas.addEventListener('pointerdown', () => {
      const began = performance.now()
      const measure = () => {
        const viewport = document.querySelector('.cm-scroller')!.getBoundingClientRect()
        const line = [...document.querySelectorAll('.cm-line')].find(line => line.textContent!.trim().startsWith('map(decPairs[j],'))
        const bounds = line?.getBoundingClientRect()
        if (bounds && bounds.top >= viewport.top && bounds.bottom <= viewport.bottom && line!.classList.contains('is-changed')) resolve(performance.now() - began)
        else if (performance.now() - began > 1500) resolve(1500)
        else requestAnimationFrame(measure)
      }
      requestAnimationFrame(measure)
    }, { once: true }))
  })
  await page.mouse.down()
  expect(await page.evaluate(() => (window as any).pointFollow as Promise<number>)).toBeLessThan(150)
  await expect(artworkHash(page)).toHaveValue(DEFAULT_HASH)
  const followedPosition = await scroller.evaluate(element => element.scrollTop)
  await page.mouse.move(point.x, point.y + 26, { steps: 8 })
  await page.mouse.up()
  await expect(artworkHash(page)).not.toHaveValue(DEFAULT_HASH)
  expect(await scroller.evaluate(element => element.scrollTop)).toBe(followedPosition)
  expect(await copySketch(page)).toBe((await readFile('app/data/snowfro-script.formatted.js', 'utf8')).trimEnd())
})
