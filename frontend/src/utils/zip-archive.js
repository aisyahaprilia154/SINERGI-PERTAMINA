const encoder = new TextEncoder()

export function createZipArchive(entries) {
  const normalized = entries.map((entry) => ({
    name: sanitizeZipEntryName(entry.name),
    bytes: toBytes(entry.data),
  }))
  const localParts = []
  const centralParts = []
  let offset = 0

  normalized.forEach(({ name, bytes }) => {
    const nameBytes = encoder.encode(name)
    const checksum = crc32(bytes)
    const local = new Uint8Array(30 + nameBytes.length + bytes.length)
    const localView = new DataView(local.buffer)
    write32(localView, 0, 0x04034b50)
    write16(localView, 4, 20)
    write16(localView, 6, 0x0800)
    write16(localView, 8, 0)
    write32(localView, 14, checksum)
    write32(localView, 18, bytes.length)
    write32(localView, 22, bytes.length)
    write16(localView, 26, nameBytes.length)
    local.set(nameBytes, 30)
    local.set(bytes, 30 + nameBytes.length)
    localParts.push(local)

    const central = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(central.buffer)
    write32(centralView, 0, 0x02014b50)
    write16(centralView, 4, 20)
    write16(centralView, 6, 20)
    write16(centralView, 8, 0x0800)
    write16(centralView, 10, 0)
    write32(centralView, 16, checksum)
    write32(centralView, 20, bytes.length)
    write32(centralView, 24, bytes.length)
    write16(centralView, 28, nameBytes.length)
    write32(centralView, 42, offset)
    central.set(nameBytes, 46)
    centralParts.push(central)
    offset += local.length
  })

  const centralOffset = offset
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  write32(endView, 0, 0x06054b50)
  write16(endView, 8, normalized.length)
  write16(endView, 10, normalized.length)
  write32(endView, 12, centralSize)
  write32(endView, 16, centralOffset)
  return concatenate([...localParts, ...centralParts, end])
}

export function sanitizeDownloadFilename(value, fallback = 'sinergi-export') {
  const normalized = String(value || fallback)
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+|-+$/g, '')
  return normalized || fallback
}

function sanitizeZipEntryName(value) {
  const segments = String(value || 'file')
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .map((segment) => sanitizeDownloadFilename(segment, 'file'))
  return segments.join('/') || 'file'
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return encoder.encode(String(value ?? ''))
}

function concatenate(parts) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  parts.forEach((part) => {
    output.set(part, offset)
    offset += part.length
  })
  return output
}

function write16(view, offset, value) {
  view.setUint16(offset, value, true)
}

function write32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true)
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}
