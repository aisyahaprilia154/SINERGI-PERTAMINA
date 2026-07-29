import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCanonicalParserResult,
  PARSER_VERSION,
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
