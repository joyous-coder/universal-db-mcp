# Observability

v2.16 introduces production-grade observability for the universal-db-mcp server.

## Exposed metrics

### HTTP `/metrics` (Prometheus)

Anonymous by default; gate with `DB_METRICS_IP_ALLOWLIST` if exposing externally.

```yaml
# prometheus.yml scrape config
scrape_configs:
  - job_name: 'universal-db-mcp'
    static_configs:
      - targets: ['localhost:3000']
    scrape_interval: 15s
```

Available metric families:

| Metric                    | Type      | Labels                       | Meaning                                               |
| ------------------------- | --------- | ---------------------------- | ----------------------------------------------------- |
| `db_query_total`        | counter   | `db`, `kind`, `status` | Total queries (kind = select/insert/.../script/batch) |
| `db_query_seconds`      | histogram | `db`, `kind`             | Query latency (seconds) — covers acquire + execute   |
| `db_query_errors_total` | counter   | `db`, `kind`, `code`   | Query errors by error code                            |
| `db_slow_queries_total` | counter   | `db`, `kind`             | Queries above`DB_SLOW_QUERY_THRESHOLD_MS`           |

Note: `db_pool_acquire_*` metrics are not yet exposed — pool acquire timing is bundled into `db_query_seconds` (acquire is typically < 5ms, query execution dominates). Proper pool-level breakdown is planned for v2.17.

### MCP `get_metrics` tool

```
{ "name": "get_metrics", "arguments": { "category": "summary" } }
```

Returns JSON. Categories: `summary` (counters + histograms + gauges), `slow_queries` (recent slow-query list, ring-buffered), `all` (everything). Does NOT require a database connection.

Example response (category=slow_queries):

```json
{
  "slow_queries": [
    {
      "ts": "2026-07-24T08:00:00Z",
      "db": "mysql",
      "kind": "select",
      "seconds": 5.2,
      "sql": "SELECT * FROM huge_table WHERE ...",
      "error": null
    }
  ]
}
```

### `/api/health` extended

Response now includes additional fields: `uptime_seconds`, `active_db`, `queries_total`, `errors_total`. Existing `status` field unchanged. Backward compatible.

## Configuration

| Env                             | Default  | Effect                                                     |
| ------------------------------- | -------- | ---------------------------------------------------------- |
| `DB_METRICS_ENABLED`          | `true` | Set`false` to disable all observability (zero overhead)  |
| `DB_METRICS_IP_ALLOWLIST`     | (empty)  | Comma-separated IPs/CIDRs allowed to scrape`/metrics`    |
| `DB_METRICS_SLOW_BUFFER_SIZE` | `100`  | Slow-query ring buffer capacity (`0` disables recording) |

`DB_QUERY_TIMEOUT_MS` and `DB_SLOW_QUERY_THRESHOLD_MS` (existing) — metrics reuse the same threshold for slow-query recording.

## Use cases

- **SRE / production monitoring**: scrape `/metrics` from Prometheus, build Grafana dashboard for query latency p95 by `db` + `kind`, alert on `rate(db_query_errors_total[5m]) > 0.05 * rate(db_query_total[5m])`
- **LLM self-diagnosis**: when query is slow, LLM calls `get_metrics({category: 'slow_queries'})` to see recent slow SQL and suggest fixes
- **Capacity planning**: `db_query_total` rate × `db_query_seconds` p95 = DB load estimate
- **DBA workflow**: `get_metrics({category: 'all'})` returns full snapshot for ad-hoc investigation

## Zero dependencies

v2.16 observability uses no new npm packages — the Prometheus exposition format is hand-rolled in `src/utils/metrics.ts` (~250 lines). The full implementation is auditable in one file.
