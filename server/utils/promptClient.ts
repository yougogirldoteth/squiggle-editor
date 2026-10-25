import { isIP } from 'node:net'
import { getHeader, type H3Event } from 'h3'
import { PromptError } from './prompt'

function address(value: string) {
  if (isIP(value) === 4) return value
  if (isIP(value) !== 6) return undefined
  try {
    const normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1)
    // Map IPv4-in-IPv6 sockets to the same quota as an IPv4 connection.
    const mapped = normalized.match(/^::ffff:([0-9a-f]+):([0-9a-f]+)$/)
    if (mapped) {
      const high = parseInt(mapped[1]!, 16), low = parseInt(mapped[2]!, 16)
      return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
    }
    return normalized
  } catch { return undefined }
}

/** Only an explicitly trusted immediate proxy may supply the last forwarded hop. */
export function promptClient(event: H3Event, trustedProxies = '') {
  const peer = address(event.node.req.socket.remoteAddress ?? '')
  if (!peer) throw new PromptError(503, 'Prompt mode is unavailable right now.')
  const trusted = trustedProxies.split(',').map(value => value.trim()).filter(Boolean)
  const proxies = trusted.map(address)
  if (proxies.some(value => !value)) throw new PromptError(503, 'Prompt mode is unavailable right now.')
  let client = peer
  if (proxies.includes(peer)) {
    const forwarded = getHeader(event, 'x-forwarded-for') ?? ''
    // A single proxy appends or overwrites this hop. Ignore caller-controlled prefixes.
    const candidate = forwarded.length <= 1024 ? address(forwarded.split(',').at(-1)!.trim()) : undefined
    if (!candidate) throw new PromptError(503, 'Prompt mode is unavailable right now.')
    client = candidate
  }
  if (isIP(client) === 4) return client
  const [left, right = ''] = client.split('::')
  const head = left ? left.split(':') : [], tail = right ? right.split(':') : []
  const words = client.includes('::') ? [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail] : head
  // One IPv6 /64 gets one quota, rather than one quota per disposable address.
  return `${words.slice(0, 4).map(word => parseInt(word, 16).toString(16)).join(':')}::/64`
}
