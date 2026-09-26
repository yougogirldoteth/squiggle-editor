import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import rawOriginal from '../app/data/snowfro-script.js?raw'
import { buildGeometry, decodeHash, drawSquiggle } from '../app/utils/squiggle'

// Execute the verified script and the relevant methods from its actual p5 1.0.0
// dependency. The oracle never imports the port's curve, RNG, trait or color math.
const p5Source = readFileSync(new URL('../public/vendor/p5-1.0.0.js', import.meta.url), 'utf8')
const colorConversion: Record<string, (...args: any[]) => any> = {}
const dependencies = {
  _main: { default: { _validateParameters() {}, ColorConversion: colorConversion } },
  _color_conversion: { default: colorConversion },
  constants: { HSB: 'hsb', HSL: 'hsl', RGB: 'rgb' },
  hypot: Math.hypot, styleEmpty: '',
}
function p5Method(path: string): (...args: any[]) => any {
  const marker = `${path} = function`
  const assignment = p5Source.indexOf(marker)
  if (assignment < 0) throw new Error(`Missing vendored p5 method ${path}`)
  const start = assignment + `${path} = `.length
  const end = p5Source.indexOf('\n          };', start)
  if (end < 0) throw new Error(`Missing end of vendored p5 method ${path}`)
  return new Function(...Object.keys(dependencies), `return (${p5Source.slice(start, end + '\n          }'.length)})`)(...Object.values(dependencies))
}
const curvePoint = p5Method('_main.default.prototype.curvePoint')
const map = p5Method('_main.default.prototype.map')
const dist = p5Method('_main.default.prototype.dist')
const ellipse = p5Method('_main.default.Renderer2D.prototype.ellipse')
colorConversion._hsbaToRGBA = p5Method('_main.default.ColorConversion._hsbaToRGBA')
const parseColor = p5Method('_main.default.Color._parseInputs')
const calculateLevels = p5Method('_main.default.Color.prototype._calculateLevels')
const colorState = { mode: 'hsb', maxes: { hsb: [255, 255, 255, 255] } }
type Color = readonly number[]
type Paint = { x: number; y: number; diameter: number; color: Color; kind: 'fill' | 'stroke'; weight: number; path: number[] }
function p5Color(values: number[]): Color {
  const color = { _array: parseColor.apply(colorState, values), levels: [] as number[] }
  calculateLevels.call(color)
  return [...color.levels.slice(0, 3), color._array[3]]
}

function originalFrame(hash: string, windowWidth: number, windowHeight: number, phase: number, background: number) {
  const paints: Paint[] = []
  const points: { x: number; y: number }[] = []
  let canvasWidth = 0, canvasHeight = 0, tx = 0, ty = 0, weight = 1
  let fill: Color | null = [255, 255, 255, 1], stroke: Color | null = [0, 0, 0, 1]
  let curveX: number | undefined
  const context = createContext({
    tokenData: { hashes: [hash] }, windowWidth, windowHeight,
    HSB: 'hsb', UP_ARROW: 38, DOWN_ARROW: 40, SHIFT: 16,
    document: { getElementsByTagName: () => [{ addEventListener() {} }] },
    createCanvas(width: number, height: number) {
      canvasWidth = context.width = width
      canvasHeight = context.height = height
    },
    colorMode() {}, background() {}, keyIsDown: () => false,
    map, dist,
    curvePoint(...args: number[]) {
      const value = curvePoint(...args)
      if (curveX === undefined) curveX = value
      else {
        points.push({ x: curveX + tx, y: value + ty })
        curveX = undefined
      }
      return value
    },
    translate(x: number, y: number) {
      tx = x + (windowWidth - canvasWidth) / 2
      ty = y + (windowHeight - canvasHeight) / 2
    },
    strokeWeight(value: number) { weight = value },
    fill(...values: number[]) { fill = p5Color(values) },
    stroke(...values: number[]) { stroke = p5Color(values) },
    noFill() { fill = null }, noStroke() { stroke = null },
    circle(x: number, y: number, diameter: number) {
      const path: number[] = []
      const drawingContext = {
        beginPath() {}, closePath() {},
        moveTo(px: number, py: number) { path.push(px + tx, py + ty) },
        bezierCurveTo(...values: number[]) { path.push(...values.map((value, index) => value + (index % 2 ? ty : tx))) },
        fill() { paints.push({ x: x + tx, y: y + ty, diameter, color: fill!, kind: 'fill', weight: 0, path }) },
        stroke() { paints.push({ x: x + tx, y: y + ty, diameter, color: stroke!, kind: 'stroke', weight, path }) },
      }
      ellipse.call({ drawingContext, _doFill: fill !== null, _doStroke: stroke !== null, _getFill: () => 'paint', _getStroke: () => 'paint' }, [x - diameter / 2, y - diameter / 2, diameter, diameter])
    },
  })
  runInContext(rawOriginal, context)
  runInContext(`setup(); index = ${phase}; backgroundArray[0] = ${background}; draw();`, context)
  return { paints, points, traits: runInContext('({startColor, reverse, slinky, pipe, bold, segmented, fuzzy, spread, segments, ht})', context) }
}

function nativeFrame(hash: string, width: number, height: number, phase: number, background: number) {
  const paints: Paint[] = []
  let circle = { x: 0, y: 0, diameter: 0 }
  let path: number[] = []
  const colors = new Map<string, Color>()
  const parseCss = (value: string): Color => {
    if (colors.has(value)) return colors.get(value)!
    const color = value === '#000' ? [0, 0, 0, 1] : value.match(/[\d.]+/g)!.map(Number)
    if (color.length === 3) color.push(1)
    colors.set(value, color)
    return color
  }
  const context = {
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', lineJoin: '', globalAlpha: 1, globalCompositeOperation: '',
    save() {}, restore() {}, clearRect() {}, fillRect() {}, beginPath() { path = [] }, closePath() {},
    moveTo(x: number, y: number) { path.push(x, y); circle = { x, y, diameter: 0 } },
    bezierCurveTo(...values: number[]) {
      if (path.length === 2) circle = { x: values[4]!, y: circle.y, diameter: (values[4]! - circle.x) * 2 }
      path.push(...values)
    },
    fill() { paints.push({ ...circle, color: parseCss(this.fillStyle), kind: 'fill', weight: 0, path }) },
    stroke() { paints.push({ ...circle, color: parseCss(this.strokeStyle), kind: 'stroke', weight: this.lineWidth, path }) },
  }
  drawSquiggle(context as unknown as CanvasRenderingContext2D, hash, width, height, { phase, background: `rgb(${background},${background},${background})` })
  return paints
}

// Encode inputs independently: otherwise a broken setType could silently remove
// the very trait combination that the renderer comparison is intended to test.
const base = Array.from({ length: 32 }, (_, i) => (i * 73 + 37) % 256)
function hashOf(changes: Record<number, number> = {}, source = base) {
  const bytes = [...source]
  for (const [index, value] of Object.entries(changes)) bytes[Number(index)] = value
  return `0x${bytes.map(value => value.toString(16).padStart(2, '0')).join('')}`
}
const flags = {
  Normal: { 22: 32, 23: 15, 24: 30, 31: 35 },
  Bold: { 22: 255, 23: 14, 24: 0, 31: 255 },
  Slinky: { 22: 32, 23: 0, 24: 0, 31: 34 },
  Ribbed: { 22: 32, 23: 15, 24: 29, 31: 35 },
  Pipe: { 22: 31, 23: 0, 24: 0, 31: 0 },
  Fuzzy: { 22: 31, 23: 0, 24: 0, 31: 35 },
}
const scenarios = [
  { name: 'short / Hyper / reverse', width: 900, height: 600, phase: 0, bytes: { 26: 0, 27: 0, 28: 0, 29: 0, 30: 0 } },
  { name: 'fractional / Hyper boundary / forward', width: 390, height: 514, phase: 0.1, bytes: { 26: 1, 27: 255, 28: 2, 29: 255, 30: 128 } },
  { name: 'fractional / spread boundary / reverse', width: 844, height: 390, phase: 254.9, bytes: { 26: 127, 27: 1, 28: 3, 29: 127, 30: 127 } },
  { name: 'near longest / wide spread / forward', width: 3000, height: 2000, phase: 255, bytes: { 26: 254, 27: 254, 28: 255, 29: 254, 30: 255 } },
  { name: 'longest / midpoint spread / reverse', width: 320, height: 568, phase: 1234.5, bytes: { 26: 255, 27: 128, 28: 128, 29: 255, 30: 127 } },
]

function compare(hash: string, width: number, height: number, phase = 0, background = 150) {
  const expected = originalFrame(hash, width, height, phase, background)
  const geometry = buildGeometry(hash, width, height)
  const traits = decodeHash(hash)
  for (const [key, value] of Object.entries(expected.traits)) {
    const actual = traits[key as keyof typeof traits]
    if (typeof value === 'number') expect(actual, key).toBeCloseTo(value, 12)
    else expect(actual, key).toBe(value)
  }
  expect(geometry.points.length).toBe(expected.points.length)
  let maxCoordinateError = 0
  for (let i = 0; i < expected.points.length; i++) {
    const a = geometry.points[i]!, e = expected.points[i]!
    maxCoordinateError = Math.max(maxCoordinateError, Math.abs(a.x - e.x), Math.abs(a.y - e.y))
  }
  const paints = nativeFrame(hash, width, height, phase, background)
  expect(paints.length).toBe(expected.paints.length)
  let maxColorError = 0
  let firstColorMismatch: unknown
  for (let i = 0; i < paints.length; i++) {
    const a = paints[i]!, e = expected.paints[i]!
    if (a.kind !== e.kind || a.weight !== e.weight) throw new Error(`Paint ${i}: ${JSON.stringify(a)} != ${JSON.stringify(e)}`)
    maxCoordinateError = Math.max(maxCoordinateError, Math.abs(a.x - e.x), Math.abs(a.y - e.y), Math.abs(a.diameter - e.diameter))
    if (a.path.length !== e.path.length) throw new Error(`Path command count differs in paint ${i}`)
    for (let j = 0; j < a.path.length; j++) maxCoordinateError = Math.max(maxCoordinateError, Math.abs(a.path[j]! - e.path[j]!))
    for (let channel = 0; channel < 3; channel++) maxColorError = Math.max(maxColorError, Math.abs(a.color[channel]! - e.color[channel]!))
    if (!firstColorMismatch && a.color.some((value, channel) => value !== e.color[channel])) firstColorMismatch = { hash, phase, paint: i, actual: a.color, expected: e.color }
    if (a.color[3] !== e.color[3]) throw new Error(`Alpha differs in paint ${i}`)
  }
  // Equivalent polynomial/map evaluation may differ by a few floating-point
  // ULPs; this is less than one billionth of a CSS pixel even at export size.
  expect(maxCoordinateError).toBeLessThan(1e-9)
  expect(maxColorError, JSON.stringify(firstColorMismatch)).toBe(0)
}

describe('native renderer versus verified Snowfro source and actual p5 1.0.0 math', () => {
  for (const [type, typeFlags] of Object.entries(flags)) {
    it.each(scenarios)(`${type}: $name`, ({ width, height, phase, bytes }) => compare(hashOf({ ...typeFlags, ...bytes }), width, height, phase))
  }

  it.each(Array.from({ length: 16 }, (_, mask) => mask))('honors overlapping type flags: mask %i', mask => {
    compare(hashOf({ 22: mask & 1 ? 31 : 32, 23: mask & 2 ? 14 : 15, 24: mask & 4 ? 29 : 30, 31: mask & 8 ? 34 : 35 }), 900, 600, 17)
  })

  it.each([0, 13, 14, 27, 28, 29].flatMap(rib => [0, 128, 255].map(gray => ({ rib, gray }))))('matches rib spacing $rib and grayscale $gray', ({ rib, gray }) => {
    compare(hashOf({ ...flags.Ribbed, 24: rib, 25: gray }), 900, 600, 1.5)
  })

  it.each([
    { name: 'zero seed and points', source: new Array(32).fill(0) },
    { name: 'maximum seed and points', source: new Array(32).fill(255) },
    { name: 'alternating extreme points', source: Array.from({ length: 32 }, (_, i) => i % 2 ? 255 : 0) },
    { name: '53-bit seed precision boundary', source: [0x80, 0, 0, 0, 0, 0, 1, ...base.slice(7)] },
    { name: 'maximum 56-bit seed', source: [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, ...base.slice(7)] },
  ])('matches Fuzzy conditional randomness: $name', ({ source }) => {
    compare(hashOf({ ...flags.Fuzzy, 26: 255, 27: 0 }, source), 900, 600, 0)
  })

  it('matches every original Fuzzy token 7 primitive, not only the first three fixture circles', () => {
    compare('0x3c17af010c7af574f5dab0f449e3e360212d9bc9521e16709aff20a8b0fb44ba', 900, 600)
  })
})
