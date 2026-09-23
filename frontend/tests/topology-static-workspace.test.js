import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const pageUrl = new URL('../src/pages/topology/topology-page.js', import.meta.url)

test('topology route renders the Stitch-inspired data-driven workspace', async () => {
  const source = await readFile(pageUrl, 'utf8')

  assert.match(source, /topology-stitch-app/)
  assert.match(source, /renderTopologyDiagramSvg/)
  assert.match(source, /loadActiveDataset/)
  assert.match(source, /selectedAssetId/)
  assert.match(source, /localStorage\.getItem/)
  assert.match(source, /overview: state\.area === null/)
  assert.match(source, /data-action="toggle-remove-edge"/)
  assert.match(source, /data-relation-search/)
  assert.match(source, /saveTopologyDiagram/)
  assert.match(source, /data-action="save-diagram"/)
  assert.match(source, /data-action="cancel-diagram"/)
  assert.match(source, /createAssetDragFeedback/)
  assert.match(source, /lostpointercapture/)
  assert.match(source, /targetGroupId/)
  assert.match(source, /topologyFrameAssignments/)
  assert.match(source, /frameAssignments/)
  assert.match(source, /excluded/)
  assert.match(source, /data-frame-composer/)
  assert.match(source, /data-frame-search/)
  assert.match(source, /type:indoor/)
  assert.match(source, /type:non-pole/)
  assert.match(source, /data-frame-name-form/)
  assert.match(source, /class="map-category-presets topology-family-presets"/)
  assert.match(source, /data-family="__reset__"/)
  assert.match(source, /data-mounting-toggle/)
  assert.match(source, /data-label-mode/)
  assert.doesNotMatch(source, /data-action="toggle-view"/)
  assert.doesNotMatch(source, /data-action="toggle-filter"/)
  assert.doesNotMatch(source, /data-action="toggle-inspector"/)
  assert.doesNotMatch(source, /Status diagram/)
  assert.doesNotMatch(source, /data-topology-filter-panel/)
  assert.doesNotMatch(source, /data-topology-view-panel/)
  assert.match(source, /data-action="toggle-legend"/)
  assert.match(source, /class="topology-legend-popover"/)
  assert.match(source, /data-topology-legend/)
  assert.doesNotMatch(source, /class="topology-document-key"/)
  assert.doesNotMatch(source, /topology-reset-page/)
})

test('drag feedback expands the visible frame body before generic SVG rectangles', async () => {
  const source = await readFile(
    new URL('../src/pages/topology/topology-drag-feedback.js', import.meta.url),
    'utf8',
  )

  assert.match(source, /querySelector\(\s*['"]\.topology-mounting-bubble,/)
  assert.match(source, /frameRect\.setAttribute\('width', visibleBox\.width \+ 16\)/)
  assert.match(source, /frameRect\.setAttribute\('height', visibleBox\.height \+ 60\)/)
})

test('light drag feedback keeps the ghost readable and highlights the destination frame', async () => {
  const source = await readFile(
    new URL('../src/styles/topology-workspace.css', import.meta.url),
    'utf8',
  )

  assert.match(source, /\.topology-drag-ghost[^}]*drop-shadow\(0 18px 30px/)
  assert.match(source, /\.topology-drag-ghost :where\([^}]+fill: #1d1d1f !important/)
  assert.match(source, /\.topology-mounting-group\.drop-target \.topology-mounting-bubble[^}]+fill: #eaf4ff !important/)
  assert.match(source, /stroke: #0071e3 !important/)
})

test('canvas controls stay compact without visible labels below the floating dock', async () => {
  const source = await readFile(
    new URL('../src/styles/topology-workspace.css', import.meta.url),
    'utf8',
  )

  assert.match(source, /\.topology-toolbar-navigation \{ height: 30px;/)
  assert.match(source, /\.topology-toolbar-navigation > button \{[^}]+width: 30px;/)
  assert.match(source, /\.topology-toolbar-navigation-button > \.material-symbols-outlined \+ span \{ display: none; \}/)
  assert.match(source, /\.topology-zoom-reset \{ min-width: 44px;/)
})
