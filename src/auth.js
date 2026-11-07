const crypto = require('crypto')

// Fail closed: without SELFIZE_TOKEN the admin API gets a random per-process token
// (nobody knows it), instead of a well-known default that is printed in the README.
const ADMIN_TOKEN = process.env.SELFIZE_TOKEN || crypto.randomBytes(32).toString('hex')
if (!process.env.SELFIZE_TOKEN) {
  console.warn('[selfize] SELFIZE_TOKEN is not set — admin API is locked. Set it in .env to use admin endpoints.')
}
const ADMIN_BUF = Buffer.from(ADMIN_TOKEN)

function tokenOf(req) {
  const auth = req.headers['authorization'] || ''
  return auth.replace(/^Bearer\s+/i, '')
}

function isAdmin(req) {
  const given = Buffer.from(tokenOf(req))
  return given.length === ADMIN_BUF.length && crypto.timingSafeEqual(given, ADMIN_BUF)
}

function requireAdmin(req) {
  return isAdmin(req) ? null : { error: 'Unauthorized', code: 401 }
}

module.exports = { requireAdmin, isAdmin, ADMIN_TOKEN }
