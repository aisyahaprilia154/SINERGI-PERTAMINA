import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, readdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { gunzip } from 'node:zlib'

const decompress = promisify(gunzip)
const FORMAT = 'active-view/2'

// This is a disposable read model, never a storage fallback. The caller must
// authenticate and obtain the current database revision before every lookup.
export function createDiskRepresentationCache({ directory, maxBytes, maxEntries = 16, maxPlainBytes = maxBytes }) {
  const filename = key => path.join(directory, `${createHash('sha256').update(key).digest('hex')}.cache`)
  return {
    async read(key, cacheKey) {
      try {
        const file = filename(key)
        if ((await stat(file)).size > maxBytes) return null
        const bytes = await readFile(file)
        if (bytes.length < 4) return null
        const headerLength = bytes.readUInt32BE(0)
        if (headerLength > 16_384 || headerLength + 4 >= bytes.length) return null
        const header = JSON.parse(bytes.subarray(4, headerLength + 4).toString())
        if (header.format !== FORMAT || header.cacheKey !== cacheKey) return null
        const compressed = bytes.subarray(headerLength + 4)
        const plain = await decompress(compressed, { maxOutputLength: maxPlainBytes })
        const etag = `"${createHash('sha256').update(plain).digest('hex')}"`
        if (etag !== header.etag) return null
        return { plain, compressed, etag }
      } catch { return null }
    },
    async write(key, cacheKey, result) {
      let temporary
      try {
        const header = Buffer.from(JSON.stringify({ format: FORMAT, cacheKey, etag: result.etag }))
        const size = Buffer.alloc(4)
        size.writeUInt32BE(header.length)
        if (header.length > 16_384 || result.compressed.length + header.length + 4 > maxBytes) return
        await mkdir(directory, { recursive: true, mode: 0o700 })
        temporary = `${filename(key)}.${randomUUID()}.tmp`
        await writeFile(temporary, Buffer.concat([size, header, result.compressed]), { mode: 0o600 })
        await rename(temporary, filename(key))
        temporary = null
        const files = (await readdir(directory)).filter(name => /^[a-f0-9]{64}\.cache$/.test(name))
        const entries = await Promise.all(files.map(async name => ({
          file: path.join(directory, name), ...(await stat(path.join(directory, name))),
        })))
        entries.sort((a, b) => b.mtimeMs - a.mtimeMs)
        let retained = 0
        for (let i = 0; i < entries.length; i++) {
          retained += entries[i].size
          if (i >= maxEntries || retained > maxBytes) await unlink(entries[i].file).catch(() => {})
        }
      } catch {
        // Cache filesystem failures must not make a healthy database unavailable.
      } finally {
        if (temporary) await unlink(temporary).catch(() => {})
      }
    },
  }
}
