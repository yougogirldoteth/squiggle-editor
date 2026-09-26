<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { managedPreviewInputs } from '../utils/previewContext'
import { sanitizePngExport } from '../utils/pngExport'

const props = withDefaults(defineProps<{
  source: string
  hash: string
  view: { background: string; speed: number; playing: boolean }
  runId?: number
}>(), { runId: 0 })
const emit = defineEmits<{ error: [message: string]; ready: [] }>()
const host = ref<HTMLDivElement>()
const frame = ref<HTMLIFrameElement>()
const documentSource = ref('')
const instance = ref('')
const errorMessage = ref('')
let mounted = false
let previewReady = false
let loadingTimer: ReturnType<typeof setTimeout> | undefined
let resizeTimer: ReturnType<typeof setTimeout> | undefined
let resizeObserver: ResizeObserver | undefined
let renderedWidth = 0
let renderedHeight = 0
let requestCount = 0
const exports = new Map<number, { resolve: (blob: Blob) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; processing: boolean }>()

function scriptString(value: string) {
  // Prevent an edited closing script tag from terminating the srcdoc bootstrap.
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

function previewDocument(source: string, token: string) {
  const library = new URL('/vendor/p5-1.0.0.min.js', window.location.href).href
  const csp = `default-src 'none'; script-src 'unsafe-inline' ${library}; connect-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'`
  const managedInputs = managedPreviewInputs(source)
  return `<!doctype html><html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}canvas{display:block;position:absolute;inset:0;margin:auto}</style>
</head><body>
<script>
(function () {
  const token = ${scriptString(token)};
  // p5 1.0.0 registers unused motion sensors at startup. Keep this
  // sketch sandbox sensor-free without permission-policy console noise.
  const addListener = window.addEventListener;
  window.addEventListener = function (type, listener, options) {
    if (type === 'devicemotion' || type === 'deviceorientation' || type === 'deviceorientationabsolute') return;
    return addListener.call(this, type, listener, options);
  };
  const send = (type, extra = {}) => parent.postMessage({channel:'squiggle-preview',token,type,...extra}, '*');
  let failed = false;
  const report = message => {
    if (failed) return;
    failed = true;
    send('error', {message:String(message).slice(0,2000)});
  };
  window.addEventListener('error', event => {
    event.preventDefault();
    report(event.message || 'The sketch could not load.');
  }, true);
  window.addEventListener('unhandledrejection', event => {
    event.preventDefault();
    report(event.reason && event.reason.message || event.reason || 'Unhandled sketch error.');
  });
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== parent || !data || data.channel !== 'squiggle-preview' || data.token !== token || data.type !== 'export') return;
    try {
      const canvas = document.querySelector('canvas');
      if (!canvas) throw new Error('Run a sketch that creates a canvas before exporting.');
      send('export', {requestId:data.requestId,png:canvas.toDataURL('image/png')});
    } catch (error) {
      send('export-error', {requestId:data.requestId,message:error.message || String(error)});
    }
  });
  window.addEventListener('load', () => {
    window.setTimeout(() => {
      if (failed) return;
      if (document.querySelector('canvas')) send('ready');
      else report('The sketch did not create a canvas.');
    }, 0);
  });
})();
<\/script>
<script src="${library}"><\/script>
<script>
window.tokenData = { hashes: [${scriptString(props.hash)}] };
(function () {
  const sketch = document.createElement('script');
  sketch.textContent = ${scriptString(source)};
  document.head.appendChild(sketch);
})();
<\/script>
<script>
(function () {
  // These are host controls, separate from the exact editable script above.
  // Custom declarations and writes own their inputs. Canonical p5 handlers
  // may still change values at runtime; explicit host controls remain usable.
  const token = ${scriptString(token)};
  const manageSpeed = ${managedInputs.speed} && typeof speed === 'number' && speed === 1;
  const managePlaying = ${managedInputs.playing} && typeof loops === 'boolean' && loops === false;
  const manageBackground = ${managedInputs.background} && typeof backgroundIndex === 'number' && backgroundIndex === 0 && typeof backgroundArray !== 'undefined' && JSON.stringify(backgroundArray) === '[255,225,200,175,150,125,100,75,50,25,0,25,50,75,100,125,150,175,200,225]';
  let previousView;
  const applyView = view => {
    if (!view || typeof view.background !== 'string' || !Number.isFinite(view.speed) || typeof view.playing !== 'boolean') return;
    if (manageSpeed && (!previousView || view.speed !== previousView.speed)) speed = view.speed;
    if (managePlaying && (!previousView || view.playing !== previousView.playing)) loops = view.playing;
    if (manageBackground && (!previousView || view.background !== previousView.background)) {
      backgroundArray[0] = view.background;
      backgroundIndex = 0;
      // This pinned p5 release predates isLooping(); noLoop() sets _loop.
      const stopped = typeof isLooping === 'function' ? !isLooping() : typeof p5 !== 'undefined' && p5.instance && p5.instance._loop === false;
      if (stopped && typeof redraw === 'function') redraw();
    }
    previousView = view;
  };
  applyView(${JSON.stringify(props.view).replace(/</g, '\\u003c')});
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== parent || !data || data.channel !== 'squiggle-preview' || data.token !== token || data.type !== 'view') return;
    applyView(data.view);
  });
})();
<\/script>
</body></html>`
}

function clearPending(reason: string) {
  if (loadingTimer) clearTimeout(loadingTimer)
  loadingTimer = undefined
  for (const request of exports.values()) {
    clearTimeout(request.timer)
    request.reject(new Error(reason))
  }
  exports.clear()
}

function fail(message: string) {
  if (loadingTimer) clearTimeout(loadingTimer)
  loadingTimer = undefined
  errorMessage.value = message
  emit('error', message)
}

function run() {
  if (!mounted) return
  if (resizeTimer) clearTimeout(resizeTimer)
  resizeTimer = undefined
  renderedWidth = host.value?.clientWidth ?? 0
  renderedHeight = host.value?.clientHeight ?? 0
  clearPending('The sketch was restarted before export completed.')
  previewReady = false
  errorMessage.value = ''
  instance.value = crypto.randomUUID()
  documentSource.value = previewDocument(props.source, instance.value)
  loadingTimer = setTimeout(() => fail('The sketch did not finish loading.'), 15000)
}

function onResize() {
  const width = host.value?.clientWidth ?? 0
  const height = host.value?.clientHeight ?? 0
  if (resizeTimer) clearTimeout(resizeTimer)
  resizeTimer = undefined
  if (!width || !height || (width === renderedWidth && height === renderedHeight)) return
  // The original has no resize handler. Rerun its unchanged source once the
  // layout settles; recording dimensions in run() skips the initial callback.
  resizeTimer = setTimeout(run, 150)
}

async function onMessage(event: MessageEvent) {
  if (event.source !== frame.value?.contentWindow) return
  const data = event.data
  if (!data || typeof data !== 'object' || data.channel !== 'squiggle-preview' || data.token !== instance.value) return
  if (data.type === 'error' && typeof data.message === 'string') fail(data.message.slice(0, 2000))
  else if (data.type === 'ready') {
    if (loadingTimer) clearTimeout(loadingTimer)
    loadingTimer = undefined
    previewReady = true
    updateView()
    emit('ready')
  } else if ((data.type === 'export' || data.type === 'export-error') && Number.isSafeInteger(data.requestId)) {
    const request = exports.get(data.requestId)
    if (!request || request.processing) return
    if (data.type === 'export-error') {
      exports.delete(data.requestId)
      clearTimeout(request.timer)
      request.reject(new Error(typeof data.message === 'string' ? data.message.slice(0, 2000) : 'PNG export failed.'))
      return
    }
    request.processing = true
    const token = instance.value
    const isCurrent = () => exports.get(data.requestId) === request && instance.value === token && frame.value?.contentWindow === event.source
    try {
      const blob = await sanitizePngExport(data.png)
      if (!isCurrent()) return
      exports.delete(data.requestId)
      clearTimeout(request.timer)
      request.resolve(blob)
    } catch (error) {
      if (!isCurrent()) return
      exports.delete(data.requestId)
      clearTimeout(request.timer)
      request.reject(error instanceof Error ? error : new Error('PNG export failed.'))
    }
  }
}

function updateView() {
  if (!previewReady) return
  frame.value?.contentWindow?.postMessage({
    channel: 'squiggle-preview', token: instance.value, type: 'view',
    view: { background: props.view.background, speed: props.view.speed, playing: props.view.playing },
  }, '*')
}

function exportPng(): Promise<Blob> {
  const target = frame.value?.contentWindow
  if (!target || !instance.value) return Promise.reject(new Error('Run a sketch before exporting.'))
  if (exports.size) return Promise.reject(new Error('A PNG export is already in progress.'))
  const requestId = ++requestCount
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      exports.delete(requestId)
      reject(new Error('The sketch did not respond to the PNG request.'))
    }, 10000)
    exports.set(requestId, { resolve, reject, timer, processing: false })
    target.postMessage({ channel: 'squiggle-preview', token: instance.value, type: 'export', requestId }, '*')
  })
}

watch(() => [props.source, props.hash, props.runId], run)
watch(() => [props.view.background, props.view.speed, props.view.playing], updateView)
onMounted(() => {
  mounted = true
  window.addEventListener('message', onMessage)
  run()
  resizeObserver = new ResizeObserver(onResize)
  if (host.value) resizeObserver.observe(host.value)
})
onBeforeUnmount(() => {
  mounted = false
  resizeObserver?.disconnect()
  if (resizeTimer) clearTimeout(resizeTimer)
  resizeTimer = undefined
  clearPending('The sketch preview was closed.')
  window.removeEventListener('message', onMessage)
})
defineExpose({ exportPng, run })
</script>

<template>
  <div ref="host" class="script-preview">
    <iframe
      :key="instance"
      ref="frame"
      :srcdoc="documentSource"
      title="Live p5 sketch preview"
      sandbox="allow-scripts"
      referrerpolicy="no-referrer"
      allow="camera 'none'; microphone 'none'; geolocation 'none'; accelerometer 'none'; gyroscope 'none'; magnetometer 'none'; clipboard-read 'none'; clipboard-write 'none'"
    />
    <p v-if="errorMessage" class="script-preview__error" role="alert">{{ errorMessage }}</p>
  </div>
</template>

<style scoped>
.script-preview { position: relative; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; }
.script-preview iframe { display: block; width: 100%; height: 100%; border: 0; }
.script-preview__error { position: absolute; left: 12px; right: 12px; bottom: 12px; margin: 0; padding: 10px 12px; border-radius: 8px; background: #fff2ec; color: #853d2e; font: 12px/1.5 ui-monospace, monospace; overflow-wrap: anywhere; pointer-events: none; }
</style>
