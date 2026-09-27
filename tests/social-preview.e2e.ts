import { test, expect } from '@playwright/test'
import { DEFAULT_HASH, setType } from '../app/utils/squiggle'

function imageUrl(html: string) {
  const tag = html.match(/<meta[^>]*property="og:image"[^>]*>/)?.[0]
  const url = tag?.match(/content="([^"]+)"/)?.[1]
  expect(url).toBeTruthy()
  return new URL(url!.replaceAll('&amp;', '&'))
}

test('social previews are present in server HTML and both image methods work', async ({ request }) => {
  const images: Buffer[] = []
  for (const [hash, bg] of [[DEFAULT_HASH, 'ffffff'], [setType(DEFAULT_HASH, 'Fuzzy'), '000000']]) {
    const response = await request.get(`/?hash=${hash}&bg=${bg}`)
    expect(response.status()).toBe(200)
    const html = await response.text()
    expect(Buffer.byteLength(html)).toBeLessThan(500_000)
    expect(html).toContain('content="summary_large_image"')
    const url = imageUrl(html)
    expect(url.protocol).toBe('https:')
    const path = url.pathname + url.search
    const head = await request.head(path, { headers: { 'user-agent': 'Twitterbot/1.0' } })
    const get = await request.get(path)
    expect(head.status()).toBe(200)
    expect(get.status()).toBe(200)
    expect(head.headers()['content-type']).toContain('image/png')
    expect(get.headers()['content-type']).toContain('image/png')
    const png = await get.body()
    expect(png.readUInt32BE(16)).toBe(1200)
    expect(png.readUInt32BE(20)).toBe(630)
    expect(png.length).toBeLessThan(5_000_000)
    images.push(png)
    const source = `/og/artwork/${hash}/${bg}.png`
    const sourceHead = await request.head(source)
    const sourceGet = await request.get(source)
    expect(sourceHead.status()).toBe(200)
    expect(sourceHead.headers()['content-length']).toBe(sourceGet.headers()['content-length'])
    expect(sourceHead.headers()['content-type']).toBe('image/png')
  }
  expect(images[0]!.equals(images[1]!)).toBe(false)
})

test('preview inputs are bounded and malformed links fall back to the default artwork', async ({ request }) => {
  expect((await request.get('/og/artwork/invalid/ffffff.png')).status()).toBe(404)
  expect((await request.get(`/og/artwork/${DEFAULT_HASH}/123456.png`)).status()).toBe(404)
  expect((await request.post(`/og/artwork/${DEFAULT_HASH}/ffffff.png`)).status()).toBe(405)
  const fallback = imageUrl(await (await request.get('/?hash=invalid&bg=invalid')).text())
  const normal = imageUrl(await (await request.get('/')).text())
  const fallbackPng = await (await request.get(fallback.pathname + fallback.search)).body()
  const normalPng = await (await request.get(normal.pathname + normal.search)).body()
  expect(fallbackPng.equals(normalPng)).toBe(true)
})
