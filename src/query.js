/**
 * Parse query params into SQL WHERE, ORDER BY, LIMIT/OFFSET
 *
 * Supported params:
 *   ?status=active           → WHERE status = 'active'
 *   ?owner_id=eq.xxx         → WHERE owner_id = 'xxx'
 *   ?age=gt.18               → WHERE age > 18
 *   ?sort=-created_at        → ORDER BY created_at DESC
 *   ?sort=title              → ORDER BY title ASC
 *   ?limit=20                → LIMIT 20
 *   ?offset=40               → OFFSET 40
 *   ?expand=owner_id         → expand relations
 *   ?select=id,title,author  → select specific fields
 */

const RESERVED = new Set(['sort', 'limit', 'offset', 'expand', 'select', 'page', 'perPage'])

const OPS = {
  eq: '=',
  neq: '!=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  like: 'LIKE',
}

function parseQuery(params, schema) {
  const fieldNames = new Set(schema.map((f) => f.name).concat(['id', 'created_at', 'updated_at']))
  const where = []
  const values = []

  for (const [key, val] of Object.entries(params)) {
    if (RESERVED.has(key)) continue
    if (!fieldNames.has(key)) continue

    const opMatch = val.match(/^(eq|neq|gt|gte|lt|lte|like)\.(.*)$/)
    if (opMatch) {
      const op = OPS[opMatch[1]]
      where.push(`"${key}" ${op} ?`)
      values.push(opMatch[2])
    } else {
      where.push(`"${key}" = ?`)
      values.push(val)
    }
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  // Sort
  let orderClause = 'ORDER BY created_at DESC'
  if (params.sort) {
    const parts = params.sort.split(',').map((s) => {
      const desc = s.startsWith('-')
      const field = desc ? s.slice(1) : s
      if (!fieldNames.has(field)) return null
      return `"${field}" ${desc ? 'DESC' : 'ASC'}`
    }).filter(Boolean)
    if (parts.length > 0) orderClause = `ORDER BY ${parts.join(', ')}`
  }

  // Pagination
  const limit = Math.min(parseInt(params.limit || params.perPage || '100', 10), 500)
  const page = parseInt(params.page || '1', 10)
  const offset = parseInt(params.offset || '0', 10) || (page - 1) * limit

  // Select
  let selectClause = '*'
  if (params.select) {
    const fields = params.select.split(',').filter((f) => fieldNames.has(f.trim()))
    if (fields.length > 0) {
      if (!fields.includes('id')) fields.unshift('id')
      selectClause = fields.map((f) => `"${f.trim()}"`).join(', ')
    }
  }

  // Expand
  const expand = params.expand ? params.expand.split(',').map((e) => e.trim()) : []

  return { whereClause, values, orderClause, limit, offset, selectClause, expand }
}

module.exports = { parseQuery }
