import originalScript from '../data/snowfro-script.formatted.js?raw'
import { parseHash } from './squiggle'

export interface LiveSketchLine { id: string; text: string; focus?: boolean }
export interface LiveSketchView { background: string; speed: number; playing: boolean }

const originalSource = originalScript.trimEnd()
const originalLines = originalSource.split('\n')

/** The displayed and copied code contains only the formatted original script. */
export function createLiveSketch(): { lines: LiveSketchLine[], source: string } {
  return {
    lines: originalLines.map((text, index) => ({ id: `original-${index}`, text })),
    source: originalSource,
  }
}

/** Preserve semantic IDs where custom code still contains original source lines. */
export function sketchLines(source: string): LiveSketchLine[] {
  const known = new Map<string, LiveSketchLine[]>()
  for (const line of createLiveSketch().lines) known.set(line.text, [...(known.get(line.text) ?? []), line])
  return source.split('\n').map((text, index) => ({
    id: known.get(text)?.shift()?.id ?? `custom-${index}`,
    text,
  }))
}

/** Every custom statement or comment stays on the isolated execution path. */
export function isOriginalSketch(source: string): boolean {
  return source.replace(/\r\n/g, '\n').trimEnd() === originalSource
}

/** Only original expressions are highlighted; form edits never rewrite them. */
export function affectedScriptLines(previousHash: string, nextHash: string, previousView?: LiveSketchView, nextView?: LiveSketchView): string[] {
  const before = parseHash(previousHash)
  const after = parseHash(nextHash)
  const changed = before.flatMap((value, index) => value !== after[index] ? [index] : [])
  const ids = new Set<string>()
  const addMatching = (matches: (line: string) => boolean) => originalLines.forEach((line, index) => {
    if (matches(line)) ids.add(`original-${index}`)
  })
  addMatching(line => changed.some(byteIndex => byteIndex <= 20
    ? line.includes('decPairs[j')
    : line.includes(`decPairs[${byteIndex}]`)))
  // Shape expressions lead; Fuzzy's coupled seed is useful secondary context.
  if (changed.some(index => index <= 6)) addMatching(line => line.includes('seed = parseInt'))
  if (previousView && nextView) {
    if (previousView.background !== nextView.background) addMatching(line => line.includes('background(backgroundArray[backgroundIndex])'))
    if (previousView.speed !== nextView.speed) addMatching(line => line.startsWith('let speed ='))
    if (previousView.playing !== nextView.playing) addMatching(line => line.startsWith('let loops ='))
  }
  return [...ids]
}
