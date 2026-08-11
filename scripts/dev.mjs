import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const localAdminToken = process.env.SINERGI_LOCAL_ADMIN_TOKEN ?? 'local-admin'
const backendPort = process.env.SINERGI_PORT ?? '5000'
const frontendPort = process.env.SINERGI_DEV_FRONTEND_PORT
const branchIds = process.env.SINERGI_BRANCH_IDS ?? 'semarang'
const branchDatasets = process.env.SINERGI_BRANCH_DATASETS ?? JSON.stringify({
  semarang: 'dataset-semarang',
})
const authTokens = process.env.SINERGI_AUTH_TOKENS ?? JSON.stringify({
  [localAdminToken]: {
    id: 'local-admin',
    role: 'Administrator',
    branchIds: ['semarang'],
    datasetIds: ['dataset-semarang'],
  },
})

const services = [
  {
    name: 'backend',
    cwd: path.join(projectRoot, 'backend'),
    args: ['--watch', 'src/server.js'],
    env: {
      ...process.env,
      SINERGI_AUTH_TOKENS: authTokens,
      SINERGI_BRANCH_IDS: branchIds,
      SINERGI_BRANCH_DATASETS: branchDatasets,
    },
  },
  {
    name: 'frontend',
    cwd: path.join(projectRoot, 'frontend'),
    args: [
      'node_modules/vite/bin/vite.js',
      ...(frontendPort ? ['--port', frontendPort] : []),
    ],
    env: {
      ...process.env,
      SINERGI_API_TARGET: process.env.SINERGI_API_TARGET
        ?? `http://127.0.0.1:${backendPort}`,
      VITE_SINERGI_ADMIN_TOKEN: localAdminToken,
    },
  },
]

let stopping = false
const children = services.map((service) => {
  const child = spawn(process.execPath, service.args, {
    cwd: service.cwd,
    env: service.env,
    stdio: 'inherit',
  })

  child.on('error', (error) => {
    console.error(`[dev:${service.name}] gagal dijalankan:`, error.message)
    stop(1)
  })

  child.on('exit', (code, signal) => {
    if (stopping) return
    const reason = signal ? `signal ${signal}` : `exit code ${code}`
    console.error(`[dev:${service.name}] berhenti (${reason}).`)
    stop(code || 1)
  })

  return child
})

function stop(exitCode = 0) {
  if (stopping) return
  stopping = true
  process.exitCode = exitCode

  for (const child of children) {
    if (!child.killed) child.kill()
  }
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
