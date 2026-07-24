---
name: db-connect
description: Use when the user needs to connect to a database, query data, analyze schemas, run SQL, manage multi-database profiles, lint SQL, inspect query history, audit access, dump/recover backups, manage PII masking, or compare query plans. Covers all capabilities of universal-db-mcp. Auto-detects DB connection info from project config when configuring the MCP server.
---

# db-connect (universal-db-mcp)

Comprehensive skill for the `@joyous-coder/universal-db-mcp` MCP server (~485 tests passing).

## When to use this skill

Triggers (ANY of):

- User mentions **database, query, SQL, schema, table, run a query**
- User asks to **connect to, inspect, or analyze** a database
- User wants to **count rows, fetch data, dump, or back up**
- User asks about **multi-DB management, profile routing, or SQL audit**
- User wants to **lint SQL, view query history, or get EXPLAIN plans**
- User asks about **PII masking, schema diff, or index advice**
- MCP server is configured AND user asks for any of the above

**Auto-configure triggers** (use to set up the server itself):

- User says "I need to connect to a database" but no MCP server is reachable
- Project has a `.env`, `docker-compose.yml`, or config file with DB credentials
- User mentions a specific DB (mysql / postgres / oracle / dameng / mongodb / ...) and wants to query it

## What's in the box

| Capability | MCP tools | HTTP endpoints |
|---|---|---|
| Single-DB connect / execute / list / schema | `connect_database`, `execute_query`, `list_tables`, `get_schema` | `/api/connect`, `/api/query`, `/api/tables`, `/api/schema` |
| Observability (Prometheus metrics, slow query ring) | `get_metrics` | `GET /metrics`, `GET /api/health` |
| Query experience (Explain, Lint, History, Templates) | `explain_query`, `lint_sql`, `get_query_history`, `save_template`, `list_templates`, `get_template`, `delete_template`, `execute_template` | `/api/lint`, `/api/explain`, `/api/query-history`, `/api/templates` (CRUD + execute) |
| Multi-database profiles | `save_profile`, `list_profiles`, `get_profile`, `delete_profile`, `use_profile`, `list_live_profiles`, `get_global_schema` | `/api/profiles` (CRUD), `/api/profiles/:name/connect`, `/api/profiles/:name/execute`, `/api/global-schema` |
| Multi-profile (encryption + cross-profile) | Same as multi-DB + `profileName` filter on templates / history + `groupBy: 'profile'` aggregate | mirror + `profileName` query param |
| Profile Hardening (YAML export/import, Key rotation, History FTS5) | `export_profiles`, `import_profiles` (YAML/JSON); `rotateKey` is internal; `history.query` accepts `q` for FTS5 | mirror |
| Data Governance (Schema diff / Backup / Audit / PII) | `compare_profile_schemas`, `export_backup`, `audit_log`, `get_pii_config`, `set_pii_config` | `/api/profiles/:a/compare/:b`, `/api/profiles/:name/backup`, `/api/audit-log`, `/api/profiles/:name/pii` |
| Index Advisor + Plan Diff + Plan History | `explain_query_with_advice`, `compare_query_plans`, `list_query_plans` | `/api/query-explain-advice`, `/api/query-plan-diff`, `/api/query-plans` |

## Adapter coverage

17 database adapters. Read/write semantics differ — see `docs/data-governance.md` and `docs/multi-profile.md` for details.

`sqlite` `mysql` `postgresql` `mongodb` — native SQL/aggregation pipelines.
`oracle` `dameng` `kingbase` `kingbasees` `gaussdb` `opengauss` `oceanbase` `tidb` `polardb` `vastbase` `highgo` `goldendb` `mssql` `clickhouse` — dialect variants; `BackupWriter` returns `schema-only` for some; `PlanDiff` treats as text compare.
`redis` — kv adapter; plan tools return `unsupported`; PII masking N/A.

---

# Tool reference

Each entry: **purpose · key params · example** (response shape elided unless required).
For HTTP equivalents, see "HTTP endpoints" below.

## Connection & Query

### `connect_database`
- **Purpose**: open a connection to a database by type + config.
- **Params**: `{ type, host?, port?, user?, password?, database?, filePath?, allowWrite?, oracleClientPath? }`
- **Returns**: `{ sessionId, databaseType, connected }`
- **Note**: `connect_database` keeps a `sessionId` for compatibility. For multi-DB work, prefer `use_profile`.

### `execute_query`
- **Purpose**: run a SQL query.
- **Params**: `{ sessionId, query, params? }`
- **Returns**: `{ rows, duration_ms, lint?, profile_name? }`
- SELECT results are run through `PiiMasker.mask` (writes untouched).

### `execute_template`
- **Params**: `{ id, params: Record<string, unknown> }` — runs the named template via the registered adapter; increments `use_count`.

### `use_profile`
- **Purpose**: switch the active connection; subsequent tools route through it. History rows are tagged with `profile_name`.

### `list_tables` / `get_schema`
- `list_tables`: `{ sessionId }` → `{ tables: string[] }`. For cross-profile use `get_global_schema`.
- `get_schema`: `{ sessionId, tableName? }` → full schema or one table.

## Observability

### `get_metrics`
- **Purpose**: read the in-process metrics registry (Prometheus-shaped JSON).
- **Returns**: `{ counters, histograms, gauges, rings }`.
- Same data is also exposed as `GET /metrics` (Prometheus exposition format).

## Query analysis & history

### `explain_query`
- **Params**: `{ sql, params? }` → `{ db, sql, plan: ExplainRow[], raw, format, duration_ms }`
- `format` depends on adapter (`text` for sqlite/mysql/pg; `json` if available).

### `lint_sql`
- **Params**: `{ sql }` → `{ issues: LintIssue[], hasErrors, hasWarnings }`
- **Advisory only**; never blocks execution.

### `get_query_history`
- Profile filter: `profileName` is 3-state (`null` = global-only, `'name'` = local-only, omitted = all).
- `groupBy: 'profile'` returns `{ profileName, count, errors, avg_ms }[]` aggregates.
- `q` is an FTS5 MATCH expression (`SELECT ORDERS` / `"FROM orders"` / `orders*`).
- Other: `db`, `kind`, `since`, `until`, `onlyErrors`, `limit`.

### Templates (5 tools)

| Tool | Purpose |
|---|---|
| `save_template` | persist parameterized SQL template (`${param}` placeholders) — params include `profile_name` for local templates |
| `list_templates` | filter by `tag`, `profileName` (3-state) |
| `get_template` | fetch one |
| `delete_template` | remove one |
| `execute_template` | run one with `params: Record<string, unknown>`; increments `use_count` |

## Profile management (multi-DB)

### CRUD
`save_profile` / `list_profiles` / `get_profile` / `delete_profile` — operate on `profiles.db`.
- Profile fields: `name`, `description`, `type`, `config`, `role` (`'primary' | 'replica' | 'analytics'`), `tags`, `enabled`.
- `config` shape depends on `type` (e.g. `{ host, port, user, password, database }` for mysql/pg).

### `use_profile`
- Switch active connection; subsequent tools route through it.

### `list_live_profiles`
- Currently connected profile names + adapter handles (introspection; LRU-managed; max `DB_PROFILES_MAX`).

### `get_global_schema`
- Parallel-fetch + merged schema across all enabled profiles.

### Profile Hardening

| Tool | Purpose |
|---|---|
| `export_profiles` | YAML/JSON dump with **passwords REDACTED by default**; `--include-secrets` flag for plaintext |
| `import_profiles` | YAML/JSON load; modes `merge` (default, idempotent) / `replace` (wipe + load); supports `dryRun` preview |
| `rotateKey` | internal; atomic single-DB re-encrypt via temp file + rename; supported via env `DB_PROFILE_ENCRYPTION_KEY_OLD` → `DB_PROFILE_ENCRYPTION_KEY` |

## Data Governance

### `compare_profile_schemas`
- **Params**: `{ nameA, nameB }` → `{ added, removed, modified, identical, summary }`
- `added` = tables in B not in A; `removed` = in A not in B; `modified` = column-level diff.
- Reuses `GlobalSchemaView` (v2.18) for parallel schema fetch.

### `export_backup`
- **Params**: `{ profileName, schemaOnly?, tables? }` → `{ content, bytes, tables, kind, warnings? }`
- `kind`: `'full'` | `'schema-only'` | `'unsupported'`
- MVP: SQLite / MySQL / PostgreSQL have full dumps; others emit `schema-only` (`CREATE TABLE` only) with `warnings` array.
- Streaming via `LIMIT 100 OFFSET n` — large DBs safe; recommend writing to `outputPath`.

### `audit_log`
- **Params**: `{ profileName?, actor?, severity?, since?, until?, limit? }`
- Records only when `DB_AUDIT_MODE_ENABLED=true`.
- `severity` auto-classified (`'read' | 'write' | 'ddl'`); retention by `DB_AUDIT_RETENTION_DAYS` (default 365).
- `actor` is the MCP `agent-id` or HTTP API-key id.

### `get_pii_config` / `set_pii_config`
- `set_pii_config`: `{ profileName, columns: PiiColumnConfig[], replace? }`
- `columns`: array of `{ table, column, strategy }`; strategies `'mask' | 'mask_last4' | 'hash' | 'redact' | 'passthrough'`
- Static config loaded at startup from `DB_PII_CONFIG_PATH` (default `${cwd}/pii.config.json`).
- **Applies only to SELECT results**, never to writes.

### PiiMasker strategies

| Strategy | Effect | Use case |
|---|---|---|
| `mask` | replace with `'***'` | quick hide |
| `mask_last4` | keep last 4 chars (`******1234`) | phone-style values |
| `hash` | `sha256` hex[0:16] (deterministic, joinable) | emails-like join keys |
| `redact` | replace with `'REDACTED'` | high-stakes secret |
| `passthrough` | no change | opt-out for one column |

## Index Advisor + Plan History

### `explain_query_with_advice`
- **Params**: `{ sql, profileName?, persist? }` → `{ explain, advice, captured }`
- `advice` is an array of `IndexAdvice` (`sql: CREATE INDEX ...`, `table`, `columns`, `impact: 'low'|'medium'|'high'`, `reason`).
- `persist: true` writes snapshot to `plan_history.db`.
- 17-adapter coverage: sqlite/mysql/pg/mongodb native parsing; oracle/dameng/etc. → raw passthrough; redis → `unsupported`.

### `IndexAdvisor` reasons

| Reason | Trigger |
|---|---|
| `seq_scan` | full scan node, rows ≥ 1 |
| `large_estimate` | full scan node, rows ≥ 5000 |
| `no_index_join` | nested-loop join with inner side missing `index` |
| `sort_no_index` | SORT step on a table without covering index |

### `compare_query_plans`
- **Params**: `{ queryHash, entryA?, entryB? }` → `{ from, to, diff }` where `diff` carries `added/removed/changed`, `costDelta`, `rowsDelta`.
- Defaults to oldest-vs-newest when ≥2 snapshots with same `queryHash` exist.

### `list_query_plans`
- **Params**: `{ limit?, queryHash? }` → recent snapshots, optionally filtered by `queryHash`.

---

# HTTP endpoints (mirror, for non-MCP clients)

| Method | Path | Body / Query | Tool mirror |
|---|---|---|---|
| POST | `/api/connect` | `{ type, host?, port?, ... }` | `connect_database` |
| POST | `/api/query` | `{ sessionId, query, params? }` | `execute_query` |
| POST | `/api/lint` | `{ sql }` | `lint_sql` |
| POST | `/api/explain` | `{ sql, params? }` | `explain_query` |
| GET | `/api/query-history` | `?db=&kind=&since=&until=&onlyErrors=&limit=&profileName=&groupBy=&q=` | `get_query_history` |
| GET | `/api/templates` | `?tag=&profileName=` | `list_templates` |
| POST | `/api/templates` | `{ name, description, sql, parameters, tags?, profile_name? }` | `save_template` |
| GET / DELETE / POST | `/api/templates/:id` or `/api/templates/:id/execute` | (id + body) | `get_template` / `delete_template` / `execute_template` |
| GET / POST / DELETE | `/api/profiles` / `/api/profiles/:name` | (profile shape) | `save_profile` / `list_profiles` / `get_profile` / `delete_profile` |
| POST | `/api/profiles/:name/connect` | — | `use_profile` |
| POST | `/api/profiles/:name/execute` | `{ sql, kind, params? }` | (router) |
| GET | `/api/global-schema` | — | `get_global_schema` |
| GET | `/api/profiles/:a/compare/:b` | — | `compare_profile_schemas` |
| POST | `/api/profiles/:name/backup` | `{ schemaOnly?, tables? }` | `export_backup` |
| GET | `/api/audit-log` | `?profileName=&actor=&severity=&since=&until=&limit=` | `audit_log` |
| GET / PUT | `/api/profiles/:name/pii` | (pii shape) | `get_pii_config` / `set_pii_config` |
| POST | `/api/query-explain-advice` | `{ sql, persist? }` | `explain_query_with_advice` |
| POST | `/api/query-plan-diff` | `{ queryHash, entryA?, entryB? }` | `compare_query_plans` |
| GET | `/api/query-plans` | `?limit=&queryHash=` | `list_query_plans` |
| GET | `/metrics` | — | `get_metrics` (Prometheus format) |
| GET | `/api/health` | — | (expanded health snapshot) |

---

# Common recipes

### 1. Connect to MySQL and run a query
```
connect_database({ type: 'mysql', host: '10.0.0.1', port: 3306, user: 'app', password: '...', database: 'orders' })
→ sessionId
execute_query({ sessionId, query: 'SELECT * FROM t LIMIT 5' })
→ rows
```

### 2. Multi-DB setup
```
save_profile({ name: 'prod-mysql', type: 'mysql', config: { host, port, user, password, database }, role: 'primary' })
use_profile({ name: 'prod-mysql' })
execute_query({ query: '...' })        // SELECT PII columns ARE masked if PII config exists
```

### 3. Compare staging vs prod schema
```
compare_profile_schemas({ nameA: 'prod-mysql', nameB: 'staging' })
→ { added, removed, modified, identical, summary }
```

### 4. Backup a profile
```
export_backup({ profileName: 'prod-mysql' })
→ { content: 'CREATE TABLE ...\nINSERT INTO ...\n...', kind: 'full' }
# Restore: pipe content to mysql/psql client.
```

### 5. Audit log filtering
```
# env: DB_AUDIT_MODE_ENABLED=true DB_AUDIT_RETENTION_DAYS=365
execute_query({ query: 'DROP TABLE temp' })
audit_log({ severity: 'ddl', actor: 'claude-desktop' })
→ returns all DDL operations in last 24h by this actor
```

### 6. Get index advice
```
explain_query_with_advice({ sql: 'SELECT * FROM users WHERE email = ?', persist: true })
→ {
  explain: { plan, ... },
  advice: [{ sql: 'CREATE INDEX idx_users_email ON users (email);', impact: 'medium', reason: 'seq_scan', ... }],
  captured: true,
}
list_query_plans({ queryHash: '<auto-hash>' })
```

### 7. Compare plan before/after a query change
```
# (after two captures with persist:true on the same query text)
compare_query_plans({ queryHash: 'abc123' })
→ { from: { id, capturedAt }, to: { id, capturedAt }, diff: { costDelta, rowsDelta, changed } }
```

### 8. Cross-profile template + history
```
save_template({ name: 'list-orders', sql: 'SELECT * FROM orders WHERE id = ${id}', parameters: [...], profile_name: 'prod-mysql' })
list_templates({ profileName: 'prod-mysql' })   # only local
list_templates({ profileName: null })           # only global
list_templates()                                 # all
get_query_history({ profileName: 'prod-mysql', q: 'SELECT orders', onlyErrors: false })
```

### 9. Rotate cipher key
```
# env: DB_PROFILE_ENCRYPTION_KEY_OLD=<old> DB_PROFILE_ENCRYPTION_KEY=<new>
# On startup, server migrates profiles.db atomically. After success → unset DB_PROFILE_ENCRYPTION_KEY_OLD.
# Programmatic: profileStore.rotateKey(newKey).
```

### 10. PII masking config

`pii.config.json`:
```json
{
  "profiles": {
    "prod-mysql": [
      { "table": "users",     "column": "email", "strategy": "hash" },
      { "table": "users",     "column": "phone", "strategy": "mask_last4" },
      { "table": "credit_cards", "column": "pan", "strategy": "redact" }
    ]
  }
}
```
SELECT results auto-mask the configured columns. INSERT/UPDATE untouched.

---

# Configuration (env vars)

| Env | Default | Effect |
|---|---|---|
| `DB_TYPE` etc. | — | `connect_database` config (single-DB mode) |
| `DB_QUERY_TIMEOUT_MS` | 30000 | per-query timeout |
| `DB_SLOW_QUERY_THRESHOLD_MS` | 5000 | slow-query ring slot |
| `DB_METRICS_ENABLED` | true | observability master switch |
| `DB_METRICS_IP_ALLOWLIST` | `''` | comma-separated CIDR allowlist for `/metrics` |
| `DB_METRICS_SLOW_BUFFER_SIZE` | 100 | slow query ring capacity |
| `DB_QUERY_ANALYZER_ENABLED` | true | master switch for query analyzer |
| `DB_TEMPLATES_DB_PATH` | `${cwd}/.db-mcp/templates.db` | templates storage |
| `DB_HISTORY_DB_PATH` | `${cwd}/.db-mcp/history.db` | history storage |
| `DB_HISTORY_TTL_DAYS` | 30 | retention for query history |
| `DB_HISTORY_MAX_ROWS` | 10000 | LRU cap on history rows |
| `DB_EXPLAIN_TIMEOUT_MS` | 10000 | explain timeout |
| `DB_MULTI_DB_ENABLED` | true | multi-DB master switch |
| `DB_PROFILES_DB_PATH` | `${cwd}/.db-mcp/profiles.db` | profiles storage |
| `DB_PROFILES_MAX` | 50 | hard cap + LRU for live connections |
| `DB_DEFAULT_PROFILE_ROLE` | `'primary'` | default role for `save_profile` |
| `DB_READ_ROUTING` | `'round-robin'` | `'round-robin' \| 'random' \| 'least-loaded'` |
| `DB_PROFILE_ENCRYPTION_KEY` | `''` | profiles.db SQLCipher (≥32 chars) |
| `DB_PROFILE_ENCRYPTION_KEY_OLD` | `''` | rotation old key |
| `DB_TEMPLATES_DB_KEY` | `''` | templates.db SQLCipher |
| `DB_TEMPLATES_DB_KEY_OLD` | `''` | templates rotation old key |
| `DB_HISTORY_DB_KEY` | `''` | history.db SQLCipher |
| `DB_HISTORY_DB_KEY_OLD` | `''` | history rotation old key |
| `DB_AUDIT_MODE_ENABLED` | `false` | audit log master switch |
| `DB_AUDIT_RETENTION_DAYS` | `365` | audit row retention |
| `DB_PII_CONFIG_PATH` | `${cwd}/pii.config.json` | PII config file |
| `DB_PLAN_HISTORY_DB_PATH` | `${cwd}/.db-mcp/plan_history.db` | plan snapshot store |

Optional dep for SQLCipher: `npm install better-sqlite3-multiple-ciphers` (install only when any `*_KEY` env is set).

---

# Self-check (when NOT to use this skill)

- The user is asking about **a specific adapter file** like `src/adapters/mysql/index.ts` — fall back to general code search/read.
- The user wants to **add a new DB adapter** — fall back to `docs/superpowers/specs/` + existing adapter code (`src/adapters/sqlite/index.ts` is the simplest).
- The user wants to **modify MCP server config** in `.mcp.json` — fall back to settings.local.json review.
- The user wants to **debug the server itself** (not query via it) — open tail logs, do not load this skill.

---

# Auto-configure: server is not reachable

If the MCP server is not configured when this skill loads, attempt auto-detection:

1. **Read project config files** (in order):
   - `.env`, `.env.local`, `.env.example`
   - `docker-compose.yml`, `docker-compose.yaml`
   - `application.yml`, `application.yaml`, `application.properties`
   - `config/database.yml`
   - `.mcp.json` at project root

2. **Match detection patterns**:
   - `MYSQL_*` / `DATABASE_URL=mysql://...` → mysql
   - `POSTGRES_*` / `POSTGRESQL_*` / `DATABASE_URL=postgres://...` → postgresql
   - `MONGODB_URI` / `MONGO_*` → mongodb
   - `REDIS_URL` → redis
   - `ORACLE_*` / `TNS_*` → oracle
   - `DM_*` / `DAMENG_*` → dameng
   - `KINGBASE_*` → kingbase
   - `CLICKHOUSE_*` → clickhouse
   - `SQLITE_PATH` / `*.sqlite` / `*.db` reference → sqlite

3. **Generate MCP config**: write to `<project_root>/.mcp.json`:

```json
{
  "mcpServers": {
    "universal-db-mcp": {
      "command": "npx",
      "args": ["@joyous-coder/universal-db-mcp"],
      "env": {
        "DB_TYPE": "mysql",
        "DB_HOST": "...",
        "DB_PORT": "3306",
        "DB_USER": "...",
        "DB_PASSWORD": "...",
        "DB_DATABASE": "..."
      }
    }
  }
}
```

4. **Verify**: run `npx @joyous-coder/universal-db-mcp --help` or check `.mcp.json` syntax.

5. **Always ask the user** before writing credentials — never assume.

---

# Quick MCP-tool ↔ capability lookup (cheat sheet)

**Connection / Query**
- `connect_database`, `execute_query`, `use_profile`, `execute_template`

**Schema / Structure**
- `list_tables`, `get_schema`, `get_global_schema`, `compare_profile_schemas`

**Query analysis / Lint**
- `explain_query`, `lint_sql`, `explain_query_with_advice`

**History / Audit**
- `get_query_history`, `audit_log`

**Templates**
- `save_template`, `list_templates`, `get_template`, `delete_template`, `execute_template`

**Profiles**
- `save_profile`, `list_profiles`, `get_profile`, `delete_profile`, `use_profile`, `list_live_profiles`, `export_profiles`, `import_profiles`

**Observability**
- `get_metrics` (Prometheus-shaped JSON)

**Data Governance**
- `compare_profile_schemas`, `export_backup`, `audit_log`, `get_pii_config`, `set_pii_config`

**Index Advisor + Plan History**
- `explain_query_with_advice`, `compare_query_plans`, `list_query_plans`
