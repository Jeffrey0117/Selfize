const Database = require('better-sqlite3')
const { join } = require('path')
const { mkdirSync } = require('fs')

const DATA_DIR = join(__dirname, '..', 'data')
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

function fieldToSql(field) {
  const sqlType = TYPE_MAP[field.type] || 'TEXT'
  const parts = [`"${field.name}" ${sqlType}`]
  if (field.required) parts.push('NOT NULL')
  if (field.default !== undefined) {
    const val = typeof field.default === 'string' ? `'${field.default}'` : field.default
    parts.push(`DEFAULT ${val}`)
  }
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

module.exports = { getDb, createCollectionTable, dropCollectionTable, TYPE_MAP }
