import assert from 'node:assert/strict'
import test from 'node:test'
import {
  evaluateBudget,
  parseBenchmarkOptions,
  runBenchmark,
} from '../benchmarks/topology-baseline.mjs'

test('topology benchmark parses sizes and optional resource budgets', () => {
  assert.deepEqual(parseBenchmarkOptions([
    '--sizes=10,20',
    '--max-duration-ms=60000',
    '--max-rss-mib=512',
  ]), {
    sizes: [10, 20],
    maxDurationMs: 60000,
    maxRssMiB: 512,
  })
  assert.deepEqual(parseBenchmarkOptions([]), {
    sizes: [1000, 2000, 4000],
    maxDurationMs: null,
    maxRssMiB: null,
  })
})

test('topology benchmark reports deterministic fixture metrics and no violations', () => {
  const result = runBenchmark(3, {
    maxDurationMs: 60_000,
    maxRssMiB: 512,
  })
  assert.equal(result.pathCount, 3)
  assert.equal(result.candidateCount, 0)
  assert.equal(result.validationErrors, 0)
  assert.equal(result.budgetViolations.length, 0)
  assert.ok(result.fixtureBuildMs >= 0)
  assert.ok(result.durationMs >= 0)
  assert.ok(result.cpuUserMs >= 0)
  assert.ok(result.cpuSystemMs >= 0)
  assert.ok(result.peakRssMiB >= 0)
})

test('topology benchmark budget emits actionable violations', () => {
  assert.deepEqual(evaluateBudget({
    pathCount: 10000,
    durationMs: 60_001,
    observedRssMiB: 513,
    maxDurationMs: 60_000,
    maxRssMiB: 512,
  }), [
    {
      pathCount: 10000,
      metric: 'durationMs',
      observed: 60001,
      limit: 60000,
      message: 'Benchmark 10000 path melewati budget runtime.',
    },
    {
      pathCount: 10000,
      metric: 'peakRssMiB',
      observed: 513,
      limit: 512,
      message: 'Benchmark 10000 path melewati budget RSS.',
    },
  ])
})
