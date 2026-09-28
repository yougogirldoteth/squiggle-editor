import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PromptError } from './prompt'

/** Empty reservation files share the daily cap across restarts and rolling deployments. */
export function createPromptBudget(directory: string, options: { now?: () => number; daily?: number } = {}) {
  const now = options.now ?? Date.now
  const daily = options.daily ?? 200
  let previousDay = -1
  let nextSlot = 0
  return () => {
    const time = now()
    const day = Math.floor(time / 86400000)
    try {
      if (!directory) throw new Error('Missing budget directory')
      const folder = join(directory, String(day))
      mkdirSync(folder, { recursive: true, mode: 0o700 })
      if (day !== previousDay) {
        nextSlot = 0
        // Keep a week of counters, never prompts, addresses, or credentials.
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          if (entry.isDirectory() && /^\d+$/.test(entry.name) && Number(entry.name) < day - 7) {
            rmSync(join(directory, entry.name), { recursive: true, force: true })
          }
        }
        previousDay = day
      }
      for (; nextSlot < daily; nextSlot++) {
        try {
          // Exclusive creation is atomic across processes sharing this volume.
          writeFileSync(join(folder, String(nextSlot)), '', { flag: 'wx', mode: 0o600 })
          nextSlot++
          return
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        }
      }
    } catch {
      // A missing or unwritable volume must never silently disable the budget.
      throw new PromptError(503, 'Prompt mode is unavailable right now. Try again later.')
    }
    throw new PromptError(429, 'Prompt mode has reached its daily limit. Try again tomorrow.', Math.ceil(((day + 1) * 86400000 - time) / 1000))
  }
}
