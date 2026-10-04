const http = require('http')
const { readFileSync, existsSync } = require('fs')
const { join, extname } = require('path')
const { requireAdmin, isAdmin } = require('./src/auth')
const { verifyLmuToken, ownerKey } = require('./src/lmu')
const collections = require('./src/collections')
const records = require('./src/records')

const PORT = process.env.PORT || 4021
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*'

function parseBody(req) {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      try { resolve(JSON.parse(body)) } catch { resolve({}) }
    })
  })
}

function parseUrl(url) {
  const [path, qs] = url.split('?')
  const params = {}
  if (qs) {
    for (const pair of qs.split('&')) {
      const [k, v] = pair.split('=').map(decodeURIComponent)
      params[k] = v
    }
  }
  return { path: path.replace(/\/+$/, '') || '/', params }
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': CORS_ORIGIN })
  res.end(JSON.stringify(data))
}

function cors(res) {
  res.writeHead(204, {
    'access-control-allow-origin': CORS_ORIGIN,
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-max-age': '86400',
  })
  res.end()
}

function serveStatic(res, filePath) {
  const mimes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' }
  const ext = extname(filePath)
  const mime = mimes[ext] || 'application/octet-stream'
  try {
    const content = readFileSync(filePath)
    res.writeHead(200, { 'content-type': mime })
    res.end(content)
  } catch {
    res.writeHead(404)
    res.end('Not found')
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return cors(res)

  const { path, params } = parseUrl(req.url)
  const method = req.method

  try {
    // Health
    if (path === '/api/health') {
      return json(res, { status: 'ok', service: 'selfize' })
    }

    // --- Collection admin API ---
    if (path === '/api/collections' && method === 'GET') {
      const authErr = requireAdmin(req)
      if (authErr) return json(res, authErr, authErr.code)
      return json(res, { collections: collections.listCollections() })
    }

    if (path === '/api/collections' && method === 'POST') {
      const authErr = requireAdmin(req)
      if (authErr) return json(res, authErr, authErr.code)
      const body = await parseBody(req)
      const result = collections.createCollection(body.name, body.schema || body.fields || [], body.rules)
      return json(res, result, 201)
    }

    const colMatch = path.match(/^\/api\/collections\/([a-z][a-z0-9_]*)$/)
    if (colMatch && !path.includes('/records')) {
      const name = colMatch[1]
      if (method === 'GET') {
        const authErr = requireAdmin(req)
        if (authErr) return json(res, authErr, authErr.code)
        const col = collections.getCollection(name)
        if (!col) return json(res, { error: 'Not found' }, 404)
        return json(res, col)
      }
      if (method === 'PATCH' || method === 'PUT') {
        const authErr = requireAdmin(req)
        if (authErr) return json(res, authErr, authErr.code)
        const body = await parseBody(req)
        const result = collections.updateCollection(name, body)
        return json(res, result)
      }
      if (method === 'DELETE') {
        const authErr = requireAdmin(req)
        if (authErr) return json(res, authErr, authErr.code)
        const result = collections.deleteCollection(name)
        return json(res, result)
      }
    }

    // --- Records API ---
    const recordsMatch = path.match(/^\/api\/collections\/([a-z][a-z0-9_]*)\/records(?:\/(.+))?$/)
    if (recordsMatch) {
      const colName = recordsMatch[1]
      const recordId = recordsMatch[2]
      const col = collections.getCollection(colName)
      if (!col) return json(res, { error: `Collection "${colName}" not found` }, 404)

      const rules = col.rules || {}

      // rules 值 'user'：需要有效 LetMeUse token，只能碰自己的資料（admin 不受限）
      const admin = isAdmin(req)
      let lmu = null
      if (Object.values(rules).includes('user') && !admin) lmu = await verifyLmuToken(req)
      const ownerFor = (ruleVal) => {
        if (ruleVal !== 'user' || admin) return undefined
        if (!lmu) throw Object.assign(new Error('Login required'), { status: 401 })
        return ownerKey(lmu)
      }

      if (!recordId) {
        if (method === 'GET') {
          if (rules.read === 'admin') {
            const authErr = requireAdmin(req)
            if (authErr) return json(res, authErr, authErr.code)
          }
          const result = records.listRecords(colName, params, ownerFor(rules.read))
          return json(res, result)
        }
        if (method === 'POST') {
          if (rules.create === 'admin') {
            const authErr = requireAdmin(req)
            if (authErr) return json(res, authErr, authErr.code)
          }
          const body = await parseBody(req)
          const createOwner = ownerFor(rules.create)
          if (createOwner) body._owner = createOwner
          const result = records.createRecord(colName, body)
          return json(res, result, 201)
        }
      } else {
        if (method === 'GET') {
          if (rules.read === 'admin') {
            const authErr = requireAdmin(req)
            if (authErr) return json(res, authErr, authErr.code)
          }
          const result = records.getRecord(colName, recordId, params, ownerFor(rules.read))
          return json(res, result)
        }
        if (method === 'PATCH' || method === 'PUT') {
          if (rules.update === 'admin') {
            const authErr = requireAdmin(req)
            if (authErr) return json(res, authErr, authErr.code)
          }
          const body = await parseBody(req)
          const result = records.updateRecord(colName, recordId, body, ownerFor(rules.update))
          return json(res, result)
        }
        if (method === 'DELETE') {
          if (rules.delete === 'admin') {
            const authErr = requireAdmin(req)
            if (authErr) return json(res, authErr, authErr.code)
          }
          const result = records.deleteRecord(colName, recordId, ownerFor(rules.delete))
          return json(res, result)
        }
      }
    }

    // --- Admin UI ---
    if (path === '/' || path === '/admin') {
      return serveStatic(res, join(__dirname, 'public', 'index.html'))
    }

    const staticFile = join(__dirname, 'public', path)
    if (existsSync(staticFile)) {
      return serveStatic(res, staticFile)
    }

    json(res, { error: 'Not found' }, 404)
  } catch (err) {
    const status = err.status || 500
    json(res, { error: err.message }, status)
  }
})

server.listen(PORT, () => {
  console.log(`Selfize running on :${PORT}`)
})
