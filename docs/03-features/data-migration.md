# Data Migration (v3.3.0)

v3.3.0 adds two MCP tools for streaming CSV data in and out of any supported database, complementing v3.x's SQL `export_backup`. Both tools live in the `data-governance` lazy group and respect the `DB_ALLOWED_FILE_PATHS` path whitelist.

## Tools

| Tool                  | Direction | Format | Streaming | Batch size | Path safety                |
| --------------------- | --------- | ------ | --------- | ---------- | -------------------------- |
| `export_table_csv`    | DB → CSV  | RFC 4180, UTF-8 no BOM, `\r\n` | `LIMIT`/`OFFSET` paging | default 5000 rows | `DB_ALLOWED_FILE_PATHS`    |
| `import_csv`          | CSV → DB  | RFC 4180, UTF-8 no BOM | `readline` line stream | default 1000 rows | `DB_ALLOWED_FILE_PATHS`    |
| `export_backup` (v3.x) | DB → SQL  | Portable SQL `CREATE TABLE` + `INSERT` | paginated reads | — | optional `outputPath`     |

All three operate on **already-existing tables** — none of them auto-creates schema. The CSV path uses streaming writes (`fs.createWriteStream`) so memory stays flat regardless of table size.

## `export_table_csv`

Stream a single table to a CSV file.

**MCP**:
```json
{
  "profileName": "prod-pg",
  "table": "public.orders",
  "columns": ["id", "customer_id", "amount", "created_at"],
  "where": "created_at > '2025-01-01'",
  "orderBy": "id ASC",
  "limit": 100000,
  "outputPath": "D:/tmp/orders-2025.csv",
  "batchSize": 5000
}
```

**Returns**:
```json
{ "totalRows": 100000, "bytesWritten": 5242880, "durationMs": 1234, "batches": 20 }
```

### Type coercion (v3.3.0)

| Source DB type       | CSV value                |
| -------------------- | ------------------------ |
| `Date` / `DateTime`  | ISO 8601 (`2025-07-26T08:43:00.000Z`) |
| `BigInt` / `UInt64`  | string (precision preserved) |
| `Decimal` / `Numeric` | string (precision preserved) |
| `Boolean` / `Bit`    | `true` / `false`          |
| `Buffer` / `Binary`  | hex with `0x` prefix      |
| `JSON` / `JSONB`     | raw JSON string          |
| `null` / `undefined` | empty string              |

### SQL injection guard

The `where` and `orderBy` parameters are **string SQL fragments** that are appended verbatim to the SELECT template. Any occurrence of `;` is rejected with `injection_blocked`. This is a trusted-path API — production deployments should gate it via the MCP server's per-caller ACL.

## `import_csv`

Stream a CSV file into an existing table (APPEND mode).

**MCP**:
```json
{
  "profileName": "staging-pg",
  "table": "public.orders",
  "filePath": "D:/tmp/orders-2025.csv",
  "dryRun": false,
  "batchSize": 1000,
  "nullStrings": ["", "NULL", "\\N"]
}
```

**Returns**:
```json
{ "totalRows": 100000, "batches": 100, "durationMs": 4500 }
```

### Cross-DB placeholder adaptation (v3.3.0)

Different DB drivers expect different placeholder shapes:

- **SQLite** (better-sqlite3 / node:sqlite) — sequential `?`, raw value arrays
- **CH / DM / MySQL / PG / Kingbase / Oracle** — named `{col:Type}`, object arrays

The adapter factory detects `adapter.config.type` and the import helper `_toAdapterBatch` rewrites object arrays to raw arrays when feeding SQLite. This is automatic; callers don't need to know.

### Dry-run preview

`dryRun: true` parses the file, validates columns against the target table, and returns `sample` (first 5 rows) without writing anything:

```json
{
  "totalRows": 100000,
  "batches": 0,
  "sample": [
    { "id": "1", "customer_id": "42", "amount": "100.50" },
    ...
  ]
}
```

### Column mismatch error

If the CSV header contains a column not in the target table, `import_csv` throws `column_mismatch`:

```
column_mismatch: csv column "extra_col" not in table columns [id, name, note]
```

## File format (RFC 4180)

- Encoding: UTF-8 **no BOM** (per v3.3.0 user confirmation; opens directly in Excel and Pandas)
- Line ending: `\r\n`
- Field separator: `,`
- Quoting: `"..."`; embedded `"` is escaped as `""`
- `nullStrings` (default `['', 'NULL', '\\N']`): cells matching any of these become SQL `NULL`

Example:
```csv
id,name,note
1,Alice,plain
2,Bob,"a,b"
3,Charlie,"has""quote"
4,,NULL
```

## Security

- **Path whitelist**: both `outputPath` (export) and `filePath` (import) must be under any directory listed in `DB_ALLOWED_FILE_PATHS`. Empty / unset env var → tool refuses with `path_not_allowed`.
- **Permission**: requires the `write` permission (set `permissionMode: 'readwrite'` or `'full'` at `connect_database`).
- **WHERE / ORDER BY injection guard**: `;` in either field throws `injection_blocked`.
- **Table / column identifiers**: validated by `validateIdentifier` (`[a-zA-Z0-9_.]` only); multi-statement injection rejected.

## DB-specific notes

- **ClickHouse** — object arrays feed `client.command()` (no `format` conflict). UInt64 / BigInt are coerced to `Number` automatically when they fit in `Number.isSafeInteger`.
- **DM (达梦)** — works through `BaseAdapter.executeBatch`; auto-adapts to DM's BEGIN/COMMIT protocol quirk (no `BEGIN` for write paths).
- **SQLite** — raw value arrays + `?` placeholders. Best for local development; production should use Postgres / MySQL.
- **MongoDB / Redis** — these tools return `INFRA` (no table / CSV semantics).

## Implementation files

| File                              | Purpose                                              |
| --------------------------------- | ---------------------------------------------------- |
| `src/core/csv-writer.ts`         | `quoteField`, `rowToCsv`, `buildSelectSql`, `exportTableCsv` |
| `src/core/csv-reader.ts`         | `parseCsvLine`, `streamCsvRows`, `_toAdapterBatch`, `importCsv` |
| `src/mcp/tools/csv-tools.ts`      | handler layer, `DB_ALLOWED_FILE_PATHS` enforcement |
| `tests/unit/csv-writer.test.ts`   | RFC 4180 serialization + type coercion |
| `tests/unit/csv-reader.test.ts`   | parse + stream + batch |
| `tests/unit/csv-tools.test.ts`    | handler + path whitelist |
| `tmp-e2e/csv-e2e.cjs`             | live sqlite roundtrip (export → drop → import → verify) |

## Related docs

- [Data Governance](./data-governance.md) — `compare_profile_schemas`, `set_pii_config`, `audit_log`, `export_backup`
- [CHANGELOG v3.3.0](../../CHANGELOG.md) — release notes
- [e2e report](../09-reference/e2e-stdio-report.md) — tool × DB matrix