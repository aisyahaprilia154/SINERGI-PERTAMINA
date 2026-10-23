import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AppHeader } from '../components/AppHeader.jsx'
import { Icon } from '../components/Icon.jsx'
import { useSession } from '../session/session-context.js'
import { createMapReadAdapter } from '../../adapters/map-read-adapter.js'
import { createNetworkSelectionState, parseMapUrlState, mapSelectionQuery, findAssetMatches, displayAssetName, networkMatchesPreset, buildExplicitRelationGraph, getConnectedAssets } from '../../domain/map-read-model.js'
import { documentNavigation } from '../../services/document-navigation.js'
import { useMapDataset } from './useMapDataset.js'
import { MapSidebar } from './MapSidebar.jsx'
import { MapStage } from './MapStage.jsx'

function Workspace({ model, createAdapter }) {
  const [controller] = useState(() => createNetworkSelectionState({ ...model.selectionOptions, initialSelectedNetworkIds: model.urlState.selectedNetworkIds, initialSelectedAssetId: model.urlState.selectedAssetId }))
  const snapshot = useCallback(() => ({ selectedNetworkIds: controller.selectedNetworkIds, selectedAssetId: controller.selectedAssetId }), [controller])
  const [selection, setSelection] = useState(snapshot), [query, setQuery] = useState(''), [searchOpen, setSearchOpen] = useState(false)
  const [expanded, setExpanded] = useState(new Set()), [focused, setFocused] = useState(null), [coverage, setCoverage] = useState(false)
  const [collapsed, setCollapsed] = useState(false), [sidebarOpen, setSidebarOpen] = useState(false), [mobileTab, setMobileTab] = useState('map'), [popup, setPopup] = useState(null)
  const [mapReady, setMapReady] = useState(false), [mapError, setMapError] = useState(''), [mapAttempt, setMapAttempt] = useState(0)
  const [basemap, setBasemap] = useState({ status: 'loading', mode: 'street', street: false, satellite: false })
  const api = useRef(null), search = useRef(null), results = useRef(null), reopen = useRef(null), focusReopen = useRef(false), focusSearch = useRef(false)
  const mobile = () => window.matchMedia?.('(max-width: 960px)').matches || false
  const writeUrl = useCallback(mode => {
    const params = mapSelectionQuery(window.location.search, { ...model, selection: controller })
    window.history[`${mode}State`](null, '', `${window.location.pathname}?${params}${window.location.hash}`)
  }, [model, controller])
  const commit = useCallback((method, ...args) => { controller[method](...args); setSelection(snapshot()); writeUrl('push') }, [controller, snapshot, writeUrl])
  const closeSidebar = useCallback(() => { if (window.matchMedia?.('(max-width: 960px)').matches) setSidebarOpen(false); else setCollapsed(true); setMobileTab('map'); focusReopen.current = true }, [])
  const openSidebar = useCallback(mode => { if (window.matchMedia?.('(max-width: 960px)').matches) { setSidebarOpen(true); setMobileTab(mode) }; setCollapsed(false); if (mode === 'assets') { focusSearch.current = true; search.current?.focus() } }, [])
  useLayoutEffect(() => {
    if (focusReopen.current) { reopen.current?.focus(); focusReopen.current = false }
    if (focusSearch.current) { search.current?.focus(); focusSearch.current = false }
  }, [collapsed, sidebarOpen, mobileTab])
  useEffect(() => {
    writeUrl('replace')
    const restore = () => { controller.replace(parseMapUrlState(window.location.search, model.selectionOptions)); setSelection(snapshot()) }
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [model, controller, snapshot, writeUrl])
  useEffect(() => {
    const keyboard = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSidebar('assets'); search.current?.focus() }
      if (event.key === 'Escape') { setPopup(null); setSearchOpen(false); if (sidebarOpen) closeSidebar() }
    }
    const outside = event => {
      if (!event.target.closest('.basemap-popover,.legend-popover,.basemap-toggle,.legend-toggle')) setPopup(null)
      if (!event.target.closest('.asset-search-combobox')) setSearchOpen(false)
    }
    window.addEventListener('keydown', keyboard); document.addEventListener('pointerdown', outside)
    return () => { window.removeEventListener('keydown', keyboard); document.removeEventListener('pointerdown', outside) }
  }, [openSidebar, closeSidebar, sidebarOpen])
  const selectAsset = (id, fromSearch = false) => {
    if (!model.assetById[id]) return
    if (controller.selectedAssetId !== id) commit('selectAsset', id)
    else api.current?.focusAsset?.(id)
    if (fromSearch) { setQuery(displayAssetName(model.assetById[id])); setSearchOpen(false); api.current?.highlightAsset(id) }
    if (mobile() && sidebarOpen) { setSidebarOpen(false); setMobileTab('map') }
  }
  const selectNetwork = (id, all = false) => { if (all) commit('showAllNetworks'); else if (!controller.selectedNetworkIds.has(id)) commit('toggleNetwork', id) }
  const graph = useMemo(() => buildExplicitRelationGraph({ networks: model.networks, assetIds: model.selectionOptions.assetIds, topologyGraph: model.topologyGraph }), [model])
  const surfaceState = useMemo(() => {
    const physicalRelatedIds = model.poleGroups.find(group => group.assetIds.includes(selection.selectedAssetId))?.assetIds.filter(id => id !== selection.selectedAssetId) || []
    return { ...selection, connectedNodeIds: [...new Set([...getConnectedAssets(graph, selection.selectedAssetId).map(item => item.targetAssetId), ...physicalRelatedIds])], physicalRelatedIds, dimOthers: true, showCctvCoverage: coverage, focusedNetworkId: focused }
  }, [model, graph, selection, coverage, focused])
  const onBasemapStatus = (status, details = {}) => setBasemap(previous => ({ ...previous, status, ...(details.mode ? { mode: details.mode } : {}) }))
  const onReady = capabilities => { setMapReady(true); setBasemap(previous => ({ ...previous, ...capabilities })) }
  const changeArea = key => {
    if (!model.locationGroups.some(group => group.key === key) || key === model.selectedArea?.key) return
    const params = new URLSearchParams(window.location.search); params.set('area', key); params.delete('selectedAssetId')
    api.current?.dispose(); documentNavigation.assign(`${window.location.pathname}?${params}${window.location.hash}`)
  }
  const matches = useMemo(() => findAssetMatches(model.assets, query), [model, query])
  const sidebarModel = { ...model, matches, changeArea }
  return <div className="map-app react-map-read"><AppHeader active="map" context={{ ...model.activeContext, area: model.selectedArea?.key }} /><main className={`map-workspace${collapsed ? ' sidebar-collapsed' : ''}${sidebarOpen ? ' sidebar-open' : ''}`} data-mobile-panel={sidebarOpen ? mobileTab : undefined}>
    <MapSidebar model={sidebarModel} selection={selection} query={query} setQuery={setQuery} searchOpen={searchOpen} setSearchOpen={setSearchOpen} searchRef={search} resultsRef={results} expanded={expanded} focused={focused} coverage={coverage} collapsed={collapsed} onClose={closeSidebar} onSelectAsset={selectAsset} onToggleNetwork={id => commit('toggleNetwork', id)} onPreset={preset => { if (preset === 'all') commit('showAllNetworks'); else commit('toggleNetworkGroup', model.networks.filter(network => networkMatchesPreset(network, preset)).map(network => network.id)) }} onExpand={id => setExpanded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next })} onFocus={id => { const next = focused === id ? null : id; setFocused(next); if (next) api.current?.focusNetwork(id) }} onCoverage={() => setCoverage(previous => !previous)} onHover={id => api.current?.highlightNetwork(id)} />
    <MapStage model={model} selection={selection} surfaceState={surfaceState} createAdapter={createAdapter} apiRef={api} mapAttempt={mapAttempt} mapReady={mapReady} mapError={mapError} retryMap={() => { setMapReady(false); setMapError(''); setMapAttempt(previous => previous + 1) }} basemap={basemap} onReady={onReady} onError={error => { setMapReady(false); setMapError(error.message) }} onBasemapStatus={onBasemapStatus} onSelectAsset={selectAsset} onSelectNetwork={selectNetwork} popup={popup} setPopup={setPopup} sidebarOpen={sidebarOpen} openSidebar={openSidebar} closeSidebar={closeSidebar} reopenRef={reopen} mobileTab={mobileTab} setMobileTab={setMobileTab} />
  </main></div>
}
export function MapReadPage({ createAdapter = createMapReadAdapter }) {
  const { model, loading, error, retry } = useMapDataset(), { user } = useSession()
  useLayoutEffect(() => { const body = document.body.className, title = document.title; document.body.className = 'map-body'; document.title = 'Peta Jaringan — SINERGI'; return () => { document.body.className = body; document.title = title } }, [])
  if (!model) return <div className="map-app react-map-read"><AppHeader active="map" /><main className={`map-data-state${loading ? ' is-loading' : ' is-error'}`} aria-live="polite" aria-busy={loading}><Icon>{loading ? 'progress_activity' : 'error'}</Icon><h1>{loading ? 'Memuat dataset aktif' : 'Dataset aktif tidak dapat dimuat'}</h1><p>{loading ? 'Aset, geometri, dan relasi sedang dibaca dari versi aktif yang sama.' : error}</p>{!loading && <div><button className="button button-primary retry-active-dataset" type="button" onClick={() => void retry()}>Coba lagi</button>{user?.role === 'Administrator' && <button type="button" className="button button-secondary" onClick={() => documentNavigation.assign('/admin/datasets/import')}><Icon>upload_file</Icon>Import KML/KMZ</button>}</div>}</main></div>
  return <Workspace model={model} createAdapter={createAdapter} />
}
