<script setup lang="ts">
import { DEFAULT_HASH, TYPES, decodeHash, parseHash, toHash, setByte, setType, randomHash } from '~/utils/squiggle'
import type { SquiggleType } from '~/utils/squiggle'
import { HashHistory } from '~/utils/history'

const history = reactive(new HashHistory(DEFAULT_HASH))
const hash = ref(DEFAULT_HASH)
const traits = computed(() => decodeHash(hash.value))
const canvas = ref<{ exportPng: () => void; resetPhase: () => void } | null>(null)
const hashDraft = ref(DEFAULT_HASH)
const hashError = ref('')
const playing = ref(false)
const dragging = ref(false)
const background = ref('#ffffff')
const backgrounds = ['#ffffff', '#e7e7e2', '#20221f']
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
function byte(index: number, event: Event) { update(setByte(hash.value, index, Number((event.target as HTMLInputElement).value))) }
function chooseType(type: SquiggleType) { update(setType(hash.value, type), true) }
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
  return url
}
function share() {
  playing.value = false
  canvas.value?.resetPhase()
  copy(stateUrl().href, 'Link copied')
}
function shortcut(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  if (target instanceof HTMLInputElement && target.type !== 'range') return
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    event.shiftKey ? redo() : undo()
  }
}
watch([hash, background], () => {
  if (!import.meta.client) return
  clearTimeout(urlTimer)
  urlTimer = setTimeout(() => window.history.replaceState(null, '', stateUrl()), 150)
})
onMounted(() => {
  const params = new URLSearchParams(window.location.search)
  const input = params.get('hash')
  if (input) {
    try { initialHash = toHash(parseHash(input)); history.value = initialHash; sync(initialHash) }
    catch { announce('Invalid URL hash. Loaded a fresh canvas.') }
  }
  const bg = `#${params.get('bg')}`
  if (backgrounds.includes(bg)) background.value = bg
  window.addEventListener('keydown', shortcut)
})
onBeforeUnmount(() => {
  clearTimeout(noticeTimer); clearTimeout(urlTimer)
  window.removeEventListener('keydown', shortcut)
})
</script>

<template>
  <div class="editor">
    <header class="masthead">
      <div class="brand"><img src="/favicon.svg" alt="" width="34" height="34"><h1>Squiggle <span>Editor</span></h1></div>
      <div class="header-actions">
        <div class="history-actions">
          <button class="icon-button" aria-label="Undo" title="Undo (⌘/Ctrl Z)" :disabled="!history.canUndo" @click="undo"><EditorIcon name="undo" /></button>
          <button class="icon-button" aria-label="Redo" title="Redo (⌘/Ctrl Shift Z)" :disabled="!history.canRedo" @click="redo"><EditorIcon name="redo" /></button>
        </div>
        <button class="new-button" title="Randomize squiggle" @click="randomize"><EditorIcon name="shuffle" /><span>New squiggle</span></button>
        <button class="export-button" aria-label="Export PNG" title="Export PNG" @click="canvas?.exportPng()"><EditorIcon name="download" /><span>Export</span></button>
      </div>
    </header>

    <aside class="types" aria-label="Squiggle type">
      <p class="eyebrow type-heading">TYPE</p>
      <div class="type-list">
        <button v-for="type in TYPES" :key="type" class="type-button" :class="{ selected: traits.type === type }" :aria-pressed="traits.type === type" @click="chooseType(type)">
          <TypePreview :type="type" /><span>{{ type }}</span><span class="selected-dot" aria-hidden="true" />
        </button>
      </div>
      <div class="type-bottom"><span class="mini-dot" /><span>Made of color.</span></div>
    </aside>

    <section class="color-controls" aria-label="Color controls">
      <div class="range-control hue-control">
        <label for="hue">Starting hue <output for="hue">{{ Math.round(traits.startColor / 255 * 360) }}°</output></label>
        <input id="hue" class="spectrum" aria-label="Starting hue" type="range" min="0" max="255" step="1" :value="traits.startColor" @pointerdown="history.begin()" @keydown="history.begin()" @input="byte(29, $event)" @change="history.commit()" @blur="history.commit()">
      </div>
      <div class="range-control spread-control">
        <label for="spread">Color spread <output for="spread">{{ traits.hyper ? 'Hyper' : traits.spread.toFixed(1) }}</output></label>
        <input id="spread" aria-label="Color spread" type="range" min="3" max="255" step="1" :value="traits.hyper ? lastSpread : traits.bytes[28]" :disabled="traits.hyper" @pointerdown="history.begin()" @keydown="history.begin()" @input="byte(28, $event)" @change="history.commit()" @blur="history.commit()">
      </div>
      <div class="color-toggles">
        <button class="toggle-button" :class="{ active: traits.reverse }" :aria-pressed="traits.reverse" title="Reverse color direction" @click="update(setByte(hash, 30, traits.reverse ? 128 : 0), true)"><EditorIcon name="reverse" /><span>Reverse</span></button>
        <button class="toggle-button hyper-button" :class="{ active: traits.hyper }" :aria-pressed="traits.hyper" title="Hyper spectrum" @click="toggleHyper"><EditorIcon name="spark" /><span>Hyper</span></button>
      </div>
    </section>

    <main class="stage" :style="{ background }">
      <div class="stage-label" :class="{ 'on-dark': background === '#20221f' }"><span class="mini-dot" />{{ traits.type }}<span v-if="traits.hyper"> / Hyper</span></div>
      <SquiggleCanvas ref="canvas" :hash="hash" :background="background" :playing="playing && !dragging" @update:hash="update($event)" @gesture-start="history.begin(); dragging = true" @gesture-end="history.commit(); dragging = false" />
      <div class="canvas-tools">
        <div class="play-tools">
          <button class="stage-button" :aria-label="playing ? 'Pause animation' : 'Play animation'" :title="playing ? 'Pause' : 'Play'" :aria-pressed="playing" @click="playing = !playing"><EditorIcon :name="playing ? 'pause' : 'play'" /></button>
          <button class="stage-button" aria-label="Reset squiggle" title="Reset squiggle" @click="reset"><EditorIcon name="reset" /></button>
        </div>
        <div class="backgrounds" aria-label="Canvas background">
          <button v-for="(bg, index) in backgrounds" :key="bg" :aria-label="`${['White', 'Gray', 'Dark'][index]} background`" :aria-pressed="background === bg" :title="`${['White', 'Gray', 'Dark'][index]} background`" :class="{ chosen: background === bg }" @click="background = bg"><span :style="{ background: bg }" /></button>
        </div>
      </div>
    </main>

    <footer class="hash-bar">
      <div class="hash-field">
        <label for="hash">HASH <span v-if="hashError" class="hash-error" role="alert">{{ hashError }}</span></label>
        <div class="hash-input-row">
          <input id="hash" v-model="hashDraft" aria-label="Artwork hash" :aria-invalid="!!hashError" spellcheck="false" autocapitalize="off" autocomplete="off" @keydown.enter="importHash" @input="hashError = ''">
          <button v-if="hashDraft !== hash" class="load-button" title="Load hash" @click="importHash">Load<EditorIcon name="arrow" /></button>
          <button class="icon-button" aria-label="Copy hash" title="Copy hash" @click="copy(hash, 'Hash copied')"><EditorIcon name="copy" /></button>
        </div>
      </div>
      <button class="share-button" title="Copy a link to this squiggle" @click="share"><EditorIcon name="link" /><span>Share</span></button>
      <div class="attribution">Chromie Squiggle by <a href="https://www.snowfro.com/projects/chromie-squiggle" target="_blank" rel="noopener noreferrer">Snowfro ↗</a><span>Independent editor</span></div>
    </footer>
    <div class="toast" role="status" aria-live="polite" :class="{ visible: notice }">{{ notice }}</div>
  </div>
</template>
