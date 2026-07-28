import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.join(projectRoot, 'src')
const outputRoot = path.join(projectRoot, 'dist')
const files = []

await collectJavaScriptFiles(sourceRoot, files)
const sourceHash = createHash('sha256')
for (const file of files.sort()) {
  sourceHash.update(path.relative(projectRoot, file))
  sourceHash.update(await readFile(file))
}
await rm(outputRoot, { recursive: true, force: true })
await mkdir(outputRoot, { recursive: true })
await writeFile(
  path.join(outputRoot, 'build-manifest.json'),
  JSON.stringify({
    service: 'sinergi-import-service',
    format: 'native-node-esm',
    entrypoint: 'src/server.js',
    sourceFiles: files.map((file) => path.relative(projectRoot, file).split(path.sep).join('/')),
    sourceDigest: sourceHash.digest('hex'),
  }, null, 2),
  'utf8',
)

console.log(`Backend build manifest created for ${files.length} source files.`)

async function collectJavaScriptFiles(directory, output) {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) await collectJavaScriptFiles(target, output)
    else if (entry.name.endsWith('.js')) output.push(target)
  }
}
