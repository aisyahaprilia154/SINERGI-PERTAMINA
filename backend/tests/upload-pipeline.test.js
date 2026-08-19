import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createApp } from '../src/app.js'
import { createConfig } from '../src/config.js'
import { DatasetVersionValidationService } from '../src/import/dataset-validation-service.js'
import { DatasetVersionLifecycleService } from '../src/import/dataset-version-lifecycle-service.js'
import { ImportPipeline } from '../src/import/import-pipeline.js'
import { BackgroundJobQueue } from '../src/jobs/background-job-queue.js'
import { TokenAuthenticator } from '../src/security/authorization.js'
import { JsonLinesAuditLog } from '../src/storage/audit-log.js'
import { JsonDatasetVersionRepository } from '../src/storage/dataset-version-repository.js'
import { ImportFileStore } from '../src/storage/file-store.js'
import { TopologyService } from '../src/topology/topology-service.js'
import { createStoredZip } from './helpers/zip-fixture.js'

const VALID_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Folder id="network">
      <name>Jaringan CCTV</name>
      <Placemark id="camera-1">
        <name>Camera Gate</name>
        <ExtendedData>
          <Data name="ASSET_ID"><value>CCTV-01</value></Data>
          <Data name="type"><value>CCTV</value></Data>
        </ExtendedData>
        <Point><coordinates>110.4,-6.9,12</coordinates></Point>
      </Placemark>
    </Folder>
  </Document>
</kml>`

const INVALID_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark id="missing-asset-id">
      <name>Unknown Camera</name>
      <Point><coordinates>110.4,-6.9</coordinates></Point>
    </Placemark>
  </Document>
</kml>`

const SOURCE_NAME_FALLBACK_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Folder>
      <name>CCTV</name>
      <Folder>
        <name>Camera Fix Dome Indoor</name>
        <Placemark>
          <name>Cam-05</name>
          <Point><coordinates>110.4,-6.9,12</coordinates></Point>
        </Placemark>
      </Folder>
    </Folder>
  </Document>
</kml>`

function mountingFixtureKml({ cameraLongitude = '110.400005', cameraName = 'Camera Gate' } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Folder><name>RJBT</name>
      <Folder><name>Pengapon</name>
        <Folder><name>Tiang</name>
          <Placemark id="pole-placemark"><name>Tiang A</name>
            <ExtendedData>
              <Data name="ASSET_ID"><value>POLE-01</value></Data>
              <Data name="type"><value>Tiang</value></Data>
            </ExtendedData>
            <Point><coordinates>110.4,-6.9,0</coordinates></Point>
          </Placemark>
          <Placemark id="pole-placemark-2"><name>Tiang B</name>
            <ExtendedData>
              <Data name="ASSET_ID"><value>POLE-02</value></Data>
              <Data name="type"><value>Tiang</value></Data>
            </ExtendedData>
            <Point><coordinates>110.4001,-6.9,0</coordinates></Point>
          </Placemark>
        </Folder>
        <Folder><name>CCTV</name>
          <Placemark id="camera-placemark"><name>${cameraName}</name>
            <ExtendedData>
              <Data name="ASSET_ID"><value>CCTV-01</value></Data>
              <Data name="type"><value>CCTV</value></Data>
            </ExtendedData>
            <Point><coordinates>${cameraLongitude},-6.9,0</coordinates></Point>
          </Placemark>
        </Folder>
      </Folder>
    </Folder>
  </Document>
</kml>`
}

test('Administrator upload is queued, persisted as a non-active version, and exposes progress', async () => {
  const fixture = await createFixture()
  try {
    const configResponse = await fetch(`${fixture.origin}/api/admin/import-config`, {
      headers: { authorization: 'Bearer admin-token' },
    })
    const importConfig = await configResponse.json()
    assert.equal(configResponse.status, 200)
    assert.equal(importConfig.branches[0].datasetId, 'dataset-semarang')
    assert.deepEqual(importConfig.limits.acceptedExtensions, ['.kml', '.kmz'])
    assert.equal(importConfig.workflow.supportsCancellationAfterAccepted, false)

    const forbidden = new FormData()
    forbidden.append('branchId', 'semarang')
    forbidden.append(
      'file',
      new Blob([VALID_KML], { type: 'application/vnd.google-earth.kml+xml' }),
      'forbidden.kml',
    )
    const forbiddenResponse = await fetch(`${fixture.origin}/api/admin/imports`, {
      method: 'POST',
      headers: { authorization: 'Bearer viewer-token' },
      body: forbidden,
    })
    assert.equal(forbiddenResponse.status, 403)

    const accepted = await uploadKml(fixture.origin, VALID_KML, 'network.kml', {
      datasetId: 'dataset-semarang',
      versionName: 'Import UI Juli 2026',
      versionNote: 'Fixture halaman admin dataset.',
      officialSourceConfirmed: 'true',
    }, { correlationId: 'import-worker-test' })
    assert.equal(accepted.response.status, 202)
    assert.equal(accepted.body.datasetVersion.status, 'processing')
    assert.equal(accepted.body.datasetVersion.importedBy, 'admin-1')
    assert.match(accepted.body.datasetVersion.checksum, /^sha256:[a-f0-9]{64}$/)
    assert.equal(accepted.body.datasetVersion.sourceFilename, 'network.kml')
    assert.equal(accepted.body.datasetVersion.versionName, 'Import UI Juli 2026')
    assert.equal(accepted.body.datasetVersion.versionNote, 'Fixture halaman admin dataset.')
    assert.equal(accepted.body.datasetVersion.officialSourceConfirmed, true)
    assert.equal(Object.hasOwn(accepted.body.datasetVersion, 'sourceStorageKey'), false)

    await fixture.jobQueue.onIdle()
    const statusResponse = await fetch(
      `${fixture.origin}${accepted.body.statusUrl}`,
      { headers: { authorization: 'Bearer admin-token' } },
    )
    const status = await statusResponse.json()

    assert.equal(statusResponse.status, 200)
    assert.equal(status.datasetVersion.status, 'valid')
    assert.equal(status.datasetVersion.validationStatus, 'valid')
    assert.equal(status.datasetVersion.publicationStatus, 'unpublished')
    assert.equal(status.active, false)
    assert.equal(status.canActivate, true)
    assert.equal(status.datasetVersion.summary.totalAssets, 1)
    assert.equal(status.processing.progress, 100)
    assert.equal(status.processing.stage, 'valid')
    assert.equal(status.validation.status, 'valid')
    assert.equal(status.validation.canActivate, true)
    assert.equal(status.validation.integrity.activeVersionUnchanged, true)
    assert.equal(status.validation.integrity.userVisible, false)
    assert.equal(status.readiness.parseReadiness, 'ready')
    assert.equal(status.readiness.topologyReadiness, 'not_applicable')
    assert.equal(status.parserCoverage.placemarkCount, 1)
    assert.match(status.parserVersions.parserVersion, /^evidence-parser\//)
    const readinessResponse = await fetch(
      `${fixture.origin}/api/dataset-versions/${status.datasetVersion.id}/readiness`,
      { headers: { authorization: 'Bearer admin-token' } },
    )
    const readinessProjection = await readinessResponse.json()
    assert.equal(readinessResponse.status, 200)
    assert.equal(readinessProjection.readiness.parseReadiness, 'ready')
    assert.equal(readinessProjection.coverage.placemarkCount, 1)
    const topologySummaryResponse = await fetch(
      `${fixture.origin}/api/dataset-versions/${status.datasetVersion.id}/topology/summary`,
      { headers: { authorization: 'Bearer admin-token' } },
    )
    const topologySummary = await topologySummaryResponse.json()
    assert.equal(topologySummaryResponse.status, 200)
    assert.equal(topologySummary.summary.confirmedEdgeCount, 0)
    assert.equal(topologySummary.readiness.topologyReadiness, 'not_ready')
    assert.match(
      topologySummary.topologyRuleSetVersion,
      /^semantic-relation-engine\//,
    )

    const persisted = await fixture.repository.get(status.datasetVersion.id)
    assert.equal(persisted.assets[0].assetId, 'CCTV-01')
    assert.deepEqual(persisted.geometries[0].coordinates, [110.4, -6.9, 12])
    assert.equal(persisted.datasetVersion.status, 'valid')
    assert.equal(persisted.datasetVersion.versionNote, 'Fixture halaman admin dataset.')
    assert.equal(persisted.datasetVersion.officialSourceConfirmed, true)
    assert.match(persisted.datasetVersion.sourceStorageKey, /^source-files\/dv-/)
    assert.equal(persisted.sourceFeatures.length, 1)
    assert.equal(persisted.sourceGeometries.length, 1)
    assert.equal(persisted.classifiedObjects[0].objectRole, 'device_node')
    assert.equal(persisted.topologyInputBundle.topologyReady, false)

    const previewResponse = await fetch(
      `${fixture.origin}/api/admin/imports/${status.datasetVersion.id}/preview`,
      { headers: { authorization: 'Bearer admin-token' } },
    )
    const preview = await previewResponse.json()
    assert.equal(previewResponse.status, 200)
    assert.equal(preview.readOnly, true)
    assert.equal(preview.assets[0].assetId, 'CCTV-01')
    assert.equal(preview.comparison.summary.newAssets, 1)
    assert.equal(Object.hasOwn(preview.datasetVersion, 'sourceStorageKey'), false)

    const forbiddenSourceDownload = await fetch(
      `${fixture.origin}/api/dataset-versions/${status.datasetVersion.id}/source-file`,
      { headers: { authorization: 'Bearer viewer-token' } },
    )
    assert.equal(forbiddenSourceDownload.status, 403)

    const sourceDownload = await fetch(
      `${fixture.origin}/api/dataset-versions/${status.datasetVersion.id}/source-file`,
      { headers: { authorization: 'Bearer scoped-download-token' } },
    )
    const downloadedBytes = Buffer.from(await sourceDownload.arrayBuffer())
    assert.equal(sourceDownload.status, 200)
    assert.equal(
      sourceDownload.headers.get('content-type'),
      'application/vnd.google-earth.kml+xml',
    )
    assert.match(
      sourceDownload.headers.get('content-disposition'),
      /^attachment; filename="network\.kml"; filename\*=UTF-8''network\.kml$/,
    )
    assert.equal(Number(sourceDownload.headers.get('content-length')), Buffer.byteLength(VALID_KML))
    assert.deepEqual(downloadedBytes, Buffer.from(VALID_KML))
    assert.equal(sourceDownload.headers.get('content-disposition').includes('source-files/'), false)

    const missingConfirmation = await fetch(
      `${fixture.origin}/api/admin/imports/${status.datasetVersion.id}/activate`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ confirmArchiveCurrent: false }),
      },
    )
    assert.equal(missingConfirmation.status, 400)

    const forbiddenActivation = await fetch(
      `${fixture.origin}/api/admin/imports/${status.datasetVersion.id}/activate`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer viewer-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          confirmArchiveCurrent: true,
          expectedActiveVersionId: null,
        }),
      },
    )
    assert.equal(forbiddenActivation.status, 403)

    const activationResponse = await fetch(
      `${fixture.origin}/api/admin/imports/${status.datasetVersion.id}/activate`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          confirmArchiveCurrent: true,
          expectedActiveVersionId: null,
        }),
      },
    )
    const activation = await activationResponse.json()
    assert.equal(activationResponse.status, 200)
    assert.equal(activation.datasetVersion.status, 'active')
    assert.equal(activation.datasetVersion.publicationStatus, 'published')
    assert.equal(activation.activePointer.datasetVersionId, status.datasetVersion.id)
    assert.equal(activation.activePointer.previousVersionId, null)
    assert.equal(
      activation.mapUrl,
      '/map?datasetId=dataset-semarang&branchId=semarang',
    )

    const activeResponse = await fetch(
      `${fixture.origin}/api/datasets/dataset-semarang/active?branchId=semarang`,
      { headers: { authorization: 'Bearer viewer-token' } },
    )
    const activeDataset = await activeResponse.json()
    assert.equal(activeResponse.status, 200)
    assert.equal(activeDataset.datasetVersion.id, status.datasetVersion.id)
    assert.equal(activeDataset.activePointer.datasetVersionId, status.datasetVersion.id)
    assert.equal(activeDataset.assets[0].assetId, 'CCTV-01')

    const mapResponse = await fetch(
      `${fixture.origin}/api/datasets/dataset-semarang/active?view=map&branchId=semarang`,
      { headers: { authorization: 'Bearer viewer-token' } },
    )
    const mapDataset = await mapResponse.json()
    assert.equal(mapResponse.status, 200)
    assert.equal(mapDataset.mapView, true)
    assert.equal(mapDataset.activePointer.datasetVersionId, status.datasetVersion.id)
    assert.equal(Object.hasOwn(mapDataset.assets[0], 'properties'), false)
    assert.deepEqual(mapDataset.geometries[0].coordinates, [110.4, -6.9, 12])

    const detailResponse = await fetch(
      `${fixture.origin}/api/datasets/dataset-semarang/active/assets/CCTV-01?branchId=semarang`,
      { headers: { authorization: 'Bearer viewer-token' } },
    )
    const assetDetail = await detailResponse.json()
    assert.equal(detailResponse.status, 200)
    assert.equal(assetDetail.asset.assetId, 'CCTV-01')
    assert.equal(assetDetail.activePointer.datasetVersionId, status.datasetVersion.id)
    assert.ok(assetDetail.asset.properties)

    assert.deepEqual(await readdir(path.join(fixture.dataRoot, 'temporary-uploads')), [])
    assert.deepEqual(await readdir(path.join(fixture.dataRoot, 'workspaces')), [])
    const auditText = await readFile(
      path.join(fixture.dataRoot, 'audit', 'imports.jsonl'),
      'utf8',
    )
    assert.match(auditText, /dataset_import\.upload_accepted/)
    assert.match(auditText, /dataset_import\.processing_completed/)
    assert.match(auditText, /dataset_import\.authorization_denied/)
    assert.match(auditText, /dataset_version\.activated/)
    assert.match(auditText, /dataset_version\.source_file_downloaded/)
    assert.match(auditText, /dataset_version\.source_file_download_failed/)
    assert.match(auditText, /"result":"committed"/)
    const auditEntries = auditText.trim().split('\n').map((line) => JSON.parse(line))
    const processingCompleted = auditEntries.find((entry) => (
      entry.event === 'dataset_import.processing_completed'
    ))
    assert.equal(processingCompleted?.correlationId, 'import-worker-test')
    assert.ok(processingCompleted?.details?.jobId)
    assert.ok(processingCompleted?.details?.graphRevision)
  } finally {
    await fixture.close()
  }
})

test('source download reports checksum and missing-file incidents without exposing storage path', async () => {
  const fixture = await createFixture()
  try {
    const accepted = await uploadKml(fixture.origin, VALID_KML, 'incident.kml')
    await fixture.jobQueue.onIdle()
    const persisted = await fixture.repository.get(accepted.body.datasetVersion.id)
    const sourcePath = path.join(
      fixture.dataRoot,
      ...persisted.datasetVersion.sourceStorageKey.split('/'),
    )

    await writeFile(sourcePath, Buffer.from(`${VALID_KML}\nchanged`))
    const checksumResponse = await fetch(
      `${fixture.origin}/api/dataset-versions/${persisted.datasetVersion.id}/source-file`,
      { headers: { authorization: 'Bearer admin-token' } },
    )
    const checksumError = await checksumResponse.json()
    assert.equal(checksumResponse.status, 409)
    assert.equal(checksumError.error.code, 'source_file_integrity_failed')
    assert.equal(JSON.stringify(checksumError).includes('source-files/'), false)

    await rm(sourcePath, { force: true })
    const missingResponse = await fetch(
      `${fixture.origin}/api/dataset-versions/${persisted.datasetVersion.id}/source-file`,
      { headers: { authorization: 'Bearer admin-token' } },
    )
    const missingError = await missingResponse.json()
    assert.equal(missingResponse.status, 404)
    assert.equal(missingError.error.code, 'source_file_missing')
    assert.equal(JSON.stringify(missingError).includes('source-files/'), false)

    const auditText = await readFile(
      path.join(fixture.dataRoot, 'audit', 'imports.jsonl'),
      'utf8',
    )
    assert.match(auditText, /dataset_version\.source_file_incident/)
    assert.match(auditText, /source_file_integrity_failed/)
    assert.match(auditText, /source_file_missing/)
    assert.equal(auditText.includes(persisted.datasetVersion.sourceStorageKey), false)
  } finally {
    await fixture.close()
  }
})

test('validation failure produces an invalid version and never activates it', async () => {
  const fixture = await createFixture()
  try {
    const accepted = await uploadKml(fixture.origin, INVALID_KML, 'invalid.kml')
    assert.equal(accepted.response.status, 202)

    await fixture.jobQueue.onIdle()
    const statusResponse = await fetch(
      `${fixture.origin}${accepted.body.statusUrl}`,
      { headers: { authorization: 'Bearer admin-token' } },
    )
    const status = await statusResponse.json()

    assert.equal(status.datasetVersion.status, 'invalid')
    assert.equal(status.datasetVersion.validationStatus, 'invalid')
    assert.equal(status.active, false)
    assert.equal(status.canActivate, false)
    assert.ok(status.issues.some((issue) => (
      issue.issueCode === 'ASSET_ID_MISSING' && issue.canActivate === false
    )))
    assert.equal(status.validation.summary.blocking > 0, true)

    const rejectionResponse = await fetch(
      `${fixture.origin}/api/admin/imports/${status.datasetVersion.id}/reject`,
      {
        method: 'POST',
        headers: { authorization: 'Bearer admin-token' },
      },
    )
    const rejection = await rejectionResponse.json()
    assert.equal(rejectionResponse.status, 200)
    assert.equal(rejection.datasetVersion.status, 'archived')
  } finally {
    await fixture.close()
  }
})

test('structured Google Earth KML can use recorded folder and Placemark identity', async () => {
  const fixture = await createFixture()
  try {
    const accepted = await uploadKml(
      fixture.origin,
      SOURCE_NAME_FALLBACK_KML,
      'google-earth-source.kml',
      { officialSourceConfirmed: 'true' },
    )
    assert.equal(accepted.response.status, 202)
    await fixture.jobQueue.onIdle()

    const record = await fixture.repository.get(accepted.body.datasetVersion.id)
    assert.equal(record.datasetVersion.status, 'valid')
    assert.equal(record.validation.canActivate, true)
    assert.equal(record.assets.length, 1)
    assert.equal(
      record.assets[0].assetId,
      'src:cctv-camera-fix-dome-indoor:cam-05',
    )
    assert.equal(record.assets[0].category, 'CCTV')
    assert.equal(record.assets[0].type, 'Camera Fix Dome Indoor')
    assert.ok(record.issues.some(
      (issue) => issue.issueCode === 'SOURCE_IDENTITY_FALLBACK_APPLIED',
    ))
  } finally {
    await fixture.close()
  }
})

test('KMZ import prioritizes doc.kml, records safe resources, and cleans its workspace', async () => {
  const fixture = await createFixture()
  try {
    const overlayImage = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const kmlWithOverlay = VALID_KML.replace('</Document>', `
      <GroundOverlay id="site-plan">
        <name>Site plan</name>
        <Icon><href>icons/camera.png</href></Icon>
        <LatLonBox>
          <north>-6.8</north><south>-7</south><east>110.5</east><west>110.3</west>
        </LatLonBox>
      </GroundOverlay>
    </Document>`)
    const archive = createStoredZip([
      { name: 'z-other.kml', content: '<kml><Document /></kml>' },
      { name: 'doc.kml', content: kmlWithOverlay },
      { name: 'icons/camera.png', content: overlayImage },
      { name: 'payload.exe', content: 'ignored' },
    ])
    const accepted = await uploadFile(
      fixture.origin,
      archive,
      'network.kmz',
      'application/vnd.google-earth.kmz',
    )
    assert.equal(accepted.response.status, 202)

    await fixture.jobQueue.onIdle()
    const statusResponse = await fetch(
      `${fixture.origin}${accepted.body.statusUrl}`,
      { headers: { authorization: 'Bearer admin-token' } },
    )
    const status = await statusResponse.json()

    assert.equal(status.datasetVersion.status, 'valid')
    assert.equal(status.active, false)
    assert.equal(status.sourceSelection.selectedKmlPath, 'doc.kml')
    assert.deepEqual(
      status.sourceSelection.resources.map((resource) => resource.relativePath),
      ['icons/camera.png'],
    )
    assert.ok(status.issues.some((issue) => (
      issue.issueCode === 'KML_DOCUMENTS_MERGED'
    )))
    assert.ok(status.issues.some((issue) => issue.issueCode === 'KMZ_RESOURCE_IGNORED'))
    const sourceDownload = await fetch(
      `${fixture.origin}/api/dataset-versions/${status.datasetVersion.id}/source-file`,
      { headers: { authorization: 'Bearer admin-token' } },
    )
    assert.equal(sourceDownload.status, 200)
    assert.equal(
      sourceDownload.headers.get('content-type'),
      'application/vnd.google-earth.kmz',
    )
    assert.match(
      sourceDownload.headers.get('content-disposition'),
      /attachment; filename="network\.kmz"/,
    )
    assert.deepEqual(Buffer.from(await sourceDownload.arrayBuffer()), archive)
    const overlayProjectionResponse = await fetch(
      `${fixture.origin}/api/dataset-versions/${status.datasetVersion.id}/overlays`,
      { headers: { authorization: 'Bearer viewer-token' } },
    )
    assert.equal(overlayProjectionResponse.status, 200)
    const overlayProjection = await overlayProjectionResponse.json()
    assert.equal(overlayProjection.items.length, 1)
    assert.match(overlayProjection.items[0].resourceUrl, /overlay-resources/)
    const overlayResponse = await fetch(
      `${fixture.origin}${overlayProjection.items[0].resourceUrl}`,
      { headers: { authorization: 'Bearer viewer-token' } },
    )
    assert.equal(overlayResponse.status, 200)
    assert.equal(overlayResponse.headers.get('content-type'), 'image/png')
    assert.deepEqual(Buffer.from(await overlayResponse.arrayBuffer()), overlayImage)
    const viewerGraph = await fetch(
      `${fixture.origin}/api/dataset-versions/${status.datasetVersion.id}/topology/graph`,
      { headers: { authorization: 'Bearer viewer-token' } },
    )
    assert.equal(viewerGraph.status, 200)
    const restrictedCandidates = await fetch(
      `${fixture.origin}/api/dataset-versions/${status.datasetVersion.id}/topology/candidates`,
      { headers: { authorization: 'Bearer viewer-token' } },
    )
    assert.equal(restrictedCandidates.status, 403)
    assert.deepEqual(await readdir(path.join(fixture.dataRoot, 'workspaces')), [])
  } finally {
    await fixture.close()
  }
})

test('KMZ import merges source features from every valid KML document', async () => {
  const fixture = await createFixture()
  try {
    const secondKml = VALID_KML
      .replace('CCTV-01', 'CCTV-02')
      .replace('Camera Gate', 'Camera Backup')
      .replace('110.4,-6.9', '110.5,-6.9')
    const archive = createStoredZip([
      { name: 'doc.kml', content: VALID_KML },
      { name: 'additional-assets.kml', content: secondKml },
    ])
    const accepted = await uploadFile(
      fixture.origin,
      archive,
      'multiple-assets.kmz',
      'application/vnd.google-earth.kmz',
    )
    assert.equal(accepted.response.status, 202)

    await fixture.jobQueue.onIdle()
    const response = await fetch(
      `${fixture.origin}${accepted.body.statusUrl}`,
      { headers: { authorization: 'Bearer admin-token' } },
    )
    const status = await response.json()

    assert.equal(
      status.datasetVersion.status,
      'valid',
      JSON.stringify(status.issues),
    )
    assert.equal(status.validation.canActivate, true)
    assert.equal(status.datasetVersion.summary.totalAssets, 2)
    assert.deepEqual(status.sourceSelection.mergedKmlPaths, [
      'doc.kml',
      'additional-assets.kml',
    ])
    assert.ok(status.issues.some((issue) => (
      issue.issueCode === 'KML_DOCUMENTS_MERGED'
      && issue.severity === 'information'
      && issue.canActivate === true
    )))
  } finally {
    await fixture.close()
  }
})

test('manual mounting from KMZ A survives assignment and KMZ B re-import', async () => {
  const fixture = await createFixture()
  try {
    const firstArchive = createStoredZip([{
      name: 'doc.kml',
      content: mountingFixtureKml(),
    }])
    const firstAccepted = await uploadFile(
      fixture.origin,
      firstArchive,
      'rjbt-a.kmz',
      'application/vnd.google-earth.kmz',
      {
        versionName: 'RJBT KMZ A',
        officialSourceConfirmed: 'true',
      },
    )
    assert.equal(firstAccepted.response.status, 202)
    await fixture.jobQueue.onIdle()
    const firstStatusResponse = await fetch(
      `${fixture.origin}${firstAccepted.body.statusUrl}`,
      { headers: { authorization: 'Bearer admin-token' } },
    )
    const firstStatus = await firstStatusResponse.json()
    assert.equal(firstStatus.datasetVersion.status, 'valid', JSON.stringify(firstStatus.issues))

    const activationResponse = await fetch(
      `${fixture.origin}/api/admin/imports/${firstStatus.datasetVersion.id}/activate`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          confirmArchiveCurrent: true,
          expectedActiveVersionId: null,
        }),
      },
    )
    assert.equal(activationResponse.status, 200)

    const assignmentResponse = await fetch(
      `${fixture.origin}/api/dataset-versions/${firstStatus.datasetVersion.id}/topology/mounting-relations`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          assetId: 'CCTV-01',
          poleAssetId: 'POLE-02',
          action: 'assign',
          reason: 'Koreksi lapangan pada KMZ A.',
        }),
      },
    )
    const assignment = await assignmentResponse.json()
    assert.equal(assignmentResponse.status, 200, JSON.stringify(assignment))
    assert.equal(assignment.relation.sourceAssetId, 'CCTV-01')
    assert.equal(assignment.relation.targetAssetId, 'POLE-02')
    assert.equal(assignment.relation.provenance, 'manual_admin')

    const secondArchive = createStoredZip([{
      name: 'doc.kml',
      content: mountingFixtureKml({
        cameraLongitude: '110.400003',
        cameraName: 'Camera Gate Refresh',
      }),
    }])
    const secondAccepted = await uploadFile(
      fixture.origin,
      secondArchive,
      'rjbt-b.kmz',
      'application/vnd.google-earth.kmz',
      {
        versionName: 'RJBT KMZ B',
        officialSourceConfirmed: 'true',
      },
    )
    assert.equal(secondAccepted.response.status, 202)
    await fixture.jobQueue.onIdle()

    const secondRecord = await fixture.repository.get(secondAccepted.body.datasetVersion.id)
    const persistedRelation = secondRecord.mountingRelations.find((relation) => (
      relation.sourceAssetId === 'CCTV-01'
    ))
    assert.ok(persistedRelation)
    assert.equal(persistedRelation.targetAssetId, 'POLE-02')
    assert.equal(persistedRelation.provenance, 'manual_admin')
    assert.equal(secondRecord.mountingOverrides[0].assetId, 'CCTV-01')
    assert.equal(secondRecord.mountingOverrides[0].targetAssetId, 'POLE-02')
    assert.equal(
      secondRecord.assets.find((asset) => asset.assetId === 'CCTV-01')?.canonicalAssetId,
      'CCTV-01',
    )
  } finally {
    await fixture.close()
  }
})

async function createFixture() {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'sinergi-import-service-'))
  const config = createConfig({}, {
    dataRoot,
    allowedBranchIds: ['semarang'],
    datasetIdsByBranch: { semarang: 'dataset-semarang' },
    authTokens: {
      'admin-token': { id: 'admin-1', role: 'Administrator' },
      'viewer-token': { id: 'viewer-1', role: 'Viewer' },
      'scoped-download-token': {
        id: 'download-1',
        role: 'Viewer',
        permissions: ['dataset:source:download'],
        branchIds: ['semarang'],
      },
    },
    upload: {
      maxFileSize: 50 * 1024 * 1024,
      maxArchiveEntries: 100,
      maxExtractedSize: 10 * 1024 * 1024,
      maxCompressionRatio: 100,
      maxKmlSize: 5 * 1024 * 1024,
    },
  })
  const fileStore = new ImportFileStore(dataRoot)
  await fileStore.initialize()
  const repository = new JsonDatasetVersionRepository(
    path.join(dataRoot, 'dataset-versions'),
  )
  const auditLog = new JsonLinesAuditLog(path.join(dataRoot, 'audit', 'imports.jsonl'))
  const jobQueue = new BackgroundJobQueue()
  const importPipeline = new ImportPipeline({
    repository,
    fileStore,
    auditLog,
    limits: config.upload,
    metadataAliases: config.metadataAliases,
    sourceIdentityFallback: config.sourceIdentityFallback,
    folderMappings: config.folderMappings,
    relationMappings: config.relationMappings,
    validationService: new DatasetVersionValidationService({
      ...config.validation,
      maxFileSize: config.upload.maxFileSize,
    }),
  })
  const lifecycleService = new DatasetVersionLifecycleService({
    repository,
    auditLog,
  })
  const topologyService = new TopologyService({
    repository,
    auditLog,
    config: config.topology,
  })
  const app = createApp({
    config,
    authenticator: new TokenAuthenticator(config.authTokens),
    repository,
    fileStore,
    auditLog,
    jobQueue,
    importPipeline,
    lifecycleService,
    topologyService,
  })
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve))
  const address = app.address()

  return {
    dataRoot,
    repository,
    jobQueue,
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      await jobQueue.onIdle()
      await new Promise((resolve, reject) => {
        app.close((error) => error ? reject(error) : resolve())
      })
      await rm(dataRoot, { recursive: true, force: true })
    },
  }
}

async function uploadKml(origin, source, filename, fields = {}, options = {}) {
  return uploadFile(
    origin,
    source,
    filename,
    'application/vnd.google-earth.kml+xml',
    fields,
    options,
  )
}

async function uploadFile(origin, source, filename, mimeType, fields = {}, {
  correlationId = null,
} = {}) {
  const form = new FormData()
  form.append('branchId', 'semarang')
  Object.entries(fields).forEach(([key, value]) => form.append(key, value))
  form.append('file', new Blob([source], { type: mimeType }), filename)
  const response = await fetch(`${origin}/api/admin/imports`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer admin-token',
      ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
    },
    body: form,
  })
  return {
    response,
    body: await response.json(),
  }
}
