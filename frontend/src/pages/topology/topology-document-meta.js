export function topologyDocumentMeta(context = {}) {
  const timestamp = context.publishedAt
  const date = timestamp ? new Date(timestamp) : null
  return {
    version: String(context.version || context.datasetVersionId || 'Belum tercatat'),
    updated: date && Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat('id-ID', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta'}).format(date) + ' WIB'
      : 'Belum tercatat',
  }
}
