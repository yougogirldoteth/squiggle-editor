import { randomBytes } from 'node:crypto'
import { realpathSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Generate an environment file without putting the secret in argv or console logs.
try {
  if (process.argv.length !== 3) throw new Error('destination required')
  const destination = resolve(process.argv[2])
  const repository = realpathSync(fileURLToPath(new URL('../', import.meta.url)))
  const parent = realpathSync(dirname(destination))
  const local = relative(repository, parent)
  if (local === '' || (!local.startsWith(`..${sep}`) && local !== '..')) throw new Error('destination must be outside the checkout')
  writeFileSync(destination, `NUXT_OG_IMAGE_SECRET=${randomBytes(32).toString('base64url')}\n`, { flag: 'wx', mode: 0o600 })
  process.stdout.write('New OG signing environment file created.\n')
} catch {
  process.stderr.write('Could not create the signing file. Use a new file in an existing private directory outside the checkout.\n')
  process.exitCode = 1
}
