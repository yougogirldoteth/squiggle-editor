<script setup lang="ts">
import EditorRange from '~/components/EditorRange.vue'
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
const grayLevels = [255, 225, 200, 175, 150, 125, 100, 75, 50, 25, 0]
const backgrounds = grayLevels.map(gray => `#${gray.toString(16).padStart(2, '0').repeat(3)}`)
const backgroundIndex = computed(() => backgrounds.indexOf(background.value))
const swatches = [backgrounds[0]!, backgrounds[4]!, backgrounds[10]!]
const speed = ref(1)
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
watch([hash, background, speed], () => {
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
  const urlSpeed = Number(params.get('speed'))
  if (urlSpeed >= 0.1 && urlSpeed <= 20) speed.value = Math.round(urlSpeed * 10) / 10
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

    <section class="controls-area" aria-label="Editor controls">
      <div class="control-tabs" role="tablist" aria-label="Parameters">
        <button v-for="(tab, index) in tabs" :id="`tab-${tab}`" :key="tab" role="tab" :aria-selected="activeTab === tab" :aria-controls="`panel-${tab}`" :tabindex="activeTab === tab ? 0 : -1" @click="selectTab(tab)" @keydown="tabKey($event, index)">{{ tab }}</button>
      </div>
      <div v-show="activeTab === 'Color'" id="panel-Color" class="tab-controls color-controls" role="tabpanel" aria-labelledby="tab-Color">
      <EditorRange id="hue" label="Starting hue" :value="traits.startColor" :display="`${Math.round(traits.startColor / 255 * 360)}°`" spectrum @start="history.begin()" @change="byte(29, $event)" @end="history.commit()" />
      <EditorRange id="spread" label="Color spread" :min="3" :value="traits.hyper ? lastSpread : traits.bytes[28]!" :display="traits.hyper ? 'Hyper' : traits.spread.toFixed(1)" :disabled="traits.hyper" @start="history.begin()" @change="byte(28, $event)" @end="history.commit()" />
      <div class="color-toggles">
        <button class="toggle-button" :class="{ active: traits.reverse }" :aria-pressed="traits.reverse" title="Reverse color direction" @click="update(setByte(hash, 30, traits.reverse ? 128 : 0), true)"><EditorIcon name="reverse" /><span>Reverse</span></button>
        <button class="toggle-button hyper-button" :class="{ active: traits.hyper }" :aria-pressed="traits.hyper" title="Hyper spectrum" @click="toggleHyper"><EditorIcon name="spark" /><span>Hyper</span></button>
      </div>
      </div>
      <div v-show="activeTab === 'Shape'" id="panel-Shape" class="tab-controls shape-controls" role="tabpanel" aria-labelledby="tab-Shape">
        <EditorRange id="length" label="Length" :value="traits.bytes[26]!" :display="traits.segments.toFixed(2)" title="Original segment count, with full byte precision" @start="history.begin()" @change="byte(26, $event)" @end="history.commit()" />
        <EditorRange id="height" label="Height" :value="255 - traits.bytes[27]!" :display="`${Math.round(400 / traits.ht)}%`" title="Curve height; taller to the right" @start="history.begin()" @change="byte(27, 255 - $event)" @end="history.commit()" />
        <div class="range-control point-control">
          <div class="point-heading"><label for="point-height">Point</label><span class="point-stepper"><button aria-label="Previous point" :disabled="selectedPoint === 0" @click="selectedPoint--">‹</button><output>{{ selectedPoint + 1 }}<span>/{{ pointCount }}</span></output><button aria-label="Next point" :disabled="selectedPoint === pointCount - 1" @click="selectedPoint++">›</button></span></div>
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
        <button class="toggle-button view-play" :aria-pressed="playing" @click="playing = !playing"><EditorIcon :name="playing ? 'pause' : 'play'" />{{ playing ? 'Pause' : 'Play' }}</button>
      </div>
    </section>

    <main class="stage" :style="{ background }">
      <div class="stage-label" :class="{ 'on-dark': backgroundIndex > 5 }"><span class="mini-dot" />{{ traits.type }}<span v-if="traits.hyper"> / Hyper</span></div>
      <SquiggleCanvas ref="canvas" :hash="hash" :background="background" :playing="playing && !dragging" :speed="speed" :selected-point="selectedPoint" :show-points="activeTab === 'Shape'" @select-point="selectedPoint = $event" @update:hash="update($event)" @gesture-start="history.begin(); dragging = true" @gesture-end="history.commit(); dragging = false" />
      <div class="canvas-tools">
        <div class="play-tools">
          <button class="stage-button" :aria-label="playing ? 'Pause animation' : 'Play animation'" :title="playing ? 'Pause' : 'Play'" :aria-pressed="playing" @click="playing = !playing"><EditorIcon :name="playing ? 'pause' : 'play'" /></button>
          <button class="stage-button" aria-label="Reset squiggle" title="Reset squiggle" @click="reset"><EditorIcon name="reset" /></button>
        </div>
        <div class="backgrounds" aria-label="Canvas background">
          <button v-for="(bg, index) in swatches" :key="bg" :aria-label="`${['White', 'Gray', 'Dark'][index]} background`" :aria-pressed="background === bg" :title="`${['White', 'Gray', 'Dark'][index]} background`" :class="{ chosen: background === bg }" @click="background = bg"><span :style="{ background: bg }" /></button>
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
