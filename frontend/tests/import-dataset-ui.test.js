import assert from 'node:assert/strict'
import test from 'node:test'
import { renderDatasetDropzone } from '../src/pages/admin/dataset-dropzone.js'
import { renderImportDatasetForm } from '../src/pages/admin/import-dataset-form.js'
import {
  getImportStepState,
  getOverallProgress,
  validateImportFile,
} from '../src/pages/admin/import-dataset-state.js'
import { renderImportSummary } from '../src/pages/admin/import-summary.js'

test('file validation accepts one KML/KMZ within the configured limit', () => {
  assert.equal(validateImportFile({
    name: 'network.kml',
    size: 1024,
  }, 2048).valid, true)
  assert.equal(validateImportFile({
    name: 'network.kmz',
    size: 2048,
  }, 2048).valid, true)

  assert.match(validateImportFile({
    name: 'network.zip',
    size: 100,
  }).error, /\.kml atau \.kmz/)
  assert.match(validateImportFile({
    name: 'network.kml',
    size: 3000,
  }, 2048).error, /melebihi batas/)
})

test('progress uses actual upload/backend milestones and skips KMZ extraction for KML', () => {
  const parsing = getImportStepState({
    phase: 'processing',
    backendStage: 'parsing_kml',
    fileExtension: '.kml',
  })

  assert.equal(parsing[0].status, 'complete')
  assert.equal(parsing[2].status, 'skipped')
  assert.equal(parsing[3].status, 'active')
  assert.equal(getOverallProgress({
    phase: 'uploading',
    uploadPercent: 50,
  }), 50)
  assert.equal(getOverallProgress({
    phase: 'processing',
    backendProgress: 70,
  }), 70)
  assert.equal(getOverallProgress({
    phase: 'processing',
    backendProgress: null,
  }), null)
})

test('dropzone exposes file metadata, replace, remove, and accessible error text', () => {
  const selected = renderDatasetDropzone({
    file: {
      name: 'jaringan.kmz',
      size: 4 * 1024 * 1024,
    },
    fileValidation: {
      valid: true,
      typeLabel: 'KMZ archive',
    },
    maxFileSize: 50 * 1024 * 1024,
  })
  const invalid = renderDatasetDropzone({
    fileValidation: {
      valid: false,
      error: 'Jenis file tidak didukung.',
    },
    maxFileSize: 50 * 1024 * 1024,
  })

  assert.match(selected, /jaringan\.kmz/)
  assert.match(selected, /4\.0 MB/)
  assert.match(selected, /Ganti file/)
  assert.match(selected, /remove-import-file/)
  assert.match(invalid, /role="alert"/)
  assert.match(invalid, /Jenis file tidak didukung/)
})

test('import form renders required workflow fields without automatic upload', () => {
  const html = renderImportDatasetForm({
    config: {
      branches: [{
        id: 'semarang',
        name: 'Semarang',
        datasetId: 'dataset-semarang',
      }],
      limits: { maxFileSize: 50 * 1024 * 1024 },
    },
    values: {
      branchId: 'semarang',
      versionName: 'Import Juli 2026',
      versionNote: '',
      officialSourceConfirmed: false,
    },
    file: { name: 'network.kml', size: 1024 },
    fileValidation: { valid: true, typeLabel: 'KML document' },
  })

  assert.match(html, /Kantor cabang/)
  assert.match(html, /Dataset tujuan/)
  assert.match(html, /Identitas versi/)
  assert.match(html, /Catatan versi/)
  assert.match(html, /berasal dari sumber resmi/)
  assert.match(html, /type="submit"/)
  assert.doesNotMatch(html, /autofocus/)
})

test('summary renders all import counts and blocks activation for invalid result', () => {
  const html = renderImportSummary({
    datasetVersion: {
      versionName: 'Import Juli 2026',
      datasetId: 'dataset-semarang',
      summary: {
        totalFolders: 8,
        totalPlacemarks: 438,
        totalAssets: 433,
        totalPoints: 410,
        totalLines: 20,
        totalPolygons: 3,
        totalRelations: 390,
        newAssets: 12,
        updatedAssets: 421,
        unchangedAssets: 0,
        removedAssets: 0,
        errors: 7,
        warnings: 3,
      },
    },
    validation: {
      status: 'invalid',
      canActivate: false,
    },
    issues: [{
      issueCode: 'ASSET_ID_MISSING',
    }],
  })

  assert.match(html, /Folder ditemukan/)
  assert.match(html, /Placemark ditemukan/)
  assert.match(html, /Aset diperbarui/)
  assert.match(html, /Error/)
  assert.match(html, /tidak dapat diaktifkan/)
  assert.match(html, /tanpa Asset ID/)
})
