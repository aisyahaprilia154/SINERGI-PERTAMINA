import { readFile, stat } from 'node:fs/promises'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { AppError } from '../errors.js'

const UNSUPPORTED_ELEMENTS = new Set([
  'NetworkLink',
  'PhotoOverlay',
  'ScreenOverlay',
  'Model',
  'Track',
  'MultiTrack',
  'Tour',
  'BalloonStyle',
  'ListStyle',
])
const CRITICAL_UNSUPPORTED_ELEMENTS = new Set([
  'NetworkLink',
  'Model',
  'Track',
  'MultiTrack',
])

export async function parseKmlFile(filePath, {
  maxKmlSize,
  folderMappings = [],
}) {
  const fileStat = await stat(filePath)
  if (fileStat.size > maxKmlSize) {
    throw new AppError('Ukuran dokumen KML melebihi batas parser.', {
      code: 'kml_too_large',
      statusCode: 422,
      details: { maxKmlSize },
    })
  }
  return parseKmlText(await readFile(filePath, 'utf8'), { folderMappings })
}

export function parseKmlText(source, { folderMappings = [] } = {}) {
  const xml = String(source ?? '').replace(/^\uFEFF/, '')
  rejectUnsafeXml(xml)

  const validation = XMLValidator.validate(xml, {
    allowBooleanAttributes: false,
  })
  if (validation !== true) {
    throw new AppError('Dokumen KML bukan XML yang valid.', {
      code: 'invalid_kml_xml',
      statusCode: 422,
      details: {
        line: validation.err?.line,
        column: validation.err?.col,
        reason: validation.err?.msg,
      },
    })
  }

  const document = parseXml(xml)
  const kmlRoot = firstChild(document, 'kml')
  if (!kmlRoot) {
    throw new AppError('Root element KML tidak ditemukan.', {
      code: 'missing_kml_root',
      statusCode: 422,
    })
  }

  const parserOutput = {
    folders: [],
    placemarks: [],
    overlays: [],
    styles: [],
    styleMaps: [],
    issues: [],
    unsupportedElements: [],
    structure: {
      hasKmlRoot: true,
      documentCount: 0,
      folderCount: 0,
      placemarkCount: 0,
      overlayCount: 0,
    },
  }
  const namespace = kmlNamespace(kmlRoot)
  parserOutput.namespace = namespace || undefined
  if (namespace && namespace !== 'http://www.opengis.net/kml/2.2') {
    parserOutput.issues.push({
      severity: 'error',
      issueCode: 'unsupported_kml_namespace',
      message: `Namespace KML "${namespace}" belum didukung; gunakan KML 2.2.`,
      canActivate: false,
    })
  }

  const documentNodes = children(kmlRoot, 'Document')
  collectStyles(kmlRoot, parserOutput)
  children(kmlRoot, 'Placemark').forEach((placemark, index) => {
    parserOutput.placemarks.push(parsePlacemark(placemark, '/', index, parserOutput.issues))
  })
  children(kmlRoot, 'GroundOverlay').forEach((overlay, index) => {
    parserOutput.overlays.push(parseGroundOverlay(overlay, '/', index, parserOutput.issues))
  })
  children(kmlRoot, 'Folder').forEach((folder, index) => {
    parserOutput.folders.push(parseFolder(
      folder,
      '/',
      index,
      parserOutput.issues,
      folderMappings,
    ))
  })
  documentNodes.forEach((documentNode) => {
    children(documentNode, 'Placemark').forEach((placemark, placemarkIndex) => {
      parserOutput.placemarks.push(parsePlacemark(
        placemark,
        '/',
        placemarkIndex,
        parserOutput.issues,
      ))
    })
    children(documentNode, 'GroundOverlay').forEach((overlay, overlayIndex) => {
      parserOutput.overlays.push(parseGroundOverlay(
        overlay,
        '/',
        overlayIndex,
        parserOutput.issues,
      ))
    })
    children(documentNode, 'Folder').forEach((folder, folderIndex) => {
      parserOutput.folders.push(parseFolder(
        folder,
        '/',
        folderIndex,
        parserOutput.issues,
        folderMappings,
      ))
    })
  })

  collectUnsupportedElements(kmlRoot, parserOutput.unsupportedElements)
  resolveFeatureStyles(parserOutput)
  parserOutput.structure = {
    hasKmlRoot: true,
    documentCount: documentNodes.length,
    folderCount: countElements(kmlRoot, 'Folder'),
    placemarkCount: countElements(kmlRoot, 'Placemark'),
    overlayCount: countElements(kmlRoot, 'GroundOverlay'),
    styleCount: parserOutput.styles.length,
    styleMapCount: parserOutput.styleMaps.length,
  }
  parserOutput.coverage = buildParserCoverage(parserOutput)
  return parserOutput
}

export function rejectUnsafeXml(xml) {
  if (/<!\s*DOCTYPE/i.test(xml) || /<!\s*ENTITY/i.test(xml)) {
    throw new AppError('DTD dan external entity tidak diperbolehkan pada KML.', {
      code: 'unsafe_xml_declaration',
      statusCode: 422,
    })
  }
}

function parseXml(xml) {
  try {
    return new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: false,
      processEntities: false,
      htmlEntities: false,
      allowBooleanAttributes: false,
      isArray: (name) => [
        'Folder',
        'Placemark',
        'Data',
        'SimpleData',
        'SimpleField',
        'Point',
        'LineString',
        'Polygon',
        'MultiGeometry',
        'innerBoundaryIs',
        'Style',
        'StyleMap',
        'Pair',
        'GroundOverlay',
      ].includes(localName(name)),
    }).parse(xml)
  } catch (error) {
    throw new AppError('Dokumen KML gagal diparsing.', {
      code: 'kml_parse_failed',
      statusCode: 422,
      cause: error,
    })
  }
}

function parseFolder(folder, parentPath, index, issues, folderMappings) {
  const name = normalizedText(firstChild(folder, 'name')) || `Folder ${index + 1}`
  const sourceFolderPath = joinFolderPath(parentPath, name)
  const category = mapFolderCategory(name, folderMappings)
  if (category === 'unmapped') {
    issues.push({
      severity: 'warning',
      issueCode: 'unmapped_folder',
      message: `Folder "${name}" belum memiliki mapping kategori sistem.`,
      sourceFolderPath,
      canActivate: true,
    })
  }

  return {
    id: attribute(folder, 'id') || undefined,
    name,
    sourceFolderPath,
    category,
    visibility: parseVisibility(firstChild(folder, 'visibility')),
    sourceStyleId: stripStyleReference(normalizedText(firstChild(folder, 'styleUrl'))) || undefined,
    placemarks: children(folder, 'Placemark').map(
      (placemark, placemarkIndex) => parsePlacemark(
        placemark,
        sourceFolderPath,
        placemarkIndex,
        issues,
      ),
    ),
    overlays: children(folder, 'GroundOverlay').map(
      (overlay, overlayIndex) => parseGroundOverlay(
        overlay,
        sourceFolderPath,
        overlayIndex,
        issues,
      ),
    ),
    children: children(folder, 'Folder').map(
      (child, childIndex) => parseFolder(
        child,
        sourceFolderPath,
        childIndex,
        issues,
        folderMappings,
      ),
    ),
  }
}

function parsePlacemark(placemark, sourceFolderPath, index, issues) {
  const sourceName = normalizedText(firstChild(placemark, 'name'))
  const name = sourceName || `Placemark ${index + 1}`
  const sourcePlacemarkId = attribute(placemark, 'id') || undefined
  const extendedData = parseExtendedData(firstChild(placemark, 'ExtendedData'))
  const geometryContext = {
    issues,
    sourceFolderPath,
    sourcePlacemarkName: name,
    sourcePlacemarkId,
  }
  const geometry = parsePlacemarkGeometry(placemark, geometryContext)
  const sourceDescription = textValue(firstChild(placemark, 'description'))
  const styleUrl = normalizedText(firstChild(placemark, 'styleUrl'))
  const inlineStyleNode = firstChild(placemark, 'Style')
  const inlineStyle = inlineStyleNode ? parseStyle(inlineStyleNode) : undefined

  return {
    id: sourcePlacemarkId,
    name,
    sourceFolderPath,
    extendedData,
    properties: {
      ...(sourceDescription
        ? {
          description: sanitizeDescription(sourceDescription),
          sourceDescription,
          descriptionContentType: 'sanitized-text',
        }
        : {}),
      ...(styleUrl
        ? {
          styleUrl,
          sourceStyleId: stripStyleReference(styleUrl),
        }
        : {}),
      sourceNameMissing: !sourceName,
      visibility: parseVisibility(firstChild(placemark, 'visibility')),
    },
    ...(inlineStyle ? { inlineStyle } : {}),
    ...(geometry ? { geometry } : {}),
  }
}

function parseGroundOverlay(overlay, sourceFolderPath, index, issues) {
  const name = normalizedText(firstChild(overlay, 'name')) || `GroundOverlay ${index + 1}`
  const latLonBox = firstChild(overlay, 'LatLonBox')
  const latLonQuad = firstChild(overlay, 'LatLonQuad')
  const iconHref = normalizedText(firstChild(firstChild(overlay, 'Icon'), 'href')) || undefined
  const parsed = {
    id: attribute(overlay, 'id') || undefined,
    name,
    sourceFolderPath,
    visibility: parseVisibility(firstChild(overlay, 'visibility')),
    drawOrder: optionalNumber(firstChild(overlay, 'drawOrder')),
    iconHref,
    altitude: optionalNumber(firstChild(overlay, 'altitude')),
    altitudeMode: normalizedText(firstChild(overlay, 'altitudeMode')) || undefined,
    sourceOverlay: structuredClone(overlay),
  }

  if (latLonBox) {
    parsed.latLonBox = {
      north: optionalNumber(firstChild(latLonBox, 'north')),
      south: optionalNumber(firstChild(latLonBox, 'south')),
      east: optionalNumber(firstChild(latLonBox, 'east')),
      west: optionalNumber(firstChild(latLonBox, 'west')),
      rotation: optionalNumber(firstChild(latLonBox, 'rotation')) ?? 0,
    }
    if (!validLatLonBox(parsed.latLonBox)) {
      issues.push({
        severity: 'error',
        issueCode: 'invalid_ground_overlay_bounds',
        message: `GroundOverlay "${name}" memiliki LatLonBox yang tidak valid.`,
        sourceFolderPath,
        canActivate: false,
      })
      parsed.valid = false
    }
  } else if (latLonQuad) {
    const sequence = parseCoordinateSequence(firstChild(latLonQuad, 'coordinates'))
    parsed.latLonQuad = {
      coordinates: sequence.coordinates,
      sourceCoordinates: sequence.sourceCoordinates,
    }
    const validQuad = sequence.coordinates.length === 4
      && sequence.coordinates.every((position) => !invalidPositionReason(position))
    if (!validQuad) {
      issues.push({
        severity: 'error',
        issueCode: 'invalid_ground_overlay_quad',
        message: `GroundOverlay "${name}" harus memiliki empat koordinat gx:LatLonQuad yang valid.`,
        sourceFolderPath,
        canActivate: false,
      })
      parsed.valid = false
    }
  } else {
    issues.push({
      severity: 'error',
      issueCode: 'ground_overlay_position_missing',
      message: `GroundOverlay "${name}" tidak memiliki LatLonBox atau gx:LatLonQuad.`,
      sourceFolderPath,
      canActivate: false,
    })
    parsed.valid = false
  }

  if (!iconHref) {
    issues.push({
      severity: 'error',
      issueCode: 'ground_overlay_resource_missing',
      message: `GroundOverlay "${name}" tidak memiliki Icon.href.`,
      sourceFolderPath,
      canActivate: false,
    })
    parsed.valid = false
  }
  if (parsed.valid !== false) parsed.valid = true
  return parsed
}

function validLatLonBox(box) {
  return Number.isFinite(box.north)
    && Number.isFinite(box.south)
    && Number.isFinite(box.east)
    && Number.isFinite(box.west)
    && box.north >= box.south
    && box.north <= 90
    && box.south >= -90
    && box.east >= -180
    && box.east <= 180
    && box.west >= -180
    && box.west <= 180
}

function parsePlacemarkGeometry(placemark, context) {
  const geometries = []
  for (const type of ['Point', 'LineString', 'Polygon', 'MultiGeometry']) {
    children(placemark, type).forEach((geometry, index) => {
      const parsed = parseGeometry(type, geometry, {
        ...context,
        geometryReference: `${type}[${index}]`,
      })
      if (parsed) geometries.push(parsed)
    })
  }
  if (!geometries.length) return null
  if (geometries.length === 1) return geometries[0]
  return {
    type: 'MultiGeometry',
    geometries,
    normalization: {
      sourceGeometryCount: geometries.length,
      combinedDirectGeometries: true,
    },
  }
}

function parseGeometry(type, geometry, context) {
  const altitudeMode = normalizedText(firstChild(geometry, 'altitudeMode')) || undefined
  if (type === 'Point') {
    const sequence = parseCoordinateSequence(firstChild(geometry, 'coordinates'))
    let valid = validatePositions(sequence.coordinates, context)
    if (sequence.coordinates.length !== 1) {
      valid = false
      addGeometryIssue(context, {
        issueCode: 'invalid_point_coordinate_count',
        message: 'Point harus memiliki tepat satu tuple koordinat.',
      })
    }
    return {
      type,
      coordinates: sequence.coordinates[0] ?? [],
      sourceCoordinates: sequence.sourceCoordinates,
      valid,
      ...(altitudeMode ? { altitudeMode } : {}),
    }
  }
  if (type === 'LineString') {
    const sequence = parseCoordinateSequence(firstChild(geometry, 'coordinates'))
    let valid = validatePositions(sequence.coordinates, context)
    if (sequence.coordinates.length < 2) {
      valid = false
      addGeometryIssue(context, {
        issueCode: 'line_too_short',
        message: 'LineString minimal harus memiliki dua koordinat.',
      })
    }
    return {
      type,
      coordinates: sequence.coordinates,
      sourceCoordinates: sequence.sourceCoordinates,
      valid,
      ...(altitudeMode ? { altitudeMode } : {}),
    }
  }
  if (type === 'Polygon') {
    const rings = []
    const sourceRings = []
    let valid = true
    const outer = firstChild(firstChild(geometry, 'outerBoundaryIs'), 'LinearRing')
    if (!outer) {
      valid = false
      addGeometryIssue(context, {
        issueCode: 'polygon_missing_outer_ring',
        message: 'Polygon tidak memiliki outerBoundaryIs yang valid.',
      })
    } else {
      const sequence = parseCoordinateSequence(firstChild(outer, 'coordinates'))
      sourceRings.push(sequence.sourceCoordinates)
      const normalizedRing = normalizePolygonRing(sequence.coordinates, {
        ...context,
        geometryReference: `${context.geometryReference}.outerBoundaryIs`,
      })
      rings.push(normalizedRing.coordinates)
      valid = valid && normalizedRing.valid
    }
    children(geometry, 'innerBoundaryIs').forEach((boundary, index) => {
      const ring = firstChild(boundary, 'LinearRing')
      if (!ring) {
        valid = false
        addGeometryIssue(context, {
          issueCode: 'polygon_invalid_inner_ring',
          message: `innerBoundaryIs ke-${index + 1} tidak memiliki LinearRing.`,
        })
        return
      }
      const sequence = parseCoordinateSequence(firstChild(ring, 'coordinates'))
      sourceRings.push(sequence.sourceCoordinates)
      const normalizedRing = normalizePolygonRing(sequence.coordinates, {
        ...context,
        geometryReference: `${context.geometryReference}.innerBoundaryIs[${index}]`,
      })
      rings.push(normalizedRing.coordinates)
      valid = valid && normalizedRing.valid
    })
    return {
      type,
      coordinates: rings,
      sourceCoordinates: sourceRings,
      valid,
      ...(altitudeMode ? { altitudeMode } : {}),
    }
  }
  if (type === 'MultiGeometry') {
    const geometries = []
    for (const childType of ['Point', 'LineString', 'Polygon']) {
      children(geometry, childType).forEach((child, index) => {
        const parsed = parseGeometry(childType, child, {
          ...context,
          geometryReference: `${context.geometryReference}.${childType}[${index}]`,
        })
        if (parsed) geometries.push(parsed)
      })
    }
    if (!geometries.length) {
      addGeometryIssue(context, {
        issueCode: 'empty_multi_geometry',
        message: 'MultiGeometry tidak memiliki geometry yang didukung.',
      })
    }
    return {
      type,
      geometries,
      valid: geometries.length > 0 && geometries.every((item) => item.valid !== false),
      ...(altitudeMode ? { altitudeMode } : {}),
    }
  }
  return null
}

function parseCoordinateSequence(value) {
  const sourceCoordinates = textValue(value).trim()
  const coordinates = sourceCoordinates
    .split(/\s+/)
    .filter(Boolean)
    .map((tuple) => tuple.split(',').map((coordinate) => (
      coordinate.trim() === '' ? Number.NaN : Number(coordinate.trim())
    )))
  return { sourceCoordinates, coordinates }
}

function validatePositions(positions, context) {
  let valid = true
  positions.forEach((position, index) => {
    const reason = invalidPositionReason(position)
    if (reason) {
      valid = false
      addGeometryIssue(context, {
        issueCode: 'invalid_coordinate',
        message: `Koordinat ke-${index + 1} tidak valid: ${reason}.`,
      })
    }
  })
  return valid
}

function invalidPositionReason(position) {
  if (!Array.isArray(position) || position.length < 2 || position.length > 3) {
    return 'tuple harus berisi longitude, latitude, dan altitude opsional'
  }
  const [longitude, latitude, altitude] = position
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return 'longitude berada di luar rentang -180 sampai 180'
  }
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return 'latitude berada di luar rentang -90 sampai 90'
  }
  if (altitude !== undefined && !Number.isFinite(altitude)) {
    return 'altitude bukan angka yang valid'
  }
  return null
}

function normalizePolygonRing(inputPositions, context) {
  const positions = inputPositions.map((position) => [...position])
  let valid = validatePositions(positions, context)
  if (positions.length < 3) {
    valid = false
    addGeometryIssue(context, {
      issueCode: 'polygon_ring_too_short',
      message: 'Ring polygon minimal harus memiliki tiga vertex sebelum penutupan.',
    })
    return { coordinates: positions, valid }
  }

  if (valid && !samePosition(positions[0], positions.at(-1))) {
    positions.push([...positions[0]])
    context.issues.push({
      severity: 'information',
      issueCode: 'polygon_ring_closed',
      message: 'Ring polygon ditutup dengan menambahkan kembali koordinat awal tanpa mengubah urutan vertex.',
      sourceFolderPath: context.sourceFolderPath,
      sourcePlacemarkName: context.sourcePlacemarkName,
      geometryReference: context.geometryReference,
      canActivate: true,
    })
  }

  if (positions.length < 4 || new Set(
    positions.slice(0, -1).map((position) => `${position[0]},${position[1]}`),
  ).size < 3 || Math.abs(signedRingArea(positions)) < Number.EPSILON) {
    valid = false
    addGeometryIssue(context, {
      issueCode: 'invalid_polygon_ring',
      message: 'Ring polygon tidak memiliki minimal tiga vertex unik.',
    })
  }
  return { coordinates: positions, valid }
}

function signedRingArea(positions) {
  if (positions.some((position) => invalidPositionReason(position))) return 0
  let area = 0
  for (let index = 0; index < positions.length - 1; index += 1) {
    const current = positions[index]
    const next = positions[index + 1]
    area += current[0] * next[1] - next[0] * current[1]
  }
  return area / 2
}

function samePosition(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index])
}

function addGeometryIssue(context, { issueCode, message }) {
  context.issues.push({
    severity: 'error',
    issueCode,
    message,
    sourceFolderPath: context.sourceFolderPath,
    sourcePlacemarkName: context.sourcePlacemarkName,
    geometryReference: context.geometryReference,
    canActivate: false,
  })
}

function parseExtendedData(extendedData) {
  if (!extendedData || typeof extendedData !== 'object') return {}
  const data = []

  children(extendedData, 'Data').forEach((entry) => {
    const name = attribute(entry, 'name')
    if (!name) return
    data.push({
      name,
      value: textValue(firstChild(entry, 'value')),
      sourceElement: 'Data',
    })
  })
  children(extendedData, 'SchemaData').forEach((schemaData) => {
    children(schemaData, 'SimpleData').forEach((entry) => {
      const name = attribute(entry, 'name')
      if (!name) return
      data.push({
        name,
        value: textValue(entry),
        sourceElement: 'SimpleData',
        ...(attribute(schemaData, 'schemaUrl')
          ? { schemaUrl: attribute(schemaData, 'schemaUrl') }
          : {}),
      })
    })
  })

  return { data }
}

function collectStyles(node, output) {
  walkElements(node, (name, value) => {
    if (name === 'Style') {
      const parsed = parseStyle(value)
      if (parsed.id) output.styles.push(parsed)
    } else if (name === 'StyleMap') {
      const parsed = parseStyleMap(value)
      if (parsed.id) output.styleMaps.push(parsed)
    }
  })
}

function parseStyle(style) {
  const iconStyle = firstChild(style, 'IconStyle')
  const lineStyle = firstChild(style, 'LineStyle')
  const polyStyle = firstChild(style, 'PolyStyle')
  const labelStyle = firstChild(style, 'LabelStyle')
  return {
    id: attribute(style, 'id') || undefined,
    type: 'Style',
    ...(iconStyle
      ? {
        iconStyle: {
          color: normalizedText(firstChild(iconStyle, 'color')) || undefined,
          scale: optionalNumber(firstChild(iconStyle, 'scale')),
          heading: optionalNumber(firstChild(iconStyle, 'heading')),
          iconHref: normalizedText(firstChild(firstChild(iconStyle, 'Icon'), 'href')) || undefined,
        },
      }
      : {}),
    ...(lineStyle
      ? {
        lineStyle: {
          color: normalizedText(firstChild(lineStyle, 'color')) || undefined,
          width: optionalNumber(firstChild(lineStyle, 'width')),
        },
      }
      : {}),
    ...(polyStyle
      ? {
        polyStyle: {
          color: normalizedText(firstChild(polyStyle, 'color')) || undefined,
          fill: parseOptionalBoolean(firstChild(polyStyle, 'fill')),
          outline: parseOptionalBoolean(firstChild(polyStyle, 'outline')),
        },
      }
      : {}),
    ...(labelStyle
      ? {
        labelStyle: {
          color: normalizedText(firstChild(labelStyle, 'color')) || undefined,
          scale: optionalNumber(firstChild(labelStyle, 'scale')),
        },
      }
      : {}),
    sourceStyle: structuredClone(style),
  }
}

function parseStyleMap(styleMap) {
  return {
    id: attribute(styleMap, 'id') || undefined,
    type: 'StyleMap',
    pairs: children(styleMap, 'Pair').map((pair) => ({
      key: normalizedText(firstChild(pair, 'key')),
      styleUrl: normalizedText(firstChild(pair, 'styleUrl')),
    })),
    sourceStyle: structuredClone(styleMap),
  }
}

function resolveFeatureStyles(output) {
  const styles = new Map(output.styles.map((style) => [style.id, style]))
  const styleMaps = new Map(output.styleMaps.map((styleMap) => [styleMap.id, styleMap]))
  const resolve = (styleUrl, inlineStyle, trail = []) => {
    if (inlineStyle) return resolvedStyle(inlineStyle, [...trail, 'inline:Style'])
    const id = stripStyleReference(styleUrl)
    if (!id) return null
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(styleUrl)) {
      return { externalStyleUrl: styleUrl, resolutionPath: [...trail, styleUrl] }
    }
    if (trail.includes(id)) {
      output.issues.push({
        severity: 'error',
        issueCode: 'circular_style_reference',
        message: `Referensi StyleMap berputar pada "${id}".`,
        canActivate: false,
      })
      return { resolutionPath: [...trail, id], unresolved: true }
    }
    if (styles.has(id)) return resolvedStyle(styles.get(id), [...trail, id])
    const styleMap = styleMaps.get(id)
    if (styleMap) {
      const pair = styleMap.pairs.find(({ key }) => key === 'normal') ?? styleMap.pairs[0]
      if (pair?.styleUrl) return resolve(pair.styleUrl, null, [...trail, id])
    }
    output.issues.push({
      severity: 'warning',
      issueCode: 'missing_style_reference',
      message: `Referensi style "${styleUrl}" tidak ditemukan.`,
      canActivate: true,
    })
    return { resolutionPath: [...trail, id], unresolved: true }
  }

  walkFeatures(output, (feature) => {
    const resolution = resolve(feature.properties?.styleUrl, feature.inlineStyle)
    if (resolution) feature.resolvedStyle = resolution
  })
}

function resolvedStyle(style, resolutionPath) {
  return {
    resolvedStyleId: style.id,
    resolvedIconHref: style.iconStyle?.iconHref,
    resolvedIconColor: style.iconStyle?.color,
    resolvedIconScale: style.iconStyle?.scale,
    resolvedLineColor: style.lineStyle?.color,
    resolvedLineWidth: style.lineStyle?.width,
    resolvedPolygonColor: style.polyStyle?.color,
    resolvedFill: style.polyStyle?.fill,
    resolvedOutline: style.polyStyle?.outline,
    resolvedLabelColor: style.labelStyle?.color,
    resolvedLabelScale: style.labelStyle?.scale,
    resolutionPath,
  }
}

function walkFeatures(output, visitor) {
  output.placemarks.forEach(visitor)
  const visitFolder = (folder) => {
    folder.placemarks.forEach(visitor)
    folder.children.forEach(visitFolder)
  }
  output.folders.forEach(visitFolder)
}

function buildParserCoverage(output) {
  const geometryCountByType = {}
  let invalidGeometryCount = 0
  walkFeatures(output, (feature) => {
    visitGeometry(feature.geometry, (geometry) => {
      geometryCountByType[geometry.type] = (geometryCountByType[geometry.type] ?? 0) + 1
      if (geometry.valid === false) invalidGeometryCount += 1
    })
  })
  return {
    documentCount: output.structure.documentCount,
    folderCount: output.structure.folderCount,
    placemarkCount: output.structure.placemarkCount,
    geometryCountByType,
    overlayCount: output.structure.overlayCount,
    styleCount: output.styles.length,
    styleMapCount: output.styleMaps.length,
    unsupportedCountByType: Object.fromEntries(
      [...new Set(output.unsupportedElements.map(({ name }) => name))]
        .sort()
        .map((name) => [
          name,
          output.unsupportedElements.filter((item) => item.name === name).length,
        ]),
    ),
    invalidGeometryCount,
  }
}

function visitGeometry(geometry, visitor) {
  if (!geometry) return
  visitor(geometry)
  if (geometry.type === 'MultiGeometry') {
    geometry.geometries.forEach((item) => visitGeometry(item, visitor))
    return
  }
}

function walkElements(node, visitor) {
  if (!node || typeof node !== 'object') return
  for (const [key, rawValue] of Object.entries(node)) {
    if (key.startsWith('@_') || key === '#text') continue
    const name = localName(key)
    const values = Array.isArray(rawValue) ? rawValue : [rawValue]
    values.forEach((value) => {
      visitor(name, value)
      walkElements(value, visitor)
    })
  }
}

function countElements(node, expectedName) {
  let count = 0
  walkElements(node, (name) => {
    if (name === expectedName) count += 1
  })
  return count
}

function collectUnsupportedElements(node, output, path = '/') {
  if (!node || typeof node !== 'object') return
  for (const [key, rawValue] of Object.entries(node)) {
    if (key.startsWith('@_') || key === '#text') continue
    const name = localName(key)
    const values = Array.isArray(rawValue) ? rawValue : [rawValue]
    values.forEach((value) => {
      const nextPath = `${path}${name}/`
      if (UNSUPPORTED_ELEMENTS.has(name)) {
        output.push({
          name,
          geometryReference: nextPath,
          canActivate: !CRITICAL_UNSUPPORTED_ELEMENTS.has(name),
        })
      }
      collectUnsupportedElements(value, output, nextPath)
    })
  }
}

function mapFolderCategory(name, mappings) {
  const normalizedName = normalizeLookupKey(name)
  let bestMatch = null
  for (const mapping of mappings) {
    if (!mapping || typeof mapping !== 'object' || typeof mapping.category !== 'string') continue
    const aliases = Array.isArray(mapping.aliases) ? mapping.aliases : []
    for (const rawAlias of aliases) {
      const alias = normalizeLookupKey(rawAlias)
      if (!aliasMatchesFolder(normalizedName, alias)) continue
      if (!bestMatch || alias.length > bestMatch.aliasLength) {
        bestMatch = {
          aliasLength: alias.length,
          category: mapping.category,
        }
      }
    }
  }
  return bestMatch?.category ?? 'unmapped'
}

function aliasMatchesFolder(folderName, alias) {
  if (!alias) return false
  if (folderName === alias) return true
  if (alias.length <= 3) return false
  return ` ${folderName} `.includes(` ${alias} `)
}

function normalizeLookupKey(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
}

function sanitizeDescription(value) {
  return String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripStyleReference(value) {
  return String(value ?? '').replace(/^#/, '').trim()
}

function optionalNumber(value) {
  const text = normalizedText(value)
  if (!text) return undefined
  const number = Number(text)
  return Number.isFinite(number) ? number : undefined
}

function parseOptionalBoolean(value) {
  const text = normalizedText(value)
  if (!text) return undefined
  return text !== '0' && text.toLowerCase() !== 'false'
}

function children(node, expectedName) {
  if (!node || typeof node !== 'object') return []
  return Object.entries(node)
    .filter(([key]) => localName(key) === expectedName)
    .flatMap(([, value]) => Array.isArray(value) ? value : [value])
    .filter((value) => value !== undefined && value !== null)
}

function firstChild(node, expectedName) {
  return children(node, expectedName)[0]
}

function attribute(node, name) {
  if (!node || typeof node !== 'object') return ''
  const entry = Object.entries(node).find(([key]) => (
    key.startsWith('@_') && localName(key.slice(2)) === name
  ))
  return normalizedText(entry?.[1])
}

function textValue(value) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'object' && value['#text'] !== undefined) {
    return String(value['#text'])
  }
  return ''
}

function normalizedText(value) {
  return textValue(value).trim()
}

function parseVisibility(value) {
  const text = normalizedText(value)
  return text === '' ? true : text !== '0' && text.toLowerCase() !== 'false'
}

function joinFolderPath(parentPath, name) {
  const cleanName = name.replace(/^\/+|\/+$/g, '')
  return parentPath === '/' ? `/${cleanName}` : `${parentPath.replace(/\/+$/, '')}/${cleanName}`
}

function localName(name) {
  return String(name).split(':').at(-1)
}

function kmlNamespace(kmlRoot) {
  if (!kmlRoot || typeof kmlRoot !== 'object') return ''
  const entry = Object.entries(kmlRoot).find(([key, value]) => (
    key.startsWith('@_xmlns')
    && String(value).includes('/kml/')
  ))
  return normalizedText(entry?.[1])
}
