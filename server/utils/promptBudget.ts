import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHmac, randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { PromptError } from './prompt'

/** Empty reservation files share the daily cap across restarts and rolling deployments. */
export function createPromptBudget(directory: string, options: { now?: () => number; daily?: number; perClient?: number } = {}) {
  const now = options.now ?? Date.now
  const daily = options.daily ?? 200
  let previousDay = -1
  let nextSlot = 0
  return (client?: string) => {
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
      if (client !== undefined) {
        // A daily keyed digest avoids storing addresses or stable cross-day identifiers.
        const saltPath = join(folder, 'client-salt')
        try { writeFileSync(saltPath, randomBytes(32), { flag: 'wx', mode: 0o600 }) }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
        const salt = readFileSync(saltPath)
        if (salt.byteLength !== 32) throw new Error('Invalid quota salt')
        const key = createHmac('sha256', salt).update(client).digest('hex')
        // Cap directory cardinality too: all callers share at most daily reservations.
        const clients = join(folder, 'clients')
        mkdirSync(clients, { mode: 0o700, recursive: true })
        if (readdirSync(clients).length >= daily) {
          throw new PromptError(429, 'Prompt mode has reached its daily limit. Try again tomorrow.', Math.ceil(((day + 1) * 86400000 - time) / 1000))
        }
        let reserved = false
        for (let slot = 0; slot < (options.perClient ?? 20); slot++) {
          try { writeFileSync(join(clients, `${key}-${slot}`), '', { flag: 'wx', mode: 0o600 }); reserved = true; break }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
        }
        if (!reserved) throw new PromptError(429, 'This network has reached its daily prompt allowance. Try again tomorrow.', Math.ceil(((day + 1) * 86400000 - time) / 1000))
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
    } catch (error) {
      if (error instanceof PromptError) throw error
      // A missing or unwritable volume must never silently disable the budget.
      throw new PromptError(503, 'Prompt mode is unavailable right now. Try again later.')
    }
    throw new PromptError(429, 'Prompt mode has reached its daily limit. Try again tomorrow.', Math.ceil(((day + 1) * 86400000 - time) / 1000))
  }
}
