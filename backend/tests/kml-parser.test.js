import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_FOLDER_MAPPINGS } from '../src/config.js'
import { parseKmlText } from '../src/import/kml-parser.js'

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Folder id="network">
      <name>Jaringan</name>
      <Folder id="cctv">
        <name>CCTV</name>
        <Placemark id="camera-1">
          <name>Camera Gate</name>
          <description><![CDATA[<strong>Untrusted description</strong>]]></description>
          <ExtendedData>
            <Data name="ASSET_ID"><value>CCTV-01</value></Data>
            <Data name="type"><value>CCTV</value></Data>
          </ExtendedData>
          <Point>
            <altitudeMode>absolute</altitudeMode>
            <coordinates>110.4,-6.9,12</coordinates>
          </Point>
        </Placemark>
      </Folder>
      <Placemark id="cable-1">
        <name>Fiber Cable</name>
        <ExtendedData><Data name="ASSET_ID"><value>FO-01</value></Data></ExtendedData>
        <LineString><coordinates>
          110.1,-6.1,0 110.2,-6.2,0
        </coordinates></LineString>
      </Placemark>
      <Placemark id="area-1">
        <name>Area</name>
        <ExtendedData><Data name="ASSET_ID"><value>AREA-01</value></Data></ExtendedData>
        <Polygon>
          <outerBoundaryIs>
            <LinearRing><coordinates>
              110,-7 111,-7 111,-6 110,-7
            </coordinates></LinearRing>
          </outerBoundaryIs>
        </Polygon>
      </Placemark>
    </Folder>
    <NetworkLink><name>External</name><Link><href>https://example.invalid/doc.kml</href></Link></NetworkLink>
  </Document>
</kml>`

test('parses KML folders, ExtendedData, and geometry without changing coordinate order', () => {
  const output = parseKmlText(KML)
  const rootFolder = output.folders[0]
  const nestedFolder = rootFolder.children[0]
  const point = nestedFolder.placemarks[0]
  const line = rootFolder.placemarks[0]
  const polygon = rootFolder.placemarks[1]

  assert.equal(rootFolder.sourceFolderPath, '/Jaringan')
  assert.equal(nestedFolder.sourceFolderPath, '/Jaringan/CCTV')
  assert.deepEqual(point.extendedData.data[0], {
    name: 'ASSET_ID',
    value: 'CCTV-01',
    sourceElement: 'Data',
  })
  assert.deepEqual(point.geometry.coordinates, [110.4, -6.9, 12])
  assert.equal(point.geometry.altitudeMode, 'absolute')
  assert.equal(point.properties.description, 'Untrusted description')
  assert.equal(point.properties.sourceDescription, '<strong>Untrusted description</strong>')
  assert.equal(point.properties.descriptionContentType, 'sanitized-text')
  assert.deepEqual(line.geometry.coordinates, [
    [110.1, -6.1, 0],
    [110.2, -6.2, 0],
  ])
  assert.deepEqual(polygon.geometry.coordinates[0], [
    [110, -7],
    [111, -7],
    [111, -6],
    [110, -7],
  ])
})

test('records NetworkLink without fetching it', () => {
  const output = parseKmlText(KML)

  assert.ok(output.unsupportedElements.some((element) => (
    element.name === 'NetworkLink' && element.canActivate === false
  )))
})

test('rejects DTD and entity declarations before XML parsing', () => {
  assert.throws(
    () => parseKmlText(`<?xml version="1.0"?>
      <!DOCTYPE kml [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
      <kml><Document><name>&xxe;</name></Document></kml>`),
    (error) => error.code === 'unsafe_xml_declaration',
  )
})

test('records longitude, latitude, short line, and invalid polygon issues without repairing values', () => {
  const output = parseKmlText(`<?xml version="1.0"?>
    <kml><Document>
      <Placemark><name>Bad longitude</name><Point><coordinates>181,0</coordinates></Point></Placemark>
      <Placemark><name>Bad latitude</name><Point><coordinates>110,91</coordinates></Point></Placemark>
      <Placemark><name>Short line</name><LineString><coordinates>110,-7</coordinates></LineString></Placemark>
      <Placemark><name>Bad polygon</name><Polygon><outerBoundaryIs><LinearRing>
        <coordinates>110,-7 111,-7</coordinates>
      </LinearRing></outerBoundaryIs></Polygon></Placemark>
    </Document></kml>`)

  assert.ok(output.issues.some((issue) => (
    issue.issueCode === 'invalid_coordinate' && issue.message.includes('longitude')
  )))
  assert.ok(output.issues.some((issue) => (
    issue.issueCode === 'invalid_coordinate' && issue.message.includes('latitude')
  )))
  assert.ok(output.issues.some((issue) => issue.issueCode === 'line_too_short'))
  assert.ok(output.issues.some((issue) => issue.issueCode === 'polygon_ring_too_short'))
  assert.deepEqual(output.placemarks[0].geometry.coordinates, [181, 0])
  assert.deepEqual(output.placemarks[1].geometry.coordinates, [110, 91])
  assert.equal(
    output.issues.some((issue) => (
      issue.issueCode === 'polygon_ring_closed'
      && issue.sourcePlacemarkName === 'Bad polygon'
    )),
    false,
  )
})

test('configurable aliases match semantic folder names without treating short aliases as substrings', () => {
  const output = parseKmlText(`<?xml version="1.0"?>
    <kml><Document>
      <Folder><name>Camera Fix Dome Indoor</name></Folder>
      <Folder><name>IP Camera Area Barat</name></Folder>
      <Folder><name>CCTV Cable Backbone</name></Folder>
      <Folder><name>Jalur FO Utama</name></Folder>
      <Folder><name>Access Point Lobby</name></Folder>
      <Folder><name>Ruang Rapat</name></Folder>
    </Document></kml>`, {
    folderMappings: DEFAULT_FOLDER_MAPPINGS,
  })

  assert.deepEqual(output.folders.map(({ category }) => category), [
    'CCTV',
    'CCTV',
    'CCTV Cable',
    'Fiber Optic',
    'Peripheral',
    'unmapped',
  ])
})
