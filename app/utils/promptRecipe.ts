import { decodeHash, setStartingHue, setType, toHash, TYPES, visibleStartHue, type SquiggleType } from './squiggle'

/** Null keeps that part of the current artwork exactly as it is. */
export interface PromptRecipe {
  shape: { points: number[]; tallness: number } | null
  style: SquiggleType | null
  color: { startHue: number; hueSpan: number; reverse: boolean } | null
}

export const promptRecipeSchema = {
  type: 'object', additionalProperties: false, required: ['shape', 'style', 'color'],
  properties: {
    shape: { anyOf: [
      { type: 'null' },
      {
        type: 'object', additionalProperties: false, required: ['points', 'tallness'],
        properties: {
          points: { type: 'array', minItems: 13, maxItems: 21, items: { type: 'number', minimum: -1, maximum: 1 } },
          tallness: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    ] },
    style: { anyOf: [{ type: 'null' }, { type: 'string', enum: [...TYPES] }] },
    color: { anyOf: [
      { type: 'null' },
      {
        type: 'object', additionalProperties: false, required: ['startHue', 'hueSpan', 'reverse'],
        properties: {
          startHue: { type: 'number', minimum: 0, maximum: 360 },
          hueSpan: { type: 'number', minimum: 0, maximum: 60000 },
          reverse: { type: 'boolean' },
        },
      },
    ] },
  },
} as const

function record(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}
function numberIn(value: unknown, low: number, high: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high
}

/** Validate again locally, even when the provider promises structured output. */
export function parsePromptRecipe(value: unknown): PromptRecipe {
  if (!record(value, ['shape', 'style', 'color'])) throw new Error('Invalid prompt recipe.')
  const { shape, style, color } = value
  if (shape !== null && (!record(shape, ['points', 'tallness']) || !Array.isArray(shape.points)
    || shape.points.length < 13 || shape.points.length > 21
    || !Array.from(shape.points).every(point => numberIn(point, -1, 1)) || !numberIn(shape.tallness, 0, 1))) {
    throw new Error('Invalid prompt shape.')
  }
  if (style !== null && !TYPES.includes(style as SquiggleType)) throw new Error('Invalid prompt style.')
  if (color !== null && (!record(color, ['startHue', 'hueSpan', 'reverse']) || !numberIn(color.startHue, 0, 360)
    || !numberIn(color.hueSpan, 0, 60000) || typeof color.reverse !== 'boolean')) throw new Error('Invalid prompt color.')
  return value as unknown as PromptRecipe
}

export function describePromptHash(hash: string) {
  const traits = decodeHash(hash)
  const count = Math.ceil(traits.segments - 2)
  const steps = traits.slinky ? 50 : traits.fuzzy ? 1000 : 200
  return {
    shape: { points: traits.bytes.slice(0, count + 3).map(byte => 1 - byte / 127.5), tallness: 1 - traits.bytes[27]! / 255 },
    style: traits.type,
    color: {
      startHue: visibleStartHue(traits) * 360 / 255,
      hueSpan: (count * (steps + 1) - 1) / traits.spread * 360 / 255,
      reverse: traits.reverse,
    },
  }
}

/** Encode only the original algorithm's bytes. No generated code is executed. */
export function applyPromptRecipe(hash: string, input: unknown) {
  const recipe = parsePromptRecipe(input)
  let bytes = decodeHash(hash).bytes
  if (recipe.shape) {
    const count = recipe.shape.points.length - 3
    const low = count === 10 ? 0 : Math.floor((count - 11) * 255 / 8) + 1
    const high = Math.floor((count - 10) * 255 / 8)
    bytes[26] = Math.max(low, Math.min(high, bytes[26]!))
    bytes[27] = Math.round((1 - recipe.shape.tallness) * 255)
    recipe.shape.points.forEach((point, index) => { bytes[index] = Math.round((1 - point) * 127.5) })
  }
  if (recipe.style) bytes = decodeHash(setType(toHash(bytes), recipe.style)).bytes
  let colorLimited = false
  if (recipe.color) {
    const traits = decodeHash(toHash(bytes))
    const steps = traits.slinky ? 50 : traits.fuzzy ? 1000 : 200
    const hueDistance = (Math.ceil(traits.segments - 2) * (steps + 1) - 1) * 360 / 255
    const spanAt = (byte: number) => hueDistance / (byte < 3 ? 0.5 : 5 + 45 * byte / 255)
    // Prefer the existing byte when several byte values produce the same span.
    let best = bytes[28]!
    for (let candidate = 0; candidate <= 255; candidate++) {
      if (Math.abs(spanAt(candidate) - recipe.color.hueSpan) < Math.abs(spanAt(best) - recipe.color.hueSpan)) best = candidate
    }
    bytes[28] = best
    bytes[30] = recipe.color.reverse ? Math.min(127, bytes[30]!) : Math.max(128, bytes[30]!)
    bytes = decodeHash(setStartingHue(toHash(bytes), recipe.color.startHue * 255 / 360)).bytes
    colorLimited = Math.abs(spanAt(best) - recipe.color.hueSpan) > Math.max(5, recipe.color.hueSpan * 0.05)
  }
  return { hash: toHash(bytes), colorLimited }
}
