import { createError, getRequestIP, getRequestURL, setResponseHeaders, type H3Event } from 'h3'
import { createPromptLimiter, generatePrompt, parsePromptInput, PromptError } from './prompt'

function readPromptBody(event: H3Event): Promise<unknown> {
  const req = event.node.req
  const length = req.headers['content-length']
  if (length && (!/^\d+$/.test(length) || Number(length) > 8192)) {
    req.resume()
    return Promise.reject(new PromptError(413, 'The prompt is too long.'))
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const timeout = setTimeout(() => finish(new PromptError(408, 'The request took too long.')), 10000)
    const cleanup = () => {
      clearTimeout(timeout)
      req.off('data', data); req.off('end', end); req.off('error', failed); req.off('aborted', failed)
    }
    const finish = (error?: PromptError) => {
      cleanup()
      if (error) { req.resume(); reject(error); return }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch { reject(new PromptError(400, 'Send a valid prompt.')) }
    }
    const data = (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > 8192) { finish(new PromptError(413, 'The prompt is too long.')); return }
      chunks.push(chunk)
    }
    const end = () => finish()
    const failed = () => finish(new PromptError(400, 'The request was interrupted.'))
    req.on('data', data); req.once('end', end); req.once('error', failed); req.once('aborted', failed)
  })
}

export function createPromptHandler(request: typeof fetch = fetch, acquire = createPromptLimiter()) {
  return async (event: H3Event, config: { apiKey: string; model: string }) => {
    setResponseHeaders(event, { 'cache-control': 'no-store' })
    const controller = new AbortController()
    const disconnect = () => { if (!event.node.res.writableEnded) controller.abort() }
    try {
      if (event.method !== 'POST') throw new PromptError(405, 'Method not allowed.')
      const origin = event.headers.get('origin')
      if (origin !== getRequestURL(event, { xForwardedHost: false }).origin
        || event.headers.get('sec-fetch-site') === 'cross-site') throw new PromptError(403, 'Open Prompt mode in the editor.')
      if (event.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new PromptError(415, 'Send a JSON prompt.')
      if (!config.apiKey) throw new PromptError(503, 'Prompt mode is not available yet.')
      const input = parsePromptInput(await readPromptBody(event))
      // Never trust caller-supplied X-Forwarded-For for the per-address limit.
      // Behind a proxy this is a conservative shared limit until configured otherwise.
      const address = getRequestIP(event) ?? 'unknown'
      event.node.res.once('close', disconnect)
      return await generatePrompt(input, config, controller.signal, request, () => acquire(address))
    } catch (error) {
      const safe = error instanceof PromptError ? error : new PromptError(500, 'Prompt mode is unavailable right now.')
      if (safe.retryAfter) setResponseHeaders(event, { 'retry-after': safe.retryAfter })
      throw createError({ statusCode: safe.statusCode, statusMessage: safe.message })
    } finally {
      event.node.res.off('close', disconnect)
    }
  }
}
