import { downloadSchematicPng, downloadSchematicSvg } from './schematic-export.js'
import { renderSchematicSvg } from './schematic-svg.js'

export function openSchematicDialog({
  diagrams,
  activeContext,
  selectedAssetId = null,
  initialMode = 'all-assets',
  onSelectAsset,
}) {
  const dialog = document.createElement('dialog')
  dialog.className = 'schematic-dialog'

  dialog.innerHTML = `
    <div class="schematic-shell">
      <header class="schematic-header">
        <div>
          <span class="eyebrow">DIAGRAM SKEMATIK 2D</span>
          <h2 class="schematic-current-title">Seluruh aset</h2>
          <p class="schematic-current-meta"></p>
        </div>
        <button class="icon-button close-schematic" type="button" aria-label="Tutup diagram">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </header>

      <div class="schematic-mode-bar">
        <div class="schematic-mode-switch" role="tablist" aria-label="Cakupan diagram">
          <button class="schematic-mode-option active" type="button" role="tab"
            data-schematic-mode="all-assets" aria-selected="true">
            <span class="material-symbols-outlined" aria-hidden="true">hub</span>
            <span><strong>Seluruh aset</strong><small>Semua aset pada area aktif</small></span>
          </button>
          <button class="schematic-mode-option" type="button" role="tab"
            data-schematic-mode="selected" aria-selected="false"
            ${selectedAssetId ? '' : 'disabled title="Pilih satu aset pada peta untuk melihat relasinya."'}>
            <span class="material-symbols-outlined" aria-hidden="true">conversion_path</span>
            <span><strong>Jalur terpilih</strong><small>Relasi langsung dari aset yang dipilih</small></span>
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

      <div class="schematic-content">
        <div class="schematic-board" aria-label="Preview diagram skematik" tabindex="0"></div>
        <aside class="schematic-summary" aria-label="Ringkasan aset"></aside>
      </div>

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
    initialMode,
    onSelectAsset,
  })
}

function bindDialogEvents({
  dialog,
  diagrams,
  activeContext,
  selectedAssetId,
  initialMode,
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
  let currentMode = initialMode === 'selected' && selectedAssetId && diagrams.selected
    ? 'selected'
    : 'all-assets'
  let currentSelectedAssetId = selectedAssetId
  let zoom = 1

  const getCurrentDiagram = () => diagrams[currentMode]
  const getCurrentSvg = () => board.querySelector('.schematic-svg')
  const isCurrentReady = () => {
    const current = getCurrentDiagram()
    return current?.graph.status === 'ready' && current?.layout.status === 'ready'
  }

  const availableViewport = () => ({
    width: Math.max(board.clientWidth - 32, 240),
    height: Math.max(board.clientHeight - 32, 180),
  })

  const fitScale = () => {
    const svg = getCurrentSvg()
    if (!svg) return 1
    const viewBox = svg.viewBox.baseVal
    const available = availableViewport()
    return Math.min(1, available.width / viewBox.width, available.height / viewBox.height)
  }

  const applyZoom = () => {
    const svg = getCurrentSvg()
    if (!svg) return
    const viewBox = svg.viewBox.baseVal
    const available = availableViewport()
    const scale = Math.max(.1, zoom)
    svg.style.width = `${Math.max(1, Math.round(viewBox.width * scale))}px`
    svg.style.height = `${Math.max(1, Math.round(viewBox.height * scale))}px`
    svg.style.margin = viewBox.width * scale <= available.width ? '0 auto' : '0'
    zoomLabel.textContent = `${Math.round(scale * 100)}%`
  }

  const fitDiagram = () => {
    zoom = fitScale()
    applyZoom()
    board.scrollTo({ top: 0, left: 0 })
  }

  const positionAtFocus = () => {
    const current = getCurrentDiagram()
    const svg = getCurrentSvg()
    if (!current || !svg) return
    const focusId = current.layout.focusNodeId || current.graph.anchorAssetId
    const focus = current.layout.nodes.find((node) => node.id === focusId)
    if (!focus) return
    const available = availableViewport()
    const centerX = (focus.diagram.x + focus.diagram.width / 2) * zoom
    const centerY = (focus.diagram.y + focus.diagram.height / 2) * zoom
    board.scrollTo({
      left: Math.max(0, centerX - available.width / 2),
      top: Math.max(0, centerY - available.height / 2),
    })
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
    if (ready) {
      dialog.querySelector('.schematic-current-meta').textContent = formatDiagramMeta(
        graph,
        current.layout,
        activeContext,
      )
    }

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

    dialog.querySelector('.schematic-summary').innerHTML = ready
      ? renderDiagramSummary(graph, current.layout)
      : ''

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
    zoom = current.layout.defaultZoom ?? (graph.mode === 'selected' ? 1 : .62)
    applyZoom()
    positionAtFocus()
    requestAnimationFrame(positionAtFocus)
  }

  dialog.querySelectorAll('.close-schematic')
    .forEach((button) => button.addEventListener('click', () => dialog.close()))
  dialog.querySelectorAll('[data-schematic-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.disabled) return
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
    const current = getCurrentDiagram()
    const graph = current?.graph
    zoom = current?.layout?.defaultZoom ?? (graph?.mode === 'selected' ? 1 : .62)
    applyZoom()
    positionAtFocus()
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

function renderDiagramSummary(graph, layout) {
  const counts = graph.categorySummary || layout.nodes.reduce((summary, node) => {
    const label = node.type || 'Aset lainnya'
    summary[label] = (summary[label] || 0) + 1
    return summary
  }, {})
  const isolatedCount = graph.isolatedNodeIds?.length || 0
  return `
    <section class="schematic-summary-card">
      <h3>Ringkasan aset</h3>
      <ul>${Object.entries(counts).map(([label, count]) => `
        <li><span>${escapeHtml(label)}</span><strong>${count}</strong></li>
      `).join('')}</ul>
      <div class="schematic-summary-total"><span>Total aset</span><strong>${layout.nodes.length}</strong></div>
      <div class="schematic-summary-total"><span>Total koneksi</span><strong>${graph.relationCount ?? layout.edges.length}</strong></div>
    </section>
    ${graph.mode === 'all-assets' ? `
      <section class="schematic-summary-card ${isolatedCount ? '' : 'is-clear'}">
        <div class="schematic-summary-card-heading"><h3>Aset tanpa relasi</h3><strong>${isolatedCount}</strong></div>
        <p>${isolatedCount ? `${isolatedCount} aset tidak memiliki koneksi terkonfirmasi.` : 'Tidak ada aset tanpa relasi.'}</p>
      </section>
    ` : ''}
  `
}

function formatDiagramMeta(graph, layout, context) {
  if (graph.mode === 'selected') {
    return `${graph.neighborCount ?? Math.max(0, layout.nodes.length - 1)} aset terhubung langsung · `
      + `${context.branchName} · Dataset ${context.version} · Read-only`
  }
  return `${layout.nodes.length} aset · ${graph.relationCount ?? layout.edges.length} `
    + `koneksi terkonfirmasi · ${context.branchName} · Dataset ${context.version} · Read-only`
}

function describeMode(mode) {
  if (mode === 'selected') return 'relasi aset terpilih'
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
