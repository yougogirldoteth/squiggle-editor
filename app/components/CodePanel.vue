<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { basicSetup } from 'codemirror'
import { Annotation, EditorState, Prec, StateEffect, StateField, Transaction } from '@codemirror/state'
import type { ChangeSpec, Text } from '@codemirror/state'
import { Decoration, EditorView, keymap } from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'
import { javascript } from '@codemirror/lang-javascript'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import EditorIcon from './EditorIcon.vue'

interface CodeLine { id: string; text: string; focus?: boolean }
const props = withDefaults(defineProps<{
  lines: readonly CodeLine[]
  title?: string
  modified?: boolean
  pending?: boolean
  error?: string
  highlightedLineIds?: readonly string[]
  highlightRevision?: number
}>(), { title: 'squiggle.js', modified: false, pending: false, error: '', highlightedLineIds: () => [], highlightRevision: 0 })
const emit = defineEmits<{
  edit: [source: string]
  run: []
  reset: []
}>()

const editorHost = ref<HTMLDivElement>()
const titleId = useId()
const errorId = useId()
const copyState = ref<'idle' | 'copied' | 'failed'>('idle')
const copyMessage = computed(() => copyState.value === 'copied' ? 'Code copied' : copyState.value === 'failed' ? 'Copy unavailable. Select the code to copy it.' : '')
const externalChange = Annotation.define<boolean>()
const replaceDecorations = StateEffect.define<DecorationSet>()
const highlightExpiry = new Map<string, number>()
let currentLines: readonly CodeLine[] = props.lines
let previousText = new Map(props.lines.map(line => [line.id, line.text]))
let previousHighlighted = props.highlightedLineIds.join('\n')
let previousHighlightRevision = props.highlightRevision
let view: EditorView | undefined
let motionQuery: MediaQueryList | undefined
let initialFrame: number | undefined
let highlightTimer: ReturnType<typeof setTimeout> | undefined
let scrollTimer: ReturnType<typeof setTimeout> | undefined
let copyTimer: ReturnType<typeof setTimeout> | undefined
let pendingScrollId: string | undefined
let manualScrollUntil = 0
let automaticScrollUntil = 0
let pointerDown = false
let ready = false
let mounted = false
let copyRequest = 0

function lineDecorations(doc: Text): DecorationSet {
  const ranges = []
  for (let index = 0; index < Math.min(currentLines.length, doc.lines); index++) {
    const id = currentLines[index]!.id
    ranges.push(Decoration.line({
      class: highlightExpiry.has(id) ? 'code-panel__line is-changed' : 'code-panel__line',
      attributes: { 'data-line-id': id },
    }).range(doc.line(index + 1).from))
  }
  return Decoration.set(ranges, true)
}

const lineField = StateField.define<DecorationSet>({
  create: state => lineDecorations(state.doc),
  update(decorations, transaction) {
    decorations = decorations.map(transaction.changes)
    for (const effect of transaction.effects) if (effect.is(replaceDecorations)) decorations = effect.value
    return decorations
  },
  provide: field => EditorView.decorations.from(field),
})

const colors = HighlightStyle.define([
  { tag: tags.keyword, color: '#7e6287' },
  { tag: [tags.string, tags.regexp], color: '#7f7742' },
  { tag: [tags.number, tags.bool, tags.null], color: '#9b7046' },
  { tag: tags.comment, color: '#7a866f' },
  { tag: tags.function(tags.variableName), color: '#4c7882' },
  { tag: [tags.propertyName, tags.definition(tags.variableName)], color: '#536c49' },
])

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '12px', color: '#3d4636', backgroundColor: '#fbfbf7' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
    lineHeight: '21px', overscrollBehavior: 'contain', scrollbarWidth: 'thin', scrollbarColor: '#cbd3c0 transparent',
  },
  '.cm-content': { padding: '12px 0 20px', caretColor: '#405632' },
  '.cm-line': { padding: '0 16px 0 10px' },
  '.cm-gutters': { backgroundColor: '#fbfbf7', color: '#969f8b', border: 'none' },
  '.cm-gutterElement': { fontSize: '10px' },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '30px', padding: '0 5px 0 8px' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 2px', color: '#9aa58d' },
  '.cm-activeLine': { backgroundColor: '#eef1e766' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#5e7350' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: '#dde6cf' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#405632' },
  '.cm-matchingBracket': { backgroundColor: '#e3ead8', outline: '1px solid #c4d1b6' },
  '.cm-tooltip': { border: '1px solid #dfe3d7', backgroundColor: '#fbfbf7', fontFamily: 'inherit' },
  '.cm-panels': { backgroundColor: '#f1f3eb', color: '#536149' },
  '.cm-searchMatch': { backgroundColor: '#efe7ba' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#ddd29b' },
})

function getSource() { return view?.state.doc.toString() ?? props.lines.map(line => line.text).join('\n') }
function focus() { view?.focus() }
function run() { emit('run') }

// Small line edits preserve unrelated selections, folding and undo history.
// A structural replacement still retains its common prefix and suffix.
function replacement(before: string, after: string, offset = 0): ChangeSpec | undefined {
  if (before === after) return
  let from = 0
  while (from < before.length && from < after.length && before[from] === after[from]) from++
  let suffix = 0
  while (suffix < before.length - from && suffix < after.length - from && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++
  return { from: offset + from, to: offset + before.length - suffix, insert: after.slice(from, after.length - suffix) }
}

function documentChanges(doc: Text, lines: readonly CodeLine[]): ChangeSpec[] {
  if (doc.lines !== lines.length) {
    const change = replacement(doc.toString(), lines.map(line => line.text).join('\n'))
    return change ? [change] : []
  }
  const changes: ChangeSpec[] = []
  for (let index = 0; index < lines.length; index++) {
    const before = doc.line(index + 1)
    const change = replacement(before.text, lines[index]!.text, before.from)
    if (change) changes.push(change)
  }
  return changes
}

function expireHighlights() {
  clearTimeout(highlightTimer)
  highlightTimer = undefined
  const now = performance.now()
  for (const [id, expiry] of highlightExpiry) if (expiry <= now) highlightExpiry.delete(id)
  if (view) view.dispatch({ effects: replaceDecorations.of(lineDecorations(view.state.doc)) })
  if (highlightExpiry.size) {
    const next = Math.min(...highlightExpiry.values())
    highlightTimer = setTimeout(expireHighlights, Math.max(1, next - now))
  }
}

function scheduleHighlightExpiry() {
  clearTimeout(highlightTimer)
  highlightTimer = undefined
  if (highlightExpiry.size) highlightTimer = setTimeout(expireHighlights, Math.max(1, Math.min(...highlightExpiry.values()) - performance.now()))
}

function hasCodeSelection() {
  const selection = window.getSelection()
  return !!selection && !selection.isCollapsed && !!view &&
    (view.dom.contains(selection.anchorNode) || view.dom.contains(selection.focusNode))
}

function scrollToChange() {
  scrollTimer = undefined
  const id = pendingScrollId
  pendingScrollId = undefined
  const editor = view
  const index = currentLines.findIndex(line => line.id === id)
  if (!editor || index < 0 || index >= editor.state.doc.lines || !editor.scrollDOM.clientHeight || editor.hasFocus || pointerDown || performance.now() < manualScrollUntil || hasCodeSelection()) return
  editor.requestMeasure({
    key: scrollToChange,
    read: editor => {
      const currentIndex = currentLines.findIndex(line => line.id === id)
      if (currentIndex < 0 || currentIndex >= editor.state.doc.lines) return null
      const viewport = editor.scrollDOM.getBoundingClientRect()
      const line = editor.lineBlockAt(editor.state.doc.line(currentIndex + 1).from)
      const top = editor.documentTop + line.top
      if (top >= viewport.top + 8 && top + line.height <= viewport.bottom - 8) return null
      return editor.scrollDOM.scrollTop + top - viewport.top - (editor.scrollDOM.clientHeight - line.height) / 2
    },
    write: (top, editor) => {
      if (top === null || editor !== view || editor.hasFocus || pointerDown || performance.now() < manualScrollUntil || hasCodeSelection()) return
      automaticScrollUntil = performance.now() + 500
      editor.scrollDOM.scrollTo({ top, behavior: motionQuery?.matches ? 'auto' : 'smooth' })
    },
  })
}

function queueScroll(id: string) {
  const now = performance.now()
  if (!view || view.hasFocus || pointerDown || now < manualScrollUntil || hasCodeSelection()) return
  pendingScrollId = id
  if (scrollTimer !== undefined) return
  scrollTimer = setTimeout(scrollToChange, Math.max(120, automaticScrollUntil - now))
}

function pauseAutomaticScroll() {
  manualScrollUntil = performance.now() + 1500
  pendingScrollId = undefined
  clearTimeout(scrollTimer)
  scrollTimer = undefined
  if (performance.now() < automaticScrollUntil && view) view.scrollDOM.scrollTo({ top: view.scrollDOM.scrollTop, behavior: 'auto' })
  automaticScrollUntil = 0
}
function onPointerDown() { pointerDown = true; pauseAutomaticScroll() }
function onPointerUp() { pointerDown = false }
function onScroll() { if (performance.now() >= automaticScrollUntil) pauseAutomaticScroll() }
function onKeyDown() { pauseAutomaticScroll() }

async function copyCode() {
  const request = ++copyRequest
  clearTimeout(copyTimer)
  try {
    await navigator.clipboard.writeText(getSource())
    if (!mounted || request !== copyRequest) return
    copyState.value = 'copied'
  } catch {
    if (!mounted || request !== copyRequest) return
    copyState.value = 'failed'
  }
  copyTimer = setTimeout(() => { copyState.value = 'idle' }, 1800)
}

watch(() => ({
  lines: props.lines.map(line => ({ id: line.id, text: line.text, focus: line.focus })),
  highlighted: [...props.highlightedLineIds],
  revision: props.highlightRevision,
}), ({ lines, highlighted, revision }) => {
  const changed = lines.filter(line => previousText.get(line.id) !== line.text)
  const explicitChanged = revision !== previousHighlightRevision || highlighted.join('\n') !== previousHighlighted
  previousText = new Map(lines.map(line => [line.id, line.text]))
  previousHighlighted = highlighted.join('\n')
  previousHighlightRevision = revision
  currentLines = lines
  if (!view) return
  const changes = view.state.changes(documentChanges(view.state.doc, lines))
  const ids = new Set(lines.map(line => line.id))
  for (const id of highlightExpiry.keys()) if (!ids.has(id)) highlightExpiry.delete(id)
  const explicit = highlighted.filter(id => ids.has(id))
  if (ready) {
    const expiry = performance.now() + 900
    if (!changes.empty) for (const line of changed) highlightExpiry.set(line.id, expiry)
    if (!changes.empty || explicitChanged) for (const id of explicit) highlightExpiry.set(id, expiry)
  }
  const effects: StateEffect<unknown>[] = [replaceDecorations.of(lineDecorations(changes.apply(view.state.doc)))]
  if (!changes.empty && !view.hasFocus) {
    const snapshot = view.scrollSnapshot().map(changes)
    if (snapshot) effects.push(snapshot)
  }
  view.dispatch({ changes, effects, annotations: [externalChange.of(true), Transaction.addToHistory.of(false)] })
  scheduleHighlightExpiry()
  if (ready && (!changes.empty || explicitChanged)) {
    const first = explicit[0] ?? changed.find(line => line.focus !== false)?.id
    if (first) queueScroll(first)
  }
}, { flush: 'post' })

onMounted(() => {
  mounted = true
  currentLines = props.lines
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  view = new EditorView({
    parent: editorHost.value,
    state: EditorState.create({
      doc: props.lines.map(line => line.text).join('\n'),
      extensions: [
        basicSetup, javascript(), syntaxHighlighting(colors), theme, lineField,
        EditorState.tabSize.of(2),
        EditorView.contentAttributes.of({ 'aria-label': 'JavaScript source', 'aria-describedby': errorId, spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off' }),
        Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => { run(); return true }, preventDefault: true }])),
        EditorView.updateListener.of(update => {
          if (update.transactions.some(transaction => transaction.docChanged && !transaction.annotation(externalChange))) {
            pauseAutomaticScroll()
            emit('edit', update.state.doc.toString())
          }
        }),
      ],
    }),
  })
  view.scrollDOM.addEventListener('wheel', pauseAutomaticScroll, { passive: true })
  view.scrollDOM.addEventListener('touchstart', pauseAutomaticScroll, { passive: true })
  view.scrollDOM.addEventListener('pointerdown', onPointerDown)
  view.scrollDOM.addEventListener('scroll', onScroll, { passive: true })
  view.contentDOM.addEventListener('keydown', onKeyDown)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
  initialFrame = requestAnimationFrame(() => {
    initialFrame = requestAnimationFrame(() => { ready = true; initialFrame = undefined })
  })
})

onBeforeUnmount(() => {
  mounted = false
  ready = false
  copyRequest++
  if (initialFrame !== undefined) cancelAnimationFrame(initialFrame)
  clearTimeout(highlightTimer)
  clearTimeout(scrollTimer)
  clearTimeout(copyTimer)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
  view?.scrollDOM.removeEventListener('wheel', pauseAutomaticScroll)
  view?.scrollDOM.removeEventListener('touchstart', pauseAutomaticScroll)
  view?.scrollDOM.removeEventListener('pointerdown', onPointerDown)
  view?.scrollDOM.removeEventListener('scroll', onScroll)
  view?.contentDOM.removeEventListener('keydown', onKeyDown)
  view?.destroy()
  view = undefined
})

defineExpose({ focus, getSource })
</script>

<template>
  <section class="code-panel" :aria-labelledby="titleId">
    <header class="code-panel__header">
      <div class="code-panel__identity">
        <span :id="titleId" class="code-panel__title">{{ title }}</span>
        <span v-if="modified" class="code-panel__status">Custom</span>
        <a v-else class="code-panel__status code-panel__provenance" href="https://etherscan.io/address/0x059edd72cd353df5106d2b9cc5ab83a52287ac3a#code" target="_blank" rel="noopener noreferrer" title="Verified Snowfro source on Ethereum">On-chain</a>
      </div>
      <div class="code-panel__actions">
        <button class="code-panel__button code-panel__run" :class="{ 'is-pending': pending }" aria-label="Run code" :title="pending ? 'Run unapplied edits (⌘/Ctrl Enter)' : 'Run code (⌘/Ctrl Enter)'" @click="run">
          <EditorIcon name="play" /><span>Run</span>
        </button>
        <button v-if="modified" class="code-panel__button" aria-label="Reset original code" title="Reset original code" @click="emit('reset')">
          <EditorIcon name="reset" /><span class="code-panel__button-label">Reset</span>
        </button>
        <button class="code-panel__button" :class="{ 'is-copied': copyState === 'copied' }" aria-label="Copy code" :title="copyMessage || 'Copy code'" @click="copyCode">
          <EditorIcon :name="copyState === 'copied' ? 'check' : 'copy'" /><span class="code-panel__button-label">{{ copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Unavailable' : 'Copy' }}</span>
        </button>
      </div>
      <span class="code-panel__sr-only" role="status" aria-live="polite">{{ copyMessage }}</span>
    </header>
    <p :id="errorId" class="code-panel__error" :class="{ 'code-panel__sr-only': !error }" :role="error ? 'alert' : undefined">{{ error }}</p>
    <div ref="editorHost" class="code-panel__editor" @keydown.stop />
  </section>
</template>

<style scoped>
.code-panel {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--line, #dfe3d7);
  border-radius: 12px;
  background: #fbfbf7;
  color: #3d4636;
}
.code-panel__header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 44px;
  padding: 5px 8px 5px 14px;
  border-bottom: 1px solid var(--line, #dfe3d7);
  background: #f6f7f0;
}
.code-panel__identity { display: flex; align-items: center; gap: 8px; min-width: 0; }
.code-panel__title {
  overflow: hidden;
  font: 11px/20px ui-monospace, SFMono-Regular, Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #68765c;
}
.code-panel__status { flex-shrink: 0; font-size: 10px; color: #9a8051; }
.code-panel__provenance { color: #748463; white-space: nowrap; }
.code-panel__actions { display: flex; flex-shrink: 0; align-items: center; gap: 2px; }
.code-panel__button {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 32px;
  padding: 0 7px;
  border-radius: 6px;
  font-size: 11px;
  color: #78836c;
}
.code-panel__button svg { width: 14px; height: 14px; }
.code-panel__button.is-copied { color: #4f6c39; }
.code-panel__run { color: #4f663e; background: #e9eedf; }
.code-panel__run.is-pending { color: #fff; background: #536b40; }
.code-panel__run.is-pending:hover { background: #425931; }
.code-panel__editor { flex: 1 1 auto; min-width: 0; min-height: 0; overflow: hidden; }
.code-panel__error {
  flex-shrink: 0;
  max-height: 72px;
  margin: 0;
  padding: 8px 12px;
  overflow: auto;
  border-bottom: 1px solid #e5d5c7;
  background: #faf1e8;
  color: #91583e;
  font: 11px/17px ui-monospace, SFMono-Regular, Consolas, monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.code-panel :deep(.cm-line) { transition: background-color 160ms ease; }
.code-panel :deep(.cm-line.is-changed) { background-color: #f1efd9; animation: code-line-change 220ms ease-out; }
@keyframes code-line-change { from { transform: translateX(2px); } to { transform: translateX(0); } }
.code-panel__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}
@container (max-width: 380px) {
  .code-panel__button-label { display: none; }
  .code-panel__button { padding: 0 6px; }
  .code-panel__header { padding-left: 10px; }
}
@container (max-width: 300px) {
  .code-panel__title { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .code-panel :deep(.cm-line) { transition: none; }
  .code-panel :deep(.cm-line.is-changed) { animation: none; }
}
</style>
