import { createError } from 'h3'

/** Per-worker limits also cover changing hashes; query strings never enter the key. */
export function createArtworkCache(render: (hash: string, background: string) => Promise<Buffer>, options: {
  now?: () => number; entries?: number; bytes?: number; concurrent?: number; perMinute?: number; ttl?: number
} = {}) {
  const now = options.now ?? Date.now
  const cache = new Map<string, { png: Buffer; expires: number }>()
  const pending = new Map<string, Promise<Buffer>>()
  const maxBytes = options.bytes ?? 16 * 1024 * 1024
  let bytes = 0
  let starts: number[] = []
  const remove = (key: string) => { bytes -= cache.get(key)!.png.byteLength; cache.delete(key) }
  return (hash: string, background: string): Promise<Buffer> => {
    const time = now()
    const key = `${hash}/${background}`
    for (const [key, entry] of cache) if (entry.expires <= time) remove(key)
    const cached = cache.get(key)
    if (cached) {
      cache.delete(key); cache.set(key, cached)
      return Promise.resolve(cached.png)
    }
    const existing = pending.get(key)
    if (existing) return existing
    starts = starts.filter(start => start > time - 60000)
    if (pending.size >= (options.concurrent ?? 2) || starts.length >= (options.perMinute ?? 20)) {
      return Promise.reject(createError({ statusCode: 429, statusMessage: 'Artwork previews are busy. Try again shortly.' }))
    }
    starts.push(time)
    // Register before drawing, so overlapping GET/HEAD requests share one encode.
    const work = Promise.resolve().then(() => render(hash, background)).then(png => {
      if (png.byteLength > Math.min(maxBytes, 2 * 1024 * 1024)) {
        throw createError({ statusCode: 503, statusMessage: 'Artwork preview is unavailable.' })
      }
      while (cache.size && (cache.size >= (options.entries ?? 64) || bytes + png.byteLength > maxBytes)) {
        remove(cache.keys().next().value!)
      }
      cache.set(key, { png, expires: now() + (options.ttl ?? 86400000) })
      bytes += png.byteLength
      return png
    }).finally(() => pending.delete(key))
    pending.set(key, work)
    return work
  }
}
