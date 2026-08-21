import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPathTopologyModel, MAX_BLOCKS_PER_LANE } from '../src/domain/path-topology-model.js'

test('path topology chooses an explicit core by confirmed degree and naturally orders pole blocks', () => {
  const assets = [
    asset('core-low', 'Core 02', 'Core switch'),
    asset('core-high', 'Core 01', 'Rack server'),
    ...Array.from({ length: 7 }, (_, index) => asset(`pole-${index + 1}`, `T-${index + 1}`, 'Tiang')),
    ...Array.from({ length: 7 }, (_, index) => asset(`cam-${index + 1}`, `C-${index + 1}`, 'CCTV')),
  ]
  const mountingRelations = Array.from({ length: 7 }, (_, index) => mounting(
    `cam-${index + 1}`,
    `pole-${index + 1}`,
  ))
  const edges = [
    edge('core-high', 'pole-1'),
    edge('core-high', 'pole-2'),
    edge('core-high', 'pole-3'),
    edge('core-low', 'pole-7'),
    ...Array.from({ length: 6 }, (_, index) => edge(`pole-${index + 1}`, `pole-${index + 2}`)),
  ]
  const model = buildPathTopologyModel({ assets, graph: graph(assets, edges), mountingRelations })

  assert.equal(model.core.id, 'core-high')
  assert.equal(model.lanes[0].blocks.length, MAX_BLOCKS_PER_LANE)
  assert.equal(model.lanes[1].blocks.length, 1)
  assert.deepEqual(model.poleBlocks.map(({ pole }) => pole.name), [
    'T-1', 'T-2', 'T-3', 'T-4', 'T-5', 'T-6', 'T-7',
  ])
})

test('cable_path is collapsed into edge evidence and never becomes a device card', () => {
  const assets = [
    asset('core', 'CORE', 'Rack server'),
    { ...asset('path', 'FO-01', 'Fiber optic path'), objectRole: 'cable_path' },
    asset('pole', 'T-001', 'Tiang'),
    asset('jb', 'JB-001', 'Junction Box'),
  ]
  const model = buildPathTopologyModel({
    assets,
    graph: graph(assets, [edge('core', 'path'), edge('path', 'jb')]),
    mountingRelations: [mounting('jb', 'pole')],
  })

  assert.equal(model.cablePathCount, 1)
  assert.equal(model.visualizedPhysicalAssetIds.includes('path'), false)
  assert.equal(model.primaryEdges.some(({ family }) => family === 'fiber-optic'), true)
})

test('cycles are preserved as cross edges without duplicating a pole block', () => {
  const assets = [asset('core', 'CORE', 'Core'), asset('p1', 'T-1', 'Tiang'),
    asset('p2', 'T-2', 'Tiang'), asset('p3', 'T-3', 'Tiang'),
    asset('c1', 'C-1', 'CCTV'), asset('c2', 'C-2', 'CCTV'), asset('c3', 'C-3', 'CCTV')]
  const model = buildPathTopologyModel({
    assets,
    graph: graph(assets, [edge('core', 'p1'), edge('p1', 'p2'), edge('p2', 'p3'), edge('p3', 'p1')]),
    mountingRelations: [mounting('c1', 'p1'), mounting('c2', 'p2'), mounting('c3', 'p3')],
  })

  assert.equal(model.poleBlocks.length, 3)
  assert.equal(new Set(model.poleBlocks.map(({ id }) => id)).size, 3)
  assert.equal(model.crossEdges.length, 1)
})

test('only confirmed or manual mounting creates a pole block membership', () => {
  const assets = [asset('core', 'CORE', 'Core'), asset('pole', 'T-1', 'Tiang'),
    asset('confirmed', 'C-1', 'CCTV'), asset('pending', 'C-2', 'CCTV')]
  const model = buildPathTopologyModel({
    assets,
    graph: graph(assets, [edge('core', 'pole'), edge('pole', 'confirmed'), edge('pole', 'pending')]),
    mountingRelations: [
      mounting('confirmed', 'pole'),
      { ...mounting('pending', 'pole'), verificationStatus: 'candidate' },
    ],
  })

  assert.deepEqual(model.poleBlocks[0].assetIds, ['pole', 'confirmed'])
  assert.equal(model.ungroupedConnectedAssets.some(({ id }) => id === 'pending'), true)
  assert.equal(model.visualizedPhysicalAssetIds.length, new Set(model.visualizedPhysicalAssetIds).size)
})

test('conflicting confirmed mounting is not guessed and keeps the child in fallback exactly once', () => {
  const assets = [asset('core', 'CORE', 'Core'), asset('p1', 'T-1', 'Tiang'),
    asset('p2', 'T-2', 'Tiang'), asset('cam', 'C-1', 'CCTV')]
  const model = buildPathTopologyModel({
    assets,
    graph: graph(assets, [edge('core', 'p1'), edge('p1', 'cam')]),
    mountingRelations: [mounting('cam', 'p1'), mounting('cam', 'p2')],
  })

  assert.equal(model.poleBlocks.length, 0)
  assert.equal(model.ungroupedConnectedAssets.filter(({ id }) => id === 'cam').length, 1)
  assert.equal(model.visualizedPhysicalAssetIds.filter((id) => id === 'cam').length, 1)
})

test('disconnected components remain deterministic and every physical asset is represented once', () => {
  const assets = [asset('core', 'CORE', 'Core'), asset('p10', 'T-10', 'Tiang'),
    asset('p2', 'T-2', 'Tiang'), asset('c10', 'C-10', 'CCTV'), asset('c2', 'C-2', 'CCTV'),
    asset('isolated', 'AP-01', 'Access Point')]
  const input = {
    assets,
    mountingRelations: [mounting('c10', 'p10'), mounting('c2', 'p2')],
  }
  const first = buildPathTopologyModel({ ...input, graph: graph(assets, [edge('core', 'p10')]) })
  const second = buildPathTopologyModel({ ...input, graph: graph([...assets].reverse(), [edge('core', 'p10')]) })

  assert.deepEqual(first.poleBlocks.map(({ pole }) => pole.name), ['T-10', 'T-2'])
  assert.deepEqual(first.poleBlocks.map(({ pole }) => pole.name), second.poleBlocks.map(({ pole }) => pole.name))
  assert.equal(first.uninstalledEndpoints.some(({ sourceAssetId }) => sourceAssetId === 'isolated'), true)
  assert.equal(first.visualizedPhysicalAssetIds.length, assets.length)
  assert.equal(new Set(first.visualizedPhysicalAssetIds).size, assets.length)
})

function asset(id, name, type) {
  return { id, name, type, category: /cctv/i.test(type) ? 'cctv' : 'infrastructure' }
}

function mounting(sourceAssetId, targetAssetId) {
  return { relationType: 'mounted_on', verificationStatus: 'confirmed', sourceAssetId, targetAssetId }
}

function edge(sourceAssetId, targetAssetId) {
  return { id: `${sourceAssetId}-${targetAssetId}`, sourceAssetId, targetAssetId, verificationStatus: 'confirmed' }
}

function graph(assets, edges) {
  return { nodes: assets.map(({ id, type }) => ({ id, assetId: id, assetType: type })), edges }
}
