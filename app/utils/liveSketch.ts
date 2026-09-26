import originalScript from '../data/snowfro-script.formatted.js?raw'
import { DEFAULT_HASH, parseHash, toHash } from './squiggle'

export interface LiveSketchLine { id: string; text: string; focus?: boolean }
export interface LiveSketchView { background: string; speed: number; playing: boolean }
export type SketchInputs = Partial<LiveSketchView & { hash: string }>

const INPUTS_START = '// Editor inputs'
const INPUTS_END = '// End editor inputs'
const originalLines = originalScript.trimEnd().split('\n')
const declarations = { hash: 'editorHash', background: 'editorBackground', speed: 'editorSpeed', playing: 'editorPlaying' } as const
type InputKey = keyof typeof declarations
const literalPattern = String.raw`("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|true|false)`

function declarationPattern(name: string) {
  return new RegExp(`^([ \\t]*const[ \\t]+${name}[ \\t]*=[ \\t]*)${literalPattern}([ \\t]*;[ \\t]*(?://[^\\n]*)?)$`, 'gm')
}

function inputSection(source: string) {
  const start = source.indexOf(`${INPUTS_START}\n`)
  if (start < 0) return null
  const end = source.indexOf(`\n${INPUTS_END}`, start)
  return end < 0 ? null : { start, end, text: source.slice(start, end) }
}

function literals(hash: string, view: LiveSketchView) {
  const normalizedHash = toHash(parseHash(hash))
  if (!Number.isFinite(view.speed)) throw new RangeError('Animation speed must be finite.')
  return { hash: JSON.stringify(normalizedHash), background: JSON.stringify(view.background), speed: String(view.speed), playing: String(view.playing) }
}

/** The verified script body is unchanged except for static formatting. */
export function createLiveSketch(hash: string, view: LiveSketchView): { lines: LiveSketchLine[], source: string } {
  const values = literals(hash, view)
  const lines: LiveSketchLine[] = [
    { id: 'title', text: '// Chromie Squiggle by Snowfro' },
    { id: 'runtime', text: '// Original on-chain script · p5.js 1.0.0' },
    { id: 'gap-inputs', text: '' },
    { id: 'inputs-start', text: INPUTS_START },
    { id: 'input-hash', text: `const editorHash = ${values.hash};`, focus: true },
    { id: 'view-background', text: `const editorBackground = ${values.background};`, focus: true },
    { id: 'view-speed', text: `const editorSpeed = ${values.speed};`, focus: true },
    { id: 'view-playing', text: `const editorPlaying = ${values.playing};`, focus: true },
    { id: 'inputs-end', text: INPUTS_END },
    { id: 'token-data', text: 'let tokenData = { hashes: [editorHash] };' },
    { id: 'gap-original', text: '' },
    { id: 'original-start', text: '// Original script — formatting only; source is verified on chain.' },
    ...originalLines.map((text, index) => ({ id: `original-${index}`, text })),
    { id: 'original-end', text: '// End original script' },
    { id: 'gap-view', text: '' },
    { id: 'view-note', text: '// Apply editor view settings before p5 calls setup().' },
    { id: 'set-speed', text: 'speed = editorSpeed;' },
    { id: 'set-background', text: 'backgroundArray[0] = editorBackground;' },
    { id: 'set-background-index', text: 'backgroundIndex = 0;' },
    { id: 'set-playing', text: 'loops = editorPlaying;' },
  ]
  return { lines, source: lines.map(line => line.text).join('\n') }
}

/** Patch only recognized literals in the explicit wrapper, preserving custom JS. */
export function updateSketchInputs(source: string, hash: string, view: LiveSketchView, keys: readonly InputKey[] = Object.keys(declarations) as InputKey[]): string {
  const values = literals(hash, view)
  const section = inputSection(source)
  if (!section) return source
  let text = section.text
  for (const key of keys) {
    text = text.replace(declarationPattern(declarations[key]), (_match, before: string, _literal: string, after: string) => `${before}${values[key]}${after}`)
  }
  return source.slice(0, section.start) + text + source.slice(section.end)
}

function readLiteral(literal: string): unknown {
  try {
    if (literal.startsWith("'")) return JSON.parse(`"${literal.slice(1, -1).replace(/"/g, '\\"').replace(/\\'/g, "'")}"`)
    return JSON.parse(literal)
  } catch { return undefined }
}

/** Read literal input values only. Never evaluate edited code in the parent. */
export function readSketchInputs(source: string): SketchInputs {
  const section = inputSection(source)
  if (!section) return {}
  const result: SketchInputs = {}
  for (const key of Object.keys(declarations) as InputKey[]) {
    const matches = [...section.text.matchAll(declarationPattern(declarations[key]))]
    if (matches.length !== 1) continue
    const value = readLiteral(matches[0]![2]!)
    if (key === 'hash' && typeof value === 'string') {
      try { result.hash = toHash(parseHash(value)) } catch { /* Leave malformed drafts in code. */ }
    } else if (key === 'background' && typeof value === 'string') result.background = value
    else if (key === 'background' && typeof value === 'number' && value >= 0 && value <= 255) {
      const gray = Math.round(value).toString(16).padStart(2, '0')
      result.background = `#${gray}${gray}${gray}`
    } else if (key === 'speed' && typeof value === 'number' && Number.isFinite(value)) result.speed = value
    else if (key === 'playing' && typeof value === 'boolean') result.playing = value
  }
  return result
}

function withoutInputValues(source: string) {
  const section = inputSection(source)
  if (!section) return source
  let text = section.text
  for (const name of Object.values(declarations)) {
    text = text.replace(declarationPattern(name), (_match, before: string, _literal: string, after: string) => `${before}"__EDITOR_INPUT__"${after}`)
  }
  return source.slice(0, section.start) + text + source.slice(section.end)
}

const originalTemplate = withoutInputValues(createLiveSketch(DEFAULT_HASH, { background: '#ffffff', speed: 1, playing: false }).source)

/** Keep semantic IDs where edited code still contains the known source lines. */
export function sketchLines(source: string): LiveSketchLine[] {
  const reference = createLiveSketch(DEFAULT_HASH, { background: '#ffffff', speed: 1, playing: false }).lines
  const known = new Map<string, LiveSketchLine[]>()
  for (const line of reference) known.set(line.text, [...(known.get(line.text) ?? []), line])
  const inputIds: Record<InputKey, string> = { hash: 'input-hash', background: 'view-background', speed: 'view-speed', playing: 'view-playing' }
  const used = new Set<string>()
  return source.split('\n').map((text, index) => {
    const input = (Object.keys(declarations) as InputKey[]).find(key => new RegExp(`^\\s*const\\s+${declarations[key]}\\s*=`).test(text))
    const match = input ? { id: inputIds[input], focus: true } : known.get(text)?.shift()
    const id = match && !used.has(match.id) ? match.id : `custom-${index}`
    used.add(id)
    return { id, text, ...(match?.focus ? { focus: true } : {}) }
  })
}

/** A conservative fast path: custom code, even outside the body, runs isolated. */
export function isOriginalSketch(source: string): boolean {
  return withoutInputValues(source.replace(/\r\n/g, '\n').trim()) === originalTemplate
}

/** Stable line IDs for the original expressions affected by a form edit. */
export function affectedScriptLines(previousHash: string, nextHash: string, previousView?: LiveSketchView, nextView?: LiveSketchView): string[] {
  const before = parseHash(previousHash)
  const after = parseHash(nextHash)
  const changed = before.flatMap((value, index) => value !== after[index] ? [index] : [])
  const ids = new Set<string>()
  originalLines.forEach((line, index) => {
    if (changed.some(byteIndex => byteIndex <= 20
      ? line.includes('decPairs[j')
      : line.includes(`decPairs[${byteIndex}]`))) ids.add(`original-${index}`)
  })
  if (changed.some(index => index <= 6)) originalLines.forEach((line, index) => {
    if (line.includes('seed = parseInt')) ids.add(`original-${index}`)
  })
  if (changed.length) ids.add('input-hash')
  if (previousView && nextView) {
    if (previousView.background !== nextView.background) ids.add('view-background')
    if (previousView.speed !== nextView.speed) ids.add('view-speed')
    if (previousView.playing !== nextView.playing) ids.add('view-playing')
  }
  return [...ids]
}
