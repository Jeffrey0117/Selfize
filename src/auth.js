const ADMIN_TOKEN = process.env.SELFIZE_TOKEN || 'selfize-dev-token'

function requireAdmin(req) {
  const auth = req.headers['authorization'] || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (token !== ADMIN_TOKEN) {
    return { error: 'Unauthorized', code: 401 }
  }
  return null
}

function isAdmin(req) {
  const auth = req.headers['authorization'] || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  return token === ADMIN_TOKEN
}

module.exports = { requireAdmin, isAdmin, ADMIN_TOKEN }
