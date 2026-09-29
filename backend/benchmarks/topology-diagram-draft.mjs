// Run against a COPY of an aggregate. The source dataset is never modified.
// node benchmarks/topology-diagram-draft.mjs /path/to/version.json
import assert from 'node:assert/strict'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { JsonDatasetVersionRepository } from '../src/storage/dataset-version-repository.js'
import { TopologyService } from '../src/topology/topology-service.js'
import { projectFacilityRecord } from '../src/topology/facility-record-projection.js'

const source = path.resolve(process.argv[2])
const original = JSON.parse(await readFile(source, 'utf8'))
const id = original.datasetVersion.id
assert.match(id, /^[a-zA-Z0-9_-]+$/)
const nodes = original.topologyInputBundle.classifiedNodes
const find = name => nodes.find(node => node.sourceName === name
  && /kutawinangun/i.test(node.sourceFolderPath ?? ''))?.canonicalAssetId
const camera = find('Cam-01'), pole = find('T-02'), junction = find('JB-01')
assert.ok(camera && pole && junction, 'Benchmark requires Booster Kutawinangun KMZ assets')
const edge = projectFacilityRecord(original).topologyGraph.edges.find(e =>
  [e.sourceAssetId, e.targetAssetId].includes(camera))
assert.ok(edge)
const temporary = await mkdtemp(path.join(tmpdir(), 'sinergi-diagram-benchmark-'))
try {
  await copyFile(source, path.join(temporary, `${id}.json`))
  const repository = new JsonDatasetVersionRepository(temporary)
  let events = 0
  const service = new TopologyService({ repository,
    auditLog: { record: async () => ({ id: `benchmark-audit-${++events}` }) } })
  const started = performance.now()
  const response = await service.saveDiagram(id, 'benchmark-only', {
    expectedRecordRevision: original.recordRevision ?? 0,
    changes: [
      { type: 'mount', assetId: camera, poleAssetId: pole },
      { type: 'rename-frame', assetId: pole, name: 'Benchmark draft' },
      { type: 'remove-edge', edgeId: edge.id },
      { type: 'add-relation', sourceAssetId: camera, targetAssetId: junction },
    ],
  })
  const durationMs = Math.round(performance.now() - started)
  const reloaded = projectFacilityRecord(await repository.get(id))
  assert.equal(response.recordRevision, (original.recordRevision ?? 0) + 1)
  assert.equal(reloaded.topologyFrameNames[pole], 'Benchmark draft')
  assert.equal(reloaded.mountingRelations.find(r => r.sourceAssetId === camera)?.targetAssetId, pole)
  assert.equal(reloaded.topologyGraph.edges.some(e => e.id === edge.id), false)
  assert.ok(reloaded.topologyGraph.edges.some(e => [e.sourceAssetId, e.targetAssetId].includes(camera)
    && [e.sourceAssetId, e.targetAssetId].includes(junction)))
  assert.equal(reloaded.topologyInputBundle.classifiedNodes.length, nodes.length)
  console.log(JSON.stringify({ durationMs, changes: 4, revisionDelta: 1, persistedAndReloaded: true, sourceUnchanged: true }))
} finally {
  assert.equal(path.dirname(temporary), path.resolve(tmpdir()))
  assert.ok(path.basename(temporary).startsWith('sinergi-diagram-benchmark-'))
  await rm(temporary, { recursive: true, force: true })
}
