import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'

const distUrl = new URL('../dist/', import.meta.url)
const clientUrl = new URL('../dist/client/', import.meta.url)

await rm(clientUrl, { recursive: true, force: true })
await mkdir(clientUrl, { recursive: true })

for (const entry of await readdir(distUrl, { withFileTypes: true })) {
  if (entry.name === 'client' || entry.name === 'server') continue

  await rename(
    new URL(entry.name, distUrl),
    new URL(entry.name, clientUrl),
  )
}

const workerSource = `export default {
  async fetch(request, env) {
    if (!env.ASSETS) {
      return new Response('Static asset binding is unavailable.', { status: 503 })
    }

    const url = new URL(request.url)
    const servesDocument = request.method === 'GET' || request.method === 'HEAD'
    const hasFileExtension = url.pathname.split('/').at(-1)?.includes('.')

    if (servesDocument && !hasFileExtension) {
      url.pathname = '/'
      return env.ASSETS.fetch(new Request(url, request))
    }

    const response = await env.ASSETS.fetch(request)
    if (response.status !== 404) return response

    url.pathname = '/'
    return env.ASSETS.fetch(new Request(url, request))
  },
}
`

await mkdir(new URL('../dist/server/', import.meta.url), { recursive: true })
await writeFile(new URL('../dist/server/index.js', import.meta.url), workerSource)
