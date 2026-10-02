// Read-only comparison against an exported corrected aggregate. This script
// never opens a database connection, activates a version, or writes artifacts.
import { readFile } from 'node:fs/promises'
import { parseKmlText } from '../src/import/kml-parser.js'
import { buildCanonicalParserResult } from '../src/domain/parser-contract.js'
import { hydrateIdentityRegistrySourceAliases } from '../src/domain/canonical-asset-identity.js'
import { generateRelationArtifacts } from '../src/topology/semantic-relation-engine.js'

const [baselinePath, sourcePath] = process.argv.slice(2)
if (!baselinePath || !sourcePath) throw new Error('Usage: node scripts/audit-import-inference.mjs <baseline.json> <source.kml>')
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'))
const parserOutput = parseKmlText(await readFile(sourcePath, 'utf8'))
const datasetVersion = { ...baseline.datasetVersion, id: 'dv-readonly-inference-audit' }
const canonical = buildCanonicalParserResult({
  parserOutput, datasetVersion, autoAssignOnboarding: true,
  sourceSelection: { selectedKmlPath: 'doc.kml' },
  identityRegistry: hydrateIdentityRegistrySourceAliases({
    datasetVersion, sourceFeatures: baseline.sourceFeatures, classifiedObjects: baseline.classifiedObjects,
    identityRegistry: baseline.assetIdentityRegistry ?? baseline.identityRegistry,
  }).identityRegistry,
})
const artifacts = generateRelationArtifacts(canonical.topologyInputBundle, {
  config: { automaticRelationConfirmation: true },
})
const pair = relation => [relation.sourceAssetId, relation.targetAssetId].sort().join('|')
const generatedEdges = new Set(artifacts.graph.edges.map(pair))
const correctedEdges = (baseline.confirmedRelations ?? []).filter(relation =>
  relation.relationKind === 'device_edge' && relation.verificationStatus === 'confirmed'
    && (relation.provenance === 'manual_admin' || relation.manualConfirmation))
const mounts = new Map(artifacts.mountingRelations.map(relation => [relation.sourceAssetId, relation.targetAssetId]))
const correctedMounts = (baseline.mountingRelations ?? []).filter(relation => relation.provenance === 'manual_admin')
const names = new Map((baseline.assets ?? []).map(asset => [asset.canonicalAssetId ?? asset.assetId, asset.name]))
const label = id => names.get(id) ?? id
console.log(JSON.stringify({
  baselineVersion: baseline.datasetVersion.id,
  nodeCount: canonical.topologyInputBundle.classifiedNodes.length,
  pathCount: canonical.topologyInputBundle.classifiedPaths.length,
  generatedNetworkEdges: artifacts.graph.edges.length,
  reviewedNetwork: { total: correctedEdges.length, reproduced: correctedEdges.filter(relation => generatedEdges.has(pair(relation))).length,
    requiresExplicitCorrection: correctedEdges.filter(relation => !generatedEdges.has(pair(relation))).slice(0, 10)
      .map(relation => ({ source: label(relation.sourceAssetId), target: label(relation.targetAssetId) })) },
  reviewedMounting: { total: correctedMounts.length, reproduced: correctedMounts.filter(relation => mounts.get(relation.sourceAssetId) === relation.targetAssetId).length,
    requiresExplicitCorrection: correctedMounts.filter(relation => mounts.get(relation.sourceAssetId) !== relation.targetAssetId).slice(0, 10)
      .map(relation => ({ asset: label(relation.sourceAssetId), correctedPole: label(relation.targetAssetId),
        inferredPole: mounts.has(relation.sourceAssetId) ? label(mounts.get(relation.sourceAssetId)) : null })) },
  note: 'Disagreements with explicit field corrections remain exceptions; this audit does not change the baseline or claim held-out accuracy.',
}, null, 2))
