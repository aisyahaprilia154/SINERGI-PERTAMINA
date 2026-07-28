import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { extractKmzArchive, orderKmlCandidates } from '../src/import/kmz-extractor.js'
import { createStoredZip } from './helpers/zip-fixture.js'

const LIMITS = {
  maxArchiveEntries: 10,
  maxExtractedSize: 1024 * 1024,
  maxCompressionRatio: 100,
}

test('extracts KML and safe image resources while ignoring executable content', async () => {
  await withArchive([
    { name: 'other.kml', content: '<kml><Document/></kml>' },
    { name: 'doc.kml', content: '<kml><Document><name>Main</name></Document></kml>' },
    { name: 'icons/camera.png', content: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
    { name: 'scripts/install.exe', content: 'not executable by the pipeline' },
  ], async ({ archivePath, workspace }) => {
    const result = await extractKmzArchive(archivePath, workspace, LIMITS)

    assert.deepEqual(orderKmlCandidates(result.kmlFiles).map((item) => item.relativePath), [
      'doc.kml',
      'other.kml',
    ])
    assert.deepEqual(result.resources.map((item) => item.relativePath), ['icons/camera.png'])
    assert.deepEqual(result.ignoredEntries, ['scripts/install.exe'])
    assert.equal(
      await readFile(path.join(workspace, 'doc.kml'), 'utf8'),
      '<kml><Document><name>Main</name></Document></kml>',
    )
  })
})

test('rejects zip slip entries before writing outside the workspace', async () => {
  await withArchive([
    { name: '../escape.kml', content: '<kml />' },
  ], async ({ archivePath, workspace }) => {
    await assert.rejects(
      extractKmzArchive(archivePath, workspace, LIMITS),
      (error) => ['kmz_zip_slip', 'corrupt_kmz'].includes(error.code),
    )
  })
})

test('rejects encrypted, oversized, over-count, and corrupt archives', async () => {
  await withArchive([
    { name: 'doc.kml', content: '<kml />', encrypted: true },
  ], async ({ archivePath, workspace }) => {
    await assert.rejects(
      extractKmzArchive(archivePath, workspace, LIMITS),
      (error) => ['encrypted_kmz', 'corrupt_kmz'].includes(error.code),
    )
  })

  await withArchive([
    { name: 'doc.kml', content: '<kml />' },
  ], async ({ archivePath, workspace }) => {
    await assert.rejects(
      extractKmzArchive(archivePath, workspace, { ...LIMITS, maxExtractedSize: 2 }),
      (error) => error.code === 'kmz_extracted_size_exceeded',
    )
  })

  await withArchive([
    { name: 'doc.kml', content: '<kml />' },
    { name: 'other.kml', content: '<kml />' },
  ], async ({ archivePath, workspace }) => {
    await assert.rejects(
      extractKmzArchive(archivePath, workspace, { ...LIMITS, maxArchiveEntries: 1 }),
      (error) => error.code === 'kmz_too_many_entries',
    )
  })

  const directory = await mkdtemp(path.join(os.tmpdir(), 'sinergi-corrupt-kmz-'))
  try {
    const archivePath = path.join(directory, 'corrupt.kmz')
    const workspace = path.join(directory, 'workspace')
    await writeFile(archivePath, 'PK-not-a-valid-zip')
    await assert.rejects(
      extractKmzArchive(archivePath, workspace, LIMITS),
      (error) => error.code === 'corrupt_kmz',
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

async function withArchive(entries, callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sinergi-kmz-'))
  const archivePath = path.join(directory, 'source.kmz')
  const workspace = path.join(directory, 'workspace')
  try {
    await writeFile(archivePath, createStoredZip(entries))
    await callback({ archivePath, workspace })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
