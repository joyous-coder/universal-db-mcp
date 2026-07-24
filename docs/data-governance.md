# Data Governance (v3.x)

v3.x adds 4 data-governance capabilities on top of v2.20's Multi-Profile v2:

1. **Multi-profile Schema diff** — compare schemas between any two profiles to detect added/removed/modified tables + column changes.
2. **SQL dump backup** — export a profile's database as portable SQL (`CREATE TABLE` + `INSERT`); supports sqlite/mysql/postgresql MVP, schema-only fallback for other adapters.
3. **SQL audit log** — extends v2.17 query_history with `actor` / `clientIp` / `severity` / `audit_metadata_json` columns + `classifySeverity` heuristic.
4. **PII dynamic masking** — column-level config in `pii.config.json`; 5 built-in strategies applied automatically to SELECT results.

## Concepts

- **Profile schema diff** — comparing `nameA` vs `nameB` reuses v2.18's `GlobalSchemaView`. The output classifies tables into `added` (in B), `removed` (in A), `modified` (present in both with column differences), and a `summary` string. When the diff is empty, `identical=true`.
- **SQL dump** — a platform-agnostic text containing `CREATE TABLE` + `INSERT INTO` statements. Page-based row streaming (`LIMIT 100 OFFSET n`) avoids loading large tables into memory. Output `kind` is one of `full` / `schema-only` / `unsupported`. Other types (oracle/mongodb/etc.) return `unsupported` with a structured warning.
- **Audit metadata** — `actor` identifies the caller (MCP `agent-id` or HTTP API key id); `clientIp` records the source IP; `severity` is auto-derived (`'read' | 'write' | 'ddl'`) from a small SQL keyword heuristic; `audit_metadata_json` is an arbitrary JSON blob (request id, policy tags).
- **PII strategy** — `'mask'` (`***`), `'mask_last4'` (`******1234`), `'hash'` (sha256 hex[0:16] deterministic for joins), `'redact'` (`REDACTED`), `'passthrough'` (off-switch for one column).

## 4 capabilities

### 1. Schema diff

**MCP**: `compare_profile_schemas({ nameA, nameB })`
**HTTP**: `GET /api/profiles/:nameA/compare/:nameB`

```json
{
  "added": [{ "table": "audit_log", "in": "B", "columns": [...] }],
  "removed": [],
  "modified": [{ "table": "users", "columnsAdded": [], "columnsRemoved": ["legacy_col"], "columnsChanged": [] }],
  "identical": false,
  "summary": "compared prod vs staging: 1 added, 0 removed, 1 modified tables"
}
```

### 2. SQL dump backup

**MCP**: `export_backup({ profileName, schemaOnly?, tables? })`
**HTTP**: `POST /api/profiles/:name/backup`

```json
{
  "content": "-- BackupWriter dump of profile: prod (sqlite)\n-- Generated: 2026-07-24T...\n-- Tables: 5\n\n-- ----- table: users -----\nCREATE TABLE users (...);\n\nINSERT INTO users (...) VALUES (1, 'alice'), (2, 'bob');\n...",
  "bytes": 14823,
  "tables": ["users", "orders", "products", "audit_log", "..."],
  "kind": "full",
  "warnings": null
}
```

Restore: write the content to a new sqlite file (the dump is portable). For mysql/pg, restore via `psql` / `mysql` shell.

### 3. SQL audit log

When `DB_AUDIT_MODE_ENABLED=true`, every `executeQuery` records audit metadata alongside the standard history row.

**MCP**: `audit_log({ profileName?, actor?, severity?, since?, until?, limit? })`
**HTTP**: `GET /api/audit-log` (filters: `profileName`, `actor`, `severity`, `since`, `until`, `limit`)

```json
{
  "entries": [
    {
      "id": 142,
      "ts": "2026-07-24T15:30:12Z",
      "db": "mysql",
      "kind": "select",
      "sql": "SELECT * FROM users WHERE id = 1",
      "actor": "mcp:claude-desktop",
      "client_ip": null,
      "severity": "read",
      "audit_metadata_json": "{\"requestId\":\"abc-123\"}",
      "duration_ms": 12,
      "profile_name": "prod-mysql",
      ...
    }
  ]
}
```

Retention: rows older than `DB_AUDIT_RETENTION_DAYS` (default 365) are pruned on each query via a low-overhead LRU sweep.

### 4. PII dynamic masking

`pii.config.json`:
```json
{
  "profiles": {
    "prod-mysql": [
      { "table": "users", "column": "email", "strategy": "hash" },
      { "table": "users", "column": "phone", "strategy": "mask_last4" },
      { "table": "users", "column": "ssn",  "strategy": "redact" }
    ],
    "staging": []
  }
}
```

Loaded at startup from `DB_PII_CONFIG_PATH` (default `${cwd}/pii.config.json`). Runtime updates via:

- **MCP**: `set_pii_config({ profileName, columns, replace? })`
- **HTTP**: `PUT /api/profiles/:name/pii`

Applied at SELECT results only — writes are untouched. Original values stay in DB; only the LLM-facing result rows are masked.

## Configuration

| Env var | Default | Effect |
|---|---|---|
| `DB_AUDIT_MODE_ENABLED` | `false` | When true, audit metadata is recorded on every executeQuery |
| `DB_AUDIT_RETENTION_DAYS` | `365` | Rows older than N days are pruned |
| `DB_PII_CONFIG_PATH` | `${cwd}/pii.config.json` | PII rule config file path |

## Backward compatibility

- v2.14 → v2.20 callers see no behavior change unless they opt into the 3 new env vars or a `pii.config.json` exists.
- Old `history.db` files are auto-migrated: 4 new columns (`actor` / `client_ip` / `severity` / `audit_metadata_json`) + 3 indexes are added via `ALTER TABLE`.
- `pii.config.json` is optional; if absent, PiiMasker is a no-op.

## Security

- **Audit log** records actor + IP for compliance traceability; row contents not redacted (use PiiMasker for output-side).
- **PiiMasker.hash** is deterministic within a session — that means hashing the same input twice produces the same masked output. Useful for joins but **must not be relied upon for secrecy**. Use `'redact'` for sensitive values, `'hash'` only when joins across rows matter.
- **BackupWriter.dump** does not encrypt the output. For at-rest protection, write to a directory on an encrypted volume or pipe through `gpg`.

## Zero dependencies

Reuses existing adapters (sqlite/mysql/pg), v2.17 HistoryStore, v2.18 GlobalSchemaView, v2.20 multi-backend SQLite. No new npm packages.

## See also

- [Multi-Profile docs](multi-profile.md) for v2.18-v2.20 Profile management
- [Deferred Items ledger](deferred-items.md) for the full deferral history
