// updateCollection 的回歸測試：把既有 collection 的規則改成 `user` 時，
// `_owner` 欄位必須一起補上。
//
// ⛔ 2026-11-09 之前只有 createCollection 會自動補，updateCollection 不會。那是
// 一個**靜默失效**的陷阱：規則說「per-user 隔離」但資料形狀不支援 →
//   - read/update/delete 比對 `_owner = ?`，欄位不存在就炸、全 NULL 就比對不到
//     任何列（使用者看不到也改不動自己的資料）
//   - create 想寫入 _owner → 欄位不存在
// bug 已修，所以 RED 那一步是刻意重現的（把自動補那段拿掉跑一次，見 commit）。
//
// 用臨時 DB 檔，不碰 data/selfize.db。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// ⚠️ env 一定要在 require('../src/db') **之前**設好：那個模組在載入時就算出
// DB_PATH。設晚了測試就會寫進正式的 data/selfize.db。
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfize-col-'))
process.env.SELFIZE_DATA_DIR = dir
const dbModule = require('../src/db')
const collections = require('../src/collections')

test.after(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
})

test('setup: 測試用的 DB 不是正式那顆（寫錯地方比測試失敗嚴重）', () => {
  const file = dbModule.getDbPath()
  assert.ok(String(file).startsWith(dir), `應該指向臨時目錄,實際是 ${file}`)
})

const FIELDS = [
  { name: 'title', type: 'text' },
  { name: 'owner_id', type: 'text' },
]

test('🔒 把規則改成 user 時，_owner 欄位要自動補上（schema 與資料表都要）', () => {
  const name = 't_rules_to_user'
  collections.createCollection(name, FIELDS, { read: 'public', create: 'public', update: 'public', delete: 'public' })
  const before = collections.getCollection(name)
  assert.equal(before.schema.some((f) => f.name === '_owner'), false, '一開始不該有 _owner')

  collections.updateCollection(name, { rules: { create: 'user', update: 'user', delete: 'user' } })

  const after = collections.getCollection(name)
  assert.equal(after.rules.create, 'user')
  assert.equal(after.rules.read, 'public', '沒傳的 op 要保留原值')
  assert.ok(after.schema.some((f) => f.name === '_owner'), 'schema 要有 _owner')

  // 資料表真的有那一欄（不是只有 metadata）
  const cols = require('../src/db').getDb().prepare(`PRAGMA table_info("${name}")`).all().map((c) => c.name)
  assert.ok(cols.includes('_owner'), `資料表要有 _owner 欄位，實際有 ${cols.join(',')}`)
})

test('規則沒有 user 時不要亂加 _owner', () => {
  const name = 't_rules_admin'
  collections.createCollection(name, FIELDS, { read: 'public', create: 'admin', update: 'admin', delete: 'admin' })
  collections.updateCollection(name, { rules: { read: 'admin' } })
  const after = collections.getCollection(name)
  assert.equal(after.schema.some((f) => f.name === '_owner'), false)
})

test('已經有 _owner 的 collection 不會被加第二次', () => {
  const name = 't_rules_already'
  collections.createCollection(name, FIELDS, { read: 'user', create: 'user', update: 'user', delete: 'user' })
  const before = collections.getCollection(name)
  assert.equal(before.schema.filter((f) => f.name === '_owner').length, 1)

  collections.updateCollection(name, { rules: { read: 'public' } })
  const after = collections.getCollection(name)
  assert.equal(after.schema.filter((f) => f.name === '_owner').length, 1, '不該重複')
})

test('同時傳 schema 與 user 規則時，_owner 也要補進那份 schema', () => {
  const name = 't_rules_with_schema'
  collections.createCollection(name, FIELDS, { read: 'public', create: 'public', update: 'public', delete: 'public' })
  collections.updateCollection(name, {
    schema: [...FIELDS, { name: 'note', type: 'text' }],
    rules: { create: 'user' },
  })
  const after = collections.getCollection(name)
  assert.ok(after.schema.some((f) => f.name === 'note'), '新欄位要在')
  assert.ok(after.schema.some((f) => f.name === '_owner'), '_owner 也要在')
})
