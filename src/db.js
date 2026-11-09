const Database = require('better-sqlite3')
const { join } = require('path')
const { mkdirSync } = require('fs')

// 資料目錄可用 env 覆寫。加這個是為了讓 collections / records 的邏輯**測得到** ——
// 寫死路徑的話，任何碰 getDb() 的測試都會寫進正式的 data/selfize.db。
// 生產環境不設它，行為跟以前完全一樣。
const DATA_DIR = process.env.SELFIZE_DATA_DIR || join(__dirname, '..', 'data')
const DB_PATH = join(DATA_DIR, 'selfize.db')

let _db = null

function getDb() {
  if (_db) return _db
  mkdirSync(DATA_DIR, { recursive: true })
  _db = new Database(DB_PATH)
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')

  _db.exec(`
    CREATE TABLE IF NOT EXISTS _collections (
      name TEXT PRIMARY KEY,
      schema TEXT NOT NULL DEFAULT '[]',
      rules TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `)

  return _db
}

const TYPE_MAP = {
  text: 'TEXT',
  number: 'REAL',
  integer: 'INTEGER',
  boolean: 'INTEGER',
  json: 'TEXT',
  date: 'TEXT',
}

const FIELD_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

function badRequest(message) {
  const err = new Error(message)
  err.status = 400
  return err
}

// Field names and defaults end up inside DDL (CREATE/ALTER TABLE), where SQLite
// can't bind parameters — so validate names and render defaults as safe literals.
function assertFieldName(name) {
  if (typeof name !== 'string' || !FIELD_NAME_RE.test(name)) {
    throw badRequest(`Invalid field name: ${JSON.stringify(name)} (letters, digits, underscore; max 64)`)
  }
  if (['id', 'created_at', 'updated_at'].includes(name)) {
    throw badRequest(`Field name "${name}" is reserved`)
  }
}

function sqlDefault(value) {
  if (value === null) return 'NULL'
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`
  throw badRequest('Field default must be a string, finite number, boolean or null')
}

function validateFields(fields) {
  if (!Array.isArray(fields)) throw badRequest('fields must be an array')
  for (const field of fields) {
    if (!field || typeof field !== 'object') throw badRequest('Each field must be an object')
    assertFieldName(field.name)
    if (field.default !== undefined) sqlDefault(field.default)
  }
}

function fieldToSql(field) {
  assertFieldName(field.name)
  const sqlType = TYPE_MAP[field.type] || 'TEXT'
  const parts = [`"${field.name}" ${sqlType}`]
  if (field.required) parts.push('NOT NULL')
  if (field.default !== undefined) parts.push(`DEFAULT ${sqlDefault(field.default)}`)
  return parts.join(' ')
}

function createCollectionTable(name, fields) {
  const db = getDb()
  const columns = fields.map(fieldToSql).join(',\n    ')
  db.exec(`
    CREATE TABLE IF NOT EXISTS "${name}" (
      id TEXT PRIMARY KEY,
      ${columns},
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `)
}

function dropCollectionTable(name) {
  const db = getDb()
  db.exec(`DROP TABLE IF EXISTS "${name}"`)
}

/** 給測試用：確認目前連到的是哪一顆 DB。 */
function getDbPath() {
  return DB_PATH
}

module.exports = {
  getDbPath,
  getDb, createCollectionTable, dropCollectionTable, TYPE_MAP,
  assertFieldName, sqlDefault, validateFields,
}
