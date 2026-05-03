# Selfize

Self-hosted SQLite REST API with dynamic collections. Inspired by [PocketBase](https://pocketbase.io), built with Node.js.

Define collections with JSON schemas, get instant CRUD endpoints — no migrations, no ORM, no external database.

## Features

- **Dynamic Collections** — Create, update, and delete collections at runtime via API
- **Auto CRUD** — Every collection gets full REST endpoints automatically
- **Filtering & Sorting** — Query with operators (`eq`, `gt`, `lt`, `like`, etc.) and multi-field sorting
- **Pagination** — Limit/offset and page-based pagination (max 500 per page)
- **Field Selection** — Return only the fields you need with `?select=id,title`
- **Relation Expansion** — Expand foreign key references inline with `?expand=owner_id`
- **Access Rules** — Per-collection, per-operation access control (`public` or `admin`)
- **Admin Dashboard** — Built-in dark-themed web UI for managing collections and records
- **Zero Config** — Single SQLite file, WAL mode, no setup required

## Quick Start

```bash
git clone https://github.com/Jeffrey0117/Selfize.git
cd Selfize
npm install
npm start
```

Server starts on `http://localhost:4021`. Open it in a browser to access the admin dashboard.

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4021` | Server port |
| `SELFIZE_TOKEN` | `selfize-dev-token` | Admin API token |
| `CORS_ORIGIN` | `*` | Allowed CORS origin |

## API Reference

### Health Check

```
GET /api/health
```

```json
{ "status": "ok", "service": "selfize" }
```

### Collections (Admin)

All collection endpoints require `Authorization: Bearer <token>`.

#### List Collections

```
GET /api/collections
```

```json
{
  "collections": [
    {
      "name": "books",
      "schema": [
        { "name": "title", "type": "text", "required": true },
        { "name": "author", "type": "text" },
        { "name": "tags", "type": "json", "default": "[]" }
      ],
      "rules": { "read": "public", "create": "admin", "update": "admin", "delete": "admin" },
      "created_at": "2026-05-03 09:02:39",
      "updated_at": "2026-05-03 09:02:39"
    }
  ]
}
```

#### Create Collection

```
POST /api/collections
```

```json
{
  "name": "books",
  "schema": [
    { "name": "title", "type": "text", "required": true },
    { "name": "author", "type": "text" },
    { "name": "price", "type": "number" },
    { "name": "tags", "type": "json", "default": "[]" },
    { "name": "owner_id", "type": "text", "ref": "profiles" }
  ],
  "rules": {
    "read": "public",
    "create": "admin",
    "update": "admin",
    "delete": "admin"
  }
}
```

Collection names must be lowercase alphanumeric with underscores, cannot start with `_`.

#### Get Collection

```
GET /api/collections/:name
```

#### Update Collection

```
PATCH /api/collections/:name
```

Supports adding new fields to the schema (columns are added via `ALTER TABLE`).

#### Delete Collection

```
DELETE /api/collections/:name
```

Drops the collection table and removes all records.

### Records

Record endpoints respect the collection's access rules. If a rule is set to `"public"`, no auth is needed. If set to `"admin"`, `Authorization: Bearer <token>` is required.

Every record automatically gets `id` (UUID), `created_at`, and `updated_at` fields.

#### List Records

```
GET /api/collections/:name/records
```

Query parameters:

| Param | Example | Description |
|---|---|---|
| `field=value` | `?status=active` | Exact match filter |
| `field=op.value` | `?age=gt.18` | Operator filter |
| `sort` | `?sort=-created_at,title` | Sort (`-` prefix = DESC) |
| `limit` | `?limit=20` | Results per page (max 500, default 100) |
| `offset` | `?offset=40` | Skip N results |
| `page` | `?page=2` | Page-based pagination |
| `perPage` | `?perPage=25` | Alias for limit |
| `select` | `?select=id,title,author` | Return specific fields only |
| `expand` | `?expand=owner_id` | Expand relation fields |

**Filter operators:**

| Operator | SQL | Example |
|---|---|---|
| `eq` | `=` | `?status=eq.active` |
| `neq` | `!=` | `?status=neq.deleted` |
| `gt` | `>` | `?price=gt.100` |
| `gte` | `>=` | `?price=gte.100` |
| `lt` | `<` | `?price=lt.50` |
| `lte` | `<=` | `?price=lte.50` |
| `like` | `LIKE` | `?title=like.%node%` |

Plain values without an operator prefix use exact match: `?status=active` is equivalent to `?status=eq.active`.

**Response:**

```json
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Clean Code",
      "author": "Robert C. Martin",
      "tags": ["programming", "software"],
      "created_at": "2026-05-03 09:10:00",
      "updated_at": "2026-05-03 09:10:00"
    }
  ],
  "total": 42,
  "limit": 100,
  "offset": 0
}
```

#### Get Record

```
GET /api/collections/:name/records/:id
```

Supports `?expand=field1,field2` for relation expansion.

#### Create Record

```
POST /api/collections/:name/records
```

```json
{
  "title": "Clean Code",
  "author": "Robert C. Martin",
  "tags": ["programming", "software"]
}
```

You can provide a custom `id` or let the server generate a UUID.

#### Update Record

```
PATCH /api/collections/:name/records/:id
```

Partial updates — only send the fields you want to change.

#### Delete Record

```
DELETE /api/collections/:name/records/:id
```

```json
{ "deleted": "550e8400-e29b-41d4-a716-446655440000" }
```

### Relation Expansion

Define a `ref` on a field to create a relation:

```json
{ "name": "owner_id", "type": "text", "ref": "profiles" }
```

Then use `?expand=owner_id` to inline the referenced record:

```json
{
  "id": "book-1",
  "title": "Clean Code",
  "owner_id": "user-1",
  "owner_id_expanded": {
    "id": "user-1",
    "display_name": "Jeff",
    "avatar_url": "https://..."
  }
}
```

Multiple expansions: `?expand=owner_id,category_id`

## Schema Field Types

| Type | SQLite Type | Notes |
|---|---|---|
| `text` | `TEXT` | Default type |
| `number` | `REAL` | Floating point |
| `integer` | `INTEGER` | Whole numbers |
| `boolean` | `INTEGER` | Stored as 0/1, returned as true/false |
| `json` | `TEXT` | Auto-serialized/deserialized |
| `date` | `TEXT` | ISO 8601 string |

### Field Options

```json
{
  "name": "title",
  "type": "text",
  "required": true,
  "default": "Untitled",
  "ref": "other_collection"
}
```

| Option | Description |
|---|---|
| `required` | Reject creates when field is empty/null |
| `default` | Default value for new records |
| `ref` | Collection name for relation expansion |

## Access Rules

Each collection has rules for `read`, `create`, `update`, and `delete`:

```json
{
  "rules": {
    "read": "public",
    "create": "admin",
    "update": "admin",
    "delete": "admin"
  }
}
```

| Value | Behavior |
|---|---|
| `"public"` | No authentication required |
| `"admin"` | Requires valid `Authorization: Bearer <token>` header |

Default is `"public"` for all operations.

## Project Structure

```
selfize/
├── server.js             # HTTP server, routing, CORS, static files
├── src/
│   ├── auth.js           # Token-based admin authentication
│   ├── collections.js    # Collection CRUD + schema management
│   ├── db.js             # SQLite initialization, table creation
│   ├── query.js          # Query parameter parsing (filter/sort/paginate)
│   └── records.js        # Record CRUD + validation + relation expansion
├── public/
│   └── index.html        # Admin dashboard SPA
├── data/
│   └── selfize.db        # SQLite database (auto-created)
└── package.json
```

## Admin Dashboard

Open `http://localhost:4021` in a browser. Enter your admin token to connect.

The dashboard lets you:
- Browse all collections in the sidebar
- Create new collections with JSON schema
- View, create, edit, and delete records in a table view
- Delete collections

## Tech Stack

- **Runtime:** Node.js (zero framework — raw `http` module)
- **Database:** SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (WAL mode, foreign keys)
- **IDs:** UUIDv4 via [uuid](https://github.com/uuidjs/uuid)
- **Frontend:** Vanilla JS single-page admin UI

Two dependencies. That's it.

## Deployment

Selfize runs as a standard Node.js process. Works with PM2, systemd, Docker, or any process manager.

```bash
# Production
SELFIZE_TOKEN=your-secure-token PORT=4021 node server.js

# With PM2
pm2 start server.js --name selfize

# CloudPipe
# Registered as a CloudPipe project, auto-deploys on git push
```

Data is stored in `./data/selfize.db`. Back up this file to back up everything.

## License

MIT
