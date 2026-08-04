import os from 'node:os'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import {
  createBenchmarkTopologyBundle,
} from '../tests/fixtures/topology-baseline-fixture.js'
import { generateRelationArtifacts } from '../src/topology/semantic-relation-engine.js'

const DEFAULT_SIZES = [1000, 2000, 4000]

export function parseBenchmarkOptions(argumentsList = process.argv.slice(2)) {
  const sizesArgument = argumentsList.find((argument) => argument.startsWith('--sizes='))
  const sizes = parseSizes(sizesArgument)
  return {
    sizes,
    maxDurationMs: parseBudget(argumentsList, '--max-duration-ms'),
    maxRssMiB: parseBudget(argumentsList, '--max-rss-mib'),
  }
}

export function runBenchmarkSuite({
  sizes = DEFAULT_SIZES,
  maxDurationMs = null,
  maxRssMiB = null,
} = {}) {
  const results = sizes.map((pathCount) => runBenchmark(pathCount, {
    maxDurationMs,
    maxRssMiB,
  }))
  return {
    benchmark: 'topology-baseline',
    generatedAt: new Date().toISOString(),
    runtime: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuCount: os.cpus().length,
    },
    budgets: {
      maxDurationMs,
      maxRssMiB,
    },
    ruleSetVersion: results[0]?.topologyRuleSetVersion ?? null,
    sizes,
    results,
    violations: results.flatMap((result) => result.budgetViolations),
  }
}

export function runBenchmark(pathCount, {
  maxDurationMs = null,
  maxRssMiB = null,
} = {}) {
  if (!Number.isInteger(pathCount) || pathCount < 1 || pathCount > 50000) {
    throw new Error('pathCount harus integer antara 1 dan 50000.')
  }
  const fixtureStartedAt = performance.now()
  const bundle = createBenchmarkTopologyBundle(pathCount)
  const fixtureBuildMs = performance.now() - fixtureStartedAt
  const startedAt = performance.now()
  const cpuStarted = process.cpuUsage()
  const artifact = generateRelationArtifacts(bundle, {
    generatedAt: '2026-08-04T00:00:00.000Z',
  })
  const cpuUsage = process.cpuUsage(cpuStarted)
  const durationMs = performance.now() - startedAt
  const rssMiB = process.memoryUsage().rss / 1024 / 1024
  const peakRssMiB = process.resourceUsage().maxRSS / 1024
  const observedRssMiB = Math.max(rssMiB, peakRssMiB)
  const budgetViolations = evaluateBudget({
    pathCount,
    durationMs,
    observedRssMiB,
    maxDurationMs,
    maxRssMiB,
  })
  return {
    pathCount,
    fixtureBuildMs: Number(fixtureBuildMs.toFixed(3)),
    durationMs: Number(durationMs.toFixed(3)),
    cpuUserMs: Number((cpuUsage.user / 1000).toFixed(3)),
    cpuSystemMs: Number((cpuUsage.system / 1000).toFixed(3)),
    rssMiB: Number(rssMiB.toFixed(2)),
    peakRssMiB: Number(peakRssMiB.toFixed(2)),
    candidateCount: artifact.candidates.length,
    confirmedRelationCount: artifact.confirmedRelations.length,
    unresolvedCount: artifact.unresolved.length,
    validationErrors: artifact.validation.summary.errors,
    topologyRuleSetVersion: artifact.topologyRuleSetVersion,
    budgetViolations,
  }
}

export function evaluateBudget({
  pathCount,
  durationMs,
  observedRssMiB,
  maxDurationMs = null,
  maxRssMiB = null,
} = {}) {
  const violations = []
  if (maxDurationMs !== null && durationMs > maxDurationMs) {
    violations.push({
      pathCount,
      metric: 'durationMs',
      observed: Number(durationMs.toFixed(3)),
      limit: maxDurationMs,
      message: `Benchmark ${pathCount} path melewati budget runtime.`,
    })
  }
  if (maxRssMiB !== null && observedRssMiB > maxRssMiB) {
    violations.push({
      pathCount,
      metric: 'peakRssMiB',
      observed: Number(observedRssMiB.toFixed(2)),
      limit: maxRssMiB,
      message: `Benchmark ${pathCount} path melewati budget RSS.`,
    })
  }
  return violations
}

function parseSizes(argument) {
  if (!argument) return DEFAULT_SIZES
  const sizes = argument.slice('--sizes='.length)
    .split(',')
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0 && value <= 50000)
  if (!sizes.length) throw new Error('Expected --sizes=1000,2000,4000')
  return sizes
}

function parseBudget(argumentsList, name) {
  const argument = argumentsList.find((value) => value.startsWith(`${name}=`))
  if (!argument) return null
  const value = Number(argument.slice(name.length + 1))
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} harus berupa angka positif.`)
  }
  return value
}

async function main() {
  const report = runBenchmarkSuite(parseBenchmarkOptions())
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (report.violations.length) {
    process.exitCode = 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`[topology-baseline] ${error.message}\n`)
    process.exitCode = 1
  })
}
