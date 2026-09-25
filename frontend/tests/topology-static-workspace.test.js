import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { renderLocationContextPanel } from '../src/components/location-context-panel.js'

const pageUrl = new URL('../src/pages/topology/topology-page.js', import.meta.url)

test('topology route renders the Stitch-inspired data-driven workspace', async () => {
  const source = await readFile(pageUrl, 'utf8')

  assert.match(source, /topology-stitch-app/)
  assert.match(source, /renderLocationContextPanel\(\{/)
  assert.match(source, /surface: 'topology'/)
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

test('map and topology use the same accessible location context content', () => {
  const values = { branchName: 'Yogyakarta', areaName: 'FT REWULU' }
  const map = renderLocationContextPanel({ surface: 'map', ...values })
  const topology = renderLocationContextPanel({ surface: 'topology', ...values })
  for (const panel of [map, topology]) {
    assert.match(panel, /class="[^"]*location-context-panel"/)
    assert.equal((panel.match(/<small>/g) ?? []).length, 2)
    assert.match(panel, /aria-hidden="true">apartment</)
    assert.match(panel, /aria-hidden="true">location_on</)
    assert.match(panel, /title="Yogyakarta">Yogyakarta</)
    assert.match(panel, /title="FT REWULU">FT REWULU</)
    assert.doesNotMatch(panel, /Dataset aktif|Siap diedit|relasi aktif/)
  }
  assert.match(topology, /data-topology-branch-title/)
  assert.match(topology, /data-topology-area-title/)
  assert.doesNotMatch(map, /data-topology-area-title/)
  assert.match(renderLocationContextPanel({ surface: 'map', branchName: '<A>', areaName: 'B"C' }),
    /title="&lt;A&gt;"|title="B&quot;C"/)
})

test('drag feedback adds a pop-out destination without mutating frame geometry', async () => {
  const source = await readFile(
    new URL('../src/pages/topology/topology-drag-feedback.js', import.meta.url),
    'utf8',
  )

  assert.match(source, /querySelector\(\s*['"]\.topology-mounting-bubble,/)
  assert.match(source, /halo\.classList\.add\('topology-drop-halo'\)/)
  assert.match(source, /height: visibleBox\.height \+ 62/)
  assert.match(source, /target\.halo\.remove\(\)/)
  assert.doesNotMatch(source, /frameRect\.setAttribute\('(width|height)'/)
})

test('light drag feedback keeps the ghost readable and highlights the destination frame', async () => {
  const [workspace, refinement] = await Promise.all([
    readFile(new URL('../src/styles/topology-workspace.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles/topology-refinement.css', import.meta.url), 'utf8'),
  ])

  assert.match(workspace, /\.topology-drag-ghost[^}]*drop-shadow\(0 18px 30px/)
  assert.match(workspace, /\.topology-drag-ghost :where\([^}]+fill: #1d1d1f !important/)
  assert.match(refinement, /\.topology-mounting-group\.drop-target \.topology-mounting-bubble[^}]+fill: var\(--frame-fill\) !important;[^}]+stroke: var\(--frame-accent\) !important/)
  assert.match(refinement, /\.topology-drop-slot rect[^}]+stroke: var\(--frame-accent\)/)
  assert.match(refinement, /\.topology-drop-halo[^}]+animation: topology-frame-pop/)
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
