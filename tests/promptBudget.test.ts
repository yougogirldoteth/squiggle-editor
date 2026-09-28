import { afterEach, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
