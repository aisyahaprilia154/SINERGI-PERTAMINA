import assert from 'node:assert/strict'
import test from 'node:test'
import { TopologyService } from '../src/topology/topology-service.js'

test('fase 4 trace modes keep physical connectivity separate from service direction', async () => {
  const auditLog = new MemoryAuditLog()
  const service = new TopologyService({
    repository: new MemoryRepository([directionalRecord()]),
    auditLog,
  })
  const graph = await service.getGraph('dv-directional')
  const graphRevision = graph.graph.graphRevision

  const physical = await service.trace('dv-directional', {
    sourceAssetId: 'cam-a',
    targetAssetId: 'core-1',
    mode: 'point_to_point',
    direction: 'both',
    graphRevision,
  })
  assert.equal(physical.status, 'found')
  assert.deepEqual(physical.nodeIds, ['cam-a', 'switch-a', 'core-1'])

  const upstream = await service.trace('dv-directional', {
    sourceAssetId: 'cam-a',
    targetAssetId: 'core-1',
    mode: 'point_to_point',
    direction: 'upstream',
    graphRevision,
  })
  assert.equal(upstream.status, 'found')
  assert.equal(upstream.mode, 'point_to_point')
  assert.deepEqual(upstream.nodeIds, ['cam-a', 'switch-a', 'core-1'])

  const downstream = await service.trace('dv-directional', {
    sourceAssetId: 'core-1',
    targetAssetId: 'cam-a',
    mode: 'point_to_point',
    direction: 'downstream',
    graphRevision,
  })
  assert.equal(downstream.status, 'found')
  assert.deepEqual(downstream.nodeIds, ['core-1', 'switch-a', 'cam-a'])

  const bidirectional = await service.trace('dv-directional', {
    sourceAssetId: 'bidirectional-device',
    targetAssetId: 'core-1',
    mode: 'point_to_point',
    direction: 'upstream',
    graphRevision,
  })
  assert.equal(bidirectional.status, 'found')
  assert.deepEqual(bidirectional.nodeIds, [
    'bidirectional-device',
    'switch-a',
    'core-1',
  ])

  const undirected = await service.trace('dv-directional', {
    sourceAssetId: 'switch-a',
    targetAssetId: 'undirected-device',
    mode: 'point_to_point',
    direction: 'upstream',
    graphRevision,
  })
  assert.equal(undirected.status, 'unreachable')
  assert.equal(undirected.reason, 'direction_not_available')

  const reachable = await service.trace('dv-directional', {
    sourceAssetId: 'core-1',
    mode: 'reachable',
    direction: 'downstream',
    graphRevision,
    maxDepth: 1,
  })
  assert.equal(reachable.status, 'destinations')
  assert.equal(reachable.truncated, true)
  assert.deepEqual(reachable.destinations, [
    { assetId: 'branch-b', distance: 1 },
    { assetId: 'branch-a', distance: 1 },
    { assetId: 'switch-a', distance: 1 },
  ])
})

test('fase 4 negative trace reasons are actionable and candidates stay outside traversal', async () => {
  const service = new TopologyService({
    repository: new MemoryRepository([directionalRecord()]),
    auditLog: new MemoryAuditLog(),
  })
  const graphRevision = (await service.getGraph('dv-directional')).graph.graphRevision

  const sourceEqualsTarget = await service.trace('dv-directional', {
    sourceAssetId: 'cam-a',
    targetAssetId: 'cam-a',
    graphRevision,
  })
  assert.equal(sourceEqualsTarget.status, 'found')
  assert.equal(sourceEqualsTarget.hopCount, 0)

  const isolated = await service.trace('dv-directional', {
    sourceAssetId: 'isolated',
    targetAssetId: 'core-1',
    graphRevision,
  })
  assert.equal(isolated.reason, 'isolated_source')

  const differentComponent = await service.trace('dv-directional', {
    sourceAssetId: 'core-1',
    targetAssetId: 'different-component',
    graphRevision,
  })
  assert.equal(differentComponent.reason, 'different_component')

  const pending = await service.trace('dv-directional', {
    sourceAssetId: 'core-1',
    targetAssetId: 'candidate-device',
    graphRevision,
  })
  assert.equal(pending.reason, 'candidate_pending_review')

  const scoped = await service.trace('dv-directional', {
    sourceAssetId: 'core-1',
    targetAssetId: 'cam-a',
    graphRevision,
    scopeAssetIds: ['core-1', 'cam-a'],
  })
  assert.equal(scoped.reason, 'scope_excludes_path')

  const maxDepth = await service.trace('dv-directional', {
    sourceAssetId: 'core-1',
    targetAssetId: 'cam-a',
    graphRevision,
    maxDepth: 1,
  })
  assert.equal(maxDepth.reason, 'max_depth_reached')
})

test('fase 4 BFS ordering, cache revision binding, roots, and audit failure behavior are deterministic', async () => {
  const repository = new MemoryRepository([directionalRecord()])
  const auditLog = new MemoryAuditLog()
  const service = new TopologyService({ repository, auditLog })
  const graphRevision = (await service.getGraph('dv-directional')).graph.graphRevision

  const first = await service.trace('dv-directional', {
    sourceAssetId: 'core-1',
    targetAssetId: 'equal-target',
    graphRevision,
  })
  const second = await service.trace('dv-directional', {
    sourceAssetId: 'core-1',
    targetAssetId: 'equal-target',
    graphRevision,
  })
  assert.deepEqual(first.nodeIds, ['core-1', 'branch-b', 'equal-target'])
  assert.deepEqual(second, first)
  assert.equal(auditLog.entries.at(-1).details.cacheHit, true)

  const roots = await service.getRoots('dv-directional', { graphRevision })
  assert.deepEqual(roots.rootAssetIds, ['core-1', 'second-root'])
  assert.equal(roots.directionCoverage.coverageStatus, 'partial')

  const throwingAudit = new TopologyService({
    repository: new MemoryRepository([directionalRecord()]),
    auditLog: { async record() { throw new Error('audit unavailable') } },
  })
  const stillAvailable = await throwingAudit.trace('dv-directional', {
    sourceAssetId: 'core-1',
    targetAssetId: 'switch-a',
    graphRevision,
  })
  assert.equal(stillAvailable.status, 'found')
  const impactStillAvailable = await throwingAudit.impact('dv-directional', {
    failureType: 'asset',
    failureId: 'cam-a',
    graphRevision,
  })
  assert.notEqual(impactStillAvailable.status, 'unavailable')

  const changed = directionalRecord()
  changed.topologyGraph.edges.push({
    id: 'edge-revision-change',
    sourceAssetId: 'core-1',
    targetAssetId: 'second-root',
    direction: 'bidirectional',
    verificationStatus: 'confirmed',
  })
  await repository.replace(changed)
  const changedRevision = (await service.getGraph('dv-directional')).graph.graphRevision
  assert.notEqual(changedRevision, graphRevision)
  const afterRevision = await service.trace('dv-directional', {
    sourceAssetId: 'core-1',
    targetAssetId: 'second-root',
    graphRevision: changedRevision,
  })
  assert.equal(afterRevision.status, 'found')
})

test('fase 4 impact separates confirmed loss from direction-incomplete potential impact', async () => {
  const service = new TopologyService({
    repository: new MemoryRepository([directionalRecord()]),
    auditLog: new MemoryAuditLog(),
  })
  const graphRevision = (await service.getGraph('dv-directional')).graph.graphRevision

  const assetImpact = await service.impact('dv-directional', {
    failureType: 'asset',
    failureId: 'switch-a',
    graphRevision,
  }, 'viewer-1', 'impact-test')
  assert.equal(assetImpact.status, 'partial')
  assert.deepEqual(assetImpact.roots, ['core-1', 'second-root'])
  assert.deepEqual(assetImpact.confirmedImpacted.map(({ assetId }) => assetId), [
    'bidirectional-device',
    'cam-a',
    'cam-b',
    'switch-a',
  ])
  assert.deepEqual(assetImpact.potentiallyImpacted.map(({ assetId, reason }) => ({
    assetId,
    reason,
  })), [{
    assetId: 'undirected-device',
    reason: 'direction_incomplete',
  }])
  assert.equal(assetImpact.summary.baselineReachable, 9)
  assert.equal(assetImpact.summary.reachableAfterFailure, 5)
  assert.equal(assetImpact.cutEdges.length, 5)

  const relationImpact = await service.impact('dv-directional', {
    failureType: 'relation',
    failureId: 'edge-switch-cam-a',
    graphRevision,
  })
  assert.equal(relationImpact.confirmedImpacted.length, 1)
  assert.equal(relationImpact.confirmedImpacted[0].assetId, 'cam-a')

  const pathImpact = await service.impact('dv-directional', {
    failureType: 'path',
    failureId: 'path-cam-b',
    graphRevision,
  })
  assert.equal(pathImpact.confirmedImpacted[0].assetId, 'cam-b')

  const noRootRecord = directionalRecord()
  noRootRecord.topologyGraph.nodes.forEach((node) => { node.topologyRole = 'unknown' })
  const noRootService = new TopologyService({
    repository: new MemoryRepository([noRootRecord]),
    auditLog: new MemoryAuditLog(),
  })
  const noRootRevision = (await noRootService.getGraph('dv-directional')).graph.graphRevision
  const unavailable = await noRootService.impact('dv-directional', {
    failureType: 'asset',
    failureId: 'switch-a',
    graphRevision: noRootRevision,
  })
  assert.equal(unavailable.status, 'unavailable')
  assert.equal(unavailable.reason, 'root_not_defined')
})

test('fase 4 impact is unavailable on map-only publication and only confirmed graph failures are simulated', async () => {
  const record = directionalRecord()
  record.datasetVersion.publicationProfile = 'map_only'
  const service = new TopologyService({
    repository: new MemoryRepository([record]),
    auditLog: new MemoryAuditLog(),
  })
  const graphRevision = (await service.getGraph('dv-directional')).graph.graphRevision
  const result = await service.impact('dv-directional', {
    failureType: 'asset',
    failureId: 'switch-a',
    graphRevision,
  })
  assert.equal(result.status, 'unavailable')
  assert.equal(result.reason, 'topology_not_published')

  const traceUnavailable = await service.trace('dv-directional', {
    sourceAssetId: 'core-1',
    targetAssetId: 'switch-a',
    graphRevision,
  })
  assert.equal(traceUnavailable.status, 'unavailable')
  assert.equal(traceUnavailable.reason, 'topology_not_published')

  const preview = await service.impact('dv-directional', {
    failureType: 'asset',
    failureId: 'switch-a',
    graphRevision,
  }, 'admin-1', 'preview-test', {
    preview: true,
    actorRole: 'Administrator',
  })
  assert.notEqual(preview.status, 'unavailable')

  await assert.rejects(
    service.impact('dv-directional', {
      failureType: 'asset',
      failureId: 'switch-a',
      graphRevision: 'topology-graph:stale',
    }),
    (error) => error.code === 'topology_graph_stale',
  )
})

function directionalRecord() {
  const nodes = [
    node('core-1', 'core', 'core'),
    node('switch-a', 'distribution', 'switch'),
    node('cam-a', 'endpoint', 'camera'),
    node('cam-b', 'endpoint', 'camera'),
    node('undirected-device', 'endpoint', 'camera'),
    node('bidirectional-device', 'endpoint', 'camera'),
    node('isolated', 'endpoint', 'camera'),
    node('second-root', 'core', 'core'),
    node('different-component', 'endpoint', 'camera'),
    node('equal-target', 'endpoint', 'camera'),
    node('branch-a', 'endpoint', 'camera'),
    node('branch-b', 'endpoint', 'camera'),
    node('candidate-device', 'endpoint', 'camera'),
  ]
  const edge = (id, sourceAssetId, targetAssetId, direction = 'source_to_target', extra = {}) => ({
    id,
    sourceAssetId,
    targetAssetId,
    sourceNodeId: sourceAssetId,
    targetNodeId: targetAssetId,
    direction,
    verificationStatus: 'confirmed',
    relationStatus: 'confirmed',
    ...extra,
  })
  return {
    datasetVersion: {
      id: 'dv-directional',
      datasetId: 'dataset-directional',
      branchId: 'site-directional',
      publicationStatus: 'published',
      publicationProfile: 'operational_topology',
    },
    assets: nodes,
    topologyGraph: {
      datasetVersionId: 'dv-directional',
      nodes,
      edges: [
        edge('edge-core-switch', 'core-1', 'switch-a'),
        edge('edge-switch-cam-a', 'switch-a', 'cam-a', 'source_to_target', {
          lengthMeters: 10,
          pathAssetIds: ['path-cam-a'],
        }),
        edge('edge-switch-cam-b', 'switch-a', 'cam-b', 'source_to_target', {
          lengthMeters: 20,
          pathAssetIds: ['path-cam-b'],
        }),
        edge('edge-switch-undirected', 'switch-a', 'undirected-device', 'undirected'),
        edge('edge-switch-bidirectional', 'switch-a', 'bidirectional-device', 'bidirectional'),
        edge('edge-second-cam', 'second-root', 'branch-a'),
        edge('a-edge', 'core-1', 'branch-b'),
        edge('b-edge', 'core-1', 'branch-a'),
        edge('y-edge', 'branch-a', 'equal-target'),
        edge('z-edge', 'branch-b', 'equal-target'),
      ],
      components: [],
      degreeByNode: {},
      isolatedNodeIds: [],
    },
    topologyCandidates: [{
      candidateId: 'candidate-a',
      sourcePathAssetId: 'core-1',
      targetAssetId: 'candidate-device',
      candidateStatus: 'candidate',
    }],
    topologyValidation: { summary: { errors: 0, warnings: 0 }, issues: [] },
    topologyGeneratedAt: '2026-08-12T00:00:00.000Z',
  }
}

function node(id, topologyRole, category) {
  return {
    id,
    assetId: id,
    canonicalAssetId: id,
    stableAssetId: id,
    identityStatus: 'stable',
    objectRole: 'device_node',
    topologyRole,
    siteId: 'site-directional',
    networkFamily: 'cctv',
    category,
  }
}

class MemoryRepository {
  constructor(records) {
    this.records = new Map(records.map((record) => [record.datasetVersion.id, structuredClone(record)]))
  }

  async get(id) {
    return structuredClone(this.records.get(id))
  }

  async replace(record) {
    this.records.set(record.datasetVersion.id, structuredClone(record))
  }
}

class MemoryAuditLog {
  constructor() {
    this.entries = []
  }

  async record(event, payload) {
    this.entries.push({ event, ...structuredClone(payload) })
    return { id: `audit-${this.entries.length}` }
  }
}
