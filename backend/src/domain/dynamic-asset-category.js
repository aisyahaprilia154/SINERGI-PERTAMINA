import { canonicalVocabularyValue } from './publication-contract.js'

const GENERIC_FOLDER_NAMES = new Set([
  'rjbt', 'assets', 'aset', 'devices', 'perangkat', 'points', 'titik',
  'locations', 'lokasi', 'network', 'jaringan',
])

export function proposeAssetCategory({ metadataCategory, folderPath, objectRole, matchedRole }) {
  if (objectRole !== 'device_node') return null
  const explicit = cleanLabel(metadataCategory)
  const folder = String(folderPath ?? '').split('/').map(cleanLabel).filter(Boolean)
  const leaf = folder.at(-1)
  const label = explicit || (!matchedRole && leaf && !GENERIC_FOLDER_NAMES.has(leaf.toLocaleLowerCase('id'))
    ? leaf : null)
  if (!label || canonicalVocabularyValue('category', label)) return null
  return { key: categoryKey(label), label, source: explicit ? 'metadata' : 'folder' }
}

export function categoryKey(label) {
  return cleanLabel(label).toLocaleLowerCase('id')
}

export function categoryReviewSummary(record) {
  const groups = new Map()
  for (const object of record.classifiedObjects ?? []) {
    const review = object.categoryReview
    if (!review?.key) continue
    const current = groups.get(review.key) ?? {
      key: review.key,
      proposedLabel: review.proposedLabel,
      label: object.category,
      source: review.source,
      count: 0,
      status: review.status,
    }
    current.count += 1
    groups.set(review.key, current)
  }
  return [...groups.values()].sort((a, b) => a.proposedLabel.localeCompare(b.proposedLabel, 'id'))
}

export function hasPendingCategoryReview(record) {
  return (record.classifiedObjects ?? []).some(({ categoryReview }) => (
    categoryReview?.status === 'pending'
  ))
}

function cleanLabel(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 80)
}
