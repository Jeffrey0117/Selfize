const { getDb, createCollectionTable, dropCollectionTable } = require('./db')

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

  const existing = getCollection(name)
  if (existing) {
    throw new Error(`Collection "${name}" already exists`)
  }

  const defaultRules = { read: 'public', create: 'public', update: 'public', delete: 'public' }
  const mergedRules = { ...defaultRules, ...rules }

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

  if (updates.schema) {
    sets.push('schema = ?')
    params.push(JSON.stringify(updates.schema))

    // Rebuild table with new schema (add missing columns)
    for (const field of updates.schema) {
      const existingField = existing.schema.find((f) => f.name === field.name)
      if (!existingField) {
        const sqlType = require('./db').TYPE_MAP[field.type] || 'TEXT'
        const def = field.default !== undefined
          ? ` DEFAULT ${typeof field.default === 'string' ? `'${field.default}'` : field.default}`
          : ''
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
    params.push(JSON.stringify({ ...existing.rules, ...updates.rules }))
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
