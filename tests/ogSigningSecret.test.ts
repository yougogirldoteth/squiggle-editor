import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'

it('writes a private signing file without logging its value or replacing a prior key', () => {
  const directory = mkdtempSync(join(tmpdir(), 'squiggle-signing-'))
  const destination = join(directory, 'signing.env')
  try {
    const output = execFileSync(process.execPath, ['scripts/create-og-signing-secret.mjs', destination], { encoding: 'utf8' })
    const contents = readFileSync(destination, 'utf8')
    expect(contents).toMatch(/^NUXT_OG_IMAGE_SECRET=[A-Za-z0-9_-]{43}\n$/)
    expect(output.trim()).toBe('New OG signing environment file created.')
    expect(statSync(destination).mode & 0o777).toBe(0o600)
    writeFileSync(destination, 'existing value')
    expect(spawnSync(process.execPath, ['scripts/create-og-signing-secret.mjs', destination]).status).toBe(1)
    expect(readFileSync(destination, 'utf8')).toBe('existing value')
    expect(spawnSync(process.execPath, ['scripts/create-og-signing-secret.mjs', '.env.audit-test']).status).toBe(1)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
