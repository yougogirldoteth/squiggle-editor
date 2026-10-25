import { describe, expect, it } from 'vitest'
import type { H3Event } from 'h3'
import { promptClient } from '../server/utils/promptClient'

const event = (peer: string, forwarded?: string) => ({ node: { req: {
  socket: { remoteAddress: peer }, headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded },
} } }) as unknown as H3Event

describe('prompt client identity', () => {
  it('ignores spoofed forwarding from untrusted peers', () => {
    expect(promptClient(event('198.51.100.1', '203.0.113.1'))).toBe('198.51.100.1')
    expect(promptClient(event('198.51.100.1', '203.0.113.1'), '10.0.0.2')).toBe('198.51.100.1')
  })

  it('uses only the immediate client appended by an explicitly trusted proxy', () => {
    expect(promptClient(event('10.0.0.2', 'spoofed, 203.0.113.8'), '10.0.0.2')).toBe('203.0.113.8')
    expect(promptClient(event('::ffff:10.0.0.2', '203.0.113.8'), '10.0.0.2')).toBe('203.0.113.8')
    for (const forwarded of [undefined, '', 'invalid', '192.0.2.1, invalid', 'a'.repeat(1025)]) {
      expect(() => promptClient(event('10.0.0.2', forwarded), '10.0.0.2')).toThrow('unavailable')
    }
    expect(() => promptClient(event('10.0.0.2'), '0.0.0.0/0')).toThrow('unavailable')
  })

  it('groups equivalent IPv4 and IPv6 network spellings', () => {
    expect(promptClient(event('::ffff:c000:201'))).toBe('192.0.2.1')
    expect(promptClient(event('2001:db8:1234:5678::1'))).toBe('2001:db8:1234:5678::/64')
    expect(promptClient(event('2001:0db8:1234:5678:0001:0002:0003:0004'))).toBe('2001:db8:1234:5678::/64')
    expect(promptClient(event('2001:db8:1234:5679::1'))).not.toBe(promptClient(event('2001:db8:1234:5678::1')))
  })
})
