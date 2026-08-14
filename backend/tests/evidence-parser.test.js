import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCanonicalParserResult,
  CLASSIFICATION_RULE_SET_VERSION,
  PARSER_VERSION,
  rebuildStoredTopologyInputBundle,
} from '../src/domain/parser-contract.js'
import { parseKmlText } from '../src/import/kml-parser.js'

const DATASET_VERSION = Object.freeze({
  id: 'dv-evidence',
  branchId: 'site-semarang',
  checksum: `sha256:${'a'.repeat(64)}`,
})

test('parses GroundOverlay, gx:LatLonQuad, and LabelStyle as supported evidence', () => {
  const output = parseKmlText(`<?xml version="1.0"?>
    <kml xmlns="http://www.opengis.net/kml/2.2"
         xmlns:gx="http://www.google.com/kml/ext/2.2">
      <Document>
        <Style id="label-style">
          <LabelStyle><color>ff00ffff</color><scale>1.25</scale></LabelStyle>
        </Style>
        <Placemark id="labelled">
          <name>Labelled</name><styleUrl>#label-style</styleUrl>
          <Point><coordinates>110,-7</coordinates></Point>
        </Placemark>
        <GroundOverlay id="box-overlay">
          <name>Site plan</name><drawOrder>3</drawOrder>
          <Icon><href>images/site.png</href></Icon>
          <LatLonBox>
            <north>-6</north><south>-7</south><east>111</east><west>110</west>
            <rotation>5</rotation>
          </LatLonBox>
        </GroundOverlay>
        <GroundOverlay id="quad-overlay">
          <Icon><href>images/quad.png</href></Icon>
          <gx:LatLonQuad>
            <coordinates>110,-7 111,-7 111,-6 110,-6</coordinates>
          </gx:LatLonQuad>
        </GroundOverlay>
      </Document>
    </kml>`)

  assert.equal(output.overlays.length, 2)
  assert.equal(output.overlays[0].latLonBox.rotation, 5)
  assert.equal(output.overlays[1].latLonQuad.coordinates.length, 4)
  assert.equal(output.styles[0].labelStyle.scale, 1.25)
  assert.equal(output.placemarks[0].resolvedStyle.resolvedLabelColor, 'ff00ffff')
  assert.deepEqual(output.placemarks[0].resolvedStyle.resolutionPath, ['label-style'])
  assert.equal(output.unsupportedElements.some(({ name }) => name === 'GroundOverlay'), false)
  assert.equal(output.unsupportedElements.some(({ name }) => name === 'LabelStyle'), false)
})

test('StyleMap resolution is traceable and circular references become issues', () => {
  const output = parseKmlText(`<?xml version="1.0"?>
    <kml><Document>
      <Style id="normal"><IconStyle><Icon><href>icons/a.png</href></Icon></IconStyle></Style>
      <StyleMap id="mapped"><Pair><key>normal</key><styleUrl>#normal</styleUrl></Pair></StyleMap>
      <StyleMap id="cycle-a"><Pair><key>normal</key><styleUrl>#cycle-b</styleUrl></Pair></StyleMap>
      <StyleMap id="cycle-b"><Pair><key>normal</key><styleUrl>#cycle-a</styleUrl></Pair></StyleMap>
      <Placemark><name>Resolved</name><styleUrl>#mapped</styleUrl>
        <Point><coordinates>110,-7</coordinates></Point>
      </Placemark>
      <Placemark><name>Circular</name><styleUrl>#cycle-a</styleUrl>
        <Point><coordinates>111,-7</coordinates></Point>
      </Placemark>
    </Document></kml>`)

  assert.equal(output.placemarks[0].resolvedStyle.resolvedIconHref, 'icons/a.png')
  assert.deepEqual(output.placemarks[0].resolvedStyle.resolutionPath, ['mapped', 'normal'])
  assert.ok(output.issues.some(({ issueCode }) => issueCode === 'circular_style_reference'))
})

test('canonical evidence is deterministic, versioned, and topology bundle only contains eligible objects', () => {
  const parserOutput = parseKmlText(`<?xml version="1.0"?>
    <kml><Document>
      <Folder><name>Fiber Optic</name>
        <Placemark id="fo-1"><name>FO Backbone</name>
          <ExtendedData>
            <Data name="asset_id"><value>FO-01</value></Data>
            <Data name="connected_to"><value>SW-01</value></Data>
          </ExtendedData>
          <LineString><coordinates>110,-7 111,-7</coordinates></LineString>
        </Placemark>
      </Folder>
      <Placemark id="visual"><name>Visual Only marker</name>
        <Point><coordinates>110,-7</coordinates></Point>
      </Placemark>
      <Placemark id="unknown"><name>Misterius</name>
        <Point><coordinates>111,-7</coordinates></Point>
      </Placemark>
      <Placemark id="invalid"><name>CCTV invalid</name>
        <Point><coordinates>181,-7</coordinates></Point>
      </Placemark>
    </Document></kml>`)

  const input = {
    parserOutput,
    datasetVersion: DATASET_VERSION,
    sourceSelection: { selectedKmlPath: 'doc.kml', resources: [] },
  }
  const first = buildCanonicalParserResult(input)
  const second = buildCanonicalParserResult(input)

  assert.deepEqual(first, second)
  assert.equal(first.parserVersion, PARSER_VERSION)
  assert.ok(first.sourceFeatures.every(({ datasetVersionId }) => (
    datasetVersionId === DATASET_VERSION.id
  )))
  assert.ok(first.sourceGeometries.every(({ sourceVertexOrderPreserved }) => (
    sourceVertexOrderPreserved === true
  )))
  assert.equal(first.topologyInputBundle.classifiedPaths.length, 1)
  assert.equal(first.topologyInputBundle.classifiedNodes.length, 0)
  assert.equal(first.topologyInputBundle.geometries.length, 1)
  assert.equal(first.topologyInputBundle.geometries[0].geometryType, 'LineString')
  assert.equal(first.topologyInputBundle.topologyReady, false)
  assert.equal(first.readiness.topologyReadiness, 'not_applicable')
  assert.equal(first.explicitRelationEvidence[0].validationStatus, (
    'pending_stable_identity_resolution'
  ))
  assert.ok(first.classifiedObjects.some(({ objectRole }) => objectRole === 'visual_only'))
  assert.ok(first.classifiedObjects.some(({ objectRole }) => objectRole === 'unknown'))
  assert.ok(first.sourceGeometries.some(({ valid }) => valid === false))
})

test('specific rack evidence overrides a generic JUNCTION BOX folder and JB power pairs are distribution', () => {
  const parserOutput = parseKmlText(`<?xml version="1.0"?>
    <kml><Document>
      <Folder><name>JUNCTION BOX</name>
        <Placemark id="rack"><name>JB-Rack Server</name>
          <Point><coordinates>110,-7</coordinates></Point>
        </Placemark>
      </Folder>
      <Folder><name>POWER PLN</name>
        <Placemark id="jb-power"><name>JB-015_JB-015.1</name>
          <LineString><coordinates>110,-7 110.001,-7</coordinates></LineString>
        </Placemark>
      </Folder>
    </Document></kml>`)
  const result = buildCanonicalParserResult({
    parserOutput,
    datasetVersion: DATASET_VERSION,
    sourceSelection: { selectedKmlPath: 'doc.kml', resources: [] },
  })

  const rack = result.classifiedObjects.find(({ assetName }) => assetName === 'JB-Rack Server')
  const powerPair = result.classifiedObjects.find(({ assetName }) => assetName === 'JB-015_JB-015.1')
  assert.equal(rack.canonicalAssetType, 'server_rack')
  assert.equal(rack.canonicalCategory, 'server_rack')
  assert.equal(rack.jbProfileId, 'builtin:server_rack')
  assert.equal(powerPair.objectRole, 'cable_path')
  assert.equal(powerPair.cableRole, 'distribution')
})

test('WP and EXP are not Extended markers without structural or explicit profile evidence', () => {
  const parserOutput = parseKmlText(`<?xml version="1.0"?>
    <kml><Document>
      <Folder><name>JUNCTION BOX</name>
        <Placemark id="wp-main"><name>JB-001-WP</name>
          <Point><coordinates>110,-7</coordinates></Point>
        </Placemark>
        <Placemark id="exp-main"><name>JB-002-EXP</name>
          <Point><coordinates>110.001,-7</coordinates></Point>
        </Placemark>
        <Placemark id="child"><name>JB-003.1-WP</name>
          <Point><coordinates>110.002,-7</coordinates></Point>
        </Placemark>
        <Placemark id="explicit"><name>JB-004-WP</name>
          <ExtendedData><Data name="profile_id"><value>extended_passive</value></Data></ExtendedData>
          <Point><coordinates>110.003,-7</coordinates></Point>
        </Placemark>
      </Folder>
      <Folder><name>Extended</name>
        <Placemark id="folder"><name>JB-005-WP</name>
          <Point><coordinates>110.004,-7</coordinates></Point>
        </Placemark>
      </Folder>
    </Document></kml>`)
  const result = buildCanonicalParserResult({
    parserOutput,
    datasetVersion: DATASET_VERSION,
    sourceSelection: { selectedKmlPath: 'doc.kml', resources: [] },
  })
  const profileByName = new Map(result.classifiedObjects.map((object) => [
    object.assetName,
    object.jbProfileId,
  ]))

  assert.equal(profileByName.get('JB-001-WP'), 'builtin:main_jb')
  assert.equal(profileByName.get('JB-002-EXP'), 'builtin:main_jb')
  assert.equal(profileByName.get('JB-003.1-WP'), 'builtin:extended_passive')
  assert.equal(profileByName.get('JB-004-WP'), 'builtin:extended_passive')
  assert.equal(profileByName.get('JB-005-WP'), 'builtin:extended_passive')
})

test('RS, CR, and SVR-OFFICE are Rack Server aliases', () => {
  const parserOutput = parseKmlText(`<?xml version="1.0"?>
    <kml><Document><Folder><name>JUNCTION BOX</name>
      <Placemark id="rs"><name>RS_JB-019</name>
        <Point><coordinates>110,-7</coordinates></Point>
      </Placemark>
      <Placemark id="cr"><name>CR_JB-001</name>
        <Point><coordinates>110.001,-7</coordinates></Point>
      </Placemark>
      <Placemark id="svr"><name>SVR-OFFICE_JB-017</name>
        <Point><coordinates>110.002,-7</coordinates></Point>
      </Placemark>
    </Folder></Document></kml>`)
  const result = buildCanonicalParserResult({
    parserOutput,
    datasetVersion: DATASET_VERSION,
    sourceSelection: { selectedKmlPath: 'doc.kml', resources: [] },
  })

  result.classifiedObjects.forEach((object) => {
    assert.equal(object.canonicalAssetType, 'server_rack')
    assert.equal(object.jbProfileId, 'builtin:server_rack')
  })
})

test('canonical coverage is fail-closed when parser structure and preserved features diverge', () => {
  const parserOutput = parseKmlText(`<?xml version="1.0"?>
    <kml><Document>
      <Placemark id="asset-1"><name>CCTV 1</name>
        <Point><coordinates>110,-7</coordinates></Point>
      </Placemark>
    </Document></kml>`)
  parserOutput.structure.placemarkCount = 2

  const result = buildCanonicalParserResult({
    parserOutput,
    datasetVersion: DATASET_VERSION,
    sourceSelection: { selectedKmlPath: 'doc.kml', resources: [] },
  })

  assert.equal(result.coverage.canonicalPlacemarkCount, 1)
  assert.equal(result.coverage.unpreservedPlacemarkCount, 1)
  assert.equal(result.readiness.parseReadiness, 'not_ready')
  assert.ok(result.issues.some(({ issueCode, canPublish }) => (
    issueCode === 'parser_placemark_coverage_mismatch' && canPublish === false
  )))
})

test('adding a new asset preserves every old feature and increments coverage exactly once', () => {
  const build = (extra = '') => buildCanonicalParserResult({
    parserOutput: parseKmlText(`<?xml version="1.0"?>
      <kml><Document><Folder><name>CCTV</name>
        <Placemark id="cam-1"><name>Camera 1</name>
          <Point><coordinates>110,-7</coordinates></Point>
        </Placemark>
        ${extra}
      </Folder></Document></kml>`),
    datasetVersion: DATASET_VERSION,
    sourceSelection: { selectedKmlPath: 'doc.kml', resources: [] },
  })
  const before = build()
  const after = build(`<Placemark id="cam-2"><name>Camera 2</name>
    <Point><coordinates>111,-7</coordinates></Point>
  </Placemark>`)

  assert.equal(before.coverage.placemarkCount, 1)
  assert.equal(after.coverage.placemarkCount, 2)
  assert.equal(after.coverage.canonicalPlacemarkCount, 2)
  assert.equal(after.coverage.unpreservedPlacemarkCount, 0)
  assert.ok(before.sourceFeatures.every((feature) => (
    after.sourceFeatures.some(({ sourceFeatureId }) => sourceFeatureId === feature.sourceFeatureId)
  )))
})

test('stored topology rebuild refreshes stale known classifications from source evidence', () => {
  const parserOutput = parseKmlText(`<?xml version="1.0"?>
    <kml><Document>
      <Folder><name>JUNCTION BOX</name>
        <Placemark id="jb-002"><name>JB-002-exp</name>
          <Point><coordinates>110,-7</coordinates></Point>
        </Placemark>
      </Folder>
    </Document></kml>`)
  const parsed = buildCanonicalParserResult({
    parserOutput,
    datasetVersion: DATASET_VERSION,
    sourceSelection: { selectedKmlPath: 'doc.kml', resources: [] },
  })
  const stale = {
    ...structuredClone(parsed),
    datasetVersion: DATASET_VERSION,
    classifiedObjects: parsed.classifiedObjects.map((object) => ({
      ...structuredClone(object),
      assetType: 'cctv',
      category: 'cctv',
      classificationRuleSetVersion: 'semantic-classifier/1.0.0',
    })),
  }

  const repaired = rebuildStoredTopologyInputBundle(stale)
  const node = repaired.classifiedObjects.find(({ sourceFeatureId }) => (
    sourceFeatureId === parsed.sourceFeatures[0].sourceFeatureId
  ))

  assert.equal(repaired.repairedCount, 1)
  assert.equal(node.objectRole, 'device_node')
  assert.equal(node.networkFamily, 'cctv')
  assert.equal(node.assetType, 'junction box')
  assert.equal(node.classificationRuleSetVersion, CLASSIFICATION_RULE_SET_VERSION)
  assert.ok(repaired.changed)
})

test('stored topology rebuild preserves manual relation evidence without a source feature', () => {
  const parserOutput = parseKmlText(`<?xml version="1.0"?>
    <kml><Document>
      <Folder><name>Fiber Optic</name>
        <Placemark id="fo-manual"><name>FO-Manual</name>
          <ExtendedData><Data name="asset_id"><value>FO-01</value></Data></ExtendedData>
          <LineString><coordinates>110,-7 111,-7</coordinates></LineString>
        </Placemark>
      </Folder>
    </Document></kml>`)
  const parsed = buildCanonicalParserResult({
    parserOutput,
    datasetVersion: DATASET_VERSION,
    sourceSelection: { selectedKmlPath: 'doc.kml', resources: [] },
  })
  const manualRelation = {
    explicitRelationEvidenceId: 'manual:relation-1',
    datasetVersionId: DATASET_VERSION.id,
    sourceReference: 'FO-01',
    targetReference: 'FO-02',
    source: 'manual_admin',
    sourceKey: 'manual_device_connection',
  }
  const repaired = rebuildStoredTopologyInputBundle({
    ...structuredClone(parsed),
    topologyInputBundle: {
      ...structuredClone(parsed.topologyInputBundle),
      explicitRelations: [manualRelation],
    },
  })

  assert.deepEqual(repaired.topologyInputBundle.explicitRelations, [manualRelation])
})

test('overlay resources resolve relative to selected KML, deduplicate by checksum, and never fetch URLs', () => {
  const parserOutput = parseKmlText(`<?xml version="1.0"?>
    <kml><Document>
      <GroundOverlay id="local"><Icon><href>../images/site.png</href></Icon>
        <LatLonBox><north>-6</north><south>-7</south><east>111</east><west>110</west></LatLonBox>
      </GroundOverlay>
      <GroundOverlay id="external"><Icon><href>https://example.invalid/site.png</href></Icon>
        <LatLonBox><north>-6</north><south>-7</south><east>111</east><west>110</west></LatLonBox>
      </GroundOverlay>
    </Document></kml>`)
  const checksum = `sha256:${'b'.repeat(64)}`
  const result = buildCanonicalParserResult({
    parserOutput,
    datasetVersion: DATASET_VERSION,
    sourceSelection: {
      selectedKmlPath: 'kml/doc.kml',
      resources: [
        { relativePath: 'images/site.png', extension: '.png', size: 10, checksum },
        { relativePath: 'copies/site.png', extension: '.png', size: 10, checksum },
      ],
    },
  })

  assert.equal(result.sourceResources.length, 1)
  assert.deepEqual(
    result.sourceResources[0].relativePaths,
    ['images/site.png', 'copies/site.png'],
  )
  assert.equal(result.sourceOverlays[0].resourceResolutionStatus, 'resolved')
  assert.equal(result.sourceOverlays[0].resourceId, result.sourceResources[0].resourceId)
  assert.equal(result.sourceOverlays[1].resourceResolutionStatus, 'external')
  assert.ok(result.issues.some(({ issueCode }) => (
    issueCode === 'external_overlay_resource_not_fetched'
  )))
})
