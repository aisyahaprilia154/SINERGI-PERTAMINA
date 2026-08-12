import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createApp } from '../src/app.js'
import {
  buildActiveAssetCatalog,
  buildActiveCapabilities,
  buildActiveSites,
  queryActiveAssets,
} from '../src/domain/active-dataset-query.js'
import {
  safeActiveKmlFilename,
  serializeActiveDatasetKml,
} from '../src/domain/active-dataset-kml.js'
import { DatasetVersionLifecycleService } from '../src/import/dataset-version-lifecycle-service.js'
import { TokenAuthenticator } from '../src/security/authorization.js'
import { JsonDatasetVersionRepository } from '../src/storage/dataset-version-repository.js'

test('Fase 2 active catalog applies stable search ranking, AND filters, facets, and visual-only guard', () => {
  const record = phaseTwoRecord()
  const catalog = buildActiveAssetCatalog({
    record,
    identityMap: record.assetIdentityMap,
    topologyGraph: record.topologyGraph,
    publicationProfile: 'map_only',
  })

  const exact = queryActiveAssets({
    catalog,
    revision: 7,
    query: { q: 'AST-001', limit: 10 },
  })
  assert.equal(exact.items[0].assetId, 'AST-001')
  assert.equal(exact.items[0].rank, 100)
  assert.equal(exact.items.some((item) => item.objectRole === 'visual_only'), false)
  assert.equal(exact.items[0].topologyStatus, 'not-applicable')

  const filtered = queryActiveAssets({
    catalog,
    revision: 7,
    query: {
      siteId: ['site-a'],
      category: ['Infrastructure'],
      assetType: ['Switch'],
      limit: 10,
    },
  })
  assert.deepEqual(filtered.items.map((item) => item.assetId), ['AST-001'])
  assert.deepEqual(filtered.facets.siteId, [{ value: 'site-a', count: 1 }])

  const oneCharacterPartial = queryActiveAssets({
    catalog,
    revision: 7,
    query: { q: 'a', limit: 10 },
  })
  assert.equal(oneCharacterPartial.totalMatched, 0)
})

test('Fase 2 cursor is bound to active pointer revision and query snapshot', () => {
  const record = phaseTwoRecord()
  const catalog = buildActiveAssetCatalog({
    record,
    identityMap: record.assetIdentityMap,
    topologyGraph: record.topologyGraph,
  })
  const firstPage = queryActiveAssets({
    catalog,
    revision: 7,
    query: { limit: 1 },
  })
  assert.ok(firstPage.nextCursor)
  assert.throws(
    () => queryActiveAssets({
      catalog,
      revision: 8,
      query: { limit: 1, cursor: firstPage.nextCursor },
    }),
    (error) => error.code === 'active_query_cursor_stale' && error.statusCode === 409,
  )
})

test('Fase 2 site extent is computed from canonical geometry and reports outside features', () => {
  const record = phaseTwoRecord()
  const catalog = buildActiveAssetCatalog({
    record,
    identityMap: record.assetIdentityMap,
    topologyGraph: record.topologyGraph,
  })
  const sites = buildActiveSites({
    catalog,
    record,
    siteBoundaries: {
      'site-a': {
        name: 'Site A Approved Boundary',
        bounds: { west: 110, south: -7, east: 110.1, north: -6.9 },
      },
      'site-b': {
        name: 'Site B Approved Boundary',
        bounds: { west: 110, south: -7.1, east: 110.5, north: -6.9 },
      },
    },
  })
  assert.equal(sites[0].extentSource, 'approved_boundary')
  assert.equal(sites[0].outsideExtentCount, 0)
  assert.equal(sites[1].outsideExtentCount, 1)
  assert.equal(sites[1].issues[0].code, 'geometry_outside_site_extent')
})

test('Fase 2 capabilities keep map-only honest and KML export remains canonical and candidate-free', () => {
  const record = phaseTwoRecord()
  const catalog = buildActiveAssetCatalog({
    record,
    identityMap: record.assetIdentityMap,
    topologyGraph: record.topologyGraph,
    publicationProfile: 'map_only',
  })
  const capabilities = buildActiveCapabilities({
    publicationProfile: 'map_only',
    readiness: { topologyReady: 'ready' },
  })
  assert.equal(capabilities.trace, false)
  assert.deepEqual(capabilities.reasonCodes, ['topology_not_ready'])

  const kml = serializeActiveDatasetKml({
    datasetVersion: record.datasetVersion,
    activePointer: { revision: 7 },
    items: catalog.filter((item) => item.objectRole !== 'visual_only'),
    filter: { siteId: ['site-a'] },
    generatedAt: '2026-08-12T00:00:00.000Z',
  })
  assert.match(kml, /dataset_version_id.*dv-phase-two/)
  assert.match(kml, /stable_asset_id.*AST-001/)
  assert.doesNotMatch(kml, /candidate-secret|topologyCandidates/)
  assert.match(safeActiveKmlFilename({
    datasetVersion: { datasetId: 'dataset/unsafe', versionName: 'v 1' },
  }), /^sinergi-dataset-unsafe-v-1-active\.kml$/)
})

test('Fase 2 geometry projection preserves canonical MultiGeometry children', () => {
  const record = phaseTwoRecord(1)
  record.geometries = [{
    id: 'legacy-unknown-multi',
    assetNodeId: 'node-1',
    geometryType: 'unknown',
    coordinates: null,
  }]
  record.sourceGeometries = [{
    geometryId: 'source-multi',
    sourceFeatureId: 'feature-1',
    geometryType: 'multi_geometry',
    geometries: [
      { geometryType: 'point', coordinates: [110, -7] },
      { geometryType: 'line_string', coordinates: [[110, -7], [110.1, -7]] },
    ],
    valid: true,
  }]
  const catalog = buildActiveAssetCatalog({
    record,
    identityMap: record.assetIdentityMap,
    topologyGraph: record.topologyGraph,
  })
  assert.equal(catalog[0].geometries[0].geometryType, 'multi_geometry')
  assert.equal(catalog[0].geometries[0].valid, true)
  assert.equal(catalog[0].geometries[0].coordinates.length, 2)
  const kml = serializeActiveDatasetKml({
    datasetVersion: record.datasetVersion,
    activePointer: { revision: 7 },
    items: catalog,
  })
  assert.match(kml, /<MultiGeometry>/)
  assert.match(kml, /<Point>/)
  assert.match(kml, /<LineString>/)
})

test('Fase 2 active HTTP projections enforce branch scope and expose server-side export', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sinergi-phase-two-http-'))
  const repository = new JsonDatasetVersionRepository(directory)
  await repository.create(phaseTwoRecord())
  const service = new DatasetVersionLifecycleService({
    repository,
    auditLog: { async record() {} },
    clock: () => new Date('2026-08-12T00:00:00.000Z'),
    siteBoundaries: {
      'site-a': { bounds: { west: 110, south: -7, east: 110.1, north: -6.9 } },
    },
  })
  const app = createApp({
    config: {
      allowedBranchIds: ['branch-a', 'branch-other'],
      observability: { metricsEnabled: false },
    },
    authenticator: new TokenAuthenticator({
      'viewer-token': { id: 'viewer-1', role: 'Viewer' },
      'scoped-token': { id: 'scoped-1', role: 'Viewer', branchIds: ['branch-other'] },
    }),
    repository,
    fileStore: {},
    auditLog: { async record() {} },
    jobQueue: null,
    importPipeline: {},
    topologyService: {},
    lifecycleService: service,
  })
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${app.address().port}`
  try {
    const headers = { authorization: 'Bearer viewer-token' }
    const collection = await fetch(
      `${origin}/api/datasets/dataset-phase-two/active/assets`
        + '?branchId=branch-a&siteId=site-a&q=AST-001&limit=1',
      { headers },
    )
    const collectionBody = await collection.json()
    assert.equal(collection.status, 200)
    assert.equal(collectionBody.items[0].assetId, 'AST-001')

    const map = await fetch(
      `${origin}/api/datasets/dataset-phase-two/active?view=map&branchId=branch-a&siteId=site-a`,
      { headers },
    )
    const mapBody = await map.json()
    assert.equal(map.status, 200)
    assert.equal(mapBody.context.siteId, 'site-a')
    assert.equal(mapBody.capabilities.trace, false)

    const detail = await fetch(
      `${origin}/api/datasets/dataset-phase-two/active/assets/AST-001?branchId=branch-a`,
      { headers },
    )
    const detailBody = await detail.json()
    assert.equal(detail.status, 200)
    assert.deepEqual(detailBody.directConnections, [])
    assert.equal(detailBody.connectionAvailabilityReason, 'topology_not_published')

    const exportResponse = await fetch(
      `${origin}/api/datasets/dataset-phase-two/active/exports/kml`,
      {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ branchId: 'branch-a', assetIds: ['AST-001'] }),
      },
    )
    const exportBody = await exportResponse.text()
    assert.equal(exportResponse.status, 200)
    assert.match(exportBody, /AST-001/)
    assert.equal((exportBody.match(/<Placemark>/g) ?? []).length, 1)
    assert.match(exportResponse.headers.get('content-disposition'), /\.kml/)

    const forbidden = await fetch(
      `${origin}/api/datasets/dataset-phase-two/active?branchId=branch-a`,
      { headers: { authorization: 'Bearer scoped-token' } },
    )
    const forbiddenBody = await forbidden.json()
    assert.equal(forbidden.status, 403)
    assert.equal(forbiddenBody.error.code, 'forbidden_branch')
  } finally {
    await new Promise((resolve, reject) => app.close((error) => error ? reject(error) : resolve()))
    await rm(directory, { recursive: true, force: true })
  }
})

test('Fase 2 reference fixture search stays within the server-side interaction budget', () => {
  const record = phaseTwoRecord(2000)
  const startedAt = performance.now()
  const catalog = buildActiveAssetCatalog({
    record,
    identityMap: record.assetIdentityMap,
    topologyGraph: record.topologyGraph,
  })
  const buildMilliseconds = performance.now() - startedAt
  const samples = []
  for (let index = 0; index < 20; index += 1) {
    const sampleStartedAt = performance.now()
    queryActiveAssets({
      catalog,
      revision: 7,
      query: { q: 'asset-19', siteId: ['site-a'], limit: 50 },
    })
    samples.push(performance.now() - sampleStartedAt)
  }
  samples.sort((left, right) => left - right)
  const p95Milliseconds = samples[Math.ceil(samples.length * 0.95) - 1]
  assert.equal(catalog.length, 2000)
  assert.ok(buildMilliseconds < 2000, `catalog build took ${buildMilliseconds}ms`)
  assert.ok(p95Milliseconds < 500, `asset search p95 took ${p95Milliseconds}ms`)
})

function phaseTwoRecord(count = 4) {
  const baseAssets = [
    asset('node-1', 'AST-001', 'Switch Alpha', 'site-a', 'Infrastructure', 'Switch'),
    asset('node-2', 'AST-002', 'Camera Beta', 'site-b', 'CCTV', 'Camera'),
    asset('node-3', 'AST-003', 'Fiber Gamma', 'site-a', 'Fiber Optic', 'Cable'),
    asset('node-visual', 'VIS-001', 'Road Overlay', 'site-a', 'Infrastructure', 'Road', 'visual_only'),
  ]
  const assets = [...baseAssets]
  for (let index = assets.length; index < count; index += 1) {
    assets.push(asset(
      `node-${index + 1}`,
      `ASSET-${String(index + 1).padStart(4, '0')}`,
      `Asset ${String(index + 1).padStart(4, '0')}`,
      index % 2 === 0 ? 'site-a' : 'site-b',
      index % 3 === 0 ? 'CCTV' : 'Infrastructure',
      index % 3 === 0 ? 'Camera' : 'Switch',
    ))
  }
  assets.length = Math.min(assets.length, count)
  const sourceFeatures = assets.map((item, index) => ({
    sourceFeatureId: `feature-${index + 1}`,
    sourceKmlId: `kml-${index + 1}`,
    sourceName: item.name,
    sourceFolderPath: `Site/${item.siteId}`,
  }))
  const classifiedObjects = assets.map((item, index) => ({
    sourceFeatureId: `feature-${index + 1}`,
    objectRole: item.objectRole,
    category: item.category,
    assetType: item.type,
    networkFamily: item.category === 'CCTV' ? 'cctv' : 'infrastructure',
    siteId: item.siteId,
  }))
  const identityItems = assets.map((item, index) => ({
    canonicalAssetId: item.assetId,
    stableAssetId: item.objectRole === 'visual_only' ? null : item.assetId,
    sourceFeatureId: `feature-${index + 1}`,
    identityStatus: item.objectRole === 'visual_only' ? 'not_applicable' : 'stable',
    identityResolutionStatus: item.objectRole === 'visual_only' ? 'not_applicable' : 'stable_explicit',
    aliases: {
      canonicalAssetId: [item.assetId],
      stableAssetId: item.objectRole === 'visual_only' ? [] : [item.assetId],
      sourceFeatureId: [`feature-${index + 1}`],
    },
  }))
  return {
    datasetVersion: {
      id: 'dv-phase-two',
      datasetId: 'dataset-phase-two',
      branchId: 'branch-a',
      versionName: 'Phase 2 Fixture',
      status: 'active',
      publicationStatus: 'published',
      publicationProfile: 'map_only',
    },
    assets,
    sourceFeatures,
    classifiedObjects,
    geometries: assets.map((item, index) => ({
      id: `geometry-${index + 1}`,
      assetNodeId: item.id,
      sourceFeatureId: `feature-${index + 1}`,
      geometryType: 'point',
      coordinates: index === 1 ? [111, -7] : [110 + index / 100, -7],
    })),
    relations: [],
    topologyCandidates: [{ id: 'candidate-secret', status: 'pending' }],
    topologyGraph: {
      nodes: assets.map((item) => ({ id: item.assetId, assetId: item.assetId })),
      edges: [],
    },
    assetIdentityMap: {
      version: 'test',
      items: identityItems,
      aliasToCanonicalAssetId: Object.fromEntries(
        identityItems.flatMap((item) => item.aliases.canonicalAssetId.map((alias) => [alias, item.canonicalAssetId])),
      ),
      validation: {},
    },
  }
}

function asset(id, assetId, name, siteId, category, type, objectRole = 'asset') {
  return {
    id,
    assetId,
    name,
    category,
    type,
    objectRole,
    branchId: 'branch-a',
    siteId,
    properties: { sourceFeatureId: `feature-${id.replace('node-', '')}` },
  }
}
