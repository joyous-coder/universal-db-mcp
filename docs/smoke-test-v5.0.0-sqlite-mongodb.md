# v5.0.0 冒烟测试计划 — SQLite + MongoDB

**文档版本**: v5.0.0
**创建日期**: 2026-08-19
**适用**: `@joyous-coder/universal-db-mcp` v5.0.0+

---

## 文档目的

为 v5.0.0 全部 **42 个 MCP tools** 在 **SQLite + MongoDB** 两种数据库上提供冒烟测试用例。每个工具包含:

- **正确输入** + **预期输出**(SQLite / MongoDB 两列)
- **错误输入** + **预期错误消息**
- **两种 DB 特有差异**(placeholder 语法、NoSQL 工具适用性、驱动已知坑)

**对照文档**: 此文档与 `docs/smoke-test-v5.0.0.md`(Oracle + DM)、`docs/smoke-test-v5.0.0-redis-mysql-pg.md`(Redis + MySQL + PG)配合使用,覆盖 17 种 DB 类型中的 7 种。本组侧重**零外部依赖**(SQLite)和**容器化 NoSQL**(MongoDB via Docker),可作为其他 DB 验证的参考模板。

**重要**: 本文档**不包含**真实 DB 连接信息。MongoDB 连接由测试执行者临时启动 Docker,SQLite 无需额外配置(v5.0.1 自动管理文件路径)。

---

## 测试环境

| 项              | SQLite                                                                                                                | MongoDB                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 部署            | 嵌入式,无需启动服务                                                                                                   | WSL Docker`mongo:7` 容器                                          |
| 启动命令        | 无                                                                                                                    | `wsl docker run -d --name smoke-mongo -p 27017:27017 mongo:7`     |
| Schema/Database | 测试时新建`~/.universal-db-mcp/<profile>/data.db`                                                                   | DB`smoke`,collections: `users`, `test_regression_tbl`         |
| Host:Port       | N/A(v5.0.1 filePath 自动管理到`~/.universal-db-mcp/<name>/data.db`)                                                 | `127.0.0.1:27017`(WSL2 Docker 端口转发)                           |
| Profile 名      | `test-sqlite` / `<任意>`                                                                                          | `test-mongo`                                                      |
| permissionMode  | `full`(INSERT/UPDATE/DELETE/DDL/script/B)                                                                           | `full`                                                            |
| 字符集          | N/A                                                                                                                   | UTF-8                                                               |
| 驱动            | `node:sqlite` (Node 22.5+) / `better-sqlite3`                                                                     | `mongodb` (npm)                                                   |
| 占位符语法      | `?` / `$1, $2, ...` (两种都支持)                                                                                  | 不适用(JSON-like 操作)                                              |
| 特殊            | v5.0.1: SQLite profile 不接受 user 传`filePath`(自动放 `~/.universal-db-mcp/<name>/data.db`),仅 `:memory:` 例外 | v5.0.1: MongoDB 是 NoSQL,`export_table_csv`/`import_csv` 应拒收 |

### 创建 profile 的标准流程(测试前执行)

**SQLite**(v5.0.1:不传 filePath):

```javascript
mcp__universal-db-mcp__create_profile({
  name: "test-sqlite",
  description: "SQLite 冒烟测试",
  type: "sqlite",
  config: {
    // 不传 filePath — 工具自动用 ~/.universal-db-mcp/test-sqlite/data.db
    allowWrite: true,
  },
  permissionMode: "full",
  tags: ["sqlite", "smoke-test"]
})
mcp__universal-db-mcp__use_profile({name: "test-sqlite"})
```

**MongoDB**:

```javascript
mcp__universal-db-mcp__create_profile({
  name: "test-mongo",
  description: "MongoDB 冒烟测试",
  type: "mongodb",
  config: {
    host: "127.0.0.1",
    port: 27017,
    database: "smoke",
    authSource: "admin"   // v3.2.7 Bug #27 fix: 无 auth 时默认 admin
  },
  permissionMode: "full",
  tags: ["mongodb", "smoke-test"]
})
mcp__universal-db-mcp__use_profile({name: "test-mongo"})
```

---

## 测试结果记录表(2026-08-20 完整实测,v5.0.2 修复后)

**§0 测试日期**: 2026-08-20。SQLite: 嵌入式(`~/.universal-db-mcp/test-sqlite/data.db`)。MongoDB: WSL Docker `mongo:7` 容器(`--restart unless-stopped`,直接连 `127.0.0.1:27017`)。

**总体结果**: **SQLite 42 tool 全 PASS**(实测)。MongoDB 全部 ✅ 或 ⚠️(部分 NoSQL 不适用)。**N17、N18 已修复(v5.0.2)** — commit `10c86ad` 验证通过。

| Tool                      | SQLite ✅/❌ | MongoDB ✅/❌ | 备注 |
| ------------------------- | ----------- | ------------ | ---- |
| create_profile            | ✅          | ✅           | SQLite 不传 filePath(自动管理);MongoDB authSource 默认 |
| update_profile            | ✅          | ✅           | N1 修复 |
| list_profiles             | ✅          | ✅           | tag 过滤 |
| get_profile               | ✅          | ✅           | by name |
| use_profile               | ✅          | ✅           | SQLite + MongoDB use_profile OK |
| delete_profile            | ✅          | ✅           | preview + 真删 |
| enable_profile            | ✅          | ✅           | |
| disable_profile           | ✅          | ✅           | |
| disconnect_profile        | ✅          | ✅           | |
| get_active_profile        | ✅          | ✅           | connected: true |
| get_global_schema         | ✅          | ✅           | SQLite: smoke_test 列;MongoDB: test_regression_tbl + users 含字段类型 |
| export_profiles           | ✅          | ✅           | YAML, password REDACTED |
| import_profiles           | ✅          | ✅           | N4 dryRun skip validate |
| compare_profile_schemas   | ✅          | ⚠️           | SQLite 自测 OK;MongoDB ↔ SQLite 跨维度不适用 |
| get_schema                | ✅          | ✅           | MongoDB 含 2 collection + fields 类型推断 |
| get_table_info            | ✅          | ✅           | MongoDB 含 _id (objectid) PK + columns |
| get_sample_data           | ✅          | ⚠️           | MongoDB: "mongodb 是 NoSQL 数据库,不支持 get_sample_data" |
| get_enum_values           | ✅          | ⚠️           | MongoDB: "mongodb 是 NoSQL 数据库,不支持 get_enum_values" |
| clear_cache               | ✅          | ✅           | |
| execute_query             | ✅          | ✅           | ✅ v5.0.2: MongoDB `db.x.insertMany([{...},...])` shell-format 插入 3 行成功(N17 修复);`db.x.find({})` / `updateOne` / `deleteMany` 全 OK |
| execute_batch             | ✅          | ⚠️           | MongoDB: JSON 不识别;设计上 MongoDB 走 execute_query 即可 |
| execute_script            | ✅          | ⚠️           | MongoDB: 多语句被 `检测到 PL/SQL 块或多语句脚本` guard 拒绝(实际 MongoDB adapter 不支持多语句) |
| execute_sql_file          | ✅          | ⚠️           | MongoDB: 不适用 |
| lint_sql                  | ✅          | ⚠️           | MongoDB JSON 触发 "Double-quoted identifier" false warning |
| explain_query             | ✅          | ⚠️           | MongoDB: 不适用 |
| explain_query_with_advice | ✅          | ⚠️           | MongoDB: 不适用 |
| compare_query_plans       | ✅          | ⚠️           | MongoDB: 不适用 |
| list_query_plans          | ✅          | ⚠️           | MongoDB: 不适用 |
| save_template             | ✅          | ✅           | MongoDB JSON template + json 类型 param 可保存 |
| list_templates            | ✅          | ✅           | |
| get_template              | ✅          | ✅           | |
| delete_template           | ✅          | ✅           | |
| execute_template          | ✅          | ✅           | ✅ v5.0.2: MongoDB JSON template `type: 'json'` 占位符替换保留 JSON 结构(N18 修复)。例:`{"collection":"users","operation":"find","query":{"status":${status}}}` + `params: {status: "active"}` → 返回 1 行 alice |
| export_table_csv          | ✅          | ✅           | MongoDB NoSQL guard 清晰错误 |
| import_csv                | ✅          | ✅           | MongoDB NoSQL guard 清晰错误 |
| export_backup             | ✅          | ⚠️           | MongoDB: collection → JSON dump(adapter 默认实现) |
| get_pii_config            | ✅          | ✅           | |
| set_pii_config            | ✅          | ✅           | ruleCount: 1 |
| generate_sample_data      | ✅          | ⚠️           | MongoDB: 不适用 |
| get_metrics               | ✅          | ✅           | db/mongodb label 正确 |
| get_query_history         | ✅          | ✅           | 仅 test-mongo entries(N15 修复生效) |
| audit_log                 | ✅          | ✅           | profileName=test-mongo 过滤 OK |

> §0 测试日期:**2026-08-20**。SQLite 全部 PASS;MongoDB 全部 ✅ 或 ⚠️(部分 NoSQL 不适用),**N17+N18 已修复**(v5.0.2 commit `10c86ad`)。
>
> **Bug 优先级**:
> - 全部修复(15 + 1 follow-up + N17 + N18 = 18 个 bug 跨 v5.0.1 + v5.0.2)

---

## §A 附录:Bug 详细列表(全部已修复,跨 v5.0.1 + v5.0.2)

| ID                        | 工具                      | 严重程度 | 状态                | 描述                                                               | 复现                                                                                                                                          | 修复                                                                                                                                                                                                                       |
| ------------------------- | ------------------------- | -------- | ------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1                        | MongoDB 连接(WSL2 docker) | 阻塞     | ✅ v5.0.1(infra)    | WSL2 docker container 端口暴露 + Windows firewall 拦 inbound       | `wsl docker run -p 27017:27017 mongo:7` + Windows `nc 127.0.0.1:27017` → ECONNREFUSED                                                            | 手动开 firewall 规则:`netsh advfirewall firewall add rule name="mongo-27017" dir=in action=allow protocol=TCP localport=27017` (需 admin)                                                                                    |
| N16                       | execute_template          | P2       | ✅ v5.0.1(design)   | execute_template `id` 字段期望 nanoid(id),不接 `name`              | `execute_template({id: "sqlite-tmpl"})` → "template not found"                                                                                  | 用 `id` 调用(实际设计选择);list_templates 返回的 `id` 是 nanoid                                                                                                                                                              |
| N17                       | MongoDB adapter parseQuery | P1       | ✅ v5.0.2           | `db.coll.insertMany([{...},{...}])` shell-format 被 fallback 取 parsed[0],只插入 1 行/报"需要文档数组" | `execute_query 'db.users.insertMany([{name:"a",age:1},{name:"b",age:2}])'` → 只插 1 行                                                            | `src/adapters/mongodb.ts:222-225` — insertMany / insert 操作直接用整个数组;`tests/unit/mongodb-adapter.test.ts` 7 个 case                                                                                                                                                |
| N18                       | sql-template substituteParams | P1   | ✅ v5.0.2           | TemplateParam 不支持 `json` 类型,占位符替换为 SQL string 后丢 JSON 结构 | `execute_template(json_tmpl, {status: "active"})` → MongoDB 收到 `'active'` 而非 `"active"` → query 语法错误                                            | `src/core/query-analyzer-types.ts:113` 加 `'json'` union;`src/utils/sql-template.ts` 加 `case 'json': return JSON.stringify(v)`;`tests/unit/sql-template.test.ts` 2 个 case                                                                       |
| create_profile            |                           |          | INSERT + permissionMode 自动展开;SQLite 不接受 filePath            |                                                                                               |                                                                                                                                               |
| update_profile            |                           |          | tags PATCH 语义保留                                                |                                                                                               |                                                                                                                                               |
| list_profiles             |                           |          | tag 过滤正确                                                       |                                                                                               |                                                                                                                                               |
| get_profile               |                           |          | 不存在 → "profile not found"                                      |                                                                                               |                                                                                                                                               |
| use_profile               |                           |          | 总是 unload+reload(防 A→B→A 死引用)                              |                                                                                               |                                                                                                                                               |
| delete_profile            |                           |          | preview 显示子目录路径,confirm=true 真删                           |                                                                                               |                                                                                                                                               |
| enable_profile            |                           |          | enable/disable cycle OK                                            |                                                                                               |                                                                                                                                               |
| disable_profile           |                           |          | 工作正常                                                           |                                                                                               |                                                                                                                                               |
| disconnect_profile        |                           |          | disconnect 后 get_active_profile 显示 null + connected:false       |                                                                                               |                                                                                                                                               |
| get_active_profile        |                           |          | connected/schemaCache 都正确                                       |                                                                                               |                                                                                                                                               |
| get_global_schema         |                           |          | ProfileSchema.warnings 字段含真实错误                              |                                                                                               |                                                                                                                                               |
| export_profiles           |                           |          | YAML 正确,password REDACTED                                        |                                                                                               |                                                                                                                                               |
| import_profiles           |                           |          | dryRun=true 跳过 validate                                          |                                                                                               |                                                                                                                                               |
| compare_profile_schemas   |                           |          | 不双前缀                                                           |                                                                                               |                                                                                                                                               |
| get_schema                |                           |          | SQLite:sqlite_master;MongoDB:collections 列表                      |                                                                                               |                                                                                                                                               |
| get_table_info            |                           |          | SQLite/MongoDB:返回表/collection 信息                              |                                                                                               |                                                                                                                                               |
| get_sample_data           |                           |          | SQLite:3 行;MongoDB:find().limit(3)                                |                                                                                               |                                                                                                                                               |
| get_enum_values           |                           |          | SQLite:DISTINCT;MongoDB:不适用                                     |                                                                                               |                                                                                                                                               |
| clear_cache               |                           |          | 两 DB 都清空成功                                                   |                                                                                               |                                                                                                                                               |
| execute_query             |                           |          | SQLite`?`/`$1` 占位符;MongoDB `db.collection.find({})`       |                                                                                               |                                                                                                                                               |
| execute_batch             |                           |          | SQLite batch DML OK;MongoDB 不适用                                 |                                                                                               |                                                                                                                                               |
| execute_script            |                           |          | SQLite 多语句 OK;MongoDB 不适用                                    |                                                                                               |                                                                                                                                               |
| execute_sql_file          |                           |          | SQLite 多语句 +`?` 走 text protocol;MongoDB 不适用               |                                                                                               |                                                                                                                                               |
| lint_sql                  |                           |          | warning + info 都识别                                              |                                                                                               |                                                                                                                                               |
| explain_query             |                           |          | SQLite EXPLAIN QUERY PLAN;MongoDB 不适用                           |                                                                                               |                                                                                                                                               |
| explain_query_with_advice |                           |          | 同上                                                               |                                                                                               |                                                                                                                                               |
| compare_query_plans       |                           |          | SQLite 同 hash entry OK;MongoDB 不适用                             |                                                                                               |                                                                                                                                               |
| list_query_plans          |                           |          | dbType="sqlite" 或 "mongodb"                                       |                                                                                               |                                                                                                                                               |
| save_template             |                           |          | 中文 + profile_name 绑定 OK                                        |                                                                                               |                                                                                                                                               |
| list_templates            |                           |          | profile_name filter OK                                             |                                                                                               |                                                                                                                                               |
| get_template              |                           |          | by id                                                              |                                                                                               |                                                                                                                                               |
| delete_template           |                           |          | by id                                                              |                                                                                               |                                                                                                                                               |
| execute_template          |                           |          | `${}` 占位符替换 OK                                              |                                                                                               |                                                                                                                                               |
| export_table_csv          |                           |          | SQLite:标准 SQL;**MongoDB**:NoSQL guard 应清晰拒收           |                                                                                               |                                                                                                                                               |
| import_csv                |                           |          | SQLite:dryRun + 真导入 OK;**MongoDB**:NoSQL guard 应清晰拒收 |                                                                                               |                                                                                                                                               |
| export_backup             |                           |          | SQLite:CREATE+INSERT;**MongoDB**:collection → JSON dump     |                                                                                               |                                                                                                                                               |
| get_pii_config            |                           |          | 空 profiles                                                        |                                                                                               |                                                                                                                                               |
| set_pii_config            |                           |          | ruleCount: 1 OK                                                    |                                                                                               |                                                                                                                                               |
| generate_sample_data      |                           |          | SQLite VARCHAR(N) 截断;MongoDB 不适用                              |                                                                                               |                                                                                                                                               |
| get_metrics               |                           |          | counters + histograms 正确                                         |                                                                                               |                                                                                                                                               |
| get_query_history         |                           |          | 跟 active profile 切换                                             |                                                                                               |                                                                                                                                               |
| audit_log                 |                           |          | 按 profileName 过滤                                                |                                                                                               |                                                                                                                                               |

> §0 测试日期:`<YYYY-MM-DD>`。

---

## §1 Profile 生命周期(13 tools)

### 1.1 create_profile

**SQLite**:

✅ **正确**: `create_profile({name, type: "sqlite", config: { allowWrite: true }})` 返回完整 Profile。`filePath` 不接受(自动生成 `~/.universal-db-mcp/<name>/data.db`)。

⚠️ **注意事项**:

- v5.0.1: SQLite profile 不接受 `config.filePath`(`filePath: "D:/..."` 报 "SQLite profile 不接受 config.filePath='...'",仅 `:memory:` 字面量例外)

**MongoDB**:

✅ **正确**: `create_profile({name, type: "mongodb", config: { host, port, database, authSource: "admin" }})` 返回 Profile。

⚠️ **注意事项**:

- v3.2.7 Bug #27 fix: 无 auth 时默认 `authSource: "admin"`(已自动注入,无需手设)
- 用户名密码可选(`mongo:7` 默认无 auth,直接连)

### 1.2-1.13 [复用 Redis+MySQL+PG 测试]

除 SQLite filePath / MongoDB NoSQL 差异外,13 个 profile 生命周期工具在 SQLite / MongoDB 上行为一致。

---

## §2 Global Schema (2 tools)

### 2.1 get_global_schema

**SQLite**: 返回所有 SQLite profile 的 schema(每个 profile = 所有 table + columns)。`filePath` 路径自动管理,get_schema 走 `sqlite_master`。

**MongoDB**: 返回所有 MongoDB profile 的 schema(每个 profile = 所有 collections + sample document fields)。

### 2.2 compare_profile_schemas

**SQLite ↔ SQLite**: 标准对比。

**SQLite ↔ MongoDB**: ❌ **维度不匹配**(RDBMS vs NoSQL),工具可能返回空差集或抛类型错误。**建议**: 不用此工具比较 SQLite 和 MongoDB。

**MongoDB ↔ MongoDB**: 同上,但 collection 维度可对比。

---

## §3 Schema 工具 (4 tools)

测试前需准备测试表/collection:

**SQLite**:

```sql
CREATE TABLE test_regression_tbl (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT DEFAULT 'pending',
  amount REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO test_regression_tbl (status, amount) VALUES ('pending', 100.50), ('paid', 200.00), ('shipped', 300.00);
```

**MongoDB**(用 `execute_query` 提交):

```javascript
// 通过 MongoDB adapter 的 execute_query 路径:
// SQL 字符串不适用 — MongoDB 是文档型,需直接发命令
db.test_regression_tbl.insertMany([
  { status: 'pending', amount: 100.50 },
  { status: 'paid', amount: 200.00 },
  { status: 'shipped', amount: 300.00 },
]);
db.users.insertMany([
  { name: 'alice', email: 'a@example.com', status: 'active', age: 30 },
  { name: 'bob', email: 'b@example.com', status: 'ban', age: 25 },
]);
```

### 3.1 get_table_info

**SQLite** ✅: `{tableName: "test_regression_tbl"}` 返回列定义含 `id`(INTEGER, PK, autoIncrement=true)、`status`(TEXT)、`amount`(REAL)、`created_at`(DATETIME)。

**MongoDB**: 返回 collection 信息(sample document fields)。

### 3.2 get_sample_data

**SQLite** ✅: 返回 3 行,含 `id`, `status`, `amount`, `created_at` 列。

**MongoDB**: 返回 sample documents(`find().limit(3)`)。

### 3.3 get_enum_values

**SQLite** ✅: 返回 DISTINCT 状态值 + counts。

**MongoDB** ❌: 无列概念 — 抛错或返回空(适配器层处理)。

### 3.4 clear_cache

✅ SQLite/MongoDB:schema 缓存清空。

---

## §3.5 execute_sql_file (SQLite 适用)

**SQLite**:

```json
{"filePath": "smoke-sqlite-script.sql"}
```

**预期**: bare filename 自动解析为 `<cwd>/sql/smoke-sqlite-script.sql`。SQL 内部用 `?` 占位符(单语句模式)。

**MongoDB** ❌: `execute_sql_file` 不适用。

---

## §4 SQL Lint (1 tool)

### 4.1 lint_sql

**SQLite** ✅:

```json
{"sql": "SELECT * FROM big_table WHERE x = 1 ORDER BY y"}
```

**预期**: `select-star` warning + `order-by-no-limit` info。

**MongoDB** ⚠️: lint_sql 可以跑(规则不依赖 SQL 解析),但大部分规则不适用 MongoDB。预期:无 issue 返回。

---

## §5 SQL Explain (3 tools)

### 5.1 explain_query

**SQLite** ✅:

```json
{"sql": "SELECT * FROM test_regression_tbl WHERE status = ?", "params": ["paid"]}
```

**预期**: SQLite EXPLAIN QUERY PLAN 输出 (`id|parent|notused|detail` 格式)。

**MongoDB** ❌: 不适用,抛错或返回空。

### 5.2 explain_query_with_advice

**SQLite** ✅: 主要测 `persist: true` 时 plans 持久化。

**MongoDB** ❌: 同上。

### 5.3 compare_query_plans

**SQLite**: 同 SQLite 同 hash entry OK。

**MongoDB** ❌: 不适用。

---

## §6 Query Plans (1 tool)

### 6.1 list_query_plans

**SQLite/MongoDB**: `recordToProject` 不适用;plans 按 `profile_name` 隔离。

---

## §7 Templates (5 tools)

**SQLite/MongoDB**: 占位符语法差异:

```json
// SQLite 模板
{"name": "user-by-status-sqlite", "sql": "SELECT * FROM users WHERE status = ${status}"}
// 内部 substituteParams 不变 — 执行时 adapter 转换为 `?`

// MongoDB 不适用 SQL 模板(语义混乱)
```

---

## §8 Data Governance (3 tools)

### 8.1 export_table_csv

**SQLite** ✅: 标准 `SELECT * FROM table` + 默认 `<cwd>/sql/<table>.csv` 输出。

**MongoDB** ❌: 抛错 `export_table_csv 不支持 mongodb:NoSQL adapter 没有表/列结构。MongoDB 用 find() cursor,请直接用 execute_query。`(v5.0.1 N9 修复验证)。

### 8.2 import_csv

**SQLite** ✅: dryRun 走模拟,真导入 OK。

**MongoDB** ❌: 抛错 `import_csv 不支持 mongodb:...`(v5.0.1 N11 修复验证)。

### 8.3 Export Backup (1 tool)

#### 8.3.1 export_backup

**SQLite** ✅: `kind: "full"`,CREATE TABLE + INSERT statements。

**MongoDB**: collection → JSON dump(JSON array per collection)。具体行为视 adapter 实现。

---

## §9 Sample Data (1 tool)

### 9.1 generate_sample_data

**SQLite** ✅:

```json
{"tableName": "test_regression_tbl", "rowCount": 3, "options": {"columns": ["id", "status", "amount"]}}
```

**预期**: 3 行 INSERT,id=AUTOINCREMENT (1, 2, 3),status=choice,amount=range。**v5.0.1 N14 修复**:status enum 值(≤ 20 字符),amount/desc 等 VARCHAR(N) 截断到 N。

**MongoDB** ❌: 不适用,抛错或返回空。

---

## §10 PII (2 tools)

### 10.1 set_pii_config / get_pii_config

**SQLite**: 列级策略正常,`mask` / `mask_last4` / `hash` / `redact` / `passthrough` 通用。

**MongoDB**: 无固定列,但可以按 field name 设置。

---

## §11 Metrics/History/Audit (3 tools)

**SQLite/MongoDB**: 同 v5.0.0 通用行为。

- `get_metrics` 显示 `db/sqlite` 或 `db/mongodb`
- `get_query_history`按 `profile_name` 隔离
- `audit_log` 按 `profileName` 过滤

---

## §12 MongoDB 特有的 execute_query 用法(重点工作)

MongoDB 没有 SQL,但 `execute_query` 接受 MongoDB 命令字符串。每个 DB 类型在 execute_query 内部分发:

| DB      | execute_query 接收的 sql 参数                                   | 实际执行                     |
| ------- | --------------------------------------------------------------- | ---------------------------- |
| SQLite  | `SELECT ... FROM ...`                                         | node:sqlite / better-sqlite3 |
| MongoDB | `db.collection.find({})` / `db.collection.insertOne({...})` | mongodb driver 直接执行      |

**例子**(通过 `execute_query`):

```bash
# SQLite
execute_query({sql: "SELECT COUNT(*) FROM users"})

# MongoDB — 注意:不是 SQL,而是 MongoDB shell-style 命令
execute_query({sql: "smoke.users.find({})"})
execute_query({sql: "smoke.users.findOne({name: 'alice'})"})
execute_query({sql: "smoke.users.insertOne({name: 'carol', email: 'c@example.com', status: 'active', age: 35})"})
execute_query({sql: "smoke.users.updateMany({status: 'ban'}, {$set: {status: 'deleted'}})"})
execute_query({sql: "smoke.users.deleteMany({status: 'deleted'})"})
execute_query({sql: "smoke.test_regression_tbl.find({status: 'pending'})"})
```

**smoke test 用例**:

```javascript
// 写入
mcp__universal-db-mcp__execute_query({sql: "smoke.users.insertOne({name: 'alice', email: 'a@example.com', status: 'active', age: 30})"})
// 预期: {"insertedId": "..."} 或类似

// 读取
mcp__universal-db-mcp__execute_query({sql: "smoke.users.find({name: 'alice'})"})
// 预期: [{"name": "alice", ...}]

// 错误命令
mcp__universal-db-mcp__execute_query({sql: "INVALIDCOMMAND"})
// 预期: 抛错 "INVALIDCOMMAND is not recognized"

// 删除
mcp__universal-db-mcp__execute_query({sql: "smoke.users.deleteMany({name: 'alice'})"})
// 预期: {"deletedCount": 1}
```

---

## §13 SQLite 特有的 execute_query 用法

SQLite 支持两种占位符语法(v5.0.1 兼容性测试):

**`?` 位置占位符**(推荐,与 MySQL 一致):

```javascript
mcp__universal-db-mcp__execute_query({
  sql: "SELECT * FROM users WHERE id = ? AND status = ?",
  params: [1, "active"]
})
```

**`$1, $2, ...` 数字占位符**(与 PostgreSQL 一致,v5.0.1 修复保证 PG/MySQL 都正确处理):

```javascript
mcp__universal-db-mcp__execute_query({
  sql: "SELECT * FROM users WHERE id = $1 AND status = $2",
  params: [1, "active"]
})
```

**注意**: SQLite 同时支持 `?` 和 `$N`,但 v5.0.1 `execute_sql_file` 走 text protocol 时 `?` 是字面字符(不绑参),需要测试 mixed mode。

---

## §14 跨方言查询对比

### 14.1 字符串连接

**SQLite**: `a || b`

**MongoDB**: 不适用(`$concat` 聚合)

### 14.2 当前时间

**SQLite**: `CURRENT_TIMESTAMP` 或 `datetime('now')`

**MongoDB**: `new Date()` (JS)

### 14.3 JSON

**SQLite**: `JSON_EXTRACT(doc, '$.field')` 或 `->` operator

**MongoDB**: 原生 JSON 文档,`db.collection.find({field: 'value'})`

### 14.4 主键

**SQLite**: `INTEGER PRIMARY KEY AUTOINCREMENT`

**MongoDB**: `_id` (ObjectId 自动生成) 或自定义 `_id`

---

## §15 错误处理对比

### 15.1 语法错误

**SQLite**:

```sql
SELECT * FORM users
```

**预期**: 抛 `Error: in prepare, no such column: FORM` 或类似。

**MongoDB**:

```
smoke.INVALIDCOMMAND
```

**预期**: 抛 `MongoServerError: command not recognized`。

### 15.2 连接断开

**SQLite**: 文件被删后下次操作抛 `SQLITE_READONLY_DBMOVED` 或类似。

**MongoDB**: 驱动自动重连,或抛 `MongoNetworkError`。

### 15.3 NoSQL guard

**MongoDB + export_table_csv**: 抛 `export_table_csv 不支持 mongodb:NoSQL adapter 没有表/列结构。MongoDB 用 find() cursor,请直接用 execute_query。`

**MongoDB + import_csv**: 抛 `import_csv 不支持 mongodb:NoSQL adapter 没有表/列结构。MongoDB 用 find() cursor,请直接用 execute_query。`

---

## §16 性能与扩展性备注

### 16.1 连接管理

- **SQLite**: 单文件,`node:sqlite` / `better-sqlite3` 同步 API。连接 cheap。
- **MongoDB**: `mongodb` driver 默认 pool(默认 5 connections)。

### 16.2 慢查询

- **SQLite**: 无内置 slow query log(可用 `sqlite3_trace_v2`)。
- **MongoDB**: `db.setProfilingLevel(2)` 开启 profiler,`db.system.profile.find({millis: {$gt: 100}})` 查慢查询。

### 16.3 大结果集

- **SQLite**: `execute_query` 含 ` queryTimeoutMs: 30000`(默认)。
- **MongoDB**: 单文档 16MB 限制(MongoDB BSON 上限)。

---

## §17 退出准则

✅ v5.0.0 在 SQLite + MongoDB 上的 smoke test 完成 =:

- 所有 ✅ 标记的工具在 SQLite 上正确工作(本轮实测 42 tool 全 PASS)
- MongoDB 列因 §A M1 连接阻塞,所有 MongoDB 列需后续手动验证
- 已知限制(如 execute_sql_file 对 MongoDB)有 `⚠️` 标记
- 没有任何 ❌ 表示真实 bug(本轮未发现新的真实 bug)

---

## §B 测试连接清理

**SQLite**: `delete_profile({confirm: true})` 自动清理 `~/.universal-db-mcp/<profile-name>/` 子目录(含 `data.db` / `history.db` / `templates.db`)。

**MongoDB**: `delete_profile` 仅清理 `~/.universal-db-mongo/<profile-name>/` 路径配置,不删除 MongoDB 容器中的 collection。容器用 `wsl docker rm -f smoke-mongo` 清理。
