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
  const declarations = new Map<string, LiveSketchLine[]>()
  const declarationName = (line: string) => /^\s*(?:let|const|var)\s+([A-Za-z_$][\w$]*)(?=\s*(?:=|;|$))/.exec(line)?.[1]
  for (const line of createLiveSketch().lines) {
    known.set(line.text, [...(known.get(line.text) ?? []), line])
    const name = declarationName(line.text)
    if (name) declarations.set(name, [...(declarations.get(name) ?? []), line])
  }
  const lines = source.split('\n')
  const declarationCounts = new Map<string, number>()
  for (const text of lines) {
    const name = declarationName(text)
    if (name) declarationCounts.set(name, (declarationCounts.get(name) ?? 0) + 1)
  }
  return lines.map((text, index) => {
    const exact = known.get(text)?.shift()
    const name = declarationName(text)
    const candidates = name ? declarations.get(name) : undefined
    // A changed initializer keeps its semantic target only if the declaration
    // name is unambiguous in both the original and the edited source.
    const declaration = name && candidates?.length === 1 && declarationCounts.get(name) === 1 ? candidates[0] : undefined
    return { id: exact?.id ?? declaration?.id ?? `custom-${index}`, text }
  })
}

/** Every custom statement or comment stays on the isolated execution path. */
export function isOriginalSketch(source: string): boolean {
  return source.replace(/\r\n/g, '\n').trimEnd() === originalSource
}

/** Reveal the curve calculation on explicit point selection or gesture start. */
export function pointScriptLines(): string[] {
  return originalLines.flatMap((line, index) => line.includes('decPairs[j') ? [`original-${index}`] : [])
}

/** Only original expressions are highlighted; form edits never rewrite them. */
export function affectedScriptLines(previousHash: string, nextHash: string, previousView?: LiveSketchView, nextView?: LiveSketchView): string[] {
  const before = parseHash(previousHash)
  const after = parseHash(nextHash)
  const changed = before.flatMap((value, index) => value !== after[index] ? [index] : [])
  const ids = new Set<string>()
  const addMatching = (matches: (line: string, index: number) => boolean) => originalLines.forEach((line, index) => {
    if (matches(line, index)) ids.add(`original-${index}`)
  })
  // Within the Ribbed range, the flag stays true while this spacing changes.
  if (changed.includes(24) && before[24]! < 30 && after[24]! < 30) {
    addMatching(line => line.includes('map(Math.round(decPairs[24])'))
  }
  const pointIds = new Set(changed.some(index => index <= 20) ? pointScriptLines() : [])
  addMatching((line, index) => pointIds.has(`original-${index}`)
    || changed.some(byteIndex => byteIndex > 20 && line.includes(`decPairs[${byteIndex}]`)))
  // Shape expressions lead; Fuzzy's coupled seed is useful secondary context.
  if (changed.some(index => index <= 6)) addMatching(line => line.includes('seed = parseInt'))
  if (previousView && nextView) {
    if (previousView.background !== nextView.background) addMatching(line => line.includes('background(backgroundArray[backgroundIndex])'))
    if (previousView.speed !== nextView.speed) addMatching(line => line.startsWith('let speed ='))
    if (previousView.playing !== nextView.playing) addMatching(line => line.startsWith('let loops ='))
  }
  return [...ids]
}
