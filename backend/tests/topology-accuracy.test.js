import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateTopologyAccuracy } from '../src/topology/topology-accuracy.js'

test('held-out evaluation reports precision, recall, coverage, paths, and false component merges', () => {
  const result = evaluateTopologyAccuracy({
    candidates: [{
      candidateId: 'candidate-a',
      sourceEndpointId: 'endpoint-a',
      targetAssetId: 'A',
      distanceMeters: 1,
      score: 0.9,
      proposalStatus: 'recommended',
      candidateStatus: 'candidate',
    }, {
      candidateId: 'candidate-b-wrong',
      sourceEndpointId: 'endpoint-b',
      targetAssetId: 'WRONG',
      distanceMeters: 5,
      score: 0.8,
      proposalStatus: 'recommended',
      candidateStatus: 'candidate',
    }],
    graph: {
      nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
      edges: [{
        sourceAssetId: 'A',
        targetAssetId: 'B',
        verificationStatus: 'confirmed',
      }],
      components: [{
        nodeIds: ['A', 'B'],
      }, {
        nodeIds: ['C'],
      }],
    },
    goldSet: {
      version: 'gold-set/1.0.0',
      endpointConnections: [{
        labelId: 'label-a',
        split: 'held_out',
        sourceEndpointId: 'endpoint-a',
        expectedTargetAssetId: 'A',
      }, {
        labelId: 'label-b',
        split: 'held_out',
        sourceEndpointId: 'endpoint-b',
        expectedTargetAssetId: 'B',
      }, {
        labelId: 'label-c',
        split: 'calibration',
        sourceEndpointId: 'endpoint-c',
        expectedTargetAssetId: null,
      }],
      paths: [{
        pathId: 'path-a-b',
        split: 'held_out',
        assetIds: ['A', 'B'],
      }, {
        pathId: 'path-a-c',
        split: 'held_out',
        assetIds: ['A', 'C'],
      }],
      componentAssertions: [{
        assertionId: 'component-a-b',
        split: 'held_out',
        leftAssetId: 'A',
        rightAssetId: 'B',
        expectedSameComponent: true,
      }, {
        assertionId: 'component-a-c',
        split: 'held_out',
        leftAssetId: 'A',
        rightAssetId: 'C',
        expectedSameComponent: false,
      }],
    },
  })

  assert.equal(result.heldOut.precision, 0.5)
  assert.equal(result.heldOut.recall, 0.5)
  assert.equal(result.heldOut.autoCoverage, 1)
  assert.equal(result.pathAccuracy, 0.5)
  assert.equal(result.componentAccuracy, 1)
  assert.equal(result.falseComponentMergeCount, 0)
  assert.equal(result.heldOut.distanceStrata['0_2m'].correct, 1)
  assert.equal(result.heldOut.distanceStrata['4_6m'].correct, 0)
})
