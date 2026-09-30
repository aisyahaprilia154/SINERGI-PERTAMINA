import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { JsonDatasetVersionRepository } from '../src/storage/dataset-version-repository.js'

test('resource requests share a compact manifest and reload it after a revision changes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sinergi-resource-'))
  try {
    const repository = new JsonDatasetVersionRepository(directory)
    await repository.create({ datasetVersion: { id: 'version-a' },
      sourceResources: [{ resourceId: 'icon-a' }], sourceOverlays: [], assets: ['large aggregate'] })
    const get = repository.get.bind(repository)
    let reads = 0
    repository.get = async id => { reads += 1; return get(id) }
    const manifests = await Promise.all(Array.from({ length: 8 }, () => (
      repository.getSourceResourceManifest('version-a')
    )))
    assert.equal(reads, 1)
    assert.equal(manifests[0].assets, undefined)
    assert.equal(manifests[0].sourceResources[0].resourceId, 'icon-a')
    await repository.update('version-a', record => ({ ...record,
      sourceResources: [{ resourceId: 'updated-icon-b' }] }))
    const updated = await repository.getSourceResourceManifest('version-a')
    assert.equal(updated.sourceResources[0].resourceId, 'updated-icon-b')
    await assert.rejects(repository.getSourceResourceManifest('missing'),
      error => error.code === 'dataset_version_not_found')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
