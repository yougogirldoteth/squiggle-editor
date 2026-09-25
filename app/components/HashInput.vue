<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string
  hash: string
  invalid?: boolean
  describedBy?: string
}>(), { invalid: false })

const emit = defineEmits<{
  'update:modelValue': [value: string]
  load: []
}>()

interface Character {
  value: string
  previous: string
  version: number
  rolling: boolean
}

const focused = ref(false)
const ready = ref(false)
const reducedMotion = ref(false)
const characters = shallowRef<Character[]>(stationaryCharacters(props.hash))
const showOverlay = computed(() => ready.value && !focused.value && !reducedMotion.value && !props.invalid && props.modelValue === props.hash)

let initialFrame: number | undefined
let motionQuery: MediaQueryList | undefined

function stationaryCharacters(hash: string): Character[] {
  return Array.from(hash, value => ({ value, previous: value, version: 0, rolling: false }))
}

function stopRolling() {
  characters.value = stationaryCharacters(props.hash)
}

watch(() => props.hash, (hash, previousHash) => {
  if (!showOverlay.value || hash.length !== previousHash.length) {
    stopRolling()
    return
  }
  characters.value = Array.from(hash, (value, index) => {
    const previous = characters.value[index]
    if (previous?.value === value) return previous
    return {
      value,
      previous: previousHash[index] ?? value,
      version: (previous?.version ?? 0) + 1,
      rolling: true,
    }
  })
})

watch([() => props.modelValue, () => props.invalid], () => {
  if (!showOverlay.value) stopRolling()
})

function onFocus() {
  focused.value = true
  stopRolling()
}

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.isComposing) return
  event.preventDefault()
  emit('load')
}

function onMotionPreference(event: MediaQueryListEvent) {
  reducedMotion.value = event.matches
  stopRolling()
}

onMounted(() => {
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotion.value = motionQuery.matches
  motionQuery.addEventListener('change', onMotionPreference)
  // The parent may load a URL hash in its mounted hook. Let that initial
  // hydration settle before enabling animations of subsequent edits.
  initialFrame = requestAnimationFrame(() => {
    initialFrame = requestAnimationFrame(() => {
      initialFrame = undefined
      stopRolling()
      ready.value = true
    })
  })
})

onBeforeUnmount(() => {
  if (initialFrame !== undefined) cancelAnimationFrame(initialFrame)
  motionQuery?.removeEventListener('change', onMotionPreference)
})
</script>

<template>
  <div class="hash-input">
    <textarea
      id="hash"
      class="hash-input__native"
      :class="{ 'is-masked': showOverlay }"
      :value="modelValue"
      rows="2"
      wrap="soft"
      aria-label="Hash"
      :aria-invalid="invalid"
      :aria-describedby="describedBy"
      spellcheck="false"
      autocomplete="off"
      autocapitalize="off"
      autocorrect="off"
      @input="onInput"
      @keydown="onKeydown"
      @focus="onFocus"
      @blur="focused = false"
    />
    <div v-if="showOverlay" class="hash-input__overlay" aria-hidden="true">
      <span v-for="(character, index) in characters" :key="`${index}:${character.version}`" class="hash-input__slot" :class="{ 'is-rolling': character.rolling }">
        <span v-if="character.rolling" class="hash-input__previous">{{ character.previous }}</span>
        <span class="hash-input__current">{{ character.value }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.hash-input {
  position: relative;
  width: 100%;
  min-width: 0;
  height: var(--hash-height, 42px);
}

#hash.hash-input__native,
.hash-input__overlay {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: var(--hash-padding, 10px 12px);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: var(--hash-font-size, 14px);
  font-weight: 400;
  line-height: var(--hash-line-height, 20px);
  letter-spacing: 0;
  font-variant-ligatures: none;
  font-kerning: none;
  text-align: left;
  text-indent: 0;
  color: var(--hash-color, #384630);
}

#hash.hash-input__native {
  display: block;
  margin: 0;
  resize: none;
  appearance: none;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background: transparent;
  white-space: pre-wrap;
  word-break: break-all;
  overflow-wrap: anywhere;
}

#hash.hash-input__native.is-masked {
  color: transparent;
}

#hash.hash-input__native:focus {
  color: var(--hash-color, #384630);
  outline: none;
}

.hash-input__overlay {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border: 0;
  pointer-events: none;
  user-select: none;
  white-space: normal;
  word-break: normal;
}

.hash-input:focus-within .hash-input__overlay {
  visibility: hidden;
}

.hash-input__slot {
  display: inline-block;
  position: relative;
  overflow: hidden;
  width: 1ch;
  height: 1lh;
  vertical-align: top;
}

.hash-input__previous,
.hash-input__current {
  display: block;
}

.hash-input__previous {
  position: absolute;
  inset: 0;
}

.is-rolling .hash-input__previous {
  animation: hash-roll-out 210ms cubic-bezier(.2, .7, .2, 1) both;
}

.is-rolling .hash-input__current {
  animation: hash-roll-in 210ms cubic-bezier(.2, .7, .2, 1) both;
}

@keyframes hash-roll-out {
  from { transform: translateY(0); opacity: .55; }
  to { transform: translateY(-.3em); opacity: 0; }
}

@keyframes hash-roll-in {
  from { transform: translateY(.3em); opacity: .7; }
  to { transform: translateY(0); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  #hash.hash-input__native.is-masked { color: var(--hash-color, #384630); }
  .hash-input__overlay { display: none; }
  .is-rolling .hash-input__previous,
  .is-rolling .hash-input__current { animation: none; }
}
</style>
