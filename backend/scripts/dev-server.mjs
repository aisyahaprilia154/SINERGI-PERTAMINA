process.env.SINERGI_AUTH_TOKENS ??= JSON.stringify({[process.env.SINERGI_LOCAL_ADMIN_TOKEN ?? 'local-admin']:{id:'local-admin',role:'Administrator'}})
await import('../src/server.js')
