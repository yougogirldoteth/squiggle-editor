<script setup lang="ts">
import { parseHash, toHash } from '~/utils/squiggle'

const props = defineProps<{ hash: string; editRevision: number }>()
const draft = defineModel<string>({ default: '' })
const emit = defineEmits<{ apply: [hash: string]; close: [] }>()
const field = ref<HTMLTextAreaElement>()
const action = ref<HTMLButtonElement>()
const busy = ref(false)
const error = ref(false)
const message = ref('Fits the original Squiggle algorithm.')
const lastPrompt = ref('')
const actionLabel = computed(() => busy.value ? 'Cancel' : lastPrompt.value && draft.value.trim() === lastPrompt.value ? 'Try again' : 'Generate')
let active: AbortController | undefined

function cancel(text = 'Cancelled. Your squiggle is unchanged.') {
  active?.abort()
  active = undefined
  busy.value = false
  error.value = false
  message.value = text
}

async function generate() {
  const prompt = draft.value.trim()
  if (busy.value || !prompt || draft.value.length > 600) return
  if (/^(?:this\s+is\s+pointless|keep\s+going)[.!?]*$/i.test(prompt)) {
    error.value = false
    lastPrompt.value = prompt
    message.value = 'Keep going.'
    action.value?.focus({ preventScroll: true })
    emit('apply', '0xb8e6ffe6ffe6ffe6ffe6ffe6ffe6ffbcff88ff000062200f1e65ff00ff390023')
    return
  }
  const baseHash = props.hash
  const controller = new AbortController()
  active = controller
  busy.value = true
  error.value = false
  message.value = 'Interpreting your prompt…'
  const timeout = setTimeout(() => controller.abort(), 25000)
  try {
    const response = await fetch('/api/prompt', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, hash: baseHash }), signal: controller.signal,
    })
    const result = await response.json()
    if (!response.ok) {
      const detail = result?.statusMessage
      throw new Error(typeof detail === 'string' && detail.length <= 180 ? detail : 'Prompt mode is unavailable right now. Try again.')
    }
    if (typeof result?.hash !== 'string' || typeof result?.colorLimited !== 'boolean') throw new Error('The prompt returned an invalid result. Try again.')
    const nextHash = toHash(parseHash(result.hash))
    // A late response must never overwrite an edit or a newer request.
    if (active !== controller || props.hash !== baseHash) return
    active = undefined
    busy.value = false
    lastPrompt.value = prompt
    action.value?.focus({ preventScroll: true })
    message.value = nextHash === baseHash ? 'No different fit found. Try another shape or style.'
      : result.colorLimited ? 'Closest palette the original script allows. Keep refining or edit the controls.'
        : 'Keep refining, or adjust it with the controls.'
    emit('apply', nextHash)
  } catch (cause) {
    if (active !== controller) return
    error.value = true
    message.value = controller.signal.aborted ? 'That prompt took too long. Try again.'
      : cause instanceof Error ? cause.message : 'The prompt could not be completed. Try again.'
  } finally {
    clearTimeout(timeout)
    if (active === controller) { active = undefined; busy.value = false }
  }
}

function keydown(event: KeyboardEvent) {
  if (event.isComposing) return
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopPropagation()
    if (busy.value) cancel()
    else emit('close')
  } else if (event.target === field.value && event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    generate()
  }
}

watch(() => props.hash, () => { if (active) cancel('Artwork changed. Generate again to use the current squiggle.') }, { flush: 'sync' })
watch(() => props.editRevision, () => { if (active) cancel('Editing started. Generate again when you’re ready.') }, { flush: 'sync' })
onMounted(() => field.value?.focus({ preventScroll: true }))
onBeforeUnmount(() => { active?.abort(); active = undefined })
</script>

<template>
  <form class="prompt-panel" aria-label="Prompt mode" @submit.prevent="generate" @keydown="keydown">
    <div class="prompt-input-row">
      <label class="sr-only" for="squiggle-prompt">Describe your squiggle</label>
      <textarea id="squiggle-prompt" ref="field" v-model="draft" rows="2" maxlength="600" :readonly="busy" aria-describedby="prompt-status" placeholder="Describe a shape, color, or texture…" enterkeyhint="send" spellcheck="false" />
      <button ref="action" class="prompt-submit" :class="{ 'is-busy': busy }" type="button" :aria-label="actionLabel" :title="actionLabel" :disabled="!busy && (!draft.trim() || draft.length > 600)" @click="busy ? cancel() : generate()">
        <span v-if="busy" class="prompt-stop" aria-hidden="true" />
        <EditorIcon v-else name="arrow" class="prompt-send" />
      </button>
    </div>
    <p id="prompt-status" class="prompt-status" :class="{ error }" role="status" aria-live="polite">{{ message }}</p>
  </form>
</template>

<style scoped>
.prompt-panel { grid-column: 1 / -1; min-width: 0; }
.prompt-input-row { display: grid; grid-template-columns: minmax(0, 1fr) 44px; align-items: center; gap: var(--space-3); padding: var(--space-3); border: 1px solid var(--line); border-radius: 12px; background: #fff; }
textarea { display: block; width: 100%; min-width: 0; height: 44px; padding: 2px 0; resize: none; border: 0; border-radius: 0; background: transparent; color: #30352e; font-size: 14px; line-height: 20px; caret-color: var(--accent); }
textarea:focus-visible { outline: none; }
textarea::placeholder { color: #8b9384; }
.prompt-submit { position: relative; display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 1px solid var(--line); border-radius: 10px; background: #f3f5ef; color: #536b40; opacity: 1; appearance: none; -webkit-appearance: none; }
/* Touch browsers retain hover after a tap; keep the resting surface consistent. */
.prompt-submit:hover:not(:disabled) { background: #f3f5ef; }
.prompt-submit:disabled { color: #a4ac9b; opacity: 1; }
.prompt-submit:active:not(:disabled) { background: #e7eddc; border-color: #c5d2b8; }
.prompt-submit:focus-visible { outline: none; border-color: #829d65; box-shadow: inset 0 0 0 1px #829d65; }
.prompt-submit svg { width: 19px; height: 19px; }
.prompt-send { transform: rotate(-90deg); }
.prompt-stop { width: 9px; height: 9px; border-radius: 2px; background: currentColor; }
.prompt-submit.is-busy::after { content: ''; position: absolute; inset: 7px; border: 1px solid #d5ddce; border-top-color: currentColor; border-radius: 50%; animation: prompt-spin 1s linear infinite; }
.prompt-status { margin: var(--space-2) var(--space-3) 0; min-height: 14px; color: #818b76; font-size: 11px; line-height: 14px; overflow-wrap: anywhere; }
.prompt-status.error { color: #a34e3b; }
@keyframes prompt-spin { to { transform: rotate(360deg); } }
@media (hover: hover) and (pointer: fine) {
  .prompt-submit:hover:not(:disabled) { background: #e7eddc; border-color: #c5d2b8; }
}
@media (max-width: 650px) {
  .prompt-input-row { gap: var(--space-2); }
  textarea { font-size: 16px; }
}
@media (max-height: 450px) {
  .prompt-input-row { grid-template-columns: minmax(0, 1fr) 40px; padding: var(--space-2) var(--space-3); }
  textarea { height: 40px; }
  .prompt-submit { width: 40px; height: 40px; }
  .prompt-status { margin-top: var(--space-1); min-height: 14px; }
}
@media (prefers-reduced-motion: reduce) {
  .prompt-submit { transition: none; }
  .prompt-submit.is-busy::after { animation: none; }
}
</style>
