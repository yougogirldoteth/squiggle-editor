import { readFileSync } from 'node:fs'
import { createContext, Script } from 'node:vm'
import { describe, expect, it } from 'vitest'
import originalSource from '../app/data/snowfro-script.js?raw'
import { buildGeometry, decodeHash, DEFAULT_HASH, dragCurve, parseHash, setByte, setStartingHue, setType, toHash, TYPES, visibleStartHue } from '../app/utils/squiggle'

// Use the actual vendored p5 function as the geometry oracle, rather than the
// editor's curve polynomial or a second hand-written copy of that polynomial.
const p5Source = readFileSync(new URL('../public/vendor/p5-1.0.0.js', import.meta.url), 'utf8')
const curveDefinition = p5Source.match(/_main\.default\.prototype\.curvePoint = function\(a, b, c, d, t\) \{[\s\S]*?\n          \};/)![0]
const originalCurvePoint = new Script(`var _main = {default: {prototype: {}, _validateParameters() {}}};\n${curveDefinition}\n_main.default.prototype.curvePoint`).runInNewContext() as (...values: number[]) => number
const originalScript = new Script(originalSource)
const setupScript = new Script('setup()')
const drawScript = new Script('draw()')
const traitScript = new Script('({startColor, reverse, slinky, pipe, bold, segmented, fuzzy, segments, ht, spread})')

interface Mark {
  x: number
  y: number
  diameter: number
  fill: number[] | null
  stroke: number[] | null
  sample: number
}

function original(hash: string) {
  const points: { x: number, y: number }[] = []
  const marks: Mark[] = []
  const stop = new Error('Enough original drawing operations collected')
  let limit = Infinity
  let fill: number[] | null = [255]
  let stroke: number[] | null = [0]
  let offsetX = 0
  let offsetY = 0
  let pendingX: number | null = null
  const context = createContext({
    tokenData: { hashes: [hash] }, windowWidth: 900, windowHeight: 600,
    width: 900, height: 600, HSB: 'hsb', UP_ARROW: 38, DOWN_ARROW: 40, SHIFT: 16,
    document: { getElementsByTagName: () => [{ addEventListener() {} }] },
    createCanvas() {}, colorMode() {}, strokeWeight() {}, background() {},
    map(value: number, from: number, to: number, low: number, high: number) {
      return low + (high - low) * ((value - from) / (to - from))
    },
    translate(x: number, y: number) { offsetX += x; offsetY += y },
    fill(...values: number[]) { fill = values },
    stroke(...values: number[]) { stroke = values },
    noFill() { fill = null }, noStroke() { stroke = null },
    curvePoint(...values: number[]) {
      const value = originalCurvePoint(...values)
      if (pendingX === null) pendingX = value
      else { points.push({ x: pendingX + offsetX, y: value + offsetY }); pendingX = null }
      return value
    },
    circle(x: number, y: number, diameter: number) {
      marks.push({ x: x + offsetX, y: y + offsetY, diameter, fill, stroke, sample: points.length - 1 })
      if (marks.length >= limit) throw stop
    },
    dist(x: number, y: number, a: number, b: number) { return Math.hypot(a - x, b - y) },
    keyIsDown: () => false,
  })
  originalScript.runInContext(context)
  setupScript.runInContext(context)
  return {
    traits: traitScript.runInContext(context),
    draw(markLimit = Infinity) {
      limit = markLimit
      try { drawScript.runInContext(context) } catch (error) { if (error !== stop) throw error }
      return { points, marks }
    },
  }
}

function paintedType(marks: Mark[]) {
  if (marks.some(mark => mark.fill?.[3] === 20)) return 'Fuzzy'
  if (marks.some(mark => mark.diameter === 600 / 7)) return 'Pipe'
  if (marks.some(mark => mark.stroke !== null)) return 'Slinky'
  if (marks.some(mark => mark.diameter === 600 / 5)) return 'Bold'
  if (marks.some(mark => mark.diameter === 600 / 12)) return 'Ribbed'
  return 'Normal'
}

describe('controls against the unmodified original script', () => {
  it.each([22, 23, 24, 26, 27, 28, 29, 30, 31])('decodes all 256 values of byte %i as the original does', (index) => {
    for (let value = 0; value <= 255; value++) {
      const hash = setByte(DEFAULT_HASH, index, value)
      const expected = original(hash).traits
      const actual = decodeHash(hash)
      for (const key of ['startColor', 'reverse', 'slinky', 'pipe', 'bold', 'segmented', 'fuzzy'] as const) {
        expect(actual[key], `byte ${index} = ${value}, ${key}`).toBe(expected[key])
      }
      for (const key of ['segments', 'ht', 'spread'] as const) expect(actual[key]).toBeCloseTo(expected[key], 12)
    }
  })

  it('switches all 16 latent flag combinations to every type using the fewest changed bytes', () => {
    const flagBytes = [22, 23, 24, 31]
    const variants = Array.from({ length: 16 }, (_, mask) => {
      const bytes = parseHash(DEFAULT_HASH)
      flagBytes.forEach((index, bit) => { bytes[index] = mask & (1 << bit) ? 0 : 255 })
      const hash = toHash(bytes)
      return { bytes, hash, type: paintedType(original(hash).draw(4).marks) }
    })
    for (const input of variants) {
      for (const type of TYPES) {
        const output = setType(input.hash, type)
        const bytes = parseHash(output)
        expect(paintedType(original(output).draw(4).marks)).toBe(type)
        const changed = bytes.flatMap((value, index) => value !== input.bytes[index] ? [index] : [])
        const minimumChanges = Math.min(...variants.filter(variant => variant.type === type).map(variant =>
          flagBytes.filter(index => variant.bytes[index] !== input.bytes[index]).length))
        expect(changed).toHaveLength(minimumChanges)
        expect(changed.every(index => flagBytes.includes(index))).toBe(true)
        expect(setType(output, type)).toBe(output)
      }
    }
  })

  it.each([false, true])('maps every selected starting hue to the original first paint, reverse=%s', (reverse) => {
    const initial = setByte(setType(DEFAULT_HASH, 'Normal'), 30, reverse ? 127 : 128)
    for (let hue = 0; hue <= 255; hue++) {
      const hash = setStartingHue(initial, hue)
      const firstPaint = original(hash).draw(1).marks[0]!.fill![0]!
      // The original's hue 255 and hue 0 both denote red.
      expect(firstPaint % 255).toBe(hue % 255)
      expect(visibleStartHue(decodeHash(hash))).toBe(hue)
      expect(parseHash(hash).filter((_, i) => i !== 29)).toEqual(parseHash(initial).filter((_, i) => i !== 29))
    }
  })

  it('preserves the original rib marker sample positions and grayscale for every spacing byte', () => {
    const initial = setType(DEFAULT_HASH, 'Ribbed')
    for (let spacing = 0; spacing < 30; spacing++) {
      const gray = spacing * 8
      const hash = setByte(setByte(initial, 24, spacing), 25, gray)
      const marks = original(hash).draw(300).marks.filter(mark => mark.diameter === 600 / 12 && mark.sample < 201)
      const geometry = buildGeometry(hash, 900, 600)
      const expectedSamples = geometry.points.slice(0, 201).flatMap((point, i) => point.isSegmentMarker ? [i] : [])
      expect(marks.map(mark => mark.sample)).toEqual(expectedSamples)
      expect(marks.every(mark => mark.fill?.length === 1 && mark.fill[0] === gray)).toBe(true)
    }
  })

  it.each(['Normal', 'Slinky', 'Fuzzy'] as const)('keeps constrained %s edits on the original curve with fixed X and latent bytes', (type) => {
    let hash = setType(DEFAULT_HASH, type)
    hash = setByte(setByte(hash, 26, 137), 27, 53)
    const before = original(hash).draw().points
    const edited = dragCurve(hash, 900, 600, 4, 0.371, 83.25)
    const reconstructed = toHash(parseHash(edited.toUpperCase()))
    const reference = original(reconstructed).draw()
    const geometry = buildGeometry(reconstructed, 900, 600)
    expect(reference.points).toHaveLength(geometry.points.length)
    let largestError = 0
    for (const [i, point] of geometry.points.entries()) {
      largestError = Math.max(largestError, Math.abs(point.x - reference.points[i]!.x), Math.abs(point.y - reference.points[i]!.y))
      expect(reference.points[i]!.x).toBe(before[i]!.x)
    }
    expect(largestError).toBeLessThan(1e-10)
    const bytes = parseHash(edited)
    expect(bytes.every(value => Number.isInteger(value) && value >= 0 && value <= 255)).toBe(true)
    expect(bytes.filter((_, i) => i < 4 || i > 7)).toEqual(parseHash(hash).filter((_, i) => i < 4 || i > 7))
    if (type === 'Fuzzy') {
      const fuzz = geometry.points.flatMap(point => point.fuzz ? [point.fuzz] : [])
      expect(reference.marks).toHaveLength(fuzz.length)
      expect(Math.max(...fuzz.map((point, i) => Math.abs(point.diameter - reference.marks[i]!.diameter)))).toBeLessThan(1e-10)
    }
  })
})
