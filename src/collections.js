const {
  getDb, createCollectionTable, dropCollectionTable, TYPE_MAP, sqlDefault, validateFields,
} = require('./db')

function listCollections() {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM _collections ORDER BY name').all()
  return rows.map((r) => ({
    ...r,
    schema: JSON.parse(r.schema),
    rules: JSON.parse(r.rules),
  }))
}

function getCollection(name) {
  const db = getDb()
  const row = db.prepare('SELECT * FROM _collections WHERE name = ?').get(name)
  if (!row) return null
  return {
    ...row,
    schema: JSON.parse(row.schema),
    rules: JSON.parse(row.rules),
  }
}

function createCollection(name, fields, rules = {}) {
  const db = getDb()

  if (/^_/.test(name)) {
    throw new Error('Collection name cannot start with _')
  }
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error('Collection name must be lowercase alphanumeric with underscores')
  }

  validateFields(fields)

  const existing = getCollection(name)
  if (existing) {
    throw new Error(`Collection "${name}" already exists`)
  }

  const defaultRules = { read: 'public', create: 'public', update: 'public', delete: 'public' }
  const mergedRules = { ...defaultRules, ...rules }
  // 規則含 'user' 的 collection 必須有 _owner 欄位（owner 隔離用），沒宣告就自動補
  if (Object.values(mergedRules).includes('user') && !fields.some((f) => f && f.name === '_owner')) {
    fields = [...fields, { name: '_owner', type: 'text' }]
  }


  db.prepare(`
    INSERT INTO _collections (name, schema, rules) VALUES (?, ?, ?)
  `).run(name, JSON.stringify(fields), JSON.stringify(mergedRules))

  createCollectionTable(name, fields)

  return getCollection(name)
}

function updateCollection(name, updates) {
  const db = getDb()
  const existing = getCollection(name)
  if (!existing) throw new Error(`Collection "${name}" not found`)

  const sets = []
  const params = []

  // 規則改成含 'user' 時也要有 _owner 欄位（owner 隔離用）。
  //
  // ⛔ 2026-11-09 修：原本只有 createCollection 會自動補，updateCollection 不會。
  // 於是「把既有 collection 的規則改成 user」會變成一個**靜默失效**的陷阱：
  //   - read/update/delete 比對 `_owner = ?`，而那個欄位不存在 → SQL 直接錯，
  //     或（欄位存在但全 NULL）比對不到任何列 → 使用者看不到也改不動自己的資料
  //   - create 會想寫入 _owner → 欄位不存在就炸
  // 規則與資料形狀必須一起改，不能讓呼叫端記得自己補。
  const nextRules = updates.rules ? { ...existing.rules, ...updates.rules } : existing.rules
  const needsOwner = Object.values(nextRules).includes('user')
  const schemaToUse = updates.schema || existing.schema
  if (needsOwner && !schemaToUse.some((f) => f && f.name === '_owner')) {
    updates = { ...updates, schema: [...schemaToUse, { name: '_owner', type: 'text' }] }
  }

  if (updates.schema) {
    validateFields(updates.schema)
    sets.push('schema = ?')
    params.push(JSON.stringify(updates.schema))

    // Rebuild table with new schema (add missing columns)
    for (const field of updates.schema) {
      const existingField = existing.schema.find((f) => f.name === field.name)
      if (!existingField) {
        const sqlType = TYPE_MAP[field.type] || 'TEXT'
        const def = field.default !== undefined ? ` DEFAULT ${sqlDefault(field.default)}` : ''
        try {
          db.exec(`ALTER TABLE "${name}" ADD COLUMN "${field.name}" ${sqlType}${def}`)
        } catch (e) {
          if (!e.message.includes('duplicate column')) throw e
        }
      }
    }
  }

  if (updates.rules) {
    sets.push('rules = ?')
    params.push(JSON.stringify(nextRules))
  }

  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')")
    params.push(name)
    db.prepare(`UPDATE _collections SET ${sets.join(', ')} WHERE name = ?`).run(...params)
  }

  return getCollection(name)
}

function deleteCollection(name) {
  const db = getDb()
  const existing = getCollection(name)
  if (!existing) throw new Error(`Collection "${name}" not found`)

  db.prepare('DELETE FROM _collections WHERE name = ?').run(name)
  dropCollectionTable(name)

  return { deleted: name }
}

module.exports = { listCollections, getCollection, createCollection, updateCollection, deleteCollection }
