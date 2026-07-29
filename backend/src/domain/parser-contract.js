import { createHash } from 'node:crypto'
import path from 'node:path'

export const PARSER_VERSION = 'evidence-parser/1.0.0'
export const NORMALIZER_VERSION = 'canonical-normalizer/1.0.0'
export const CLASSIFICATION_RULE_SET_VERSION = 'semantic-classifier/1.0.0'
export const METADATA_ALIAS_VERSION = 'metadata-aliases/1.0.0'
export const FOLDER_MAPPING_VERSION = 'folder-mappings/1.0.0'
export const STYLE_MAPPING_VERSION = 'style-mappings/1.0.0'

const DEFAULT_ALIASES = Object.freeze({
  asset_id: ['asset_id', 'assetid', 'asset id', 'kode_aset'],
  asset_name: ['asset_name', 'assetname', 'asset name', 'nama_aset'],
  asset_type: ['asset_type', 'assettype', 'asset type', 'type', 'jenis_aset'],
  category: ['category', 'asset_category', 'kategori'],
  site_id: ['site_id', 'siteid', 'branch_id', 'branchid', 'kode_cabang'],
  source_status: ['source_status', 'asset_status', 'status'],
  location: ['location', 'lokasi', 'asset_location'],
  connected_to: ['connected_to', 'connectedto', 'connected to'],
  parent_asset_id: ['parent_asset_id', 'parentassetid', 'parent asset id'],
  upstream_asset_id: ['upstream_asset_id', 'upstreamassetid', 'upstream asset id'],
  downstream_asset_id: ['downstream_asset_id', 'downstreamassetid', 'downstream asset id'],
  source_asset_id: ['source_asset_id', 'sourceassetid', 'source asset id'],
  target_asset_id: ['target_asset_id', 'targetassetid', 'target asset id'],
  relation_type: ['relation_type', 'relationtype', 'relation type'],
  direction: ['direction', 'arah'],
  ip_address: ['ip_address', 'ipaddress', 'ip address', 'ip'],
  hostname: ['hostname', 'host_name', 'host name'],
})

const ROLE_RULES = Object.freeze([
  {
    tokens: ['cctv cable', 'kabel cctv', 'backbone cctv'],
    objectRole: 'cable_path',
    networkFamily: 'cctv',
  },
  {
    tokens: ['fiber optic', 'fibre optic', 'jalur fo', 'fo rekomendasi'],
    objectRole: 'cable_path',
    networkFamily: 'fiber_optic',
  },
  {
    tokens: ['lan', 'utp', 'jaringan lan'],
    objectRole: 'cable_path',
    networkFamily: 'lan',
    geometryTypes: ['LineString'],
  },
  {
    tokens: ['cctv', 'camera', 'kamera', 'nvr', 'junction box', 'jb cctv'],
    objectRole: 'device_node',
    networkFamily: 'cctv',
  },
  {
    tokens: ['switch', 'server', 'router', 'otb', 'rack', 'core'],
    objectRole: 'device_node',
    networkFamily: 'infrastructure',
  },
  {
    tokens: ['access point', 'printer', 'peripheral'],
    objectRole: 'device_node',
    networkFamily: 'lan',
  },
  {
    tokens: ['coverage', 'cakupan', 'area layanan'],
    objectRole: 'coverage_area',
    networkFamily: 'infrastructure',
  },
  {
    tokens: ['visual only', 'visual-only', 'dekorasi', 'annotation'],
    objectRole: 'visual_only',
    networkFamily: 'unknown',
  },
])

/**
 * Converts lossless parser output into immutable, deterministic canonical evidence.
 * It deliberately does not infer spatial relations or declare topology readiness.
 */
export function buildCanonicalParserResult({
  parserOutput,
  datasetVersion,
  sourceSelection = {},
  metadataAliases = {},
  resources = sourceSelection.resources ?? [],
} = {}) {
  if (!parserOutput || typeof parserOutput !== 'object') {
    throw new TypeError('parserOutput wajib berupa object.')
  }
  if (!datasetVersion?.id) {
    throw new TypeError('datasetVersion.id wajib tersedia.')
  }

  const versions = {
    parserVersion: PARSER_VERSION,
    normalizerVersion: NORMALIZER_VERSION,
    classificationRuleSetVersion: CLASSIFICATION_RULE_SET_VERSION,
    metadataAliasVersion: METADATA_ALIAS_VERSION,
    folderMappingVersion: FOLDER_MAPPING_VERSION,
    styleMappingVersion: STYLE_MAPPING_VERSION,
  }
  const datasetVersionId = datasetVersion.id
  const sourceChecksum = datasetVersion.checksum
  const aliases = normalizeAliases(metadataAliases)
  const issues = []
  const sourceFeatures = []
  const sourceGeometries = []
  const sourceMetadataEntries = []
  const sourceOverlays = []
  const classifiedObjects = []
  const explicitRelationEvidence = []
  const usedFeatureIds = new Set()
  const resourceResult = canonicalizeResources(resources, {
    datasetVersionId,
    selectedKmlPath: sourceSelection.selectedKmlPath,
    sourceChecksum,
  })

  const addIssue = (issue) => {
    const record = {
      issueId: deterministicId('parser-issue', datasetVersionId, issues.length + 1, issue),
      datasetVersionId,
      severity: issue.severity ?? 'warning',
      issueCode: issue.issueCode ?? 'parser_issue',
      scope: issue.scope ?? 'parser',
      message: String(issue.message ?? 'Parser issue tidak memiliki pesan.'),
      readinessDimension: issue.readinessDimension ?? 'parse',
      canPublish: issue.canPublish ?? issue.canActivate !== false,
      ...compact({
        sourceFeatureId: issue.sourceFeatureId,
        sourceFolderPath: issue.sourceFolderPath,
        geometryId: issue.geometryId,
        resourceId: issue.resourceId,
        focusReference: issue.focusReference ?? issue.geometryReference,
      }),
    }
    issues.push(record)
    return record
  }

  ;(parserOutput.issues ?? []).forEach(addIssue)
  ;(parserOutput.unsupportedElements ?? []).forEach((element) => addIssue({
    severity: element.canActivate === false ? 'error' : 'warning',
    issueCode: 'unsupported_kml_element',
    scope: 'structure',
    message: `Elemen ${element.name} dipertahankan sebagai diagnostic tetapi belum didukung.`,
    focusReference: element.geometryReference,
    readinessDimension: element.canActivate === false ? 'parse' : 'map',
    canPublish: element.canActivate !== false,
  }))

  const registerPlacemark = (placemark, sourceFolderPath, sourceIndex) => {
    const geometryFingerprint = fingerprint(geometryEvidenceValue(placemark.geometry))
    const sourceFeatureKey = [
      placemark.id ?? '',
      sourceFolderPath,
      placemark.name ?? '',
      'Placemark',
      geometryFingerprint,
    ].join('|')
    const sourceFingerprint = fingerprint({
      sourceFeatureKey,
      extendedData: placemark.extendedData ?? null,
      properties: placemark.properties ?? null,
      style: placemark.resolvedStyle ?? placemark.inlineStyle ?? null,
    })
    const baseFeatureId = deterministicId('source-feature', datasetVersionId, sourceFingerprint)
    const sourceFeatureId = uniqueId(baseFeatureId, usedFeatureIds)
    const metadata = canonicalizeMetadata(
      placemark.extendedData,
      { datasetVersionId, sourceFeatureId, aliases },
    )
    sourceMetadataEntries.push(...metadata.entries)

    const feature = {
      sourceFeatureId,
      datasetVersionId,
      sourceFeatureKey,
      sourceElementType: 'Placemark',
      sourceFolderPath,
      sourceName: placemark.name,
      ...compact({
        sourceKmlId: placemark.id,
        sourceStyleUrl: placemark.properties?.styleUrl,
      }),
      visibility: placemark.properties?.visibility !== false,
      rawProperties: structuredClone(placemark.properties ?? {}),
      sourceFingerprint,
      parserVersion: PARSER_VERSION,
    }
    sourceFeatures.push(feature)

    const featureGeometries = []
    flattenGeometry(placemark.geometry).forEach(({ geometry, partPath }, geometryIndex) => {
      const geometryId = deterministicId(
        'source-geometry',
        datasetVersionId,
        sourceFeatureId,
        partPath,
        geometryIndex,
      )
      const canonicalGeometry = {
        geometryId,
        datasetVersionId,
        sourceFeatureId,
        geometryPartIdentity: partPath,
        geometryType: geometry.type,
        coordinates: structuredClone(geometry.coordinates),
        sourceCoordinateText: structuredClone(geometry.sourceCoordinates ?? ''),
        sourceVertexOrderPreserved: true,
        valid: geometry.valid !== false,
        ...compact({ altitudeMode: geometry.altitudeMode }),
        geometryFingerprint: fingerprint({
          type: geometry.type,
          sourceCoordinates: geometry.sourceCoordinates,
          coordinates: geometry.coordinates,
          altitudeMode: geometry.altitudeMode,
        }),
        parserVersion: PARSER_VERSION,
      }
      sourceGeometries.push(canonicalGeometry)
      featureGeometries.push(canonicalGeometry)
    })

    const classification = classifyFeature({
      feature,
      placemark,
      metadata,
      geometries: featureGeometries,
      datasetVersion,
    })
    classifiedObjects.push(classification)
    explicitRelationEvidence.push(...buildExplicitRelationEvidence({
      metadata,
      sourceFeatureId,
      datasetVersionId,
    }))
  }

  const registerOverlay = (overlay, sourceFolderPath, sourceIndex) => {
    const overlayFingerprint = fingerprint({
      id: overlay.id,
      sourceFolderPath,
      name: overlay.name,
      sourceIndex,
      iconHref: overlay.iconHref,
      latLonBox: overlay.latLonBox,
      latLonQuad: overlay.latLonQuad,
    })
    const sourceFeatureId = deterministicId(
      'source-overlay-feature',
      datasetVersionId,
      overlayFingerprint,
    )
    const resourceLink = resolveOverlayResource(
      overlay.iconHref,
      resourceResult.resources,
      sourceSelection.selectedKmlPath,
    )
    const canonicalOverlay = {
      sourceOverlayId: deterministicId('source-overlay', datasetVersionId, overlayFingerprint),
      sourceFeatureId,
      datasetVersionId,
      sourceFeatureKey: [overlay.id ?? '', sourceFolderPath, overlay.name, overlayFingerprint].join('|'),
      name: overlay.name,
      visibility: overlay.visibility !== false,
      drawOrder: overlay.drawOrder,
      iconHref: overlay.iconHref,
      ...compact({
        resourceId: resourceLink.resource?.resourceId,
        rotation: overlay.latLonBox?.rotation,
        altitude: overlay.altitude,
        altitudeMode: overlay.altitudeMode,
      }),
      ...(overlay.latLonBox ? { latLonBox: structuredClone(overlay.latLonBox) } : {}),
      ...(overlay.latLonQuad ? { latLonQuad: structuredClone(overlay.latLonQuad) } : {}),
      sourceFolderPath,
      valid: overlay.valid !== false && resourceLink.status === 'resolved',
      resourceResolutionStatus: resourceLink.status,
      sourceFingerprint: overlayFingerprint,
      parserVersion: PARSER_VERSION,
    }
    sourceOverlays.push(canonicalOverlay)
    sourceFeatures.push({
      sourceFeatureId,
      datasetVersionId,
      sourceFeatureKey: canonicalOverlay.sourceFeatureKey,
      sourceElementType: 'GroundOverlay',
      sourceFolderPath,
      sourceName: overlay.name,
      ...compact({ sourceKmlId: overlay.id }),
      visibility: overlay.visibility !== false,
      rawProperties: structuredClone(overlay.sourceOverlay ?? {}),
      sourceFingerprint: overlayFingerprint,
      parserVersion: PARSER_VERSION,
    })
    classifiedObjects.push({
      classifiedObjectId: deterministicId('classified-object', datasetVersionId, sourceFeatureId),
      datasetVersionId,
      sourceFeatureId,
      siteId: datasetVersion.branchId,
      objectRole: 'ground_overlay',
      networkFamily: 'unknown',
      assetType: 'ground_overlay',
      category: 'ground_overlay',
      classificationStatus: 'classified',
      classificationScore: 1,
      classificationEvidence: [{
        source: 'source_element',
        observedValue: 'GroundOverlay',
        normalizedValue: 'ground_overlay',
        ruleId: 'element.ground-overlay',
        weight: 1,
        explanation: 'GroundOverlay selalu dipisahkan dari inventory dan topology.',
      }],
      classificationRuleSetVersion: CLASSIFICATION_RULE_SET_VERSION,
    })
    if (resourceLink.status === 'external') {
      addIssue({
        severity: 'warning',
        issueCode: 'external_overlay_resource_not_fetched',
        scope: 'resource',
        message: `Resource eksternal ${overlay.iconHref} dicatat tanpa diambil.`,
        sourceFeatureId,
        sourceFolderPath,
        readinessDimension: 'map',
        canPublish: false,
      })
    } else if (resourceLink.status === 'unsafe') {
      addIssue({
        severity: 'error',
        issueCode: 'unsafe_overlay_resource_path',
        scope: 'resource',
        message: `Path resource ${overlay.iconHref} keluar dari root package dan ditolak.`,
        sourceFeatureId,
        sourceFolderPath,
        readinessDimension: 'map',
        canPublish: false,
      })
    } else if (resourceLink.status === 'missing') {
      addIssue({
        severity: 'error',
        issueCode: 'ground_overlay_resource_missing',
        scope: 'resource',
        message: `Resource lokal ${overlay.iconHref ?? '(kosong)'} tidak ditemukan dalam package.`,
        sourceFeatureId,
        sourceFolderPath,
        readinessDimension: 'map',
        canPublish: false,
      })
    }
  }

  ;(parserOutput.placemarks ?? []).forEach((item, index) => registerPlacemark(
    item,
    item.sourceFolderPath ?? '/',
    index,
  ))
  ;(parserOutput.overlays ?? []).forEach((item, index) => registerOverlay(
    item,
    item.sourceFolderPath ?? '/',
    index,
  ))
  const visitFolder = (folder) => {
    ;(folder.placemarks ?? []).forEach((item, index) => registerPlacemark(
      item,
      folder.sourceFolderPath,
      index,
    ))
    ;(folder.overlays ?? []).forEach((item, index) => registerOverlay(
      item,
      folder.sourceFolderPath,
      index,
    ))
    ;(folder.children ?? []).forEach(visitFolder)
  }
  ;(parserOutput.folders ?? []).forEach(visitFolder)

  const styles = canonicalizeStyles(parserOutput, datasetVersionId)
  const topologyInputBundle = buildTopologyInputBundle({
    datasetVersion,
    classifiedObjects,
    sourceGeometries,
    explicitRelationEvidence,
  })
  const coverage = buildCoverage({
    parserOutput,
    sourceFeatures,
    sourceGeometries,
    sourceOverlays,
    resources: resourceResult.resources,
    classifiedObjects,
    topologyInputBundle,
  })
  const readiness = evaluateReadiness({
    issues,
    sourceGeometries,
    sourceOverlays,
    classifiedObjects,
    coverage,
  })

  return {
    schemaVersion: '1.0.0',
    datasetVersionId,
    sourceChecksum,
    package: {
      sourceChecksum,
      packageType: sourceSelection.packageType
        ?? (String(datasetVersion.sourceFilename ?? '').toLowerCase().endsWith('.kmz')
          ? 'kmz'
          : 'kml'),
      kmlEntries: structuredClone(sourceSelection.kmlEntries ?? []),
      selectedKmlPath: sourceSelection.selectedKmlPath,
      safeResources: resourceResult.resources.map(({ resourceId }) => resourceId),
      ignoredEntries: structuredClone(sourceSelection.ignoredEntries ?? []),
      packageIssues: issues.filter(({ scope }) => ['file', 'resource'].includes(scope)),
    },
    ...versions,
    sourceFeatures,
    sourceGeometries,
    sourceMetadataEntries,
    sourceStyles: styles,
    sourceOverlays,
    sourceResources: resourceResult.resources,
    classifiedObjects,
    explicitRelationEvidence,
    topologyInputBundle,
    coverage,
    readiness,
    issues,
  }
}

function canonicalizeMetadata(extendedData, { datasetVersionId, sourceFeatureId, aliases }) {
  const rawEntries = Array.isArray(extendedData?.data) ? extendedData.data : []
  const semanticValues = {}
  const entries = rawEntries.map((entry, index) => {
    const semanticField = aliasTarget(entry.name, aliases)
    if (semanticField && semanticValues[semanticField] === undefined) {
      semanticValues[semanticField] = String(entry.value ?? '').trim()
    }
    return {
      metadataEntryId: deterministicId('metadata', datasetVersionId, sourceFeatureId, index),
      datasetVersionId,
      sourceFeatureId,
      sourceKey: entry.name,
      sourceValue: structuredClone(entry.value),
      sourceElement: entry.sourceElement ?? 'Data',
      ...compact({
        schemaUrl: entry.schemaUrl,
        semanticField,
        normalizedValue: semanticField ? String(entry.value ?? '').trim() : undefined,
      }),
    }
  })
  return { entries, semanticValues }
}

function normalizeAliases(configured) {
  const result = Object.fromEntries(
    Object.entries(DEFAULT_ALIASES).map(([field, values]) => [
      field,
      new Set(values.map(normalizeToken)),
    ]),
  )
  for (const [rawField, values] of Object.entries(configured ?? {})) {
    if (!Array.isArray(values)) continue
    const field = toSnakeCase(rawField)
    if (!result[field]) result[field] = new Set()
    values.forEach((value) => result[field].add(normalizeToken(value)))
  }
  return result
}

function aliasTarget(sourceKey, aliases) {
  const normalized = normalizeToken(sourceKey)
  return Object.entries(aliases).find(([, values]) => values.has(normalized))?.[0]
}

function classifyFeature({ feature, placemark, metadata, geometries, datasetVersion }) {
  const evidence = []
  const candidates = [
    {
      source: 'metadata',
      value: [
        metadata.semanticValues.asset_type,
        metadata.semanticValues.category,
      ].filter(Boolean).join(' '),
      weight: 1,
      rulePrefix: 'metadata',
    },
    {
      source: 'folder',
      value: feature.sourceFolderPath,
      weight: 0.8,
      rulePrefix: 'folder',
    },
    {
      source: 'name',
      value: feature.sourceName,
      weight: 0.6,
      rulePrefix: 'name',
    },
    {
      source: 'style',
      value: [
        placemark.resolvedStyle?.resolvedStyleId,
        placemark.resolvedStyle?.resolvedIconHref,
      ].filter(Boolean).join(' '),
      weight: 0.4,
      rulePrefix: 'style',
    },
  ]
  let match = null
  for (const candidate of candidates) {
    const rule = findRoleRule(candidate.value, geometries)
    if (!rule) continue
    evidence.push({
      source: candidate.source,
      observedValue: candidate.value,
      normalizedValue: `${rule.objectRole}:${rule.networkFamily}`,
      ruleId: `${candidate.rulePrefix}.${rule.tokens[0].replace(/\s+/g, '-')}`,
      weight: candidate.weight,
      explanation: `${candidate.source} cocok dengan vocabulary ${rule.tokens[0]}.`,
    })
    if (!match) match = { ...rule, score: candidate.weight }
  }

  if (!match && geometries.some(({ geometryType }) => geometryType === 'Polygon')) {
    match = { objectRole: 'coverage_area', networkFamily: 'unknown', score: 0.25 }
    evidence.push({
      source: 'geometry',
      observedValue: 'Polygon',
      normalizedValue: 'coverage_area',
      ruleId: 'geometry.polygon-area',
      weight: 0.25,
      explanation: 'Polygon diperlakukan sebagai area, bukan node atau path topology.',
    })
  }
  const objectRole = match?.objectRole ?? 'unknown'
  const networkFamily = match?.networkFamily ?? 'unknown'
  if (!match) {
    evidence.push({
      source: 'classifier',
      observedValue: null,
      normalizedValue: 'unknown',
      ruleId: 'fallback.unknown',
      weight: 0,
      explanation: 'Tidak ada evidence yang cukup; object tidak dipaksa menjadi asset/path.',
    })
  }
  return {
    classifiedObjectId: deterministicId(
      'classified-object',
      datasetVersion.id,
      feature.sourceFeatureId,
    ),
    datasetVersionId: datasetVersion.id,
    sourceFeatureId: feature.sourceFeatureId,
    ...compact({
      assetId: metadata.semanticValues.asset_id,
      siteId: metadata.semanticValues.site_id ?? datasetVersion.branchId,
    }),
    objectRole,
    networkFamily,
    assetType: metadata.semanticValues.asset_type ?? match?.tokens?.[0] ?? 'unknown',
    category: metadata.semanticValues.category ?? match?.tokens?.[0] ?? 'unknown',
    classificationStatus: match ? 'classified' : 'review_required',
    classificationScore: match?.score ?? 0,
    classificationEvidence: evidence,
    classificationRuleSetVersion: CLASSIFICATION_RULE_SET_VERSION,
  }
}

function findRoleRule(value, geometries) {
  const normalized = normalizeToken(value)
  if (!normalized) return null
  const geometryTypes = new Set(geometries.map(({ geometryType }) => geometryType))
  return ROLE_RULES.find((rule) => (
    (!rule.geometryTypes || rule.geometryTypes.some((type) => geometryTypes.has(type)))
    && rule.tokens.some((token) => tokenMatch(normalized, token))
  ))
}

function tokenMatch(value, token) {
  const normalizedToken = normalizeToken(token)
  if (value === normalizedToken) return true
  if (normalizedToken.length <= 3) {
    return ` ${value} `.includes(` ${normalizedToken} `)
  }
  return value.includes(normalizedToken)
}

function canonicalizeStyles(parserOutput, datasetVersionId) {
  return {
    styles: (parserOutput.styles ?? []).map((style) => ({
      sourceStyleId: deterministicId('source-style', datasetVersionId, style.id),
      datasetVersionId,
      sourceKmlStyleId: style.id,
      rawStyle: structuredClone(style.sourceStyle),
      parsedStyle: structuredClone({
        iconStyle: style.iconStyle,
        lineStyle: style.lineStyle,
        polyStyle: style.polyStyle,
        labelStyle: style.labelStyle,
      }),
      parserVersion: PARSER_VERSION,
    })),
    styleMaps: (parserOutput.styleMaps ?? []).map((styleMap) => ({
      sourceStyleMapId: deterministicId('source-style-map', datasetVersionId, styleMap.id),
      datasetVersionId,
      sourceKmlStyleMapId: styleMap.id,
      pairs: structuredClone(styleMap.pairs),
      rawStyleMap: structuredClone(styleMap.sourceStyle),
      parserVersion: PARSER_VERSION,
    })),
  }
}

function canonicalizeResources(resources, { datasetVersionId, selectedKmlPath, sourceChecksum }) {
  const grouped = new Map()
  resources.forEach((resource) => {
    const key = resource.checksum ?? `path:${normalizePackagePath(resource.relativePath)}`
    const existing = grouped.get(key)
    if (existing) {
      existing.relativePaths.push(normalizePackagePath(resource.relativePath))
      return
    }
    grouped.set(key, {
      resourceId: deterministicId(
        'source-resource',
        datasetVersionId,
        resource.checksum ?? resource.relativePath,
      ),
      datasetVersionId,
      relativePath: normalizePackagePath(resource.relativePath),
      relativePaths: [normalizePackagePath(resource.relativePath)],
      size: resource.size,
      extension: resource.extension,
      checksum: resource.checksum,
      sourceChecksum,
      referencedFrom: selectedKmlPath,
      parserVersion: PARSER_VERSION,
    })
  })
  return {
    resources: [...grouped.values()],
  }
}

function resolveOverlayResource(href, resources, selectedKmlPath = '') {
  if (!href) return { status: 'missing' }
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || String(href).startsWith('//')) {
    return { status: 'external' }
  }
  const baseDirectory = path.posix.dirname(normalizePackagePath(selectedKmlPath))
  const normalized = normalizePackagePath(path.posix.join(baseDirectory, href))
  if (normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/')) {
    return { status: 'unsafe' }
  }
  const resource = resources.find((item) => (
    item.relativePaths.some((resourcePath) => (
      resourcePath.toLowerCase() === normalized.toLowerCase()
    ))
  ))
  return resource ? { status: 'resolved', resource } : { status: 'missing' }
}

function buildExplicitRelationEvidence({ metadata, sourceFeatureId, datasetVersionId }) {
  const semantic = metadata.semanticValues
  const declarations = []
  if (semantic.source_asset_id && semantic.target_asset_id) {
    declarations.push({
      sourceReference: semantic.source_asset_id,
      targets: semantic.target_asset_id,
      relationType: semantic.relation_type ?? 'connected-to',
      direction: semantic.direction ?? 'unspecified',
      sourceKey: 'source_asset_id+target_asset_id',
    })
  }
  for (const [field, relationType, direction] of [
    ['connected_to', semantic.relation_type ?? 'connected-to', semantic.direction ?? 'unspecified'],
    ['parent_asset_id', 'parent', 'target_to_source'],
    ['upstream_asset_id', 'upstream', 'source_to_target'],
    ['downstream_asset_id', 'downstream', 'source_to_target'],
  ]) {
    if (!semantic[field]) continue
    declarations.push({
      targets: semantic[field],
      relationType,
      direction,
      sourceKey: field,
    })
  }
  return declarations.flatMap((declaration, declarationIndex) => (
    String(declaration.targets).split(',').map((value, targetIndex) => ({
    explicitRelationEvidenceId: deterministicId(
      'explicit-relation-evidence',
      datasetVersionId,
      sourceFeatureId,
      declarationIndex,
      targetIndex,
    ),
    datasetVersionId,
    sourceFeatureId,
    sourceReference: declaration.sourceReference,
    targetReference: value.trim(),
    relationType: declaration.relationType,
    direction: declaration.direction,
    source: 'ExtendedData',
    sourceKey: declaration.sourceKey,
    validationStatus: 'pending_stable_identity_resolution',
    }))
  ))
}

function buildTopologyInputBundle({
  datasetVersion,
  classifiedObjects,
  sourceGeometries,
  explicitRelationEvidence,
}) {
  const geometriesByFeature = groupBy(sourceGeometries, 'sourceFeatureId')
  const eligible = classifiedObjects.filter((object) => (
    ['device_node', 'cable_path'].includes(object.objectRole)
    && object.networkFamily !== 'unknown'
    && (geometriesByFeature.get(object.sourceFeatureId) ?? []).some((geometry) => (
      geometry.valid && geometryMatchesRole(geometry, object.objectRole)
    ))
  ))
  const mapObject = (object) => ({
    assetId: object.assetId,
    onboardingIdentity: object.assetId
      ? undefined
      : deterministicId('onboarding-identity', datasetVersion.id, object.sourceFeatureId),
    sourceFeatureId: object.sourceFeatureId,
    siteId: object.siteId,
    objectRole: object.objectRole,
    networkFamily: object.networkFamily,
    assetType: object.assetType,
    category: object.category,
    classificationStatus: object.classificationStatus,
    classificationEvidence: structuredClone(object.classificationEvidence),
    geometryIds: (geometriesByFeature.get(object.sourceFeatureId) ?? [])
      .filter((geometry) => geometry.valid && geometryMatchesRole(geometry, object.objectRole))
      .map(({ geometryId }) => geometryId),
  })
  const eligibleFeatureIds = new Set(eligible.map(({ sourceFeatureId }) => sourceFeatureId))
  const eligibleGeometryIds = new Set(eligible.flatMap((object) => (
    (geometriesByFeature.get(object.sourceFeatureId) ?? [])
      .filter((geometry) => geometry.valid && geometryMatchesRole(geometry, object.objectRole))
      .map(({ geometryId }) => geometryId)
  )))
  return {
    datasetVersion: {
      id: datasetVersion.id,
      sourceChecksum: datasetVersion.checksum,
    },
    site: datasetVersion.branchId,
    classifiedNodes: eligible.filter(({ objectRole }) => objectRole === 'device_node').map(mapObject),
    classifiedPaths: eligible.filter(({ objectRole }) => objectRole === 'cable_path').map(mapObject),
    geometries: sourceGeometries.filter(({ geometryId }) => eligibleGeometryIds.has(geometryId)),
    explicitRelations: structuredClone(explicitRelationEvidence.filter(({ sourceFeatureId }) => (
      eligibleFeatureIds.has(sourceFeatureId)
    ))),
    semanticRuleSetVersion: CLASSIFICATION_RULE_SET_VERSION,
    topologyRuleSetVersion: null,
    topologyReady: false,
  }
}

function geometryMatchesRole(geometry, objectRole) {
  if (objectRole === 'device_node') return geometry.geometryType === 'Point'
  if (objectRole === 'cable_path') return geometry.geometryType === 'LineString'
  return false
}

function buildCoverage({
  parserOutput,
  sourceFeatures,
  sourceGeometries,
  sourceOverlays,
  resources,
  classifiedObjects,
  topologyInputBundle,
}) {
  const operationalObjects = classifiedObjects.filter(({ objectRole }) => (
    ['device_node', 'cable_path'].includes(objectRole)
  ))
  const stableObjects = operationalObjects.filter(({ assetId }) => Boolean(assetId))
  return {
    documentCount: parserOutput.structure?.documentCount ?? 0,
    folderCount: parserOutput.structure?.folderCount ?? 0,
    placemarkCount: parserOutput.structure?.placemarkCount ?? 0,
    geometryCountByType: countBy(sourceGeometries, 'geometryType'),
    overlayCount: sourceOverlays.length,
    styleCount: parserOutput.styles?.length ?? 0,
    styleMapCount: parserOutput.styleMaps?.length ?? 0,
    resourceCount: resources.length,
    unsupportedCountByType: countBy(parserOutput.unsupportedElements ?? [], 'name'),
    invalidGeometryCount: sourceGeometries.filter(({ valid }) => !valid).length,
    mappedObjectCount: classifiedObjects.filter(({ objectRole }) => objectRole !== 'unknown').length,
    unknownObjectCount: classifiedObjects.filter(({ objectRole }) => objectRole === 'unknown').length,
    stableIdCoverage: operationalObjects.length
      ? stableObjects.length / operationalObjects.length
      : 0,
    topologyEligibleNodeCount: topologyInputBundle.classifiedNodes.length,
    topologyEligiblePathCount: topologyInputBundle.classifiedPaths.length,
    preservedSourceElementCount: (parserOutput.structure?.documentCount ?? 0)
      + (parserOutput.structure?.folderCount ?? 0)
      + sourceFeatures.length
      + (parserOutput.styles?.length ?? 0)
      + (parserOutput.styleMaps?.length ?? 0)
      + (parserOutput.unsupportedElements?.length ?? 0),
  }
}

function evaluateReadiness({
  issues,
  sourceGeometries,
  sourceOverlays,
  classifiedObjects,
  coverage,
}) {
  const parseBlocking = issues.filter((issue) => (
    issue.readinessDimension === 'parse' && issue.canPublish === false
  ))
  const mapBlocking = issues.filter((issue) => (
    issue.readinessDimension === 'map' && issue.canPublish === false
  ))
  const validGeometries = sourceGeometries.filter(({ valid }) => valid)
  const assets = classifiedObjects.filter(({ objectRole }) => (
    ['device_node', 'cable_path'].includes(objectRole)
  ))
  const duplicateIds = duplicateValues(assets.map(({ assetId }) => assetId).filter(Boolean))
  const inventoryBlocking = assets.filter(({ assetId, assetType, category }) => (
    !assetId || assetType === 'unknown' || category === 'unknown'
  )).length + duplicateIds.length

  return {
    parseReadiness: readinessValue(
      parseBlocking.length === 0,
      issues.some(({ readinessDimension, severity }) => (
        readinessDimension === 'parse' && severity === 'warning'
      )),
    ),
    mapReadiness: readinessValue(
      mapBlocking.length === 0
        && (validGeometries.length > 0 || sourceOverlays.some(({ valid }) => valid))
        && sourceOverlays.every(({ valid }) => valid),
      issues.some(({ readinessDimension, severity }) => (
        readinessDimension === 'map' && severity === 'warning'
      )),
    ),
    inventoryReadiness: assets.length
      ? readinessValue(inventoryBlocking === 0, coverage.stableIdCoverage < 1)
      : 'not_applicable',
    topologyReadiness: 'not_applicable',
    topologyEligibility: {
      eligibleNodeCount: coverage.topologyEligibleNodeCount,
      eligiblePathCount: coverage.topologyEligiblePathCount,
      decisionOwner: 'relation_engine',
    },
  }
}

function readinessValue(ready, warnings) {
  if (!ready) return 'not_ready'
  return warnings ? 'ready_with_warnings' : 'ready'
}

function flattenGeometry(geometry, prefix = 'geometry[0]') {
  if (!geometry) return []
  if (geometry.type === 'MultiGeometry') {
    return (geometry.geometries ?? []).flatMap((item, index) => (
      flattenGeometry(item, `${prefix}.${item.type}[${index}]`)
    ))
  }
  return [{ geometry, partPath: prefix }]
}

function geometryEvidenceValue(geometry) {
  if (!geometry) return null
  if (geometry.type === 'MultiGeometry') {
    return {
      type: geometry.type,
      geometries: geometry.geometries.map(geometryEvidenceValue),
    }
  }
  return {
    type: geometry.type,
    sourceCoordinates: geometry.sourceCoordinates,
    altitudeMode: geometry.altitudeMode,
  }
}

function normalizePackagePath(value) {
  const normalized = String(value ?? '').replace(/\\/g, '/').replace(/^\.\/+/, '')
  const safe = path.posix.normalize(normalized)
  return safe === '.' ? '' : safe
}

function normalizeToken(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function toSnakeCase(value) {
  return String(value ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
}

function deterministicId(prefix, ...parts) {
  return `${prefix}:${fingerprint(parts).slice(0, 24)}`
}

function fingerprint(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

function stableStringify(value) {
  if (value === undefined) return '"__undefined__"'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(value[key])}`
  )).join(',')}}`
}

function uniqueId(base, used) {
  let value = base
  let sequence = 2
  while (used.has(value)) {
    value = `${base}:${sequence}`
    sequence += 1
  }
  used.add(value)
  return value
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

function countBy(records, field) {
  return records.reduce((result, record) => {
    const key = record?.[field] ?? 'unknown'
    result[key] = (result[key] ?? 0) + 1
    return result
  }, {})
}

function groupBy(records, field) {
  return records.reduce((result, record) => {
    const items = result.get(record[field]) ?? []
    items.push(record)
    result.set(record[field], items)
    return result
  }, new Map())
}

function duplicateValues(values) {
  const seen = new Set()
  const duplicates = new Set()
  values.forEach((value) => {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  })
  return [...duplicates]
}
