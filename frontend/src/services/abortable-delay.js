export function abortableDelay(signal, milliseconds = 1200) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => { window.clearTimeout(timer); reject(signal.reason) }
    const timer = window.setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, milliseconds)
    signal.addEventListener('abort', abort, { once: true })
  })
}
