const VALID_GEOMETRY_TYPES = new Set([
  'point',
  'line_string',
  'polygon',
  'multi_geometry',
])

const SOURCE_MIME_TYPES = Object.freeze({
  '.kml': new Set([
    'application/vnd.google-earth.kml+xml',
    'application/xml',
    'text/xml',
  ]),
  '.kmz': new Set([
    'application/vnd.google-earth.kmz',
    'application/zip',
    'application/x-zip-compressed',
    'application/octet-stream',
  ]),
})

const ISSUE_CODE_ALIASES = Object.freeze({
  unsupported_file_extension: 'FILE_INVALID_TYPE',
  invalid_mime_type: 'FILE_INVALID_TYPE',
  empty_upload: 'FILE_EMPTY',
  file_too_large: 'FILE_TOO_LARGE',
  invalid_kmz_signature: 'KMZ_ARCHIVE_INVALID',
  kmz_too_many_entries: 'KMZ_ARCHIVE_INVALID',
  encrypted_kmz: 'KMZ_ARCHIVE_INVALID',
  kmz_extracted_size_exceeded: 'KMZ_ARCHIVE_INVALID',
  kmz_compression_ratio_exceeded: 'KMZ_ARCHIVE_INVALID',
  kmz_unsafe_path: 'KMZ_ARCHIVE_INVALID',
  kmz_zip_slip: 'KMZ_ARCHIVE_INVALID',
  corrupt_kmz: 'KMZ_ARCHIVE_INVALID',
  kmz_without_kml: 'KML_MAIN_FILE_MISSING',
  invalid_kml_signature: 'KML_XML_INVALID',
  kml_too_large: 'FILE_TOO_LARGE',
  kmz_without_valid_kml: 'KML_MAIN_FILE_MISSING',
  invalid_kml_xml: 'KML_XML_INVALID',
  kml_parse_failed: 'KML_XML_INVALID',
  missing_kml_root: 'KML_ROOT_MISSING',
  unsafe_xml_declaration: 'KML_XML_UNSAFE',
  missing_asset_id: 'ASSET_ID_MISSING',
  duplicate_asset_id: 'ASSET_ID_DUPLICATE',
  unmapped_folder: 'CATEGORY_UNMAPPED',
  missing_geometry: 'GEOMETRY_EMPTY',
  unsupported_geometry: 'GEOMETRY_TYPE_UNSUPPORTED',
  invalid_geometry_coordinates: 'COORDINATE_INVALID',
  invalid_coordinate: 'COORDINATE_INVALID',
  invalid_point_coordinate_count: 'POINT_COORDINATE_INVALID',
  line_too_short: 'LINESTRING_TOO_SHORT',
  polygon_missing_outer_ring: 'POLYGON_RING_INVALID',
  polygon_invalid_inner_ring: 'POLYGON_RING_INVALID',
  polygon_ring_too_short: 'POLYGON_RING_INVALID',
  invalid_polygon_ring: 'POLYGON_RING_INVALID',
  empty_multi_geometry: 'MULTIGEOMETRY_EMPTY',
  polygon_ring_closed: 'POLYGON_RING_CLOSED',
  unknown_relation_reference: 'RELATION_TARGET_NOT_FOUND',
  unknown_relation_path_asset: 'RELATION_PATH_ASSET_NOT_FOUND',
  incomplete_relation_reference: 'RELATION_REFERENCE_INCOMPLETE',
  duplicate_relation_id: 'RELATION_DUPLICATE',
  topology_connection_ambiguous: 'TOPOLOGY_CONNECTION_AMBIGUOUS',
  topology_endpoint_unresolved: 'TOPOLOGY_ENDPOINT_UNRESOLVED',
  unsupported_kml_element: 'STRUCTURE_UNSUPPORTED',
  parser_placemark_coverage_mismatch: 'KML_PLACEMARK_COVERAGE_MISMATCH',
  parser_overlay_coverage_mismatch: 'KML_OVERLAY_COVERAGE_MISMATCH',
  ignored_kmz_resource: 'KMZ_RESOURCE_IGNORED',
  multiple_kml_candidates: 'KML_MULTIPLE_MAIN_CANDIDATES',
  unselected_kml_features: 'KML_UNSELECTED_FEATURES',
  multiple_kml_documents_merged: 'KML_DOCUMENTS_MERGED',
  local_network_link_merged: 'KML_LOCAL_NETWORK_LINK_MERGED',
  invalid_kml_candidate: 'KML_CANDIDATE_INVALID',
  branch_metadata_mismatch: 'BRANCH_CONTEXT_MISMATCH',
  duplicate_source_checksum: 'DUPLICATE_SOURCE_CHECKSUM',
})

const CODE_SCOPES = Object.freeze({
  FILE_INVALID_TYPE: 'file',
  FILE_EMPTY: 'file',
  FILE_TOO_LARGE: 'file',
  FILE_REFERENCE_MISSING: 'file',
  FILE_CHECKSUM_MISSING: 'file',
  KMZ_ARCHIVE_INVALID: 'file',
  KMZ_RESOURCE_IGNORED: 'file',
  KML_MAIN_FILE_MISSING: 'file',
  KML_MULTIPLE_MAIN_CANDIDATES: 'file',
  KML_UNSELECTED_FEATURES: 'file',
  KML_DOCUMENTS_MERGED: 'file',
  KML_LOCAL_NETWORK_LINK_MERGED: 'structure',
  KML_CANDIDATE_INVALID: 'file',
  DUPLICATE_SOURCE_CHECKSUM: 'file',
  KML_XML_INVALID: 'file',
  KML_XML_UNSAFE: 'file',
  KML_ROOT_MISSING: 'structure',
  KML_DOCUMENT_MISSING: 'structure',
  KML_PLACEMARK_MISSING: 'structure',
  KML_PLACEMARK_COVERAGE_MISMATCH: 'structure',
  KML_OVERLAY_COVERAGE_MISMATCH: 'structure',
  STRUCTURE_UNSUPPORTED: 'structure',
  NETWORK_LINK_IGNORED: 'structure',
  STYLE_UNSUPPORTED: 'structure',
  ASSET_ID_MISSING: 'asset',
  ASSET_ID_DUPLICATE: 'asset',
  ASSET_NAME_MISSING: 'asset',
  CATEGORY_UNMAPPED: 'asset',
  ASSET_TYPE_UNMAPPED: 'asset',
  BRANCH_CONTEXT_MISMATCH: 'asset',
  GEOMETRY_EMPTY: 'geometry',
  GEOMETRY_TYPE_UNSUPPORTED: 'geometry',
  COORDINATE_INVALID: 'geometry',
  POINT_COORDINATE_INVALID: 'geometry',
  LINESTRING_TOO_SHORT: 'geometry',
  POLYGON_RING_INVALID: 'geometry',
  POLYGON_RING_CLOSED: 'geometry',
  MULTIGEOMETRY_EMPTY: 'geometry',
  MULTIGEOMETRY_NORMALIZED: 'geometry',
  RELATION_SOURCE_NOT_FOUND: 'relation',
  RELATION_TARGET_NOT_FOUND: 'relation',
  RELATION_PATH_ASSET_NOT_FOUND: 'relation',
  RELATION_REFERENCE_INCOMPLETE: 'relation',
  RELATION_VERSION_MISMATCH: 'relation',
  RELATION_SELF_REFERENCE: 'relation',
  RELATION_DUPLICATE: 'relation',
  RELATION_CYCLE_DETECTED: 'relation',
  TOPOLOGY_CONNECTION_AMBIGUOUS: 'relation',
  TOPOLOGY_ENDPOINT_UNRESOLVED: 'relation',
  METADATA_REQUIRED_MISSING: 'metadata',
  METADATA_ALIAS_APPLIED: 'metadata',
  DESCRIPTION_SANITIZED: 'metadata',
  VERSION_OBJECT_MISMATCH: 'version_integrity',
  ACTIVE_VERSION_MUTATION_ATTEMPT: 'version_integrity',
  PARTIAL_VERSION_PUBLICATION_ATTEMPT: 'version_integrity',
})

/**
 * Consolidates parser and adapter validation into a stable result for API,
 * import preview, summary cards, issue filters, and map focus actions.
 */
export class DatasetVersionValidationService {
  constructor({
    requireAssetName = false,
    requiredMetadataFields = [],
    maxFileSize = 50 * 1024 * 1024,
  } = {}) {
    this.requireAssetName = requireAssetName === true
    this.requiredMetadataFields = Array.isArray(requiredMetadataFields)
      ? requiredMetadataFields.map(String).map((field) => field.trim()).filter(Boolean)
      : []
    this.maxFileSize = Number.isFinite(maxFileSize) && maxFileSize > 0
      ? maxFileSize
      : 50 * 1024 * 1024
  }

  validate({
    result,
    parserOutput,
    sourceSelection,
    expectedBranchId,
  }) {
    const normalized = structuredClone(result)
    const datasetVersion = normalized.datasetVersion
    const issues = createIssueCollector(datasetVersion.id, normalized.issues)
    const parserStructure = parserOutput?.structure ?? {}

    validateFile({
      datasetVersion,
      sourceSelection,
      maxFileSize: this.maxFileSize,
      issues,
    })
    validateStructure({
      parserOutput,
      parserStructure,
      issues,
    })
    validateAssets({
      assets: normalized.assets,
      expectedBranchId: expectedBranchId ?? datasetVersion.branchId,
      requireAssetName: this.requireAssetName,
      requiredMetadataFields: this.requiredMetadataFields,
      issues,
    })
    validateGeometries({
      assets: normalized.assets,
      geometries: normalized.geometries,
      issues,
    })
    validateRelations({
      datasetVersionId: datasetVersion.id,
      assets: normalized.assets,
      relations: normalized.relations,
      issues,
    })
    validateVersionIntegrity({
      result: normalized,
      expectedBranchId: expectedBranchId ?? datasetVersion.branchId,
      issues,
    })

    normalized.issues = issues.list()
    const validation = buildValidationResult(normalized.issues, datasetVersion)
    normalized.validation = validation
    datasetVersion.validationStatus = validation.canActivate ? 'valid' : 'invalid'
    datasetVersion.status = validation.canActivate ? 'valid' : 'invalid'
    datasetVersion.publicationStatus = 'unpublished'
    datasetVersion.summary = {
      ...datasetVersion.summary,
      errors: validation.summary.errors,
      warnings: validation.summary.warnings,
    }
    return normalized
  }

  createFailure({
    record,
    error,
  }) {
    const failed = structuredClone(record)
    const datasetVersion = failed.datasetVersion
    const issues = createIssueCollector(datasetVersion.id, failed.issues)
    issues.add({
      severity: 'error',
      issueCode: canonicalIssueCode(error?.code ?? 'IMPORT_PROCESSING_FAILED'),
      sourceIssueCode: error?.code,
      message: error?.expose
        ? error.message
        : 'Import gagal karena kesalahan internal.',
      scope: scopeForCode(canonicalIssueCode(error?.code ?? 'IMPORT_PROCESSING_FAILED')),
      details: error?.expose && error?.details ? structuredClone(error.details) : undefined,
    })

    failed.issues = issues.list()
    failed.validation = buildValidationResult(failed.issues, datasetVersion)
    failed.datasetVersion.validationStatus = 'invalid'
    failed.datasetVersion.status = 'invalid'
    failed.datasetVersion.publicationStatus = 'unpublished'
    failed.datasetVersion.summary = {
      ...failed.datasetVersion.summary,
      errors: failed.validation.summary.errors,
      warnings: failed.validation.summary.warnings,
    }
    return failed
  }
}

function validateFile({
  datasetVersion,
  sourceSelection,
  maxFileSize,
  issues,
}) {
  if (datasetVersion.duplicateSourceChecksum === true) {
    issues.add({
      severity: 'warning',
      issueCode: 'DUPLICATE_SOURCE_CHECKSUM',
      message: 'Checksum sumber sama dengan dataset version pada dataset dan branch ini; lanjutkan hanya bila metadata versi memang berbeda.',
      scope: 'file',
      details: {
        duplicateVersionIds: datasetVersion.duplicateSourceChecksumVersionIds ?? [],
      },
    })
  }
  const extension = extensionOf(datasetVersion.sourceFilename)
  if (!['.kml', '.kmz'].includes(extension)) {
    issues.add({
      severity: 'error',
      issueCode: 'FILE_INVALID_TYPE',
      message: 'Dataset version tidak merujuk file KML atau KMZ.',
      scope: 'file',
    })
  }
  const mimeType = String(datasetVersion.sourceMimeType ?? '').split(';')[0].trim().toLowerCase()
  if (!SOURCE_MIME_TYPES[extension]?.has(mimeType)) {
    issues.add({
      severity: 'error',
      issueCode: 'FILE_INVALID_TYPE',
      message: 'MIME type file sumber tidak sesuai dengan ekstensi KML/KMZ.',
      scope: 'file',
      details: { extension, mimeType },
    })
  }

  if (!Number.isInteger(datasetVersion.sourceSize) || datasetVersion.sourceSize <= 0) {
    issues.add({
      severity: 'error',
      issueCode: 'FILE_EMPTY',
      message: 'Ukuran file sumber tidak valid atau kosong.',
      scope: 'file',
    })
  }
  if (Number.isFinite(datasetVersion.sourceSize) && datasetVersion.sourceSize > maxFileSize) {
    issues.add({
      severity: 'error',
      issueCode: 'FILE_TOO_LARGE',
      message: 'Ukuran file sumber melebihi batas validasi.',
      scope: 'file',
      details: { maxFileSize },
    })
  }
  if (!String(datasetVersion.checksum ?? '').startsWith('sha256:')) {
    issues.add({
      severity: 'error',
      issueCode: 'FILE_CHECKSUM_MISSING',
      message: 'Checksum SHA-256 file sumber belum tersedia.',
      scope: 'file',
    })
  }
  if (!String(datasetVersion.sourceStorageKey ?? '').trim()) {
    issues.add({
      severity: 'error',
      issueCode: 'FILE_REFERENCE_MISSING',
      message: 'Referensi immutable file sumber belum tersedia.',
      scope: 'file',
    })
  }
  if (!String(sourceSelection?.selectedKmlPath ?? '').toLowerCase().endsWith('.kml')) {
    issues.add({
      severity: 'error',
      issueCode: 'KML_MAIN_FILE_MISSING',
      message: 'File KML utama yang diproses belum tercatat.',
      scope: 'file',
    })
  }
}

function validateStructure({ parserOutput, parserStructure, issues }) {
  if (!parserOutput || typeof parserOutput !== 'object') {
    issues.add({
      severity: 'error',
      issueCode: 'KML_XML_INVALID',
      message: 'Output parser KML tidak tersedia.',
      scope: 'file',
    })
    return
  }
  if (parserStructure.hasKmlRoot !== true) {
    issues.add({
      severity: 'error',
      issueCode: 'KML_ROOT_MISSING',
      message: 'Root KML tidak tersedia atau tidak dapat dibaca.',
      scope: 'structure',
    })
  }
  if (!Number.isInteger(parserStructure.documentCount) || parserStructure.documentCount < 1) {
    issues.add({
      severity: 'error',
      issueCode: 'KML_DOCUMENT_MISSING',
      message: 'Document KML wajib tersedia.',
      scope: 'structure',
    })
  }
  if (!Number.isInteger(parserStructure.placemarkCount) || parserStructure.placemarkCount < 1) {
    issues.add({
      severity: 'error',
      issueCode: 'KML_PLACEMARK_MISSING',
      message: 'Tidak ada Placemark yang dapat diproses.',
      scope: 'structure',
    })
  }
}

function validateAssets({
  assets,
  expectedBranchId,
  requireAssetName,
  requiredMetadataFields,
  issues,
}) {
  const seenAssetIds = new Set()
  assets.forEach((asset) => {
    const focus = focusFor({ asset })
    if (!String(asset.assetId ?? '').trim()) {
      issues.add({
        severity: 'error',
        issueCode: 'ASSET_ID_MISSING',
        message: 'Asset ID wajib tersedia.',
        scope: 'asset',
        focus,
      })
    } else if (seenAssetIds.has(asset.assetId)) {
      issues.add({
        severity: 'error',
        issueCode: 'ASSET_ID_DUPLICATE',
        message: `Asset ID ${asset.assetId} duplikat dalam dataset version.`,
        scope: 'asset',
        focus,
      })
    }
    seenAssetIds.add(asset.assetId)

    if (requireAssetName && isGeneratedOrEmptyName(asset)) {
      issues.add({
        severity: 'error',
        issueCode: 'ASSET_NAME_MISSING',
        message: `Nama asset ${asset.assetId} wajib tersedia dari sumber.`,
        scope: 'asset',
        focus,
      })
    }
    if (['unmapped', 'uncategorized', 'unknown', ''].includes(
      String(asset.category ?? '').trim().toLowerCase(),
    )) {
      issues.add({
        severity: 'warning',
        issueCode: 'CATEGORY_UNMAPPED',
        message: `Kategori asset ${asset.assetId} belum dapat dipetakan.`,
        scope: 'asset',
        focus,
      })
    }
    if (['unknown', 'unmapped', ''].includes(String(asset.type ?? '').trim().toLowerCase())) {
      issues.add({
        severity: 'warning',
        issueCode: 'ASSET_TYPE_UNMAPPED',
        message: `Jenis asset ${asset.assetId} belum tersedia atau belum dapat dipetakan.`,
        scope: 'asset',
        focus,
      })
    }
    if (asset.branchId !== expectedBranchId) {
      issues.add({
        severity: 'error',
        issueCode: 'BRANCH_CONTEXT_MISMATCH',
        message: `Asset ${asset.assetId} berasal dari kantor cabang yang berbeda.`,
        scope: 'asset',
        focus,
      })
    }

    const semantic = asset.properties?.semanticMetadata ?? {}
    requiredMetadataFields.forEach((field) => {
      if (!hasValue(semantic[field])) {
        issues.add({
          severity: 'error',
          issueCode: 'METADATA_REQUIRED_MISSING',
          message: `Metadata wajib ${field} tidak tersedia pada asset ${asset.assetId}.`,
          scope: 'metadata',
          focus,
          details: { metadataField: field },
        })
      }
    })

    const mappings = Array.isArray(asset.properties?.metadataMapping)
      ? asset.properties.metadataMapping
      : []
    if (mappings.length) {
      issues.add({
        severity: 'information',
        issueCode: 'METADATA_ALIAS_APPLIED',
        message: `${mappings.length} alias metadata diterapkan pada asset ${asset.assetId}.`,
        scope: 'metadata',
        focus,
        details: {
          mappings: mappings.map(({ targetField, sourceKey }) => ({ targetField, sourceKey })),
        },
      })
    }

    const sourceDescription = asset.properties?.sourceDescription
    const description = asset.properties?.description
    if (hasValue(sourceDescription) && sourceDescription !== description) {
      issues.add({
        severity: 'information',
        issueCode: 'DESCRIPTION_SANITIZED',
        message: `Description asset ${asset.assetId} disanitasi menjadi plain text.`,
        scope: 'metadata',
        focus,
      })
    }
  })
}

function validateGeometries({ assets, geometries, issues }) {
  const assetByNodeId = new Map(assets.map((asset) => [asset.id, asset]))
  const geometryCountByAsset = new Map()

  geometries.forEach((geometry) => {
    const asset = assetByNodeId.get(geometry.assetNodeId)
    const focus = focusFor({ asset, geometry })
    geometryCountByAsset.set(
      geometry.assetNodeId,
      (geometryCountByAsset.get(geometry.assetNodeId) ?? 0) + 1,
    )
    if (!VALID_GEOMETRY_TYPES.has(geometry.geometryType)) {
      issues.add({
        severity: 'error',
        issueCode: 'GEOMETRY_TYPE_UNSUPPORTED',
        message: `Geometry ${geometry.id} menggunakan type yang tidak didukung.`,
        scope: 'geometry',
        focus,
      })
      return
    }
    validateGeometryCoordinates(geometry.geometryType, geometry.coordinates, {
      geometry,
      focus,
      issues,
    })
  })

  assets.forEach((asset) => {
    if (!geometryCountByAsset.has(asset.id)) {
      issues.add({
        severity: 'warning',
        issueCode: 'GEOMETRY_EMPTY',
        message: `Asset ${asset.assetId} tidak mempunyai geometry yang dapat ditampilkan.`,
        scope: 'geometry',
        focus: focusFor({ asset }),
      })
    }
  })
}

function validateGeometryCoordinates(type, coordinates, context) {
  if (type === 'point') {
    if (!isValidPosition(coordinates)) {
      addCoordinateError(context, 'Point tidak mempunyai koordinat longitude dan latitude valid.')
    }
    return
  }
  if (type === 'line_string') {
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      context.issues.add({
        severity: 'error',
        issueCode: 'LINESTRING_TOO_SHORT',
        message: 'LineString minimal mempunyai dua koordinat.',
        scope: 'geometry',
        focus: context.focus,
      })
      return
    }
    if (!coordinates.every(isValidPosition)) {
      addCoordinateError(context, 'LineString mempunyai koordinat invalid.')
    }
    return
  }
  if (type === 'polygon') {
    if (!Array.isArray(coordinates) || !coordinates.length
      || !coordinates.every(isValidRing)) {
      context.issues.add({
        severity: 'error',
        issueCode: 'POLYGON_RING_INVALID',
        message: 'Polygon tidak mempunyai ring tertutup yang valid.',
        scope: 'geometry',
        focus: context.focus,
      })
    }
    return
  }
  if (type === 'multi_geometry') {
    if (!Array.isArray(coordinates) || !coordinates.length) {
      context.issues.add({
        severity: 'error',
        issueCode: 'MULTIGEOMETRY_EMPTY',
        message: 'MultiGeometry tidak mempunyai child geometry yang dapat dinormalisasi.',
        scope: 'geometry',
        focus: context.focus,
      })
      return
    }
    context.issues.add({
      severity: 'information',
      issueCode: 'MULTIGEOMETRY_NORMALIZED',
      message: 'MultiGeometry dinormalisasi menjadi daftar child geometry tanpa mengubah koordinat.',
      scope: 'geometry',
      focus: context.focus,
    })
    coordinates.forEach((child) => {
      if (!VALID_GEOMETRY_TYPES.has(child?.geometryType)
        || child.geometryType === 'multi_geometry') {
        context.issues.add({
          severity: 'error',
          issueCode: 'GEOMETRY_TYPE_UNSUPPORTED',
          message: 'MultiGeometry mempunyai child geometry yang tidak didukung.',
          scope: 'geometry',
          focus: context.focus,
        })
        return
      }
      validateGeometryCoordinates(child.geometryType, child.coordinates, context)
    })
  }
}

function validateRelations({
  datasetVersionId,
  assets,
  relations,
  issues,
}) {
  const assetIds = new Set(assets.flatMap((asset) => [
    asset.assetId,
    asset.canonicalAssetId,
    asset.id,
    ...(asset.identityAliases
      ? Object.values(asset.identityAliases).flat()
      : []),
  ].filter(Boolean)))
  const semanticRelations = new Set()

  relations.forEach((relation) => {
    const focus = focusFor({ relation })
    if (relation.datasetVersionId !== datasetVersionId) {
      issues.add({
        severity: 'error',
        issueCode: 'RELATION_VERSION_MISMATCH',
        message: `Relation ${relation.id} berasal dari dataset version berbeda.`,
        scope: 'relation',
        focus,
      })
    }
    if (!assetIds.has(relation.sourceAssetId)) {
      issues.add({
        severity: 'error',
        issueCode: 'RELATION_SOURCE_NOT_FOUND',
        message: `Source asset ${relation.sourceAssetId} tidak tersedia pada dataset version ini.`,
        scope: 'relation',
        focus,
      })
    }
    if (!assetIds.has(relation.targetAssetId)) {
      issues.add({
        severity: 'error',
        issueCode: 'RELATION_TARGET_NOT_FOUND',
        message: `Target asset ${relation.targetAssetId} tidak tersedia pada dataset version ini.`,
        scope: 'relation',
        focus,
      })
    }
    if (relation.sourceAssetId === relation.targetAssetId) {
      issues.add({
        severity: 'warning',
        issueCode: 'RELATION_SELF_REFERENCE',
        message: `Relation ${relation.id} menghubungkan asset ke dirinya sendiri.`,
        scope: 'relation',
        focus,
      })
    }
    const signature = [
      relation.sourceAssetId,
      relation.targetAssetId,
      relation.relationType,
      relation.pathAssetId ?? '',
    ].join('|')
    if (semanticRelations.has(signature)) {
      issues.add({
        severity: 'warning',
        issueCode: 'RELATION_DUPLICATE',
        message: `Relation ${relation.sourceAssetId} ke ${relation.targetAssetId} duplikat.`,
        scope: 'relation',
        focus,
      })
    }
    semanticRelations.add(signature)
  })

  detectRelationCycles(relations, assetIds).forEach((assetId) => {
    issues.add({
      severity: 'information',
      issueCode: 'RELATION_CYCLE_DETECTED',
      message: `Cycle relation terdeteksi melalui asset ${assetId}; traversal wajib memakai visited set.`,
      scope: 'relation',
      focus: { assetId },
    })
  })
}

function validateVersionIntegrity({ result, expectedBranchId, issues }) {
  const version = result.datasetVersion
  const collections = [
    ['layer', result.layers],
    ['asset', result.assets],
    ['relation', result.relations],
  ]
  collections.forEach(([kind, records]) => {
    records.forEach((record) => {
      if (record.datasetVersionId !== version.id) {
        issues.add({
          severity: 'error',
          issueCode: 'VERSION_OBJECT_MISMATCH',
          message: `${kind} ${record.id} berasal dari dataset version berbeda.`,
          scope: 'version_integrity',
          focus: focusFor({
            asset: kind === 'asset' ? record : undefined,
            relation: kind === 'relation' ? record : undefined,
          }),
        })
      }
    })
  })
  if (version.branchId !== expectedBranchId) {
    issues.add({
      severity: 'error',
      issueCode: 'BRANCH_CONTEXT_MISMATCH',
      message: 'Kantor cabang dataset version tidak sesuai dengan konteks upload.',
      scope: 'version_integrity',
    })
  }
  if (version.status === 'active' || version.activatedAt || version.activatedBy) {
    issues.add({
      severity: 'error',
      issueCode: 'ACTIVE_VERSION_MUTATION_ATTEMPT',
      message: 'Pipeline import tidak boleh menghasilkan atau mengubah active version.',
      scope: 'version_integrity',
    })
  }
  if (version.publicationStatus === 'published') {
    issues.add({
      severity: 'error',
      issueCode: 'PARTIAL_VERSION_PUBLICATION_ATTEMPT',
      message: 'Data hasil import belum boleh dipublikasikan sebelum aktivasi terpisah.',
      scope: 'version_integrity',
    })
  }
}

function createIssueCollector(datasetVersionId, sourceIssues = []) {
  const records = []
  const signatures = new Set()
  let sequence = 0

  function add(input) {
    const canonicalCode = canonicalIssueCode(input.issueCode)
    const severity = normalizeSeverity(canonicalCode, input.severity)
    const focus = compactRecord(input.focus ?? focusFor(input))
    const signature = JSON.stringify([
      canonicalCode,
      focus.assetId,
      focus.geometryId,
      focus.geometryReference,
      focus.relationId,
      focus.sourceAssetId,
      focus.targetAssetId,
      focus.assetId ? undefined : focus.sourceFolderPath,
      focus.assetId ? undefined : focus.sourcePlacemarkName,
    ])
    if (signatures.has(signature)) return
    signatures.add(signature)
    sequence += 1
    records.push({
      id: `issue:${datasetVersionId}:validation:${sequence}`,
      datasetVersionId,
      severity,
      issueCode: canonicalCode,
      ...(input.sourceIssueCode && input.sourceIssueCode !== canonicalCode
        ? { sourceIssueCode: input.sourceIssueCode }
        : {}),
      message: String(input.message ?? 'Validation issue tidak mempunyai pesan.'),
      scope: input.scope ?? scopeForCode(canonicalCode),
      readinessDimension: input.readinessDimension
        ?? readinessDimensionForCode(canonicalCode, input.scope),
      blockingProfiles: normalizeBlockingProfiles(input, severity, canonicalCode),
      canActivate: input.canActivate !== undefined
        ? input.canActivate
        : canActivateForProfiles(input, severity, canonicalCode),
      ...(Object.keys(focus).length ? { focus } : {}),
      ...(focus.sourceFolderPath ? { sourceFolderPath: focus.sourceFolderPath } : {}),
      ...(focus.sourcePlacemarkName
        ? { sourcePlacemarkName: focus.sourcePlacemarkName }
        : {}),
      ...(focus.assetId ? { assetId: focus.assetId } : {}),
      ...(focus.geometryReference
        ? { geometryReference: focus.geometryReference }
        : {}),
      ...(input.details ? { details: structuredClone(input.details) } : {}),
      recommendedAction: input.recommendedAction
        ?? recommendedActionForCode(canonicalCode),
    })
  }

  sourceIssues.forEach((issue) => {
    const sourceCode = String(issue.issueCode ?? 'VALIDATION_ISSUE')
    const canonicalCode = canonicalIssueCode(sourceCode, issue)
    add({
      ...issue,
      issueCode: canonicalCode,
      sourceIssueCode: sourceCode,
      scope: issue.scope ?? scopeForCode(canonicalCode),
      focus: focusFor(issue),
    })
  })

  return {
    add,
    list: () => records.map((record) => structuredClone(record)),
  }
}

function buildValidationResult(issues, datasetVersion) {
  const summary = {
    total: issues.length,
    errors: issues.filter((issue) => issue.severity === 'error').length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
    information: issues.filter((issue) => issue.severity === 'information').length,
    blocking: issues.filter((issue) => issue.canActivate === false).length,
  }
  return {
    schemaVersion: '1.0.0',
    status: summary.blocking ? 'invalid' : 'valid',
    canActivate: summary.blocking === 0,
    summary,
    facets: {
      severity: countBy(issues, (issue) => issue.severity),
      scope: countBy(issues, (issue) => issue.scope),
      issueCode: countBy(issues, (issue) => issue.issueCode),
    },
    integrity: {
      datasetVersionId: datasetVersion.id,
      branchId: datasetVersion.branchId,
      activeVersionUnchanged: !issues.some((issue) => (
        issue.issueCode === 'ACTIVE_VERSION_MUTATION_ATTEMPT'
      )),
      userVisible: false,
      publicationStatus: 'unpublished',
    },
  }
}

function canonicalIssueCode(code, issue = {}) {
  const normalized = String(code ?? 'VALIDATION_ISSUE').trim()
  if (normalized === 'unsupported_kml_element'
    && /NetworkLink/i.test(String(issue.message ?? ''))) {
    return 'NETWORK_LINK_IGNORED'
  }
  if (normalized === 'unsupported_kml_element'
    && /(LabelStyle|BalloonStyle|ListStyle)/i.test(String(issue.message ?? ''))) {
    return 'STYLE_UNSUPPORTED'
  }
  return ISSUE_CODE_ALIASES[normalized]
    ?? normalized.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase()
}

function normalizeSeverity(code, requested) {
  if (['RELATION_TARGET_NOT_FOUND', 'RELATION_SOURCE_NOT_FOUND'].includes(code)) {
    return 'error'
  }
  return ['error', 'warning', 'information'].includes(requested)
    ? requested
    : 'warning'
}

function normalizeBlockingProfiles(input, severity, code) {
  if (Array.isArray(input.blockingProfiles)) {
    return [...new Set(input.blockingProfiles.filter((profile) => (
      ['map_only', 'operational_topology'].includes(profile)
    )))]
  }
  if (severity !== 'error') return []
  const dimension = readinessDimensionForCode(code, input.scope)
  return dimension === 'inventory' || dimension === 'topology'
    ? ['operational_topology']
    : ['map_only', 'operational_topology']
}

function canActivateForProfiles(input, severity, code) {
  if (input.canPublish === false) return false
  if (Array.isArray(input.blockingProfiles)
    && !input.blockingProfiles.includes('map_only')) return true
  if (input.canActivate === true) return true
  return severity !== 'error'
}

function readinessDimensionForCode(code, scope) {
  if (['asset', 'metadata'].includes(scope)) return 'inventory'
  if (scope === 'relation') return 'topology'
  const normalized = String(code ?? '').toLowerCase()
  if (/identity|asset|metadata|vocabulary|classification|category/.test(normalized)) return 'inventory'
  if (/relation|topology|candidate|graph/.test(normalized)) return 'topology'
  if (/coordinate|geometry|overlay|site|visual|map/.test(normalized)) return 'map'
  return 'parse'
}

function recommendedActionForCode(code) {
  if (code === 'ASSET_ID_MISSING') return 'Sistem sudah mencoba membuat Asset ID internal. Tinjau identity ambigu atau duplikat; isi Asset ID resmi hanya bila aset wajib mengikuti nomor perusahaan.'
  if (code === 'ASSET_ID_DUPLICATE') return 'Resolusi duplicate Asset ID sebelum publikasi topology.'
  if (code === 'COORDINATE_INVALID') return 'Perbaiki koordinat pada source KML/KMZ di Google Earth.'
  return 'Periksa evidence sumber dan ulangi validasi dataset version.'
}

function scopeForCode(code) {
  return CODE_SCOPES[code] ?? 'processing'
}

function focusFor(input = {}) {
  const asset = input.asset
  const geometry = input.geometry
  const relation = input.relation
  const directFocus = input.focus ?? {}
  return compactRecord({
    assetId: directFocus.assetId ?? input.assetId ?? asset?.assetId,
    assetNodeId: directFocus.assetNodeId ?? asset?.id,
    layerId: directFocus.layerId ?? asset?.layerId,
    geometryId: directFocus.geometryId ?? geometry?.id,
    geometryReference: directFocus.geometryReference ?? input.geometryReference,
    relationId: directFocus.relationId ?? relation?.id,
    sourceAssetId: directFocus.sourceAssetId ?? relation?.sourceAssetId,
    targetAssetId: directFocus.targetAssetId ?? relation?.targetAssetId,
    sourceFeatureId: directFocus.sourceFeatureId ?? input.sourceFeatureId,
    sourceFolderPath: directFocus.sourceFolderPath ?? input.sourceFolderPath,
    sourcePlacemarkName: directFocus.sourcePlacemarkName ?? input.sourcePlacemarkName,
  })
}

function detectRelationCycles(relations, knownAssetIds) {
  const adjacency = new Map()
  relations.forEach((relation) => {
    if (!knownAssetIds.has(relation.sourceAssetId)
      || !knownAssetIds.has(relation.targetAssetId)) return
    const targets = adjacency.get(relation.sourceAssetId) ?? []
    targets.push(relation.targetAssetId)
    adjacency.set(relation.sourceAssetId, targets)
  })

  const visited = new Set()
  const active = new Set()
  const cycles = new Set()

  function visit(assetId) {
    if (active.has(assetId)) {
      cycles.add(assetId)
      return
    }
    if (visited.has(assetId)) return
    visited.add(assetId)
    active.add(assetId)
    for (const target of adjacency.get(assetId) ?? []) visit(target)
    active.delete(assetId)
  }

  knownAssetIds.forEach(visit)
  return [...cycles].sort()
}

function isValidPosition(position) {
  return Array.isArray(position)
    && position.length >= 2
    && position.length <= 3
    && position.every(Number.isFinite)
    && position[0] >= -180
    && position[0] <= 180
    && position[1] >= -90
    && position[1] <= 90
}

function isValidRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4 || !ring.every(isValidPosition)) return false
  const first = ring[0]
  const last = ring.at(-1)
  return first.length === last.length
    && first.every((value, index) => value === last[index])
    && new Set(ring.slice(0, -1).map((position) => `${position[0]},${position[1]}`)).size >= 3
}

function addCoordinateError(context, message) {
  context.issues.add({
    severity: 'error',
    issueCode: 'COORDINATE_INVALID',
    message,
    scope: 'geometry',
    focus: context.focus,
  })
}

function isGeneratedOrEmptyName(asset) {
  return !String(asset.name ?? '').trim()
    || asset.properties?.sourceNameMissing === true
}

function extensionOf(filename) {
  const value = String(filename ?? '').toLowerCase()
  const index = value.lastIndexOf('.')
  return index >= 0 ? value.slice(index) : ''
}

function countBy(values, keyOf) {
  return Object.fromEntries(
    [...values.reduce((counts, value) => {
      const key = keyOf(value)
      counts.set(key, (counts.get(key) ?? 0) + 1)
      return counts
    }, new Map())].sort(([left], [right]) => left.localeCompare(right)),
  )
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== ''
}

function compactRecord(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => (
      entry !== undefined && entry !== null && entry !== ''
    )),
  )
}
