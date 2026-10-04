/**
 * LetMeUse JWT 驗證（per-user auth）
 *
 * 驗 ES256（JWKS 自動抓取快取 10 分鐘）。回傳 payload（{ sub, app, ... }）或 null。
 * 規則值 'user' 的 collection 會用這裡的身分做 owner 隔離。
 *
 * env:
 *   LETMEUSE_URL   — JWKS 來源（預設 http://localhost:4006，同機最快也不走外網）
 *   SELFIZE_LMU_APPS — 逗號分隔的允許 appId 白名單（空 = 不限制 app）
 */
const crypto = require('crypto')

const LMU_URL = (process.env.LETMEUSE_URL || 'http://localhost:4006').replace(/\/$/, '')
const ALLOWED_APPS = (process.env.SELFIZE_LMU_APPS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

let jwksCache = { keys: null, at: 0 }

async function getJwks() {
  if (jwksCache.keys && Date.now() - jwksCache.at < 10 * 60 * 1000) return jwksCache.keys
  const res = await fetch(LMU_URL + '/api/jwks')
  if (!res.ok) throw new Error('jwks fetch failed: ' + res.status)
  const data = await res.json()
  jwksCache = { keys: data.keys || [], at: Date.now() }
  return jwksCache.keys
}

function b64json(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
}

/** 驗 Bearer token → payload 或 null（任何錯誤一律 null，不擋服務） */
async function verifyLmuToken(req) {
  try {
    const auth = req.headers['authorization'] || ''
    const token = auth.replace(/^Bearer\s+/i, '')
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [h, p, s] = parts
    const header = b64json(h)
    if (header.alg !== 'ES256') return null

    const keys = await getJwks()
    const jwk = keys.find((k) => k.kid === header.kid) || keys[0]
    if (!jwk) return null
    const pub = crypto.createPublicKey({ key: jwk, format: 'jwk' })
    const ok = crypto.verify(
      'sha256',
      Buffer.from(h + '.' + p),
      { key: pub, dsaEncoding: 'ieee-p1363' },
      Buffer.from(s, 'base64url')
    )
    if (!ok) return null

    const payload = b64json(p)
    payload.sub = payload.sub || payload.userId
    if (!payload.sub) return null
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null
    if (ALLOWED_APPS.length && !ALLOWED_APPS.includes(payload.app)) return null
    return payload
  } catch (err) {
    return null
  }
}

/** owner 字串：app 範圍內唯一（跨 app 不互通） */
function ownerKey(payload) {
  return (payload.app || 'noapp') + ':' + payload.sub
}

module.exports = { verifyLmuToken, ownerKey }
