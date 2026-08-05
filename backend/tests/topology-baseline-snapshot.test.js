import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  BASELINE_FIXTURE_VERSION,
  createBaselineTopologyBundle,
} from './fixtures/topology-baseline-fixture.js'
import { generateRelationArtifacts } from '../src/topology/semantic-relation-engine.js'

test('topology baseline fixture remains deterministic and reproducible', async () => {
  const artifact = generateRelationArtifacts(createBaselineTopologyBundle(), {
    generatedAt: '2026-08-04T00:00:00.000Z',
  })
  const actual = {
    fixtureVersion: BASELINE_FIXTURE_VERSION,
    datasetVersionId: artifact.datasetVersionId,
    siteId: artifact.siteId,
    topologyRuleSetVersion: artifact.topologyRuleSetVersion,
    semanticRuleSetVersion: artifact.semanticRuleSetVersion,
    summary: artifact.summary,
    candidates: artifact.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      candidateType: candidate.candidateType,
      sourceEndpointId: candidate.sourceEndpointId,
      targetAssetId: candidate.targetAssetId,
      candidateStatus: candidate.candidateStatus,
      proposalStatus: candidate.proposalStatus,
      relationKind: candidate.relationKind,
    })),
    confirmedRelations: artifact.confirmedRelations.map((relation) => ({
      relationId: relation.relationId,
      sourceAssetId: relation.sourceAssetId,
      targetAssetId: relation.targetAssetId,
      relationType: relation.relationType,
      provenance: relation.provenance,
      verificationStatus: relation.verificationStatus,
    })),
    graph: {
      nodeIds: artifact.graph.nodes.map(({ id }) => id),
      edgeIds: artifact.graph.edges.map(({ id }) => id),
      componentCount: artifact.graph.components.length,
      isolatedNodeIds: artifact.graph.isolatedNodeIds,
    },
    readiness: {
      topologyReadiness: artifact.readiness.topologyReadiness,
      blockingReasons: artifact.readiness.blockingReasons,
    },
  }
  const snapshot = JSON.parse(await readFile(
    new URL('./fixtures/topology-baseline.snapshot.json', import.meta.url),
    'utf8',
  ))
  assert.deepEqual(actual, snapshot)
})
