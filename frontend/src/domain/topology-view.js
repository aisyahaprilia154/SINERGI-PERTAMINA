export function areaName(area, locationGroups) {
  if (!area) return 'Semua Area'
  return locationGroups?.find(({ key }) => key === area)?.name
    ?? String(area).replaceAll('-', ' ')
}

export function physicalLocation(node, group) {
  const area = node.areaName || node.areaKey || 'Area belum tersedia'
  if (!group) return area
  return `${area} · Mounting ${group.pole?.name || group.poleAssetId} · ${group.childCount} aset terpasang`
}

export function iconForNode(node) {
  const icon = String(node?.iconType ?? '').toLowerCase()
  const type = `${node?.type ?? ''} ${node?.name ?? ''}`.toLowerCase()
  if (icon.includes('server') || /server|nvr|rack/.test(type)) return 'dns'
  if (icon.includes('junction') || /junction|\bjb\b/.test(type)) return 'device_hub'
  if (icon.includes('switch') || /switch|router/.test(type)) return 'router'
  if (icon.includes('cctv') || /cctv|camera|kamera/.test(type)) return 'videocam'
  if (/sensor/.test(type)) return 'sensors'
  if (/printer|peripheral/.test(type)) return 'developer_board'
  return 'hub'
}
