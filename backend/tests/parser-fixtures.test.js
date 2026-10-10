import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {DEFAULT_FOLDER_MAPPINGS} from '../src/config.js'
import { parseKmlFile } from '../src/import/kml-parser.js'

const fixtureDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
)
const parserOptions = {
  maxKmlSize: 1024 * 1024,
  folderMappings: DEFAULT_FOLDER_MAPPINGS,
}

test('Point fixture preserves longitude-latitude-altitude order and sanitizes description', async () => {
  const parserOutput = await parseFixture('point.kml')
  const placemark = parserOutput.placemarks[0]

  assert.deepEqual(placemark.geometry.coordinates, [110.4167, -6.9667, 12])
  assert.equal(placemark.geometry.altitudeMode, 'absolute')
  assert.equal(placemark.properties.description, 'Gerbang Utama')
  assert.match(placemark.properties.sourceDescription, /<script>/)
})

test('LineString fixture preserves coordinate sequence and validates minimum length', async () => {
  const parserOutput = await parseFixture('line-string.kml')
  const line = parserOutput.folders[0].placemarks[0].geometry

  assert.equal(parserOutput.folders[0].category, 'Fiber Optic')
  assert.deepEqual(line.coordinates, [
    [110.1, -6.1],
    [110.2, -6.2],
    [110.3, -6.3],
  ])
  assert.equal(line.altitudeMode, 'clampToGround')
  assert.equal(parserOutput.issues.some((issue) => issue.issueCode === 'line_too_short'), false)
})

test('Polygon fixture closes rings deterministically and records each normalization', async () => {
  const parserOutput = await parseFixture('polygon.kml')
  const polygon = parserOutput.placemarks[0].geometry

  assert.deepEqual(polygon.coordinates[0][0], polygon.coordinates[0].at(-1))
  assert.deepEqual(polygon.coordinates[1][0], polygon.coordinates[1].at(-1))
  assert.equal(
    parserOutput.issues.filter((issue) => issue.issueCode === 'polygon_ring_closed').length,
    2,
  )
  assert.ok(parserOutput.issues
    .filter((issue) => issue.issueCode === 'polygon_ring_closed')
    .every((issue) => issue.severity === 'information' && issue.canActivate === true))
})

test('MultiGeometry fixture keeps child geometry identity and coordinates separate', async () => {
  const parserOutput = await parseFixture('multi-geometry.kml')
  const multi = parserOutput.placemarks[0].geometry

  assert.equal(multi.type, 'MultiGeometry')
  assert.deepEqual(multi.geometries.map((geometry) => geometry.type), ['Point', 'LineString'])
  assert.deepEqual(multi.geometries[0].coordinates, [110, -7])
  assert.deepEqual(multi.geometries[1].coordinates, [[110, -7], [111, -7]])
})

test('nested Folder fixture preserves hierarchy, maps known names, and warns for unmapped names', async () => {
  const parserOutput = await parseFixture('nested-folder.kml')
  const root = parserOutput.folders[0]
  const nested = root.children[0]

  assert.equal(root.sourceFolderPath, '/Jaringan Cabang')
  assert.equal(root.category, 'unmapped')
  assert.equal(nested.sourceFolderPath, '/Jaringan Cabang/Titik CCTV')
  assert.equal(nested.category, 'CCTV')
  assert.ok(parserOutput.issues.some((issue) => (
    issue.issueCode === 'unmapped_folder'
    && issue.sourceFolderPath === '/Jaringan Cabang'
  )))
})

test('folder category mapping can be overridden without dropping unmatched folders', async () => {
  const parserOutput = await parseKmlFile(
    path.join(fixtureDirectory, 'nested-folder.kml'),
    {
      ...parserOptions,
      folderMappings: [{
        category: 'Custom Network',
        aliases: ['Jaringan Cabang'],
      }],
    },
  )

  assert.equal(parserOutput.folders[0].category, 'Custom Network')
  assert.equal(parserOutput.folders[0].children[0].category, 'unmapped')
  assert.ok(parserOutput.issues.some((issue) => (
    issue.issueCode === 'unmapped_folder'
    && issue.sourceFolderPath === '/Jaringan Cabang/Titik CCTV'
  )))
})

test('ExtendedData preserves original source metadata',async()=>{const parsed=await parseFixture('extended-data.kml');assert.ok(parsed.placemarks[0].extendedData.data.some(e=>e.name==='IP Address'&&e.value==='10.42.0.1'))})
async function parseFixture(filename){return parseKmlFile(path.join(fixtureDirectory,filename),parserOptions)}
