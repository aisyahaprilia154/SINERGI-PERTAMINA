import { downloadSchematicPng, downloadSchematicSvg } from './schematic-export.js'
import { calculateFitScale } from './schematic-layout.js'
import { renderSchematicSvg } from './schematic-svg.js'

export function openSchematicDialog({ diagrams, activeContext, selectedAssetId = null, onSelectAsset, initialMode = 'network' }) {
  const dialog = document.createElement('dialog')
  dialog.className = 'schematic-dialog'
  dialog.innerHTML = `
    <div class="schematic-shell">
      <header class="schematic-header"><div><span class="eyebrow">DIAGRAM TOPOLOGI 2D</span><h2 class="schematic-current-title">Topologi jaringan</h2><p class="schematic-current-meta"></p></div><button class="icon-button close-schematic" type="button" aria-label="Tutup diagram"><span class="material-symbols-outlined" aria-hidden="true">close</span></button></header>
      <div class="schematic-mode-bar"><div class="schematic-mode-switch" role="tablist" aria-label="Cakupan diagram">
        <button class="schematic-mode-option active" type="button" role="tab" data-schematic-mode="network"><span class="material-symbols-outlined">hub</span><span><strong>Topologi jaringan</strong><small>Satu komponen jaringan terkonfirmasi</small></span></button>
        <button class="schematic-mode-option" type="button" role="tab" data-schematic-mode="trace"><span class="material-symbols-outlined">conversion_path</span><span><strong>Jalur terpilih</strong><small>Tampilkan path end-to-end</small></span></button>
      </div></div>
      <div class="schematic-toolbar"><div class="schematic-tool-group">
        <button class="icon-button diagram-zoom-out" type="button" aria-label="Perkecil"><span class="material-symbols-outlined">remove</span></button>
        <button class="icon-button diagram-zoom-in" type="button" aria-label="Perbesar"><span class="material-symbols-outlined">add</span></button>
        <button class="tool-button diagram-fit" type="button"><span class="material-symbols-outlined">fit_screen</span><span>Fit diagram</span></button>
        <button class="tool-button diagram-reset" type="button"><span class="material-symbols-outlined">restart_alt</span><span>Reset tampilan</span></button>
        <span class="diagram-zoom-level">100%</span>
      </div><span class="schematic-readonly"><span class="material-symbols-outlined">lock</span>Read-only</span></div>
      <div class="schematic-content"><div class="schematic-board" aria-label="Preview diagram topologi" tabindex="0"></div><aside class="schematic-summary" aria-live="polite"></aside></div>
      <footer class="schematic-footer"><p><span class="material-symbols-outlined">info</span> Diagram bersifat skematik dan tidak merepresentasikan skala geografis.</p><div>
        <label class="png-scale">PNG <select aria-label="Skala PNG"><option value="1">1x</option><option value="2" selected>2x</option><option value="4">4x</option></select></label>
        <button class="button secondary export-svg" type="button"><span class="material-symbols-outlined">code</span>Export SVG</button>
        <button class="button primary export-png" type="button"><span class="material-symbols-outlined">image</span>Export PNG</button>
      </div><span class="schematic-export-status" role="status"></span></footer>
    </div>`
  document.body.append(dialog)
  dialog.showModal()
  bindDialogEvents({ dialog, diagrams, activeContext, selectedAssetId, onSelectAsset, initialMode })
}

function bindDialogEvents({ dialog, diagrams, activeContext, selectedAssetId, onSelectAsset, initialMode }) {
  const board = dialog.querySelector('.schematic-board')
  const summary = dialog.querySelector('.schematic-summary')
  const zoomLabel = dialog.querySelector('.diagram-zoom-level')
  const exportStatus = dialog.querySelector('.schematic-export-status')
  const exportSvg = dialog.querySelector('.export-svg')
  const exportPng = dialog.querySelector('.export-png')
  let currentMode = diagrams[initialMode] ? initialMode : 'network'
  let selectedId = selectedAssetId
  let scale = 1
  let panStart = null

  const current = () => diagrams[currentMode]
  const ready = () => current()?.graph.status === 'ready' && current()?.layout.status === 'ready'
  const svg = () => board.querySelector('.schematic-svg')
  const applyScale = () => {
    const element = svg()
    if (!element) return
    element.style.width = `${Math.round(current().layout.width * scale)}px`
    element.style.height = `${Math.round(current().layout.height * scale)}px`
    zoomLabel.textContent = `${Math.round(scale * 100)}%`
  }
  const fit = () => {
    if (!ready()) return
    scale = calculateFitScale({ viewportWidth: board.clientWidth, viewportHeight: board.clientHeight, contentWidth: current().layout.width, contentHeight: current().layout.height })
    applyScale()
    board.scrollTo({ left: 0, top: 0 })
  }
  const render = () => {
    const item = current() || { graph: { status: 'empty', message: 'Diagram belum tersedia.', nodeCount: 0 } }
    const isReady = ready()
    dialog.querySelector('.schematic-current-title').textContent = isReady ? item.graph.title : 'Diagram koneksi belum tersedia'
    dialog.querySelector('.schematic-current-meta').textContent = isReady
      ? `Site: ${activeContext.branchName} · Dataset: ${activeContext.version} · ${item.graph.summary.nodeCount} aset · Read-only`
      : `${item.graph.nodeCount || 0} aset pada cakupan aktif`
    board.innerHTML = isReady ? `<div class="schematic-viewport">${renderSchematicSvg({ graph: item.graph, layout: item.layout, context: activeContext, selectedAssetId: selectedId })}</div>` : renderEmpty(item.graph, activeContext)
    summary.innerHTML = isReady ? renderSummary(item.graph) : ''
    dialog.querySelectorAll('[data-schematic-mode]').forEach((button) => {
      const active = button.dataset.schematicMode === currentMode
      button.classList.toggle('active', active)
      button.setAttribute('aria-selected', String(active))
      if (button.dataset.schematicMode === 'trace') button.disabled = diagrams.trace?.graph.status !== 'ready'
    })
    dialog.querySelectorAll('.diagram-zoom-out,.diagram-zoom-in,.diagram-fit,.diagram-reset').forEach((button) => { button.disabled = !isReady })
    exportSvg.disabled = !isReady
    exportPng.disabled = !isReady
    exportStatus.textContent = ''
    requestAnimationFrame(fit)
  }

  dialog.querySelector('.close-schematic').addEventListener('click', () => dialog.close())
  dialog.querySelectorAll('[data-schematic-mode]').forEach((button) => button.addEventListener('click', () => { currentMode = button.dataset.schematicMode; render() }))
  dialog.querySelector('.diagram-zoom-in').addEventListener('click', () => { scale = Math.min(2.5, scale + .15); applyScale() })
  dialog.querySelector('.diagram-zoom-out').addEventListener('click', () => { scale = Math.max(.35, scale - .15); applyScale() })
  dialog.querySelector('.diagram-fit').addEventListener('click', fit)
  dialog.querySelector('.diagram-reset').addEventListener('click', () => { scale = 1; applyScale(); board.scrollTo({ left: 0, top: 0 }) })
  board.addEventListener('wheel', (event) => {
    if (!ready() || !event.ctrlKey) return
    event.preventDefault()
    const previousScale = scale
    scale = Math.max(.35, Math.min(2.5, scale + (event.deltaY < 0 ? .1 : -.1)))
    const bounds = board.getBoundingClientRect()
    const pointerX = event.clientX - bounds.left + board.scrollLeft
    const pointerY = event.clientY - bounds.top + board.scrollTop
    applyScale()
    const ratio = scale / previousScale
    board.scrollLeft = pointerX * ratio - (event.clientX - bounds.left)
    board.scrollTop = pointerY * ratio - (event.clientY - bounds.top)
  }, { passive: false })
  board.addEventListener('pointerdown', (event) => {
    if (!ready() || event.target.closest('.diagram-node,.diagram-edge')) return
    panStart = { x: event.clientX, y: event.clientY, left: board.scrollLeft, top: board.scrollTop }
    board.classList.add('panning')
    board.setPointerCapture(event.pointerId)
  })
  board.addEventListener('pointermove', (event) => {
    if (!panStart) return
    board.scrollLeft = panStart.left - (event.clientX - panStart.x)
    board.scrollTop = panStart.top - (event.clientY - panStart.y)
  })
  const stopPanning = () => { panStart = null; board.classList.remove('panning') }
  board.addEventListener('pointerup', stopPanning)
  board.addEventListener('pointercancel', stopPanning)
  board.addEventListener('click', (event) => {
    const node = event.target.closest('.diagram-node')
    if (node && !node.dataset.assetId.startsWith('aggregate:')) { selectedId = node.dataset.assetId; onSelectAsset?.(selectedId); render() }
    const edge = event.target.closest('.diagram-edge')
    if (edge) summary.querySelector('.schematic-edge-detail').textContent = edge.querySelector('title')?.textContent || 'Relasi terkonfirmasi'
    if (event.target.closest('[data-close-empty]')) dialog.close()
  })
  exportSvg.addEventListener('click', () => { if (!ready()) return; downloadSchematicSvg(svg(), `${filename(current().graph, activeContext)}.svg`); exportStatus.textContent = 'SVG berhasil disiapkan.' })
  exportPng.addEventListener('click', async () => {
    if (!ready()) return
    exportPng.disabled = true
    exportStatus.textContent = 'Menyiapkan PNG…'
    try { await downloadSchematicPng(svg(), `${filename(current().graph, activeContext)}.png`, Number(dialog.querySelector('.png-scale select').value)); exportStatus.textContent = 'PNG berhasil disiapkan.' }
    catch (error) { exportStatus.textContent = error.message }
    finally { exportPng.disabled = false }
  })
  dialog.addEventListener('close', () => dialog.remove())
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close() })
  render()
}

function renderSummary(graph) {
  return `<section><h3>Ringkasan aset</h3><dl>${graph.summary.typeCounts.map(({ type, count }) => `<div><dt>${escapeHtml(type)}</dt><dd>${count}</dd></div>`).join('')}<div><dt>Total koneksi</dt><dd>${graph.summary.connectionCount}</dd></div></dl></section>
    <section><h3>Aset terisolasi <span>${graph.isolatedNodes.length}</span></h3><p>${graph.isolatedNodes.length ? `${graph.isolatedNodes.length} aset tidak masuk ke komponen ini.` : 'Tidak ada aset terisolasi.'}</p></section>
    <section><h3>Detail relasi</h3><p class="schematic-edge-detail">Pilih garis untuk melihat status relasi.</p></section>`
}

function renderEmpty(graph, context) {
  const reviewUrl = `/admin/topology-review?datasetId=${encodeURIComponent(context.datasetId || '')}&branchId=${encodeURIComponent(context.branchId || '')}`
  return `<div class="schematic-state" role="alert"><span class="material-symbols-outlined">account_tree_off</span><strong>Diagram koneksi belum tersedia</strong><p>${escapeHtml(graph.message || `${graph.nodeCount || 0} aset ditemukan, tetapi belum ada relasi yang telah dikonfirmasi.`)}</p><div><button class="button secondary" data-close-empty type="button">Lihat aset di peta</button><button class="button secondary" data-close-empty type="button">Pilih aset lain</button><a class="button secondary" href="${escapeHtml(reviewUrl)}">Review koneksi</a></div></div>`
}

function filename(graph, context) { return `sinergi-${context.branchId}-${graph.mode}-${context.version}`.toLowerCase().replaceAll(/[^a-z0-9-]+/g, '-') }
function escapeHtml(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;') }
