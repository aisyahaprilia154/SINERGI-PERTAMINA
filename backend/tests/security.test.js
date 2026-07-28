import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { orderKmlCandidates, validateArchiveEntryPath } from '../src/import/kmz-extractor.js'
import {
  sanitizeSourceFilename,
  validateBranchId,
  validateUploadedFile,
} from '../src/import/upload-validation.js'
import { requireAdministrator, TokenAuthenticator } from '../src/security/authorization.js'

test('server authorization permits Administrator and forbids a regular user', () => {
  const authenticator = new TokenAuthenticator({
    admin: { id: 'admin-1', role: 'Administrator' },
    viewer: { id: 'viewer-1', role: 'Viewer' },
  })

  assert.equal(
    requireAdministrator({ headers: { authorization: 'Bearer admin' } }, authenticator).id,
    'admin-1',
  )
  assert.throws(
    () => requireAdministrator(
      { headers: { authorization: 'Bearer viewer' } },
      authenticator,
    ),
    (error) => error.statusCode === 403 && error.code === 'forbidden',
  )
})

test('sanitizes user filenames and never returns path components', () => {
  assert.equal(sanitizeSourceFilename('../../folder/data.kml'), 'data.kml')
  assert.equal(sanitizeSourceFilename('C:\\fakepath\\file name.kmz'), 'file name.kmz')
  assert.equal(sanitizeSourceFilename('unsafe<script>.kml'), 'unsafe_script_.kml')
})

test('validates branch IDs against server configuration', () => {
  assert.equal(validateBranchId('semarang', ['semarang']), 'semarang')
  assert.throws(
    () => validateBranchId('../semarang', ['semarang']),
    (error) => error.code === 'invalid_branch',
  )
  assert.throws(
    () => validateBranchId('jakarta', ['semarang']),
    (error) => error.code === 'branch_not_allowed',
  )
})

test('rejects zip slip, absolute paths, and drive paths', () => {
  assert.equal(validateArchiveEntryPath('icons/camera.png'), 'icons/camera.png')
  for (const unsafe of ['../evil.kml', '/absolute.kml', 'C:\\evil.kml', 'a/../../evil.kml']) {
    assert.throws(
      () => validateArchiveEntryPath(unsafe),
      (error) => ['kmz_zip_slip', 'kmz_unsafe_path'].includes(error.code),
    )
  }
})

test('orders KMZ candidates deterministically with root doc.kml first', () => {
  const ordered = orderKmlCandidates([
    { relativePath: 'z-last.kml' },
    { relativePath: 'folder/doc.kml' },
    { relativePath: 'doc.kml' },
    { relativePath: 'a-first.kml' },
  ])

  assert.deepEqual(ordered.map((item) => item.relativePath), [
    'doc.kml',
    'folder/doc.kml',
    'a-first.kml',
    'z-last.kml',
  ])
})

test('validates extension, MIME type, size, and file signature together', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sinergi-upload-validation-'))
  try {
    const kmlPath = path.join(directory, 'upload')
    await writeFile(kmlPath, '<?xml version="1.0"?><kml></kml>')
    const valid = await validateUploadedFile({
      filePath: kmlPath,
      filename: 'source.kml',
      mimeType: 'application/vnd.google-earth.kml+xml',
      size: 36,
      maxFileSize: 1024,
    })
    assert.equal(valid.extension, '.kml')

    await assert.rejects(
      validateUploadedFile({
        filePath: kmlPath,
        filename: 'source.exe',
        mimeType: 'application/octet-stream',
        size: 36,
        maxFileSize: 1024,
      }),
      (error) => error.code === 'unsupported_file_extension',
    )
    await assert.rejects(
      validateUploadedFile({
        filePath: kmlPath,
        filename: 'source.kml',
        mimeType: 'application/zip',
        size: 36,
        maxFileSize: 1024,
      }),
      (error) => error.code === 'invalid_mime_type',
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
