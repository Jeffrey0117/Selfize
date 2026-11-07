/**
 * LetMeUse JWT 驗證（per-user auth）— 由 jwks-verify-kit 代勞。
 *
 * 規則值 `user` 的 collection 會用這裡的身分做 owner 隔離。
 *
 * 🔒 2026-11-08 這個檔整個換成 kit。原本手寫的版本有三個 fail-open，三個都
 * 實測是活的（拿 production 私鑰簽真 token 打本機 4025）：
 *
 *   1. `keys.find(k => k.kid === header.kid) || keys[0]` —— kid 不符時退回第一
 *      把金鑰。實測「簽章正確但 kid 不在 JWKS 裡」的 token 回 200。金鑰輪換期
 *      間這會讓已從 JWKS 下架的金鑰繼續生效。
 *   2. `SELFIZE_LMU_APPS` 沒設 = 不限制 app。LetMeUse 用**同一把** ES256 金鑰
 *      簽發所有 app 的 token，所以 `app` claim 是唯一的租戶邊界 —— 沒設就等於
 *      「生態系任何 app 的任何使用者都能往 selfize 的 user collection 寫資料」。
 *      實測：拿別的 app 的 token POST reading_records 回 201。
 *      （`_owner` 是 `app:sub`，所以讀不到別人的資料；影響是寫入與污染。）
 *   3. 沒有檢查 `nbf`。
 *
 * 另外原本的 JWKS 快取沒有逾時（node 的 fetch 沒有預設值 → 對方不回應就永久
 * 凍結快取、所有人 401 且零診斷）、空的 JWKS 不覆蓋舊快取（緊急撤銷不生效）、
 * 也沒有開機預熱（重啟後第一個請求必 401）。這些全部由 kit 處理，而且 kit 那邊
 * 每一條都有回歸測試。
 *
 * selfize 是**多租戶**的（同時服務 happybook / autocard / launchkit / readdy /
 * areyoubot），所以不能像其他專案那樣綁單一 appId，用 kit 的 `allowedClaims`。
 *
 * env:
 *   LETMEUSE_URL      — JWKS 來源（預設 http://localhost:4006，同機最快也不走外網）
 *   SELFIZE_LMU_APPS  — 逗號分隔的允許 appId 白名單。**必填**；空的話 rules:user
 *                       的 collection 一律拒絕（fail-closed）。
 */
const { createJwksVerifier } = require('jwks-verify-kit')

const LMU_URL = (process.env.LETMEUSE_URL || 'http://localhost:4006').replace(/\/$/, '')
const ALLOWED_APPS = (process.env.SELFIZE_LMU_APPS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

if (ALLOWED_APPS.length === 0) {
  // 大聲：這不是「沒設定所以放寬」，是「沒設定所以關門」。
  console.warn(
    '[selfize] SELFIZE_LMU_APPS 未設定 — rules:user 的 collection 一律拒絕。'
    + ' 請填入允許的 LetMeUse appId（逗號分隔）。'
  )
}

const verifier = createJwksVerifier({
  jwksUrl: `${LMU_URL}/api/jwks`,
  algorithms: ['ES256'],
  // 多租戶邊界：app 必須在白名單內。白名單空的 → 拒絕全部。
  allowedClaims: { app: ALLOWED_APPS },
  onError: (err) => console.warn('[selfize] JWKS:', err.message),
})

/** 驗 Bearer token → payload 或 null（任何錯誤一律 null，不擋服務）。 */
async function verifyLmuToken(req) {
  const token = verifier.bearer(req.headers['authorization'])
  if (!token) return null
  // async 版：冷啟動後第一個請求也能成功（同步版會 fail-closed 拒絕它）。
  return verifier.verifyAsync(token)
}

/** owner 字串：app 範圍內唯一（跨 app 不互通）。 */
function ownerKey(payload) {
  return `${payload.app || 'noapp'}:${payload.sub}`
}

/** 診斷：掛在 /api/health，別讓 fail-closed 變成無聲故障。 */
function jwksStats() {
  return { ...verifier.stats(), allowedApps: ALLOWED_APPS.length }
}

/** 開機預熱（server.js 啟動時呼叫）。 */
function warmUp() {
  return verifier.ready()
}

module.exports = { verifyLmuToken, ownerKey, jwksStats, warmUp }
