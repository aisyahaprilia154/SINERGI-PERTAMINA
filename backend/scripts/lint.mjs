import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = []

for (const directory of ['src', 'tests', 'scripts']) {
  await collectJavaScriptFiles(path.join(projectRoot, directory), files)
}

for (const file of files) {
  await runNodeCheck(file)
}

console.log(`Syntax lint passed for ${files.length} JavaScript files.`)

async function collectJavaScriptFiles(directory, output) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }

  for (const entry of entries) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) await collectJavaScriptFiles(target, output)
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) output.push(target)
  }
}

function runNodeCheck(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--check', file], {
      cwd: projectRoot,
      stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Syntax check failed for ${path.relative(projectRoot, file)}.`))
    })
  })
}
