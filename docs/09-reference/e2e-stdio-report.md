# E2E Stdio Test Report — v5 (2026-07-25)

> **Direct native MCP exercise | 7 DB × 43 tool × 7 envVar matrix**
> **Sessions**: S1-S7 (per DB), S8-S14 (per env var)
> **Spec**: `docs/superpowers/specs/2026-07-25-e2e-v5-design.md`
> **Plan**: `docs/superpowers/plans/2026-07-25-e2e-v5-plan.md`

## Recording protocol

- Every tool call → matrix cell updated
- Every failure → bug log entry + error note appended
- Cell markers: ✅ pass | ❌ fail | ⚠️ partial | skip (n/a) | INFRA (DB doesn't support)

## DB × Tool matrix

| Tool \ DB | sqlite | postgres | mysql | redis | mongodb | clickhouse | dm |
|---|---|---|---|---|---|---|---|
| connect_database | — | — | — | — | — | — | — |
| disconnect_database | — | — | — | — | — | — | — |
| get_connection_status | — | — | — | — | — | — | — |
| execute_query | — | — | — | — | — | — | — |
| execute_script | — | — | — | — | — | — | — |
| execute_sql_file | — | — | — | — | — | — | — |
| execute_batch | — | — | — | — | — | — | — |
| execute_template | — | — | — | — | — | — | — |
| get_metrics | — | — | — | — | — | — | — |
| get_schema | — | — | — | — | — | — | — |
| get_table_info | — | — | — | — | — | — | — |
| clear_cache | — | — | — | — | — | — | — |
| get_enum_values | — | — | — | — | — | — | — |
| get_sample_data | — | — | — | — | — | — | — |
| generate_sample_data | — | — | — | — | — | — | — |
| explain_query | — | — | — | — | — | — | — |
| lint_sql | — | — | — | — | — | — | — |
| get_query_history | — | — | — | — | — | — | — |
| save_template | — | — | — | — | — | — | — |
| list_templates | — | — | — | — | — | — | — |
| get_template | — | — | — | — | — | — | — |
| delete_template | — | — | — | — | — | — | — |
| save_profile | — | — | — | — | — | — | — |
| list_profiles | — | — | — | — | — | — | — |
| use_profile | — | — | — | — | — | — | — |
| get_global_schema | — | — | — | — | — | — | — |
| export_profiles | — | — | — | — | — | — | — |
| import_profiles | — | — | — | — | — | — | — |
| get_profile | — | — | — | — | — | — | — |
| delete_profile | — | — | — | — | — | — | — |
| enable_profile | — | — | — | — | — | — | — |
| disable_profile | — | — | — | — | — | — | — |
| disconnect_profile | — | — | — | — | — | — | — |
| compare_profile_schemas | — | — | — | — | — | — | — |
| export_backup | — | — | — | — | — | — | — |
| audit_log | — | — | — | — | — | — | — |
| get_pii_config | — | — | — | — | — | — | — |
| set_pii_config | — | — | — | — | — | — | — |
| explain_query_with_advice | — | — | — | — | — | — | — |
| compare_query_plans | — | — | — | — | — | — | — |
| list_query_plans | — | — | — | — | — | — | — |
| use_tool_group | — | — | — | — | — | — | — |
| use_tool_schema | — | — | — | — | — | — | — |

## Bug log

| # | Title | Severity | Status | Tools/DBs | Fix commit |
|---|---|---|---|---|---|

## Error notes

(populated as bugs found during testing)

## Env var matrix

| Env var | sqlite | postgres | mysql | redis | mongodb | clickhouse | dm |
|---|---|---|---|---|---|---|---|
| DB_LAZY_LOAD_ENABLED=false (baseline) | — | — | — | — | — | — | — |
| LOG_LEVEL=debug | — | — | — | — | — | — | — |
| DB_ALLOWED_FILE_PATHS=/nonexistent | — | — | — | — | — | — | — |
| DB_QUERY_ANALYZER_ENABLED=false | — | — | — | — | — | — | — |
| DB_METRICS_ENABLED=false | — | — | — | — | — | — | — |
| DB_PLAN_HISTORY_DB_PATH=./tmp/plan.db | — | — | — | — | — | — | — |
| DB_TYPE=postgres | — | — | — | — | — | — | — |

## Session log

- 2026-07-25 D1: setup — `.mcp.json` flipped to `DB_LAZY_LOAD_ENABLED=false`, v5 matrix skeleton created (commit pending)