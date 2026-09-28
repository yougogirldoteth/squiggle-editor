import { describe, expect, it } from 'vitest'
import { applyPromptRecipe, describePromptHash, parsePromptRecipe, type PromptRecipe } from '../app/utils/promptRecipe'
import { buildGeometry, decodeHash, DEFAULT_HASH, parseHash, setByte, setType, TYPES, visibleStartHue } from '../app/utils/squiggle'

const unchanged: PromptRecipe = { shape: null, style: null, color: null, texture: null }

describe('prompt recipes', () => {
  it('preserves every byte for an empty refinement', () => {
    expect(applyPromptRecipe(DEFAULT_HASH, unchanged)).toEqual({ hash: DEFAULT_HASH, colorLimited: false })
  })

  it.each(TYPES)('round trips the current %s artwork without changing its bytes', style => {
    for (const segments of [0, 1, 31, 32, 33, 127, 255]) {
      for (const spread of [0, 1, 2, 3, 127, 255]) {
        const hash = setByte(setByte(setType(DEFAULT_HASH, style), 26, segments), 28, spread)
        expect(applyPromptRecipe(hash, describePromptHash(hash)).hash).toBe(hash)
      }
    }
  })

  it('maps all nine shape complexities to the actual rendered controls', () => {
    for (let count = 13; count <= 21; count++) {
      const points = Array.from({ length: count }, (_, i) => Math.sin(i * 0.9))
      const { hash } = applyPromptRecipe(DEFAULT_HASH, { ...unchanged, shape: { points, tallness: 1 } })
      const before = parseHash(DEFAULT_HASH), after = parseHash(hash)
      const geometry = buildGeometry(hash, 900, 600)
      expect(geometry.controls).toHaveLength(count)
      // Hash quantization permits half a byte of error: 200 / 255 pixels.
      points.forEach((point, i) => expect(Math.abs(geometry.controls[i]!.y - (300 - point * 200))).toBeLessThanOrEqual(200 / 255 + 1e-9))
      for (let i = count; i < 32; i++) if (i !== 26 && i !== 27) expect(after[i]).toBe(before[i])
      expect(decodeHash(hash).ht).toBe(3)
    }
  })

  it.each(TYPES)('encodes %s using the existing type rules and preserves shape and color bytes', style => {
    expect(applyPromptRecipe(DEFAULT_HASH, { ...unchanged, style }).hash).toBe(setType(DEFAULT_HASH, style))
  })

  it.each([false, true])('encodes a requested visible starting hue with reverse=%s', reverse => {
    const { hash } = applyPromptRecipe(DEFAULT_HASH, { ...unchanged, color: { startHue: 220, hueSpan: 60, reverse, hyper: null } })
    const traits = decodeHash(hash)
    expect(traits.reverse).toBe(reverse)
    expect(visibleStartHue(traits) * 360 / 255).toBeCloseTo(220, 0)
    const before = parseHash(DEFAULT_HASH), after = parseHash(hash)
    for (let i = 0; i < 32; i++) if (![28, 29, 30].includes(i)) expect(after[i]).toBe(before[i])
  })

  it('uses the new style and shape to choose the closest attainable palette', () => {
    const recipe = { shape: { points: Array(13).fill(0), tallness: 0.7 }, style: 'Slinky', texture: null, color: { startHue: 200, hueSpan: 25, reverse: false, hyper: null } }
    const result = applyPromptRecipe(DEFAULT_HASH, recipe)
    const color = describePromptHash(result.hash).color
    expect(color.hueSpan).toBeCloseTo(25, 0)
    expect(result.colorLimited).toBe(false)
    const geometry = buildGeometry(result.hash, 900, 600)
    // Inspect the renderer's actual hue progression, not just the recipe decoder.
    const traveled = geometry.points.length - 1
    expect(color.hueSpan).toBeCloseTo(traveled / geometry.traits.spread * 360 / 255, 8)
  })

  it('reports palettes the original script cannot represent rather than changing the renderer', () => {
    const result = applyPromptRecipe(DEFAULT_HASH, { ...unchanged, style: 'Fuzzy', color: { startHue: 220, hueSpan: 0, reverse: false, hyper: null } })
    expect(result.colorLimited).toBe(true)
    expect(parseHash(result.hash)[28]).toBe(255)
    expect(describePromptHash(result.hash).color.hueSpan).toBeGreaterThan(280)
  })

  it.each(TYPES)('toggles Hyper for %s without changing its shape, type, or starting hue', style => {
    const original = setByte(setByte(setType(DEFAULT_HASH, style), 30, 0), 28, 255)
    const color = describePromptHash(original).color
    const enabled = applyPromptRecipe(original, { ...unchanged, color: { ...color, hyper: true } })
    expect(decodeHash(enabled.hash).hyper).toBe(true)
    expect(enabled.colorLimited).toBe(false)
    expect(parseHash(enabled.hash).filter((_byte, index) => index !== 28)).toEqual(parseHash(original).filter((_byte, index) => index !== 28))
    const disabled = applyPromptRecipe(enabled.hash, { ...unchanged, color: { ...color, hyper: false } })
    expect(disabled.hash).toBe(original)
  })

  it.each([3, 4, 5])('sets Ribbed spacing %s and grayscale without changing shape or palette', spacing => {
    const original = setType(DEFAULT_HASH, 'Ribbed')
    const result = applyPromptRecipe(original, { ...unchanged, texture: { spacing, ribGray: 0.25 } })
    const geometry = buildGeometry(result.hash, 900, 600)
    expect(geometry.traits.type).toBe('Ribbed')
    expect(geometry.traits.bytes[25]).toBe(64)
    expect(geometry.points[spacing]!.isSegmentMarker).toBe(true)
    expect(geometry.points[spacing - 1]!.isSegmentMarker).toBe(false)
    expect(parseHash(result.hash).filter((_byte, index) => ![24, 25].includes(index))).toEqual(parseHash(original).filter((_byte, index) => ![24, 25].includes(index)))
  })

  it('selects Ribbed for a rib refinement while preserving its unspecified texture field', () => {
    for (const style of TYPES) {
      const original = setType(DEFAULT_HASH, style)
      const gray = applyPromptRecipe(original, { ...unchanged, texture: { spacing: null, ribGray: 1 } }).hash
      expect(decodeHash(gray).type).toBe('Ribbed')
      expect(parseHash(gray)[24]).toBe(parseHash(setType(original, 'Ribbed'))[24])
      const spaced = applyPromptRecipe(original, { ...unchanged, texture: { spacing: 3, ribGray: null } }).hash
      expect(parseHash(spaced)[25]).toBe(parseHash(original)[25])
      expect(applyPromptRecipe(original, { ...unchanged, texture: { spacing: null, ribGray: null } }).hash).toBe(original)
    }
  })

  it.each([
    null, [], {}, { ...unchanged, code: 'alert(1)' }, { ...unchanged, style: 'Other' },
    ...[NaN, Infinity, -0.01, 1.01, '1'].map(tallness => ({ ...unchanged, shape: { points: Array(13).fill(0), tallness } })),
    ...[Array(12).fill(0), Array(22).fill(0), Array(13).fill(2), Array(13), Array(13).fill('0')].map(points => ({ ...unchanged, shape: { points, tallness: 1 } })),
    { ...unchanged, color: { startHue: -1, hueSpan: 30, reverse: false, hyper: null } },
    { ...unchanged, color: { startHue: 200, hueSpan: 60001, reverse: false, hyper: null } },
    { ...unchanged, color: { startHue: 200, hueSpan: 30, reverse: 'false' } },
    { ...unchanged, color: { startHue: 200, hueSpan: 30, reverse: false, extra: true } },
    { ...unchanged, color: { startHue: 200, hueSpan: 30, reverse: false, hyper: 'true' } },
    { ...unchanged, texture: { spacing: 3.5, ribGray: null } },
    { ...unchanged, texture: { spacing: 6, ribGray: null } },
    { ...unchanged, texture: { spacing: 3, ribGray: -0.1 } },
    { ...unchanged, texture: { spacing: null, ribGray: Infinity } },
    { ...unchanged, style: 'Fuzzy', texture: { spacing: 3, ribGray: 0 } },
  ])('rejects malformed, unbounded or executable output %#', recipe => {
    expect(() => parsePromptRecipe(recipe)).toThrow()
  })
})
