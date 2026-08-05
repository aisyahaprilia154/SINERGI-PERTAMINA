import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import {
  generateRelationArtifacts,
  TOPOLOGY_RULE_SET_VERSION,
} from '../src/topology/semantic-relation-engine.js'

export const DENSE_OBJECT_COUNT = 10_000
export const DENSE_PATH_COUNT = 10
export const DENSE_MAX_DURATION_MS = 60_000
export const DENSE_MAX_RSS_MIB = 512
export const DENSE_MAX_CANDIDATE_COUNT = 50_000

export function runDenseGuardedBenchmark({
  objectCount = DENSE_OBJECT_COUNT,
  pathCount = DENSE_PATH_COUNT,
  maxDurationMs = DENSE_MAX_DURATION_MS,
  maxRssMiB = DENSE_MAX_RSS_MIB,
  maxCandidateCount = DENSE_MAX_CANDIDATE_COUNT,
} = {}) {
  const startedAt = performance.now()
  const bundle = createDenseTopologyBundle({ objectCount, pathCount })
  const fixtureBuildMs = performance.now() - startedAt
  let outcome = 'completed_without_guardrail'
  let artifact = null
  let error = null

  try {
    artifact = generateRelationArtifacts(bundle, {
      config: {
        maxCandidateCount,
        maxGenerationMilliseconds: maxDurationMs,
      },
      generatedAt: '2026-08-05T00:00:00.000Z',
    })
  } catch (caught) {
    error = {
      code: caught.code ?? 'unknown',
      message: caught.message,
      details: caught.details ?? null,
    }
    if (caught.code === 'topology_candidate_limit_exceeded') {
      outcome = 'candidate_guardrail_triggered'
    } else {
      outcome = 'failed'
    }
  }

  const durationMs = performance.now() - startedAt
  const rssMiB = process.memoryUsage().rss / 1024 / 1024
  const peakRssMiB = process.resourceUsage().maxRSS / 1024
  const observedRssMiB = Math.max(rssMiB, peakRssMiB)
  const budgetViolations = []
  if (durationMs > maxDurationMs) {
    budgetViolations.push({
      metric: 'durationMs',
      observed: Number(durationMs.toFixed(3)),
      limit: maxDurationMs,
    })
  }
  if (observedRssMiB > maxRssMiB) {
    budgetViolations.push({
      metric: 'peakRssMiB',
      observed: Number(observedRssMiB.toFixed(2)),
      limit: maxRssMiB,
    })
  }

  return {
    benchmark: 'topology-dense-guarded',
    generatedAt: new Date().toISOString(),
    ruleSetVersion: TOPOLOGY_RULE_SET_VERSION,
    objectCount,
    nodeCount: objectCount,
    pathCount,
    fixtureBuildMs: Number(fixtureBuildMs.toFixed(3)),
    durationMs: Number(durationMs.toFixed(3)),
    rssMiB: Number(rssMiB.toFixed(2)),
    peakRssMiB: Number(peakRssMiB.toFixed(2)),
    observedRssMiB: Number(observedRssMiB.toFixed(2)),
    outcome,
    candidateCount: artifact?.candidates.length ?? null,
    validationErrors: artifact?.validation.summary.errors ?? null,
    error,
    budgets: { maxDurationMs, maxRssMiB, maxCandidateCount },
    budgetViolations,
    pass: outcome === 'candidate_guardrail_triggered' && budgetViolations.length === 0,
  }
}

export function createDenseTopologyBundle({
  objectCount = DENSE_OBJECT_COUNT,
  pathCount = DENSE_PATH_COUNT,
} = {}) {
  const datasetVersionId = `dv-benchmark-dense-${objectCount}`
  const siteId = 'site-dense-benchmark'
  const baseLongitude = 110
  const baseLatitude = -7
  const gridSide = Math.ceil(Math.sqrt(objectCount))
  const gridStep = 0.0000003
  const nodes = Array.from({ length: objectCount }, (_, index) => {
    const row = Math.floor(index / gridSide)
    const column = index % gridSide
    const coordinates = [
      baseLongitude + (column - gridSide / 2) * gridStep,
      baseLatitude + (row - gridSide / 2) * gridStep,
    ]
    return denseNode({
      assetId: `DENSE-NODE-${String(index + 1).padStart(5, '0')}`,
      datasetVersionId,
      siteId,
      coordinates,
    })
  })
  const paths = Array.from({ length: pathCount }, (_, index) => densePath({
    assetId: `DENSE-PATH-${String(index + 1).padStart(3, '0')}`,
    datasetVersionId,
    siteId,
    index,
    baseLongitude,
    baseLatitude,
  }))

  return {
    datasetVersion: {
      id: datasetVersionId,
      sourceChecksum: `sha256:${String(objectCount).padStart(64, '0')}`,
    },
    site: siteId,
    classifiedNodes: nodes.map(({ object }) => object),
    classifiedPaths: paths.map(({ object }) => object),
    geometries: [...nodes, ...paths].map(({ geometry }) => geometry),
    explicitRelations: [],
    semanticRuleSetVersion: 'semantic-classifier/1.0.0',
    topologyRuleSetVersion: TOPOLOGY_RULE_SET_VERSION,
  }
}

function denseNode({ assetId, datasetVersionId, siteId, coordinates }) {
  const sourceFeatureId = `feature:${assetId}`
  const geometryId = `geometry:${assetId}`
  return {
    object: {
      assetId,
      sourceFeatureId,
      siteId,
      objectRole: 'device_node',
      networkFamily: 'cctv',
      assetType: 'CCTV Camera',
      category: 'CCTV Camera',
      classificationStatus: 'classified',
      classificationEvidence: [{
        source: 'benchmark',
        observedValue: 'dense-cctv-node',
        normalizedValue: 'cctv',
        ruleId: 'dense-guardrail-fixture',
        weight: 1,
        explanation: 'Deterministic dense capacity fixture.',
      }],
      geometryIds: [geometryId],
    },
    geometry: {
      geometryId,
      datasetVersionId,
      sourceFeatureId,
      geometryType: 'Point',
      coordinates,
      valid: true,
      geometryFingerprint: `fingerprint:${assetId}`,
    },
  }
}

function densePath({
  assetId,
  datasetVersionId,
  siteId,
  index,
  baseLongitude,
  baseLatitude,
}) {
  const sourceFeatureId = `feature:${assetId}`
  const geometryId = `geometry:${assetId}`
  const offset = index * 0.00000001
  return {
    object: {
      assetId,
      sourceFeatureId,
      siteId,
      objectRole: 'cable_path',
      networkFamily: 'cctv',
      assetType: 'CCTV Cable',
      category: 'CCTV Cable',
      classificationStatus: 'classified',
      classificationEvidence: [{
        source: 'benchmark',
        observedValue: 'dense-cctv-path',
        normalizedValue: 'cctv',
        ruleId: 'dense-guardrail-fixture',
        weight: 1,
        explanation: 'Deterministic dense capacity fixture.',
      }],
      geometryIds: [geometryId],
    },
    geometry: {
      geometryId,
      datasetVersionId,
      sourceFeatureId,
      geometryType: 'LineString',
      coordinates: [
        [baseLongitude + offset, baseLatitude - offset],
        [baseLongitude + 0.00001 + offset, baseLatitude + offset],
      ],
      valid: true,
      geometryFingerprint: `fingerprint:${assetId}`,
    },
  }
}

async function main() {
  const report = runDenseGuardedBenchmark()
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!report.pass) process.exitCode = 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`[topology-dense-guarded] ${error.message}\n`)
    process.exitCode = 1
  })
}
