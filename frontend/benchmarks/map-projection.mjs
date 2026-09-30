import { performance } from 'node:perf_hooks'
import { adaptActiveDatasetForMap } from '../src/adapters/active-dataset-map-adapter.js'

const assetCount = Number(process.argv[2] ?? 2000)
if (!Number.isInteger(assetCount) || assetCount < 2 || assetCount > 10000) {
  throw new Error('Jumlah aset harus integer antara 2 dan 10000.')
}

const assets = Array.from({ length: assetCount }, (_, index) => ({
  id: `node-${index}`,
  assetId: `asset-${index}`,
  name: `Asset ${index}`,
  type: 'Switch',
  category: 'Infrastructure',
  layerId: 'infrastructure',
  properties: {},
}))
const geometries = assets.map((asset, index) => ({
  id: `point-${index}`,
  assetNodeId: asset.id,
  geometryType: 'point',
  coordinates: [110 + (index % 100) * 0.00001, -7 + Math.floor(index / 100) * 0.00001],
}))
const edges = assets.slice(1).map((asset, index) => ({
  id: `edge-${index}`,
  sourceAssetId: assets[index].assetId,
  targetAssetId: asset.assetId,
  relationType: 'connected_to',
  verificationStatus: 'confirmed',
}))
const payload = {
  datasetVersion: {
    id: 'benchmark-version',
    datasetId: 'benchmark-dataset',
    branchId: 'benchmark',
    versionName: 'Benchmark',
  },
  layers: [{ id: 'infrastructure', name: 'Infrastructure', category: 'Infrastructure' }],
  assets,
  geometries,
  topologyGraph: {
    nodes: assets.map((asset) => ({ id: asset.assetId, assetId: asset.assetId })),
    edges,
  },
  mountingRelations: [],
  overlays: [],
}

const durations = []
for (let run = 0; run < 4; run += 1) {
  const started = performance.now()
  const result = adaptActiveDatasetForMap(payload)
  const duration = performance.now() - started
  if (result.assets.length !== assetCount
    || result.topologyGraph.edges.length !== edges.length
    || result.assets[0].relationCount !== 1
    || result.assets[1].relationCount !== 2) {
    throw new Error('Hasil proyeksi benchmark tidak lengkap.')
  }
  if (run > 0) durations.push(duration)
}
durations.sort((a, b) => a - b)
console.log(JSON.stringify({
  assetCount,
  edgeCount: edges.length,
  medianMs: Number(durations[1].toFixed(2)),
  runsMs: durations.map((duration) => Number(duration.toFixed(2))),
}))
