const localAdminToken = process.env.SINERGI_LOCAL_ADMIN_TOKEN ?? 'local-admin'

process.env.SINERGI_AUTH_TOKENS ??= JSON.stringify({
  [localAdminToken]: {
    id: 'local-admin',
    role: 'Administrator',
  },
})

await import('../src/server.js')

