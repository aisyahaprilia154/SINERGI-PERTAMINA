import { downloadSchematicPng, downloadSchematicSvg } from './schematic-export.js'
import { renderSchematicSvg } from './schematic-svg.js'

export function openSchematicDialog({
  diagrams,
  activeContext,
  selectedAssetId = null,
  onSelectAsset,
}) {
  const dialog = document.createElement('dialog')
  dialog.className = 'schematic-dialog'

  dialog.innerHTML = `
    <div class="schematic-shell">
      <header class="schematic-header">
        <div>
          <span class="eyebrow">DIAGRAM SKEMATIK 2D</span>
          <h2 class="schematic-current-title">Peta jaringan lengkap</h2>
          <p class="schematic-current-meta"></p>
        </div>
        <button class="icon-button close-schematic" type="button" aria-label="Tutup diagram">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </header>

      <div class="schematic-mode-bar">
        <div class="schematic-mode-switch" role="tablist" aria-label="Cakupan diagram">
          <button class="schematic-mode-option active" type="button" role="tab"
            data-schematic-mode="full-map" aria-selected="true">
            <span class="material-symbols-outlined" aria-hidden="true">hub</span>
            <span><strong>Peta penuh</strong><small>Seluruh koneksi dataset aktif</small></span>
          </button>
          <button class="schematic-mode-option" type="button" role="tab"
            data-schematic-mode="trace" aria-selected="false">
            <span class="material-symbols-outlined" aria-hidden="true">conversion_path</span>
            <span><strong>Jalur terpilih</strong><small>Hanya hasil tracing aktif</small></span>
          </button>
        </div>
      </div>

      <div class="schematic-toolbar">
        <div class="schematic-tool-group" aria-label="Kontrol tampilan diagram">
          <button class="icon-button diagram-zoom-out" type="button" aria-label="Perkecil diagram">
            <span class="material-symbols-outlined" aria-hidden="true">remove</span>
          </button>
          <button class="diagram-zoom-level" type="button" aria-label="Fit diagram">100%</button>
          <button class="icon-button diagram-zoom-in" type="button" aria-label="Perbesar diagram">
            <span class="material-symbols-outlined" aria-hidden="true">add</span>
          </button>
          <button class="tool-button diagram-fit" type="button">
            <span class="material-symbols-outlined" aria-hidden="true">fit_screen</span>
            <span>Fit diagram</span>
          </button>
          <button class="tool-button diagram-reset" type="button">
            <span class="material-symbols-outlined" aria-hidden="true">restart_alt</span>
            <span>Reset tampilan</span>
          </button>
        </div>
        <span class="schematic-readonly">
          <span class="material-symbols-outlined" aria-hidden="true">lock</span>
          Read-only
        </span>
      </div>

      <div class="schematic-board" aria-label="Preview diagram skematik" tabindex="0"></div>

      <footer class="schematic-footer">
        <p>Posisi relatif dan arah koneksi mengikuti peta. Diagram tidak mengubah koordinat sumber.</p>
        <div>
          <button class="button secondary close-schematic" type="button">Kembali ke peta</button>
          <button class="button secondary export-svg" type="button">
            <span class="material-symbols-outlined" aria-hidden="true">code</span>
            Export SVG
          </button>
          <button class="button primary export-png" type="button">
            <span class="material-symbols-outlined" aria-hidden="true">image</span>
            Export PNG
          </button>
        </div>
        <span class="schematic-export-status" role="status" aria-live="polite"></span>
      </footer>
    </div>
  `

  document.body.append(dialog)
  dialog.showModal()
  bindDialogEvents({
    dialog,
    diagrams,
    activeContext,
    selectedAssetId,
    onSelectAsset,
  })
}

function bindDialogEvents({
  dialog,
  diagrams,
  activeContext,
  selectedAssetId,
  onSelectAsset,
}) {
  const board = dialog.querySelector('.schematic-board')
  const zoomLabel = dialog.querySelector('.diagram-zoom-level')
  const exportStatus = dialog.querySelector('.schematic-export-status')
  const exportSvgButton = dialog.querySelector('.export-svg')
  const exportPngButton = dialog.querySelector('.export-png')
  const viewControlButtons = dialog.querySelectorAll(
    '.diagram-zoom-out, .diagram-zoom-in, .diagram-zoom-level, .diagram-fit, .diagram-reset',
  )
  let currentMode = 'full-map'
  let currentSelectedAssetId = selectedAssetId
  let zoom = 1

  const getCurrentDiagram = () => diagrams[currentMode]
  const getCurrentSvg = () => board.querySelector('.schematic-svg')
  const isCurrentReady = () => {
    const current = getCurrentDiagram()
    return current?.graph.status === 'ready' && current?.layout.status === 'ready'
  }

  const applyZoom = () => {
    const svg = getCurrentSvg()
    if (!svg) return
    svg.style.width = `${Math.round(zoom * 100)}%`
    svg.style.height = 'auto'
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`
  }

  const fitDiagram = () => {
    zoom = 1
    applyZoom()
    board.scrollTo({ top: 0, left: 0 })
  }

  const selectDiagramAsset = (assetId) => {
    if (!assetId) return
    const svg = getCurrentSvg()
    svg?.querySelectorAll('.diagram-node.selected')
      .forEach((node) => node.classList.remove('selected'))
    const selectedNode = [...(svg?.querySelectorAll('[data-asset-id]') || [])]
      .find((node) => node.dataset.assetId === assetId)
    selectedNode?.classList.add('selected')
    currentSelectedAssetId = assetId
    onSelectAsset?.(assetId)
  }

  const renderCurrentDiagram = () => {
    const current = getCurrentDiagram()
    const ready = isCurrentReady()
    const graph = current?.graph || {
      status: 'empty',
      mode: currentMode,
      message: 'Diagram belum tersedia.',
    }

    dialog.querySelector('.schematic-current-title').textContent =
      ready ? graph.title : 'Diagram belum dapat dibuat'
    dialog.querySelector('.schematic-current-meta').textContent = ready
      ? `${current.layout.nodes.length} aset · ${describeMode(graph.mode)} · dataset ${activeContext.version}`
      : 'Periksa cakupan data diagram.'

    board.innerHTML = ready
      ? `<div class="schematic-viewport">
          ${renderSchematicSvg({
            graph,
            layout: current.layout,
            context: activeContext,
            selectedAssetId: currentSelectedAssetId,
          })}
        </div>`
      : renderDiagramState(graph)

    dialog.querySelectorAll('[data-schematic-mode]').forEach((button) => {
      const selected = button.dataset.schematicMode === currentMode
      button.classList.toggle('active', selected)
      button.setAttribute('aria-selected', String(selected))
    })
    viewControlButtons.forEach((button) => {
      button.disabled = !ready
    })
    exportSvgButton.disabled = !ready
    exportPngButton.disabled = !ready
    exportStatus.textContent = ''
    zoom = 1
    applyZoom()
  }

  dialog.querySelectorAll('.close-schematic')
    .forEach((button) => button.addEventListener('click', () => dialog.close()))
  dialog.querySelectorAll('[data-schematic-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      currentMode = button.dataset.schematicMode
      renderCurrentDiagram()
    })
  })
  dialog.querySelector('.diagram-zoom-in').addEventListener('click', () => {
    zoom = Math.min(2, zoom + .2)
    applyZoom()
  })
  dialog.querySelector('.diagram-zoom-out').addEventListener('click', () => {
    zoom = Math.max(.6, zoom - .2)
    applyZoom()
  })
  dialog.querySelector('.diagram-zoom-level').addEventListener('click', fitDiagram)
  dialog.querySelector('.diagram-fit').addEventListener('click', fitDiagram)
  dialog.querySelector('.diagram-reset').addEventListener('click', () => {
    fitDiagram()
    selectDiagramAsset(currentSelectedAssetId)
  })

  board.addEventListener('click', (event) => {
    const node = event.target.closest('.diagram-node')
    if (node) selectDiagramAsset(node.dataset.assetId)
  })
  board.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const node = event.target.closest('.diagram-node')
    if (!node) return
    event.preventDefault()
    selectDiagramAsset(node.dataset.assetId)
  })

  exportSvgButton.addEventListener('click', () => {
    const current = getCurrentDiagram()
    const svg = getCurrentSvg()
    if (!svg || !current) return
    downloadSchematicSvg(svg, `${createFilename(current.graph, activeContext)}.svg`)
    exportStatus.textContent = 'File SVG berhasil disiapkan.'
  })
  exportPngButton.addEventListener('click', async () => {
    const current = getCurrentDiagram()
    const svg = getCurrentSvg()
    if (!svg || !current) return
    exportPngButton.disabled = true
    exportStatus.textContent = 'Menyiapkan PNG…'
    try {
      await downloadSchematicPng(svg, `${createFilename(current.graph, activeContext)}.png`)
      exportStatus.textContent = 'File PNG berhasil disiapkan.'
    } catch (error) {
      exportStatus.textContent = error.message
    } finally {
      exportPngButton.disabled = false
    }
  })

  dialog.addEventListener('close', () => dialog.remove())
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close()
  })

  renderCurrentDiagram()
}

function renderDiagramState(graph) {
  const isTooDense = graph.status === 'too-dense'
  return `
    <div class="schematic-state ${isTooDense ? 'warning' : ''}" role="alert">
      <span class="material-symbols-outlined" aria-hidden="true">
        ${isTooDense ? 'density_large' : 'account_tree_off'}
      </span>
      <strong>${isTooDense ? 'Cakupan diagram terlalu luas' : 'Data diagram belum tersedia'}</strong>
      <p>${escapeHtml(graph.message || 'Pilih aset atau jalankan tracing terlebih dahulu.')}</p>
      ${isTooDense ? `<small>${graph.nodeCount} aset dipilih · batas ${graph.maxNodes} aset</small>` : ''}
    </div>
  `
}

function describeMode(mode) {
  if (mode === 'trace') return 'jalur terpilih'
  if (mode === 'full-map') return 'peta jaringan lengkap'
  if (mode === 'focus') return 'aset fokus dan relasi langsung'
  return 'jaringan terpilih'
}

function createFilename(graph, context) {
  const mode = graph.mode || 'network'
  return `sinergi-diagram-${context.branchId}-${mode}-${context.version}`
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/g, '-')
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
