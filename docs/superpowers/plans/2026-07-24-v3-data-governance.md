# v3.0 Data Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 4 data-governance capabilities — multi-profile schema diff, SQL dump backup, SQL audit log, PII column masking — without breaking v2.14-v2.20 APIs.

**Architecture:** 4 new core modules (`SchemaDiff`, `BackupWriter`, `AuditLog`, `PiiMasker`) orchestrated through new MCP tools and HTTP routes; `HistoryStore` extended with 4 audit columns (idempotent ALTER); `pii.config.json` loaded once at startup; `DatabaseService.executeQuery` invokes `PiiMasker.mask` only on SELECT results.

**Tech Stack:** TypeScript (ESM), vitest, SQLite's built-in FTS5 (already a transitive dep), zero new required npm packages. Backup dump walks the existing `DbAdapter.executeQuery` interface — no engine-level access needed.

## Global Constraints

- Zero new required npm dependencies.
- All 413 v2.20 tests must continue to pass.
- Backward compatible: existing v2.20 callers see no behavior change unless they opt into the 3 new env vars or `pii.config.json`.
- Schema migration: only `ALTER TABLE query_history ADD COLUMN ...` (idempotent); new files: `pii.config.json` (optional).
- `git` commits per task; run vitest under Node 24 via `export PATH="/c/Users/20466/scoop/persist/nvm/nodejs/v24.14.1:$PATH"`.

---

## File Structure

| Path | Created | Purpose |
|------|---------|---------|
| `src/core/schema-diff.ts` | Task 1 | SchemaDiff.compareProfiles (added/removed/modified) |
| `src/core/backup-writer.ts` | Task 2 | SQL dump (sqlite MVP, mysql/pg via adapter) |
| `src/core/audit-log.ts` | Task 3 | AuditLog facade + HistoryStore.audit_metadata columns |
| `src/core/pii-masker.ts` | Task 4 | PiiMasker + 5 built-in strategies + config loader |
| `src/core/database-service.ts` | Tasks 3+4 | Wire auditMetadata; invoke PiiMasker on SELECT results |
| `src/core/history-store.ts` | Task 3 | ALTER TABLE add 4 columns + indexes |
| `src/core/query-analyzer.ts` | Tasks 3+4 | recordQuery accepts auditMetadata; masked result availability |
| `src/utils/config-loader.ts` | Tasks 3+4 | 3 new env vars; load pii.config.json |
| `src/types/http.ts` | Tasks 3+4 | AuditMetadata, PiiConfig types |
| `src/mcp/tools/data-governance.ts` | Tasks 1-4 | 4 new MCP tools |
| `src/http/routes/data-governance.ts` | Tasks 1-4 | 4 new HTTP endpoints |
| `tests/unit/schema-diff.test.ts` | Task 1 | multi-profile compare |
| `tests/unit/backup-writer.test.ts` | Task 2 | SQLite round-trip |
| `tests/unit/audit-log.test.ts` | Task 3 | record/query + severity |
| `tests/unit/pii-masker.test.ts` | Task 4 | 5 strategies + integration |
| `tests/unit/database-service-pii.test.ts` | Task 4 | SELECT result masking |
| `tests/unit/config-loader-v3.test.ts` | Tasks 3+4 | 3 env vars |
| `tests/integration/backup-restore.test.ts` | Task 2 | dump → fresh profile → restore |
| `docs/data-governance.md` | Task 5 | New doc |
| `docs/deferred-items.md` | Task 5 | Update ledger |
| `CHANGELOG.md` | Task 5 | v3.0.0 entry |
| `package.json` | Task 5 | Bump 2.20.0 → 3.0.0 |

---

### Task 1: SchemaDiff

**Files:**
- Create: `src/core/schema-diff.ts`
- Test: `tests/unit/schema-diff.test.ts`

**Interfaces:**
- Produces: `compareProfiles(pm, nameA, nameB): Promise<SchemaDiffResult>`
- Reuses: `ProfileManager.listSchema / GlobalSchemaView` from v2.18

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Run + verify FAIL**  
- [ ] **Step 3: Implement SchemaDiff.compareProfiles**
- [ ] **Step 4: Add MCP tool + HTTP endpoint**
- [ ] **Step 5: Commit**

### Task 2: BackupWriter

**Files:**
- Create: `src/core/backup-writer.ts`
- Test: `tests/unit/backup-writer.test.ts`, `tests/integration/backup-restore.test.ts`

**Interfaces:**
- Produces: `BackupWriter.dump(pm, profileName, opts): Promise<BackupResult>`

- [ ] **Step 1**: Write tests
- [ ] **Step 2**: FAIL
- [ ] **Step 3**: Implement (SQLite adapter via existing executeQuery; pg/mysql use `SHOW TABLES` + iterate)
- [ ] **Step 4**: MCP `export_backup` + HTTP `POST /api/profiles/:name/backup`
- [ ] **Step 5**: Commit

### Task 3: AuditLog

**Files:**
- Modify: `src/core/history-store.ts` (4 ALTER cols + 3 indexes)
- Modify: `src/core/query-analyzer.ts` (recordQuery accepts auditMetadata)
- Create: `src/core/audit-log.ts`
- Test: `tests/unit/audit-log.test.ts`, `tests/unit/config-loader-v3.test.ts`

- [ ] **Step 1**: Tests
- [ ] **Step 2**: FAIL
- [ ] **Step 3**: ALTER + AuditLog.record/query
- [ ] **Step 4**: Wire into DatabaseService.executeQuery (passes actor/clientIp/severity)
- [ ] **Step 5**: MCP `audit_log` tool + HTTP `GET /api/audit-log`
- [ ] **Step 6**: Commit

### Task 4: PiiMasker

**Files:**
- Create: `src/core/pii-masker.ts`
- Modify: `src/core/database-service.ts` (invoke mask on SELECT)
- Test: `tests/unit/pii-masker.test.ts`, `tests/unit/database-service-pii.test.ts`

- [ ] **Step 1**: Tests
- [ ] **Step 2**: FAIL
- [ ] **Step 3**: Implement 5 strategies + apply on SELECT paths
- [ ] **Step 4**: Wire config-loader to load `pii.config.json`
- [ ] **Step 5**: MCP `get_pii_config` / `set_pii_config` + HTTP `GET/PUT /api/profiles/:name/pii`
- [ ] **Step 6**: Commit

### Task 5: Release v3.0.0

**Files:**
- Modify: `package.json`, `CHANGELOG.md`
- Create: `docs/data-governance.md`
- Modify: `docs/deferred-items.md`

- [ ] **Step 1**: Full regression (target ~465 tests)
- [ ] **Step 2**: Bump version, CHANGELOG, deferred-items ledger updates, new doc
- [ ] **Step 3**: Commit + push + `gh release create v3.0.0` + `gh workflow run "Publish to NPM"` + verify npmjs
- [ ] **Step 4**: Confirm npmjs latest = 3.0.0

---

## Self-Review Notes

- Tasks 1-4 each produces one self-contained module + its MCP/HTTP surface.
- Types in `http.ts` and `query-analyzer-types.ts` are extended consistently across tasks (AuditMetadata, PiiConfig, Severity, MaskStrategy).
- Backward compat: `recordQuery(input)` keeps existing signature; audit columns are nullable, so old code paths still record without metadata.
- BackupWriter's per-adapter logic falls back to schemaOnly for unsupported adapters (mysql/pg/sqlite only in MVP), satisfying spec §9 risk row.

