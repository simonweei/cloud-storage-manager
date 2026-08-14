import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const assetsDirectory = fileURLToPath(new URL('../dist/cloud_storage_manager/assets/', import.meta.url))
const entries = await readdir(assetsDirectory, { withFileTypes: true })
const javascriptFiles = entries.filter(entry => entry.isFile() && entry.name.endsWith('.js'))

if (javascriptFiles.length === 0) {
  throw new Error('Worker bundle verification failed: no JavaScript assets were found. Run the build first.')
}

const brokenAwsSdkRuntime = /const\s+emitWarningIfUnsupportedVersion(?:\$\d+)?\s*=\s*no(?:\$\d+)?\s*;/u

for (const file of javascriptFiles) {
  const source = await readFile(join(assetsDirectory, file.name), 'utf8')
  if (brokenAwsSdkRuntime.test(source)) {
    throw new Error(
      `Worker bundle verification failed: ${file.name} contains the incompatible AWS SDK node-only runtime shim.`
    )
  }
}

console.log(`Verified ${javascriptFiles.length} Worker bundle assets: AWS SDK runtime is compatible.`)
