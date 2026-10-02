import { assetIconUrl, assetIconGlyph } from '../../domain/asset-icon.js'

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

export function bindAssetIconControl(drawer, { asset, sourceIconDataByUrl, onSave }) {
  const controller = new AbortController()
  const options = { signal: controller.signal }
  const trigger = drawer.querySelector('[data-asset-icon-trigger]')
  const menu = drawer.querySelector('#asset-icon-actions')
  const control = drawer.querySelector('.asset-icon-control')
  if (!trigger || !menu) return () => controller.abort()
  const closeMenu = (restoreFocus = false) => {
    menu.hidden = true
    trigger.setAttribute('aria-expanded', 'false')
    if (restoreFocus) trigger.focus()
  }
  trigger.addEventListener('click', () => {
    menu.hidden = !menu.hidden
    trigger.setAttribute('aria-expanded', String(!menu.hidden))
    if (!menu.hidden) menu.querySelector('button')?.focus()
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
  const open = mode => {
    closeMenu()
    openAssetIconEditor({ asset, mode, onSave,
      currentIcon: sourceIconDataByUrl?.get(assetIconUrl(asset)),
      onClose: () => drawer.querySelector('[data-asset-icon-trigger]')?.focus() })
  }
  drawer.querySelector('[data-change-asset-icon]')?.addEventListener('click', () => open('replace'), options)
  drawer.querySelector('[data-reset-asset-icon]')?.addEventListener('click', () => open('reset'), options)
  return () => controller.abort()
}

export function openAssetIconEditor({ asset, mode = 'replace', currentIcon, onSave, onClose }) {
  const dialog = document.createElement('dialog')
  dialog.className = 'asset-icon-dialog'
  dialog.setAttribute('aria-labelledby', 'asset-icon-dialog-title')
  const reset = mode === 'reset'
  let dataUrl = null
  let saving = false
  let closed = false
  let fileRequest = 0
  dialog.innerHTML = `<header class="asset-icon-dialog-header">
    <div><h2 id="asset-icon-dialog-title">${reset ? 'Hapus ikon?' : 'Ganti ikon'}</h2><p>${escapeHtml(asset.name || asset.id)}</p></div>
    <button class="icon-button" type="button" data-close-icon-editor aria-label="Tutup pengaturan ikon"><span class="material-symbols-outlined" aria-hidden="true">close</span></button>
  </header>
  <div class="asset-icon-dialog-content">
    <div class="asset-icon-dialog-preview">${currentIcon ? `<img src="${escapeHtml(currentIcon)}" alt="Ikon aset saat ini">` : `<span class="material-symbols-outlined" aria-hidden="true">${assetIconGlyph(asset)}</span>`}</div>
    ${reset ? '<p class="asset-icon-reset-copy">Ikon aset akan kembali ke ikon bawaan.</p>' : `<button type="button" class="asset-icon-choose" data-choose-icon>Pilih gambar</button>
      <input type="file" data-icon-file accept="image/png,image/jpeg,image/webp" hidden>
      <p class="asset-icon-file-name" data-icon-file-name hidden></p>
      <p class="asset-icon-format-hint">PNG, JPG, atau WebP · Maks. 5 MB</p>`}
    <p class="asset-icon-editor-error" data-icon-editor-error role="alert" hidden></p>
  </div>
  <footer class="asset-icon-dialog-footer">
    <button class="button secondary" type="button" data-close-icon-editor>Batal</button>
    <button class="button primary${reset ? ' asset-icon-reset' : ''}" type="button" data-save-icon ${reset ? '' : 'disabled'}>${reset ? 'Hapus ikon' : 'Simpan'}</button>
  </footer>`
  document.body.append(dialog)
  const save = dialog.querySelector('[data-save-icon]')
  const input = dialog.querySelector('[data-icon-file]')
  const errorLabel = dialog.querySelector('[data-icon-editor-error]')
  const showError = message => { errorLabel.textContent = message; errorLabel.hidden = false }
  const close = () => { if (!saving) dialog.close() }
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault() })
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') event.stopPropagation() })
  dialog.addEventListener('close', () => { closed = true; fileRequest++; dialog.remove(); onClose?.() }, { once: true })
  dialog.querySelectorAll('[data-close-icon-editor]').forEach(button => button.addEventListener('click', close))
  dialog.querySelector('[data-choose-icon]')?.addEventListener('click', () => input.click())
  input?.addEventListener('change', async () => {
    const file = input.files?.[0]
    if (!file) return
    const request = ++fileRequest
    dataUrl = null
    save.disabled = true
    errorLabel.hidden = true
    try {
      const prepared = await prepareAssetIcon(file)
      if (closed || request !== fileRequest) return
      dataUrl = prepared
      const preview = dialog.querySelector('.asset-icon-dialog-preview')
      preview.innerHTML = '<img alt="Preview ikon baru">'
      preview.querySelector('img').src = dataUrl
      const name = dialog.querySelector('[data-icon-file-name]')
      name.textContent = file.name
      name.hidden = false
      dialog.querySelector('[data-choose-icon]').textContent = 'Pilih gambar lain'
      save.disabled = false
      save.focus()
    } catch (error) {
      if (!closed && request === fileRequest) showError(error.message)
    }
  })
  save.addEventListener('click', async () => {
    if (saving || (!reset && !dataUrl)) return
    saving = true
    errorLabel.hidden = true
    dialog.setAttribute('aria-busy', 'true')
    dialog.querySelectorAll('button').forEach(button => { button.disabled = true })
    save.textContent = reset ? 'Menghapus…' : 'Menyimpan…'
    try {
      await onSave(reset ? null : dataUrl)
      saving = false
      dialog.close()
    } catch (error) {
      saving = false
      dialog.removeAttribute('aria-busy')
      dialog.querySelectorAll('button').forEach(button => { button.disabled = false })
      save.textContent = reset ? 'Hapus ikon' : 'Simpan'
      showError(error.message || 'Ikon belum dapat disimpan. Coba lagi.')
    }
  })
  dialog.showModal()
  if (!reset) dialog.querySelector('[data-choose-icon]')?.focus()
  return dialog
}

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}
