const { v4: uuid } = require('uuid')
const { getDb } = require('./db')
const { getCollection } = require('./collections')
const { parseQuery } = require('./query')

function listRecords(collectionName, queryParams, owner) {
  const db = getDb()
  const col = getCollection(collectionName)
  if (!col) throw Object.assign(new Error(`Collection "${collectionName}" not found`), { status: 404 })

  let { whereClause, values, orderClause, limit, offset, selectClause, expand } = parseQuery(queryParams, col.schema)

  // per-user 隔離：伺服器端強制 _owner 過濾
  if (owner) {
    whereClause = whereClause ? `${whereClause} AND "_owner" = ?` : 'WHERE "_owner" = ?'
    values = [...values, owner]
  }

  const countSql = `SELECT COUNT(*) as total FROM "${collectionName}" ${whereClause}`
  const total = db.prepare(countSql).get(...values).total

  const sql = `SELECT ${selectClause} FROM "${collectionName}" ${whereClause} ${orderClause} LIMIT ? OFFSET ?`
  const rows = db.prepare(sql).all(...values, limit, offset)

  const items = rows.map((r) => deserializeRow(r, col.schema))

  if (expand.length > 0) {
    expandRelations(items, expand, col.schema)
  }

  return { items, total, limit, offset }
}

function getRecord(collectionName, id, queryParams = {}, owner) {
  const db = getDb()
  const col = getCollection(collectionName)
  if (!col) throw Object.assign(new Error(`Collection "${collectionName}" not found`), { status: 404 })

  const row = db.prepare(`SELECT * FROM "${collectionName}" WHERE id = ?`).get(id)
  if (!row) throw Object.assign(new Error('Record not found'), { status: 404 })
  if (owner && row._owner !== owner) throw Object.assign(new Error('Record not found'), { status: 404 })

  const item = deserializeRow(row, col.schema)

  const expand = queryParams.expand ? queryParams.expand.split(',').map((e) => e.trim()) : []
  if (expand.length > 0) {
    expandRelations([item], expand, col.schema)
  }

  return item
}

function createRecord(collectionName, data) {
  const db = getDb()
  const col = getCollection(collectionName)
  if (!col) throw Object.assign(new Error(`Collection "${collectionName}" not found`), { status: 404 })

  validateFields(data, col.schema)

  const id = data.id || uuid()
  const fields = ['id']
  const placeholders = ['?']
  const values = [id]

  for (const field of col.schema) {
    if (data[field.name] !== undefined) {
      fields.push(`"${field.name}"`)
      placeholders.push('?')
      values.push(serializeValue(data[field.name], field.type))
    }
  }

  const sql = `INSERT INTO "${collectionName}" (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`
  db.prepare(sql).run(...values)

  return getRecord(collectionName, id)
}

function updateRecord(collectionName, id, data, owner) {
  const db = getDb()
  const col = getCollection(collectionName)
  if (!col) throw Object.assign(new Error(`Collection "${collectionName}" not found`), { status: 404 })

  const existing = db.prepare(`SELECT * FROM "${collectionName}" WHERE id = ?`).get(id)
  if (!existing) throw Object.assign(new Error('Record not found'), { status: 404 })
  if (owner && existing._owner !== owner) throw Object.assign(new Error('Record not found'), { status: 404 })
  delete data._owner

  const sets = []
  const values = []

  for (const field of col.schema) {
    if (data[field.name] !== undefined) {
      sets.push(`"${field.name}" = ?`)
      values.push(serializeValue(data[field.name], field.type))
    }
  }

  if (sets.length === 0) throw Object.assign(new Error('No valid fields to update'), { status: 400 })

  sets.push("updated_at = datetime('now')")
  values.push(id)

  db.prepare(`UPDATE "${collectionName}" SET ${sets.join(', ')} WHERE id = ?`).run(...values)

  return getRecord(collectionName, id)
}

function deleteRecord(collectionName, id, owner) {
  const db = getDb()
  const col = getCollection(collectionName)
  if (!col) throw Object.assign(new Error(`Collection "${collectionName}" not found`), { status: 404 })

  const existing = db.prepare(`SELECT * FROM "${collectionName}" WHERE id = ?`).get(id)
  if (!existing) throw Object.assign(new Error('Record not found'), { status: 404 })
  if (owner && existing._owner !== owner) throw Object.assign(new Error('Record not found'), { status: 404 })

  db.prepare(`DELETE FROM "${collectionName}" WHERE id = ?`).run(id)
  return { deleted: id }
}

// --- helpers ---

function serializeValue(value, type) {
  if (value === null || value === undefined) return null
  if (type === 'json') return JSON.stringify(value)
  if (type === 'boolean') return value ? 1 : 0
  return value
}

function deserializeRow(row, schema) {
  const result = { ...row }
  for (const field of schema) {
    if (result[field.name] === undefined) continue
    if (field.type === 'json' && typeof result[field.name] === 'string') {
      try { result[field.name] = JSON.parse(result[field.name]) } catch { /* keep raw */ }
    }
    if (field.type === 'boolean') {
      result[field.name] = result[field.name] === 1
    }
  }
  return result
}

function validateFields(data, schema) {
  for (const field of schema) {
    if (field.required && (data[field.name] === undefined || data[field.name] === null || data[field.name] === '')) {
      throw Object.assign(new Error(`Field "${field.name}" is required`), { status: 400 })
    }
  }
}

function expandRelations(items, expandFields, schema) {
  const db = getDb()

  for (const fieldName of expandFields) {
    const field = schema.find((f) => f.name === fieldName)
    if (!field || !field.ref) continue

    const refCollection = field.ref
    const ids = [...new Set(items.map((i) => i[fieldName]).filter(Boolean))]
    if (ids.length === 0) continue

    const placeholders = ids.map(() => '?').join(',')
    const refRows = db.prepare(`SELECT * FROM "${refCollection}" WHERE id IN (${placeholders})`).all(...ids)

    const refCol = getCollection(refCollection)
    const refSchema = refCol ? refCol.schema : []
    const refMap = {}
    for (const row of refRows) {
      refMap[row.id] = deserializeRow(row, refSchema)
    }

    for (const item of items) {
      if (item[fieldName] && refMap[item[fieldName]]) {
        item[`${fieldName}_expanded`] = refMap[item[fieldName]]
      }
    }
  }
}

module.exports = { listRecords, getRecord, createRecord, updateRecord, deleteRecord }
