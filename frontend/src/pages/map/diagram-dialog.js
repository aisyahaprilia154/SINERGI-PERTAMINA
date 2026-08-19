import { downloadSchematicPng, downloadSchematicSvg } from './schematic-export.js'
import { renderSchematicSvg } from './schematic-svg.js'
import { getDefaultMapToken } from '../../services/active-dataset-service.js'
import {
  ALL_ASSET_FIT_MIN_ZOOM,
  calculateSchematicFitScale,
  MIN_SCHEMATIC_ZOOM,
} from './schematic-viewport.js'

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
        <div class="schematic-header-actions">
          <button class="icon-button close-schematic" type="button" aria-label="Tutup diagram">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
      </header>

      <div class="schematic-mode-bar">
        <div class="schematic-mode-switch" role="tablist" aria-label="Cakupan diagram">
          <button class="schematic-mode-option active" type="button" role="tab"
            data-schematic-mode="all-assets" aria-selected="true">
            <span class="material-symbols-outlined" aria-hidden="true">hub</span>
            <span><strong>Seluruh aset</strong><small>Semua aset pada area aktif</small></span>
          </button>
          <button class="schematic-mode-option" type="button" role="tab"
            data-schematic-mode="full-map" aria-selected="false">
            <span class="material-symbols-outlined" aria-hidden="true">account_tree</span>
            <span><strong>Topologi jaringan</strong><small>Relasi terkonfirmasi pada area aktif</small></span>
          </button>
          <button class="schematic-mode-option" type="button" role="tab"
            data-schematic-mode="trace" aria-selected="false">
            <span class="material-symbols-outlined" aria-hidden="true">conversion_path</span>
            <span><strong>Tracing aktif</strong><small>Hanya hasil tracing yang sedang dipilih</small></span>
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
          <button class="tool-button diagram-fullscreen" type="button"
            aria-label="Buka ruang kerja diagram layar penuh" aria-pressed="false">
            <span class="material-symbols-outlined" aria-hidden="true">fullscreen</span>
            <span class="diagram-fullscreen-label">Fullscreen</span>
          </button>
        </div>
        <div class="schematic-search" role="search">
          <span class="material-symbols-outlined" aria-hidden="true">search</span>
          <input class="diagram-search-input" type="search"
            placeholder="Cari ID atau nama aset" aria-label="Cari aset dalam diagram"
            autocomplete="off">
          <div class="diagram-search-results" role="listbox" hidden></div>
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
  const content = dialog.querySelector('.schematic-content')
  const summary = dialog.querySelector('.schematic-summary')
  const zoomLabel = dialog.querySelector('.diagram-zoom-level')
  const fullscreenButton = dialog.querySelector('.diagram-fullscreen')
  const shell = dialog.querySelector('.schematic-shell')
  const searchInput = dialog.querySelector('.diagram-search-input')
  const searchResults = dialog.querySelector('.diagram-search-results')
  const exportStatus = dialog.querySelector('.schematic-export-status')
  const exportSvgButton = dialog.querySelector('.export-svg')
  const exportPngButton = dialog.querySelector('.export-png')
  const viewControlButtons = dialog.querySelectorAll(
    '.diagram-zoom-out, .diagram-zoom-in, .diagram-zoom-level, .diagram-fit, .diagram-reset',
  )
  let currentMode = initialMode === 'selected' && selectedAssetId && diagrams.selected
    ? 'selected'
    : initialMode === 'trace' && diagrams.trace
      ? 'trace'
      : 'all-assets'
  let currentSelectedAssetId = selectedAssetId
  let zoom = 1
  let fallbackFullscreen = false
  let panState = null
  let isAutoFit = true
  let renderSequence = 0
  const sourceIconDataByUrl = new Map()
  const sourceIconPromises = new Map()

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
    const isAllAssets = getCurrentDiagram()?.graph?.mode === 'all-assets'
    return calculateSchematicFitScale({
      viewBoxWidth: viewBox.width,
      viewBoxHeight: viewBox.height,
      viewportWidth: available.width,
      viewportHeight: available.height,
      minZoom: isAllAssets ? ALL_ASSET_FIT_MIN_ZOOM : MIN_SCHEMATIC_ZOOM,
      // Full asset diagrams remain vertically scrollable so their nodes stay readable.
      preferWidth: isAllAssets,
    })
  }

  const applyZoom = () => {
    const svg = getCurrentSvg()
    if (!svg) return
    const viewBox = svg.viewBox.baseVal
    const available = availableViewport()
    const scale = Math.max(MIN_SCHEMATIC_ZOOM, zoom)
    svg.style.width = `${Math.max(1, Math.round(viewBox.width * scale))}px`
    svg.style.height = `${Math.max(1, Math.round(viewBox.height * scale))}px`
    svg.style.margin = viewBox.width * scale <= available.width ? '0 auto' : '0'
    zoomLabel.textContent = `${Math.round(scale * 100)}%`
  }

  const fitDiagram = () => {
    isAutoFit = true
    zoom = fitScale()
    applyZoom()
    board.scrollTo({ top: 0, left: 0 })
  }

  const centerNode = (assetId) => {
    const current = getCurrentDiagram()
    const node = current?.layout?.nodes?.find((item) => item.id === assetId)
    if (!node) return
    // Hasil pencarian harus cukup besar untuk dikenali, terutama ketika
    // keseluruhan diagram sedang dipasang ke viewport pada skala yang kecil.
    isAutoFit = false
    zoom = Math.max(zoom, .75)
    applyZoom()
    const available = availableViewport()
    const centerX = (node.diagram.x + node.diagram.width / 2) * zoom
    const centerY = (node.diagram.y + node.diagram.height / 2) * zoom
    board.scrollTo({
      left: Math.max(0, centerX - available.width / 2),
      top: Math.max(0, centerY - available.height / 2),
      behavior: 'smooth',
    })
  }

  const positionAtFocus = () => {
    const current = getCurrentDiagram()
    const svg = getCurrentSvg()
    if (!current || !svg) return
    if (current.graph.mode === 'all-assets') {
      board.scrollTo({ top: 0, left: 0 })
      return
    }
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
    const current = getCurrentDiagram()
    if (current?.graph.status === 'ready') {
      summary.innerHTML = renderDiagramSummary(
        current.graph,
        current.layout,
        currentSelectedAssetId,
      )
    }
    onSelectAsset?.(assetId)
  }

  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(reader.result))
    reader.addEventListener('error', () => reject(reader.error || new Error('Ikon aset gagal dibaca.')))
    reader.readAsDataURL(blob)
  })

  const loadSourceIcon = (url) => {
    if (!url) return Promise.resolve(null)
    if (sourceIconDataByUrl.has(url)) return Promise.resolve(sourceIconDataByUrl.get(url))
    if (sourceIconPromises.has(url)) return sourceIconPromises.get(url)
    const promise = (async () => {
      try {
        const token = getDefaultMapToken()
        const response = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (!response.ok) return null
        const dataUrl = await blobToDataUrl(await response.blob())
        sourceIconDataByUrl.set(url, dataUrl)
        return dataUrl
      } catch {
        return null
      } finally {
        sourceIconPromises.delete(url)
      }
    })()
    sourceIconPromises.set(url, promise)
    return promise
  }

  const preloadSourceIcons = async (diagram, sequence) => {
    const urls = [...new Set(
      (diagram?.layout?.nodes ?? []).map((node) => node.sourceIconUrl).filter(Boolean),
    )]
    if (!urls.length) return
    await Promise.all(urls.map(loadSourceIcon))
    if (sequence !== renderSequence || diagram !== getCurrentDiagram()) return
    renderCurrentDiagram({ preload: false })
  }

  const renderCurrentDiagram = ({ preload = true } = {}) => {
    const currentRenderSequence = ++renderSequence
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
            sourceIconDataByUrl,
          })}
        </div>`
      : renderDiagramState(graph)

    content.dataset.schematicMode = graph.mode
    summary.hidden = !ready
    summary.innerHTML = ready
      ? renderDiagramSummary(graph, current.layout, currentSelectedAssetId)
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
    zoom = graph.mode === 'all-assets'
      ? fitScale()
      : current.layout.defaultZoom ?? (graph.mode === 'selected' ? 1 : .62)
    applyZoom()
    positionAtFocus()
    requestAnimationFrame(positionAtFocus)
    if (ready && preload) void preloadSourceIcons(current, currentRenderSequence)
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
    isAutoFit = false
    zoom = Math.min(2.5, zoom + .15)
    applyZoom()
  })
  dialog.querySelector('.diagram-zoom-out').addEventListener('click', () => {
    isAutoFit = false
    zoom = Math.max(MIN_SCHEMATIC_ZOOM, zoom - .15)
    applyZoom()
  })
  dialog.querySelector('.diagram-zoom-level').addEventListener('click', fitDiagram)
  dialog.querySelector('.diagram-fit').addEventListener('click', fitDiagram)
  dialog.querySelector('.diagram-reset').addEventListener('click', () => {
    const current = getCurrentDiagram()
    const graph = current?.graph
    isAutoFit = false
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

  board.addEventListener('wheel', (event) => {
    if (!isCurrentReady()) return
    event.preventDefault()
    const rect = board.getBoundingClientRect()
    const pointerX = event.clientX - rect.left
    const pointerY = event.clientY - rect.top
    const sourceX = (board.scrollLeft + pointerX) / zoom
    const sourceY = (board.scrollTop + pointerY) / zoom
    isAutoFit = false
    zoom = Math.max(MIN_SCHEMATIC_ZOOM, Math.min(2.5, zoom + (event.deltaY < 0 ? .1 : -.1)))
    applyZoom()
    board.scrollLeft = Math.max(0, sourceX * zoom - pointerX)
    board.scrollTop = Math.max(0, sourceY * zoom - pointerY)
  }, { passive: false })

  board.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('.diagram-node')) return
    panState = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: board.scrollLeft,
      top: board.scrollTop,
    }
    board.setPointerCapture(event.pointerId)
    board.classList.add('is-panning')
  })
  board.addEventListener('pointermove', (event) => {
    if (!panState || event.pointerId !== panState.pointerId) return
    board.scrollLeft = panState.left - (event.clientX - panState.x)
    board.scrollTop = panState.top - (event.clientY - panState.y)
  })
  const endPan = (event) => {
    if (!panState || event.pointerId !== panState.pointerId) return
    panState = null
    board.classList.remove('is-panning')
  }
  board.addEventListener('pointerup', endPan)
  board.addEventListener('pointercancel', endPan)

  searchInput.addEventListener('input', () => {
    renderSearchResults({
      query: searchInput.value,
      nodes: getCurrentDiagram()?.layout?.nodes ?? [],
      container: searchResults,
    })
  })
  searchInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    const first = searchResults.querySelector('[data-search-asset-id]')
    if (!first) return
    event.preventDefault()
    first.click()
  })
  searchResults.addEventListener('click', (event) => {
    const option = event.target.closest('[data-search-asset-id]')
    if (!option) return
    const assetId = option.dataset.searchAssetId
    selectDiagramAsset(assetId)
    centerNode(assetId)
    searchInput.value = option.dataset.searchLabel || searchInput.value
    searchResults.hidden = true
  })
  searchInput.addEventListener('blur', () => {
    window.setTimeout(() => { searchResults.hidden = true }, 120)
  })

  const viewportSnapshot = () => ({
    x: (board.scrollLeft + board.clientWidth / 2) / zoom,
    y: (board.scrollTop + board.clientHeight / 2) / zoom,
    zoom,
  })
  let fullscreenViewport = null
  const restoreViewport = (snapshot) => requestAnimationFrame(() => {
    zoom = snapshot.zoom
    applyZoom()
    board.scrollLeft = Math.max(0, snapshot.x * zoom - board.clientWidth / 2)
    board.scrollTop = Math.max(0, snapshot.y * zoom - board.clientHeight / 2)
  })
  const syncFullscreenButton = () => {
    const active = document.fullscreenElement === shell || fallbackFullscreen
    fullscreenButton.setAttribute('aria-pressed', String(active))
    fullscreenButton.setAttribute(
      'aria-label',
      active ? 'Keluar dari layar penuh' : 'Buka diagram layar penuh',
    )
    fullscreenButton.querySelector('.material-symbols-outlined').textContent = active
      ? 'fullscreen_exit'
      : 'fullscreen'
    fullscreenButton.querySelector('.diagram-fullscreen-label').textContent = active
      ? 'Keluar fullscreen'
      : 'Fullscreen'
    if (fullscreenViewport) {
      if (isAutoFit) requestAnimationFrame(fitDiagram)
      else restoreViewport(fullscreenViewport)
      fullscreenViewport = null
    }
  }
  fullscreenButton.addEventListener('click', async () => {
    fullscreenViewport = viewportSnapshot()
    try {
      if (fallbackFullscreen) {
        fallbackFullscreen = false
        shell.classList.remove('schematic-shell-fullscreen')
        syncFullscreenButton()
      } else if (document.fullscreenElement === shell) await document.exitFullscreen()
      else if (shell.requestFullscreen) {
        await shell.requestFullscreen()
        window.setTimeout(() => {
          if (document.fullscreenElement === shell || fallbackFullscreen || !dialog.open) return
          fallbackFullscreen = true
          shell.classList.add('schematic-shell-fullscreen')
          syncFullscreenButton()
        }, 200)
      }
      else {
        fallbackFullscreen = !fallbackFullscreen
        shell.classList.toggle('schematic-shell-fullscreen', fallbackFullscreen)
        syncFullscreenButton()
      }
    } catch {
      fallbackFullscreen = !fallbackFullscreen
      shell.classList.toggle('schematic-shell-fullscreen', fallbackFullscreen)
      syncFullscreenButton()
    }
  })
  document.addEventListener('fullscreenchange', syncFullscreenButton)

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

  dialog.addEventListener('close', () => {
    document.removeEventListener('fullscreenchange', syncFullscreenButton)
    if (document.fullscreenElement === shell) document.exitFullscreen()?.catch?.(() => {})
    dialog.remove()
  })
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

function renderSearchResults({ query, nodes, container }) {
  const normalized = String(query || '').trim().toLowerCase()
  if (!normalized) {
    container.hidden = true
    container.innerHTML = ''
    return
  }
  const matches = nodes.filter((node) => (
    `${node.id} ${node.name} ${node.type}`.toLowerCase().includes(normalized)
  )).slice(0, 8)
  container.innerHTML = matches.length
    ? matches.map((node) => `
      <button type="button" role="option" data-search-asset-id="${escapeHtml(node.id)}"
        data-search-label="${escapeHtml(node.name || node.id)}">
        <strong>${escapeHtml(node.name || node.id)}</strong>
        <small>${escapeHtml(node.type || 'Aset')} · ${escapeHtml(resolutionText(node.resolutionStatus))}</small>
      </button>
    `).join('')
    : '<p>Tidak ada aset yang cocok.</p>'
  container.hidden = false
}

function renderDiagramSummary(graph, layout, selectedAssetId = null) {
  const counts = graph.categorySummary || layout.nodes.reduce((summary, node) => {
    const label = node.type || 'Aset lainnya'
    summary[label] = (summary[label] || 0) + 1
    return summary
  }, {})
  const isolatedCount = graph.isolatedNodeIds?.length || 0
  const diagnostics = graph.diagnostics
  const selectedNode = layout.nodes.find((node) => node.id === selectedAssetId)
  const selectedEdges = selectedNode
    ? graph.edges.filter((edge) => (
      edge.sourceId === selectedNode.id || edge.targetId === selectedNode.id
    ))
    : []
  return `
    <section class="schematic-summary-card">
      <h3>Ringkasan aset</h3>
      <ul>${Object.entries(counts).map(([label, count]) => `
        <li><span>${escapeHtml(label)}</span><strong>${count}</strong></li>
      `).join('')}</ul>
      <div class="schematic-summary-total"><span>Total aset</span><strong>${layout.nodes.length}</strong></div>
      <div class="schematic-summary-total"><span>Total relasi otomatis</span><strong>${layout.edges.length}</strong></div>
    </section>
    ${diagnostics ? `
      <section class="schematic-summary-card topology-diagnostics">
        <h3>Diagnostik topologi</h3>
        <ul>
          <li><span>Relasi otomatis</span><strong>${diagnostics.confirmedEdgeCount}</strong></li>
          <li><span>Aset terhubung</span><strong>${diagnostics.confirmedNodeCount}</strong></li>
          <li><span>Aset tanpa relasi</span><strong>${isolatedCount}</strong></li>
          <li><span>Cakupan node sumber</span><strong>${diagnostics.validation.coveragePercent}%</strong></li>
          <li><span>Node hilang</span><strong>${diagnostics.validation.missingAssetIds.length}</strong></li>
          <li><span>Endpoint invalid</span><strong>${diagnostics.validation.invalidEndpoints.length}</strong></li>
          <li><span>Relasi otomatis tidak sinkron</span><strong>${diagnostics.validation.missingConfirmedEdgeKeys.length + diagnostics.validation.unexpectedConfirmedEdgeKeys.length}</strong></li>
        </ul>
      </section>
    ` : ''}
    ${selectedNode ? `
      <section class="schematic-summary-card selected-evidence-card">
        <h3>Relasi aset terpilih</h3>
        <p><strong>${escapeHtml(selectedNode.name || selectedNode.id)}</strong><br>
          ${escapeHtml(selectedNode.type || 'Aset')} · ${escapeHtml(resolutionText(selectedNode.resolutionStatus))}</p>
        <ul>${selectedEdges.length ? selectedEdges.map((edge) => `
          <li class="schematic-evidence-item">
            <span>${escapeHtml(edge.relationType || 'Relasi')}<small>${escapeHtml(edge.relationSource || 'explicit')}</small></span>
            <strong>${Number.isFinite(edge.confidence) ? `${Math.round(edge.confidence * 100)}%` : edge.relationStatus}</strong>
          </li>
        `).join('') : '<li><span>Belum ada relasi otomatis.</span></li>'}</ul>
      </section>
    ` : ''}
    ${diagnostics && isolatedCount ? `
      <section class="schematic-summary-card unresolved-detail-card">
        <div class="schematic-summary-card-heading"><h3>Aset tanpa relasi</h3><strong>${isolatedCount}</strong></div>
        <p>Aset tanpa pasangan relasi dapat disambungkan atau diganti langsung dari Detail aset pada peta.</p>
      </section>
    ` : graph.mode === 'all-assets' ? `
      <section class="schematic-summary-card ${isolatedCount ? '' : 'is-clear'}">
        <h3>Relasi lengkap</h3><p>Semua aset pada diagram memiliki relasi otomatis.</p>
      </section>
    ` : ''}
  `
}

function resolutionText(status) {
  if (status === 'confirmed') return 'Relasi otomatis terkonfirmasi'
  return 'Belum tersambung'
}

function formatDiagramMeta(graph, layout, context) {
  if (graph.mode === 'selected') {
    return `${graph.neighborCount ?? Math.max(0, layout.nodes.length - 1)} aset terhubung langsung · `
      + `${context.branchName} · Dataset ${context.version} · Read-only`
  }
  if (graph.mode === 'all-assets' && graph.diagnostics) {
    const isolatedCount = graph.isolatedNodeIds?.length || graph.diagnostics.unresolvedNodeCount || 0
    return `${layout.nodes.length} aset · ${graph.diagnostics.confirmedEdgeCount} relasi otomatis · `
      + `${isolatedCount} tanpa relasi · `
      + `${graph.diagnostics.validation.coveragePercent}% tercakup · ${context.branchName} · `
      + `Dataset ${context.version} · Read-only`
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
