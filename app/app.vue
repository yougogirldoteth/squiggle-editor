<script setup lang="ts">
import { socialPreviewInputs } from '~/utils/socialPreview'
import EditorRange from '~/components/EditorRange.vue'
import HashInput from '~/components/HashInput.vue'
// Keep the preview shell synchronous: Run followed immediately by Reset must
// not leave an unresolved async branch inside Nuxt's Suspense boundary.
import ScriptPreview from '~/components/ScriptPreview.vue'
import { createLiveSketch, sketchLines, isOriginalSketch, affectedScriptLines, pointScriptLines } from '~/utils/liveSketch'
import { DEFAULT_HASH, TYPES, decodeHash, parseHash, toHash, setByte, setType, randomHash, visibleStartHue, setStartingHue } from '~/utils/squiggle'
import type { SquiggleType } from '~/utils/squiggle'
import { HashHistory } from '~/utils/history'

const previewQuery = useRequestURL().searchParams
const social = socialPreviewInputs(previewQuery.get('hash'), previewQuery.get('bg'))
useSeoMeta({
  ogTitle: 'Squiggle Editor',
  ogDescription: 'An independent editor for the Chromie Squiggle algorithm by Snowfro.',
  ogType: 'website',
  ogUrl: `${useSiteConfig().url}/?hash=${social.hash}&bg=${social.background}`,
  twitterCard: 'summary_large_image',
  twitterTitle: 'Squiggle Editor',
  twitterDescription: 'An independent editor for the Chromie Squiggle algorithm by Snowfro.',
})
defineOgImage('Artwork', {
  src: `/og/artwork/${social.hash}/${social.background}.png`,
  background: `#${social.background}`,
}, { alt: 'Chromie Squiggle by Snowfro', cacheKey: `artwork-v1-${social.hash}-${social.background}` })

const CodePanel = defineAsyncComponent(() => import('~/components/CodePanel.vue'))

const history = reactive(new HashHistory(DEFAULT_HASH))
const hash = ref(DEFAULT_HASH)
const traits = computed(() => decodeHash(hash.value))
const startingHue = computed(() => visibleStartHue(traits.value))
const canvas = ref<{ exportPng: () => void; resetPhase: () => void } | null>(null)
const hashDraft = ref(DEFAULT_HASH)
const hashError = ref('')
const playing = ref(false)
const dragging = ref(false)
const drawMode = ref(false)
const drawToggle = ref<HTMLButtonElement>()
const codeMode = ref(false)
const background = ref('#ffffff')
const grayLevels = [255, 225, 200, 175, 150, 125, 100, 75, 50, 25, 0]
const backgrounds = grayLevels.map(gray => `#${gray.toString(16).padStart(2, '0').repeat(3)}`)
const backgroundIndex = computed(() => backgrounds.indexOf(background.value))
const swatches = [backgrounds[0]!, backgrounds[4]!, backgrounds[10]!]
const speed = ref(1)
const sketchView = () => ({ background: background.value, speed: speed.value, playing: playing.value })
const codePanel = ref<{ resumeFollowing: () => void } | null>(null)
const codeInitialized = ref(false)
const customRunning = ref(false)
const codeDraft = ref('')
const appliedCode = ref('')
const previewSource = ref('')
const previewContext = shallowRef({ hash: hash.value, view: sketchView() })
const previewRevision = ref(0)
const scriptPreview = ref<{ exportPng: () => Promise<Blob> } | null>(null)
const codeError = ref('')
const highlightedLineIds = ref<string[]>([])
const highlightRevision = ref(0)
const codeLines = computed(() => codeMode.value ? sketchLines(codeDraft.value) : [])
const codeModified = computed(() => codeInitialized.value && !isOriginalSketch(codeDraft.value))
const codePending = computed(() => codeDraft.value !== appliedCode.value)
let previewTimer: ReturnType<typeof setTimeout> | undefined

function revealPointCode() {
  if (!codeMode.value) return
  highlightedLineIds.value = pointScriptLines()
  highlightRevision.value++
}
function resumeCodeFollowing(event: Event) {
  const target = event.target
  if (!(target instanceof Element) || target.closest('.code-panel')) return
  codePanel.value?.resumeFollowing()
  if (event instanceof KeyboardEvent && target.closest('.squiggle-canvas') && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) revealPointCode()
}
function selectPoint(index: number) {
  selectedPoint.value = index
  revealPointCode()
}
function startDrag() {
  history.begin()
  dragging.value = true
  revealPointCode()
}
function editCode(source: string) {
  codeDraft.value = source
  highlightedLineIds.value = []
}
function runCode() {
  drawMode.value = false
  clearTimeout(previewTimer)
  codeError.value = ''
  const source = codeDraft.value
  appliedCode.value = source
  customRunning.value = !isOriginalSketch(source)
  previewSource.value = source
  previewContext.value = { hash: hash.value, view: sketchView() }
  previewRevision.value++
  if (!customRunning.value) canvas.value?.resetPhase()
}
function resetCode() {
  clearTimeout(previewTimer)
  codeInitialized.value = true
  customRunning.value = false
  codeDraft.value = createLiveSketch().source
  appliedCode.value = codeDraft.value
  previewSource.value = ''
  codeError.value = ''
  highlightedLineIds.value = []
}
async function exportArtwork() {
  if (!customRunning.value) { canvas.value?.exportPng(); return }
  const exportHash = hash.value
  try {
    const blob = await scriptPreview.value?.exportPng()
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `squiggle-custom-${exportHash}.png`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (error) { announce(error instanceof Error ? error.message : 'Could not export this sketch.') }
}
watch(codeMode, enabled => { if (enabled && !codeInitialized.value) resetCode() })
watch([hash, background, speed, playing], ([nextHash, bg, nextSpeed, nextPlaying], [previousHash, oldBg, oldSpeed, oldPlaying]) => {
  if (!codeInitialized.value) return
  const view = { background: bg, speed: nextSpeed, playing: nextPlaying }
  const oldView = { background: oldBg, speed: oldSpeed, playing: oldPlaying }
  highlightedLineIds.value = affectedScriptLines(previousHash, nextHash, oldView, view)
  highlightRevision.value++
  if (customRunning.value) {
    // View changes update the running sketch immediately; only a new hash
    // requires a debounced restart of its token-dependent declarations.
    previewContext.value = { hash: previewContext.value.hash, view }
    if (nextHash !== previousHash) {
      clearTimeout(previewTimer)
      previewTimer = setTimeout(() => { previewContext.value = { hash: hash.value, view: sketchView() } }, 160)
    }
  }
}, { flush: 'sync' })
const tabs = ['Color', 'Shape', 'Texture', 'View'] as const
const activeTab = ref<typeof tabs[number]>('Color')
const selectedPoint = ref(8)
const pointCount = computed(() => Math.ceil(traits.value.segments - 2) + 3)
watch(pointCount, count => { selectedPoint.value = Math.min(selectedPoint.value, count - 1) })
const notice = ref('')
let noticeTimer: ReturnType<typeof setTimeout> | undefined
let urlTimer: ReturnType<typeof setTimeout> | undefined
let initialHash = DEFAULT_HASH
let lastSpread = 80

function announce(message: string) {
  notice.value = message
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => { notice.value = '' }, 2400)
}
function sync(value: string) {
  hash.value = value
  hashDraft.value = value
  hashError.value = ''
  canvas.value?.resetPhase()
}
function update(value: string, commit = false) {
  history.update(value)
  sync(value)
  if (commit) history.commit()
}
function byte(index: number, value: number) { update(setByte(hash.value, index, value)) }
function selectTab(tab: typeof tabs[number]) { history.commit(); activeTab.value = tab }
function tabKey(event: KeyboardEvent, index: number) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? 3 : (index + (event.key === 'ArrowRight' ? 1 : 3)) % 4
  selectTab(tabs[next]!)
  document.getElementById(`tab-${tabs[next]}`)?.focus()
}
function chooseType(type: SquiggleType) { update(setType(hash.value, type), true) }
function toggleDraw() {
  history.commit()
  drawMode.value = !drawMode.value
  if (drawMode.value) playing.value = false
}
function closeDraw() {
  drawMode.value = false
  nextTick(() => drawToggle.value?.focus({ preventScroll: true }))
}
function togglePlayback() {
  drawMode.value = false
  playing.value = !playing.value
}
function applyDrawing(value: string) {
  history.commit()
  update(value, true)
}
function undo() { sync(history.undo()) }
function redo() { sync(history.redo()) }
function randomize() { update(randomHash(), true) }
function reset() { update(initialHash, true); announce('Reset') }
function toggleHyper() {
  if (!traits.value.hyper) lastSpread = traits.value.bytes[28]!
  update(setByte(hash.value, 28, traits.value.hyper ? Math.max(3, lastSpread) : 0), true)
}
function importHash() {
  try {
    const imported = toHash(parseHash(hashDraft.value.trim()))
    update(imported, true)
    announce('Hash loaded')
  } catch { hashError.value = 'Use 0x followed by 64 hexadecimal characters.' }
}
async function copy(text: string, success: string) {
  try { await navigator.clipboard.writeText(text); announce(success) }
  catch { announce('Copy unavailable. Select the hash to copy.') }
}
function stateUrl() {
  const url = new URL(window.location.href)
  url.searchParams.set('hash', hash.value)
  url.searchParams.set('bg', background.value.slice(1))
  url.searchParams.set('speed', String(speed.value))
  if (codeMode.value) url.searchParams.set('code', '1')
  else url.searchParams.delete('code')
  return url
}
function shortcut(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  if (target.isContentEditable || target.closest('.cm-editor') || target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && target.type !== 'range')) return
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    event.shiftKey ? redo() : undo()
  }
}
watch([hash, background, speed, codeMode], () => {
  if (!import.meta.client) return
  clearTimeout(urlTimer)
  urlTimer = setTimeout(() => window.history.replaceState(null, '', stateUrl()), 150)
})
onMounted(() => {
  const params = new URLSearchParams(window.location.search)
  codeMode.value = params.get('code') === '1'
  const input = params.get('hash')
  if (input) {
    try { initialHash = toHash(parseHash(input)); history.value = initialHash; sync(initialHash) }
    catch { announce('Invalid URL hash. Loaded a fresh canvas.') }
  }
  const bg = `#${params.get('bg')}`
  if (backgrounds.includes(bg)) background.value = bg
  const urlSpeed = Number(params.get('speed'))
  if (urlSpeed >= 0.1 && urlSpeed <= 20) speed.value = Math.round(urlSpeed * 10) / 10
  window.addEventListener('keydown', shortcut)
})
onBeforeUnmount(() => {
  clearTimeout(noticeTimer); clearTimeout(urlTimer); clearTimeout(previewTimer)
  window.removeEventListener('keydown', shortcut)
})
</script>

<template>
  <div class="editor" :class="{ 'has-code': codeMode }" @pointerdown.capture="resumeCodeFollowing" @keydown.capture="resumeCodeFollowing">
    <header class="masthead">
      <div class="brand"><h1>Squiggle <span>Editor</span></h1></div>
      <div class="header-actions">
        <div class="history-actions">
          <button class="icon-button" aria-label="Undo" title="Undo (⌘/Ctrl Z)" :disabled="!history.canUndo" @click="undo"><EditorIcon name="undo" /></button>
          <button class="icon-button" aria-label="Redo" title="Redo (⌘/Ctrl Shift Z)" :disabled="!history.canRedo" @click="redo"><EditorIcon name="redo" /></button>
        </div>
        <button class="new-button" title="Randomize squiggle" @click="randomize"><EditorIcon name="shuffle" /><span>New squiggle</span></button>
        <button class="export-button" aria-label="Export PNG" title="Export PNG" @click="exportArtwork"><EditorIcon name="download" /><span>Export</span></button>
      </div>
    </header>

    <section class="hash-section" aria-label="Hash">
      <div class="hash-bar" :class="{ invalid: hashError }">
        <HashInput v-model="hashDraft" :hash="hash" :animate="!dragging" :invalid="!!hashError" :described-by="hashError ? 'hash-error' : undefined" @load="importHash" @update:model-value="hashError = ''" />
        <button v-if="hashDraft !== hash" class="hash-action" aria-label="Load hash" title="Load hash" @click="importHash"><EditorIcon name="arrow" /></button>
        <button v-else class="hash-action" aria-label="Copy hash" title="Copy hash" @click="copy(hash, 'Hash copied')"><EditorIcon name="copy" /></button>
      </div>
      <span v-if="hashError" id="hash-error" class="sr-only" role="alert">{{ hashError }}</span>
    </section>

    <aside class="types" aria-label="Squiggle type">
      <p class="type-heading">Type</p>
      <div class="type-list">
        <button v-for="type in TYPES" :key="type" class="type-button" :class="{ selected: traits.type === type }" :aria-pressed="traits.type === type" @click="chooseType(type)">
          <TypePreview :type="type" /><span>{{ type }}</span>
        </button>
      </div>
      <a class="artist-credit" href="https://www.snowfro.com/projects/chromie-squiggle" target="_blank" rel="noopener noreferrer" title="Chromie Squiggle by Snowfro · Independent editor">By Snowfro ↗</a>
    </aside>

    <section class="controls-area" aria-label="Editor controls">
      <div class="control-tabs" role="tablist" aria-label="Parameters">
        <button v-for="(tab, index) in tabs" :id="`tab-${tab}`" :key="tab" role="tab" :aria-selected="activeTab === tab" :aria-controls="`panel-${tab}`" :tabindex="activeTab === tab ? 0 : -1" @click="selectTab(tab)" @keydown="tabKey($event, index)">{{ tab }}</button>
      </div>
      <div v-show="activeTab === 'Color'" id="panel-Color" class="tab-controls color-controls" role="tabpanel" aria-labelledby="tab-Color">
      <EditorRange id="hue" label="Starting hue" :value="startingHue" :display="`${Math.round(startingHue / 255 * 360)}°`" spectrum @start="history.begin()" @change="update(setStartingHue(hash, $event))" @end="history.commit()" />
      <EditorRange id="spread" label="Color spread" :min="3" :value="traits.hyper ? lastSpread : traits.bytes[28]!" :display="traits.hyper ? 'Hyper' : traits.spread.toFixed(1)" :disabled="traits.hyper" @start="history.begin()" @change="byte(28, $event)" @end="history.commit()" />
      <div class="color-toggles">
        <button class="toggle-button" :class="{ active: traits.reverse }" :aria-pressed="traits.reverse" title="Reverse color direction" @click="update(setByte(hash, 30, traits.reverse ? 128 : 0), true)"><EditorIcon name="reverse" /><span>Reverse</span></button>
        <button class="toggle-button hyper-button" :class="{ active: traits.hyper }" :aria-pressed="traits.hyper" title="Hyper spectrum" @click="toggleHyper"><EditorIcon name="spark" /><span>Hyper</span></button>
      </div>
      </div>
      <div v-show="activeTab === 'Shape'" id="panel-Shape" class="tab-controls shape-controls" role="tabpanel" aria-labelledby="tab-Shape">
        <EditorRange id="length" label="Length" :value="traits.bytes[26]!" :display="traits.segments.toFixed(2)" title="Curve length" @start="history.begin()" @change="byte(26, $event)" @end="history.commit()" />
        <EditorRange id="height" label="Height" :value="255 - traits.bytes[27]!" :display="`${Math.round(400 / traits.ht)}%`" title="Curve height; taller to the right" @start="history.begin()" @change="byte(27, 255 - $event)" @end="history.commit()" />
        <div class="range-control point-control">
          <div class="point-heading"><label for="point-height">Point</label><span class="point-stepper"><button aria-label="Previous point" :disabled="selectedPoint === 0" @click="selectPoint(selectedPoint - 1)">‹</button><output>{{ selectedPoint + 1 }}<span>/{{ pointCount }}</span></output><button aria-label="Next point" :disabled="selectedPoint === pointCount - 1" @click="selectPoint(selectedPoint + 1)">›</button></span></div>
          <input id="point-height" aria-label="Point height" type="range" min="0" max="255" :value="255 - traits.bytes[selectedPoint]!" @pointerdown="history.begin()" @keydown="history.begin()" @input="byte(selectedPoint, 255 - Number(($event.target as HTMLInputElement).value))" @change="history.commit()" @blur="history.commit()">
        </div>
      </div>
      <div v-show="activeTab === 'Texture'" id="panel-Texture" class="tab-controls texture-controls" role="tabpanel" aria-labelledby="tab-Texture">
        <EditorRange id="spacing" label="Spacing" :max="29" :value="Math.min(29, traits.bytes[24]!)" :display="traits.type === 'Ribbed' ? String(Math.floor(3 + 17 * traits.bytes[24]! / 230)) : '—'" :disabled="traits.type !== 'Ribbed'" title="Ribbed spacing" @start="history.begin()" @change="byte(24, $event)" @end="history.commit()" />
        <EditorRange id="rib-color" label="Rib color" :value="traits.bytes[25]!" :display="traits.type === 'Ribbed' ? `${Math.round(traits.bytes[25]! / 255 * 100)}%` : '—'" :disabled="traits.type !== 'Ribbed'" grayscale title="Ribbed grayscale" @start="history.begin()" @change="byte(25, $event)" @end="history.commit()" />
        <button v-if="traits.type !== 'Ribbed'" class="texture-context" @click="chooseType('Ribbed')">Ribbed <EditorIcon name="arrow" /></button>
        <span v-else class="texture-context">Ribbed</span>
      </div>
      <div v-show="activeTab === 'View'" id="panel-View" class="tab-controls view-controls" role="tabpanel" aria-labelledby="tab-View">
        <EditorRange id="speed" label="Speed" :min="0.1" :max="20" :step="0.1" :value="speed" :display="`${speed.toFixed(1)}×`" @change="speed = $event" />
        <EditorRange id="background" label="Background" :max="10" :value="backgroundIndex" :display="backgroundIndex === 0 ? 'White' : backgroundIndex === 10 ? 'Black' : `${Math.round(grayLevels[backgroundIndex]! / 255 * 100)}%`" grayscale @change="background = backgrounds[$event]!" />
        <button class="toggle-button view-play" :aria-pressed="playing" @click="togglePlayback"><EditorIcon :name="playing ? 'pause' : 'play'" />{{ playing ? 'Pause' : 'Play' }}</button>
      </div>
    </section>

    <div class="workspace" :class="{ 'with-code': codeMode }">
      <main class="stage" :style="{ background }">
        <ScriptPreview v-if="customRunning" :key="previewRevision" ref="scriptPreview" :source="previewSource" :hash="previewContext.hash" :view="previewContext.view" @error="codeError = $event" @ready="codeError = ''" />
        <SquiggleCanvas v-else ref="canvas" :hash="hash" :background="background" :playing="playing && !dragging && !drawMode" :speed="speed" :selected-point="selectedPoint" :show-points="activeTab === 'Shape'" :draw-mode="drawMode" @select-point="selectedPoint = $event" @update:hash="update($event)" @gesture-start="startDrag" @gesture-end="history.commit(); dragging = false" @fit="applyDrawing" @close-draw="closeDraw" @notice="announce" />
        <span v-if="customRunning" class="custom-sketch-label">Custom code</span>
        <div class="canvas-tools">
          <div class="play-tools">
            <button class="stage-button" :aria-label="playing ? 'Pause animation' : 'Play animation'" :title="playing ? 'Pause' : 'Play'" :aria-pressed="playing" @click="togglePlayback"><EditorIcon :name="playing ? 'pause' : 'play'" /></button>
            <button class="stage-button" aria-label="Reset squiggle" title="Reset squiggle" @click="reset"><EditorIcon name="reset" /></button>
            <button ref="drawToggle" class="stage-button draw-toggle" aria-label="Draw mode" :title="customRunning ? 'Reset original code to draw' : drawMode ? 'Finish drawing' : 'Draw a squiggle'" :aria-pressed="drawMode" :disabled="customRunning" @click="toggleDraw"><EditorIcon name="draw" /><span>Draw</span></button>
            <button class="stage-button code-toggle" aria-label="Code mode" :title="codeMode ? 'Hide code' : 'Show code'" :aria-pressed="codeMode" aria-controls="live-code" @click="codeMode = !codeMode"><EditorIcon name="code" /><span>Code</span></button>
          </div>
          <div class="backgrounds" aria-label="Canvas background">
            <button v-for="(bg, index) in swatches" :key="bg" :aria-label="`${['White', 'Gray', 'Dark'][index]} background`" :aria-pressed="background === bg" :title="`${['White', 'Gray', 'Dark'][index]} background`" :class="{ chosen: background === bg }" @click="background = bg"><span :style="{ background: bg }" /></button>
          </div>
        </div>
      </main>
      <CodePanel v-if="codeMode" id="live-code" ref="codePanel" :lines="codeLines" :highlighted-line-ids="highlightedLineIds" :highlight-revision="highlightRevision" :modified="codeModified" :pending="codePending" :error="codeError" @edit="editCode" @run="runCode" @reset="resetCode" />
    </div>

    <div class="toast" role="status" aria-live="polite" :class="{ visible: notice }">{{ notice }}</div>
  </div>
</template>
