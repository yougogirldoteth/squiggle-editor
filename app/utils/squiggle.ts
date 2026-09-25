/**
 * Chromie Squiggle's hash rules and a Canvas implementation of its drawing loop.
 * Artwork and original algorithm by Snowfro. Reference: generator.artblocks.io/0.
 * See THIRD_PARTY_NOTICES.md for provenance and the limits of pixel equivalence.
 */
export const TYPES = ['Normal', 'Bold', 'Slinky', 'Ribbed', 'Pipe', 'Fuzzy'] as const
export type SquiggleType = typeof TYPES[number]

export const DEFAULT_HASH = '0x722899b10c66da3b72fb60a8e71df442ee1c004547ba2227d76bed357469b4ea'

export interface SquiggleTraits {
  bytes: number[]
  type: SquiggleType
  startColor: number
  reverse: boolean
  hyper: boolean
  spread: number
  segments: number
  ht: number
  slinky: boolean
  pipe: boolean
  bold: boolean
  segmented: boolean
  fuzzy: boolean
}

export interface CurveLocation {
  x: number
  y: number
  segment: number
  t: number
}

export interface CurveSample extends CurveLocation {
  baseHue: number
  isEndpoint: boolean
  isSegmentMarker: boolean
  // The original circle() argument is a diameter, despite the port naming it r.
  fuzz: { x: number, y: number, diameter: number } | null
}

export interface SquiggleFrame {
  controls: { x: number, y: number, byteIndex: number }[]
  traits: SquiggleTraits
  squigW: number
  squigH: number
  steps: number
  mainDiameter: number
  segmentedDiameter: number
  pipeDiameter: number
  pickRadius: number
}

export interface SquiggleGeometry extends SquiggleFrame {
  points: CurveSample[]
}

export function parseHash(hash: string): number[] {
  const normalized = hash.trim()
  if (!/^0x[\da-f]{64}$/i.test(normalized)) {
    throw new Error('Enter a 32-byte hash: 0x followed by 64 hexadecimal characters.')
  }
  return Array.from({ length: 32 }, (_, index) => Number.parseInt(normalized.slice(2 + index * 2, 4 + index * 2), 16))
}

function byte(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('A hash byte must be finite.')
  return Math.min(255, Math.max(0, Math.round(value)))
}

export function toHash(bytes: readonly number[]): string {
  if (bytes.length !== 32) throw new RangeError('A hash contains exactly 32 bytes.')
  return `0x${bytes.map(value => byte(value).toString(16).padStart(2, '0')).join('')}`
}

export function decodeHash(hash: string): SquiggleTraits {
  const bytes = parseHash(hash)
  const slinky = bytes[31]! < 35
  const pipe = bytes[22]! < 32
  const bold = bytes[23]! < 15
  const segmented = bytes[24]! < 30
  const fuzzy = pipe && !slinky
  const type: SquiggleType = slinky ? (pipe ? 'Pipe' : 'Slinky') : fuzzy ? 'Fuzzy' : bold ? 'Bold' : segmented ? 'Ribbed' : 'Normal'
  return {
    bytes, type, slinky, pipe, bold, segmented, fuzzy,
    startColor: bytes[29]!,
    reverse: bytes[30]! < 128,
    hyper: bytes[28]! < 3,
    spread: bytes[28]! < 3 ? 0.5 : 5 + 45 * (bytes[28]! / 255),
    segments: 12 + 8 * (bytes[26]! / 255),
    ht: 3 + bytes[27]! / 255,
  }
}

export function setByte(hash: string, index: number, value: number): string {
  if (!Number.isInteger(index) || index < 0 || index > 31) throw new RangeError('Byte index must be between 0 and 31.')
  const bytes = parseHash(hash)
  bytes[index] = byte(value)
  return toHash(bytes)
}

/** Change only the flags needed for the visible type; retain latent hash traits. */
export function setType(hash: string, type: SquiggleType): string {
  if (!TYPES.includes(type)) throw new RangeError('Unknown Squiggle type.')
  const bytes = parseHash(hash)
  const flag = (index: number, threshold: number, enabled: boolean) => {
    bytes[index] = enabled ? Math.min(bytes[index]!, threshold - 1) : Math.max(bytes[index]!, threshold)
  }
  flag(31, 35, type === 'Slinky' || type === 'Pipe')
  flag(22, 32, type === 'Pipe' || type === 'Fuzzy')
  if (type === 'Normal' || type === 'Bold' || type === 'Ribbed') {
    flag(23, 15, type === 'Bold')
    if (type !== 'Bold') flag(24, 30, type === 'Ribbed')
  }
  return toHash(bytes)
}

export function randomHash(): string {
  return toHash(Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32))))
}

function dimensions(width: number, height: number) {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width + height)) {
    throw new RangeError('Canvas dimensions must be finite and positive.')
  }
  const squigW = Math.min(width, height * 3 / 2)
  const squigH = squigW * 2 / 3
  return { squigW, squigH, offsetX: width / 2 - squigW / 4, offsetY: height / 2 }
}

/** p5.js curvePoint at its default tightness, with the original arithmetic order. */
function curve(a: number, b: number, c: number, d: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
}

function controlY(value: number, squigH: number, ht: number): number {
  return -squigH / ht + (2 * squigH / ht) * (value / 255)
}

function sample(traits: SquiggleTraits, size: ReturnType<typeof dimensions>, segment: number, t: number): CurveLocation {
  const xScale = size.squigW / traits.segments / 2
  return {
    x: size.offsetX + curve(xScale * segment, xScale * (segment + 1), xScale * (segment + 2), xScale * (segment + 3), t),
    y: size.offsetY + curve(
      controlY(traits.bytes[segment]!, size.squigH, traits.ht),
      controlY(traits.bytes[segment + 1]!, size.squigH, traits.ht),
      controlY(traits.bytes[segment + 2]!, size.squigH, traits.ht),
      controlY(traits.bytes[segment + 3]!, size.squigH, traits.ht), t,
    ),
    segment, t,
  }
}

function randomSequence(hash: string): () => number {
  // Deliberately retain Number parsing of 56 bits, its rounding, and signed >>.
  // Replacing this with BigInt, an unsigned shift, or a 32-bit seed changes Fuzzy.
  let seed = Number.parseInt(hash.slice(0, 16), 16)
  return () => {
    seed ^= seed << 13
    seed ^= seed >> 17
    seed ^= seed << 5
    return ((seed < 0 ? ~seed + 1 : seed) % 1000) / 1000
  }
}

/** Controls and picking dimensions without constructing the artwork samples. */
export function buildGeometryFrame(hash: string, width: number, height: number): SquiggleFrame {
  const traits = decodeHash(hash)
  const size = dimensions(width, height)
  const { squigW, squigH } = size
  const steps = traits.slinky ? 50 : traits.fuzzy ? 1000 : 200
  const segmentCount = Math.ceil(traits.segments - 2)
  const xScale = squigW / traits.segments / 2
  const controls = Array.from({ length: segmentCount + 3 }, (_, byteIndex) => ({
    byteIndex,
    x: size.offsetX + xScale * byteIndex,
    y: size.offsetY + controlY(traits.bytes[byteIndex]!, squigH, traits.ht),
  }))
  const mainDiameter = traits.bold && !traits.slinky ? squigH / 5 : squigH / 13
  const segmentedDiameter = squigH / 12
  const pipeDiameter = squigH / 7
  return {
    controls, traits, squigW, squigH, steps,
    mainDiameter, segmentedDiameter, pipeDiameter,
    pickRadius: traits.fuzzy ? squigH / 8 : (traits.slinky && traits.pipe ? pipeDiameter : traits.segmented && !traits.bold && !traits.slinky ? segmentedDiameter : mainDiameter) / 2,
  }
}

export function buildGeometry(hash: string, width: number, height: number): SquiggleGeometry {
  const frame = buildGeometryFrame(hash, width, height)
  const { traits, squigW, squigH, steps } = frame
  const normalizedHash = toHash(traits.bytes)
  const offsetX = width / 2 - squigW / 4
  const offsetY = height / 2
  const xScale = squigW / traits.segments / 2
  const div = Math.floor(3 + 17 * (traits.bytes[24]! / 230))
  const segmentCount = Math.ceil(traits.segments - 2)
  const points = new Array<CurveSample>(segmentCount * (steps + 1))
  let colorCounter = 0
  for (let segment = 0; segment < traits.segments - 2; segment++) {
    // These four controls are constant for every sample in this segment.
    const x0 = xScale * segment
    const x1 = xScale * (segment + 1)
    const x2 = xScale * (segment + 2)
    const x3 = xScale * (segment + 3)
    const y0 = controlY(traits.bytes[segment]!, squigH, traits.ht)
    const y1 = controlY(traits.bytes[segment + 1]!, squigH, traits.ht)
    const y2 = controlY(traits.bytes[segment + 2]!, squigH, traits.ht)
    const y3 = controlY(traits.bytes[segment + 3]!, squigH, traits.ht)
    // The original resets its seed after each segment, including the last.
    const rnd = randomSequence(normalizedHash)
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const x = offsetX + curve(x0, x1, x2, x3, t)
      const y = offsetY + curve(y0, y1, y2, y3, t)
      const isEndpoint = i === 0 || i === steps - 1
      let fuzz: CurveSample['fuzz'] = null
      if (traits.fuzzy) {
        const dx = rnd() * squigH / 10
        const dy = rnd() * squigH / 10
        if (Math.sqrt(dx * dx + dy * dy) < squigH / 11.5) {
          fuzz = {
            x: x + dx,
            y: y + dy,
            diameter: squigH / 160 + rnd() * (squigH / 16 - squigH / 160),
          }
        }
      }
      points[colorCounter] = {
        x, y, segment, t,
        baseHue: colorCounter / traits.spread + traits.startColor,
        isEndpoint,
        isSegmentMarker: traits.segmented && !traits.slinky && !traits.bold && (isEndpoint || i % div === 0),
        fuzz,
      }
      colorCounter++
    }
  }
  return { ...frame, points }
}

/** Find the nearest point on the actual centerline, independently of texture. */
export function nearestCurvePoint(hash: string, width: number, height: number, x: number, y: number): CurveLocation & { distance: number } {
  const traits = decodeHash(hash)
  const size = dimensions(width, height)
  if (!Number.isFinite(x + y)) throw new RangeError('Pointer coordinates must be finite.')
  let best = { ...sample(traits, size, 0, 0), distance: Infinity }
  const distanceSquared = (segment: number, t: number) => {
    const point = sample(traits, size, segment, t)
    return (point.x - x) ** 2 + (point.y - y) ** 2
  }
  const consider = (segment: number, t: number) => {
    const point = sample(traits, size, segment, t)
    const distance = Math.hypot(point.x - x, point.y - y)
    if (distance < best.distance) best = { ...point, distance }
  }
  for (let segment = 0; segment < traits.segments - 2; segment++) {
    // A cubic can have several local minima. Bracket each sampled minimum,
    // then refine it instead of snapping the interaction to renderer samples.
    const count = 32
    const distances = Array.from({ length: count + 1 }, (_, i) => distanceSquared(segment, i / count))
    consider(segment, 0)
    consider(segment, 1)
    for (let i = 0; i <= count; i++) {
      if (distances[i]! > (distances[i - 1] ?? Infinity) || distances[i]! > (distances[i + 1] ?? Infinity)) continue
      let low = Math.max(0, i - 1) / count
      let high = Math.min(count, i + 1) / count
      for (let step = 0; step < 24; step++) {
        const left = low + (high - low) / 3
        const right = high - (high - low) / 3
        if (distanceSquared(segment, left) < distanceSquared(segment, right)) high = right
        else low = left
      }
      consider(segment, (low + high) / 2)
    }
  }
  return best
}

/**
 * Fit a vertical pull to the four local hash bytes. X and the number of points
 * remain fixed. Use the drag's starting hash and its total delta on each event.
 */
export function dragCurve(hash: string, width: number, height: number, segment: number, t: number, deltaY: number): string {
  const traits = decodeHash(hash)
  const size = dimensions(width, height)
  if (!Number.isInteger(segment) || segment < 0 || segment >= Math.ceil(traits.segments - 2)) throw new RangeError('Invalid curve segment.')
  if (!Number.isFinite(t) || t < 0 || t > 1 || !Number.isFinite(deltaY)) throw new RangeError('Invalid curve displacement.')
  const t2 = t * t
  const t3 = t2 * t
  const weights = [-0.5 * t + t2 - 0.5 * t3, 1 - 2.5 * t2 + 1.5 * t3, 0.5 * t + 2 * t2 - 1.5 * t3, -0.5 * t2 + 0.5 * t3]
  const original = traits.bytes.slice(segment, segment + 4)
  const originalY = weights.reduce((sum, weight, i) => sum + weight * original[i]!, 0)
  const target = originalY + deltaY / (2 * size.squigH / traits.ht / 255)
  const minimum = weights.reduce((sum, weight) => sum + Math.min(0, weight * 255), 0)
  const maximum = weights.reduce((sum, weight) => sum + Math.max(0, weight * 255), 0)
  const reachableTarget = Math.max(minimum, Math.min(maximum, target))
  const fitted = [...original]
  const free = new Set(weights.map((_, i) => i).filter(i => Math.abs(weights[i]!) > 1e-12))
  // Active-set least squares: distribute movement with the Catmull–Rom basis,
  // fix saturated bytes at their bounds, and refit the remaining displacement.
  while (free.size) {
    let fixedMovement = 0
    for (let i = 0; i < 4; i++) if (!free.has(i)) fixedMovement += weights[i]! * (fitted[i]! - original[i]!)
    const norm = [...free].reduce((sum, i) => sum + weights[i]! ** 2, 0)
    const scale = (reachableTarget - originalY - fixedMovement) / norm
    const saturated: number[] = []
    for (const i of free) {
      const value = original[i]! + scale * weights[i]!
      if (value < 0 || value > 255) {
        fitted[i] = Math.max(0, Math.min(255, value))
        saturated.push(i)
      }
    }
    if (!saturated.length) {
      for (const i of free) fitted[i] = original[i]! + scale * weights[i]!
      break
    }
    for (const i of saturated) free.delete(i)
  }
  // Compare adjacent integer encodings, selecting the best representable pull.
  let quantized = fitted.map(byte)
  let bestError = Infinity
  let bestMovement = Infinity
  for (let mask = 0; mask < 16; mask++) {
    const candidate = fitted.map((value, i) => byte(mask & (1 << i) ? Math.ceil(value) : Math.floor(value)))
    const error = Math.abs(weights.reduce((sum, weight, i) => sum + weight * candidate[i]!, 0) - reachableTarget)
    const movement = candidate.reduce((sum, value, i) => sum + (value - original[i]!) ** 2, 0)
    if (error < bestError - 1e-10 || (Math.abs(error - bestError) <= 1e-10 && movement < bestMovement)) {
      quantized = candidate
      bestError = error
      bestMovement = movement
    }
  }
  quantized.forEach((value, i) => { traits.bytes[segment + i] = value })
  return toHash(traits.bytes)
}

function hueColor(hue: number, alpha = 1): string {
  const h = (((hue % 255) + 255) % 255) / 255 * 6
  const sector = Math.floor(h)
  const fraction = h - sector
  const rising = Math.round(fraction * 255)
  const falling = Math.round((1 - fraction) * 255)
  const rgb = [[255, rising, 0], [falling, 255, 0], [0, 255, rising], [0, falling, 255], [rising, 0, 255], [255, 0, falling]][sector % 6]!
  return alpha === 1 ? `rgb(${rgb.join(',')})` : `rgba(${rgb.join(',')},${alpha})`
}

// A single-entry memo avoids rebuilding thousands of Fuzzy samples per frame.
// The result depends only on this key and is never exposed or changed by drawing.
let drawingCache: { key: string, geometry: SquiggleGeometry } | undefined

export function drawSquiggle(ctx: CanvasRenderingContext2D, hash: string, width: number, height: number, options: { background: string, phase?: number }): void {
  const key = `${hash}|${width}|${height}`
  if (drawingCache?.key !== key) drawingCache = { key, geometry: buildGeometry(hash, width, height) }
  const geometry = drawingCache.geometry
  const { traits } = geometry
  const phase = options.phase ?? 0
  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = options.background
  ctx.fillRect(0, 0, width, height)
  ctx.lineWidth = geometry.squigH / 1200
  ctx.lineCap = 'round'
  ctx.lineJoin = 'miter'
  const circle = (x: number, y: number, diameter: number, fill: boolean, stroke: boolean) => {
    ctx.beginPath()
    ctx.arc(x, y, diameter / 2, 0, Math.PI * 2)
    if (fill) ctx.fill()
    if (stroke) ctx.stroke()
  }
  for (const point of geometry.points) {
    const shiftedHue = (point.baseHue + phase) % 255
    const hue = traits.reverse ? 255 - shiftedHue : shiftedHue
    if (traits.fuzzy) {
      if (point.fuzz) {
        ctx.fillStyle = hueColor(hue, 20 / 255)
        circle(point.fuzz.x, point.fuzz.y, point.fuzz.diameter, true, false)
      }
      continue
    }
    if (traits.slinky && traits.pipe) {
      ctx.fillStyle = '#000'
      ctx.strokeStyle = '#000'
      circle(point.x, point.y, geometry.pipeDiameter, point.isEndpoint, true)
    }
    const color = hueColor(hue)
    ctx.fillStyle = color
    ctx.strokeStyle = color
    circle(point.x, point.y, geometry.mainDiameter, !traits.slinky || point.isEndpoint, traits.slinky)
    if (point.isSegmentMarker) {
      const gray = traits.bytes[25]!
      ctx.fillStyle = `rgb(${gray},${gray},${gray})`
      circle(point.x, point.y, geometry.segmentedDiameter, true, false)
    }
  }
  ctx.restore()
}
