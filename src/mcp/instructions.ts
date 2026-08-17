/**
 * v4.0 G8: 构建 server.instructions 字段内容。
 *
 * 该字段在 InitializeResult 中返回,作为 deferred tool search 模式下 Claude
 * 决定"该不该 search 这个 server"以及"search 时用什么关键词"的核心线索。
 * Markdown 格式,长度硬上限 2000 chars(由本函数 assert + scripts/lint-instructions.ts 保证)。
 */

export function buildInstructions(): string {
  const text = `# universal-db-mcp — Database access for 17 DB types

Use me whenever the user needs to query, inspect, or modify data in MySQL,
PostgreSQL, Oracle, SQL Server, DM (达梦), Kingbase, GaussDB, MongoDB, Redis,
SQLite, ClickHouse, TiDB, OceanBase, PolarDB, Vastbase, Highgo, or GoldenDB.

## Workflow

1. **Connect first** — call \`connect_database\` with the DB type and credentials,
   or \`use_profile\` if a saved profile exists.
2. **Explore schema** — \`get_schema\` for overview, \`get_table_info\` for columns,
   \`get_sample_data\` for rows, \`get_enum_values\` for enum-like columns.
3. **Query** — \`execute_query\` for one-off SQL (always pass \`params\` to prevent
   injection). \`explain_query\` returns the plan.
4. **Write in bulk** — \`execute_batch\` (single SQL, multiple param sets) or
   \`execute_script\` (multi-statement, requires script permission).
5. **Profile-based setups** — \`list_profiles\` / \`save_profile\` / \`use_profile\`.
6. **Tune** — \`explain_query_with_advice\` returns index hints. \`lint_sql\` for
   static analysis.

## Permission modes

- **safe** (default): read-only. All write tools blocked.
- **readwrite**: INSERT/UPDATE/DELETE allowed, DDL blocked.
- **full**: DDL + destructive ops allowed.

## Safety

- Always pass \`params\`, never string-concatenate user input.
- Prefer \`lint_sql\` before \`execute_script\`.
- \`audit_log\` retrieves all recorded queries.
- PII columns are masked by default; \`get_pii_config\` shows current rules.`;

  // 硬上限:超过 2000 chars 直接抛错,防止后续 PR 偷偷往里加内容
  if (text.length > 2000) {
    throw new Error(`buildInstructions() exceeded 2000 chars: ${text.length}`);
  }
  return text;
}