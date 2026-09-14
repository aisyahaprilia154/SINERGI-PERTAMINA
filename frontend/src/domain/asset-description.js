export function assetDescription(asset) {
  const folder = String(asset?.sourceFolderPath ?? '').replaceAll('\\', '/').split('/').at(-1)
  const rawType = asset?.type ?? asset?.assetType ?? 'Aset'
  const type = /camera|kamera/i.test(folder) ? folder
    : ({junction_box: 'Junction Box', server_rack: 'Server Rack', cctv: 'Kamera CCTV'}[rawType]
      ?? rawType.replaceAll('_', ' '))
  const placement = asset?.mountingExpectation === 'indoor' && !/indoor/i.test(type) ? ' · Indoor' : ''
  return `${type}${placement}`
}
