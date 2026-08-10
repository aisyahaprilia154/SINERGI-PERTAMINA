const localAdminToken = process.env.SINERGI_LOCAL_ADMIN_TOKEN ?? 'local-admin'

process.env.SINERGI_BRANCH_IDS ??= 'semarang'
process.env.SINERGI_BRANCH_DATASETS ??= JSON.stringify({
  semarang: 'dataset-semarang',
})
process.env.SINERGI_AUTH_TOKENS ??= JSON.stringify({
  [localAdminToken]: {
    id: 'local-admin',
    role: 'Administrator',
    branchIds: ['semarang'],
    datasetIds: ['dataset-semarang'],
  },
})

await import('../src/server.js')

