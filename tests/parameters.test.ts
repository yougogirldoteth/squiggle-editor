import { describe, expect, it } from 'vitest'
import { buildGeometry, decodeHash, DEFAULT_HASH, drawSquiggle, parseHash, setByte, setType, toHash, TYPES } from '../app/utils/squiggle'

const WIDTH = 900
const HEIGHT = 600

function render(hash: string, background = '#fff', phase = 0) {
  const circles: number[][] = []
  const paints: string[] = []
  let backdrop = ''
  const ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 0,
    save() {}, restore() {}, beginPath() {}, clearRect() {},
    fillRect() { backdrop = this.fillStyle },
    arc(...values: number[]) { circles.push(values) },
    fill() { paints.push(`fill:${this.fillStyle}`) },
    stroke() { paints.push(`stroke:${this.strokeStyle}:${this.lineWidth}`) },
  }
  drawSquiggle(ctx as unknown as CanvasRenderingContext2D, hash, WIDTH, HEIGHT, { background, phase })
  return { circles: JSON.stringify(circles), paints: JSON.stringify(paints), backdrop }
}

function centerline(hash: string) {
  return buildGeometry(hash, WIDTH, HEIGHT).points.map(({ x, y }) => [x, y])
}

describe('full original shape parameters', () => {
  it.each([0, 64, 128, 192])('retains 64 byte26 values starting at %i and their fractional lengths through export', (start) => {
    // Slinky uses the same geometry with fewer samples, keeping exhaustive
    // coverage of all 256 representable lengths inexpensive.
    const initial = setType(DEFAULT_HASH, 'Slinky')
    const initialBytes = parseHash(initial)
    let previousFirstX = start === 0 ? Infinity : buildGeometry(setByte(initial, 26, start - 1), WIDTH, HEIGHT).controls[1]!.x
    for (let value = start; value < start + 64; value++) {
      const hash = setByte(initial, 26, value)
      const imported = toHash(parseHash(hash))
      const geometry = buildGeometry(imported, WIDTH, HEIGHT)
      const segments = 12 + 8 * value / 255
      const controlCount = Math.ceil(segments) + 1
      expect(imported).toBe(hash)
      expect(parseHash(imported)).toEqual(initialBytes.map((byte, index) => index === 26 ? value : byte))
      expect(geometry.traits.segments).toBeCloseTo(segments, 12)
      expect(geometry.controls.map(control => control.byteIndex)).toEqual(Array.from({ length: controlCount }, (_, index) => index))
      expect(geometry.points).toHaveLength((controlCount - 3) * 51)
      expect(geometry.controls[1]!.x).toBeLessThan(previousFirstX)
      previousFirstX = geometry.controls[1]!.x
    }
  })

  it.each(TYPES)('scales %s centerline height by 4/3 without changing its thickness', (type) => {
    const initial = setType(DEFAULT_HASH, type)
    const tallHash = setByte(initial, 27, 0)
    const shortHash = setByte(initial, 27, 255)
    const tall = buildGeometry(tallHash, WIDTH, HEIGHT)
    const short = buildGeometry(shortHash, WIDTH, HEIGHT)
    expect(tall.traits.ht).toBe(3)
    expect(short.traits.ht).toBe(4)
    expect(parseHash(tallHash).filter((_, i) => i !== 27)).toEqual(parseHash(shortHash).filter((_, i) => i !== 27))
    expect([tall.mainDiameter, tall.pipeDiameter, tall.segmentedDiameter]).toEqual([short.mainDiameter, short.pipeDiameter, short.segmentedDiameter])
    let largestScaleError = 0
    let largestXError = 0
    let largestTextureError = 0
    tall.points.forEach((point, index) => {
      const other = short.points[index]!
      largestScaleError = Math.max(largestScaleError, Math.abs((point.y - HEIGHT / 2) - (other.y - HEIGHT / 2) * 4 / 3))
      largestXError = Math.max(largestXError, Math.abs(point.x - other.x))
      if (point.fuzz && other.fuzz) {
        largestTextureError = Math.max(largestTextureError,
          Math.abs(point.fuzz.diameter - other.fuzz.diameter),
          Math.abs((point.fuzz.x - point.x) - (other.fuzz.x - other.x)),
          Math.abs((point.fuzz.y - point.y) - (other.fuzz.y - other.y)),
        )
      }
    })
    expect(largestScaleError).toBeLessThan(1e-10)
    expect(largestXError).toBe(0)
    expect(largestTextureError).toBeLessThan(1e-10)
  })

  it('makes each active Y byte editable, including both tangent endpoints', () => {
    const hash = setByte(setType(DEFAULT_HASH, 'Normal'), 26, 255)
    const geometry = buildGeometry(hash, WIDTH, HEIGHT)
    const before = JSON.stringify(geometry.points.map(({ x, y }) => [x, y]))
    const bytes = parseHash(hash)
    for (const control of geometry.controls) {
      const edited = setByte(hash, control.byteIndex, (bytes[control.byteIndex]! + 127) % 256)
      const after = buildGeometry(edited, WIDTH, HEIGHT)
      expect(JSON.stringify(after.points.map(({ x, y }) => [x, y]))).not.toBe(before)
      expect(after.controls.map(point => point.x)).toEqual(geometry.controls.map(point => point.x))
      expect(toHash(parseHash(edited))).toBe(edited)
      if (control.byteIndex === 0) {
        expect(after.points[0]!.y).toBe(geometry.points[0]!.y)
        expect(after.points[100]!.y).not.toBe(geometry.points[100]!.y)
      }
      if (control.byteIndex === 20) {
        expect(after.points.at(-1)!.y).toBeCloseTo(geometry.points.at(-1)!.y, 10)
        expect(after.points.at(-100)!.y).not.toBe(geometry.points.at(-100)!.y)
      }
    }
  })

  it('retains inactive shape bytes until length activates them', () => {
    const short = setByte(setType(DEFAULT_HASH, 'Normal'), 26, 0)
    const edited = setByte(short, 20, 0)
    expect(centerline(edited)).toEqual(centerline(short))
    expect(parseHash(edited)[20]).toBe(0)
    const longOriginal = setByte(short, 26, 255)
    const longEdited = setByte(edited, 26, 255)
    expect(JSON.stringify(centerline(longEdited))).not.toBe(JSON.stringify(centerline(longOriginal)))
  })
})

describe('conditional original texture parameters', () => {
  it('preserves every Ribbed spacing encoding with precisely three visible intervals', () => {
    const initial = setType(DEFAULT_HASH, 'Ribbed')
    const observedPatterns = new Set<string>()
    for (let value = 0; value < 30; value++) {
      const hash = setByte(initial, 24, value)
      const geometry = buildGeometry(toHash(parseHash(hash)), WIDTH, HEIGHT)
      const spacing = value <= 13 ? 3 : value <= 27 ? 4 : 5
      const markerIndices = geometry.points.slice(0, 201).flatMap((point, index) => point.isSegmentMarker ? [index] : [])
      const expected = Array.from({ length: 201 }, (_, index) => index).filter(index => index === 0 || index === 199 || index % spacing === 0)
      expect(geometry.traits.type).toBe('Ribbed')
      expect(geometry.traits.bytes[24]).toBe(value)
      expect(markerIndices).toEqual(expected)
      observedPatterns.add(JSON.stringify(markerIndices))
    }
    expect(observedPatterns.size).toBe(3)
    expect(decodeHash(setByte(initial, 24, 30)).type).toBe('Normal')
  })

  it.each(TYPES)('applies gray byte25 only when %s actually renders ribs', (type) => {
    const hash = setType(DEFAULT_HASH, type)
    const dark = render(setByte(hash, 25, 0))
    const light = render(setByte(hash, 25, 255))
    expect(light.circles).toBe(dark.circles)
    if (type === 'Ribbed') {
      expect(light.paints).not.toBe(dark.paints)
      expect(light.paints).toContain('fill:rgb(255,255,255)')
      expect(dark.paints).toContain('fill:rgb(0,0,0)')
    } else {
      expect(light.paints).toBe(dark.paints)
    }
  })

  it.each(TYPES)('applies spacing byte24 only when %s actually renders ribs', (type) => {
    const hash = setType(DEFAULT_HASH, type)
    // Normal must keep byte24 at least 30 to stay Normal. All remaining types
    // either use the segmented branch or override it through their precedence.
    const low = render(setByte(hash, 24, type === 'Normal' ? 30 : 0))
    const high = render(setByte(hash, 24, type === 'Normal' ? 255 : 29))
    if (type === 'Ribbed') {
      expect(high.circles).not.toBe(low.circles)
      expect(high.paints).not.toBe(low.paints)
    } else {
      expect(high).toEqual(low)
    }
  })

  it.each(TYPES)('does not turn unused byte21 into a hidden %s parameter', (type) => {
    const hash = setType(DEFAULT_HASH, type)
    expect(render(setByte(hash, 21, 0))).toEqual(render(setByte(hash, 21, 255)))
  })
})

describe('parameter independence and reconstruction', () => {
  it('keeps the centerline fixed when changing color controls', () => {
    const hash = setType(DEFAULT_HASH, 'Normal')
    const initial = JSON.stringify(centerline(hash))
    for (const [index, value] of [[28, 0], [28, 3], [28, 255], [29, 0], [29, 255], [30, 0], [30, 255]]) {
      expect(JSON.stringify(centerline(setByte(hash, index!, value!)))).toBe(initial)
    }
  })

  it.each(TYPES)('reconstructs %s after changing all meaningful hash parameters together', (type) => {
    let hash = setType(DEFAULT_HASH, type)
    for (const [index, value] of [[0, 3], [6, 137], [11, 244], [20, 9], [25, 217], [26, 231], [27, 87], [28, 5], [29, 253], [30, 3]]) {
      hash = setByte(hash, index!, value!)
    }
    if (type === 'Ribbed') hash = setByte(hash, 24, 14)
    expect(decodeHash(hash).type).toBe(type)
    const imported = toHash(parseHash(hash))
    expect(render(imported, '#969696', 19.25)).toEqual(render(hash, '#969696', 19.25))
  })

  it('keeps original grayscale backgrounds separate from shape and animation phase', () => {
    const hash = setType(DEFAULT_HASH, 'Normal')
    const reference = render(hash)
    const grays = [255, 225, 200, 175, 150, 125, 100, 75, 50, 25, 0]
    for (const gray of grays) {
      const background = `rgb(${gray},${gray},${gray})`
      const frame = render(hash, background)
      expect(frame.backdrop).toBe(background)
      expect(frame.circles).toBe(reference.circles)
      expect(frame.paints).toBe(reference.paints)
    }
    const animated = render(hash, '#000', 73.6)
    expect(animated.circles).toBe(reference.circles)
    expect(animated.paints).not.toBe(reference.paints)
  })
})
