import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseKmlText } from '../src/import/kml-parser.js'
import { buildCanonicalParserResult, rebuildStoredTopologyInputBundle } from '../src/domain/parser-contract.js'
import { hydrateIdentityRegistrySourceAliases } from '../src/domain/canonical-asset-identity.js'
import { projectCanonicalImport } from '../src/import/legacy-import-projection.js'
import { mergeAdditionsOnlyImport, assertAdditionsBaseline, copyToVersion } from '../src/import/additions-only-import.js'
import { generateRelationArtifacts, buildConfirmedGraph } from '../src/topology/semantic-relation-engine.js'
import { applyArtifacts } from '../src/topology/topology-service.js'
import { JsonDatasetVersionRepository } from '../src/storage/dataset-version-repository.js'
import { ImportFileStore } from '../src/storage/file-store.js'
import { ImportPipeline } from '../src/import/import-pipeline.js'
import { DatasetVersionLifecycleService } from '../src/import/dataset-version-lifecycle-service.js'
import { networkFromKmlLineColor } from '../../shared/kml-network-color.mjs'

const version = id => ({ id, datasetId: 'dataset-test', branchId: 'site-test',
  checksum: `sha256:${'a'.repeat(64)}`, sourceFilename: 'doc.kml', officialSourceConfirmed: true })
const point = (id, name, coordinate) => `<Placemark id="${id}"><name>${name}</name>
  <ExtendedData><Data name="asset_id"><value>${id}</value></Data></ExtendedData>
  <Point><coordinates>${coordinate}</coordinates></Point></Placemark>`
const folder = (name, content) => `<Folder><name>${name}</name>${content}</Folder>`
const source = (additional = '', cameraCoordinate = '110.0002,-7', includeOld = true) => `<kml><Document>
  ${folder('RJBT', folder('Site A',
    folder('Junction Box', point('JB-01', 'JB-01', '110,-7') + point('JB-02', 'JB-02', '110.001,-7'))
    + folder('CCTV', (includeOld ? point('C-01', 'C-01', cameraCoordinate) : '') + additional)
    + folder('Tiang', point('T-01', 'T-01', '110.0002,-7') + point('T-02', 'T-02', '110.002,-7'))))}
  </Document></kml>`

function parse(id, text, baseline = null) {
  const datasetVersion = version(id), parserOutput = parseKmlText(text)
  const identityRegistry = baseline ? hydrateIdentityRegistrySourceAliases({
    datasetVersion, sourceFeatures: baseline.sourceFeatures, classifiedObjects: baseline.classifiedObjects,
    identityRegistry: baseline.identityRegistry,
  }).identityRegistry : []
  const canonicalParser = buildCanonicalParserResult({ parserOutput, datasetVersion,
    sourceSelection: { selectedKmlPath: 'doc.kml' }, autoAssignOnboarding: true, identityRegistry })
  const projection = projectCanonicalImport({ parserOutput, canonicalParser, datasetVersion })
  return { canonicalParser, projection, parserOutput }
}
function materialize(parsed) {
  const { canonicalParser: c, projection } = parsed
  const artifacts = generateRelationArtifacts(c.topologyInputBundle, { config: { automaticRelationConfirmation: true } })
  return { ...applyArtifacts(projection, artifacts), canonicalParser: c,
    sourceFeatures: c.sourceFeatures, sourceGeometries: c.sourceGeometries,
    sourceMetadataEntries: c.sourceMetadataEntries, sourceResources: c.sourceResources, sourceOverlays: c.sourceOverlays,
    classifiedObjects: c.classifiedObjects, assetIdentityMap: c.assetIdentityMap, identityRegistry: c.identityRegistry,
    topologyInputBundle: c.topologyInputBundle, recordRevision: 7 }
}
function correctedBaseline() {
  const baseline = materialize(parse('dv-baseline', source()))
  baseline.confirmedRelations = [{ relationId: 'reviewed-network', datasetVersionId: 'dv-baseline',
    sourceAssetId: 'C-01', targetAssetId: 'JB-02', relationKind: 'device_edge', relationType: 'connected-to',
    direction: 'undirected', verificationStatus: 'confirmed', provenance: 'manual_admin',
    mediaType: 'copper_lan', serviceDomain: 'data', sourceGeometryIds: [], traversable: true,
    manualConfirmation: { actorId: 'reviewer', reviewedAt: '2026-09-28T00:00:00Z', reason: 'Koreksi lapangan' } }]
  baseline.topologyCandidates = []
  baseline.mountingRelations = [{ id: 'reviewed-mount', datasetVersionId: 'dv-baseline',
    sourceAssetId: 'C-01', targetAssetId: 'T-02', verificationStatus: 'confirmed', provenance: 'manual_admin' }]
  baseline.mountingOverrides = [{ assetId: 'C-01', targetAssetId: 'T-02', action: 'assign', actorId: 'reviewer' }]
  baseline.topologyGraph = buildConfirmedGraph({ bundle: baseline.topologyInputBundle,
    nodes: baseline.topologyGraph.nodes, paths: [], confirmedRelations: baseline.confirmedRelations,
    interfaceRegistry: { interfaces: baseline.topologyInterfaceRegistry, components: baseline.topologyComponentRegistry } })
  baseline.relations = structuredClone(baseline.topologyGraph.edges)
  return baseline
}

test('KML ABGR blue/green variants classify unnamed paths and survive stored bundle rebuild', () => {
  for (const [color, family] of [['ffff0000', 'fiber_optic'], ['ffff0055', 'fiber_optic'],
    ['ff00ff00', 'lan'], ['ff00ff55', 'lan'], ['ff00aa00', 'lan']]) {
    assert.equal(networkFromKmlLineColor(color), family)
    for (const style of ['inline', 'style-map']) {
      const definition = `<Style id="normal"><LineStyle><color>${color}</color></LineStyle></Style>`
      const text = `<kml><Document>${definition}<StyleMap id="mapped"><Pair><key>normal</key>
        <styleUrl>#normal</styleUrl></Pair></StyleMap><Placemark id="route"><name>Jalur 1</name>
        ${style === 'inline' ? definition : '<styleUrl>#mapped</styleUrl>'}
        <LineString><coordinates>110,-7 110.001,-7</coordinates></LineString></Placemark></Document></kml>`
      const parsed = parse('dv-color', text)
      const c = parsed.canonicalParser
      assert.equal(c.topologyInputBundle.classifiedPaths.length, 1)
      assert.equal(c.classifiedObjects[0].networkFamily, family)
      assert.equal(c.sourceFeatures[0].resolvedLineColor, color)
      c.classifiedObjects[0].classificationRuleSetVersion = 'old'
      const rebuilt = rebuildStoredTopologyInputBundle({ datasetVersion: version('dv-color'), ...c })
      assert.equal(rebuilt.topologyInputBundle.classifiedPaths[0].networkFamily, family)
    }
  }
  for (const color of ['ff0000ff', '0000ff00', 'ff888888', 'invalid']) assert.equal(networkFromKmlLineColor(color), null)
})

test('complete KMZ adds only new assets and preserves missing/modified baseline assets and corrections', () => {
  const baseline = correctedBaseline(), before = structuredClone(baseline)
  const parsed = parse('dv-next', source(point('C-NEW', 'C-NEW', '110.00021,-7'), '110.001,-7', false), baseline)
  const merged = mergeAdditionsOnlyImport({ ...parsed, baseline })
  const staged = materialize(merged)
  assert.deepEqual(baseline, before)
  assert.equal(staged.assets.length, baseline.assets.length + 1)
  assert.deepEqual(staged.assets.find(a => a.assetId === 'C-01'), copyToVersion(baseline.assets.find(a => a.assetId === 'C-01'), 'dv-next'))
  assert.deepEqual(staged.confirmedRelations.find(r => r.relationId === 'reviewed-network'), copyToVersion(baseline.confirmedRelations[0], 'dv-next'))
  assert.deepEqual(staged.mountingRelations.find(r => r.sourceAssetId === 'C-01'), copyToVersion(baseline.mountingRelations[0], 'dv-next'))
  assert.equal(staged.mountingRelations.find(r => r.sourceAssetId === 'C-NEW')?.targetAssetId, 'T-01')
  assert.equal(staged.importAdditions.addedAssets, 1)
  const replay = mergeAdditionsOnlyImport({ ...parse('dv-replay', source(point('C-NEW', 'C-NEW', '110.00021,-7')), staged), baseline: staged })
  assert.equal(replay.projection.importAdditions.addedAssets, 0)
  assert.equal(replay.projection.assets.length, staged.assets.length)
})

test('a new green route connects a new camera to a preserved JB without nearest-JB shortcut', () => {
  const baseline = correctedBaseline()
  const camera = point('C-NEW', 'C-NEW', '110.00001,-7')
  const route = `<Placemark id="new-route"><name>Jalur baru</name><Style><LineStyle><color>ff00ff55</color></LineStyle></Style>
    <LineString><coordinates>110.001,-7 110.00001,-7</coordinates></LineString></Placemark>`
  const parsed = parse('dv-route', source(camera + route), baseline)
  const staged = materialize(mergeAdditionsOnlyImport({ ...parsed, baseline }))
  assert.ok(staged.topologyCandidates.some(c => c.candidateType === 'cable_termination' && c.targetAssetId === 'C-NEW'))
  assert.ok(!staged.topologyCandidates.some(c => c.candidateType === 'device_nearest_junction' && c.sourceAssetId === 'C-NEW'))
  assert.ok(staged.topologyGraph.edges.some(e => [e.sourceAssetId, e.targetAssetId].includes('C-NEW')
    && [e.sourceAssetId, e.targetAssetId].includes('JB-02')), JSON.stringify(staged.topologyCandidates.map(c => ({
      source: c.sourceAssetId, target: c.targetAssetId, status: c.candidateStatus,
      proposal: c.proposalStatus, score: c.score, kind: c.candidateType,
    }))))
  assert.deepEqual(staged.confirmedRelations.find(r => r.relationId === 'reviewed-network'), copyToVersion(baseline.confirmedRelations[0], 'dv-route'))
})

test('additions activation rejects changed baseline version or corrected record revision', () => {
  const baseline = correctedBaseline()
  const { projection } = mergeAdditionsOnlyImport({ ...parse('dv-next', source(), baseline), baseline })
  assert.doesNotThrow(() => assertAdditionsBaseline(projection, baseline))
  assert.throws(() => assertAdditionsBaseline(projection, { ...baseline, recordRevision: 8 }), { code: 'additions_baseline_changed' })
  assert.throws(() => assertAdditionsBaseline(projection, null), { code: 'additions_baseline_changed' })
})

test('additions retain corrected interface capacity, external occupancy and component registry', () => {
  const baseline = correctedBaseline()
  baseline.topologyInterfaceRegistry = baseline.topologyInterfaceRegistry.map(item =>
    item.ownerAssetId === 'JB-02' ? { ...item, capacity: 1, occupancy: 1, fieldNote: 'Port terpakai di lapangan' } : item)
  baseline.topologyComponentRegistry.push({ componentId: 'reviewed-component', ownerAssetId: 'JB-02',
    componentType: 'switch', fieldNote: 'Inventory terkoreksi', status: 'active' })
  const route = `<Placemark id="full-port-route"><Style><LineStyle><color>ff00ff00</color></LineStyle></Style>
    <LineString><coordinates>110.001,-7 110.00001,-7</coordinates></LineString></Placemark>`
  const staged = materialize(mergeAdditionsOnlyImport({ baseline,
    ...parse('dv-ports', source(point('C-NEW', 'C-NEW', '110.00001,-7') + route), baseline),
  }))
  for (const original of baseline.topologyInterfaceRegistry.filter(item => item.ownerAssetId === 'JB-02')) {
    assert.deepEqual(staged.topologyInterfaceRegistry.find(item => item.interfaceId === original.interfaceId),
      copyToVersion(original, 'dv-ports'))
  }
  assert.ok(!staged.confirmedRelations.some(relation => relation.targetAssetId === 'JB-02'
    && relation.relationKind === 'path_termination' && relation.sourceAssetId === 'full-port-route'))
  assert.deepEqual(staged.topologyComponentRegistry.find(item => item.componentId === 'reviewed-component'),
    baseline.topologyComponentRegistry.find(item => item.componentId === 'reviewed-component'))
})

test('staging and activation in a temporary database keep all baseline data and map/topology agree', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sinergi-additions-test-'))
  try {
    const repository = new JsonDatasetVersionRepository(path.join(root, 'versions'))
    const fileStore = new ImportFileStore(root)
    await fileStore.initialize()
    const baseline = correctedBaseline()
    baseline.datasetVersion.status = 'active'
    await repository.create(baseline)
    const before = await repository.get('dv-baseline')
    const text = source(point('C-NEW', 'C-NEW', '110.00021,-7'), '110.001,-7')
    const sourcePath = path.join(root, 'input.kml')
    await writeFile(sourcePath, text)
    await repository.create({ datasetVersion: { ...version('dv-staged'), status: 'processing',
      contentMode: 'additions_only', baseDatasetVersionId: 'dv-baseline', baseRecordRevision: baseline.recordRevision,
      sourceMimeType: 'application/vnd.google-earth.kml+xml', sourceSize: Buffer.byteLength(text), sourceStorageKey: 'test-source' },
      processing: {} })
    const auditLog = { async record() {} }
    const pipeline = new ImportPipeline({ repository, fileStore, auditLog,
      limits: { maxKmlSize: 1024 * 1024 }, topology: { automaticRelationConfirmation: true } })
    const staged = await pipeline.process({ datasetVersionId: 'dv-staged', sourcePath, extension: '.kml', actorId: 'test' })
    assert.equal(staged.datasetVersion.status, 'valid', JSON.stringify(staged.issues))
    assert.deepEqual(await repository.get('dv-baseline'), before)
    assert.equal(staged.importAdditions.addedAssets, 1)
    assert.equal(staged.datasetVersion.summary.updatedAssets, 0)
    assert.equal(staged.datasetVersion.summary.removedAssets, 0)
    assert.equal(staged.datasetVersion.summary.totalAssets, baseline.assets.length + 1)
    const service = new DatasetVersionLifecycleService({ repository, auditLog })
    await service.activate('dv-staged', 'test', { expectedActiveVersionId: 'dv-baseline' })
    const published = await repository.get('dv-staged')
    for (const key of ['assets', 'geometries', 'classifiedObjects']) {
      const idKey = key === 'classifiedObjects' ? 'classifiedObjectId' : 'id'
      for (const original of baseline[key]) {
        assert.deepEqual(published[key].find(item => item[idKey] === original[idKey]), copyToVersion(original, 'dv-staged'))
      }
    }
    assert.deepEqual(published.confirmedRelations.find(item => item.relationId === 'reviewed-network'), copyToVersion(baseline.confirmedRelations[0], 'dv-staged'))
    const map = await service.getActiveMapDataset({ datasetId: 'dataset-test', branchId: 'site-test' })
    const topology = await service.getActiveDataset({ datasetId: 'dataset-test', branchId: 'site-test' })
    const pairs = edges => edges.map(edge => [edge.sourceAssetId, edge.targetAssetId].sort().join('|')).sort()
    assert.deepEqual(pairs(map.topologyGraph.edges), pairs(topology.topologyGraph.edges))
    assert.ok(map.assets.some(asset => asset.assetId === 'C-NEW'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('ambiguous cable evidence blocks a distance fallback and cannot cross facilities', () => {
  const text = `<kml><Document>${folder('RJBT', folder('Site A',
    folder('CCTV', point('CAM', 'Camera', '110,-7'))
    + folder('Junction Box', point('JA', 'JB A', '110.001,-7') + point('JB', 'JB B', '110.001,-7'))
    + `<Placemark id="path"><Style><LineStyle><color>ff00ff00</color></LineStyle></Style>
      <LineString><coordinates>110,-7 110.001,-7</coordinates></LineString></Placemark>`)
    + folder('Site B', folder('Junction Box', point('OTHER', 'JB Other', '110,-7'))))}</Document></kml>`
  const staged = materialize(parse('dv-ambiguity', text))
  assert.ok(staged.topologyCandidates.some(c => c.candidateStatus === 'ambiguous'))
  assert.ok(!staged.topologyCandidates.some(c => c.candidateType === 'device_nearest_junction' && c.sourceAssetId === 'CAM'))
  assert.ok(!staged.topologyCandidates.some(c => c.candidateType === 'cable_termination' && c.targetAssetId === 'OTHER'))
  assert.ok(!staged.topologyGraph.edges.some(edge => edge.sourceAssetId === 'CAM' || edge.targetAssetId === 'CAM'))
})

test('activation rejects a concurrent baseline correction without rolling the correction back', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sinergi-additions-race-'))
  try {
    const repository = new JsonDatasetVersionRepository(root, { activationHooks: {
      async beforePointerCommit() {
        await repository.update('dv-baseline', current => ({ ...current,
          assets: current.assets.map(asset => asset.assetId === 'C-01'
            ? { ...asset, name: 'Koreksi saat aktivasi' } : asset),
        }))
      },
    } })
    const baseline = correctedBaseline()
    baseline.datasetVersion.status = 'active'
    await repository.create(baseline)
    const staged = materialize(mergeAdditionsOnlyImport({
      ...parse('dv-race', source(point('C-NEW', 'C-NEW', '110.00021,-7')), baseline), baseline,
    }))
    staged.datasetVersion.status = 'valid'
    await repository.create(staged)
    await assert.rejects(repository.activateVersionAtomically({ datasetVersionId: 'dv-race', validateTarget() {} }),
      { code: 'additions_baseline_changed' })
    const corrected = await repository.get('dv-baseline')
    assert.equal(corrected.assets.find(asset => asset.assetId === 'C-01').name, 'Koreksi saat aktivasi')
    assert.equal(corrected.datasetVersion.status, 'active')
    assert.equal((await repository.get('dv-race')).datasetVersion.status, 'valid')
    assert.equal((await repository.findActive('dataset-test', { branchId: 'site-test' })).datasetVersion.id, 'dv-baseline')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('conflicting source ID is reported and cannot silently create or replace a corrected asset', () => {
  const baseline = correctedBaseline()
  const parsed = parse('dv-conflict', source().replace('<value>C-01</value>', '<value>CHANGED-ID</value>'), baseline)
  const merged = mergeAdditionsOnlyImport({ ...parsed, baseline })
  assert.equal(merged.projection.importAdditions.identityConflicts.length, 1)
  assert.equal(merged.projection.importAdditions.addedAssets, 0)
  assert.ok(merged.projection.issues.some(issue => issue.issueCode === 'identity_conflict' && !issue.canActivate))
})

test('known asset folders pass their class through nested subtype and status folders', () => {
  const text = `<kml><Document>${folder('RJBT', folder('Site A',
    folder('CCTV', folder('Outdoor Fix Bullet', point('CAM', 'C-001', '110,-7')))
    + folder('Junction Box', folder('Extended', point('JB', 'JB-01.1', '110.0001,-7')))
    + folder('Tiang', folder('Rekomendasi', point('POLE', 'T-001', '110,-7')))))}</Document></kml>`
  const parsed = parse('dv-subfolders', text)
  assert.equal(parsed.canonicalParser.topologyInputBundle.classifiedNodes.length, 3)
  assert.ok(parsed.canonicalParser.classifiedObjects.every(object => !object.categoryReview))
  const result = materialize(parsed)
  assert.equal(result.mountingRelations.find(relation => relation.sourceAssetId === 'CAM')?.targetAssetId, 'POLE')
})
