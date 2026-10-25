const MAX_FILE_BYTES = 5 * 1024 * 1024

export function validateAssetIconFile(file) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('Pilih gambar PNG, JPG, atau WebP.')
  }
  if (!file.size || file.size > MAX_FILE_BYTES) throw new Error('Ukuran gambar maksimal 5 MB.')
}

export async function prepareAssetIcon(file, { signal } = {}) {
  validateAssetIconFile(file)
  signal?.throwIfAborted()
  const url = URL.createObjectURL(file)
  let abort
  try {
    const image = new Image()
    image.src = url
    const decoded = image.decode().catch(() => { throw new Error('Gambar tidak dapat dibaca. Pilih gambar lain.') })
    if (signal) await Promise.race([decoded, new Promise((_, reject) => {
      abort = () => { image.src = ''; reject(signal.reason) }
      signal.addEventListener('abort', abort, {once:true})
      if (signal.aborted) abort()
    })])
    else await decoded
    signal?.throwIfAborted()
    if (!image.naturalWidth || !image.naturalHeight
      || image.naturalWidth * image.naturalHeight > 16_000_000) {
      throw new Error('Resolusi gambar terlalu besar. Pilih gambar yang lebih kecil.')
    }
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight))
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    let dataUrl = canvas.toDataURL('image/png')
    if (dataUrl.length > 174_784) {
      const smaller = document.createElement('canvas')
      smaller.width = Math.max(1, Math.round(canvas.width / 2))
      smaller.height = Math.max(1, Math.round(canvas.height / 2))
      smaller.getContext('2d').drawImage(canvas, 0, 0, smaller.width, smaller.height)
      dataUrl = smaller.toDataURL('image/png')
    }
    return dataUrl
  } finally {
    if (abort) signal.removeEventListener('abort', abort)
    URL.revokeObjectURL(url)
  }
}
