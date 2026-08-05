import { performance } from 'node:perf_hooks'
import {
  createBenchmarkTopologyBundle,
} from '../tests/fixtures/topology-baseline-fixture.js'
import { generateRelationArtifacts } from '../src/topology/semantic-relation-engine.js'

const sizes = parseSizes(process.argv.find((argument) => argument.startsWith('--sizes=')))
const results = sizes.map((pathCount) => benchmark(pathCount))

console.log(JSON.stringify({
  benchmark: 'topology-baseline',
  generatedAt: new Date().toISOString(),
  ruleSetVersion: results[0]?.topologyRuleSetVersion ?? null,
  sizes,
  results,
}, null, 2))

function benchmark(pathCount) {
  const bundle = createBenchmarkTopologyBundle(pathCount)
  const startedAt = performance.now()
  const artifact = generateRelationArtifacts(bundle, {
    generatedAt: '2026-08-04T00:00:00.000Z',
  })
  const durationMs = performance.now() - startedAt
  return {
    pathCount,
    durationMs: Number(durationMs.toFixed(3)),
    rssMiB: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(2)),
    candidateCount: artifact.candidates.length,
    confirmedRelationCount: artifact.confirmedRelations.length,
    unresolvedCount: artifact.unresolved.length,
    validationErrors: artifact.validation.summary.errors,
    topologyRuleSetVersion: artifact.topologyRuleSetVersion,
  }
}

function parseSizes(argument) {
  if (!argument) return [1000, 2000, 4000]
  const sizes = argument.slice('--sizes='.length)
    .split(',')
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0 && value <= 50000)
  if (!sizes.length) throw new Error('Expected --sizes=1000,2000,4000')
  return sizes
}
