// node --test test/lmu.test.js
//
// src/lmu.js 在 require 時就讀 env 並建好 verifier，所以這裡先起一個假的
// LetMeUse（真的 HTTP server + 真的 JWKS + 真的 ES256 簽章），設好 env，才
// require 它。不碰線上服務、不碰 data/selfize.db。
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const http = require('node:http')

const ALLOWED_APP = 'app_allowed'
const OTHER_APP = 'app_other'
const KID = 'selfize-test-kid'

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'ES256' }] }

const idp = http.createServer((req, res) => {
  if (req.url === '/api/jwks') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify(jwks))
  }
  res.writeHead(404).end()
})

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')

/** 簽一顆真的 ES256 token（raw r||s，跟 letmeuse 的 jose 一樣）。 */
function sign(payload, { kid = KID, alg = 'ES256', secret } = {}) {
  const input = `${b64({ alg, typ: 'JWT', kid })}.${b64(payload)}`
  const sig = secret
    ? crypto.createHmac('sha256', secret).update(input).digest('base64url')
    : crypto.sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')
  return `${input}.${sig}`
}

const exp = () => Math.floor(Date.now() / 1000) + 3600
const reqWith = (token) => ({ headers: token ? { authorization: `Bearer ${token}` } : {} })

let lmu

test.before(async () => {
  await new Promise((r) => idp.listen(0, '127.0.0.1', r))
  process.env.LETMEUSE_URL = `http://127.0.0.1:${idp.address().port}`
  process.env.SELFIZE_LMU_APPS = `${ALLOWED_APP}, app_second`
  lmu = require('../src/lmu')
  const s = await lmu.warmUp()
  assert.equal(s.keys, 1, '假 IdP 的金鑰要載進來')
})

test.after(() => { idp.close() })

test('白名單內的 app：真 token 通，回得到身分', async () => {
  const claims = await lmu.verifyLmuToken(reqWith(sign({ sub: 'usr_1', app: ALLOWED_APP, email: 'a@x.com', exp: exp() })))
  assert.ok(claims)
  assert.equal(claims.sub, 'usr_1')
  assert.equal(lmu.ownerKey(claims), `${ALLOWED_APP}:usr_1`)
})

test('白名單的第二個 app 也通（多租戶）', async () => {
  assert.ok(await lmu.verifyLmuToken(reqWith(sign({ sub: 'usr_2', app: 'app_second', exp: exp() }))))
})

test('🔒 白名單外的 app 擋掉（原本的 fail-open：SELFIZE_LMU_APPS 空 = 不限制 app）', async () => {
  // 實測過的洞：生態系任何 app 的使用者都能往 rules:user 的 collection 寫資料
  //（跨 app token POST reading_records 回 201）。
  assert.equal(await lmu.verifyLmuToken(reqWith(sign({ sub: 'usr_x', app: OTHER_APP, exp: exp() }))), null)
})

test('🔒 完全沒有 app claim 的 token 擋掉', async () => {
  assert.equal(await lmu.verifyLmuToken(reqWith(sign({ sub: 'usr_x', exp: exp() }))), null)
})

test('🔒 簽章正確但 kid 不在 JWKS 裡 → 擋掉（原本會退回 keys[0]）', async () => {
  // 實測過的洞：舊碼 `keys.find(...) || keys[0]` 讓這種 token 回 200。
  // 金鑰輪換時這等於「已下架的金鑰繼續生效」。
  const token = sign({ sub: 'usr_x', app: ALLOWED_APP, exp: exp() }, { kid: 'not-in-jwks' })
  assert.equal(await lmu.verifyLmuToken(reqWith(token)), null)
})

test('🔒 HS256 擋掉，就算用真的 app secret 簽（pokkit 2026-10-25 根因）', async () => {
  const forged = sign({ sub: 'attacker', app: ALLOWED_APP, role: 'admin', exp: exp() }, { alg: 'HS256', secret: 'leaked' })
  assert.equal(await lmu.verifyLmuToken(reqWith(forged)), null)
})

test('🔒 沒有 exp / 字串 exp / 已過期 一律擋掉', async () => {
  assert.equal(await lmu.verifyLmuToken(reqWith(sign({ sub: 'u', app: ALLOWED_APP }))), null)
  assert.equal(await lmu.verifyLmuToken(reqWith(sign({ sub: 'u', app: ALLOWED_APP, exp: String(exp()) }))), null)
  assert.equal(await lmu.verifyLmuToken(reqWith(sign({ sub: 'u', app: ALLOWED_APP, exp: 1 }))), null)
})

test('🔒 nbf 還沒到的 token 擋掉（原本完全沒檢查）', async () => {
  const token = sign({ sub: 'u', app: ALLOWED_APP, exp: exp(), nbf: Math.floor(Date.now() / 1000) + 600 })
  assert.equal(await lmu.verifyLmuToken(reqWith(token)), null)
})

test('🔒 sub 不是非空字串就擋掉（它會變成 _owner 的一部分進 DB）', async () => {
  for (const bad of [{ a: 1 }, 42, '', null]) {
    assert.equal(await lmu.verifyLmuToken(reqWith(sign({ sub: bad, app: ALLOWED_APP, exp: exp() }))), null, JSON.stringify(bad))
  }
})

test('payload 被改過 / alg:none / 無 token 一律 null', async () => {
  const [h, , s] = sign({ sub: 'u', app: ALLOWED_APP, exp: exp() }).split('.')
  const evil = b64({ sub: 'admin', app: ALLOWED_APP, exp: exp() })
  assert.equal(await lmu.verifyLmuToken(reqWith(`${h}.${evil}.${s}`)), null)
  const none = `${b64({ alg: 'none', typ: 'JWT', kid: KID })}.${b64({ sub: 'a', app: ALLOWED_APP, exp: exp() })}.${'A'.repeat(86)}`
  assert.equal(await lmu.verifyLmuToken(reqWith(none)), null)
  assert.equal(await lmu.verifyLmuToken(reqWith(null)), null)
  assert.equal(await lmu.verifyLmuToken({ headers: {} }), null)
  assert.equal(await lmu.verifyLmuToken({ headers: { authorization: 'Basic abc' } }), null)
})

test('ownerKey 在 app 範圍內唯一（跨 app 不互通）', () => {
  assert.equal(lmu.ownerKey({ app: 'a', sub: 'u1' }), 'a:u1')
  assert.notEqual(lmu.ownerKey({ app: 'a', sub: 'u1' }), lmu.ownerKey({ app: 'b', sub: 'u1' }))
  assert.equal(lmu.ownerKey({ sub: 'u1' }), 'noapp:u1')
})

test('jwksStats 看得見金鑰與白名單數（掛在 /api/health）', () => {
  const s = lmu.jwksStats()
  assert.equal(s.keys, 1)
  assert.deepEqual(s.kids, [KID])
  assert.equal(s.allowedApps, 2)
  assert.equal(s.lastError, null)
})
