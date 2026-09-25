import { describe, expect, it } from 'vitest'
import { buildGeometry, buildGeometryFrame, DEFAULT_HASH, dragCurve, parseHash, setByte, setType, toHash, TYPES } from '../app/utils/squiggle'

describe('lightweight interaction geometry', () => {
  it.each(TYPES)('matches the complete %s renderer without allocating its samples', (type) => {
    const hash = setType(DEFAULT_HASH, type)
    for (const [width, height] of [[1200, 800], [390, 514]]) {
      const frame = buildGeometryFrame(hash, width!, height!)
      const { points, ...renderFrame } = buildGeometry(hash, width!, height!)
      expect(frame).toEqual(renderFrame)
      expect(frame).not.toHaveProperty('points')
      expect(frame.controls.length).toBeLessThanOrEqual(21)
      expect(points.length).toBeGreaterThan(500)
    }
  })

  it('retains fractional length, height and selected texture picking dimensions', () => {
    let hash = setType(DEFAULT_HASH, 'Fuzzy')
    hash = setByte(setByte(hash, 26, 1), 27, 0)
    const frame = buildGeometryFrame(hash, 900, 600)
    expect(frame.traits.segments).toBeCloseTo(12 + 8 / 255, 12)
    expect(frame.controls).toHaveLength(14)
    expect(frame.traits.ht).toBe(3)
    expect(frame.pickRadius).toBe(75)
    expect(() => buildGeometryFrame(hash, 0, 600)).toThrow()
  })
})

describe('anchored quantized drag continuity', () => {
  const startingHash = toHash(Array<number>(32).fill(128))
  const startingBytes = parseHash(startingHash)
  const segment = 4

  it.each([0.01, 0.12, 0.371, 0.5, 0.88, 0.99])('keeps small unsaturated pulls at t=%f within adjacent byte encodings', (t) => {
    let previous = parseHash(dragCurve(startingHash, 900, 600, segment, t, -40))
    let largestByteStep = 0
    let changedOutsideAnchor = false
    let invalidByte = false
    let saturated = false
    // Each update uses the same starting hash and curve location. This sweep
    // catches a jump in fitted control allocation, independently of UI timing.
    for (let step = -399; step <= 400; step++) {
      const next = parseHash(dragCurve(startingHash, 900, 600, segment, t, step / 10))
      next.forEach((value, index) => {
        if (index < segment || index > segment + 3) changedOutsideAnchor ||= value !== startingBytes[index]
        else {
          largestByteStep = Math.max(largestByteStep, Math.abs(value - previous[index]!))
          saturated ||= value === 0 || value === 255
        }
        invalidByte ||= !Number.isInteger(value) || value < 0 || value > 255
      })
      previous = next
    }
    // Choosing among adjacent integer fits can cross two byte values when its
    // continuous optimum crosses an integer; it must not reallocate the curve.
    expect(largestByteStep).toBeLessThanOrEqual(2)
    expect(changedOutsideAnchor).toBe(false)
    expect(invalidByte).toBe(false)
    expect(saturated).toBe(false)
  })

  it('allows intermediate pointer events to be coalesced without drift or lag', () => {
    const t = 0.371
    const destination = 47.3
    const directly = dragCurve(startingHash, 900, 600, segment, t, destination)
    for (const samples of [1, 12, 60, 120]) {
      let latest = startingHash
      for (let sample = 1; sample <= samples; sample++) {
        latest = dragCurve(startingHash, 900, 600, segment, t, sample === samples ? destination : destination * sample / samples)
      }
      expect(latest).toBe(directly)
    }
    expect(dragCurve(startingHash, 900, 600, segment, t, 0)).toBe(startingHash)
  })

  it('returns to the starting encoding after saturated pulls with the same anchor', () => {
    let hash = startingHash
    for (const [index, value] of [[4, 0], [5, 255], [6, 2], [7, 253]]) hash = setByte(hash, index!, value!)
    const bytes = parseHash(hash)
    for (const displacement of [-10000, 10000, -0.1, 0.1]) {
      const output = parseHash(dragCurve(hash, 900, 600, segment, 0.5, displacement))
      expect(output.every(value => Number.isInteger(value) && value >= 0 && value <= 255)).toBe(true)
      expect(output.filter((_, index) => index < 4 || index > 7)).toEqual(bytes.filter((_, index) => index < 4 || index > 7))
    }
    expect(dragCurve(hash, 900, 600, segment, 0.5, 0)).toBe(hash)
  })
})
