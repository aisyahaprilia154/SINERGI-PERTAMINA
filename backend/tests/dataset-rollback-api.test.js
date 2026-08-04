import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from '../src/app.js'
import { TokenAuthenticator } from '../src/security/authorization.js'

test('Administrator rollback route passes branch and expected active version safely', async () => {
  const calls = []
  const app = createApp({
    config: {},
    authenticator: new TokenAuthenticator({
      'admin-token': { id: 'admin-rollback', role: 'Administrator' },
      'viewer-token': { id: 'viewer-rollback', role: 'Viewer' },
    }),
    repository: {},
    fileStore: {},
    auditLog: { async record() {} },
    jobQueue: null,
    importPipeline: {},
    lifecycleService: {
      async rollbackToPrevious(...args) {
        calls.push(args)
        return {
          operation: 'rollback',
          activePointer: {
            datasetId: args[0],
            branchId: args[1],
            datasetVersionId: 'version-old',
            previousVersionId: 'version-new',
            revision: 'rollback-revision-1',
          },
        }
      },
    },
    topologyService: {},
  })
  let listening = false

  try {
    await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve))
    listening = true
    const address = app.address()
    const origin = `http://127.0.0.1:${address.port}`
    const body = JSON.stringify({ expectedActiveVersionId: 'version-new' })

    const forbidden = await fetch(
      `${origin}/api/admin/datasets/dataset-semarang/branches/semarang/rollback`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer viewer-token',
          'content-type': 'application/json',
        },
        body,
      },
    )
    assert.equal(forbidden.status, 403)

    const response = await fetch(
      `${origin}/api/admin/datasets/dataset-semarang/branches/semarang/rollback`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin-token',
          'content-type': 'application/json',
        },
        body,
      },
    )
    const responseBody = await response.json()
    assert.equal(response.status, 200)
    assert.equal(responseBody.operation, 'rollback')
    assert.deepEqual(calls, [[
      'dataset-semarang',
      'semarang',
      'admin-rollback',
      { expectedActiveVersionId: 'version-new' },
    ]])
  } finally {
    if (listening) {
      await new Promise((resolve, reject) => {
        app.close((error) => error ? reject(error) : resolve())
      })
    }
  }
})
