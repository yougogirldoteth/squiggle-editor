import { createHash } from 'node:crypto'
import { createContext, runInContext, Script } from 'node:vm'
import { describe, expect, it } from 'vitest'
import rawOriginal from '../app/data/snowfro-script.js?raw'
import formattedOriginal from '../app/data/snowfro-script.formatted.js?raw'
import { affectedScriptLines, createLiveSketch, isOriginalSketch, readSketchInputs, sketchLines, updateSketchInputs, type LiveSketchView } from '../app/utils/liveSketch'
import { DEFAULT_HASH, decodeHash, parseHash, setByte, setType, TYPES } from '../app/utils/squiggle'

const view: LiveSketchView = { background: '#ffffff', speed: 1, playing: false }

function runSource(source: string, windowWidth = 900, windowHeight = 600) {
  const operations: unknown[][] = []
  let offsetX = 0
  let offsetY = 0
  let fillColor: unknown = [255]
  let strokeColor: unknown = [0]
  let weight = 1
  const context = createContext({
    windowWidth, windowHeight, width: windowWidth, height: windowHeight,
    HSB: 'hsb', UP_ARROW: 38, DOWN_ARROW: 40, SHIFT: 16,
    document: { getElementsByTagName: () => [{ addEventListener() {} }] },
    createCanvas(width: number, height: number) { context.width = width; context.height = height },
    colorMode() {},
    map(value: number, from: number, to: number, low: number, high: number) { return low + (high - low) * ((value - from) / (to - from)) },
    background(value: unknown) { operations.push(['background', value]) },
    translate(x: number, y: number) { offsetX += x; offsetY += y },
    strokeWeight(value: number) { weight = value },
    fill(...values: number[]) { fillColor = values },
    stroke(...values: number[]) { strokeColor = values },
    noFill() { fillColor = null },
    noStroke() { strokeColor = null },
    circle(x: number, y: number, diameter: number) { operations.push(['circle', x + offsetX, y + offsetY, diameter, fillColor, strokeColor, weight]) },
    dist(x: number, y: number, a: number, b: number) { return Math.sqrt((a - x) ** 2 + (b - y) ** 2) },
    keyIsDown: () => false,
    curvePoint(a: number, b: number, c: number, d: number, t: number) {
      const t2 = t * t
      const t3 = t2 * t
      return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
    },
  })
  new Script(source).runInContext(context)
  runInContext('setup()', context)
  return {
    value: (expression: string) => runInContext(expression, context),
    draw() {
      operations.length = 0
      offsetX = 0
      offsetY = 0
      runInContext('draw()', context)
      return [...operations]
    },
  }
}

function originalWithInputs(hash: string, settings: LiveSketchView) {
  return `let tokenData = {hashes:[${JSON.stringify(hash)}]};\n${rawOriginal}\nspeed=${settings.speed};backgroundArray[0]=${JSON.stringify(settings.background)};backgroundIndex=0;loops=${settings.playing};`
}

describe('verified original live sketch', () => {
  it('retains the on-chain byte digest and includes only a formatting copy in the editable body', () => {
    expect(createHash('sha256').update(rawOriginal).digest('hex')).toBe('d6e475f342854bcc8424867a97965e1bca31b79971c71a21456d8c1a9b230390')
    expect(Buffer.byteLength(rawOriginal)).toBe(5519)
    const sketch = createLiveSketch(DEFAULT_HASH, view)
    const body = sketch.source.split('// Original script — formatting only; source is verified on chain.\n')[1]!.split('\n// End original script')[0]
    expect(body).toBe(formattedOriginal.trimEnd())
    expect(sketch.source).toBe(sketch.lines.map(line => line.text).join('\n'))
    expect(sketchLines(sketch.source)).toEqual(sketch.lines)
    expect(new Set(sketch.lines.map(line => line.id)).size).toBe(sketch.lines.length)
    expect(readSketchInputs(sketch.source)).toEqual({ hash: DEFAULT_HASH, ...view })
    expect(isOriginalSketch(sketch.source)).toBe(true)
  })

  it.each(TYPES)('runs the formatted %s script identically to the exact original source', (type) => {
    for (const [reverse, hyper, width, height] of [[false, false, 900, 600], [true, false, 390, 514], [false, true, 1200, 600], [true, true, 900, 1000]] as const) {
      let hash = setType(DEFAULT_HASH, type)
      hash = setByte(setByte(hash, 30, reverse ? 127 : 128), 28, hyper ? 2 : 73)
      const settings = { background: '#afafaf', speed: 2.5, playing: true }
      const actual = runSource(createLiveSketch(hash, settings).source, width, height)
      const expected = runSource(originalWithInputs(hash, settings), width, height)
      expect(actual.value('decPairs')).toEqual(parseHash(hash))
      expect(actual.value('fuzzy')).toBe(decodeHash(hash).fuzzy)
      expect(actual.draw()).toEqual(expected.draw())
      expect(actual.draw()).toEqual(expected.draw())
      expect(actual.value('index')).toBe(5)
    }
  })

  it('retains Fuzzy token 7 randomness, fractional segments and latent flags', () => {
    const fuzzy = '0x3c17af010c7af574f5dab0f449e3e360212d9bc9521e16709aff20a8b0fb44ba'
    const changedSeed = setByte(fuzzy, 6, parseHash(fuzzy)[6]! + 16)
    const hashes = [fuzzy, changedSeed, setByte(setByte(setByte(fuzzy, 26, 1), 23, 0), 24, 0)]
    const traces = hashes.map(hash => {
      const actual = runSource(createLiveSketch(hash, view).source)
      const expected = runSource(originalWithInputs(hash, view))
      const trace = actual.draw()
      expect(trace).toEqual(expected.draw())
      expect(actual.draw()).toEqual(trace)
      return trace
    })
    expect(traces[0]!.filter(op => op[0] === 'circle')).toHaveLength(6900)
    expect(traces[1]).not.toEqual(traces[0])
  })
})

describe('safe editable wrapper synchronization', () => {
  it('patches wrapper literals while preserving every custom byte outside them', () => {
    const source = createLiveSketch(DEFAULT_HASH, view).source.replace('let wt = 2;', 'let wt = 3;')
      + '\nconst customString = "const editorSpeed = 999;";\n// personal code stays here\n'
    const hash = setByte(DEFAULT_HASH, 29, 20)
    const settings = { background: '#191919', speed: 4, playing: true }
    const updated = updateSketchInputs(source, hash, settings)
    expect(readSketchInputs(updated)).toEqual({ hash, ...settings })
    expect(updated.slice(updated.indexOf('// End editor inputs'))).toBe(source.slice(source.indexOf('// End editor inputs')))
    expect(updated).toContain('let wt = 3;')
    expect(updated).toContain('const editorSpeed = 999;')
    expect(isOriginalSketch(updated)).toBe(false)
    expect(updateSketchInputs('function setup() {}', hash, settings)).toBe('function setup() {}')
  })

  it('does not interpret expressions or overwrite custom expressions with form inputs', () => {
    let source = createLiveSketch(DEFAULT_HASH, view).source
    source = source.replace('const editorSpeed = 1;', 'const editorSpeed = (() => { throw Error("do not execute"); })();')
    source = source.replace('const editorPlaying = false;', 'const editorPlaying = Boolean(1);')
    expect(readSketchInputs(source)).toEqual({ hash: DEFAULT_HASH, background: view.background })
    const updated = updateSketchInputs(source, DEFAULT_HASH, { ...view, speed: 3, playing: true })
    expect(updated).toContain('const editorSpeed = (() => { throw Error("do not execute"); })();')
    expect(updated).toContain('const editorPlaying = Boolean(1);')
    expect(isOriginalSketch(updated)).toBe(false)
  })

  it('patches only the changed form inputs, retaining unrelated pending literal edits', () => {
    const source = createLiveSketch(DEFAULT_HASH, view).source
      .replace('const editorSpeed = 1;', 'const editorSpeed = 12.5;')
      .replace('const editorBackground = "#ffffff";', 'const editorBackground = "#191919";')
    const hash = setByte(DEFAULT_HASH, 29, 37)
    const updated = updateSketchInputs(source, hash, view, ['hash'])
    expect(readSketchInputs(updated)).toEqual({ hash, background: '#191919', speed: 12.5, playing: false })
    expect(updateSketchInputs(source, hash, view, [])).toBe(source)
    const playingOnly = updateSketchInputs(updated, DEFAULT_HASH, { ...view, playing: true }, ['playing'])
    expect(readSketchInputs(playingOnly)).toEqual({ hash, background: '#191919', speed: 12.5, playing: true })
  })

  it('reads quoted literals and grayscale safely, ignoring malformed or duplicate declarations', () => {
    let source = createLiveSketch(DEFAULT_HASH, view).source
    source = source.replace(JSON.stringify(DEFAULT_HASH), `'${DEFAULT_HASH.toUpperCase()}'`)
    source = source.replace('const editorBackground = "#ffffff";', 'const editorBackground = 200;')
    source = source.replace('const editorSpeed = 1;', 'const editorSpeed = 1.25e1; // literal value')
    expect(readSketchInputs(source)).toEqual({ hash: DEFAULT_HASH, background: '#c8c8c8', speed: 12.5, playing: false })
    source = source.replace('// End editor inputs', 'const editorSpeed = 2;\n// End editor inputs')
    expect(readSketchInputs(source).speed).toBeUndefined()
    expect(readSketchInputs(source.replace(DEFAULT_HASH.toUpperCase(), '0x00')).hash).toBeUndefined()
    const escaped = createLiveSketch(DEFAULT_HASH, { ...view, background: '"; throw Error("no execution"); //\n' }).source
    expect(readSketchInputs(escaped).background).toBe('"; throw Error("no execution"); //\n')
  })

  it('uses native fast path only when the entire script and wrapper are still original', () => {
    const source = createLiveSketch(DEFAULT_HASH, view).source
    expect(isOriginalSketch(updateSketchInputs(source, setByte(DEFAULT_HASH, 0, 1), { ...view, speed: 5 }))).toBe(true)
    expect(isOriginalSketch(source.replace(/\n/g, '\r\n'))).toBe(true)
    expect(isOriginalSketch(source + '\nwt = 4;')).toBe(false)
    expect(isOriginalSketch(source.replace('speed = editorSpeed;', 'speed = 50;'))).toBe(false)
    expect(isOriginalSketch(source.replace('let wt = 2;', 'let wt = 4;'))).toBe(false)
    expect(isOriginalSketch(source.replace('const editorSpeed = 1;', 'const editorSpeed = Math.random();'))).toBe(false)
  })

  it('maps affected original expressions before the hash wrapper and retains IDs after custom insertions', () => {
    const sketch = createLiveSketch(DEFAULT_HASH, view)
    const hueIds = affectedScriptLines(DEFAULT_HASH, setByte(DEFAULT_HASH, 29, 1))
    expect(sketch.lines.find(line => line.id === hueIds[0])!.text).toContain('decPairs[29]')
    expect(hueIds.at(-1)).toBe('input-hash')
    const shapeIds = affectedScriptLines(DEFAULT_HASH, setByte(DEFAULT_HASH, 4, 1))
    expect(sketch.lines.find(line => line.id === shapeIds[0])!.text).toContain('decPairs[j')
    expect(affectedScriptLines(DEFAULT_HASH, DEFAULT_HASH, view, { ...view, playing: true })).toEqual(['view-playing'])
    const updated = updateSketchInputs('// custom introduction\n' + sketch.source, setByte(DEFAULT_HASH, 29, 1), view)
    const customLines = sketchLines(updated)
    expect(new Set(customLines.map(line => line.id)).size).toBe(customLines.length)
    expect(customLines.find(line => line.text.includes('let startColor = decPairs[29]'))!.id).toBe(hueIds[0])
  })
})
