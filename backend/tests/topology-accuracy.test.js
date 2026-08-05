import assert from 'node:assert/strict'
import test from 'node:test'
import { createConfig } from '../src/config.js'
import {
  evaluateAccuracyGate,
  evaluateTopologyAccuracy,
} from '../src/topology/topology-accuracy.js'

test('accuracy metrics from environment are not an approval source', () => {
  const config = createConfig({
    SINERGI_TOPOLOGY_AUTO_CONFIRM_SPATIAL: 'true',
    SINERGI_TOPOLOGY_HELD_OUT_PRECISION: '1',
    SINERGI_TOPOLOGY_PATH_ACCURACY: '1',
  })
  assert.equal(config.topology.autoConfirmSpatialInference, true)
  assert.equal(config.topology.heldOutPrecision, null)
  assert.equal(config.topology.pathAccuracy, null)
  assert.equal(config.topology.accuracyArtifact, null)
})

test('accuracy gate requires an approved, current artifact bound to scope and build', () => {
  const artifact = {
    schemaVersion: '1.0.0',
    evaluationId: 'evaluation-1',
    siteId: 'site-1',
    networkFamily: 'cctv',
    goldSetVersion: 'gold-set/1.0.0',
    goldSetChecksum: `sha256:${'a'.repeat(64)}`,
    ruleSetVersion: 'semantic-relation-engine/1.0.0',
    engineBuildSha: 'build-1',
    sampleSize: 200,
    heldOutPrecision: 0.995,
    heldOutRecall: 0.98,
    pathAccuracy: 0.97,
    componentAccuracy: 1,
    falseComponentMergeCount: 0,
    evaluatedAt: '2026-08-01T00:00:00.000Z',
    approvedBy: 'risk-owner-1',
    approvedAt: '2026-08-02T00:00:00.000Z',
    expiresAt: '2026-12-31T00:00:00.000Z',
    status: 'approved',
  }
  const context = {
    artifact,
    requiredRuleSetVersion: 'semantic-relation-engine/1.0.0',
    requiredEngineBuildSha: 'build-1',
    scope: { siteId: 'site-1', networkFamilies: ['cctv'] },
    now: new Date('2026-08-05T00:00:00.000Z'),
  }

  assert.equal(evaluateAccuracyGate(context).approved, true)
  assert.equal(evaluateAccuracyGate({
    ...context,
    artifact: { ...artifact, expiresAt: '2026-08-04T00:00:00.000Z' },
  }).approved, false)
  assert.ok(evaluateAccuracyGate({
    ...context,
    artifact: { ...artifact, engineBuildSha: 'build-old' },
  }).blockingReasons.includes('accuracy_engine_build_mismatch'))
  assert.ok(evaluateAccuracyGate({
    ...context,
    artifact: { ...artifact, status: 'draft' },
  }).blockingReasons.includes('accuracy_artifact_not_approved'))
  assert.ok(evaluateAccuracyGate({
    ...context,
    artifact: { ...artifact, sampleSize: 199 },
  }).blockingReasons.includes('accuracy_sample_size_below_minimum'))
})

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
