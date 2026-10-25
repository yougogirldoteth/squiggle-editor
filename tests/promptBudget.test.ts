import { afterEach, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPromptBudget } from '../server/utils/promptBudget'

const directories: string[] = []
function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'squiggle-budget-'))
  directories.push(directory)
  return directory
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

it('shares a daily allowance between instances and preserves it across restarts', () => {
  const directory = temporaryDirectory()
  const options = { daily: 3, now: () => 100000 }
  const first = createPromptBudget(directory, options)
  const second = createPromptBudget(directory, options)
  first(); second(); first()
  expect(() => second()).toThrow('daily limit')
  expect(() => createPromptBudget(directory, options)()).toThrow('daily limit')
  expect(readdirSync(join(directory, '0'))).toHaveLength(3)
})

it('renews the allowance at UTC midnight and keeps recent counters only', () => {
  const directory = temporaryDirectory()
  let time = 86400000 * 10 - 1
  mkdirSync(join(directory, '1'))
  writeFileSync(join(directory, 'notes'), 'unrelated file')
  const reserve = createPromptBudget(directory, { daily: 1, now: () => time })
  reserve()
  expect(() => reserve()).toThrow('daily limit')
  time++
  reserve()
  expect(readdirSync(directory).sort()).toEqual(['10', '9', 'notes'])
})

it('fails closed for missing or unusable storage', () => {
  expect(() => createPromptBudget('')()).toThrow('unavailable')
  const directory = temporaryDirectory()
  const file = join(directory, 'file')
  writeFileSync(file, '')
  expect(() => createPromptBudget(file)()).toThrow('unavailable')
})

it('preserves a network allowance across restarts without consuming another network’s share', () => {
  const directory = temporaryDirectory()
  const options = { daily: 5, perClient: 2, now: () => 100000 }
  const reserve = createPromptBudget(directory, options)
  reserve('192.0.2.1'); reserve('192.0.2.1')
  expect(() => reserve('192.0.2.1')).toThrow('network has reached')
  expect(() => createPromptBudget(directory, options)('192.0.2.1')).toThrow('network has reached')
  reserve('192.0.2.2'); reserve('192.0.2.2'); reserve('192.0.2.3')
  expect(() => reserve('192.0.2.4')).toThrow('daily limit')
  const files = readdirSync(join(directory, '0', 'clients'))
  expect(files).toHaveLength(5)
  expect(files.every(file => /^[a-f0-9]{64}-\d+$/.test(file))).toBe(true)
  expect(files.some(file => file.includes('192.0.2'))).toBe(false)
  expect(readFileSync(join(directory, '0', 'client-salt')).byteLength).toBe(32)
  expect(statSync(join(directory, '0', 'client-salt')).mode & 0o777).toBe(0o600)
})

it('renews network allowances daily and fails closed if their salt is damaged', () => {
  const directory = temporaryDirectory()
  let time = 100000
  const reserve = createPromptBudget(directory, { perClient: 1, now: () => time })
  reserve('network')
  expect(() => reserve('network')).toThrow('network has reached')
  time += 86400000
  reserve('network')
  writeFileSync(join(directory, '1', 'client-salt'), '')
  expect(() => reserve('different-network')).toThrow('unavailable')
})
