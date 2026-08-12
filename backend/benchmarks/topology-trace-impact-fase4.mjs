import os from 'node:os'
import { performance } from 'node:perf_hooks'
import { TopologyService } from '../src/topology/topology-service.js'
import { createTopologyGraphRevision } from '../src/topology/topology-graph-revision.js'

const options = parseOptions(process.argv.slice(2))
const record = createSyntheticRecord(options.nodeCount, options.edgeCount, options.traceIterations)
const service = new TopologyService({
  repository: { async get() { return record } },
  auditLog: null,
})
const graphRevision = (await service.getGraph(record.datasetVersion.id)).graph.graphRevision
const traceDurations = []
const impactDurations = []

for (let index = 0; index < options.traceIterations; index += 1) {
  const startedAt = performance.now()
  await service.trace(record.datasetVersion.id, {
    sourceAssetId: 'n0',
    targetAssetId: `n${40000 + index}`,
    mode: 'point_to_point',
    direction: 'downstream',
    graphRevision,
    maxDepth: options.maxDepth,
  })
  traceDurations.push(performance.now() - startedAt)
}

for (let index = 0; index < options.impactIterations; index += 1) {
  const startedAt = performance.now()
  await service.impact(record.datasetVersion.id, {
    failureType: 'asset',
    failureId: `n${25000 + index}`,
    graphRevision,
    rootAssetIds: ['n0'],
  })
  impactDurations.push(performance.now() - startedAt)
}

const result = {
  benchmark: 'topology-trace-impact-fase4',
  generatedAt: new Date().toISOString(),
  runtime: {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuCount: os.cpus().length,
  },
  graph: {
    nodeCount: options.nodeCount,
    edgeCount: options.edgeCount,
    graphRevision,
  },
  samples: {
    traceIterations: options.traceIterations,
    impactIterations: options.impactIterations,
    traceP95Milliseconds: percentile(traceDurations),
    impactP95Milliseconds: percentile(impactDurations),
    traceDurationsMilliseconds: traceDurations.map(round),
    impactDurationsMilliseconds: impactDurations.map(round),
  },
  thresholds: {
    traceP95Milliseconds: options.maxTraceP95,
    impactP95Milliseconds: options.maxImpactP95,
  },
  violations: [
    ...(percentile(traceDurations) > options.maxTraceP95
      ? [{ metric: 'traceP95Milliseconds', observed: percentile(traceDurations), limit: options.maxTraceP95 }]
      : []),
    ...(percentile(impactDurations) > options.maxImpactP95
      ? [{ metric: 'impactP95Milliseconds', observed: percentile(impactDurations), limit: options.maxImpactP95 }]
      : []),
  ],
}
console.log(JSON.stringify(result, null, 2))
if (result.violations.length) process.exitCode = 1

function createSyntheticRecord(nodeCount, edgeCount, traceIterations) {
  if (!Number.isInteger(nodeCount) || nodeCount < 2) {
    throw new Error('--nodes harus integer minimal 2.')
  }
  if (!Number.isInteger(edgeCount) || edgeCount < nodeCount - 1) {
    throw new Error('--edges harus minimal nodeCount - 1.')
  }
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    id: `n${index}`,
    assetId: `n${index}`,
    canonicalAssetId: `n${index}`,
    stableAssetId: `n${index}`,
    identityStatus: 'stable',
    objectRole: 'device_node',
    topologyRole: index === 0 ? 'core' : 'endpoint',
    siteId: 'synthetic-site',
    networkFamily: 'synthetic',
    category: 'synthetic',
  }))
  const edges = []
  for (let index = 0; index < nodeCount - 1; index += 1) {
    edges.push(syntheticEdge(`e-chain-${index}`, index, index + 1))
  }
  const directEdgeCount = Math.min(traceIterations, edgeCount - (nodeCount - 1))
  for (let index = 0; edges.length < edgeCount - directEdgeCount; index += 1) {
    const target = index + 2
    if (target >= nodeCount) break
    edges.push(syntheticEdge(`e-skip-${index}`, index, target))
  }
  for (let index = 0; edges.length < edgeCount && index < directEdgeCount; index += 1) {
    edges.push(syntheticEdge(`e-direct-${index}`, 0, 40000 + index))
  }
  if (edges.length !== edgeCount) throw new Error('Synthetic edge count tidak dapat dipenuhi.')
  const topologyGraph = {
    datasetVersionId: 'dv-synthetic-f4',
    nodes,
    edges,
    components: [],
    degreeByNode: {},
    isolatedNodeIds: [],
  }
  topologyGraph.graphRevision = createTopologyGraphRevision(topologyGraph)
  return {
    datasetVersion: {
      id: 'dv-synthetic-f4',
      datasetId: 'synthetic',
      branchId: 'synthetic',
      publicationProfile: 'operational_topology',
    },
    assets: [],
    topologyGraph,
    topologyValidation: { summary: { errors: 0, warnings: 0 }, issues: [] },
  }
}

function syntheticEdge(id, sourceIndex, targetIndex) {
  return {
    id,
    sourceAssetId: `n${sourceIndex}`,
    targetAssetId: `n${targetIndex}`,
    direction: 'source_to_target',
    verificationStatus: 'confirmed',
  }
}

function parseOptions(argumentsList) {
  return {
    nodeCount: integerArgument(argumentsList, '--nodes=', 50000),
    edgeCount: integerArgument(argumentsList, '--edges=', 100000),
    traceIterations: integerArgument(argumentsList, '--trace-iterations=', 10),
    impactIterations: integerArgument(argumentsList, '--impact-iterations=', 5),
    maxDepth: integerArgument(argumentsList, '--max-depth=', 10000),
    maxTraceP95: numberArgument(argumentsList, '--max-trace-p95-ms=', 1000),
    maxImpactP95: numberArgument(argumentsList, '--max-impact-p95-ms=', 3000),
  }
}

function integerArgument(argumentsList, prefix, fallback) {
  const value = argumentsList.find((argument) => argument.startsWith(prefix))
  if (!value) return fallback
  const parsed = Number(value.slice(prefix.length))
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${prefix} harus integer positif.`)
  return parsed
}

function numberArgument(argumentsList, prefix, fallback) {
  const value = argumentsList.find((argument) => argument.startsWith(prefix))
  if (!value) return fallback
  const parsed = Number(value.slice(prefix.length))
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${prefix} harus angka positif.`)
  return parsed
}

function percentile(values) {
  const ordered = [...values].sort((left, right) => left - right)
  return round(ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1)])
}

function round(value) {
  return Number(Number(value).toFixed(3))
}
