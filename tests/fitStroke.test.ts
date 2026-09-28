import { describe, expect, it } from 'vitest'
import { fitStroke, type StrokePoint } from '../app/utils/fitStroke'
import { buildGeometry, DEFAULT_HASH, parseHash, setByte, setType, toHash, TYPES } from '../app/utils/squiggle'

const width = 900, height = 600
const wave = Array.from({ length: 161 }, (_, i) => ({ x: 100 + i * 4, y: 300 + 100 * Math.sin(i / 160 * Math.PI * 6) }))

function measuredError(hash: string, guide: StrokePoint[]) {
  const { points } = buildGeometry(hash, width, height)
  return Math.sqrt(guide.reduce((sum, point) => {
    const position = (point.x - points[0]!.x) / (points.at(-1)!.x - points[0]!.x) * (points.length - 1)
    const a = Math.floor(position), b = Math.min(points.length - 1, a + 1)
    const t = position - a
    const y = points[Math.max(0, a)]!.y * (1 - t) + points[b]!.y * t
    return sum + (y - point.y) ** 2
  }, 0) / guide.length)
}

describe('drawing a valid Squiggle', () => {
  it('fits a drawn wave with bounded error and reports the rendered error', () => {
    const fit = fitStroke(DEFAULT_HASH, wave, width, height)!
    expect(fit.hash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(fit.error).toBeLessThan(1)
    expect(measuredError(fit.hash, fit.guide)).toBeCloseTo(fit.error, 0)
  })

  it.each([0, 1, 32, 100, 254, 255])('recovers the shape of an original curve at segment byte %i', segmentByte => {
    const bytes = parseHash(setByte(DEFAULT_HASH, 26, segmentByte))
    // Keep this fixture within the representable vertical bounds after centering.
    for (let i = 0; i < 21; i++) bytes[i] = 128 + Math.round(60 * Math.sin(i * 0.9))
    const hash = toHash(bytes)
    const points = buildGeometry(hash, width, height).points.filter((_, i) => i % 5 === 0)
    const fit = fitStroke(hash, points, width, height)!
    expect(fit.error).toBeLessThan(0.7)
    expect(measuredError(fit.hash, fit.guide)).toBeLessThan(1)
  })

  it.each(TYPES)('preserves %s and every non-geometric hash byte', type => {
    const original = setType(DEFAULT_HASH, type)
    const fit = fitStroke(original, wave, width, height)!
    const before = parseHash(original), after = parseHash(fit.hash)
    for (let i = 21; i < 32; i++) if (i !== 26 && i !== 27) expect(after[i]).toBe(before[i])
  })

  it('is deterministic and independent of drawing direction or sampling density', () => {
    const sparse = [{ x: 30, y: 20 }, { x: 100, y: 100 }, { x: 200, y: 40 }, { x: 260, y: 90 }]
    const dense = sparse.flatMap((point, i) => {
      const end = sparse[i + 1]
      return end ? Array.from({ length: i === 0 ? 1000 : 30 }, (_, j) => ({ x: point.x + (end.x - point.x) * j / (i === 0 ? 1000 : 30), y: point.y + (end.y - point.y) * j / (i === 0 ? 1000 : 30) })) : [point]
    })
    const fit = fitStroke(DEFAULT_HASH, sparse, width, height)!
    expect(fitStroke(DEFAULT_HASH, sparse, width, height)).toEqual(fit)
    expect(fitStroke(DEFAULT_HASH, sparse.toReversed(), width, height)!.hash).toBe(fit.hash)
    expect(fitStroke(DEFAULT_HASH, dense, width, height)!.hash).toBe(fit.hash)
  })

  it('handles a straight line, backtracking, tall drawings and viewport changes', () => {
    const loop = Array.from({ length: 160 }, (_, i) => ({ x: 200 + i * 2 + 50 * Math.sin(i / 8), y: 300 + 300 * Math.cos(i / 8) }))
    for (const stroke of [[{ x: 20, y: 100 }, { x: 800, y: 100 }], loop, wave.map(point => ({ x: point.x, y: point.y * 10 }))]) {
      for (const [w, h] of [[width, height], [320, 480], [700, 180]]) {
        const fit = fitStroke(DEFAULT_HASH, stroke, w!, h!)!
        expect(Number.isFinite(fit.error)).toBe(true)
        expect(parseHash(fit.hash)).toHaveLength(32)
        const geometry = buildGeometry(fit.hash, w!, h!)
        for (const point of geometry.points) expect(point.y).toBeGreaterThan(0)
        for (const point of geometry.points) expect(point.y).toBeLessThan(h!)
      }
    }
  })

  it('rejects taps, vertical strokes and invalid input without producing a hash', () => {
    for (const points of [[], [{ x: 1, y: 1 }], [{ x: 1, y: 1 }, { x: 2, y: 1 }], [{ x: 1, y: 0 }, { x: 1, y: 200 }], [{ x: NaN, y: 0 }, { x: 300, y: 200 }], [{ x: 0, y: 0 }, { x: Infinity, y: 200 }]]) {
      expect(fitStroke(DEFAULT_HASH, points, width, height)).toBeNull()
    }
    expect(fitStroke(DEFAULT_HASH, wave, 0, height)).toBeNull()
    expect(fitStroke(DEFAULT_HASH, wave, width, Infinity)).toBeNull()
  })
})
