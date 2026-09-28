import { buildGeometryFrame, parseHash, toHash } from './squiggle'

export interface StrokePoint { x: number; y: number }
export interface StrokeFit {
  hash: string
  /** The drawn line, scaled and centered into the script's drawing area. */
  guide: StrokePoint[]
  /** Root mean squared vertical distance from the guide, in canvas pixels. */
  error: number
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))

// Equal distance along the stroke gives slow and fast pointer movements the
// same weight. Keep the numeric fit bounded even after a long drawing gesture.
function resample(points: readonly StrokePoint[], count = 256): StrokePoint[] {
  const distances = [0]
  for (let i = 1; i < points.length; i++) {
    distances.push(distances[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y))
  }
  const length = distances.at(-1)!
  if (length < 16) return []
  let segment = 1
  return Array.from({ length: count }, (_, i) => {
    const distance = length * i / (count - 1)
    while (segment < points.length - 1 && distances[segment]! <= distance) segment++
    const a = points[segment - 1]!
    const b = points[segment]!
    const span = distances[segment]! - distances[segment - 1]!
    const t = span ? (distance - distances[segment - 1]!) / span : 0
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
  })
}

function basis(position: number, segments: number) {
  const index = Math.min(segments - 1, Math.floor(position))
  const t = position - index
  const t2 = t * t
  const t3 = t2 * t
  return { index, weights: [-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1, -1.5 * t3 + 2 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2] }
}

// The normal matrix is positive definite after a tiny diagonal regularizer.
// Cholesky gives a good starting point before enforcing the hash's byte bounds.
function solve(matrix: Float64Array[], rhs: Float64Array): number[] {
  const size = rhs.length
  const lower = Array.from({ length: size }, () => new Float64Array(size))
  for (let i = 0; i < size; i++) {
    for (let j = 0; j <= i; j++) {
      let value = matrix[i]![j]!
      for (let k = 0; k < j; k++) value -= lower[i]![k]! * lower[j]![k]!
      lower[i]![j] = i === j ? Math.sqrt(Math.max(1e-12, value)) : value / lower[j]![j]!
    }
  }
  const result = Array<number>(size).fill(0)
  for (let i = 0; i < size; i++) {
    let value = rhs[i]!
    for (let j = 0; j < i; j++) value -= lower[i]![j]! * result[j]!
    result[i] = value / lower[i]![i]!
  }
  for (let i = size - 1; i >= 0; i--) {
    let value = result[i]!
    for (let j = i + 1; j < size; j++) value -= lower[j]![i]! * result[j]!
    result[i] = value / lower[i]![i]!
  }
  return result
}

function refine(matrix: Float64Array[], rhs: Float64Array, values: number[], limit: number, passes: number, quantize = false) {
  const step = 2 * limit / 255
  for (let pass = 0; pass < passes; pass++) {
    let change = 0
    for (let i = 0; i < values.length; i++) {
      let value = rhs[i]!
      // A cubic sample touches four adjacent controls, so all other entries
      // are zero. This also keeps the height/quantization search inexpensive.
      for (let j = Math.max(0, i - 3); j <= Math.min(values.length - 1, i + 3); j++) {
        if (i !== j) value -= matrix[i]![j]! * values[j]!
      }
      let next = clamp(value / matrix[i]![i]!, -limit, limit)
      if (quantize) next = Math.round((next + limit) / step) * step - limit
      change += Math.abs(next - values[i]!)
      values[i] = next
    }
    if (change < 1e-9) break
  }
}

/**
 * Fit a single drawn line to the original, uniformly spaced Catmull–Rom curve.
 * Drawing placement is normalized; aspect ratio is retained until the script's
 * maximum height is reached. Backtracking is fitted in least squares, since a
 * valid Squiggle cannot loop horizontally. Only geometry bytes are changed.
 */
export function fitStroke(hash: string, stroke: readonly StrokePoint[], width: number, height: number): StrokeFit | null {
  if (stroke.length < 2 || stroke.length > 16384 || !(width > 0 && height > 0) || !Number.isFinite(width + height)) return null
  if (stroke.some(point => !Number.isFinite(point.x + point.y) || Math.abs(point.x) > 1e7 || Math.abs(point.y) > 1e7)) return null
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const point of stroke) {
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y)
  }
  if (maxX - minX < 12) return null
  const points = resample(stroke)
  if (!points.length) return null
  const original = parseHash(hash)
  const currentCount = Math.ceil(10 + 8 * original[26]! / 255)
  const squigH = Math.min(height, width * 2 / 3)
  let best: StrokeFit | null = null
  let bestPreference = Infinity

  // Fractional segment values still render a whole number of cubic segments.
  // Search all nine curve complexities, retaining the current fractional
  // value where possible; otherwise use the nearest byte for that complexity.
  for (let count = 10; count <= 18; count++) {
    const bytes = [...original]
    const low = count === 10 ? 0 : Math.floor((count - 11) * 255 / 8) + 1
    const high = Math.floor((count - 10) * 255 / 8)
    bytes[26] = clamp(original[26]!, low, high)
    const frame = buildGeometryFrame(toHash(bytes), width, height)
    const left = frame.controls[1]!.x
    const span = frame.controls[count + 1]!.x - left
    const scale = Math.min(span / (maxX - minX), maxY === minY ? Infinity : squigH * 0.6 / (maxY - minY))
    const guide = points.map(point => ({ x: left + (point.x - minX) / (maxX - minX) * span, y: height / 2 + (point.y - (minY + maxY) / 2) * scale }))
    const rows = guide.map(point => ({ ...basis(clamp((point.x - left) / span, 0, 1) * count, count), y: (point.y - height / 2) / squigH }))
    const size = count + 3
    const matrix = Array.from({ length: size }, (_, i) => {
      const row = new Float64Array(size)
      row[i] = 1e-6
      return row
    })
    const rhs = new Float64Array(size)
    for (const { index, weights, y } of rows) {
      for (let i = 0; i < 4; i++) {
        rhs[index + i]! += weights[i]! * y
        for (let j = 0; j < 4; j++) matrix[index + i]![index + j]! += weights[i]! * weights[j]!
      }
    }
    const continuous = solve(matrix, rhs).map(value => clamp(value, -1 / 3, 1 / 3))
    refine(matrix, rhs, continuous, 1 / 3, 80)

    for (let ht = 0; ht <= 255; ht++) {
      const limit = 1 / (3 + ht / 255)
      const values = continuous.map(value => Math.round(clamp((value / limit + 1) * 127.5, 0, 255)) / 127.5 * limit - limit)
      refine(matrix, rhs, values, limit, 6, true)
      let squaredError = 0
      for (const { index, weights, y } of rows) {
        const predicted = weights.reduce((sum, weight, i) => sum + weight * values[index + i]!, 0)
        squaredError += (predicted - y) ** 2
      }
      const error = Math.sqrt(squaredError / rows.length) * squigH
      const preference = Math.abs(count - currentCount) * 256 + Math.abs(ht - original[27]!)
      if (best && (error > best.error + 1e-7 || (Math.abs(error - best.error) <= 1e-7 && preference >= bestPreference))) continue
      for (let i = 0; i < size; i++) bytes[i] = Math.round((values[i]! / limit + 1) * 127.5)
      bytes[27] = ht
      best = { hash: toHash(bytes), guide, error }
      bestPreference = preference
    }
  }
  return best
}
