# Selfize

Self-hosted SQLite REST API with dynamic collections — like PocketBase, but plain Node.js.

Define collections via JSON schema → get instant auto-CRUD REST endpoints. No migrations, no ORM, no external database.

## Stack
- **Runtime**: Node.js, raw `http` module (zero web framework)
- **Language**: JavaScript (CommonJS, `require`/`module.exports`)
- **Database**: SQLite via `better-sqlite3` (WAL mode, `foreign_keys = ON`)
- **IDs**: UUIDv4 via `uuid`
- **Frontend**: Vanilla JS single-page admin UI (`public/index.html`)
- Only two runtime dependencies.

## Directory structure

```
selfize/
  server.js          ← HTTP server: routing, CORS, body/URL parsing, static files, error handling
  src/
    auth.js          ← Bearer-token admin auth (SELFIZE_TOKEN); requireAdmin / isAdmin
    collections.js   ← Collection CRUD + schema management (ALTER TABLE to add fields)
    db.js            ← SQLite init, _collections table, type map, create/drop collection tables
    query.js         ← Query-string parsing: filters, operators, sort, pagination
    records.js       ← Record CRUD + validation + relation expansion
  public/index.html  ← Dark-themed admin dashboard SPA
  data/selfize.db    ← SQLite file (auto-created; back this up to back up everything)
```

## Key concepts

- **Entry**: `server.js` → `http.createServer`, routes by regex on path + method, listens on `PORT` (default 4021).
- **Dynamic collections**: Metadata lives in the `_collections` table (`name`, `schema` JSON, `rules` JSON). Each collection is a real SQLite table created at runtime. Collection names must be lowercase alphanumeric + underscore, not starting with `_`.
- **Auto fields**: Every record gets `id` (UUID), `created_at`, `updated_at` automatically.
- **Field types** (`db.js` TYPE_MAP): `text`→TEXT, `number`→REAL, `integer`→INTEGER, `boolean`→INTEGER (0/1, returned bool), `json`→TEXT (auto serialize/deserialize), `date`→TEXT (ISO 8601). Field options: `required`, `default`, `ref`.
- **Access rules** (per collection, per op `read`/`create`/`update`/`delete`): `"public"` = no auth, `"admin"` = requires `Authorization: Bearer <token>`. Collection admin API always requires admin; record endpoints honor the collection's rules.
- **Query API** (`query.js`): filter `?field=value` (exact) or `?field=op.value` with ops `eq/neq/gt/gte/lt/lte/like`; `sort` (`-` prefix = DESC); `limit`/`offset`/`page`/`perPage` (max 500); `select` for field projection; `expand` to inline `ref` relations (returns `<field>_expanded`).
- **Schema updates**: `PATCH /api/collections/:name` adds new fields via `ALTER TABLE` (additive only).

## API surface

- `GET /api/health`
- `GET|POST /api/collections`, `GET|PATCH|DELETE /api/collections/:name` (admin)
- `GET|POST /api/collections/:name/records`, `GET|PATCH|DELETE /api/collections/:name/records/:id` (per-rule auth)
- `GET /` or `/admin` → admin dashboard; other paths served as static from `public/`

## Commands

| Command | Description |
|---|---|
| `npm install` | Install dependencies |
| `npm start` | Run server (`node server.js`) |
| `npm run dev` | Run with auto-restart (`node --watch server.js`) |

No build or test scripts are defined.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4021` | Server port |
| `SELFIZE_TOKEN` | `selfize-dev-token` | Admin API bearer token |
| `CORS_ORIGIN` | `*` | Allowed CORS origin |

## Coding rules

- Plain CommonJS modules; small focused files under `src/`, one concern each.
- No web framework — handle routing/parsing/CORS manually in `server.js`.
- Wrap handler logic in try/catch; throw errors with a `.status` for HTTP codes, default 500.
- Quote SQL identifiers (`"name"`); rely on prepared statements / parameter binding for values.
- Validate collection names against the lowercase-underscore pattern before use.
