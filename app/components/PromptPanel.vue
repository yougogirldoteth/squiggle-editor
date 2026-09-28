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
    message.value = nextHash === baseHash ? 'Already matches. Try a more specific prompt.'
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
      <textarea id="squiggle-prompt" ref="field" v-model="draft" rows="2" maxlength="600" :readonly="busy" aria-describedby="prompt-status" placeholder="Two tall loops, a scribbly ending, only blue…" spellcheck="false" />
      <button ref="action" class="prompt-submit" :class="{ cancel: busy }" type="button" :disabled="!busy && (!draft.trim() || draft.length > 600)" @click="busy ? cancel() : generate()"><span>{{ busy ? 'Cancel' : lastPrompt && draft.trim() === lastPrompt ? 'Try again' : 'Generate' }}</span><EditorIcon v-if="!busy" name="arrow" /></button>
    </div>
    <p id="prompt-status" class="prompt-status" :class="{ error }" role="status" aria-live="polite">{{ message }}</p>
  </form>
</template>

<style scoped>
.prompt-panel { grid-column: 1 / -1; min-width: 0; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; background: #fff; }
.prompt-input-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; }
textarea { display: block; width: 100%; min-width: 0; height: 44px; padding: 2px 0; resize: none; border: 0; background: transparent; color: #30352e; font-size: 14px; line-height: 20px; caret-color: var(--accent); }
textarea:focus-visible { outline: none; }
textarea::placeholder { color: #8b9384; }
textarea[readonly] { color: #7b8572; }
.prompt-submit { display: flex; align-items: center; justify-content: center; gap: 8px; height: 36px; min-width: 106px; padding: 0 12px; border-radius: 8px; background: #36432d; color: #fff; font-size: 12px; }
.prompt-submit:hover:not(:disabled) { background: #536b40; }
.prompt-submit svg { width: 15px; height: 15px; }
.prompt-submit.cancel { background: #edf0e7; color: #526047; }
.prompt-status { margin: 6px 0 0; min-height: 14px; color: #818b76; font-size: 11px; line-height: 14px; }
.prompt-status.error { color: #a34e3b; }
@media (max-width: 650px) {
  .prompt-panel { padding: 10px 12px; }
  .prompt-input-row { gap: 8px; }
  textarea { font-size: 16px; }
  .prompt-submit { min-width: 80px; padding: 0 10px; }
  .prompt-submit svg { display: none; }
}
@media (max-height: 450px) {
  .prompt-panel { padding: 8px 12px; }
  textarea { height: 28px; }
  .prompt-submit { height: 32px; }
  .prompt-status { margin-top: 4px; }
}
</style>
