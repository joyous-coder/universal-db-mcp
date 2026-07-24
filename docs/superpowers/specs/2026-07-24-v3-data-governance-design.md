# Universal DB MCP — v3.x Data Governance 设计文档

**日期**: 2026-07-24
**作者**: brainstorming 会话
**状态**: ✅ 用户批准所有 10 节
**范围**: v3.x P3 — Schema diff + SQL dump 备份 + SQL audit + PII 动态脱敏

---

## 1. 背景与目标

v2.16-v2.20 完成了 **observability + query experience + multi-db + profile hardening**。项目当前没有"数据生命周期"维度的能力——schema 变更 / 备份恢复 / 审计 / 隐私保护——这些都是企业级数据库工具必备但 LLM 接入还欠缺的能力。

**4 个能力**:
1. **Schema diff** — 多 profile 之间对比 schema (added/removed/modified tables + columns)
2. **SQL dump 备份导出** — 平台无关 SQL dump (`CREATE TABLE` + `INSERT`)，可重放到任何相同 DB
3. **SQL audit** — v2.17 query_history 加重型元数据 (actor / client_ip / severity / audit_metadata_json)
4. **PII 动态脱敏** — column-level 配置 + 内置策略 (`mask` / `mask_last4` / `hash` / `redact`)，SELECT results 出 DB 前自动脱敏

**配套不做的（推到 v3.1+）**:
- 多 profile JOIN (v2.18 已 abandoned)
- 索引建议 / Query plan diff (deferred-items.md 标到 v3.x，**v3.x 也明确不做，留给 v3.1**)
- 跨 profile 事务 (v2.18 abandoned)
- #41 db-connect skill 文档 (用户指明先不做)

---

## 2. 非目标 (Non-goals)

- 不破坏 v2.14-v2.20 API（向后兼容 + 自动配置）
- 不引入新必需 npm 依赖（SQLite 已有 FTS5，全内建）
- 不做通用 audit dashboard UI（Grafana 即可）
- 不做跨 profile JOIN（v2.18 永久不做）
- 不做加密 PII 存储（脱敏后输出，原值仍可加密）
- 不做 GDPR/SOX 合规框架（只提供底层能力，合规由用户配置）
- **Schema diff 只支持 profile-vs-profile**（不引入 snapshot 存储）
- **SQL audit 不引入新依赖**（复用 v2.17 query_history 表 + 加列）
- **PII 脱敏只对 SELECT 结果生效**（不触碰 INSERT/UPDATE/DELETE）

---

## 3. 架构总览

```
┌────────────────────────────────────────────────────────────────┐
│          Tools / HTTP endpoints (MCP + REST)                    │
│  compare_profile_schemas · export_backup · audit_log             │
│  get_pii_config · set_pii_config                                │
└─────────┬──────────────────┬─────────────────┬─────────────────┘
          │                  │                 │
          ▼                  ▼                 ▼
┌──────────────────┐ ┌──────────────┐ ┌──────────────────┐
│  SchemaDiff      │ │ BackupWriter │ │ AuditLog         │
│  (multi-profile) │ │ (per-adapter │ │ (extends History │
│  via v2.18       │ │  SQL dump)   │ │  Store)          │
│  GlobalSchemaView│ │ mysql/pg/    │ │                  │
│                  │ │ sqlite/MVP   │ │                  │
└──────────────────┘ └──────────────┘ └──────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │ PiiMasker        │
                    │ (column-level    │
                    │  per-profile     │
                    │  config + built- │
                    │  in strategies)  │
                    └──────────────────┘
```

---

## 4. 核心 API

```typescript
// §4.1 SchemaDiff
export interface SchemaDiffResult {
  added: SchemaDiffEntry[];     // 表在 B 有 / A 没有
  removed: SchemaDiffEntry[];   // 表在 A 有 / B 没有
  modified: SchemaDiffModified[];
  identical: boolean;            // 全部相等时 true
}
export interface SchemaDiffEntry {
  table: string;
  in: 'A' | 'B';
  columns: SchemaColumn[];
}
export interface SchemaDiffModified {
  table: string;
  columnsAdded: SchemaColumn[];
  columnsRemoved: SchemaColumn[];
  columnsChanged: { column: string; from: SchemaColumn | null; to: SchemaColumn | null }[];
}

export class SchemaDiff {
  static async compareProfiles(
    pm: ProfileManager,
    nameA: string,
    nameB: string,
  ): Promise<SchemaDiffResult>;
}

// §4.2 BackupWriter
export interface BackupOptions {
  /** Only dump schema, skip data */
  schemaOnly?: boolean;
  /** Tables to include; default = all */
  tables?: string[];
  /** Output path. If omitted, returns string. */
  outputPath?: string;
}
export interface BackupResult {
  content: string;
  bytes: number;
  tables: string[];
  /** 'full' | 'schema-only' */
  kind: string;
}

export class BackupWriter {
  /** Per-adapter dump logic for mysql/pg/sqlite (MVP). Others schema-only. */
  static async dump(
    pm: ProfileManager,
    profileName: string,
    opts?: BackupOptions,
  ): Promise<BackupResult>;
}

// §4.3 AuditLog (extends HistoryStore)
export interface AuditMetadata {
  /** MCP/HTTP caller id; defaults to 'anonymous' */
  actor: string;
  /** Client IP for HTTP, agent id for MCP */
  clientIp?: string;
  /** 'read' | 'write' | 'ddl' */
  severity: 'read' | 'write' | 'ddl';
  /** Optional JSON blob (e.g. policy tags) */
  metadata?: Record<string, unknown>;
}
export interface AuditFilter {
  profileName?: string | null;
  actor?: string;
  severity?: 'read' | 'write' | 'ddl';
  since?: string;
  until?: string;
  limit?: number;
}

export class AuditLog {
  static async record(qa: QueryAnalyzer, sql: string, db: string, kind: string, meta: AuditMetadata): Promise<void>;
  static async query(qa: QueryAnalyzer, filter: AuditFilter): Promise<QueryHistoryEntry[]>;
}

// §4.4 PiiMasker
export type MaskStrategy = 'mask' | 'mask_last4' | 'hash' | 'redact' | 'passthrough';

export interface PiiColumnConfig {
  table: string;          // 'public.users'
  column: string;         // 'email'
  strategy: MaskStrategy;
}

export interface PiiConfig {
  /** Per-profile name → column rules */
  profiles: Record<string, PiiColumnConfig[]>;
}

export class PiiMasker {
  /** Apply masking to query result rows. SELECT only. */
  static mask(profileName: string, table: string, rows: Record<string, unknown>[]): Record<string, unknown>[];

  /** Apply a single strategy to a value */
  static applyStrategy(value: unknown, strategy: MaskStrategy): unknown;
}
```

---

## 5. 集成点

| # | 位置 | 调用 |
|---|---|---|
| 1 | `src/core/schema-diff.ts` (新) | `compareProfiles` 用 v2.18 GlobalSchemaView |
| 2 | `src/core/backup-writer.ts` (新) | Per-adapter SQL dump (mysql/pg/sqlite MVP) |
| 3 | `src/core/audit-log.ts` (新) | extends HistoryStore 表 + 重型 metadata |
| 4 | `src/core/pii-masker.ts` (新) | column-level config + built-in strategies |
| 5 | `src/core/database-service.ts` | executeQuery return 前调 `PiiMasker.mask` (仅 SELECT) |
| 6 | `src/core/query-analyzer.ts` | recordQuery 接收 `auditMetadata` 字段 |
| 7 | `src/mcp/tools/data-governance.ts` (新) | 4 个新 MCP tools |
| 8 | `src/http/routes/data-governance.ts` (新) | 4 个 HTTP endpoints |
| 9 | `src/utils/config-loader.ts` | 3 个新 env (`DB_AUDIT_MODE_ENABLED` / `DB_AUDIT_RETENTION_DAYS` / `DB_PII_CONFIG_PATH`) |
| 10 | `src/index.ts` | load `pii.config.json` once at startup |

**新增 env**:
- `DB_AUDIT_MODE_ENABLED` (default false)
- `DB_AUDIT_RETENTION_DAYS` (default 365)
- `DB_PII_CONFIG_PATH` (default `${cwd}/pii.config.json`)

---

## 6. 配置与环境变量

| Env var | Default | Effect |
|---|---|---|
| `DB_AUDIT_MODE_ENABLED` | `false` | v3.x new. When true, every executeQuery records audit metadata |
| `DB_AUDIT_RETENTION_DAYS` | `365` | Audit rows older than N days get purged by background cleanup |
| `DB_PII_CONFIG_PATH` | `${cwd}/pii.config.json` | PII rule config file |

**pii.config.json 格式**:
```json
{
  "profiles": {
    "prod-mysql": [
      { "table": "users", "column": "email", "strategy": "hash" },
      { "table": "users", "column": "phone", "strategy": "mask_last4" }
    ],
    "staging": []
  }
}
```

---

## 7. 数据库迁移

`history.db` 加列（v3.x ALTER，幂等）:
```sql
ALTER TABLE query_history ADD COLUMN actor TEXT;
ALTER TABLE query_history ADD COLUMN client_ip TEXT;
ALTER TABLE query_history ADD COLUMN severity TEXT;  -- 'read' | 'write' | 'ddl'
ALTER TABLE query_history ADD COLUMN audit_metadata_json TEXT;
CREATE INDEX IF NOT EXISTS idx_history_actor ON query_history(actor);
CREATE INDEX IF NOT EXISTS idx_history_severity ON query_history(severity);
CREATE INDEX IF NOT EXISTS idx_history_client_ip ON query_history(client_ip);
```

templates.db / profiles.db 不变。

---

## 8. 测试策略

**单元测试 (~7 文件)**:
- `tests/unit/schema-diff.test.ts` — multi-profile compare (added/removed/modified/identical)
- `tests/unit/backup-writer.test.ts` — sqlite dump round-trip (write → reload → query)
- `tests/unit/audit-log.test.ts` — record/query + severity classification
- `tests/unit/pii-masker.test.ts` — 4 strategies, falls through non-config tables
- `tests/unit/database-service-pii.test.ts` — executeQuery SELECT 通过 PiiMasker
- `tests/unit/config-loader-v3.test.ts` — 3 新 env
- `tests/integration/backup-restore.test.ts` — dump → fresh profile → restore → data identical

**回归**: 413 + ~50 新 = **~465 tests**

---

## 9. 风险与权衡

| 风险 | 等级 | 缓解 |
|---|---|---|
| PII mask 漏掉某些表导致隐私泄漏 | 高 | PiiMasker 默认 `passthrough` 显式配置才 mask；启动 warn "X profiles with no PII config" |
| PII mask 影响 INSERT/UPDATE | 高 | PiiMasker 仅在 `QueryResult.rows` 返回路径触发；write ops 不走该路径 |
| Schema diff 慢（大型 profile 几千表） | 中 | 复用 v2.18 GlobalSchemaView 并行拉取；超时由 `cacheConfig.ttl` 控制 |
| BackupWriter dump 大库超内存 | 中 | 流式：`SELECT * FROM t` cursor 写文件；用户层 `outputPath` 推荐大于内存 |
| Audit 写入暴涨 history.db | 低 | retention 自动清理；LRU maxRows 已有；audit 模式可关闭 |
| 错 PII 配置导致 mass mask 一切 | 中 | 启动显式校验：至少 1 个 column 配置，且 strategy 是 enum 之一 |
| BackupWriter 适配器不全 (oracle/mongodb 等) | 中 | MVP 支持 mysql/pg/sqlite；其他 adapter 返回 "schema-only" + 文档说明 |
| 跨 profile diff 触发 live connection | 低 | 复用 GlobalSchemaView 已用 cache |

**未做（YAGNI）**:
- audit dashboard UI（Grafana）
- 加密 PII 存储
- snapshot-based diff
- oracle / mongodb 的全量 dump（schema-only 起手）

**回退方案**:
- 所有 3 个 env var 都可独立留空 → 不开启对应功能，行为与 v2.20 完全一致
- PiiMasker 配置错启动失败 → 修 config 重启
- BackupWriter 适配不支持抛清晰错，client 改用 schemaOnly=true

---

## 10. 验收标准

- [ ] SchemaDiff.compareProfiles 返回 added/removed/modified/identical 4 态
- [ ] BackupWriter.dump SQLite profile 输出可重放的 SQL 文本
- [ ] BackupWriter.dump MySQL/PostgreSQL profile 同样支持
- [ ] AuditLog.record 写入 actor + client_ip + severity + metadata
- [ ] AuditLog.query 按 actor / severity / profileName 过滤
- [ ] PiiMasker.mask 应用 4 策略正确
- [ ] PiiMasker 只对 SELECT 结果生效，INSERT/UPDATE 不影响
- [ ] pii.config.json 启动加载，错配置启动失败
- [ ] 3 个新 env var 全部支持
- [ ] 升级 v2.20 → v3.x 老 db：history.db 自动 ALTER 加 4 列
- [ ] 0 强制新增 npm 依赖
- [ ] 413 + ~50 = ~465 测试全过
- [ ] CHANGELOG v3.0.0 + README
- [ ] `docs/data-governance.md` 新文档
- [ ] `docs/deferred-items.md` 更新（增加 索引建议/plan diff 到 v3.1+；本批新增 4 项标 v3.0 ✅）

---

## 11. 未来任务（不在本 spec）

- **v3.1 spec**: 索引建议 / Query plan diff（需跨 DB 的 EXPLAIN history）
- **v3.2 spec**: OS keyring / 嵌入式 KMS 集成
- **v3.3 spec**: Oracle / MongoDB 全量 backup（非 schema-only）
- **v3.4 spec**: 跨 profile JOIN / 事务 (XA) — 仍 technical debt
- **#41 db-connect skill 文档**: 完整 v2.16-v3.x 全量能力（仍 pending，Task #41）
