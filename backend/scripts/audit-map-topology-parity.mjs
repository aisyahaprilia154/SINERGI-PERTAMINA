import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConfig } from '../src/config.js'
import { createDatasetVersionRepositoryRuntime } from '../src/database/repository-runtime.js'
import { DatasetVersionLifecycleService } from '../src/import/dataset-version-lifecycle-service.js'
import { JsonDatasetVersionRepository } from '../src/storage/dataset-version-repository.js'
import {
  adaptActiveDatasetForMap,
  adaptActiveDatasetForTopology,
} from '../../frontend/src/adapters/active-dataset-map-adapter.js'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const dataRoot = path.resolve(process.argv[2] ?? path.join(scriptDirectory, '../.data'))
const versionDirectory = path.join(dataRoot, 'dataset-versions')
const runtime = process.argv[2]
  ? null
  : await createDatasetVersionRepositoryRuntime({
    config: createConfig(process.env, { dataRoot }),
  })
const repository = runtime?.repository ?? new JsonDatasetVersionRepository(versionDirectory)
const lifecycle = new DatasetVersionLifecycleService({
  repository,
  auditLog: { record: async () => {} },
})

try {
  const pointers = runtime?.mode === 'postgres'
    ? (await runtime.pool.query(
      'SELECT dataset_id AS "datasetId", branch_id AS "branchId", dataset_version_id AS "datasetVersionId" FROM dataset_active_pointers ORDER BY dataset_id, branch_id',
    )).rows
    : await readJsonPointers(path.join(versionDirectory, '.active'))
  if (!pointers.length) {
    console.error('Tidak ada dataset aktif untuk diaudit.')
    process.exitCode = 1
  }
  for (const pointer of pointers) {
    const context = { datasetId: pointer.datasetId, branchId: pointer.branchId }
    const [mapPayload, topologyPayload] = await Promise.all([
      lifecycle.getActiveMapDataset(context),
      lifecycle.getActiveTopologyDataset(context),
    ])
    const map = adaptActiveDatasetForMap(mapPayload)
    const topology = adaptActiveDatasetForTopology(topologyPayload)
    const report = auditParity(map, topology)
    console.log(JSON.stringify({
      datasetId: pointer.datasetId,
      branchId: pointer.branchId,
      datasetVersionId: pointer.datasetVersionId,
      ...report,
    }, null, 2))
    if (report.mismatchCount) process.exitCode = 1
  }
} finally {
  await runtime?.close()
}

async function readJsonPointers(pointerDirectory) {
  let pointerFiles
  try {
    pointerFiles = (await readdir(pointerDirectory)).filter((name) => name.endsWith('.json'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return []
  }
  return Promise.all(pointerFiles.sort().map(async (pointerFile) => (
    JSON.parse(await readFile(path.join(pointerDirectory, pointerFile), 'utf8'))
  )))
}

function auditParity(map, topology) {
  const mapAssets = new Map(map.assets.map((asset) => [asset.id, asset]))
  const topologyAssets = new Map(topology.assets.map((asset) => [asset.id, asset]))
  const areas = [...new Set([
    ...map.assets.map((asset) => asset.locationGroupKey),
    ...topology.assets.map((asset) => asset.locationGroupKey),
  ])].sort()
  const areaMismatches = [...mapAssets.values()].filter((asset) => (
    topologyAssets.has(asset.id)
    && topologyAssets.get(asset.id).locationGroupKey !== asset.locationGroupKey
  )).map((asset) => asset.id)
  const mapEdges = edgeKeys(map.topologyGraph.edges)
  const topologyEdges = edgeKeys(topology.topologyGraph.edges)
  const edgeMismatches = symmetricDifference(mapEdges, topologyEdges)
  const mapMounts = mountingKeys(map.mountingRelations)
  const topologyMounts = mountingKeys(topology.mountingRelations)
  const mountingMismatches = symmetricDifference(mapMounts, topologyMounts)
  const unplacedEdges = (map.topologyGraph.edges ?? []).filter((edge) => (
    !mapAssets.has(edge.sourceAssetId ?? edge.sourceNodeId)
    || !mapAssets.has(edge.targetAssetId ?? edge.targetNodeId)
  )).map((edge) => edge.id)
  const areaReports = areas.map((area) => {
    const mapAreaIds = new Set([...mapAssets.values()]
      .filter((asset) => asset.locationGroupKey === area).map((asset) => asset.id))
    const topologyAreaIds = new Set([...topologyAssets.values()]
      .filter((asset) => asset.locationGroupKey === area).map((asset) => asset.id))
    const mapAreaEdges = edgeKeys((map.topologyGraph.edges ?? []).filter((edge) => (
      mapAreaIds.has(edge.sourceAssetId ?? edge.sourceNodeId)
      && mapAreaIds.has(edge.targetAssetId ?? edge.targetNodeId)
    )))
    const topologyAreaEdges = edgeKeys((topology.topologyGraph.edges ?? []).filter((edge) => (
      topologyAreaIds.has(edge.sourceAssetId ?? edge.sourceNodeId)
      && topologyAreaIds.has(edge.targetAssetId ?? edge.targetNodeId)
    )))
    const mapAreaMounts = mountingKeys(map.mountingRelations.filter((relation) => (
      mapAreaIds.has(relation.sourceAssetId) && mapAreaIds.has(relation.targetAssetId)
    )))
    const topologyAreaMounts = mountingKeys(topology.mountingRelations.filter((relation) => (
      topologyAreaIds.has(relation.sourceAssetId) && topologyAreaIds.has(relation.targetAssetId)
    )))
    return {
      area,
      mapEdgeCount: mapAreaEdges.size,
      topologyEdgeCount: topologyAreaEdges.size,
      mapMountingCount: mapAreaMounts.size,
      topologyMountingCount: topologyAreaMounts.size,
      mismatches: symmetricDifference(mapAreaEdges, topologyAreaEdges).length
        + symmetricDifference(mapAreaMounts, topologyAreaMounts).length,
    }
  })
  return {
    areaReports,
    edgeCount: mapEdges.size,
    mountingCount: mapMounts.size,
    areaMismatchIds: areaMismatches.slice(0, 20),
    edgeMismatchKeys: edgeMismatches.slice(0, 20),
    mountingMismatchKeys: mountingMismatches.slice(0, 20),
    unplacedEdgeIds: unplacedEdges.slice(0, 20),
    mismatchCount: areaMismatches.length + edgeMismatches.length
      + mountingMismatches.length + unplacedEdges.length
      + areaReports.reduce((count, area) => count + area.mismatches, 0),
  }
}

function edgeKeys(edges = []) {
  return new Set(edges.map((edge) => [
    edge.id ?? edge.relationId ?? '',
    edge.sourceAssetId ?? edge.sourceNodeId ?? '',
    edge.targetAssetId ?? edge.targetNodeId ?? '',
  ].join('|')))
}

function mountingKeys(relations = []) {
  return new Set(relations.map((relation) => [
    relation.sourceAssetId ?? '',
    relation.targetAssetId ?? '',
  ].join('|')))
}

function symmetricDifference(left, right) {
  return [
    ...[...left].filter((key) => !right.has(key)),
    ...[...right].filter((key) => !left.has(key)),
  ]
}
