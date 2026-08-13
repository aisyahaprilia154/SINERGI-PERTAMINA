export const TOPOLOGY_REVIEW_CONTRACT_VERSION = '2.0.0'

export function resolveTopologyReviewAvailability(summary) {
  const capabilities = summary?.reviewCapabilities
  const available = capabilities?.safePreview === true
    && capabilities?.deltaValidation === true
    && capabilities?.confirmSelected === true
  return {
    available,
    capabilities: capabilities ?? null,
    message: available
      ? ''
      : 'Backend relasi aset belum sinkron dengan UI. Restart atau deploy ulang backend sebelum menyimpan review.',
  }
}

export function describeTopologyReviewFailure(errorOrPreview) {
  const error = errorOrPreview?.safeToApply === undefined ? errorOrPreview : null
  const preview = error?.details?.safeToApply !== undefined
    ? error.details
    : errorOrPreview?.safeToApply !== undefined ? errorOrPreview : null

  if (isMissingReviewEndpoint(error)) {
    return {
      code: 'topology_review_api_unavailable',
      message: 'API relasi aset belum memuat endpoint bulk review. Restart atau deploy ulang backend, lalu muat ulang halaman.',
    }
  }
  if (!preview) {
    return {
      code: error?.code ?? 'topology_review_failed',
      message: error?.message ?? 'Review koneksi gagal diproses.',
    }
  }

  const diagnostics = preview.diagnostics ?? {}
  const validation = preview.validationPreview?.summary ?? {}
  const conflictCount = Number(diagnostics.conflictCount ?? 0)
  const ineligibleCount = Array.isArray(preview.ineligible) ? preview.ineligible.length : 0
  const rawIntroducedErrors = Number(validation.introducedErrors ?? validation.errors ?? 0)
  // Endpoint conflicts are already reported above. Do not present the same
  // blocking issue a second time as a generic validation error.
  const introducedErrors = Math.max(0, rawIntroducedErrors - conflictCount)
  const baselineIssues = Number(diagnostics.baselineIssuesPreserved ?? 0)
  const parts = []
  const identityBlockedCount = (preview.ineligible ?? []).filter(({ reason }) => (
    [
      'candidate_stable_asset_id_required',
      'candidate_topology_identity_stale',
    ].includes(reason)
  )).length

  if (identityBlockedCount > 0) {
    parts.push(`${identityBlockedCount} kandidat belum memiliki Asset ID stabil`)
  }
  if (ineligibleCount > 0) {
    const remaining = ineligibleCount - identityBlockedCount
    if (remaining > 0) {
      parts.push(`${remaining} kandidat sudah berubah atau tidak lagi memenuhi syarat`)
    }
  }
  if (conflictCount > 0) {
    parts.push(`${conflictCount} konflik endpoint harus dipilih satu per satu`)
  }
  if (introducedErrors > 0) {
    const codes = Array.isArray(diagnostics.blockingReasonCodes)
      ? diagnostics.blockingReasonCodes.slice(0, 3).map(humanizeIssueCode).join(', ')
      : ''
    parts.push(`${introducedErrors} validation error baru${codes ? ` (${codes})` : ''}`)
  }
  if (parts.length === 0) parts.push('dry-run belum dapat menjamin batch aman')

  let message = `Batch tidak disimpan: ${parts.join('; ')}.`
  if (baselineIssues > 0 && introducedErrors === 0) {
    message += ` ${baselineIssues} masalah baseline lama tetap tercatat dan tidak dianggap akibat batch ini.`
  }
  if (diagnostics.recommendation?.message) {
    message += ` ${diagnostics.recommendation.message}`
  }
  return {
    code: diagnostics.recommendation?.code ?? 'review_preview_not_safe',
    message,
  }
}

export function isMissingReviewEndpoint(error) {
  return error?.code === 'topology_review_api_unavailable'
    || (error?.status === 404 && error?.code === 'not_found')
}

function humanizeIssueCode(value) {
  return String(value ?? 'unknown')
    .replaceAll('_', ' ')
}
