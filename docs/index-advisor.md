# Index Advisor + Plan Diff + Plan History (v3.1)

v3.1 closes three long-deferred items from v2.17 / v2.19 / v3.0:
- **索引建议** — `IndexAdvisor.analyze(plan, dbType)` parses EXPLAIN output and
  recommends `CREATE INDEX` SQL for sequential scans, large row estimates,
  missing join indexes, and sort-without-index.
- **Query plan diff** — `PlanDiff.compare(planA, planB)` returns
  added/removed/changed operations + costDelta + rowsDelta.
- **Plan history** — a separate `plan_history.db` SQLite file storing EXPLAIN
  snapshots keyed by a SQL template hash (literals stripped). The
  `compare_query_plans` tool can then diff snapshots across time.

## Concepts

- **Normalized SQL** — same logical query with different parameters hashes
  identically (e.g. `SELECT * FROM t WHERE id = 5` and `... id = 999` both
  normalize to `SELECT * FROM t WHERE id = ?` with the same hash).
- **Native vs raw passthrough adapters** — sqlite/mysql/pg/mongodb have
  dedicated JSON parsers; the rest 11 adapters (oracle, dameng, mssql,
  clickhouse, redis, kingbase, gaussdb, opengauss, oceanbase, tidb,
  polardb/vastbase/highgo/goldendb) fall back to raw text passthrough so
  the LLM still sees the plan verbatim.
- **Index advice `impact`** — heuristic-suggested severity:
  - `'low'`     — rows < 1000, or raw plan with extractable table
  - `'medium'`  — 1000 ≤ rows < 50000, or sort_no_index
  - `'high'`    — rows ≥ 50000, or no_index_join
- **Plan diff `costDelta`** — positive = slower (B costlier than A).
  Row-level cost aggregation; not exact CPU time but a useful signal.

## 3 capabilities

### 1. Index Advisor

**MCP**: `explain_query_with_advice({ sql, profileName?, persist? })`
**HTTP**: `POST /api/query-explain-advice` — body `{ sql, persist? }`

Returns:
```json
{
  "explain": { ...standard ExplainResult... },
  "advice": [
    {
      "sql": "CREATE INDEX idx_users_id ON users (id);",
      "table": "users",
      "columns": ["id"],
      "impact": "high",
      "reason": "no_index_join",
      "evidence": [...]
    }
  ],
  "captured": false
}
```

`persist: true` writes the snapshot to `plan_history.db` so future
`compare_query_plans` calls can diff.

### 2. Query Plan Diff

**MCP**: `compare_query_plans({ queryHash, entryA?, entryB? })`
**HTTP**: `POST /api/query-plan-diff` — body `{ queryHash, entryA?, entryB? }`

When ≥2 snapshots with the same `queryHash` exist, defaults to
oldest-vs-newest diff. Returns:
```json
{
  "from": { "id": 142, "capturedAt": "...", "sqlOriginal": "..." },
  "to":   { "id": 158, "capturedAt": "...", "sqlOriginal": "..." },
  "diff": {
    "identical": false,
    "added": [ ...plan nodes... ],
    "removed": [ ...plan nodes... ],
    "changed": [ { "key": "A|SCAN|users", "from": ..., "to": ..., "costDelta": -0.5, "rowsDelta": -50 } ],
    "costDelta": -0.5,
    "rowsDelta": -50
  }
}
```

### 3. Plan History listing

**MCP**: `list_query_plans({ limit?, queryHash? })`
**HTTP**: `GET /api/query-plans?limit=50&queryHash=abc`

Returns the most-recent N entries (or filtered by queryHash).

## Configuration

| Env var | Default | Effect |
|---|---|---|
| `DB_PLAN_HISTORY_DB_PATH` | `${cwd}/.db-mcp/plan_history.db` | Plan snapshot storage (created lazily) |

## Adapter coverage (per spec §8)

| Adapter | EXPLAIN parsing | IndexAdvisor | PlanDiff |
|---|---|---|---|
| sqlite | native JSON | native | native |
| mysql | native JSON | native | native |
| postgresql | native JSON | native | native |
| mongodb | native JSON | native | native |
| oracle / dameng / kingbase / gaussdb / opengauss / oceanbase / tidb / polardb / vastbase / highgo / goldendb | raw text | raw passthrough | text compare |
| mssql | raw text | raw passthrough | text compare |
| clickhouse | raw text | raw passthrough | text compare |
| redis | `'unsupported'` | `'unsupported'` | `'unsupported'` |

## Backward compatibility

- v2.14 → v3.0 callers see no behavior change unless they opt into the
  new MCP tools / HTTP endpoints.
- `plan_history.db` is created only when an `explain_query_with_advice`
  call passes `persist: true`. v3.0 callers never trigger this.
- `query_history.db` (v2.17) and `pii.config.json` (v3.0) are unchanged.

## Security / Safety

- **IndexAdvisor only suggests SQL; never executes.** The LLM is
  expected to review and run the `CREATE INDEX` statement itself.
- **`persisted` EXPLAIN plans** do not contain query result data; they
  store `{ sqlOriginal, planJson }` which is metadata only. Literal
  values are NOT stripped in `sqlOriginal` — operators concerned about
  PII in SQL text should consider the existing PiiMasker or filter at
  the LLM prompt layer.
- **No new credentials needed.** Plan history lives alongside `profiles.db`
  / `templates.db` / `history.db` in the same `.db-mcp/` directory.

## Zero dependencies

Reuses v2.16 SQLite multi-backend (node:sqlite / better-sqlite3) + v2.17
Explainer + v3.0 query-analyzer. No new npm packages.

## See also

- [Data Governance docs](data-governance.md) for v3.0 audit + PII + backup
- [Deferred Items ledger](deferred-items.md)
