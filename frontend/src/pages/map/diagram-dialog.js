import {
  createSchematicMultiPageArchive,
  createSchematicExportFilename,
  downloadSchematicArchive,
  downloadSchematicPng,
  downloadSchematicSvg,
} from './schematic-export.js'
import { renderSchematicSvg } from './schematic-svg.js'
import { calculateFitScale } from './schematic-bounds.js'

const MIN_DIAGRAM_ZOOM = .35
const MAX_DIAGRAM_ZOOM = 2.5

export function openSchematicDialog({
  diagrams = {},
  diagramFactory = null,
  scopeOptions = [],
  initialMode = 'overview-pengapon',
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
        <div class="schematic-mode-switch" role="tablist" aria-label="Cakupan diagram utama">
          <button class="schematic-mode-option active" type="button" role="tab"
            data-schematic-mode="overview-pengapon" aria-selected="true">
            <span class="material-symbols-outlined" aria-hidden="true">hub</span>
            <span><strong>Peta penuh</strong><small>Overview atau scope dataset aktif</small></span>
          </button>
          <button class="schematic-mode-option" type="button" role="tab"
            data-schematic-mode="active-trace" aria-selected="false">
            <span class="material-symbols-outlined" aria-hidden="true">conversion_path</span>
            <span><strong>Jalur terpilih</strong><small>Hanya hasil tracing aktif</small></span>
          </button>
        </div>
        <label class="schematic-scope-selector">
          <span>Cakupan detail</span>
          <select aria-label="Pilih cakupan diagram">
            ${renderScopeOptions(scopeOptions)}
          </select>
        </label>
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
        <div class="schematic-page-controls" hidden aria-label="Navigasi halaman diagram">
          <button class="icon-button diagram-page-previous" type="button" aria-label="Halaman sebelumnya">
            <span class="material-symbols-outlined" aria-hidden="true">chevron_left</span>
          </button>
          <span class="diagram-page-label"></span>
          <button class="icon-button diagram-page-next" type="button" aria-label="Halaman berikutnya">
            <span class="material-symbols-outlined" aria-hidden="true">chevron_right</span>
          </button>
        </div>
        <span class="schematic-readonly">
          <span class="material-symbols-outlined" aria-hidden="true">lock</span>
          Read-only
        </span>
      </div>

      <div class="schematic-board" aria-label="Preview diagram skematik" tabindex="0"></div>

      <footer class="schematic-footer">
        <p>Urutan koneksi mengikuti TopologyGraph. Diagram tidak mengubah koordinat sumber.</p>
        <div>
          <button class="button secondary close-schematic" type="button">Kembali ke peta</button>
          <button class="button secondary export-svg" type="button">
            <span class="material-symbols-outlined" aria-hidden="true">code</span>
            Export SVG
          </button>
          <label class="schematic-png-scale">
            <span class="visually-hidden">Resolusi PNG</span>
            <select aria-label="Resolusi export PNG">
              <option value="1">1x</option>
              <option value="2" selected>2x</option>
              <option value="4">4x</option>
            </select>
          </label>
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
    diagramFactory,
    scopeOptions,
    initialMode,
    activeContext,
    selectedAssetId,
    onSelectAsset,
  })
}

function bindDialogEvents({
  dialog,
  diagrams,
  diagramFactory,
  scopeOptions,
  initialMode,
  activeContext,
  selectedAssetId,
  onSelectAsset,
}) {
  const board = dialog.querySelector('.schematic-board')
  const scopeSelector = dialog.querySelector('.schematic-scope-selector select')
  const zoomLabel = dialog.querySelector('.diagram-zoom-level')
  const exportStatus = dialog.querySelector('.schematic-export-status')
  const exportSvgButton = dialog.querySelector('.export-svg')
  const exportPngButton = dialog.querySelector('.export-png')
  const pageControls = dialog.querySelector('.schematic-page-controls')
  const previousPageButton = dialog.querySelector('.diagram-page-previous')
  const nextPageButton = dialog.querySelector('.diagram-page-next')
  const viewControlButtons = dialog.querySelectorAll(
    '.diagram-zoom-out, .diagram-zoom-in, .diagram-zoom-level, .diagram-fit, .diagram-reset',
  )
  let selectedDiagramScope = initialMode
  let currentSelectedAssetId = selectedAssetId
  let currentPageIndex = 0
  let zoom = 1
  let initialZoom = 1
  const exportContext = {
    ...activeContext,
    exportedAt: new Date().toISOString(),
  }

  const getCollection = () => (
    diagramFactory
      ? diagramFactory(selectedDiagramScope)
      : diagrams[selectedDiagramScope]
  )
  const getCurrentDiagram = () => {
    const collection = getCollection()
    if (selectedDiagramScope === 'multi-page') return collection?.pages?.[currentPageIndex]
    return collection
  }
  const getCurrentSvg = () => board.querySelector('.schematic-svg')
  const isCurrentReady = () => {
    const current = getCurrentDiagram()
    return current?.graph.status === 'ready' && current?.layout.status === 'ready'
  }

  const applyZoom = ({
    clientX = null,
    clientY = null,
  } = {}) => {
    const svg = getCurrentSvg()
    if (!svg) return
    const previousRect = svg.getBoundingClientRect()
    const anchorX = Number.isFinite(clientX)
      ? clientX
      : board.getBoundingClientRect().left + board.clientWidth / 2
    const anchorY = Number.isFinite(clientY)
      ? clientY
      : board.getBoundingClientRect().top + board.clientHeight / 2
    const relativeX = previousRect.width
      ? (anchorX - previousRect.left) / previousRect.width
      : .5
    const relativeY = previousRect.height
      ? (anchorY - previousRect.top) / previousRect.height
      : .5
    const naturalWidth = Number(svg.dataset.diagramWidth || svg.getAttribute('width'))
    const naturalHeight = Number(svg.dataset.diagramHeight || svg.getAttribute('height'))
    svg.style.width = `${Math.round(naturalWidth * zoom)}px`
    svg.style.height = `${Math.round(naturalHeight * zoom)}px`
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`
    const nextRect = svg.getBoundingClientRect()
    board.scrollLeft += nextRect.left + nextRect.width * relativeX - anchorX
    board.scrollTop += nextRect.top + nextRect.height * relativeY - anchorY
  }
  const centerDiagram = () => {
    const svg = getCurrentSvg()
    if (!svg) return
    board.scrollTo({
      left: Math.max(0, (svg.offsetWidth - board.clientWidth) / 2),
      top: Math.max(0, (svg.offsetHeight - board.clientHeight) / 2),
    })
  }
  const fitDiagram = ({ rememberInitial = false } = {}) => {
    const current = getCurrentDiagram()
    if (!current?.layout) return
    zoom = calculateFitScale({
      bounds: current.layout.diagramBounds || {
        width: current.layout.width,
        height: current.layout.height,
      },
      viewportWidth: board.clientWidth,
      viewportHeight: board.clientHeight,
      minScale: MIN_DIAGRAM_ZOOM,
      maxScale: MAX_DIAGRAM_ZOOM,
    })
    if (rememberInitial) initialZoom = zoom
    applyZoom()
    centerDiagram()
  }
  const setDiagramScope = (scope) => {
    const nextState = reduceDiagramViewState({
      selectedDiagramScope,
      zoom,
    }, {
      type: 'select-scope',
      scope,
    })
    selectedDiagramScope = nextState.selectedDiagramScope
    zoom = nextState.zoom
    currentPageIndex = 0
    renderCurrentDiagram()
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
    const collection = getCollection()
    const current = getCurrentDiagram()
    const ready = isCurrentReady()
    const graph = current?.graph || {
      status: collection?.status || 'empty',
      mode: selectedDiagramScope,
      message: collection?.message || 'Diagram belum tersedia.',
    }
    const pageCount = collection?.pages?.length || 0

    dialog.querySelector('.schematic-current-title').textContent =
      ready ? graph.title : graph.status === 'scope-required'
        ? 'Pilih cakupan diagram'
        : 'Diagram belum dapat dibuat'
    dialog.querySelector('.schematic-current-meta').textContent = ready
      ? `${graph.nodes.length} node · ${describeMode(graph.mode)} · dataset ${activeContext.version}`
      : graph.status === 'scope-required'
        ? `${graph.nodeCount} aset tersedia pada scope ini`
        : 'Periksa cakupan data diagram.'

    board.innerHTML = ready
      ? `<div class="schematic-viewport">
          ${renderSchematicSvg({
            graph,
            layout: current.layout,
            context: exportContext,
            selectedAssetId: currentSelectedAssetId,
          })}
        </div>`
      : renderDiagramState(graph, scopeOptions)

    dialog.querySelectorAll('[data-schematic-mode]').forEach((button) => {
      const selected = button.dataset.schematicMode === (
        selectedDiagramScope === 'active-trace'
          ? 'active-trace'
          : 'overview-pengapon'
      )
      button.classList.toggle('active', selected)
      button.setAttribute('aria-selected', String(selected))
    })
    if ([...scopeSelector.options].some(({ value }) => value === selectedDiagramScope)) {
      scopeSelector.value = selectedDiagramScope
    }
    pageControls.hidden = selectedDiagramScope !== 'multi-page' || pageCount < 2
    if (selectedDiagramScope === 'multi-page') {
      dialog.querySelector('.diagram-page-label').textContent =
        `Halaman ${currentPageIndex + 1} / ${pageCount}`
      previousPageButton.disabled = currentPageIndex === 0
      nextPageButton.disabled = currentPageIndex >= pageCount - 1
    }
    viewControlButtons.forEach((button) => {
      button.disabled = !ready
    })
    exportSvgButton.disabled = !ready
    exportPngButton.disabled = !ready
    exportStatus.textContent = ''
    zoom = 1
    requestAnimationFrame(() => fitDiagram({ rememberInitial: true }))
  }

  dialog.querySelectorAll('.close-schematic')
    .forEach((button) => button.addEventListener('click', () => dialog.close()))
  dialog.querySelectorAll('[data-schematic-mode]').forEach((button) => {
    button.addEventListener('click', () => setDiagramScope(button.dataset.schematicMode))
  })
  scopeSelector.addEventListener('change', () => setDiagramScope(scopeSelector.value))
  dialog.querySelector('.diagram-zoom-in').addEventListener('click', () => {
    const nextState = reduceDiagramViewState({
      selectedDiagramScope,
      zoom,
    }, {
      type: 'set-zoom',
      zoom: Math.min(MAX_DIAGRAM_ZOOM, zoom + .2),
    })
    selectedDiagramScope = nextState.selectedDiagramScope
    zoom = nextState.zoom
    applyZoom()
  })
  dialog.querySelector('.diagram-zoom-out').addEventListener('click', () => {
    const nextState = reduceDiagramViewState({
      selectedDiagramScope,
      zoom,
    }, {
      type: 'set-zoom',
      zoom: Math.max(MIN_DIAGRAM_ZOOM, zoom - .2),
    })
    selectedDiagramScope = nextState.selectedDiagramScope
    zoom = nextState.zoom
    applyZoom()
  })
  dialog.querySelector('.diagram-zoom-level').addEventListener('click', () => fitDiagram())
  dialog.querySelector('.diagram-fit').addEventListener('click', () => fitDiagram())
  dialog.querySelector('.diagram-reset').addEventListener('click', () => {
    zoom = initialZoom
    applyZoom()
    centerDiagram()
    selectDiagramAsset(currentSelectedAssetId)
  })
  previousPageButton.addEventListener('click', () => {
    currentPageIndex = Math.max(0, currentPageIndex - 1)
    renderCurrentDiagram()
  })
  nextPageButton.addEventListener('click', () => {
    const pageCount = getCollection()?.pages?.length || 1
    currentPageIndex = Math.min(pageCount - 1, currentPageIndex + 1)
    renderCurrentDiagram()
  })

  board.addEventListener('wheel', (event) => {
    if (!event.ctrlKey || !isCurrentReady()) return
    event.preventDefault()
    const step = event.deltaY < 0 ? .12 : -.12
    zoom = Math.min(
      MAX_DIAGRAM_ZOOM,
      Math.max(MIN_DIAGRAM_ZOOM, zoom + step),
    )
    applyZoom({ clientX: event.clientX, clientY: event.clientY })
  }, { passive: false })

  let panState = null
  board.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('.diagram-node')) return
    panState = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      scrollLeft: board.scrollLeft,
      scrollTop: board.scrollTop,
    }
    board.classList.add('is-panning')
    board.setPointerCapture(event.pointerId)
  })
  board.addEventListener('pointermove', (event) => {
    if (!panState || panState.pointerId !== event.pointerId) return
    board.scrollLeft = panState.scrollLeft - (event.clientX - panState.clientX)
    board.scrollTop = panState.scrollTop - (event.clientY - panState.clientY)
  })
  const stopPanning = (event) => {
    if (!panState || panState.pointerId !== event.pointerId) return
    panState = null
    board.classList.remove('is-panning')
    board.releasePointerCapture?.(event.pointerId)
  }
  board.addEventListener('pointerup', stopPanning)
  board.addEventListener('pointercancel', stopPanning)

  board.addEventListener('click', (event) => {
    const action = event.target.closest('[data-diagram-action]')
    if (action) {
      const actionName = action.dataset.diagramAction
      if (actionName === 'select-network') {
        const firstNetwork = scopeOptions.find(({ group }) => group === 'Jaringan')
        if (firstNetwork) setDiagramScope(firstNetwork.key)
        else scopeSelector.focus()
      } else {
        setDiagramScope(actionName)
      }
      return
    }
    const groupNode = event.target.closest('[data-detail-scope]')
    if (groupNode) {
      setDiagramScope(groupNode.dataset.detailScope)
      return
    }
    const node = event.target.closest('.diagram-node')
    if (node) selectDiagramAsset(node.dataset.assetId)
  })
  board.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const groupNode = event.target.closest('[data-detail-scope]')
    if (groupNode) {
      event.preventDefault()
      setDiagramScope(groupNode.dataset.detailScope)
      return
    }
    const node = event.target.closest('.diagram-node')
    if (!node) return
    event.preventDefault()
    selectDiagramAsset(node.dataset.assetId)
  })

  exportSvgButton.addEventListener('click', async () => {
    const collection = getCollection()
    const current = getCurrentDiagram()
    const svg = getCurrentSvg()
    if (!svg || !current) return
    if (selectedDiagramScope === 'multi-page') {
      exportSvgButton.disabled = true
      exportStatus.textContent = 'Menyiapkan paket SVG…'
      try {
        const archive = await createSchematicMultiPageArchive({
          pages: renderArchivePages(collection.pages, exportContext, currentSelectedAssetId),
          overviewSvg: renderOverviewSvg(diagramFactory, exportContext),
          format: 'svg',
          context: exportContext,
          scope: current.graph.title,
          indexSummary: collection.indexSummary,
        })
        downloadSchematicArchive(
          archive,
          createFilename(current.graph, exportContext),
        )
        exportStatus.textContent = `${collection.pages.length} halaman SVG dan index berhasil dikemas.`
      } catch (error) {
        exportStatus.textContent = error.message
      } finally {
        exportSvgButton.disabled = false
      }
      return
    }
    exportSvgButton.disabled = true
    exportStatus.textContent = 'Menyiapkan SVGâ€¦'
    try {
      downloadSchematicSvg(svg, `${createFilename(current.graph, exportContext)}.svg`)
      exportStatus.textContent = 'File SVG berhasil disiapkan.'
    } catch (error) {
      exportStatus.textContent = error.message || 'SVG tidak dapat diexport.'
    } finally {
      exportSvgButton.disabled = false
    }
  })
  exportPngButton.addEventListener('click', async () => {
    const collection = getCollection()
    const current = getCurrentDiagram()
    const svg = getCurrentSvg()
    if (!svg || !current) return
    exportPngButton.disabled = true
    exportStatus.textContent = 'Menyiapkan PNG…'
    try {
      const scale = Number(dialog.querySelector('.schematic-png-scale select')?.value || 2)
      if (selectedDiagramScope === 'multi-page') {
        const archive = await createSchematicMultiPageArchive({
          pages: renderArchivePages(collection.pages, exportContext, currentSelectedAssetId),
          overviewSvg: renderOverviewSvg(diagramFactory, exportContext),
          format: 'png',
          scale,
          context: exportContext,
          scope: current.graph.title,
          indexSummary: collection.indexSummary,
        })
        downloadSchematicArchive(
          archive,
          createFilename(current.graph, exportContext),
        )
        exportStatus.textContent = `${collection.pages.length} halaman PNG ${scale}x dan index berhasil dikemas.`
      } else {
        await downloadSchematicPng(
          svg,
          `${createFilename(current.graph, exportContext)}@${scale}x.png`,
          scale,
        )
        exportStatus.textContent = `File PNG ${scale}x berhasil disiapkan.`
      }
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

function renderArchivePages(pages, context, selectedAssetId) {
  return pages.map((page) => ({
    title: page.graph.title,
    nodeCount: page.graph.nodes.length,
    connectionCount: page.graph.edges.reduce(
      (sum, edge) => sum + (edge.connectionCount || 1),
      0,
    ),
    svg: renderSchematicSvg({
      graph: page.graph,
      layout: page.layout,
      context,
      selectedAssetId,
    }),
  }))
}

function renderOverviewSvg(diagramFactory, context) {
  const overview = diagramFactory?.('overview-pengapon')
  if (overview?.graph?.status !== 'ready' || overview?.layout?.status !== 'ready') return null
  return renderSchematicSvg({
    graph: overview.graph,
    layout: overview.layout,
    context,
  })
}

function renderDiagramState(graph, scopeOptions) {
  const needsScope = graph.status === 'scope-required'
  const hasNetwork = scopeOptions.some(({ group }) => group === 'Jaringan')
  return `
    <div class="schematic-state ${needsScope ? 'warning' : ''}" role="alert">
      <span class="material-symbols-outlined" aria-hidden="true">
        ${needsScope ? 'account_tree' : 'account_tree_off'}
      </span>
      <strong>${needsScope
        ? `${graph.nodeCount} aset ditemukan. Pilih cara penyederhanaan diagram.`
        : 'Data diagram belum tersedia'}</strong>
      <p>${escapeHtml(needsScope
        ? 'Diagram detail satu halaman dibatasi agar koneksi dan label tetap terbaca.'
        : graph.message || 'Pilih aset atau jalankan tracing terlebih dahulu.')}</p>
      ${needsScope ? `
        <div class="schematic-state-actions">
          <button class="button secondary" type="button" data-diagram-action="overview-pengapon">
            Buat overview Pengapon
          </button>
          <button class="button secondary" type="button" data-diagram-action="current-viewport">
            Gunakan area peta saat ini
          </button>
          <button class="button secondary" type="button" data-diagram-action="select-network"
            ${hasNetwork ? '' : 'disabled'}>
            Pilih satu jaringan
          </button>
          <button class="button secondary" type="button" data-diagram-action="active-trace">
            Gunakan jalur tracing
          </button>
          <button class="button primary" type="button" data-diagram-action="multi-page">
            Export beberapa halaman
          </button>
        </div>
        <small>Detail optimal 5–30 node · compact layout 31–100 node</small>
      ` : ''}
    </div>
  `
}

function renderScopeOptions(options) {
  const builtIn = [
    { key: 'overview-pengapon', label: 'Peta penuh · Overview Pengapon' },
    { key: 'current-viewport', label: 'Area peta saat ini' },
    ...options,
  ]
  const unique = [...new Map(builtIn.map((option) => [option.key, option])).values()]
  const ungrouped = unique.filter(({ group }) => !group)
  const grouped = new Map()
  unique.filter(({ group }) => group).forEach((option) => {
    grouped.set(option.group, [...(grouped.get(option.group) || []), option])
  })
  return [
    ...ungrouped.map((option) => (
      `<option value="${escapeHtml(option.key)}"
        title="${escapeHtml(option.title || option.label)}">${escapeHtml(option.label)}</option>`
    )),
    ...[...grouped].map(([label, groupOptions]) => `
      <optgroup label="${escapeHtml(label)}">
        ${groupOptions.map((option) => (
          `<option value="${escapeHtml(option.key)}"
            title="${escapeHtml(option.title || option.label)}">${escapeHtml(option.label)}</option>`
        )).join('')}
      </optgroup>
    `),
    '<option value="active-trace">Jalur tracing aktif</option>',
  ].join('')
}

function describeMode(mode) {
  if (mode === 'trace') return 'jalur terpilih'
  if (mode === 'full-map') return 'peta jaringan lengkap'
  if (mode === 'focus') return 'aset fokus dan relasinya'
  if (mode === 'viewport') return 'area peta saat ini'
  if (mode === 'layer') return 'area atau layer terpilih'
  if (mode === 'overview') return 'overview jaringan'
  if (mode === 'multi-page') return 'export beberapa halaman'
  return 'jaringan terpilih'
}

function createFilename(graph, context) {
  return createSchematicExportFilename({
    siteName: context.siteScopeName || context.branchName || 'Pengapon',
    scope: graph.title || graph.mode || 'Diagram',
    version: context.version,
    exportedAt: context.exportedAt,
  })
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export function reduceDiagramViewState(state, action) {
  if (action?.type === 'select-scope' && action.scope) {
    return {
      ...state,
      selectedDiagramScope: action.scope,
    }
  }
  if (action?.type === 'set-zoom' && Number.isFinite(action.zoom)) {
    return {
      ...state,
      zoom: action.zoom,
    }
  }
  return { ...state }
}

export const diagramDialogInternals = {
  renderDiagramState,
  renderScopeOptions,
  reduceDiagramViewState,
}
