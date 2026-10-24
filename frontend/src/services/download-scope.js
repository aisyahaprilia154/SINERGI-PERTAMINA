// Each dialog owns its download URLs and timers, including an in-flight export.
export function createDownloadScope(signal) {
  const urls = new Map()
  const dispose = () => { for (const [url, timer] of urls) { window.clearTimeout(timer); URL.revokeObjectURL(url) }; urls.clear(); signal?.removeEventListener('abort', dispose) }
  signal?.addEventListener('abort', dispose, {once:true})
  return {
    saveBlob(blob, filename) {
      signal?.throwIfAborted()
      const url = URL.createObjectURL(blob), link = document.createElement('a')
      urls.set(url, window.setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url) }, 1000))
      link.href = url; link.download = filename; document.body.append(link)
      try { link.click() } finally { link.remove() }
    },
    dispose,
  }
}
