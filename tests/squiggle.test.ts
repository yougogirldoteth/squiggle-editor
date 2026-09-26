import { describe, expect, it } from 'vitest'
import { buildGeometry, decodeHash, DEFAULT_HASH, dragCurve, drawSquiggle, nearestCurvePoint, parseHash, randomHash, setByte, setType, toHash, TYPES } from '../app/utils/squiggle'

describe('hash encoding and original trait rules', () => {
  it('round trips all 32 bytes and rejects malformed imports', () => {
    expect(toHash(parseHash(DEFAULT_HASH))).toBe(DEFAULT_HASH)
    expect(toHash(parseHash(`  ${DEFAULT_HASH.toUpperCase()}  `))).toBe(DEFAULT_HASH)
    for (const invalid of ['', '0x00', DEFAULT_HASH.slice(2), `${DEFAULT_HASH}00`, DEFAULT_HASH.replace('7', 'g')]) {
      expect(() => parseHash(invalid)).toThrow()
    }
    expect(() => toHash([1, 2])).toThrow()
    expect(() => setByte(DEFAULT_HASH, 32, 5)).toThrow()
    expect(() => setByte(DEFAULT_HASH, 0, Number.NaN)).toThrow()
  })

  it('quantizes and clamps bytes without touching unrelated data', () => {
    const modified = setByte(setByte(setByte(DEFAULT_HASH, 0, -100), 1, 300), 2, 74.6)
    expect(parseHash(modified).slice(0, 3)).toEqual([0, 255, 75])
    expect(parseHash(modified).slice(3)).toEqual(parseHash(DEFAULT_HASH).slice(3))
    expect(parseHash(randomHash())).toHaveLength(32)
  })

  it('preserves non-rounded segment counts and the original Hyper discontinuity', () => {
    expect(decodeHash(setByte(DEFAULT_HASH, 26, 1)).segments).toBeCloseTo(12 + 8 / 255, 14)
    expect(decodeHash(setByte(DEFAULT_HASH, 27, 0)).ht).toBe(3)
    expect(decodeHash(setByte(DEFAULT_HASH, 27, 255)).ht).toBe(4)
    for (const value of [0, 1, 2]) {
      expect(decodeHash(setByte(DEFAULT_HASH, 28, value))).toMatchObject({ hyper: true, spread: 0.5 })
    }
    expect(decodeHash(setByte(DEFAULT_HASH, 28, 3))).toMatchObject({ hyper: false })
    expect(decodeHash(setByte(DEFAULT_HASH, 28, 3)).spread).toBeCloseTo(5.529411764705882)
    expect(decodeHash(setByte(DEFAULT_HASH, 28, 255)).spread).toBe(50)
    expect(decodeHash(setByte(DEFAULT_HASH, 30, 127)).reverse).toBe(true)
    expect(decodeHash(setByte(DEFAULT_HASH, 30, 128)).reverse).toBe(false)
  })

  it('applies the exact flag thresholds and visual precedence', () => {
    const base = toHash(Array<number>(32).fill(255))
    expect(decodeHash(setByte(base, 23, 14)).type).toBe('Bold')
    expect(decodeHash(setByte(base, 23, 15)).type).toBe('Normal')
    expect(decodeHash(setByte(base, 24, 29)).type).toBe('Ribbed')
    expect(decodeHash(setByte(base, 24, 30)).type).toBe('Normal')
    expect(decodeHash(setByte(base, 31, 34)).type).toBe('Slinky')
    expect(decodeHash(setByte(base, 31, 35)).type).toBe('Normal')
    expect(decodeHash(setByte(base, 22, 31)).type).toBe('Fuzzy')
    expect(decodeHash(setByte(base, 22, 32)).type).toBe('Normal')
    let hash = setByte(setByte(base, 24, 0), 23, 0)
    expect(decodeHash(hash).type).toBe('Bold')
    hash = setByte(hash, 22, 0)
    expect(decodeHash(hash).type).toBe('Fuzzy')
    hash = setByte(hash, 31, 0)
    expect(decodeHash(hash).type).toBe('Pipe')
    expect(decodeHash(setByte(hash, 22, 255)).type).toBe('Slinky')
  })

  it('reaches every type from every flag combination, preserving unrelated bytes', () => {
    for (let mask = 0; mask < 16; mask++) {
      const bytes = parseHash(DEFAULT_HASH)
      for (const [bit, index] of [22, 23, 24, 31].entries()) bytes[index] = mask & (1 << bit) ? 0 : 255
      const input = toHash(bytes)
      for (const type of TYPES) {
        const output = setType(input, type)
        expect(decodeHash(output).type).toBe(type)
        expect(setType(output, type)).toBe(output)
        parseHash(output).forEach((value, index) => {
          if (![22, 23, 24, 31].includes(index)) expect(value).toBe(bytes[index])
        })
        // The original spread branch supports Hyper on all six types.
        expect(decodeHash(setByte(output, 28, 0))).toMatchObject({ type, hyper: true })
      }
    }
  })
})

describe('geometry and constrained pulling', () => {
  it('retains inclusive sample loops and fractional segment behavior', () => {
    const min = buildGeometry(setByte(setType(DEFAULT_HASH, 'Normal'), 26, 0), 900, 600)
    const next = buildGeometry(setByte(setType(DEFAULT_HASH, 'Normal'), 26, 1), 900, 600)
    expect(min.points).toHaveLength(10 * 201)
    expect(next.points).toHaveLength(11 * 201)
    expect(min.controls).toHaveLength(13)
    expect(next.controls).toHaveLength(14)
    expect(min.points[0]).toMatchObject({ segment: 0, t: 0 })
    expect(min.points[199]).toMatchObject({ isEndpoint: true })
    expect(min.points[200]).toMatchObject({ t: 1, isEndpoint: false })
    expect(min.points[201]).toMatchObject({ segment: 1, t: 0 })
    expect(min.points[200]!.x).toBeCloseTo(min.points[201]!.x, 10)
    expect(min.points[200]!.y).toBeCloseTo(min.points[201]!.y, 10)
    expect(min.controls.at(-1)!.byteIndex).toBe(12)
    expect(buildGeometry(setByte(DEFAULT_HASH, 26, 255), 900, 600).controls.at(-1)!.byteIndex).toBe(20)
  })

  it('fits a 3:2 drawing area centered in any viewport', () => {
    const landscape = buildGeometry(DEFAULT_HASH, 900, 600)
    const portrait = buildGeometry(DEFAULT_HASH, 900, 1000)
    const wide = buildGeometry(DEFAULT_HASH, 1200, 600)
    expect(portrait.squigH).toBe(600)
    expect(wide.squigW).toBe(900)
    expect(portrait.points[10]!.x).toBe(landscape.points[10]!.x)
    expect(portrait.points[10]!.y - landscape.points[10]!.y).toBeCloseTo(200, 12)
    expect(wide.points[10]!.x - landscape.points[10]!.x).toBeCloseTo(150, 12)
  })

  it('finds a point between rendered samples and moves only its four Y bytes', () => {
    const bytes = Array<number>(32).fill(128)
    const input = toHash(bytes)
    const size = { width: 900, height: 600 }
    const before = buildGeometry(input, size.width, size.height)
    const x = before.controls[5]!.x + (before.controls[6]!.x - before.controls[5]!.x) * 0.371
    const nearest = nearestCurvePoint(input, size.width, size.height, x, before.controls[5]!.y)
    expect(nearest.segment).toBe(4)
    expect(nearest.t).toBeCloseTo(0.371, 5)
    expect(nearest.distance).toBeLessThan(0.0001)
    const output = dragCurve(input, size.width, size.height, 4, 0.5, 45)
    const after = buildGeometry(output, size.width, size.height)
    const sampleIndex = 4 * 201 + 100
    // At t=0.5 the four basis weights are [-1, 9, 9, -1] / 16.
    // Each independently rounded control is at most half a byte from its fit.
    const pixelsPerByte = 2 * before.squigH / before.traits.ht / 255
    const roundingBound = pixelsPerByte * 0.5 * (1 + 9 + 9 + 1) / 16
    expect(Math.abs(after.points[sampleIndex]!.y - before.points[sampleIndex]!.y - 45)).toBeLessThanOrEqual(roundingBound)
    expect(after.points[sampleIndex]!.x).toBe(before.points[sampleIndex]!.x)
    const nextBytes = parseHash(output)
    nextBytes.forEach((value, index) => {
      expect(Number.isInteger(value)).toBe(true)
      if (index < 4 || index > 7) expect(value).toBe(bytes[index])
    })
    expect(dragCurve(input, size.width, size.height, 4, 0.5, 0)).toBe(input)
    expect(buildGeometry(toHash(parseHash(output)), size.width, size.height)).toEqual(after)
  })

  it.each([
    { t: 0.371, localBytes: [128, 128, 128, 128] },
    { t: 0.5, localBytes: [128, 128, 128, 128] },
    { t: 0.371, localBytes: [0, 254, 2, 255] },
    { t: 0.5, localBytes: [0, 254, 2, 255] },
  ])('keeps each control monotonic at t=$t from $localBytes, including saturation', ({ t, localBytes }) => {
    const bytes = Array<number>(32).fill(128)
    bytes.splice(4, 4, ...localBytes)
    const input = toHash(bytes)
    const geometry = buildGeometry(input, 900, 600)
    const pixelsPerByte = 2 * geometry.squigH / geometry.traits.ht / 255
    const weights = [
      -0.5 * t + t * t - 0.5 * t ** 3,
      1 - 2.5 * t * t + 1.5 * t ** 3,
      0.5 * t + 2 * t * t - 1.5 * t ** 3,
      -0.5 * t * t + 0.5 * t ** 3,
    ]
    const project = (values: number[]) => weights.reduce((sum, weight, i) => sum + weight * values[i]!, 0)
    const originalY = project(localBytes)
    const minimumY = weights.reduce((sum, weight) => sum + Math.min(0, weight * 255), 0)
    const maximumY = weights.reduce((sum, weight) => sum + Math.max(0, weight * 255), 0)
    const roundingBound = pixelsPerByte * 0.5 * weights.reduce((sum, weight) => sum + Math.abs(weight), 0)

    for (const direction of [-1, 1]) {
      let previous = localBytes
      let reversals = 0
      let unrelatedChanges = 0
      let invalidBytes = 0
      let largestError = 0
      let reachedNewBound = false
      for (let step = 1; step <= 800; step++) {
        const delta = direction * step / 10
        const output = parseHash(dragCurve(input, 900, 600, 4, t, delta))
        const local = output.slice(4, 8)
        local.forEach((value, index) => {
          if ((value - previous[index]!) * weights[index]! * direction < 0) reversals++
          if (value !== localBytes[index] && (value === 0 || value === 255)) reachedNewBound = true
        })
        output.forEach((value, index) => {
          if ((index < 4 || index > 7) && value !== bytes[index]) unrelatedChanges++
          if (!Number.isInteger(value) || value < 0 || value > 255) invalidBytes++
        })
        const reachableY = Math.max(minimumY, Math.min(maximumY, originalY + delta / pixelsPerByte))
        largestError = Math.max(largestError, Math.abs(project(local) - reachableY) * pixelsPerByte)
        previous = local
      }
      expect(reversals).toBe(0)
      expect(unrelatedChanges).toBe(0)
      expect(invalidBytes).toBe(0)
      expect(largestError).toBeLessThanOrEqual(roundingBound + 1e-10)
      if (localBytes[0] === 0) expect(reachedNewBound).toBe(true)
      expect(dragCurve(input, 900, 600, 4, t, 0)).toBe(input)
    }
  })

  it('uses endpoint weights and saturates within representable bytes', () => {
    const input = toHash(Array<number>(32).fill(128))
    for (const [t, index] of [[0, 5], [1, 6]] as const) {
      const output = parseHash(dragCurve(input, 900, 600, 4, t, 100000))
      expect(output[index]).toBe(255)
      output.forEach((value, byteIndex) => { if (byteIndex !== index) expect(value).toBe(128) })
    }
    const extreme = parseHash(dragCurve(input, 900, 600, 4, 0.5, 100000))
    expect(extreme.slice(4, 8)).toEqual([0, 255, 255, 0])
    expect(() => dragCurve(input, 900, 600, 100, 0.5, 2)).toThrow()
  })

  it('can pick immediately beside a segment endpoint without snapping to it', () => {
    const hash = toHash(Array<number>(32).fill(128))
    const geometry = buildGeometry(hash, 900, 600)
    const first = geometry.controls[1]!
    const second = geometry.controls[2]!
    const x = first.x + (second.x - first.x) * 0.004
    const nearest = nearestCurvePoint(hash, 900, 600, x, first.y)
    expect(nearest.segment).toBe(0)
    expect(nearest.t).toBeCloseTo(0.004, 5)
    expect(nearest.distance).toBeLessThan(0.0001)
  })
})

describe('deterministic rendering', () => {
  const fuzzyHash = '0x3c17af010c7af574f5dab0f449e3e360212d9bc9521e16709aff20a8b0fb44ba'

  it('restarts original Fuzzy randomness each segment and preserves seed coupling', () => {
    const geometry = buildGeometry(fuzzyHash, 900, 600)
    expect(geometry.traits.type).toBe('Fuzzy')
    expect(JSON.stringify(buildGeometry(fuzzyHash, 900, 600))).toBe(JSON.stringify(geometry))
    const firstSegment = geometry.points.slice(0, 1001)
    const secondSegment = geometry.points.slice(1001, 2002)
    firstSegment.forEach((point, index) => {
      const next = secondSegment[index]!
      expect(Boolean(point.fuzz)).toBe(Boolean(next.fuzz))
      if (point.fuzz && next.fuzz) {
        expect(next.fuzz.x - next.x).toBeCloseTo(point.fuzz.x - point.x, 10)
        expect(next.fuzz.y - next.y).toBeCloseTo(point.fuzz.y - point.y, 10)
        expect(next.fuzz.diameter).toBe(point.fuzz.diameter)
      }
    })
    const changedSeed = setByte(fuzzyHash, 6, parseHash(fuzzyHash)[6]! + 16)
    const changed = buildGeometry(changedSeed, 900, 600)
    expect(changed.points.slice(0, 20).map(point => point.fuzz?.diameter)).not.toEqual(firstSegment.slice(0, 20).map(point => point.fuzz?.diameter))
  })

  it('matches original p5 drawing fixtures for token 7 at 900 × 600', () => {
    // Captured by executing generator.artblocks.io/0's original drawing script,
    // substituting token 7's hash. This fixes seed parsing and conditional RNG
    // consumption independently of round-trip/self-consistency assertions.
    const circles = buildGeometry(fuzzyHash, 900, 600).points.flatMap(point => point.fuzz ? [point.fuzz] : [])
    expect(circles).toHaveLength(6900)
    const expected = [
      { x: 288.2249457177322, y: 198.29485530546623, diameter: 33.18 },
      { x: 300.95415560916763, y: 189.7445735562701, diameter: 26.0925 },
      { x: 279.42336550060315, y: 178.8578977749196, diameter: 29.63625 },
    ]
    expected.forEach((circle, index) => {
      expect(circles[index]!.x).toBeCloseTo(circle.x, 10)
      expect(circles[index]!.y).toBeCloseTo(circle.y, 10)
      expect(circles[index]!.diameter).toBeCloseTo(circle.diameter, 10)
    })
  })

  function trace(hash: string, phase = 0) {
    const operations: unknown[][] = []
    const ctx = {
      fillStyle: '', strokeStyle: '', lineWidth: 0, lineCap: '', lineJoin: '', globalAlpha: 1, globalCompositeOperation: '',
      save() {}, restore() {}, beginPath() {}, clearRect() {}, fillRect() {},
      arc(...args: number[]) { operations.push(['arc', ...args]) },
      fill() { operations.push(['fill', this.fillStyle]) },
      stroke() { operations.push(['stroke', this.strokeStyle, this.lineWidth]) },
    }
    drawSquiggle(ctx as unknown as CanvasRenderingContext2D, hash, 900, 600, { background: '#fff', phase })
    return operations
  }

  it.each(TYPES)('reconstructs identical %s drawing operations from the exported hash', (type) => {
    const hash = setType(DEFAULT_HASH, type)
    expect(JSON.stringify(trace(hash))).toBe(JSON.stringify(trace(toHash(parseHash(hash)))))
  })

  it('keeps animation separate from hash and geometry, including Fuzzy', () => {
    for (const hash of [DEFAULT_HASH, fuzzyHash]) {
      const still = trace(hash)
      const animated = trace(hash, 70)
      expect(JSON.stringify(animated)).not.toBe(JSON.stringify(still))
      expect(JSON.stringify(animated.filter(op => op[0] === 'arc'))).toBe(JSON.stringify(still.filter(op => op[0] === 'arc')))
      expect(JSON.stringify(trace(hash, 255))).toBe(JSON.stringify(still))
    }
  })
})
