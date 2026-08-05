const HISTOGRAM_BUCKETS = Object.freeze([
  0.005,
  0.01,
  0.025,
  0.05,
  0.1,
  0.25,
  0.5,
  1,
  2.5,
  5,
  10,
])

export class MetricsRegistry {
  constructor({ clock = () => new Date() } = {}) {
    this.clock = clock
    this.startedAt = this.clock()
    this.definitions = new Map()
    this.counters = new Map()
    this.gauges = new Map()
    this.histograms = new Map()
  }

  increment(name, labels = {}, value = 1, help = `${name} counter.`) {
    const amount = finiteNumber(value, 0)
    if (amount === 0) return
    const metricName = this.#ensureDefinition(name, 'counter', help)
    addSample(this.counters, metricName, labels, amount)
  }

  setGauge(name, labels = {}, value = 0, help = `${name} gauge.`) {
    const metricName = this.#ensureDefinition(name, 'gauge', help)
    setSample(this.gauges, metricName, labels, finiteNumber(value, 0))
  }

  incrementGauge(name, labels = {}, value = 1, help = `${name} gauge.`) {
    const metricName = this.#ensureDefinition(name, 'gauge', help)
    addSample(this.gauges, metricName, labels, finiteNumber(value, 0))
  }

  replaceGaugeFamily(name, samples = [], help = `${name} gauge.`) {
    const metricName = this.#ensureDefinition(name, 'gauge', help)
    const family = new Map()
    for (const sample of Array.isArray(samples) ? samples : []) {
      const labels = normalizeLabels(sample?.labels)
      family.set(sampleKey(labels), {
        labels,
        value: finiteNumber(sample?.value, 0),
      })
    }
    this.gauges.set(metricName, family)
  }

  observe(name, labels = {}, value = 0, help = `${name} histogram.`) {
    const observation = Math.max(0, finiteNumber(value, 0))
    const metricName = this.#ensureDefinition(name, 'histogram', help)
    const sample = getOrCreateSample(this.histograms, metricName, labels, () => ({
      labels: normalizeLabels(labels),
      count: 0,
      sum: 0,
      buckets: new Map(HISTOGRAM_BUCKETS.map((bucket) => [bucket, 0])),
    }))
    sample.count += 1
    sample.sum += observation
    for (const bucket of HISTOGRAM_BUCKETS) {
      if (observation <= bucket) sample.buckets.set(bucket, sample.buckets.get(bucket) + 1)
    }
  }

  recordHttpRequest({ method, route, statusCode, durationSeconds }) {
    const labels = {
      method: normalizeLabelValue(method, 'UNKNOWN'),
      route: normalizeLabelValue(route, '/unmatched'),
      status: normalizeLabelValue(statusCode, '500'),
    }
    this.increment(
      'topology_api_requests_total',
      labels,
      1,
      'Total HTTP requests handled by the SINERGI API.',
    )
    this.observe(
      'topology_api_request_duration_seconds',
      labels,
      durationSeconds,
      'HTTP request duration in seconds.',
    )
    if (Number(statusCode) >= 500) {
      this.increment(
        'topology_api_request_errors_total',
        labels,
        1,
        'Total HTTP requests ending with a server error.',
      )
    }
  }

  recordJobEnqueued({ jobType, deduplicated = false }) {
    const labels = { job_type: normalizeLabelValue(jobType, 'unknown') }
    this.increment(
      deduplicated
        ? 'topology_job_deduplicated_total'
        : 'topology_jobs_total',
      labels,
      1,
      deduplicated
        ? 'Total durable jobs deduplicated by idempotency.'
        : 'Total durable jobs accepted into the queue.',
    )
  }

  recordJobTransition(job) {
    const labels = {
      job_type: normalizeLabelValue(job?.jobType, 'unknown'),
      status: normalizeLabelValue(job?.status, 'unknown'),
    }
    this.increment(
      'topology_job_transitions_total',
      labels,
      1,
      'Total durable job state transitions observed by this runtime.',
    )
    const startedAt = Date.parse(String(job?.startedAt ?? ''))
    const endedAt = Date.parse(String(job?.completedAt ?? job?.failedAt ?? ''))
    if (Number.isFinite(startedAt) && Number.isFinite(endedAt)) {
      this.observe(
        'topology_job_duration_seconds',
        labels,
        Math.max(0, (endedAt - startedAt) / 1000),
        'Durable job execution duration in seconds.',
      )
    }
    if (job?.status === 'dead_letter') {
      this.increment(
        'topology_job_dead_letter_total',
        { job_type: labels.job_type },
        1,
        'Total durable jobs moved to dead-letter in this runtime.',
      )
    }
  }

  async renderPrometheus() {
    const lines = [
      '# HELP topology_observability_info Observability registry schema information.',
      '# TYPE topology_observability_info gauge',
      'topology_observability_info{schema_version="1.0.0"} 1',
    ]

    for (const name of [...this.definitions.keys()].sort()) {
      const definition = this.definitions.get(name)
      const samples = definition.type === 'counter'
        ? this.counters.get(name)
        : definition.type === 'gauge'
          ? this.gauges.get(name)
          : this.histograms.get(name)
      if (!samples?.size) continue
      lines.push(`# HELP ${name} ${definition.help}`)
      lines.push(`# TYPE ${name} ${definition.type}`)
      if (definition.type === 'histogram') {
        for (const sample of samples.values()) {
          for (const bucket of HISTOGRAM_BUCKETS) {
            lines.push(`${name}_bucket${renderLabels({ ...sample.labels, le: bucket })} ${sample.buckets.get(bucket)}`)
          }
          lines.push(`${name}_bucket${renderLabels({ ...sample.labels, le: '+Inf' })} ${sample.count}`)
          lines.push(`${name}_sum${renderLabels(sample.labels)} ${formatNumber(sample.sum)}`)
          lines.push(`${name}_count${renderLabels(sample.labels)} ${sample.count}`)
        }
      } else {
        for (const sample of samples.values()) {
          lines.push(`${name}${renderLabels(sample.labels)} ${formatNumber(sample.value)}`)
        }
      }
    }

    const memory = process.memoryUsage()
    const cpu = process.cpuUsage()
    const uptime = Math.max(0, (this.clock().getTime() - this.startedAt.getTime()) / 1000)
    const processSamples = [
      ['process_cpu_user_seconds_total', 'counter', 'Process user CPU time in seconds.', cpu.user / 1_000_000],
      ['process_cpu_system_seconds_total', 'counter', 'Process system CPU time in seconds.', cpu.system / 1_000_000],
      ['process_resident_memory_bytes', 'gauge', 'Process resident memory in bytes.', memory.rss],
      ['process_heap_used_bytes', 'gauge', 'Process heap used in bytes.', memory.heapUsed],
      ['process_uptime_seconds', 'gauge', 'Process uptime in seconds.', uptime],
    ]
    for (const [name, type, help, value] of processSamples) {
      lines.push(`# HELP ${name} ${help}`)
      lines.push(`# TYPE ${name} ${type}`)
      lines.push(`${name} ${formatNumber(value)}`)
    }
    return `${lines.join('\n')}\n`
  }

  #ensureDefinition(name, type, help) {
    const metricName = normalizeMetricName(name)
    const existing = this.definitions.get(metricName)
    if (existing) {
      if (existing.type !== type) {
        throw new TypeError(`Metric ${metricName} sudah terdaftar dengan tipe berbeda.`)
      }
      return metricName
    }
    this.definitions.set(metricName, {
      type,
      help: sanitizeHelp(help),
    })
    return metricName
  }
}

export function normalizeHttpRoute(pathname) {
  const value = String(pathname ?? '').split('?')[0]
  if (value === '/health' || value === '/metrics') return value
  const knownRoutes = [
    [/^\/api\/admin\/imports$/, '/api/admin/imports'],
    [/^\/api\/admin\/imports\/[a-zA-Z0-9_-]+$/, '/api/admin/imports/:id'],
    [/^\/api\/admin\/jobs\/[a-zA-Z0-9_-]+$/, '/api/admin/jobs/:id'],
    [/^\/api\/admin\/import-config$/, '/api/admin/import-config'],
    [/^\/api\/datasets\/[a-zA-Z0-9_-]+\/active$/, '/api/datasets/:id/active'],
    [/^\/api\/datasets\/[a-zA-Z0-9_-]+\/active\/assets\/[^/]+$/, '/api/datasets/:id/active/assets/:assetId'],
    [/^\/api\/dataset-versions\/[a-zA-Z0-9_-]+\/topology\/(summary|candidates|graph)$/, '/api/dataset-versions/:id/topology/:projection'],
    [/^\/api\/dataset-versions\/[a-zA-Z0-9_-]+\/topology\/trace$/, '/api/dataset-versions/:id/topology/trace'],
    [/^\/api\/dataset-versions\/[a-zA-Z0-9_-]+\/topology\/regenerate$/, '/api/dataset-versions/:id/topology/regenerate'],
    [/^\/api\/dataset-versions\/[a-zA-Z0-9_-]+\/topology\/(confirm-all|confirm-line-labels|revoke-all)$/, '/api/dataset-versions/:id/topology/:action'],
    [/^\/api\/dataset-versions\/[a-zA-Z0-9_-]+\/source-file$/, '/api/dataset-versions/:id/source-file'],
    [/^\/api\/dataset-versions\/[a-zA-Z0-9_-]+\/overlay-resources\/[^/]+$/, '/api/dataset-versions/:id/overlay-resources/:resourceId'],
    [/^\/api\/dataset-versions\/[a-zA-Z0-9_-]+\/[^/]+$/, '/api/dataset-versions/:id/:projection'],
    [/^\/api\/topology\/candidates\/[^/]+\/(confirm|reject|skip|select-target)$/, '/api/topology/candidates/:id/:action'],
    [/^\/api\/topology\/relations\/[^/]+\/revoke$/, '/api/topology/relations/:id/revoke'],
    [/^\/api\/topology\/relations$/, '/api/topology/relations'],
    [/^\/api\/basemap\/openfreemap\/.*$/, '/api/basemap/openfreemap/:resource'],
  ]
  return knownRoutes.find(([pattern]) => pattern.test(value))?.[1] ?? '/unmatched'
}

function addSample(store, name, labels, amount) {
  const sample = getOrCreateSample(store, name, labels, () => ({
    labels: normalizeLabels(labels),
    value: 0,
  }))
  sample.value += amount
}

function setSample(store, name, labels, value) {
  const sample = getOrCreateSample(store, name, labels, () => ({
    labels: normalizeLabels(labels),
    value: 0,
  }))
  sample.value = value
}

function getOrCreateSample(store, name, labels, create) {
  if (!store.has(name)) store.set(name, new Map())
  const family = store.get(name)
  const normalized = normalizeLabels(labels)
  const key = sampleKey(normalized)
  if (!family.has(key)) family.set(key, create())
  return family.get(key)
}

function sampleKey(labels) {
  return Object.entries(labels)
    .map(([label, value]) => `${label}=${value}`)
    .join('\u001f')
}

function normalizeMetricName(value) {
  const name = String(value ?? '').trim()
  if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(name)) {
    throw new TypeError('Nama metric tidak valid.')
  }
  return name
}

function normalizeLabels(labels) {
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) return {}
  return Object.fromEntries(
    Object.entries(labels)
      .filter(([name]) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name))
      .map(([name, value]) => [name, normalizeLabelValue(value, '')])
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

function normalizeLabelValue(value, fallback) {
  const normalized = String(value ?? '').trim()
  if (!normalized || normalized.length > 128 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    return fallback
  }
  return normalized
}

function renderLabels(labels) {
  const entries = Object.entries(labels ?? {})
    .filter(([name]) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name))
    .sort(([left], [right]) => left.localeCompare(right))
  if (!entries.length) return ''
  return `{${entries.map(([name, value]) => `${name}="${escapeLabelValue(value)}"`).join(',')}}`
}

function escapeLabelValue(value) {
  return String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll('"', '\\"')
}

function sanitizeHelp(value) {
  return String(value ?? 'metric')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    || 'metric'
}

function finiteNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function formatNumber(value) {
  return String(finiteNumber(value, 0))
}
