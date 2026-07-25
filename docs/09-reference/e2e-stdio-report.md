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
| connect_database | ✅ | — | — | — | — | — | — |
| disconnect_database | ✅ | — | — | — | — | — | — |
| get_connection_status | ✅ | — | — | — | — | — | — |
| execute_query | ✅ | — | — | — | — | — | — |
| execute_script | ❌ | — | — | — | — | — | — | Bug #13 |
| execute_sql_file | ❌ | — | — | — | — | — | — | Bug #13 |
| execute_batch | ❌ | — | — | — | — | — | — | Bug #13 |
| execute_template | ❌ | — | — | — | — | — | — | Bug #14 |
| get_metrics | ✅ | — | — | — | — | — | — |
| get_schema | ✅ | — | — | — | — | — | — |
| get_table_info | ✅ | — | — | — | — | — | — |
| clear_cache | ✅ | — | — | — | — | — | — |
| get_enum_values | ✅ | — | — | — | — | — | — |
| get_sample_data | ❌ | — | — | — | — | — | — | use_profile crash broke DB |
| generate_sample_data | ❌ | — | — | — | — | — | — | Bug #13 |
| explain_query | ⚠️ | — | — | — | — | — | — | Bug #18 empty plan |
| lint_sql | ❌ | — | — | — | — | — | — | Bug #16 no syntax check |
| get_query_history | ❌ | — | — | — | — | — | — | Bug #17 empty |
| save_template | ✅ | — | — | — | — | — | — |
| list_templates | ✅ | — | — | — | — | — | — |
| get_template | ✅ | — | — | — | — | — | — |
| delete_template | ✅ | — | — | — | — | — | — |
| save_profile | ✅ | — | — | — | — | — | — |
| list_profiles | ✅ | — | — | — | — | — | — |
| use_profile | ❌ | — | — | — | — | — | — | Bug #15 crash |
| get_global_schema | ✅ | — | — | — | — | — | — |
| export_profiles | ❌ | — | — | — | — | — | — | Bug #13 |
| import_profiles | ❌ | — | — | — | — | — | — | Bug #13 |
| get_profile | ❌ | — | — | — | — | — | — | Bug #13 |
| delete_profile | ❌ | — | — | — | — | — | — | Bug #13 |
| enable_profile | ❌ | — | — | — | — | — | — | Bug #13 |
| disable_profile | ❌ | — | — | — | — | — | — | Bug #13 |
| disconnect_profile | ❌ | — | — | — | — | — | — | Bug #13 |
| compare_profile_schemas | ❌ | — | — | — | — | — | — | Bug #13 |
| export_backup | ❌ | — | — | — | — | — | — | Bug #13 |
| audit_log | ❌ | — | — | — | — | — | — | Bug #13 |
| get_pii_config | ❌ | — | — | — | — | — | — | Bug #13 |
| set_pii_config | ❌ | — | — | — | — | — | — | Bug #13 |
| explain_query_with_advice | ❌ | — | — | — | — | — | — | Bug #13 |
| compare_query_plans | ❌ | — | — | — | — | — | — | Bug #13 |
| list_query_plans | ❌ | — | — | — | — | — | — | Bug #13 |
| use_tool_group | ❌ | — | — | — | — | — | — | Bug #13 |
| use_tool_schema | ❌ | — | — | — | — | — | — | Bug #13 |

## Bug log

| # | Title | Severity | Status | Tools/DBs | Fix commit |
|---|---|---|---|---|---|
| #11 | execute_script/sql_file/batch missing from v3.1 list (perms gated at startup, not refreshed) | 🔴 CRITICAL | OPEN | execute_script/sql_file/batch / sqlite | — |
| #12 | use_tool_group / use_tool_schema missing from v3.1 list (lazy-path only) | 🔴 CRITICAL | OPEN | use_tool_group/schema / sqlite | — |
| #13 | MCP client caches ListTools at startup; 25 lazy group tools + 3 conditional tools unreachable even after connect_database | 🔴 CRITICAL | ✅ FIXED (pending regression) | 28 tools / all DBs | (pending commit) |
| #14 | execute_template {{var}} syntax doesn't work — uses ${var} (Mustache vs JS template-literal) | 🟢 MINOR (doc) | ✅ RESOLVED | execute_template / sqlite | — |
| #15 | use_profile crashes: "Cannot read properties of undefined (reading 'toLowerCase')" | 🔴 CRITICAL | OPEN | use_profile / sqlite | — |
| #16 | lint_sql doesn't detect syntax errors (returns no issues for "SELECTT * FORM t") | 🟡 MAJOR | OPEN | lint_sql / sqlite | — |
| #17 | get_query_history returns empty despite execute_query history | 🟡 MAJOR | OPEN | get_query_history / sqlite | — |
| #18 | explain_query returns empty plan for simple SELECT | 🟡 MAJOR | OPEN | explain_query / sqlite | — |

## Error notes

### Bug #13 — MCP client cache + permission-conditional tools
- **Repro**: any Claude Code session, call any of: `execute_script`, `execute_sql_file`, `execute_batch`, `generate_sample_data`, `use_tool_group`, `use_tool_schema`, `save_template` (wait — save_template works), 25 lazy group tools
- **Symptom**: "Error: No such tool available: mcp__universal_db_mcp__<name>"
- **Root cause** (src/mcp/mcp-server.ts:303-313 lazy path + 317-570 v3.1 path):
  - ListTools handler runs at session start; `this.config` is undefined → resolvedPerms=['read'] → execute_script/sql_file/batch/generate_sample_data NOT added
  - Meta tools (use_tool_group, use_tool_schema) only added in lazy path (line 305)
  - 25 lazy group tools (export_profiles, get_profile, audit_log, etc.) only in lazy path via tool-registry (tool-definitions.ts)
  - Once client caches tool list at startup, no refresh mechanism (same root cause as Bug #8)
- **Fix candidate**: Make all 43 tools always visible in ListTools; gate execution by perms check in CallToolRequest (not in ListTools).

### Bug #14 — execute_template placeholder syntax (RESOLVED, doc issue)
- **Status**: Not a code bug. Template syntax is `${name}` (JS template-literal style), NOT `{{name}}` (Mustache).
- **Verified**: `save_template({sql:'SELECT COUNT(*) FROM ${table}', parameters:[{name:'table', type:'sql_identifier'}]})` + `execute_template({params:{table:'e2e_s'}})` substitutes correctly.
- **Action**: Document in tool description / README — currently misleading by implying Mustache syntax.

### Bug #15 — use_profile crashes
- **Repro**: `save_profile({name:'e2e-sqlite', type:'sqlite', config:{filePath:':memory:'}})` then `use_profile({name:'e2e-sqlite'})`
- **Symptom**: "Cannot read properties of undefined (reading 'toLowerCase')"
- **Root cause**: Likely missing field in profile config passed to connect logic.

### Bug #16 — lint_sql misses obvious syntax errors
- **Repro**: `lint_sql({sql:'SELECTT * FORM e2e_t'})`
- **Symptom**: `{issues:[], hasErrors:false, hasWarnings:false}` — no detection of typo'd keywords
- **Root cause**: Query analyzer probably only checks metadata, not syntax.

### Bug #17 — get_query_history empty despite history
- **Repro**: Run several execute_query then call `get_query_history({limit:10})`
- **Symptom**: `{entries:[]}` despite known execute_query calls
- **Root cause**: Query analyzer not recording, OR history store filtered out.

### Bug #18 — explain_query empty plan for simple SELECT
- **Repro**: `explain_query({sql:'SELECT * FROM e2e_t'})`
- **Symptom**: `{plan:[], raw:''}` — empty
- **Root cause**: SQLite doesn't support EXPLAIN in this analyzer, OR adapter doesn't relay.

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

- 2026-07-25 D1: setup — `.mcp.json` flipped to `DB_LAZY_LOAD_ENABLED=false`, v5 matrix skeleton created
- 2026-07-25 D2: S1 sqlite — 17/43 cells filled (✅ 14 + ⚠️ 1 + ❌ 2 + ❌ 25 due to Bug #13), 8 new bugs found (#11-#18)