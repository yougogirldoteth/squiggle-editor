import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp, eventHandler, toNodeListener } from 'h3'
import { DEFAULT_HASH, parseHash } from '../app/utils/squiggle'
import { createPromptLimiter, generatePrompt, parsePromptInput, parsePromptResponse, promptRequestBody } from '../server/utils/prompt'
import { createPromptHandler } from '../server/utils/promptHandler'

const recipe = { shape: null, style: null, texture: null, color: { startHue: 210, hueSpan: 60, reverse: false, hyper: null } }
const completion = { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ edit: { intent: 'refinement', ...recipe } }) }] }] }
const input = { prompt: 'Make it blue', hash: DEFAULT_HASH }
const config = { apiKey: 'test-key', model: 'gpt-6-luna' }

describe('prompt provider boundary', () => {
  it('validates and normalizes requests without accepting model or code overrides', () => {
    expect(parsePromptInput({ ...input, prompt: '  blue  ' })).toEqual({ ...input, prompt: 'blue' })
    for (const value of [null, {}, [], { ...input, model: 'expensive' }, { ...input, prompt: '' }, { ...input, prompt: 'a'.repeat(601) }, { ...input, hash: 'invalid' }, { ...input, prompt: 2 }]) {
      expect(() => parsePromptInput(value)).toThrow()
    }
  })

  it('uses a bounded structured request with no tools, storage, or executable output', () => {
    const body = promptRequestBody(input.prompt, input.hash, config.model)
    expect(body).toMatchObject({ model: 'gpt-6-luna', store: false, max_output_tokens: 1000, reasoning: { effort: 'none' }, text: { format: { type: 'json_schema', strict: true } } })
    expect(body).not.toHaveProperty('tools')
    expect(body.input[0]!.content).toContain(input.prompt)
    expect(body.input[0]!.content).toContain('Current artwork:')
    expect(body.text.format.schema.additionalProperties).toBe(false)
  })

  it('accepts a valid completed response and returns only the validated hash and palette notice', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(completion))
    const result = await generatePrompt(input, config, undefined, request)
    expect(parseHash(result.hash)).toHaveLength(32)
    expect(Object.keys(result).sort()).toEqual(['colorLimited', 'hash'])
    expect(result.hash).not.toBe(DEFAULT_HASH)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0]![0]).toBe('https://api.openai.com/v1/responses')
    expect(request.mock.calls[0]![1]).toMatchObject({ headers: { Authorization: 'Bearer test-key' }, redirect: 'error' })
  })

  it('requires shape, palette, and style together for a new subject', () => {
    const edit = { ...recipe, intent: 'subject', shape: { points: Array(13).fill(0), tallness: 1 }, style: 'Normal' }
    const response = (value: unknown) => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] })
    expect(parsePromptResponse(response({ edit }), DEFAULT_HASH).hash).not.toBe(DEFAULT_HASH)
    for (const group of ['shape', 'color', 'style']) {
      expect(() => parsePromptResponse(response({ edit: { ...edit, [group]: null } }), DEFAULT_HASH)).toThrow('invalid result')
    }
    expect(() => parsePromptResponse(response({ edit: { ...edit, intent: 'other' } }), DEFAULT_HASH)).toThrow('invalid result')
    expect(() => parsePromptResponse(response({ edit, extra: true }), DEFAULT_HASH)).toThrow('invalid result')
    expect(parsePromptResponse(response({ edit: { ...recipe, intent: 'refinement' } }), DEFAULT_HASH).hash).not.toBe(DEFAULT_HASH)
  })

  it.each([
    null, {}, { ...completion, status: 'incomplete' }, { ...completion, output: [] },
    { ...completion, output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'private provider text' }] }] },
    { ...completion, output: [{ type: 'message', content: [{ type: 'output_text', text: 'not json' }] }] },
    { ...completion, output: [{ type: 'message', content: [{ type: 'output_text', text: '{"code":"alert(1)"}' }] }] },
    { ...completion, output: [...completion.output, ...completion.output] },
  ])('rejects incomplete, refused or invalid output %#', value => {
    expect(() => parsePromptResponse(value, DEFAULT_HASH)).toThrow()
  })

  it('sanitizes upstream errors and never automatically retries', async () => {
    for (const response of [new Response('secret upstream text', { status: 401 }), new Response('secret upstream text', { status: 429 }), new Response('not JSON'), new Response('x'.repeat(65537))]) {
      const request = vi.fn<typeof fetch>().mockResolvedValue(response)
      await expect(generatePrompt(input, config, undefined, request)).rejects.toThrow(/^Prompt mode is unavailable|^The prompt/)
      expect(request).toHaveBeenCalledTimes(1)
    }
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error('secret token in network error'))
    await expect(generatePrompt(input, config, undefined, request)).rejects.toThrow('The prompt could not be completed. Try again.')
  })

  it('passes cancellation to the provider and reports a safe cancellation', async () => {
    const controller = new AbortController()
    const request = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
    }))
    const result = generatePrompt(input, config, controller.signal, request)
    controller.abort()
    await expect(result).rejects.toMatchObject({ statusCode: 499 })
    expect(request.mock.calls[0]![1]!.signal!.aborted).toBe(true)
  })
})

describe('prompt request limits', () => {
  it('limits per-address attempts, concurrency and total daily attempts, including failures', () => {
    let time = 100000
    const acquire = createPromptLimiter({ now: () => time, perMinute: 2, concurrent: 1, daily: 3 })
    const release = acquire('a')
    expect(() => acquire('b')).toThrow('busy')
    release(); release() // Releasing twice must not create extra capacity.
    acquire('a')()
    expect(() => acquire('a')).toThrow('too many')
    time += 60001
    acquire('a')()
    expect(() => acquire('b')).toThrow('daily limit')
    time += 86400000
    acquire('b')()
  })
})

describe('prompt HTTP handler', () => {
  let server: Server | undefined
  afterEach(async () => {
    server?.closeAllConnections()
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()))
    server = undefined
  })
  async function start(apiKey = 'test-key', request = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(completion))) {
    const handler = createPromptHandler(request)
    const app = createApp().use('/api/prompt', eventHandler(event => handler(event, { ...config, apiKey })))
    server = createServer(toNodeListener(app))
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const send = (body: unknown = input, headers: Record<string, string> = {}) => fetch(`${origin}/api/prompt`, {
      method: 'POST', body: JSON.stringify(body), headers: { origin, 'content-type': 'application/json', ...headers },
    })
    return { origin, send, request }
  }

  it('serves a valid result without exposing the key or caching it', async () => {
    const { send, request } = await start()
    const response = await send()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = await response.text()
    expect(body).not.toContain('test-key')
    expect(JSON.parse(body).hash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('does not call the provider without a key', async () => {
    const { send, request } = await start('')
    expect((await send()).status).toBe(503)
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects cross-origin, malformed and oversized requests before spending tokens', async () => {
    const { send, request, origin } = await start()
    expect((await send(input, { origin: 'https://elsewhere.example' })).status).toBe(403)
    expect((await send(input, { origin: 'null' })).status).toBe(403)
    expect((await send(input, { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await send(input, { 'content-type': 'text/plain' })).status).toBe(415)
    expect((await send({ ...input, prompt: 'a'.repeat(601) })).status).toBe(400)
    expect((await send({ ...input, prompt: 'a'.repeat(9000) })).status).toBe(413)
    expect((await fetch(`${origin}/api/prompt`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{' })).status).toBe(400)
    expect(request).not.toHaveBeenCalled()
  })

  it('bounds chunked bodies even when content-length is absent', async () => {
    const { origin, request } = await start()
    const status = await new Promise<number>(resolve => {
      const req = httpRequest(`${origin}/api/prompt`, { method: 'POST', headers: { origin, 'content-type': 'application/json' } }, res => { res.resume(); resolve(res.statusCode!) })
      req.write('x'.repeat(5000)); req.end('x'.repeat(5000))
    })
    expect(status).toBe(413)
    expect(request).not.toHaveBeenCalled()
  })

  it('ignores forged forwarded addresses and returns a retry delay', async () => {
    const { send, request } = await start()
    for (let i = 0; i < 4; i++) expect((await send(input, { 'x-forwarded-for': `192.0.2.${i}` })).status).toBe(200)
    const response = await send(input, { 'x-forwarded-for': '192.0.2.200' })
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    expect(request).toHaveBeenCalledTimes(4)
  })

  it('cancels the upstream call when the browser disconnects', async () => {
    const cancelled = vi.fn()
    const provider = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => { cancelled(); reject(new Error('aborted')) }, { once: true })
    }))
    const { origin } = await start('test-key', provider)
    const controller = new AbortController()
    const pending = fetch(`${origin}/api/prompt`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(input), signal: controller.signal }).catch(() => {})
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1))
    controller.abort()
    await pending
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledTimes(1))
  })
})
