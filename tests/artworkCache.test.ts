import { describe, expect, it, vi } from 'vitest'
import { createArtworkCache } from '../server/utils/artworkCache'

describe('artwork rendering budgets', () => {
  it('shares overlapping requests and keeps encoded bytes for GET and HEAD reuse', async () => {
    let finish!: (png: Buffer) => void
    const render = vi.fn(() => new Promise<Buffer>(resolve => { finish = resolve }))
    const image = createArtworkCache(render)
    const first = image('hash', 'ffffff')
    expect(image('hash', 'ffffff')).toBe(first)
    await Promise.resolve()
    const png = Buffer.from('png')
    finish(png)
    expect(await first).toBe(png)
    expect(await image('hash', 'ffffff')).toBe(png)
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('bounds changing hashes, retains cached images when busy, and resets the rate window', async () => {
    let time = 0
    const render = vi.fn(async () => Buffer.from('png'))
    const image = createArtworkCache(render, { now: () => time, perMinute: 2 })
    await image('a', 'white'); await image('b', 'white')
    await expect(image('c', 'white')).rejects.toMatchObject({ statusCode: 429 })
    expect(await image('a', 'white')).toEqual(Buffer.from('png'))
    time = 60000
    await image('c', 'white')
    expect(render).toHaveBeenCalledTimes(3)
  })

  it('rejects excess concurrent renders without queueing and releases failures', async () => {
    let fail!: (error: Error) => void
    const render = vi.fn(() => new Promise<Buffer>((_, reject) => { fail = reject }))
    const image = createArtworkCache(render, { concurrent: 1 })
    const pending = image('a', 'white')
    await expect(image('b', 'white')).rejects.toMatchObject({ statusCode: 429 })
    fail(new Error('failed'))
    await expect(pending).rejects.toThrow('failed')
    render.mockImplementation(async () => Buffer.from('recovered'))
    expect(await image('b', 'white')).toEqual(Buffer.from('recovered'))
  })

  it('bounds cached bytes and entries, expires values and never caches oversized output', async () => {
    let time = 0
    const render = vi.fn(async () => Buffer.from('1234'))
    const image = createArtworkCache(render, { now: () => time, entries: 2, bytes: 8, ttl: 10 })
    await image('a', 'white'); await image('b', 'white'); await image('a', 'white')
    await image('c', 'white')
    await image('b', 'white') // Least recently used a was retained; b was evicted.
    expect(render).toHaveBeenCalledTimes(4)
    time = 11
    await image('b', 'white')
    expect(render).toHaveBeenCalledTimes(5)
    render.mockImplementation(async () => Buffer.alloc(9))
    await expect(image('large', 'white')).rejects.toMatchObject({ statusCode: 503 })
    await expect(image('large', 'white')).rejects.toMatchObject({ statusCode: 503 })
    expect(render).toHaveBeenCalledTimes(7)
  })
})
