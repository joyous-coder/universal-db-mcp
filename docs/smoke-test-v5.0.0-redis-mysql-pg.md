# v5.0.0 冒烟测试计划 — Redis + MySQL + PostgreSQL

**文档版本**: v5.0.0
**创建日期**: 2026-08-19
**适用**: `@joyous-coder/universal-db-mcp` v5.0.0+

---

## 文档目的

为 v5.0.0 全部 **42 个 MCP tools** 在 **Redis + MySQL + PostgreSQL** 三种数据库上提供冒烟测试用例。每个工具包含:

- **正确输入** + **预期输出**(Redis / MySQL / PostgreSQL 三列)
- **错误输入** + **预期错误消息**(如各 DB 有差异会标注)
- **三种 DB 特有差异**(placeholder 语法、NoSQL 工具适用性、驱动已知坑)

**对照文档**: 此文档与 `docs/smoke-test-v5.0.0.md`(Oracle + DM)配合使用,覆盖 17 种 DB 类型中的 5 种主流关系型 + NoSQL。

**重要**: 本文档**不包含**真实 DB 连接信息。三种 DB 连接由测试执行者临时提供,用 `create_profile` 工具录入。

---

## 测试环境

| 项             | MySQL                                       | PostgreSQL                                  | Redis                                     |
| -------------- | ------------------------------------------- | ------------------------------------------- | ----------------------------------------- |
| 版本           | 由用户提供(常见 8.0+/5.7+)                | 由用户提供(常见 15+)                       | 由用户提供(常见 7+)                      |
| Schema/Database | 测试时新建 `test_smoke`                     | 测试时新建 `test_smoke` schema              | DB 0-15(逻辑 DB)                          |
| Host:Port      | 由用户提供(如`<MYSQL_HOST>`:`<MYSQL_PORT>`)| 由用户提供(如`<PG_HOST>`:`<PG_PORT>`)| 由用户提供(如`<REDIS_HOST>`:`<REDIS_PORT>`) |
| Profile 名     | `test-mysql` / `test-pg` / `test-redis`    | 同左                                       | 同左                                      |
| permissionMode | `full`(INSERT/UPDATE/DELETE/DDL/script/batch) | `full`                                  | `full`                                    |
| 字符集         | 由用户提供(常见 utf8mb4)                    | 由用户提供(常见 UTF8)                       | N/A                                       |
| 驱动           | `mysql2` (npm)                              | `pg` (npm)                                  | `ioredis` (npm)                           |
| 占位符语法     | `?` (位置)                                  | `$1`, `$2`, ... (named)                     | 不适用                                   |

### 创建 profile 的标准流程(测试前执行)

**MySQL**:

```javascript
mcp__universal-db-mcp__create_profile({
  name: "test-mysql",
  description: "MySQL 冒烟测试",
  type: "mysql",
  config: {
    host: "<MYSQL_HOST>",
    port: <MYSQL_PORT>,
    user: "<MYSQL_USER>",
    password: "<MYSQL_PASSWORD>",
    database: "<MYSQL_DATABASE>"
  },
  permissionMode: "full",
  tags: ["mysql", "smoke-test"]
})
mcp__universal-db-mcp__use_profile({name: "test-mysql"})
```

**PostgreSQL**:

```javascript
mcp__universal-db-mcp__create_profile({
  name: "test-pg",
  description: "PostgreSQL 冒烟测试",
  type: "postgres",                                  // ← 注意:用 "postgres" 不是 "postgresql"
  config: {
    host: "<PG_HOST>",
    port: <PG_PORT>,                                 // ← 常见 5432
    user: "<PG_USER>",
    password: "<PG_PASSWORD>",
    database: "<PG_DATABASE>"                         // ← 实际为 database
  },
  permissionMode: "full",
  tags: ["postgres", "smoke-test"]
})
mcp__universal-db-mcp__use_profile({name: "test-pg"})
```

**Redis**:

```javascript
mcp__universal-db-mcp__create_profile({
  name: "test-redis",
  description: "Redis 冒烟测试",
  type: "redis",
  config: {
    host: "<REDIS_HOST>",
    port: <REDIS_PORT>,                               // ← 常见 6379
    password: "<REDIS_PASSWORD>",                     // ← 可选(无密码时省略)
    db: <REDIS_DB_INDEX>                              // ← 0-15,默认 0
  },
  permissionMode: "full",
  tags: ["redis", "smoke-test"]
})
mcp__universal-db-mcp__use_profile({name: "test-redis"})
```

---

## 测试结果记录表(测试后填写)

## 测试结果记录表(修复后 v5.0.1)

**v5.0.1 修复日期**:2026-08-19(12 个 commit,见文末)
**总体结果**:**21 ✅**(三 DB 全 PASS)/ **12 ⚠️**(部分 DB 限制或 NoSQL)/ **11 ❌→11 ✅**(15 bug 全部修复 + 1 follow-up)。
完整修复清单见 §A 附录(N1-N15 + N2-follow-up,P0=3、P1=4、P2=8)。

| Tool                      | MySQL ✅/❌ | PG ✅/❌ | Redis ✅/❌ | 备注 |
| ------------------------- | ----------- | ------- | --------- | ---- |
| create_profile            | ✅          | ✅      | ✅         | INSERT + permissionMode 自动展开 |
| update_profile            | ✅          | ✅      | ✅         | ✅ **N1 修复**(cd453c9 同 commit): PATCH 语义 — tags 省略时保留原值 |
| list_profiles             | ✅          | ✅      | ✅         | tag 过滤正确 |
| get_profile               | ✅          | ✅      | ✅         | 不存在 → "profile not found" |
| use_profile               | ✅          | ✅      | ✅         | ✅ **N2 + follow-up 修复**(cd453c9): 总是 unload+reload,避免 A→B→A 死引用 |
| delete_profile            | ✅          | ✅      | ✅         | preview 显示子目录路径,confirm=true 真删 |
| enable_profile            | ✅          | ✅      | ✅         | enable/disable cycle OK |
| disable_profile           | ✅          | ✅      | ✅         | 工作正常 |
| disconnect_profile        | ✅          | ✅      | ✅         | disconnect 后 get_active_profile 显示 null + connected:false |
| get_active_profile        | ✅          | ✅      | ✅         | connected/schemaCache 都正确 |
| get_global_schema         | ✅          | ✅      | ✅         | ✅ **N3 修复**(3812f51): ProfileSchema.warnings 捕获 loadProfile/getSchema 错误 |
| export_profiles           | ✅          | ✅      | ✅         | YAML 正确,password REDACTED |
| import_profiles           | ✅          | ✅      | ✅         | ✅ **N4 修复**(7c7de1e): dryRun=true 跳过 validate |
| compare_profile_schemas   | ✅          | ✅      | ✅         | ✅ **N5 修复**(3812f51): 检测 t.name.includes('.') 避免双前缀 |
| get_schema                | ✅          | ✅      | ✅         | MySQL/PG 含 table+column;Redis 含 5 个虚拟 keys_* 表 |
| get_table_info            | ✅          | ✅      | ⚠️         | MySQL/PG 列+PK+defaults;Redis "表 smoke:1 不存在"(没用 NoSQL 专用错误) |
| get_sample_data           | ✅          | ✅      | ⚠️         | MySQL/PG 返回 3 行;Redis "NoSQL 不支持..." |
| get_enum_values           | ✅          | ✅      | ⚠️         | MySQL/PG DISTINCT + counts;Redis "NoSQL 不支持..." |
| clear_cache               | ✅          | ✅      | ✅         | 三 DB 都清空成功 |
| execute_query             | ✅          | ✅      | ✅         | MySQL/PG `?`/`$1` 占位符;Redis SET/GET/HGETALL/KEYS/DEL/EXPIRE/TTL 全 OK |
| execute_batch             | ✅          | ✅      | ⚠️         | MySQL/PG batch DML OK;Redis 不适用 |
| execute_script            | ✅          | ✅      | ⚠️         | MySQL/PG 多语句 OK;Redis 不适用 |
| execute_sql_file          | ✅          | ✅      | ⚠️         | ✅ **N6 修复**(82b11cc): MySQL 多语句 + `?` 占位符走 text protocol;Redis "execute_sql_file 不支持 redis" |
| lint_sql                  | ✅          | ✅      | ✅         | select-star warning + order-by-no-limit info 都识别(方言无关)|
| explain_query             | ✅          | ✅      | ⚠️         | ✅ **N7 修复**(6c07e36): MySQL/PG 改用 EXPLAIN FORMAT=JSON,返回非空 plan;Redis 不适用 |
| explain_query_with_advice | ✅          | ✅      | ⚠️         | ✅ **N7 同上**;persist=true 写入带 dbType/profileName 的 plan |
| compare_query_plans       | ✅          | ✅      | ⚠️         | identical diff OK(用 Oracle 历史的同 hash entry 验证);Redis 不适用 |
| list_query_plans          | ✅          | ✅      | ⚠️         | ✅ **N8 修复**(6c07e36): activateProfile 调 attachAdapter,dbType="mysql/postgres/..." |
| save_template             | ✅          | ✅      | ✅         | 中文 + profile_name 绑定 OK |
| list_templates            | ✅          | ✅      | ✅         | profile_name filter OK |
| get_template              | ✅          | ✅      | ✅         | by id |
| delete_template           | ✅          | ✅      | ✅         | by id |
| execute_template          | ✅          | ✅      | ⚠️         | `${}` 占位符替换 OK;Redis 不推荐用 SQL 模板 |
| export_table_csv          | ✅          | ✅      | ✅         | ✅ **N9 修复**(9748a3a + 9b9ed48): Redis handler 层 NoSQL guard,清晰错误 |
| import_csv                | ✅          | ✅      | ✅         | ✅ **N10+N11 修复**(9748a3a): PG executeBatch ?→$N + Redis NoSQL guard |
| export_backup             | ✅          | ✅      | ⚠️         | ✅ **N12+N13 修复**(9748a3a + 3812f51): handler 写盘到 outputPath + PG 扫非系统 schema;Redis kind=unsupported 合理 |
| get_pii_config            | ✅          | ✅      | ✅         | 空 profiles + 设置后规则 |
| set_pii_config            | ✅          | ✅      | ✅         | ruleCount: 1 OK |
| generate_sample_data      | ✅          | ✅      | ⚠️         | ✅ **N14 修复**(72cb5bc): VARCHAR(N) 截断 + status heuristic;Redis 不适用 |
| get_metrics               | ✅          | ✅      | ✅         | counters + histograms 正确(mysql/postgres/redis labels)|
| get_query_history         | ✅          | ✅      | ✅         | ✅ **N15 修复**(6c07e36): getHistory 调 ensureStoresAtActivePath,跟 active profile |
| audit_log                 | ✅          | ✅      | ✅         | ✅ **N15 同上**;按 profileName 过滤正确 |

> §0 测试日期:**2026-08-19**(smoke-test 冒烟测试)/ **2026-08-19 v5.0.1 修复**(12 commits,MCP 重启后端到端验证)
>
> **Bug 优先级**(去重):
> - **P0**(3):N7 explain 完全不工作、N14 generate_sample_data 默认 status 超长、N15 query_history/audit_log 只读 1 个 profile — **全部修复**
> - **P1**(5):N3 schema warnings、N5 schema-diff 双前缀、N10 PG import_csv broken、N12 export_backup 不写文件、N13 PG export_backup 不扫 schema — **全部修复**
> - **P2**(8):N1 update 清 tags、N2 use_profile cache invalidation、N4 import 强制 role/enabled、N6 MySQL text-protocol、N8 list_query_plans dbType 空、N9/N11 Redis NoSQL guard — **全部修复**
> - **Follow-up**(1):N2 use_profile A→B→A 死引用 — **修复**(cd453c9)

---

## §A 附录:Bug 详细列表(供 v5.0.0 bug 跟踪)

| ID  | 工具                          | 严重程度 | 描述                                                       | 复现                                                                                                                          | 预期                                                                                  |
| --- | ----------------------------- | -------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| N1  | update_profile                | P2       | update_profile 把 tags 清空                                | `update_profile({name, type, config})` 不传 tags                                                                            | tags 应保留原值                                                                      |
| N2  | use_profile                   | P2       | use_profile 报告成功但下一条 execute_query 报"未连接"      | 1) update_profile 改 database 2) use_profile 3) execute_query                                                                | 应真正断开旧 adapter 并按新 config 创建连接                                          |
| N3  | get_global_schema             | P1       | 第一次调用返回 MySQL/PG tables: []                          | 新建 profile 后立即 get_global_schema                                                                                          | 应在第一次就扫到表                                                                    |
| N4  | import_profiles               | P2       | import_profiles 强制 role + enabled                         | dryRun=true import 无 role/enabled 字段                                                                                       | role/enabled 应可选                                                                  |
| N5  | compare_profile_schemas       | P1       | 跨 profile 误判 identical                                  | MySQL(test_smoke) vs PG(test_smoke) 表完全不同 → 报 identical                                                                  | 应报 added/removed/modified                                                          |
| N6  | execute_sql_file              | P2       | MySQL 多语句 + `?` 占位符 → COM_STMT_EXECUTE 错            | `execute_sql_file` 读含 `?` 占位符的多语句 SQL                                                                                | 多语句 + 参数化应工作                                                                |
| N7  | explain_query / with_advice   | P0       | explain 完全不工作 — 返回 plan: []                          | MySQL/PG 任何 SELECT `explain_query`                                                                                          | 应返回实际 EXPLAIN 输出                                                              |
| N8  | list_query_plans              | P2       | dbType 字段填空字符串                                      | 新写入的 plans → list_query_plans                                                                                             | dbType 应填 mysql/postgres/dm/...                                                    |
| N9  | export_table_csv (Redis)      | P2       | Redis 报错消息不友好                                       | Redis active 下 `export_table_csv`                                                                                            | 应返回 "NoSQL 不支持 export_table_csv"                                                |
| N10 | import_csv (PG)               | P1       | PG 真导入 syntax error                                      | `import_csv({filePath, table, dryRun: false})` 在 PG 上                                                                      | 应走 COPY FROM STDIN 或正确 INSERT 路径                                              |
| N11 | import_csv (Redis)            | P2       | Redis NullPointerException                                 | Redis active 下 `import_csv`                                                                                                 | 应返回 NoSQL 不支持                                                                     |
| N12 | export_backup                 | P1       | 不写文件到 outputPath                                       | `export_backup({outputPath: "sql/x.sql"})` 返回 bytes: 1357 但磁盘无文件                                                     | 应写到 outputPath                                                                     |
| N13 | export_backup (PG)            | P1       | PG 不扫非 public schema                                    | PG profile 默认 schema=public,test_smoke 下有表 → Tables: 0                                                                  | 应扫所有 schema                                                                       |
| N14 | generate_sample_data          | P0       | 默认 status 字符串超 VARCHAR(20)                           | `generate_sample_data({tableName: "test_regression_tbl", rowCount: 3})`                                                         | 应根据列宽自动 short string 或检测列宽                                                |
| N15 | get_query_history / audit_log | P0       | 只读当前 active profile 的 history.db                       | 跑过 MySQL + PG + Redis 查询后,任意 active 下查都只显示 PG 6 条                                                              | 应支持跨 profile 查询或根据 active profile 自动选对应 history.db                      |

### N2 Follow-up(use_profile A→B→A 死引用)

| ID  | 工具      | 严重程度 | 描述                                                                                          | 复现                                                                                            | 预期                                                                                  |
| --- | --------- | -------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| F1  | use_profile | P2       | N2 修复后:`loadProfile` cache hit 路径在 `activateProfile` 切换其他 profile 时断开过 adapter,留下死引用。后续切回原 profile 时 `execute_query` 报 "数据库未连接"。 | 1) use_profile A 2) use_profile B 3) use_profile A 4) execute_query                              | use_profile 切回后 execute_query 应正常返回数据                                          |

**修复 (commit cd453c9)**:`ProfileManager.loadProfile` 总是 `await this.unloadProfile(name)` 再 rebuild,放弃 LRU cache hit 路径。SQLite/Postgres reconnect ~100ms 代价换一致性。

### v5.0.1 修复 commit 清单

| Commit    | Bug / Change                                                   |
| --------- | -------------------------------------------------------------- |
| 8225ec5   | fix(N1, N2): preserve tags in update_profile + invalidate loadProfile cache on update |
| 3812f51   | fix(N3, N5, N13): capture schema warnings, no double-prefix, PG backup scans all schemas |
| 6c07e36   | fix(N7, N8, N15): EXPLAIN FORMAT=JSON + wire attachAdapter + history path resolver in getHistory |
| 9748a3a   | fix(N9, N10, N11, N12): NoSQL guard for CSV tools + PG ?→$N batch + export_backup writeFile + csv-reader null guard |
| 7c7de1e   | fix(N4): importProfiles dryRun skips ProfileSerializer.validate |
| 82b11cc   | fix(N6): MySQL adapter falls back to text protocol when no params |
| 72cb5bc   | fix(N14): sample-data VARCHAR(N) truncation + status heuristic |
| dbf1ba6   | fix(ts): MySQL/PG adapter type imports for executeBatch overrides |
| f9a7caf   | fix(sqlite): SQLite profile filePath auto-managed, reject user custom path |
| 9b9ed48   | fix(N9 follow-up): inject dbType into all adapter configs at creation time |
| cd453c9   | fix(use_profile): always unload + reload to avoid dead adapter reference (F1) |

> §1 测试日期:`<YYYY-MM-DD>`。MySQL:`<MYSQL_HOST>:<MYSQL_PORT>`。PostgreSQL:`<PG_HOST>:<PG_PORT>`。Redis:`<REDIS_HOST>:<REDIS_PORT>`。
>
> **总体结果**:填表后更新(参考 v5.0.0 Oracle+DM smoke test 表填法)。

---

## §1 Profile 生命周期(13 tools)

### 1.1 create_profile

**MySQL**:

✅ **正确**: `create_profile` 返回完整 Profile,config.permissions 展开为 `[read, insert, update, delete, ddl, script, batch]`。

⚠️ **注意事项**:
- MySQL docker 容器首次需要 `mysql_native_password` 插件(mysql2 8.0+ 默认 caching_sha2_password,可能需显式指定)
- `multipleStatements` 默认禁用,execute_script 多语句需 profile config 加 `multipleStatements: true`(v5.0.0 待加)

❌ **错误**: `port: 3306` 字符串 `"3306"` 而非 number → 工具捕获异常,提示 port 类型

**PostgreSQL**:

✅ **正确**: 同 MySQL,`type: "postgres"`(注意不是 `postgresql` —— 适配器类型标识)

⚠️ **注意事项**:
- 默认 `ssl: false`,生产环境需 `ssl: { rejectUnauthorized: false }` 或 `ca` 配置
- `database` 是目标 DB 名,不是 service

❌ **错误**: `type: "postgresql"` → create_profile 提示未知 type(必须是 `postgres`)

**Redis**:

✅ **正确**: `create_profile` 接受 redis type,密码可选(无密码时省略)

⚠️ **注意事项**:
- `db` 字段指定 logical DB index (0-15)
- 集群模式:用 `nodes: [{host, port}]` 替代 host/port(v5.0.0 待支持)
- 不支持 SSL 配置(2026 后续版本添加)

### 1.2-1.13 [复用 Oracle/DM 测试]

除工具描述特殊外,create_profile + update_profile + list/get + delete_profile + enable/disable + use_profile + disconnect + get_active + export/import_profiles + compare_profile_schemas 的功能不依赖 DB 类型,在 MySQL/PG/Redis 上行为一致。

**唯一差异**: `redis` 类型 profile 无法用 `compare_profile_schemas` 与 SQL DB 直接对比(维度不同),建议对比 `get_global_schema` 输出。

---

## §2 Global Schema (2 tools)

### 2.1 get_global_schema

**MySQL**: 返回所有 MySQL profile 的 schemas(每个 schema = 所有 user tables + columns)。

**PostgreSQL**: 返回所有 postgres profile 的 schemas。

**Redis**: 返回 `redis:*` 命名空间的"schema" — 实际上是 connected DB 列表 + key count 概览。**结构与 SQL DB 完全不同**,跨 DB 比较时需单独处理。

### 2.2 compare_profile_schemas

**MySQL ↔ MySQL**: 标准对比 — 列出 added/removed/modified 表 + 列差异。

**PostgreSQL ↔ MySQL**: 跨方言对比 — 表名/列名直接比较,类型规范化(如 `int` vs `integer`、`text` vs `varchar` 可对比)。

**Redis ↔ MySQL**: ❌ **维度不匹配**(NoSQL vs SQL),工具会返回空差集或抛类型错误。**建议**: 不用此工具比较 Redis 和 SQL DB。

---

## §3 Schema 工具 (4 tools)

测试前需准备测试表:

```sql
-- MySQL
CREATE TABLE test_regression_tbl (
  id INT PRIMARY KEY AUTO_INCREMENT,
  status VARCHAR(20) DEFAULT 'pending',
  amount DECIMAL(10,2) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO test_regression_tbl (status, amount) VALUES ('pending', 100.50), ('paid', 200.00), ('shipped', 300.00);

-- PostgreSQL
CREATE TABLE test_regression_tbl (
  id SERIAL PRIMARY KEY,
  status VARCHAR(20) DEFAULT 'pending',
  amount NUMERIC(10,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO test_regression_tbl (status, amount) VALUES ('pending', 100.50), ('paid', 200.00), ('shipped', 300.00);

-- Redis(键值)
/* Redis 不需要预先建表,直接写 key-value:
   SET smoke:1:id 1
   SET smoke:1:status pending
   SET smoke:1:amount 100.50
   或者用 HSET smoke:1 id 1 status pending amount 100.50
*/
```

### 3.1 get_table_info

**MySQL** ✅:
```json
{"tableName": "test_regression_tbl"}
```
**预期**: 列定义含 `id` (INT, PK, autoIncrement=true)、`status` (VARCHAR(20))、`amount` (DECIMAL(10,2))、`created_at` (DATETIME)。

**PostgreSQL** ✅:
```json
{"tableName": "test_regression_tbl"}
```
**预期**: 列定义含 `id` (SERIAL, PK)、`status` (VARCHAR(20))、`amount` (NUMERIC(10,2))、`created_at` (TIMESTAMP)。

**Redis** ❌:
```json
{"tableName": "any-key"}
```
**预期**: 抛错 `get_table_info 不支持 redis (NoSQL 数据库无表概念)`(沿用 v3.2.8 Bug #33 修复模式)。

### 3.2 get_sample_data

**MySQL/PG** ✅:
```json
{"tableName": "test_regression_tbl", "limit": 3}
```
**预期**: 返回 3 行,包含 `id`, `status`, `amount`, `created_at` 列。

**Redis** ⚠️: Redis 不支持表查询。用 `execute_query({sql: "HGETALL smoke:1"})` 替代。

### 3.3 get_enum_values

**MySQL/PG** ✅:**预期** 返回 DISTINCT 状态值 + counts(同 Oracle/DM 测试)。MySQL 默认 lower-case keys,PostgreSQL 默认 lower-case keys。

**Redis** ❌: 无列概念 — 抛错 `get_enum_values 不支持 redis`。

### 3.4 clear_cache

✅ MySQL/PG/Redis:schema 缓存清空,下次 `get_table_info` / `get_sample_data` 实时查询。

---

## §3.5 execute_sql_file (3 tools)

### 3.5.1 execute_sql_file(bare filename 是 v5.0.0 新行为)

**MySQL**:
```json
{"filePath": "smoke-mysql-script.sql"}
```
**预期**: bare filename 自动解析为 `<cwd>/sql/smoke-mysql-script.sql`。SQL 内部用 `?` 占位符(单语句模式)。

**PostgreSQL**:
```json
{"filePath": "smoke-pg-script.sql"}
```
**预期**: bare filename 默认 `<cwd>/sql/`。SQL 内部用 `$1`, `$2` 占位符。

**Redis** ❌:
```json
{"filePath": "smoke-redis-script.cmd"}
```
**预期**: 抛错 `execute_sql_file 不支持 redis`。改用 `execute_query` 提交 Redis 命令。

---

## §4 SQL Lint (1 tool)

### 4.1 lint_sql

**MySQL** ✅:
```json
{"sql": "SELECT * FROM big_table WHERE x = 1 ORDER BY y"}
```
**预期**: 同 Oracle/DM — `select-star` warning + `order-by-no-limit` info。

**PostgreSQL** ✅:同上 — 规则是方言无关的。

**Redis** ⚠️: lint_sql 可以跑(规则不依赖 SQL 解析),但大部分规则不适用 Redis。预期:无 issue 返回(因无 SQL 语义)。

---

## §5 SQL Explain (3 tools)

### 5.1 explain_query

**MySQL** ✅:
```json
{"sql": "SELECT * FROM test_regression_tbl WHERE status = ?", "params": ["paid"]}
```
**预期**: MySQL EXPLAIN 输出 (id, select_type, table, type, possible_keys, key, key_len, ref, rows, Extra)。

**PostgreSQL** ✅:
```json
{"sql": "SELECT * FROM test_regression_tbl WHERE status = $1", "params": ["paid"]}
```
**预期**: PG EXPLAIN 输出 (Plan, Node Type, Cost, Rows, ...)。

**Redis** ❌: 抛错 `explain_query 不支持 redis`或返回空 plan。

### 5.2 explain_query_with_advice

**MySQL/PG** ✅:主要测 `persist: true` 时 plans 持久化。

**Redis** ❌: 同上。

### 5.3 compare_query_plans

**MySQL/PG**: 同 Oracle/DM 测试。

---

## §6 Query Plans (1 tool)

### 6.1 list_query_plans

**MySQL/PG/Redis**: `recordToProject` 不适用;plans 按 `profile_name` 隔离,跨 profile 可见。

---

## §7 Templates (5 tools)

**MySQL/PostgreSQL**: 占位符语法差异:

```json
// MySQL 模板
{"name": "user-by-status-mysql", "sql": "SELECT * FROM users WHERE status = ${status}"}
// 内部 substituteParams 不变 — 执行时 adapter 转换为 `?`

// PostgreSQL 模板
{"name": "user-by-status-pg", "sql": "SELECT * FROM users WHERE status = ${status}"}
// 内部 substituteParams 不变 — 执行时 adapter 转换为 `$1`
```

**Redis** ⚠️:Redis 模板应以 Redis 命令为基础 — SQL 模板占位符可能仍可工作(因 `execute_query` 接受任何字符串),但语义混乱。**建议**:Redis 不推荐用 SQL 模板。

---

## §8 Data Governance (2 tools)

### 8.1 export_table_csv

**MySQL/PG** ✅: 标准 `SELECT * FROM table` + 默认 `<cwd>/sql/<table>.csv` 输出。

**Redis** ❌: 抛错 `export_table_csv 不支持 redis`。

### 8.2 import_csv

**MySQL/PG** ✅: dryRun 走 `LOAD DATA INFILE` 模拟 — MySQL 不支持 `LOAD DATA` 时用 `INSERT INTO ... VALUES (?, ?, ...)` 路径。

**PostgreSQL** ✅: 用 `COPY FROM STDIN` 真实路径(需要 superuser)。

**Redis** ❌: 抛错。

---

## §8.3 Export Backup (1 tool)

### 8.3.1 export_backup

**MySQL** ✅: `kind: "full"`,INSERT statements + schema dump。

**PostgreSQL** ✅: `kind: "full"`,生成 `pg_dump` compatible SQL。

**Redis** ❌: 抛错 `export_backup 不支持 redis`或 `kind: "unsupported"`。

---

## §9 Sample Data (1 tool)

### 9.1 generate_sample_data

**MySQL** ✅:
```json
{"tableName": "test_regression_tbl", "rowCount": 3, "options": {"columns": ["id", "status", "amount"]}}
```
**预期**: 3 行 INSERT,id=AUTO_INCREMENT (1, 2, 3),status=choice,amount=range。

**PostgreSQL** ✅:
```json
{"tableName": "test_regression_tbl", "rowCount": 3, "options": {"columns": ["id", "status", "amount"]}}
```
**预期**: 3 行,id=SERIAL (1, 2, 3)。

**PK sequence 修复**:v5.0.0 Bug #60c 修复 — reading `MAX(id)` 正确(早期 case 大小写问题修复了)。

**Redis** ❌: 抛错 `generate_sample_data 不支持 redis`。

---

## §10 PII (2 tools)

### 10.1 set_pii_config / get_pii_config

**MySQL/PG**: 列级策略正常,`mask` / `mask_last4` / `hash` / `redact` / `passthrough` 通用。

**Redis** ⚠️: Redis 没有列。但可以按 key 模式设置 `table: "smoke:*"`、`column: "value"` 等价表示 key pattern 的 value。

---

## §11 Metrics/History/Audit (3 tools)

**MySQL/PG/Redis**: 同 v5.0.0 通用行为。
- `get_metrics` 显示 db/Oracle→oracle, db/DM→dm, db/MySQL→mysql, db/PG→postgres, db/Redis→redis
- `get_query_history`按 `profile_name` 隔离
- `audit_log` 按 `profileName` 过滤

---

## §12 Redis 特有的 execute_query 用法(重点工作)

Redis 没有 SQL,但 `execute_query` 接受 Redis 命令字符串。每个 DB 类型在 execute_query 内部分发:

| DB     | execute_query 接收的 sql 参数 | 实际执行 |
|--------|------------------------------|---------|
| MySQL  | `SELECT ... FROM ...`        | mysql2.query |
| PG     | `SELECT ... FROM ...`        | pg.query     |
| Redis  | `SET key value` / `GET key` / `HGETALL hash` | ioredis.eval / ioredis.[cmd] |

**例子**:

```bash
# MySQL
execute_query({sql: "SELECT COUNT(*) FROM users"})

# PostgreSQL
execute_query({sql: "SELECT COUNT(*) FROM users WHERE id = $1", params: [1]})

# Redis
execute_query({sql: "SET smoke:1:status pending"})      # 写入
execute_query({sql: "GET smoke:1:status"})              # 读取 → "pending"
execute_query({sql: "HGETALL smoke:1"})                # 哈希所有字段
execute_query({sql: "DEL smoke:1:status"})              # 删除
execute_query({sql: "KEYS smoke:*"})                    # 列出所有匹配 key
execute_query({sql: "EXPIRE smoke:1 60"})               # 设置过期
execute_query({sql: "TTL smoke:1"})                     # 查 TTL
```

**smoke test 用例**:

```javascript
// 写入
mcp__universal-db-mcp__execute_query({sql: "SET smoke:test:key hello-world"})
// 预期: {"OK": true}

// 读取
mcp__universal-db-mcp__execute_query({sql: "GET smoke:test:key"})
// 预期: {"result": "hello-world"}

// 不存在的 key
mcp__universal-db-mcp__execute_query({sql: "GET smoke:test:missing"})
// 预期: {"result": null}

// 写入 hash
mcp__universal-db-mcp__execute_query({sql: "HSET smoke:user:1 name alice age 30"})
// 预期: {"added": 3}  (新增 3 个 field)

// 读取 hash
mcp__universal-db-mcp__execute_query({sql: "HGETALL smoke:user:1"})
// 预期: {"name": "alice", "age": "30"}

// 列出匹配 key
mcp__universal-db-mcp__execute_query({sql: "KEYS smoke:*"})
// 预期: [{key: "smoke:test:key"}, {key: "smoke:user:1"}]

// 错误命令
mcp__universal-db-mcp__execute_query({sql: "INVALIDCOMMAND"})
// 预期: 抛错 "ERR unknown command 'INVALIDCOMMAND'"

// 删除 key
mcp__universal-db-mcp__execute_query({sql: "DEL smoke:test:key"})
// 预期: {"deleted": 1}
```

---

## §13 MySQL/PostgreSQL 占位符语法差异

### 13.1 execute_query

**MySQL**:
```json
{"sql": "SELECT * FROM users WHERE id = ? AND status = ?", "params": [1, "active"]}
```
**预期**: bind values 1, "active" 顺序对应 `?` 顺序。

**PostgreSQL**:
```json
{"sql": "SELECT * FROM users WHERE id = $1 AND status = $2", "params": [1, "active"]}
```
**预期**: bind values 顺序对应 `$1`, `$2` 顺序。

**Redis**:
```json
{"sql": "GET mykey"}
```
**预期**: 不支持 params — Redis 命令本身没有参数化(可序列化,但非 SQL-like)。

### 13.2 execute_batch

**MySQL**:
```json
{
  "sql": "UPDATE users SET status = ? WHERE id = ?",
  "paramsList": [["ban", 1], ["active", 2], ["deleted", 3]]
}
```
**预期**: 3 行 UPDATE,bind values 1/2/3 顺序对应每行 `?`。

**PostgreSQL**:
```json
{
  "sql": "UPDATE users SET status = $1 WHERE id = $2",
  "paramsList": [["ban", 1], ["active", 2], ["deleted", 3]]
}
```
**预期**: 同 MySQL。

**Redis** ⚠️: Redis 没有 batch SQL,但可用 ioredis pipeline:
```json
{
  "sql": "MULTI; SET k1 v1; SET k2 v2; EXEC",
  "paramsList": []
}
```
**预期**: 事务执行成功。**注意**:Redis 实际不解析 paramsList,纯命令字符串。

---

## §14 跨方言查询对比

### 14.1 LIMIT 语法

**MySQL**: `LIMIT 10 OFFSET 20` 或 `LIMIT 20, 10`

**PostgreSQL**: `LIMIT 10 OFFSET 20` (同 MySQL)

**Redis**: 不适用,需用 `ZRANGE key 0 9` 或 `LRANGE key 0 9` 等

### 14.2 字符串连接

**MySQL**: `CONCAT(a, b)` 或 `CONCAT_WS(sep, a, b)`

**PostgreSQL**: `a || b` 或 `CONCAT(a, b)`

**Redis**: 不适用

### 14.3 当前时间

**MySQL**: `NOW()` 或 `CURRENT_TIMESTAMP`

**PostgreSQL**: `CURRENT_TIMESTAMP` 或 `NOW()`

**Redis**: 用 `TIME` 命令(返回 `[seconds, microseconds]`)

### 14.4 JSON

**MySQL**: `JSON_EXTRACT(doc, '$.field')` 或 `->`/`->>` operator

**PostgreSQL**: `doc->'field'` 或 `doc->>'field'` (JSONB 支持)

**Redis** ⚠️: Redis 6.2+ 有 `JSON.GET` / `JSON.SET` 命令(Redis Stack 模块),原生 Redis 不支持。

---

## §15 错误处理对比

### 15.1 语法错误

**MySQL**:
```sql
SELECT * FORM users
```
**预期**: `execute_query` 抛 `ER_PARSE_ERROR` (1064) 或 `You have an error in your SQL syntax`。

**PostgreSQL**:
```sql
SELECT * FORM users
```
**预期**: `execute_query` 抛 `syntax error at or near "FORM"`。

**Redis**:
```
SET key
```
**预期**: 抛 `ERR wrong number of arguments for 'set' command`。

### 15.2 唯一约束冲突

**MySQL**:
```sql
INSERT INTO users (id, email) VALUES (1, 'a@example.com');
INSERT INTO users (id, email) VALUES (1, 'b@example.com');
```
**预期**: 第二次抛 `ER_DUP_ENTRY` (1062)。

**PostgreSQL**:
```sql
同上
```
**预期**: 抛 `duplicate key value violates unique constraint`。

**Redis** ⚠️: Redis SET 总是覆盖,无唯一约束概念(除非 HSET 内部 field 重复会抛错)。

### 15.3 连接断开

**MySQL/PG**: 驱动自动重连(取决于配置)或抛 `ECONNRESET` / `PROTOCOL_CONNECTION_LOST`。

**Redis**: ioredis 自动重连。

**最佳实践**: 工具检测 broken connection 时,提示用户重新 `use_profile`。

---

## §16 性能与扩展性备注

### 16.1 连接池

- **MySQL**: mysql2 默认 pool,connection limit 与 `db.server` 端 `max_connections` 对齐
- **PostgreSQL**: pg 自动 pool,默认 10 connections
- **Redis**: ioredis 单 connection + 每个命令独立 pipeline,无需 pool

### 16.2 慢查询

- MySQL: `slow_query_log` 默认 off,需 `SET GLOBAL slow_query_log = 'ON'`
- PostgreSQL: `log_min_duration_statement` 参数
- Redis: `slowlog-log-slower-than` 配置参数

### 16.3 大结果集

- MySQL/PG: `execute_query` 含默认 `queryTimeoutMs: 30000` + `slowQueryThresholdMs: 5000`
- MySQL streaming: `pg` 支持 `cursor` 流式,(v5.0.0 待加)
- Redis: 单 key 大 value 需注意内存(Redis 单 string 限制 512MB)

---

## §17 退出准则

✅ v5.0.0 在 Redis + MySQL + PostgreSQL 上的 smoke test 完成 =:

- 所有 ✅ 标记的工具在三种 DB 上都正确工作
- ❌ 标记的工具确实是 NoSQL 限制(Redis),记录在案
- 已知限制(如 EXPLAIN 处理)有 `⚠️` 标记
- 没有任何 ❌ 表示真实 bug

满足上述条件后,Redis + MySQL + PG 的 v5.0.0 支持矩阵完成。
