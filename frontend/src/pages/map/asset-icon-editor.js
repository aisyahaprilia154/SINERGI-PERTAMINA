const MAX_FILE_BYTES = 5 * 1024 * 1024

export function validateAssetIconFile(file) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('Pilih gambar PNG, JPG, atau WebP.')
  }
  if (!file.size || file.size > MAX_FILE_BYTES) throw new Error('Ukuran gambar maksimal 5 MB.')
}

export async function prepareAssetIcon(file) {
  validateAssetIconFile(file)
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode().catch(() => { throw new Error('Gambar tidak dapat dibaca. Pilih gambar lain.') })
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
    URL.revokeObjectURL(url)
  }
}

// Open synchronously from the menu click to preserve the browser's user gesture.
// Keep the input outside the drawer so a detail refresh cannot cancel selection.
export function chooseAssetIconFile() {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp'
    input.hidden = true
    const finish = file => {
      input.remove()
      resolve(file)
    }
    input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true })
    input.addEventListener('cancel', () => finish(null), { once: true })
    document.body.append(input)
    input.click()
  })
}

export function bindAssetIconControl(drawer, { onSave, prepareIcon = prepareAssetIcon }) {
  const controller = new AbortController()
  const options = { signal: controller.signal }
  const trigger = drawer.querySelector('[data-asset-icon-trigger]')
  const menu = drawer.querySelector('#asset-icon-actions')
  const control = drawer.querySelector('.asset-icon-control')
  if (!trigger || !menu) return () => controller.abort()
  const replace = drawer.querySelector('[data-change-asset-icon]')
  const remove = drawer.querySelector('[data-reset-asset-icon]')
  const feedback = drawer.querySelector('[data-asset-icon-feedback]')
  const canRemove = !remove?.disabled
  let busy = false
  const closeMenu = (restoreFocus = false) => {
    menu.hidden = true
    trigger.setAttribute('aria-expanded', 'false')
    if (restoreFocus) trigger.focus()
  }
  const showFeedback = (message, error = false) => {
    if (!feedback || controller.signal.aborted) return
    feedback.textContent = message
    feedback.hidden = !message
    feedback.classList.toggle('error', error)
    feedback.setAttribute('role', error ? 'alert' : 'status')
  }
  const setBusy = value => {
    busy = value
    trigger.disabled = value
    if (replace) replace.disabled = value
    if (remove) remove.disabled = value || !canRemove
    control.setAttribute('aria-busy', String(value))
  }
  trigger.addEventListener('click', () => {
    if (busy) return
    menu.hidden = !menu.hidden
    trigger.setAttribute('aria-expanded', String(!menu.hidden))
    if (!menu.hidden) menu.querySelector('button:not(:disabled)')?.focus()
  }, options)
  document.addEventListener('pointerdown', event => {
    if (!control.contains(event.target)) closeMenu()
  }, options)
  control.addEventListener('focusout', event => {
    if (!control.contains(event.relatedTarget)) closeMenu()
  }, options)
  control.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) {
      event.preventDefault()
      event.stopPropagation()
      closeMenu(true)
    }
  }, options)
  const run = async deleting => {
    if (busy || (deleting && !canRemove)) return
    closeMenu()
    setBusy(true)
    showFeedback('')
    try {
      let dataUrl = null
      if (!deleting) {
        const file = await chooseAssetIconFile()
        if (!file) return
        showFeedback('Menyimpan ikon…')
        dataUrl = await prepareIcon(file)
      } else showFeedback('Menghapus ikon…')
      await onSave(dataUrl)
      showFeedback(deleting ? 'Ikon dihapus.' : 'Ikon diperbarui.')
    } catch (error) {
      showFeedback(error.message || 'Ikon belum dapat disimpan. Coba lagi.', true)
    } finally {
      setBusy(false)
      if (!controller.signal.aborted) trigger.focus()
    }
  }
  replace?.addEventListener('click', () => { void run(false) }, options)
  remove?.addEventListener('click', () => { void run(true) }, options)
  return () => controller.abort()
}
