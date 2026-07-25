# Query Experience (v2.17)

v2.17 adds 4 capabilities for LLM-driven query workflows: Explain Plan, SQL Lint, query history, and parameterized templates.

## 4 Capabilities

### Explain Plan

`POST /api/explain` (or MCP `explain_query`) — runs EXPLAIN on the query and returns both a parsed `plan` array and the raw DB output.

```bash
curl -X POST http://localhost:3000/api/explain \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT * FROM users WHERE email = ?", "params": ["alice@x.com"]}'
```

### SQL Lint

`POST /api/lint` (or MCP `lint_sql`) — pure-rule linter, sync, no IO. 10 rules:

| Rule | Severity |
|---|---|
| `select-star` | warning |
| `no-where-update` | error |
| `no-limit-update` | warning |
| `in-thousand` | warning |
| `leading-wildcard-like` | warning |
| `distinct-without-index-hint` | info |
| `union-vs-union-all` | info |
| `order-by-no-limit` | info |
| `double-quoted-identifier` | warning |

Lint is also automatically returned in the `execute_query` response under the `lint` field (advisory; never blocks execution).

### Query History

`GET /api/query-history` (or MCP `get_query_history`) — SQLite-backed history of all executed queries. Filters: `db`, `kind`, `since`, `until`, `onlyErrors`, `limit`. Default 30-day TTL, 10000-row hard cap.

### Parameterized Templates

`POST /api/templates` (or MCP `save_template`) — save a SQL template with `${param}` placeholders. Then call `execute_template` to fill params and run.

```json
// save
{ "name": "monthly_active", "description": "Monthly active users", "sql": "SELECT count(*) FROM users WHERE created_at > ${start_date}", "parameters": [{"type": "date", "required": true}], "tags": ["report"] }

// execute
{ "id": "abc12345", "params": { "start_date": "2026-07-01" } }
```

5 param types: `string`, `number`, `boolean`, `date`, `sql_identifier` (validated via v2.15.0 `validateIdentifier`).

## Configuration

| Env | Default | Effect |
|---|---|---|
| `DB_QUERY_ANALYZER_ENABLED` | `true` | Disable all 4 capabilities |
| `DB_TEMPLATES_DB_PATH` | `${cwd}/.db-mcp/templates.db` | Template SQLite file |
| `DB_HISTORY_DB_PATH` | `${cwd}/.db-mcp/history.db` | History SQLite file |
| `DB_HISTORY_TTL_DAYS` | `30` | Auto-cleanup threshold |
| `DB_HISTORY_MAX_ROWS` | `10000` | Hard cap (LRU eviction) |
| `DB_EXPLAIN_TIMEOUT_MS` | `10000` | EXPLAIN timeout |

## Team workflow

- Commit `.db-mcp/templates.db` to share templates with your team
- Add `.db-mcp/history.db` to `.gitignore` (history is local-only, may contain sensitive SQL)
- Lint and Explain are zero-storage — just transient

## Zero dependencies

Reuses v2.16's multi-backend SQLite (`node:sqlite` on Node 22.5+ / `better-sqlite3` fallback). No new npm packages.
