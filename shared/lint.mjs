import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import path from 'node:path'

const projectRoot = process.cwd()
const files = []

for (const directory of ['src', 'tests', 'scripts']) {
  await collectJavaScriptFiles(path.join(projectRoot, directory))
}

for (const file of files) {
  await checkSyntax(file)
}

console.log(`Syntax check passed for ${files.length} JavaScript files.`)

async function collectJavaScriptFiles(directory) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }

  for (const entry of entries) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) await collectJavaScriptFiles(file)
    else if (/\.(?:m?js)$/.test(entry.name)) files.push(file)
  }
}

function checkSyntax(file) {
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
