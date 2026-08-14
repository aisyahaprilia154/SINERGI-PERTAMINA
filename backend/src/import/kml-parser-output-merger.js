import path from 'node:path'

/**
 * Combines every valid KML document in a KMZ into one canonical parser input.
 * The order supplied by orderKmlCandidates is preserved so the merge remains
 * deterministic across re-imports.
 */
export function mergeKmlParserOutputs(entries = []) {
  if (!entries.length) throw new TypeError('Minimal satu hasil parser KML wajib tersedia.')

  const availablePaths = new Set(entries.map(({ relativePath }) => normalizePackagePath(relativePath)))
  const merged = {
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
      styleCount: 0,
      styleMapCount: 0,
      kmlDocumentCount: entries.length,
    },
  }

  const namespaces = new Set()
  entries.forEach(({ relativePath, parserOutput }) => {
    const sourceDocumentPath = normalizePackagePath(relativePath)
    if (parserOutput.namespace) namespaces.add(parserOutput.namespace)
    annotateSourceDocument(parserOutput, sourceDocumentPath)

    merged.folders.push(...(parserOutput.folders ?? []))
    merged.placemarks.push(...(parserOutput.placemarks ?? []))
    merged.overlays.push(...(parserOutput.overlays ?? []))
    merged.styles.push(...(parserOutput.styles ?? []))
    merged.styleMaps.push(...(parserOutput.styleMaps ?? []))
    merged.issues.push(...(parserOutput.issues ?? []))

    ;(parserOutput.unsupportedElements ?? []).forEach((element) => {
      const linkedPath = element.name === 'NetworkLink'
        ? resolveLocalKmlReference(sourceDocumentPath, element.href)
        : null
      if (linkedPath && availablePaths.has(linkedPath)) {
        merged.issues.push({
          severity: 'information',
          issueCode: 'local_network_link_merged',
          message: `NetworkLink lokal ${element.href} digabung dari paket KMZ.`,
          sourceDocumentPath,
          canActivate: true,
        })
        return
      }
      merged.unsupportedElements.push({
        ...element,
        sourceDocumentPath,
      })
    })

    merged.structure.documentCount += parserOutput.structure?.documentCount ?? 0
    merged.structure.folderCount += parserOutput.structure?.folderCount ?? 0
    merged.structure.placemarkCount += parserOutput.structure?.placemarkCount ?? 0
    merged.structure.overlayCount += parserOutput.structure?.overlayCount ?? 0
    merged.structure.styleCount += parserOutput.structure?.styleCount
      ?? parserOutput.styles?.length
      ?? 0
    merged.structure.styleMapCount += parserOutput.structure?.styleMapCount
      ?? parserOutput.styleMaps?.length
      ?? 0
  })

  if (namespaces.size === 1) merged.namespace = [...namespaces][0]
  merged.coverage = mergeCoverage(entries, merged.unsupportedElements)
  return merged
}

function annotateSourceDocument(parserOutput, sourceDocumentPath) {
  const annotateFeature = (feature) => {
    feature.sourceDocumentPath = sourceDocumentPath
    feature.properties = {
      ...(feature.properties ?? {}),
      sourceDocumentPath,
    }
  }
  ;(parserOutput.placemarks ?? []).forEach(annotateFeature)
  ;(parserOutput.overlays ?? []).forEach((overlay) => {
    overlay.sourceDocumentPath = sourceDocumentPath
  })
  const visitFolder = (folder) => {
    folder.sourceDocumentPath = sourceDocumentPath
    ;(folder.placemarks ?? []).forEach(annotateFeature)
    ;(folder.overlays ?? []).forEach((overlay) => {
      overlay.sourceDocumentPath = sourceDocumentPath
    })
    ;(folder.children ?? []).forEach(visitFolder)
  }
  ;(parserOutput.folders ?? []).forEach(visitFolder)
}

function mergeCoverage(entries, unsupportedElements) {
  const geometryCountByType = {}
  let invalidGeometryCount = 0
  let documentCount = 0
  let folderCount = 0
  let placemarkCount = 0
  let overlayCount = 0
  let styleCount = 0
  let styleMapCount = 0

  entries.forEach(({ parserOutput }) => {
    const coverage = parserOutput.coverage ?? {}
    documentCount += coverage.documentCount ?? 0
    folderCount += coverage.folderCount ?? 0
    placemarkCount += coverage.placemarkCount ?? 0
    overlayCount += coverage.overlayCount ?? 0
    styleCount += coverage.styleCount ?? 0
    styleMapCount += coverage.styleMapCount ?? 0
    invalidGeometryCount += coverage.invalidGeometryCount ?? 0
    Object.entries(coverage.geometryCountByType ?? {}).forEach(([type, count]) => {
      geometryCountByType[type] = (geometryCountByType[type] ?? 0) + Number(count || 0)
    })
  })

  return {
    documentCount,
    folderCount,
    placemarkCount,
    geometryCountByType,
    overlayCount,
    styleCount,
    styleMapCount,
    unsupportedCountByType: Object.fromEntries(
      [...new Set(unsupportedElements.map(({ name }) => name))]
        .sort()
        .map((name) => [
          name,
          unsupportedElements.filter((item) => item.name === name).length,
        ]),
    ),
    invalidGeometryCount,
  }
}

function resolveLocalKmlReference(sourceDocumentPath, href) {
  const rawHref = String(href ?? '').trim()
  if (!rawHref || /^[a-z][a-z0-9+.-]*:/i.test(rawHref) || rawHref.startsWith('//')) return null
  let decoded
  try {
    decoded = decodeURIComponent(rawHref.split(/[?#]/, 1)[0])
  } catch {
    return null
  }
  const normalized = normalizePackagePath(path.posix.join(
    path.posix.dirname(sourceDocumentPath),
    decoded.replace(/\\/g, '/'),
  ))
  if (!normalized || normalized === '..' || normalized.startsWith('../')) return null
  return normalized.toLowerCase().endsWith('.kml') ? normalized : null
}

function normalizePackagePath(value) {
  return path.posix.normalize(String(value ?? '').replace(/\\/g, '/')).replace(/^\.\//, '')
}
