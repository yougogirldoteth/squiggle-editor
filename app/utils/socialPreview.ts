import { DEFAULT_HASH, parseHash, toHash } from './squiggle'

export function socialPreviewInputs(hash: unknown, background: unknown) {
  let normalizedHash = DEFAULT_HASH
  try { if (typeof hash === 'string') normalizedHash = toHash(parseHash(hash)) } catch {}
  const backgrounds = [255, 225, 200, 175, 150, 125, 100, 75, 50, 25, 0].map(gray => gray.toString(16).padStart(2, '0').repeat(3))
  return { hash: normalizedHash, background: typeof background === 'string' && backgrounds.includes(background) ? background : 'ffffff' }
}
