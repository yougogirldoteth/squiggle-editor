import { createHash } from 'node:crypto'
import { createContext, runInContext, Script } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { babelParse } from 'vue/compiler-sfc'
import rawOriginal from '../app/data/snowfro-script.js?raw'
import formattedOriginal from '../app/data/snowfro-script.formatted.js?raw'
import { affectedScriptLines, createLiveSketch, isOriginalSketch, sketchLines, type LiveSketchView } from '../app/utils/liveSketch'
import { DEFAULT_HASH, decodeHash, parseHash, setByte, setType, TYPES } from '../app/utils/squiggle'

const view: LiveSketchView = { background: '#ffffff', speed: 1, playing: false }

function runSource(source: string, windowWidth = 900, windowHeight = 600) {
  const operations: unknown[][] = []
  let offsetX = 0
  let offsetY = 0
  let fillColor: unknown = [255]
  let strokeColor: unknown = [0]
  let weight = 1
  const context = createContext({
    windowWidth, windowHeight, width: windowWidth, height: windowHeight,
    HSB: 'hsb', UP_ARROW: 38, DOWN_ARROW: 40, SHIFT: 16,
    document: { getElementsByTagName: () => [{ addEventListener() {} }] },
    createCanvas(width: number, height: number) { context.width = width; context.height = height },
    colorMode() {},
    map(value: number, from: number, to: number, low: number, high: number) { return low + (high - low) * ((value - from) / (to - from)) },
    background(value: unknown) { operations.push(['background', value]) },
    translate(x: number, y: number) { offsetX += x; offsetY += y },
    strokeWeight(value: number) { weight = value },
    fill(...values: number[]) { fillColor = values },
    stroke(...values: number[]) { strokeColor = values },
    noFill() { fillColor = null },
    noStroke() { strokeColor = null },
    circle(x: number, y: number, diameter: number) { operations.push(['circle', x + offsetX, y + offsetY, diameter, fillColor, strokeColor, weight]) },
    dist(x: number, y: number, a: number, b: number) { return Math.sqrt((a - x) ** 2 + (b - y) ** 2) },
    keyIsDown: () => false,
    curvePoint(a: number, b: number, c: number, d: number, t: number) {
      const t2 = t * t
      const t3 = t2 * t
      return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
    },
  })
  new Script(source).runInContext(context)
  runInContext('setup()', context)
  return {
    value: (expression: string) => runInContext(expression, context),
    draw() {
      operations.length = 0
      offsetX = 0
      offsetY = 0
      runInContext('draw()', context)
      return [...operations]
    },
  }
}

function withRuntimeInputs(source: string, hash: string, settings: LiveSketchView) {
  // Runtime scaffolding belongs to the test host, never to the displayed code.
  return `let tokenData = {hashes:[${JSON.stringify(hash)}]};\n${source}\nspeed=${settings.speed};backgroundArray[0]=${JSON.stringify(settings.background)};backgroundIndex=0;loops=${settings.playing};`
}

describe('verified original live sketch', () => {
  it('retains the on-chain byte digest and exposes only the formatted original source', () => {
    expect(createHash('sha256').update(rawOriginal).digest('hex')).toBe('d6e475f342854bcc8424867a97965e1bca31b79971c71a21456d8c1a9b230390')
    expect(Buffer.byteLength(rawOriginal)).toBe(5519)
    const sketch = createLiveSketch()
    expect(sketch.source).toBe(formattedOriginal.trimEnd())
    expect(sketch.source).toBe(sketch.lines.map(line => line.text).join('\n'))
    expect(sketchLines(sketch.source)).toEqual(sketch.lines)
    expect(new Set(sketch.lines.map(line => line.id)).size).toBe(sketch.lines.length)
    expect(sketch.lines.every((line, index) => line.id === `original-${index}`)).toBe(true)
    expect(isOriginalSketch(sketch.source)).toBe(true)
  })

  it('adds no JavaScript statements or comments to the verified source', () => {
    const original = babelParse(rawOriginal, { sourceType: 'script' })
    const displayed = babelParse(createLiveSketch().source, { sourceType: 'script' })
    const withoutFormatting = (ast: unknown) => JSON.parse(JSON.stringify(ast, (key, value) =>
      ['start', 'end', 'loc', 'extra'].includes(key) ? undefined : value))
    expect(withoutFormatting(displayed.program)).toEqual(withoutFormatting(original.program))
    expect(displayed.comments?.map(({ type, value }) => ({ type, value }))).toEqual(original.comments?.map(({ type, value }) => ({ type, value })))
  })

  it.each(TYPES)('runs the formatted %s script identically to the exact original source', (type) => {
    for (const [reverse, hyper, width, height] of [[false, false, 900, 600], [true, false, 390, 514], [false, true, 1200, 600], [true, true, 900, 1000]] as const) {
      let hash = setType(DEFAULT_HASH, type)
      hash = setByte(setByte(hash, 30, reverse ? 127 : 128), 28, hyper ? 2 : 73)
      const settings = { background: '#afafaf', speed: 2.5, playing: true }
      const actual = runSource(withRuntimeInputs(createLiveSketch().source, hash, settings), width, height)
      const expected = runSource(withRuntimeInputs(rawOriginal, hash, settings), width, height)
      expect(actual.value('decPairs')).toEqual(parseHash(hash))
      expect(actual.value('fuzzy')).toBe(decodeHash(hash).fuzzy)
      expect(actual.draw()).toEqual(expected.draw())
      expect(actual.draw()).toEqual(expected.draw())
      expect(actual.value('index')).toBe(5)
    }
  })

  it('retains Fuzzy token 7 randomness, fractional segments and latent flags', () => {
    const fuzzy = '0x3c17af010c7af574f5dab0f449e3e360212d9bc9521e16709aff20a8b0fb44ba'
    const changedSeed = setByte(fuzzy, 6, parseHash(fuzzy)[6]! + 16)
    const hashes = [fuzzy, changedSeed, setByte(setByte(setByte(fuzzy, 26, 1), 23, 0), 24, 0)]
    const traces = hashes.map(hash => {
      const actual = runSource(withRuntimeInputs(createLiveSketch().source, hash, view))
      const expected = runSource(withRuntimeInputs(rawOriginal, hash, view))
      const trace = actual.draw()
      expect(trace).toEqual(expected.draw())
      expect(actual.draw()).toEqual(trace)
      return trace
    })
    expect(traces[0]!.filter(op => op[0] === 'circle')).toHaveLength(6900)
    expect(traces[1]).not.toEqual(traces[0])
  })
})

describe('original source line mapping', () => {
  it('uses the native fast path only for the complete canonical source', () => {
    const source = createLiveSketch().source
    expect(isOriginalSketch(source)).toBe(true)
    expect(isOriginalSketch(source.replace(/\n/g, '\r\n'))).toBe(true)
    expect(isOriginalSketch(source + '\nwt = 4;')).toBe(false)
    expect(isOriginalSketch(source + '\n// Extra commentary')).toBe(false)
    expect(isOriginalSketch('// Extra commentary\n' + source)).toBe(false)
    expect(isOriginalSketch(source.replace('let wt = 2;', 'let wt = 4;'))).toBe(false)
    expect(isOriginalSketch(source.replace('let speed = 1;', 'let speed = 3;'))).toBe(false)
    expect(isOriginalSketch('')).toBe(false)
  })

  it('maps changed hash bytes only to original expressions, with shape before seed', () => {
    const sketch = createLiveSketch()
    const textFor = (id: string) => sketch.lines.find(line => line.id === id)!.text
    const hueIds = affectedScriptLines(DEFAULT_HASH, setByte(DEFAULT_HASH, 29, 1))
    expect(textFor(hueIds[0]!)).toContain('decPairs[29]')
    const shapeIds = affectedScriptLines(DEFAULT_HASH, setByte(DEFAULT_HASH, 4, 1))
    expect(textFor(shapeIds[0]!)).toContain('decPairs[j')
    expect(shapeIds.map(textFor).some(text => text.includes('seed = parseInt'))).toBe(true)
    expect(affectedScriptLines(DEFAULT_HASH, setByte(DEFAULT_HASH, 21, 1))).toEqual([])
    expect(affectedScriptLines(DEFAULT_HASH, DEFAULT_HASH)).toEqual([])
    expect([...hueIds, ...shapeIds].every(id => id.startsWith('original-'))).toBe(true)
    expect(createLiveSketch().source).toBe(sketch.source)
  })

  it.each([
    ['background', '#191919', 'background(backgroundArray[backgroundIndex])'],
    ['speed', 3, 'let speed ='],
    ['playing', true, 'let loops ='],
  ] as const)('maps %s changes to its original expression', (key, value, expression) => {
    const ids = affectedScriptLines(DEFAULT_HASH, DEFAULT_HASH, view, { ...view, [key]: value })
    const lines = createLiveSketch().lines
    expect(ids).toHaveLength(1)
    expect(ids[0]).toMatch(/^original-\d+$/)
    expect(lines.find(line => line.id === ids[0])!.text).toContain(expression)
  })

  it('preserves custom source text and stable IDs for unchanged original expressions', () => {
    const original = createLiveSketch()
    const custom = '// A custom addition\n' + original.source.replace('let wt = 2;', 'let wt = 3;')
    const lines = sketchLines(custom)
    expect(lines.map(line => line.text).join('\n')).toBe(custom)
    expect(new Set(lines.map(line => line.id)).size).toBe(lines.length)
    expect(lines.find(line => line.text === 'let wt = 3;')!.id).toMatch(/^custom-/)
    const originalHue = original.lines.find(line => line.text.includes('let startColor = decPairs[29]'))!
    expect(lines.find(line => line.text === originalHue.text)!.id).toBe(originalHue.id)
  })
})
