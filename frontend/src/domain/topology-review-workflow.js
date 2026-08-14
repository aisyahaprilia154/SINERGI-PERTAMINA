import { topologyCandidateSupportsBulkReview } from './topology-review-decision.js'

export const REVIEW_QUEUES = Object.freeze([
  Object.freeze({
    id: 'ready',
    label: 'Siap dikonfirmasi',
    description: 'Pilih benar atau salah',
  }),
  Object.freeze({
    id: 'needs_choice',
    label: 'Perlu dipilih',
    description: 'Ada target yang bersaing',
  }),
  Object.freeze({
    id: 'data_issues',
    label: 'Masalah data',
    description: 'Perlu perbaikan data',
  }),
])

const REVIEW_QUEUE_IDS = new Set(REVIEW_QUEUES.map(({ id }) => id))

export function isReviewQueueId(value) {
  return REVIEW_QUEUE_IDS.has(value)
}

export function normalizeReviewQueue(value) {
  if (value === 'needs-review' || value === 'open' || value === 'candidate') return 'ready'
  if (value === 'ambiguous') return 'needs_choice'
  if (value === 'unresolved') return 'data_issues'
  return isReviewQueueId(value) ? value : 'ready'
}

export function reviewQueueForCandidate(candidate = {}) {
  if (isDataIssueCandidate(candidate)) return 'data_issues'
  if (candidate.candidateStatus === 'ambiguous' || candidate.proposalStatus === 'ambiguous') {
    return 'needs_choice'
  }
  if (topologyCandidateSupportsBulkReview(candidate)) return 'ready'
  if (candidate.candidateStatus === 'candidate'
    && candidate.reviewEligibility?.confirmable !== false
    && candidate.proposalStatus !== 'not_selected') {
    return 'ready'
  }
  if (candidate.candidateStatus === 'revoked'
    && candidate.reviewEligibility?.confirmable !== false) {
    return 'ready'
  }
  return 'data_issues'
}

export function isDataIssueCandidate(candidate = {}) {
  if (candidate.reviewEligibility?.identityReady === false) return true
  if (candidate.candidateStatus === 'unresolved') return true
  return [
    'below_threshold',
    'unresolved',
    'missing_jb_termination',
    'interface_unavailable',
    'incompatible_interface',
    'interface_capacity_exceeded',
    'candidate_stable_asset_id_required',
    'candidate_topology_identity_stale',
  ].includes(candidate.proposalStatus)
    || [
      'missing_stable_asset_id',
      'topology_candidate_identity_stale',
      'candidate_stable_asset_id_required',
      'candidate_topology_identity_stale',
    ].includes(candidate.reviewEligibility?.code)
}

export function filterCandidatesByReviewQueue(items = [], queue = 'ready') {
  const normalizedQueue = normalizeReviewQueue(queue)
  return items.filter((candidate) => reviewQueueForCandidate(candidate) === normalizedQueue)
}

export function reviewProgress(items = []) {
  const isCompleted = ({ candidateStatus }) => (
    ['confirmed', 'rejected'].includes(candidateStatus)
  )
  const total = items.filter((candidate) => (
    !isCompleted(candidate)
      && (['candidate', 'ambiguous', 'unresolved', 'revoked'].includes(candidate.candidateStatus)
        || reviewQueueForCandidate(candidate) === 'data_issues')
  )).length
  const completed = items.filter(isCompleted).length
  return {
    completed,
    total: completed + total,
    remaining: total,
  }
}

export function reviewContractForCandidates({
  candidates = [],
  lastGeneratedAt = null,
  readiness = null,
} = {}) {
  if (!lastGeneratedAt && candidates.length === 0) {
    return {
      status: 'preparing',
      confirmable: false,
      userMessage: 'Sistem sedang menyelaraskan identitas aset dan memperbarui koneksi.',
      recoveryAction: null,
    }
  }
  const confirmable = candidates.some((candidate) => (
    reviewQueueForCandidate(candidate) === 'ready'
      && topologyCandidateSupportsBulkReview(candidate)
  ))
  const hasDataIssues = candidates.some(isDataIssueCandidate)
    || readiness?.blockingReasons?.includes('stable_identity_coverage')
  return {
    status: hasDataIssues ? 'needs_data_fix' : 'ready',
    confirmable,
    userMessage: hasDataIssues
      ? 'Beberapa usulan membutuhkan perbaikan data sebelum dapat dikonfirmasi.'
      : null,
    recoveryAction: hasDataIssues ? 'review_data_issues' : null,
  }
}

export function humanReviewReasons(candidate = {}, decisionCandidates = []) {
  const components = candidate.scoreComponents ?? {}
  const evidence = candidate.evidence ?? []
  const reasons = []
  const hasEvidence = (source) => evidence.some((item) => item.source === source)
  const locationMatch = candidate.sourceLocationKey && candidate.targetLocationKey
    ? candidate.sourceLocationKey === candidate.targetLocationKey
    : Number(components.siteContext ?? components.sourceContext ?? 0) >= .7

  if (locationMatch) reasons.push('Lokasi sama')
  if (hasEvidence('name') || Number(components.labelCorrespondence ?? 0) >= .65) {
    reasons.push('Nama kabel cocok')
  }
  if (Number.isFinite(candidate.distanceMeters)
    && candidate.distanceMeters <= 3) {
    reasons.push('Ujung kabel berada dekat perangkat')
  }
  if (Number(components.interfaceCompatibility ?? components.semanticCompatibility ?? 0) >= .65) {
    reasons.push('Tipe jaringan cocok')
  }
  if (candidate.constraintEvidence?.interfaceCapacityAvailable !== false
    && candidate.reviewEligibility?.confirmable !== false) {
    reasons.push('Tidak ada koneksi lain yang berkonflik')
  }
  if (decisionCandidates.length > 1 || Number(candidate.scoreMargin ?? 1) < .12) {
    reasons.push('Ada target lain yang hampir sama kuatnya')
  }
  if (!reasons.length) {
    const fallback = evidence.find((item) => item.explanation && item.source !== 'scoring')
    if (fallback) reasons.push(humanizeEvidence(fallback.explanation))
  }
  if (!reasons.length) reasons.push('Kecocokan ditemukan dari data sumber')
  return reasons.slice(0, 4)
}

function humanizeEvidence(value) {
  return String(value)
    .replace(/^Komponen\s+/i, '')
    .replaceAll('_', ' ')
    .replace(/\.$/, '')
}
