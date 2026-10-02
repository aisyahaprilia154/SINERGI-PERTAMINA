import { createHash } from 'node:crypto'
import { AppError } from '../errors.js'

export const MAX_ASSET_ICON_BYTES = 128 * 1024

export function decodeAssetIcon(dataUrl) {
  const invalid = () => new AppError('Pilih gambar PNG yang valid untuk ikon aset.', {
    code: 'invalid_asset_icon', statusCode: 400,
  })
  if (typeof dataUrl !== 'string' || dataUrl.length > MAX_ASSET_ICON_BYTES * 1.4
    || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) throw invalid()
  const bytes = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64')
  if (bytes.length < 45 || bytes.length > MAX_ASSET_ICON_BYTES
    || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR'
    || bytes.toString('ascii', bytes.length - 8, bytes.length - 4) !== 'IEND') throw invalid()
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (!width || !height || width > 256 || height > 256) throw invalid()
  return bytes
}

export function projectAssetIcon(record, canonicalAssetId) {
  const override = Object.hasOwn(record.assetIconOverrides ?? {}, canonicalAssetId)
    ? record.assetIconOverrides[canonicalAssetId] : null
  if (!override) return { customIconUrl: null, iconReset: false }
  return {
    customIconUrl: override.dataUrl
      ? `/api/dataset-versions/${encodeURIComponent(record.datasetVersion.id)}`
        + `/asset-icons/${encodeURIComponent(canonicalAssetId)}?v=${override.revision}`
      : null,
    iconReset: !override.dataUrl,
  }
}

export function assetIconRevision(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 20)
}
