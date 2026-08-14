import assert from 'node:assert/strict'
import test from 'node:test'
import { parseKmlText } from '../src/import/kml-parser.js'
import { mergeKmlParserOutputs } from '../src/import/kml-parser-output-merger.js'

test('merges every KML document and resolves a local NetworkLink inside the package', () => {
  const main = parseKmlText(`<?xml version="1.0"?>
    <kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark id="main"><name>Main</name>
        <Point><coordinates>110,-7</coordinates></Point>
      </Placemark>
      <NetworkLink><Link><href>parts/assets.kml</href></Link></NetworkLink>
    </Document></kml>`)
  const linked = parseKmlText(`<?xml version="1.0"?>
    <kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark id="linked"><name>Linked</name>
        <Point><coordinates>111,-7</coordinates></Point>
      </Placemark>
    </Document></kml>`)

  const merged = mergeKmlParserOutputs([
    { relativePath: 'doc.kml', parserOutput: main },
    { relativePath: 'parts/assets.kml', parserOutput: linked },
  ])

  assert.equal(merged.structure.kmlDocumentCount, 2)
  assert.equal(merged.structure.placemarkCount, 2)
  assert.equal(merged.placemarks.length, 2)
  assert.deepEqual(
    merged.placemarks.map(({ sourceDocumentPath }) => sourceDocumentPath),
    ['doc.kml', 'parts/assets.kml'],
  )
  assert.equal(merged.unsupportedElements.some(({ name }) => name === 'NetworkLink'), false)
  assert.ok(merged.issues.some(({ issueCode }) => issueCode === 'local_network_link_merged'))
})

test('does not treat an external NetworkLink as a merged local document', () => {
  const main = parseKmlText(`<?xml version="1.0"?>
    <kml><Document>
      <NetworkLink><Link><href>https://example.invalid/assets.kml</href></Link></NetworkLink>
    </Document></kml>`)
  const merged = mergeKmlParserOutputs([{ relativePath: 'doc.kml', parserOutput: main }])

  assert.ok(merged.unsupportedElements.some((element) => (
    element.name === 'NetworkLink'
      && element.href === 'https://example.invalid/assets.kml'
      && element.canActivate === false
  )))
})
