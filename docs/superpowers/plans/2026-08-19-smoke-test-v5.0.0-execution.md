# v5.0.0 Smoke Test Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (manual / Claude Code in-session execution) to walk through this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the 42 smoke test cases in `docs/smoke-test-v5.0.0.md` against Oracle (`<ORACLE_USER>/<ORACLE_SERVICE_NAME>@<ORACLE_HOST>:<ORACLE_PORT>`) and 达梦 (DM, connection supplied by user), recording ✅/❌ in the doc's tracking table.

**Architecture:** Each task walks through one § group of the smoke-test doc (§1 → §10), running tools in MCP, observing responses, and filling the results table at the top of the doc. No code changes — pure execution + documentation.

**Tech Stack:**
- MCP tools (`@joyous-coder/universal-db-mcp` v5.0.0)
- Bash for filesystem ops (no profile edits required — profile lifecycle tools already use)

**Spec:** `docs/smoke-test-v5.0.0.md` — the plan argues from the spec, executor reads both side-by-side.

## Global Constraints

- **Profile name**: Oracle profile is `bbz-cq-oracle` (already saved + auto-activated by `.db-profile`). DM profile name is `test-dm` (test executor creates it in Task 1).
- **Permission**: Both profiles `permissionMode: 'full'` — required for write-class tools (DDL/INSERT/UPDATE/DELETE/script/batch).
- **Cleanup**: Test tables created during execution MUST be dropped in cleanup phase (`DROP TABLE TEST_*`) so regression DB stays clean.
- **Credentials**: Real credentials NOT in plan or commit messages — user supplies DM at test time via `create_profile`.
- **Reporting**: Every task ends with the executor updating the `测试结果记录表` table at the top of `smoke-test-v5.0.0.md` (✅ / ❌ + 备注 column).
- **Connection issues**: If Oracle connection drops mid-test, re-run `use_profile` to re-activate. If DM not yet supplied, skip §1.1 (DM section) and continue with Oracle.

---

## Task 0: Setup — Activate Oracle, create DM profile

**Files:**
- Modify: none
- Reference: `docs/smoke-test-v5.0.0.md` §0 (测试环境 + 创建 profile 的标准流程)

**Interfaces:**
- Consumes: DM connection info (host/port/user/password) — supplied by user
- Produces: active `bbz-cq-oracle` connection + active `test-dm` connection (if DM supplied)

- [ ] **Step 1: Verify Oracle auto-activation**

Run: `mcp__universal-db-mcp__get_active_profile({})`

Expected: `activeProfile: "bbz-cq-oracle"`, `connected: true`, `permissionMode: "full"`.

If not connected, run `mcp__universal-db-mcp__use_profile({name: "bbz-cq-oracle"})`.

- [ ] **Step 2: Create DM profile (if user supplied connection)**

Run: `mcp__universal-db-mcp__create_profile({name: "test-dm", type: "dm", config: {host: "<DM_HOST>", port: <DM_PORT>, user: "<DM_USER>", password: "<DM_PASSWORD>"}, permissionMode: "full", tags: ["dm", "smoke-test"]})`

Expected: Profile returned with `config.permissions` auto-expanded to `[read, insert, update, delete, ddl, script, batch]`.

If profile name `test-dm` already exists → will throw UNIQUE; use `update_profile` or pick a different name (`test-dm-2`).

- [ ] **Step 3: Activate DM profile**

Run: `mcp__universal-db-mcp__use_profile({name: "test-dm"})`

Expected: `connected: true`, `permissionMode: "full"`.

If DM not yet supplied by user → skip Steps 2 & 3, mark all DM columns in tracking table as ⏸️ (deferred).

- [ ] **Step 4: Verify Oracle still connected**

Run: `mcp__universal-db-mcp__get_active_profile({})`

Expected: active profile is `test-dm` (DM active). To test Oracle, executor calls `use_profile({name: "bbz-cq-oracle"})` at start of each Oracle test group, then `use_profile({name: "test-dm"})` for DM groups.

- [ ] **Step 5: Commit setup (no code changes)**

Setup involves only MCP calls — no git commit needed. Proceed to Task 1.

---

## Task 1: Execute §1 Profile 生命周期 (13 tools)

**Files:**
- Modify: `docs/smoke-test-v5.0.0.md` (results table at top)
- Reference: `docs/smoke-test-v5.0.0.md` §1.1–§1.13

**Interfaces:**
- Consumes: active profiles (Oracle + DM) from Task 0
- Produces: ✅/❌ entries in results table for `create_profile`, `update_profile`, `list_profiles`, `get_profile`, `use_profile`, `delete_profile`, `enable_profile`, `disable_profile`, `disconnect_profile`, `get_active_profile`, `get_global_schema`, `export_profiles`, `import_profiles`, `compare_profile_schemas`

- [ ] **Step 1: Execute `create_profile` tests (Oracle + DM)**

Switch to target DB: `use_profile({name: "<db>"})`.

Oracle: `create_profile({name: "test-ora-1", type: "oracle", config: {host: "<ORACLE_HOST>", port: <ORACLE_PORT>, user: "<ORACLE_USER>", password: "<ORACLE_PASSWORD>", database: "<ORACLE_SERVICE_NAME>"}, description: "..."})` — observe response. Test 1: full Profile returned. Test 2: `permissionMode: 'full'` → `config.permissions` auto-expanded. Test 3: 重名 → UNIQUE error. Test 4: 名字含空格 → name regex error. Test 5: 缺 config → schema 校验拒绝.

DM: same with `type: "dm"`.

Record ✅/❌ in tracking table.

- [ ] **Step 2: `update_profile` tests**

Switch DB. Call `update_profile({name: "test-ora-1", type: "oracle", config: {...}, tags: ["updated"]})` — verify tags 改了, updated_at 更新, created_at 不变. Test 不存在的 name → expect error.

- [ ] **Step 3: `list_profiles` tests**

`list_profiles({})` → expect 至少包含 `bbz-cq-oracle`. `list_profiles({tag: "dm"})` → filter. `list_profiles({role: "primary"})` → filter.

- [ ] **Step 4: `get_profile` tests**

`get_profile({name: "bbz-cq-oracle"})` → 完整 Profile. `get_profile({name: "ghost"})` → null/error.

- [ ] **Step 5: `use_profile` tests**

`use_profile({name: "test-ora-1"})` → connected=true. `use_profile({name: "test-ora-1", recordToProject: false})` → 不写 `.db-profile`. `use_profile({name: "ghost"})` → profile not found.

- [ ] **Step 6: `delete_profile` preview + confirm tests**

`delete_profile({name: "test-ora-1"})` (no confirm) → expect preview error. `delete_profile({name: "test-ora-1", confirm: true})` → `{deleted: true}`.

- [ ] **Step 7: `enable_profile` / `disable_profile` tests**

`disable_profile({name: "test-ora-1"})` → `{enabled: false}`. `enable_profile({name: "test-ora-1"})` → `{enabled: true}`.

- [ ] **Step 8: `disconnect_profile` tests**

`disconnect_profile({name: "test-ora-1"})` → `{disconnected: true}`.

- [ ] **Step 9: `get_active_profile` tests**

`get_active_profile({})` → 完整 profile 元数据 (connected: true).

- [ ] **Step 10: `get_global_schema` tests**

`get_global_schema({})` → all enabled profiles' schemas (注意 Oracle 输出可能 > 1MB, 截断部分可读).

- [ ] **Step 11: `export_profiles` + `import_profiles` tests**

`export_profiles({format: "yaml", includeSecrets: false})` → YAML with `REDACTED` passwords. `import_profiles({input: <yaml>, format: "yaml", mode: "merge"})` → `{inserted: N}`.

- [ ] **Step 12: `compare_profile_schemas` tests**

`compare_profile_schemas({nameA: "bbz-cq-oracle", nameB: "bbz-cq-oracle", maxTablesPerProfile: 10})` → identical.

- [ ] **Step 13: Cleanup test profiles**

For each `test-ora-*` / `test-dm-*` profile created during §1: `delete_profile({name, confirm: true})`. Verify they are removed via `list_profiles`.

- [ ] **Step 14: Update tracking table**

For each tool in §1, fill ✅/❌ + 备注 in `docs/smoke-test-v5.0.0.md` results table.

- [ ] **Step 15: Commit (no code changes — skip if nothing to commit)**

Smoke test execution produces no code changes; documentation update is direct edit.

---

## Task 2: Execute §2 Schema / 元数据 (5 tools)

**Files:**
- Modify: `docs/smoke-test-v5.0.0.md` (results table)

- [ ] **Step 1: `get_schema` tests (Oracle + DM)**

`get_schema({forceRefresh: false})` → large output (Oracle ~9.7MB). `get_schema({forceRefresh: true})` → re-fetch.

- [ ] **Step 2: `get_table_info` tests**

`get_table_info({tableName: "TEST_REGRESSION_TBL"})` → 假设表存在 (smoke test 创建 + 清理). If not, create + drop during test.

- [ ] **Step 3: `get_sample_data` tests**

`get_sample_data({tableName: "TEST_REGRESSION_TBL", limit: 3})` → 3 rows + masked=false.

- [ ] **Step 4: `get_enum_values` tests**

`get_enum_values({tableName: "TEST_REGRESSION_TBL", columnName: "status", includeCount: true})` → values + counts.

- [ ] **Step 5: `clear_cache` tests**

`clear_cache({})` → `{success: true}`.

- [ ] **Step 6: Update tracking table**

---

## Task 3: Execute §3 SQL 执行 (4 tools)

- [ ] **Step 1: `execute_query` tests (Oracle + DM)**

Test: `SELECT 1 AS one FROM DUAL`. With `:1` placeholder. Test DDL: `CREATE TABLE TEST_SMOKE_XXX (...)`. Error: ghost table → ORA-00942. Error: missing permission → denied.

- [ ] **Step 2: `execute_batch` tests**

`execute_batch({sql: "UPDATE TEST_SMOKE_XXX SET ... WHERE id = :1", paramsList: [["v1"], ["v2"]]})` → `affectedRowsPerStatement`.

- [ ] **Step 3: `execute_script` tests (multi-statement + PL/SQL block)**

DDL+DML: `CREATE TABLE X; INSERT INTO X VALUES (1); DROP TABLE X;`. PL/SQL: `BEGIN ... END;` (validate v5.0.0 PL/SQL 修复).

- [ ] **Step 4: `execute_sql_file` tests**

Need to setup `.db-profile` paths or `DB_ALLOWED_FILE_PATHS` env first. Test: write a `test-script.sql`, call `execute_sql_file({filePath: "..."})`. Validate dryRun vs real run.

- [ ] **Step 5: Update tracking table**

---

## Task 4: Execute §4–§6 Static Analysis + Explain + Template (10 tools)

- [ ] **Step 1: `lint_sql` tests**

`lint_sql({sql: "SELECT * FROM big WHERE id = 1"})` → warnings.

- [ ] **Step 2: `explain_query` tests**

`explain_query({sql: "SELECT * FROM TEST_SMOKE_XXX WHERE id = :1"})` → 可能空 plan (已知 Oracle EXPLAIN 限制).

- [ ] **Step 3: `explain_query_with_advice` tests**

`explain_query_with_advice({sql: "...", persist: true})` → `captured: true`. Run twice same SQL, then `compare_query_plans` + `list_query_plans`.

- [ ] **Step 4: `compare_query_plans` / `list_query_plans` tests**

After 2 persisted plans: `compare_query_plans({queryHash, entryA, entryB})` → diff.

- [ ] **Step 5: `save_template` tests**

Without parameters: `save_template({name, description, sql: "SELECT 1 FROM DUAL"})`. With parameters: `save_template({name, sql: "SELECT * FROM X WHERE id = ${id}", parameters: [{name: "id", type: "number", required: true}]})`.

- [ ] **Step 6: `list_templates` / `get_template` / `delete_template` / `execute_template` tests`

Standard CRUD on templates. `execute_template({id, params: {id: 1}})` → rows.

- [ ] **Step 7: Update tracking table**

---

## Task 5: Execute §7 CSV / 导入导出 (3 tools)

- [ ] **Step 1: `export_table_csv` tests**

`export_table_csv({table: "TEST_SMOKE_XXX", columns: ["ID", "NAME", "STATUS"]})` → writes CSV file.

- [ ] **Step 2: `import_csv` tests**

First export to CSV, then `import_csv({table: "TEST_SMOKE_XXX", filePath: <csv>, dryRun: true})` → sample. Then dryRun=false → real import.

- [ ] **Step 3: `export_backup` tests**

`export_backup({profileName: "bbz-cq-oracle", schemaOnly: true})` → 可能返回 `kind: "unsupported"` (Oracle 不在 MVP).

- [ ] **Step 4: Update tracking table**

---

## Task 6: Execute §8–§10 PII + 数据生成 + 查询体验 (6 tools)

- [ ] **Step 1: `get_pii_config` / `set_pii_config` tests**

`get_pii_config({})` → 当前配置. `set_pii_config({profileName: "bbz-cq-oracle", rules: [{table: "X", column: "phone", strategy: "mask"}]})` → `{success: true, ruleCount: 1}`.

- [ ] **Step 2: `generate_sample_data` tests**

`generate_sample_data({tableName: "TEST_SMOKE_XXX", rowCount: 3, options: {seed: 42}})` → 3 rows inserted. Use `columnOverrides` to avoid VARCHAR overflow.

- [ ] **Step 3: `get_metrics` tests**

`get_metrics({category: "summary"})` → counters + histograms.

- [ ] **Step 4: `get_query_history` tests**

`get_query_history({limit: 10, profileName: "bbz-cq-oracle"})` → entries. `groupBy: "profile"` → aggregates.

- [ ] **Step 5: `audit_log` tests**

`audit_log({limit: 10, profileName: "bbz-cq-oracle"})` → entries.

- [ ] **Step 6: Update tracking table**

---

## Task 7: Final cleanup + commit

**Files:**
- Modify: `docs/smoke-test-v5.0.0.md` (cleanup notes + final commit)

- [ ] **Step 1: Drop all test tables**

```sql
BEGIN
  FOR t IN (SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME LIKE 'TEST_%' OR TABLE_NAME LIKE 'TEST_SMOKE_%') LOOP
    EXECUTE IMMEDIATE 'DROP TABLE ' || t.TABLE_NAME;
  END LOOP;
END;
```

Or via execute_query one by one if PL/SQL block fails: query USER_TABLES, then drop each.

For DM: equivalent query against `INFORMATION_SCHEMA.TABLES` or `USER_TABLES` (DM-specific).

- [ ] **Step 2: Delete test profiles**

`delete_profile({name: "test-ora-1", confirm: true})` for each. Verify `list_profiles({})` returns only `bbz-cq-oracle`.

- [ ] **Step 3: Reset `.db-profile` to bbz-cq-oracle**

If `.db-profile` was overwritten during testing:
```
profile=bbz-cq-oracle
```

(do this via `Write` tool to ensure exact content).

- [ ] **Step 4: Final tracking table review**

Open `docs/smoke-test-v5.0.0.md`. Verify all 42 tools have ✅/❌/⏸️ marked. Verify 备注 column has meaningful notes for ⚠️ cases.

- [ ] **Step 5: Git commit (doc changes only)**

```bash
git add docs/smoke-test-v5.0.0.md docs/regression-2026-08-19-v5.0.0-oracle.md
git commit -m "docs: smoke test execution results for v5.0.0 (Oracle + DM placeholder)"
```

Commit message must NOT include real DB credentials.

---

## Self-Review Checklist

- [x] All 42 tools covered by tasks (§1-§10 map to tasks 1-6)
- [x] Setup task precedes execution tasks
- [x] Cleanup task at end drops test tables + profiles
- [x] Each task has checkboxes + concrete steps
- [x] No placeholders ("TBD", "TODO")
- [x] No code edits (only MCP calls + doc edits)
- [x] Plan references spec file (smoke-test-v5.0.0.md) for all test cases
- [x] Credentials NOT in plan — user supplies DM via create_profile at Task 0 Step 2
- [x] Tracking table updated per task
- [x] Final cleanup ensures regression DB stays clean

## Execution Notes

- Per-tool test scripts are in `smoke-test-v5.0.0.md` §X.Y sections — executor reads both files
- For DM-only tests, executor skips Oracle (or vice versa) if connection not available
- If MCP returns errors unrelated to the test (e.g., server disconnected), executor re-establishes connection via `use_profile` then retries
- ⚠️ Known limitations to record in 备注: `explain_query` empty plan, `export_backup` Oracle unsupported, `execute_batch` DM Bug #54 (-6804)