import path from 'node:path'

const MEBIBYTE = 1024 * 1024

export const DEFAULT_METADATA_ALIASES = Object.freeze({
  assetId: ['asset_id', 'assetId', 'Asset ID', 'ASSET_ID', 'kode_aset'],
  assetName: ['asset_name', 'assetName', 'Asset Name', 'nama_aset'],
  category: ['category', 'asset_category', 'kategori'],
  assetType: ['asset_type', 'assetType', 'Asset Type', 'type', 'jenis_aset'],
  branchId: ['branch_id', 'branchId', 'Branch ID', 'kode_cabang'],
  branchName: ['branch_name', 'branchName', 'Branch Name', 'nama_cabang'],
  location: ['location', 'lokasi', 'asset_location'],
  ipAddress: ['ip_address', 'ipAddress', 'IP Address', 'ip'],
  hostname: ['hostname', 'host_name', 'Host Name'],
  status: ['status', 'asset_status'],
  connectedTo: ['connected_to', 'connectedTo', 'Connected To'],
  parentAssetId: ['parent_asset_id', 'parentAssetId', 'Parent Asset ID'],
  upstreamAssetId: ['upstream_asset_id', 'upstreamAssetId', 'Upstream Asset ID'],
  downstreamAssetId: ['downstream_asset_id', 'downstreamAssetId', 'Downstream Asset ID'],
  sourceAssetId: ['source_asset_id', 'sourceAssetId', 'Source Asset ID'],
  targetAssetId: ['target_asset_id', 'targetAssetId', 'Target Asset ID'],
  relationType: ['relation_type', 'relationType', 'Relation Type'],
})

export const DEFAULT_FOLDER_MAPPINGS = Object.freeze([
  {
    category: 'CCTV',
    aliases: [
      'CCTV',
      'Camera',
      'Kamera',
      'Titik CCTV',
      'Jaringan CCTV',
      'Titik Camera',
      'Camera Fix Dome',
      'Camera Fixed',
      'IP Camera',
      'View',
      'View CCTV',
      'View Camera',
    ],
  },
  {
    category: 'CCTV Cable',
    aliases: ['Kabel CCTV', 'CCTV Cable', 'Backbone CCTV'],
  },
  {
    category: 'CCTV Junction Box',
    aliases: [
      'JB',
      'JB CCTV',
      'Junction Box CCTV',
      'Junction Box',
      'Juction Box',
      'Jucntion Box',
      'JB Rekomendasi',
      'JB-Rekomendasi',
    ],
  },
  { category: 'NVR', aliases: ['NVR'] },
  {
    category: 'Fiber Optic',
    aliases: [
      'Fiber Optic',
      'Fibre Optic',
      'FO',
      'Jalur FO',
      'FO Rekomendasi',
      'Jaringan Fiber Optic',
    ],
  },
  { category: 'LAN', aliases: ['LAN', 'UTP', 'Jaringan LAN'] },
  {
    category: 'Infrastructure',
    aliases: [
      'Switch',
      'Server',
      'OTB',
      'Rack',
      'Core',
      'Router',
      'Tiang',
      'Titik',
      'Titik Lokasi',
      'Power',
      'Power PLN',
      'Power AC 220',
      'Power Rekomendasi',
      'STP Rekomendasi',
      'Infrastruktur',
      'Jaringan Infrastruktur',
    ],
  },
  {
    category: 'Peripheral',
    aliases: ['Access Point', 'AP', 'Printer', 'Peripheral', 'Jaringan Peripheral'],
  },
])

export function createConfig(env=process.env,overrides={}) {
 const json=(value,fallback)=>value?JSON.parse(value):fallback
 const number=(value,fallback)=>{const n=Number(value);return Number.isFinite(n)&&n>0?n:fallback}
 const databaseUrl=overrides.database?.databaseUrl ?? env.SINERGI_DATABASE_URL ?? null
 return {host:overrides.host ?? env.SINERGI_HOST ?? '127.0.0.1',port:overrides.port ?? number(env.SINERGI_PORT,5000),
  dataRoot:path.resolve(overrides.dataRoot ?? env.SINERGI_DATA_ROOT ?? '.data'),storageMode:'postgres',
  database:{databaseUrl,poolMax:overrides.database?.poolMax ?? number(env.SINERGI_DATABASE_POOL_MAX,10),ssl:overrides.database?.ssl ?? env.SINERGI_DATABASE_SSL==='true'},
  authTokens:overrides.authTokens ?? json(env.SINERGI_AUTH_TOKENS,{}),
  upload:{maxFileSize:number(env.SINERGI_MAX_UPLOAD_BYTES,50*MEBIBYTE),maxArchiveEntries:number(env.SINERGI_MAX_ARCHIVE_ENTRIES,1000),
   maxExtractedSize:number(env.SINERGI_MAX_EXTRACTED_BYTES,250*MEBIBYTE),maxCompressionRatio:number(env.SINERGI_MAX_COMPRESSION_RATIO,100),
   maxKmlSize:number(env.SINERGI_MAX_KML_BYTES,50*MEBIBYTE),...overrides.upload},
  metadataAliases:overrides.metadataAliases ?? json(env.SINERGI_METADATA_ALIASES,DEFAULT_METADATA_ALIASES),
  folderMappings:overrides.folderMappings ?? json(env.SINERGI_FOLDER_MAPPINGS,DEFAULT_FOLDER_MAPPINGS),
  topology:{searchRadiusMeters:overrides.topology?.searchRadiusMeters ?? overrides.topology?.endpointToleranceMeters ?? number(env.SINERGI_TOPOLOGY_ENDPOINT_TOLERANCE_METERS,6),
   inlineSearchRadiusMeters:overrides.topology?.inlineSearchRadiusMeters ?? number(env.SINERGI_TOPOLOGY_POINT_LINE_TOLERANCE_METERS,2)}
 }
}
