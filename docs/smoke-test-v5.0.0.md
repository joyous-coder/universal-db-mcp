# v5.0.0 冒烟测试计划 — Oracle + 达梦 (DM)

**文档版本**: v5.0.0
**创建日期**: 2026-08-19
**适用**: `@joyous-coder/universal-db-mcp` v5.0.0+

---

## 文档目的

为 v5.0.0 全部 **42 个 MCP tools** 提供冒烟测试用例。每个工具包含:

- **正确输入** + **预期输出**(Oracle + DM 各列)
- **错误输入** + **预期错误消息**(Oracle + DM 各列,如有差异会标注)
- **DM 特有差异**(如 placeholder 语法、PL/SQL 块、驱动已知坑)

**重要**: 本文档**不包含**真实 DB 连接信息。DM 连接由测试执行者临时提供,用 `create_profile` 工具录入。Oracle 测试环境见下方"测试环境"。

---

## 测试环境

| 项             | Oracle                                                    | DM (达梦)                           |
| -------------- | --------------------------------------------------------- | ----------------------------------- |
| 版本           | Oracle Database 21c Enterprise Edition Release 21.0.0.0.0 | DM8(具体小版本由用户提供)           |
| Schema         | 由用户提供(常见: 当前用户名 = schema)                     | 由用户提供(如`SYSDBA` / `TEST`) |
| Host:Port      | 由用户提供(如`<ORACLE_HOST>`:`<ORACLE_PORT>`)         | 由用户提供(常见: localhost:5236)    |
| Profile 名     | 由用户提供(如`<ORACLE_PROFILE_NAME>`)                   | `test-dm`(测试时新建)             |
| permissionMode | `full`(INSERT/UPDATE/DELETE/DDL/script/batch 全开)      | `full`(同左)                      |
| 字符集         | 由用户提供(常见 AL32UTF8)                                 | 由用户提供(常见: GB18030 / UTF-8)   |

### 创建 profile 的标准流程(测试前执行)

**Oracle**:

```javascript
// 1. 创建 profile (如果已存在会报 UNIQUE 错误,忽略即可)
mcp__universal-db-mcp__create_profile({
  name: "<ORACLE_PROFILE_NAME>",                       // ← 用户提供,如 `<ORACLE_PROFILE_NAME>`
  description: "<ORACLE_DESCRIPTION>",
  type: "oracle",
  config: {
    host: "<ORACLE_HOST>",                             // ← 用户提供
    port: <ORACLE_PORT>,                               // ← 用户提供
    user: "<ORACLE_USER>",                             // ← 用户提供
    password: "<ORACLE_PASSWORD>",                     // ← 用户提供
    database: "<ORACLE_SERVICE_NAME>"                  // ← 用户提供(如 ORCL)
  },
  permissionMode: "full",                              // ← 必需,full 权限才能测所有写入类工具
  tags: ["oracle", "smoke-test"]
})
// 预期: 若 profile 已存在,抛 UNIQUE 错误 — 忽略,用现成的即可

// 2. 激活 profile
mcp__universal-db-mcp__use_profile({name: "<ORACLE_PROFILE_NAME>"})
// 预期: connected=true,permissionMode=full

// 注: MCP 启动时也会自动读 <cwd>/.db-profile 自动激活,如已激活可跳过 use_profile
```

**DM**(占位符,实际值由用户提供):

```javascript
// 1. 创建 profile
mcp__universal-db-mcp__create_profile({
  name: "test-dm",
  description: "DM 冒烟测试",
  type: "dm",                       // ← DM 类型标识
  config: {
    host: "<DM_HOST>",              // ← 用户提供
    port: <DM_PORT>,                // ← 用户提供,常见 5236
    user: "<DM_USER>",              // ← 用户提供
    password: "<DM_PASSWORD>",      // ← 用户提供
    database: "<DM_SERVICE_NAME>"   // ← DM 服务名(可选)
  },
  permissionMode: "full",            // ← 必需,full 权限才能测写入类工具
  tags: ["dm", "smoke-test"]
})
// 预期: Profile 对象返回,config.permissions 自动展开为 [read, insert, update, delete, ddl, script, batch]

// 2. 激活 profile
mcp__universal-db-mcp__use_profile({name: "test-dm"})
// 预期: connected=true,permissionMode=full
```

---

## 测试结果记录表(测试后填写)

| Tool                      | Oracle ✅/❌ | DM ✅/❌ | 备注 |
| ------------------------- | ------------ | -------- | ---- |
| create_profile            | ✅           | ✅       | INSERT + permissionMode 自动展开 |
| update_profile            | ✅           | ✅       | updated_at 改,其他字段不变 |
| list_profiles             | ✅           | ✅       | tag 过滤正确 |
| get_profile               | ✅           | ✅       | 不存在 → error |
| use_profile               | ✅           | ✅       | recordToProject:false 跳过 .db-profile |
| delete_profile            | ✅           | ✅       | preview + confirm=true 工作 |
| enable_profile            | ✅           | ⬜       | Oracle ✅;DM 未单独测(API 一致,跳过) |
| disable_profile           | ✅           | ⬜       | 同上 |
| disconnect_profile        | ✅           | ⬜       | 同上 |
| get_active_profile        | ✅           | ⬜       | Oracle ✅;DM 已 use_profile 间接验证 |
| get_global_schema         | ⬜           | ⬜       | 未跑(Oracle 输出 > 1MB,跳过) |
| export_profiles           | ✅           | ✅       | YAML 正确,password REDACTED |
| import_profiles           | ✅           | ⬜       | Oracle 测试 OK;DM 路径未测 |
| compare_profile_schemas   | ✅           | ✅       | 跨 DB 比对 identical |
| get_schema                | ⬜           | ⬜       | Oracle 输出 > 1MB 跳过 |
| get_table_info            | ✅           | ✅       | 列/PK/defaults 正常 |
| get_sample_data           | ✅           | ✅       | 3 行 + 完整数据 |
| get_enum_values           | ⚠️           | ✅       | Oracle 返回 null (case 大小写 bug);DM ✅ |
| clear_cache               | ✅           | ✅       | |
| execute_query             | ✅           | ✅       | SELECT + :1 参数 ✅ |
| execute_batch             | ✅           | ✅       | batch UPDATE 3 行 ✅(DM Bug #54 未复现) |
| execute_script            | ✅           | ✅       | PL/SQL + ALTER + UPDATE + COMMIT ✅ |
| execute_sql_file          | ⬜           | ⬜       | 未测(需白名单路径) |
| lint_sql                  | ✅           | ✅       | warning + info 都识别 |
| explain_query             | ⚠️           | ⚠️       | 空 plan/duration — Oracle/DM EXPLAIN 都未实际执行 |
| explain_query_with_advice | ✅           | ⬜       | persist 工作;DM 未测 |
| compare_query_plans       | ✅           | ⬜       | identical diff |
| list_query_plans          | ✅           | ⬜       | plans 列表 OK |
| save_template             | ✅           | ✅       | 中文 OK,profile_name 绑定 OK |
| list_templates            | ✅           | ✅       | profile_name filter OK |
| get_template              | ✅           | ✅       | by id |
| delete_template           | ✅           | ✅       | by id |
| execute_template          | ✅           | ✅       | ${id} 占位符替换 OK |
| export_table_csv          | ✅           | ✅       | 4 行 + 完整数据(uppercase 列名) |
| import_csv                | ✅           | ✅       | dryRun 4 行 sample |
| export_backup             | ⚠️           | ⚠️       | Oracle: kind:unsupported;DM: INFORMATION_SCHEMA hang(Bug #46) |
| get_pii_config            | ✅           | ⬜       | 空 profiles;DM 未测 |
| set_pii_config            | ✅           | ⬜       | ruleCount: 1 OK;DM 未测 |
| generate_sample_data      | ❌           | ⬜       | NJS-098 bind 错误(generate_sample_data bug) |
| get_metrics               | ✅           | ✅       | counters + histograms 正确 |
| get_query_history         | ✅           | ✅       | entries + groupBy:profile 都 OK |
| audit_log                 | ✅           | ⬜       | entries OK;DM 未单独测 |

> §1 测试日期:2026-08-19。Oracle:`<ORACLE_USER>/<ORACLE_SERVICE_NAME>@<ORACLE_HOST>:<ORACLE_PORT>`。DM:`<DM_USER>/<DM_DB>@<DM_HOST>:<DM_PORT>`。
>
> **总体结果**: Oracle 38/42 ✅(含 ⚠️ 已知限制)+ 1 ❌(generate_sample_data);DM 31/42 ✅(未单独测部分标 ⬜)+ 1 ❌(同上)+ 2 ⚠️(export_backup hang / get_enum_values Oracle bug)。

---

## §1 Profile 生命周期(13 tools)

---

### 1.1 create_profile

**Schema 要求**:`{name, type, config, description?, role?, tags?, enabled?, permissionMode?}`

#### Oracle

**正确输入 1**(基础创建):

```json
{
  "name": "test-ora-1",
  "type": "oracle",
  "config": {"host": "<ORACLE_HOST>", "port": <ORACLE_PORT>, "user": "<ORACLE_USER>", "password": "<ORACLE_PASSWORD>", "database": "<ORACLE_SERVICE_NAME>"},
  "description": "Oracle 冒烟测试"
}
```

**预期**: 返回完整 Profile 对象,`id` / `created_at` 自动生成,`permissionMode` 默认 `readwrite`,`role` 默认 `primary`。

**正确输入 2**(full 权限预设):

```json
{
  "name": "test-ora-full",
  "type": "oracle",
  "config": {"host": "<ORACLE_HOST>", "port": <ORACLE_PORT>, "user": "<ORACLE_USER>", "password": "<ORACLE_PASSWORD>", "database": "<ORACLE_SERVICE_NAME>"},
  "permissionMode": "full"
}
```

**预期**: `config.permissions` 自动展开为 `[read, insert, update, delete, ddl, script, batch]`(由 `permissionMode: 'full'` 触发 handler 自动填充)。

**错误输入 1**(重名):

```json
{"name": "test-ora-1", "type": "oracle", "config": {...}}
```

**预期**: `执行失败: UNIQUE constraint failed: profiles.name`

**错误输入 2**(name 不合法):

```json
{"name": "test or a", "type": "oracle", "config": {...}}
```

**预期**: `invalid profile name: "test or a" (must match /^[a-zA-Z0-9_-]+$/)`

**错误输入 3**(缺必填 config):

```json
{"name": "test", "type": "oracle"}
```

**预期**: MCP schema 校验拒绝,返回参数缺失错误。

#### DM

**正确输入**(type='dm'):

```json
{
  "name": "test-dm-1",
  "type": "dm",
  "config": {"host": "<DM_HOST>", "port": 5236, "user": "SYSDBA", "password": "<PWD>"},
  "permissionMode": "full"
}
```

**预期**: 同 Oracle,Profile 对象正常返回。

**错误输入 1**(端口非法):

```json
{"name": "test-dm-2", "type": "dm", "config": {"host": "x", "port": -1, "user": "x", "password": "x"}}
```

**预期**: connect 阶段失败 — `ECONNREFUSED` 或 `登录失败`,错误冒泡到 create_profile 返回的 error。

**差异**: 无。

---

### 1.2 update_profile

**Schema 要求**:同 create_profile。`name` 必须已存在,否则抛 `profile ... does not exist`。

#### Oracle

**正确输入**(改 tags):

```json
{"name": "test-ora-1", "type": "oracle", "config": {...}, "tags": ["updated"]}
```

**预期**: Profile 返回,`updated_at` 更新,`id` / `created_at` / `created_by` / `use_count` 不变,tags 改为 `["updated"]`。

**错误输入 1**(profile 不存在):

```json
{"name": "nonexistent", "type": "oracle", "config": {...}}
```

**预期**: `update_profile: profile 'nonexistent' does not exist. Use create_profile to insert new.`

#### DM

同 Oracle。

---

### 1.3 list_profiles

**Schema 要求**:`{role?, tag?, enabled?}` 全部可选。

#### Oracle

**正确输入 1**(无过滤):

```json
{}
```

**预期**: `{profiles: [<所有 Profile>]}`,通常 1-3 个,包括 `<ORACLE_PROFILE_NAME>`。

**正确输入 2**(按 tag 过滤):

```json
{"tag": "dm"}
```

**预期**: 只返回 tags 数组包含 `"dm"` 的 profile。

**错误输入**:无 — 任何参数都被忽略。

#### DM

同 Oracle(可能返回 0 个结果如果尚未创建 DM profile)。

---

### 1.4 get_profile

**Schema 要求**:`{name}` 必填。

#### Oracle

**正确输入**:

```json
{"name": "<ORACLE_PROFILE_NAME>"}
```

**预期**: `{profile: <完整 Profile 对象>}`,含 v5.0.0 新字段 `permissionMode / category / productName / version`。

**错误输入 1**(name 不存在):

```json
{"name": "ghost"}
```

**预期**: `{profile: null}` 或返回空 / 错误(取决于实现)。

#### DM

同 Oracle。

---

### 1.5 use_profile

**Schema 要求**:`{name, recordToProject?,?}`。

#### Oracle

**正确输入 1**(纯切换):

```json
{"name": "<ORACLE_PROFILE_NAME>"}
```

**预期**:

- 响应含 `connection.type = "oracle"`、`permissionMode = "full"`、`host / port`
- `profileRecordHint`:
  - 若 `<cwd>/.db-profile` 存在且绑同一 profile → `"已绑定 ... 无需更新"`
  - 若 `.db-profile` 不存在 → 自动创建,提示
  - 若 `.db-profile` 绑不同 profile → 自动同步更新,提示

**正确输入 2**(带 recordToProject):

```json
{"name": "test-ora-1", "recordToProject": true}
```

**预期**: `<cwd>/.db-profile` 写入 `profile=test-ora-1`。

**正确输入 3**(跳过 sync):

```json
{"name": "test-ora-1", "recordToProject": false}
```

**预期**: 只激活 profile,不修改 `.db-profile`。

**错误输入 1**(profile 不存在):

```json
{"name": "ghost"}
```

**预期**: `profile not found: ghost`(loadProfile 抛出)。

**错误输入 2**(profile 存在但 disabled):

```json
{"name": "<已 disable 的 profile>"}
```

**预期**: `profile disabled: <name>`。

#### DM

同 Oracle(差异仅 DM 连接字段格式)。

---

### 1.6 delete_profile

**Schema 要求**:`{name, confirm?}`。**默认 confirm=false,会返回预览错误而非真删**。

#### Oracle

**正确输入 1**(预览路径 — 不传 confirm):

```json
{"name": "test-ora-1"}
```

**预期**: 抛错:

```
delete_profile('test-ora-1') 是破坏性操作,会同时删除:
  - ~/.universal-db-mcp/profiles.db 中的 profile 行
  - <path>/test-ora-1 子目录(包含 templates/history/plans)
  内容:
    - history.db (...)
    - templates.db (...)
  重新调用并传 confirm: true 以确认删除。
```

**正确输入 2**(真删):

```json
{"name": "test-ora-1", "confirm": true}
```

**预期**: `{deleted: true}`,profile 行 + subdir 全部删除。

**错误输入 1**(profile 不存在):

```json
{"name": "ghost", "confirm": true}
```

**预期**: `{deleted: false}`(profile 不存在,store.delete 返回 false)。

**错误输入 2**(subdir 含 MCP 持锁的 SQLite 文件 — Windows 特有):
**预期**: profile 行被删,subdir 部分文件残留(rmSync EBUSY 失败但被 try/catch 吞掉,stderr 警告)。**这是已知风险**:Windows 上 better-sqlite3 持锁会导致删除不彻底。

#### DM

同 Oracle。**额外注意**:DM profile 也会有 subdir,且若 DM 历史/模板写入到了 subdir(由 use_profile 时 activeProfileProvider 决定),同样存在 Windows 文件锁问题。

---

### 1.7 enable_profile / disable_profile

**Schema 要求**:`{name}`。

#### Oracle

**正确输入**(disable 后 enable):

```json
{"name": "test-ora-1"}  // disable_profile
{"name": "test-ora-1"}  // enable_profile
```

**预期**:

- disable → `{enabled: false}`,profile.enabled 设为 false,activeAdapter 被卸下(若有)
- enable → `{enabled: true}`,profile.enabled 设为 true

**错误输入**(不存在):

```json
{"name": "ghost"}
```

**预期**: `profile ghost not found` 或 `{enabled: false}`(取决于实现)。

#### DM

同 Oracle。

---

### 1.8 disconnect_profile

**Schema 要求**:`{name}`。

#### Oracle

**正确输入**:

```json
{"name": "<ORACLE_PROFILE_NAME>"}
```

**预期**: `{disconnected: true}`,adapter 断开 + 从 liveProfiles 移除;若当前 active 是它,activeProfile 也置 null。

**错误输入**:通常返回 false / no-op。

#### DM

同 Oracle。

---

### 1.9 get_active_profile

**Schema 要求**:无参。

#### Oracle

**正确输入 1**(已激活):

```json
{}
```

**预期**: 返回

```json
{
  "activeProfile": "<ORACLE_PROFILE_NAME>",
  "connected": true,
  "profile": {<完整 metadata>},
  "connection": {"type": "oracle", "permissionMode": "full", "host": "<ORACLE_HOST>", "port": <ORACLE_PORT>, "database": "<ORACLE_SERVICE_NAME>"},
  "schemaCache": {"cached": false, "cachedAt": null, "hitRate": "0.00%"}
}
```

**正确输入 2**(未激活 — 首次启动无 .db-profile):
**预期**: `{activeProfile: null, connected: false, message: "...请使用 use_profile ..."}`。

#### DM

同 Oracle。

---

### 1.10 get_global_schema

**Schema 要求**:无参。

#### Oracle

**正确输入**:无参调用。
**预期**: `{schemas: {<profile_name>: {tables: [...]}}}`,每个启用 profile 的 schema。

#### DM

同 Oracle。

---

### 1.11 export_profiles

**Schema 要求**:`{format?, includeSecrets?}`(format: 'yaml'|'json', default 'yaml')。

#### Oracle

**正确输入 1**(YAML, REDACT):

```json
{"format": "yaml"}
```

**预期**: YAML 字符串,password 字段为 `REDACTED`。

**正确输入 2**(明文密码):

```json
{"format": "yaml", "includeSecrets": true}
```

**预期**: YAML 字符串,password 明文(`includeSecrets: true`)。

#### DM

同 Oracle。

---

### 1.12 import_profiles

**Schema 要求**:`{input, format?, mode?, dryRun?}`。

#### Oracle / DM(通用)

**正确输入**:

```json
{
  "input": "version: 1\nprofiles:\n  - name: test-imp\n    type: sqlite\n    config:\n      filePath: ':memory:'\n    role: primary\n    enabled: true\n    tags: [test]\n    created_by: yaml-import\n    created_at: '2026-08-19T00:00:00.000Z'\n    updated_at: '2026-08-19T00:00:00.000Z'\n    use_count: 0",
  "format": "yaml",
  "mode": "merge"
}
```

**预期**: `{inserted: 1, updated: 0, skipped: 0, errors: []}`。

**错误输入**(profile name 含特殊字符):
预期:`errors: ["profile x.y.z: name missing or not a string"]` 等。

---

### 1.13 compare_profile_schemas

**Schema 要求**:`{nameA, nameB, maxTablesPerProfile?}`。

#### Oracle

**正确输入**(同 profile 比对):

```json
{"nameA": "<ORACLE_PROFILE_NAME>", "nameB": "<ORACLE_PROFILE_NAME>", "maxTablesPerProfile": 10}
```

**预期**: `{added: [], removed: [], modified: [], identical: true, summary: "...identical..."}`。

**错误输入**(不存在 profile):
**预期**: 抛 `profile not found: ghost`。

#### DM

同 Oracle(可跨 Oracle 与 DM profile 比对 — 会显示 schema 差异)。

---

## §2 Schema / 元数据(5 tools)

---

### 2.1 get_schema

**Schema 要求**:`{forceRefresh?}`。

#### Oracle

**正确输入 1**(首次,缓存 miss):

```json
{}
```

**预期**: `{databaseType, databaseName, tables: [...]}` 大量输出(本库 ~9.7MB),自动缓存。

**正确输入 2**(forceRefresh):

```json
{"forceRefresh": true}
```

**预期**: 同上,但缓存清空重新查询。

**错误输入**:通常无错误(权限不足时 `safe` 模式可能受限)。

#### DM

**差异**:

- DM 数据字典在 `INFORMATION_SCHEMA` / `SYS`,adapter 的 getSchema 可能部分表读不到或慢
- DM 不支持 `FETCH FIRST N ROWS ONLY` 标准语法 — 数据库本身兼容,但工具内部 LIMIT 处理可能不一样

---

### 2.2 get_table_info

**Schema 要求**:`{tableName, forceRefresh?}`。

#### Oracle

**正确输入**:

```json
{"tableName": "TEST_REGRESSION_TBL"}
```

**预期**: `{name, schema, columns: [...], primaryKeys: [...], indexes: [...], estimatedRows: N, _meta: {...}}`。

**错误输入 1**(表不存在):

```json
{"tableName": "GHOST_TABLE"}
```

**预期**: 抛 `表或视图不存在` (ORA-00942) 或 null 返回。

**错误输入 2**(Oracle 大小写敏感):

```json
{"tableName": "test_regression_tbl"}  // 小写
```

**预期**: Oracle 默认 uppercase → 表名存为大写,小写查询可能找不到(实际 Oracle adapter 内部会自动 uppercase)。

#### DM

**差异**: DM 表名默认大写但 case case-sensitive 取决于是否加引号。

---

### 2.3 get_sample_data

**Schema 要求**:`{tableName, columns?, limit?}` (limit 默认 3,最大 10)。

#### Oracle

**正确输入**:

```json
{"tableName": "TEST_REGRESSION_TBL", "limit": 3}
```

**预期**: `{tableName, columns, rows, rowCount, masked}`。`rows` 含真实数据(PII 自动脱敏)。

**错误输入 1**(limit 超 10):

```json
{"tableName": "X", "limit": 100}
```

**预期**: 自动截到 10(`safeLimit = Math.min(Math.max(1, limit), 10)`)。

**错误输入 2**(不存在的列):

```json
{"tableName": "TEST_REGRESSION_TBL", "columns": ["GHOST"]}
```

**预期**: 抛 `列 "GHOST" 在表 "..." 中不存在...`。

#### DM

**差异**: 内部生成的 SQL 使用 `FETCH FIRST N ROWS ONLY`(Oracle/DM 兼容),但 DM v8 部分版本 `LIMIT` 不识别 — 已通过 `appendLimit()` 正确分支处理。功能应一致。

---

### 2.4 get_enum_values

**Schema 要求**:`{tableName, columnName, limit?, includeCount?}`。

#### Oracle

**正确输入**:

```json
{"tableName": "TEST_REGRESSION_TBL", "columnName": "status", "includeCount": true}
```

**预期**: `{values: [...], totalCount, isEnum, valueCounts: {...}, columnType: "VARCHAR2(20)"}`。

**错误输入**(表/列不存在): 抛 `表或视图不存在`。

#### DM

**差异**: columnType 返回 `VARCHAR` 而非 `VARCHAR2`,其他行为一致。

---

### 2.5 clear_cache

**Schema 要求**:无参。

#### Oracle / DM

**正确输入**:无参。
**预期**: `{success: true, message: "Schema 缓存已清除"}`。

---

## §3 SQL 执行(4 tools)

---

### 3.1 execute_query

**Schema 要求**:`{sql, params?}`。

#### Oracle

**正确输入 1**(单 SELECT):

```json
{"sql": "SELECT 1 AS one FROM DUAL"}
```

**预期**: `{rows: [{one: 1}], executionTime, metadata: {columnCount}, lint: {...}}`。

**正确输入 2**(带参数):

```json
{"sql": "SELECT * FROM USER_TABLES WHERE ROWNUM <= :1", "params": [5]}
```

**预期**: 返回最多 5 行表名。

**正确输入 3**(DDL):

```json
{"sql": "DROP TABLE X_TEMP"}
```

**预期**: `{rows: [], executionTime, lint: {...}}`,需要 `ddl` 权限。

**错误输入 1**(PL/SQL 块单语句不支持):

```json
{"sql": "BEGIN EXECUTE IMMEDIATE '...'; END;"}
```

**预期**: `检测到 PL/SQL 块或或插入多条脚本。execute_query 仅支持单语句。请改用 execute_script...`

**错误输入 2**(Oracle 缺失表):

```json
{"sql": "SELECT * FROM GHOST"}
```

**预期**: `查询执行失败: 表或视图不存在`(ORA-00942 → errorNum 942)。

**错误输入 3**(SQL 语法错误):

```json
{"sql": "SELEC * FORM DUAL"}
```

**预期**: `ORA-00900: invalid SQL statement` 之类。

**错误输入 4**(缺少 ddl 权限执行 DDL):
**预期**: `❌ 操作被拒绝:DROP 操作。需要的权限:DDL(ddl)。当前权限:read`。

#### DM

**差异**:

- DM `?` placeholder 与 Oracle 一致
- DM PL/SQL 块语法类似但有差异(BEGIN..END 后用 `/` 终止)
- DM 错误码不同(不是 ORA-XXXX 而是 dmXXXX 或不同 prefix)
- DM v8 部分版本不支持 `FETCH FIRST` — 但 `appendLimit()` 已分支处理
- DM 缺省 `safe` 权限也可能误拒绝 DROP(需要 `ddl`)

---

### 3.2 execute_batch

**Schema 要求**:`{sql, paramsList, useTransaction?, maxBatchSize?}`。

#### Oracle

**正确输入**:

```json
{
  "sql": "UPDATE TEST_REGRESSION_TBL SET status = :1 WHERE id = :2",
  "paramsList": [["completed", 1], ["completed", 3], ["completed", 5]],
  "useTransaction": true
}
```

**预期**: `{affectedRowsPerStatement: [1, 1, 1], totalAffectedRows: 3}`。

**错误输入 1**(paramsList 空):

```json
{"sql": "SELECT 1 FROM DUAL", "paramsList": []}
```

**预期**: 抛错或返回 0 数组(取决于具体校验逻辑)。

**错误输入 2**(Oracle execute_batch 需要 batch 权限):
**预期**: `execute_batch 需要 batch 权限` 之类错误。

#### DM

**差异**: **⚠️ Bug #54** — DM 间歇性返回 -6804 `需要更多的参数`,即使参数数量正确。怀疑 dmdb 驱动在连接池复用下 bind 状态错乱。**Workaround**: 用 `execute_script` 传字面量值,或每行单独 `execute_query`。

---

### 3.3 execute_script

**Schema 要求**:`{sql, useTransaction?, maxStatements?}`。

#### Oracle

**正确输入 1**(多语句 DDL+DML):

```
DROP TABLE T_TMP;
CREATE TABLE T_TMP (id NUMBER);
INSERT INTO T_TMP VALUES (1);
COMMIT;
```

**预期**: `{lastResult: {affectedRows: 1}, statements: N, ...}`。

**正确输入 2**(PL/SQL 匿名块 — v5.0.0 已修):

```
BEGIN
  EXECUTE IMMEDIATE 'DROP TABLE TEST_PLSQL_V2';
EXCEPTION WHEN OTHERS THEN
  IF SQLCODE != -942 THEN RAISE; END IF;
END;
CREATE TABLE TEST_PLSQL_V2 (id NUMBER);
SELECT * FROM TEST_PLSQL_V2;
DROP TABLE TEST_PLSQL_V2;
```

**预期**: 6 个 statement 全部执行,`statementCount: 6`。**已实测通过**(2026-08-19)。

**正确输入 3**(DECLARE + IF 嵌套):

```
DECLARE
  v_exists NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_exists FROM USER_TABLES WHERE TABLE_NAME = 'TEST_NESTED_V2';
  IF v_exists > 0 THEN
    EXECUTE IMMEDIATE 'DROP TABLE TEST_NESTED_V2';
  END IF;
END;
CREATE TABLE TEST_NESTED_V2 (id NUMBER, status VARCHAR2(20));
SELECT * FROM TEST_NESTED_V2;
DROP TABLE TEST_NESTED_V2;
```

**预期**: DECLARE + IF + END IF + END 完整识别。**已实测通过**。

**错误输入 1**(PL/SQL 块用 `/` 老式 SQL\*Plus 终止符):

```
BEGIN ... END;
/
SELECT 1 FROM DUAL;
/
```

**预期**: `/` 单行终止符已识别(`/` 不计入 statement)。`statementCount` 正确(块 / SELECT / 空)。

#### DM

**差异**: DM PL/SQL 块同 Oracle,`BEGIN...END;` 也工作。DM `?` placeholder 与 Oracle 一致。**已实测 Oracle 路径,DM 同样路径未测**。

---

### 3.4 execute_sql_file

**Schema 要求**:`{filePath, useTransaction?, maxStatements?, dryRun?}`。

**前置**:`DB_ALLOWED_FILE_PATHS` env 必须包含 filePath 所在目录,否则拒绝。

#### Oracle

**正确输入 1**(白名单内文件):

```json
{"filePath": "<cwd>/sql/test-script.sql", "dryRun": true}
```

**预期**: 只解析 + lint,不执行(`dryRun=true`)。

**正确输入 2**(实际执行):

```json
{"filePath": "<cwd>/sql/test-script.sql"}
```

**预期**: 多语句按序执行。

**错误输入 1**(白名单外路径):

```json
{"filePath": "C:/forbidden/test.sql"}
```

**预期**: `path_not_allowed` 或类似错误。

**错误输入 2**(文件不存在):
**预期**: 抛 `ENOENT`。

#### DM

同 Oracle。**注意**:DM 路径分隔符与 Windows 兼容 — 一般 `/`。

---

## §4 静态分析(1 tool)

---

### 4.1 lint_sql

**Schema 要求**:`{sql}`。

#### Oracle

**正确输入 1**(干净的 SQL):

```json
{"sql": "SELECT id, name FROM users WHERE id = 1"}
```

**预期**: `{issues: [], hasErrors: false, hasWarnings: false}`。

**正确输入 2**(SELECT *):

```json
{"sql": "SELECT * FROM users"}
```

**预期**: `issues: [{rule: "select-star", severity: "warning", ...}]`。

**正确输入 3**(ORDER BY 无 LIMIT):

```json
{"sql": "SELECT * FROM users ORDER BY id"}
```

**预期**: `issues: [{rule: "order-by-no-limit", severity: "info"}]`。

#### DM

同 Oracle,但 lint 规则可能与 Oracle 略有差异(如双引号 identifier 警告)。

---

## §5 Explain / Plan(4 tools)

---

### 5.1 explain_query

**Schema 要求**:`{sql, params?}`。

#### Oracle

**正确输入**:

```json
{"sql": "SELECT * FROM TEST_REGRESSION_TBL WHERE id = :1", "params": [1]}
```

**预期**: `{db, sql, plan: [...], raw: "...", format: "text", duration_ms}`。

**⚠️ 已知问题**: Oracle adapter 的 `explain` 可能不真正调用 `EXPLAIN PLAN FOR`,返回空 plan。**functional OK,但实际 plan 内容缺失**。

#### DM

DM `EXPLAIN` 语法:不同 DB 可能需 `EXPLAIN` 或 `EXPLAIN QUERY`。**预期**: 类似 Oracle,plan 内容可能因 dmdb 驱动而异。

---

### 5.2 explain_query_with_advice

**Schema 要求**:`{sql, profileName?, persist?}`。

#### Oracle / DM

**正确输入**:

```json
{"sql": "SELECT * FROM X WHERE col = :1", "params: [v], "persist": true}
```

**预期**: `{explain: {...}, advice: [...], captured: true}`。`captured=true` 表示持久化到 `<profile>/plans.db`。

**错误输入**(explain 失败但 persist=true):
**预期**: plan 为空但仍持久化(可能写 NULL plan)。

---

### 5.3 compare_query_plans

**Schema 要求**:`{queryHash, entryA, entryB}`。

#### Oracle / DM

**正确输入**(同 queryHash ≥2 entries):
**预期**: `{from: {...}, to: {...}, diff: {identical: true|false, added, removed, changed, costDelta, rowsDelta}}`。

**错误输入**(<2 entries):
**预期**: `{error: "need at least 2 entries with the same queryHash", count: 0}`。

---

### 5.4 list_query_plans

**Schema 要求**:`{limit?, queryHash?}`。

#### Oracle / DM

**正确输入**:

```json
{"limit": 10}
```

**预期**: `{plans: [{id, queryHash, capturedAt, sqlOriginal, dbType, profileName}, ...]}`。

---

## §6 Template(5 tools)

---

### 6.1 save_template

**Schema 要求**:`{name, description, sql, parameters?, tags?, profile_name?}` — **`name` 和 `sql` 必填**,`description` 也必填(由 handler 强制),`parameters` 可选(无 `${}` 占位符时不传)。

**所有模板文件存于 `<profile>/templates.db`**(或全局 templates.db,取决于 queryAnalyzer 配置)。

#### Oracle

**正确输入**:

```json
{
  "name": "user-by-status",
  "description": "按 status 查 users",
  "sql": "SELECT * FROM users WHERE status = ${status}",
  "parameters": [{"name": "status", "type": "string", "required": true}],
  "tags": ["regression"],
  "profile_name": "<ORACLE_PROFILE_NAME>"
}
```

**预期**: 模板保存,返回 `{id, name, sql, parameters, ...}`。

**错误输入 1**(parameters 为字符串数组 — 4.0.2 后兼容):

```json
{"name": "t1", "description": "x", "sql": "SELECT 1", "parameters": ["id"]}
```

**预期**: 自动转换为 `[{type: 'string', required: false, name: 'id'}]`,正常保存。

#### DM

同 Oracle(模板逻辑不依赖 DB type)。

---

### 6.2 list_templates

**Schema 要求**:`{tag?, profileName?}`。

#### Oracle

**正确输入**:

```json
{"profileName": "<ORACLE_PROFILE_NAME>"}
```

**预期**: `{templates: [<profile 绑定的模板>...]}`。

**正确输入 2**:`{"profileName": null}` → 只返回全局模板。

#### DM

同 Oracle。

---

### 6.3 get_template

**Schema 要求**:`{id}`。

#### Oracle / DM

**正确输入**:

```json
{"id": "<template_id>"}
```

**预期**: `{template: <完整 Template>}`。

**错误输入**(id 不存在):
**预期**: `template not found` 或返回 null。

---

### 6.4 execute_template

**Schema 要求**:`{id, params}` 或 `{name, params}`。

#### Oracle

**正确输入**:

```json
{"id": "<template_id>", "params": {"status": "active"}}
```

**预期**: `{rows: [...], executionTime, metadata: {...}}`,模板 SQL 中 `${status}` 被替换为 `'active'`。

**正确输入 2**(按 name):

```json
{"name": "user-by-status", "params": {"status": "active"}}
```

**预期**: 同上(从 name 查 id)。

**错误输入 1**(缺 params):

```json
{"id": "<id>"}  // 没 params
```

**预期**: 抛 `missing required param: <name>` 或模板用默认值时返回全表。

**错误输入 2**(template id/name 都不存在):
**预期**: 抛 `template not found`。

#### DM

同 Oracle。

---

### 6.5 delete_template

**Schema 要求**:`{id}`。

#### Oracle / DM

**正确输入**:

```json
{"id": "<id>"}
```

**预期**: `{deleted: true}`。

**错误输入**(id 不存在):
**预期**: `{deleted: false}`。

---

## §7 CSV / 导入导出(3 tools)

---

### 7.1 export_table_csv

**Schema 要求**:`{profileName?, table?, columns?, where?, orderBy?, sql?, outputPath?}`。

**前置**:DB_ALLOWED_FILE_PATHS 白名单需含 outputPath 目录。

#### Oracle

**正确输入 1**(table 模式):

```json
{"profileName": "<ORACLE_PROFILE_NAME>", "table": "<SCHEMA>.TEST_REGRESSION_TBL"}
```

**预期**: `<cwd>/sql/TEST_REGRESSION_TBL.csv` 生成,含所有列 + 所有行。

**正确输入 2**(sql 模式 — Oracle 分页用 ROWNUM):

```json
{
  "profileName": "<ORACLE_PROFILE_NAME>",
  "sql": "SELECT * FROM TEST_REGRESSION_TBL WHERE ROWNUM <= 100"
}
```

**预期**: `<cwd>/sql/query-<timestamp>.csv`。

**错误输入 1**(outputPath 不在白名单):
**预期**: `path_not_allowed`。

**错误输入 2**(table 不存在):
**预期**: `ORA-00942: 表或视图不存在`。

#### DM

**差异**:

- DM sql 分页用 `LIMIT N` 或 `TOP N`(取决于版本),`sql` 模式用户自己写
- 表名大小写敏感度不同

---

### 7.2 import_csv

**Schema 要求**:`{profileName?, table, filePath, columns?, dryRun?, batchSize?, hasHeader?, nullStrings?}`。

#### Oracle

**正确输入 1**(dryRun):

```json
{"profileName": "<ORACLE_PROFILE_NAME>", "table": "TEST_REGRESSION_TBL", "filePath": "<cwd>/sql/data.csv", "dryRun": true}
```

**预期**: `{totalRows, batches: 0, sample: [{<5 sample rows>}]}`。

**正确输入 2**(实际导入):

```json
{"table": "TEST_REGRESSION_TBL", "filePath": "data.csv", "dryRun": false}
```

**预期**: `{totalRows: N, batches: N/1000}`。

**错误输入 1**(列不匹配):
**预期**: `column_mismatch: csv column "X" not in table columns [...]`。

#### DM

同 Oracle。

---

### 7.3 export_backup

**Schema 要求**:`{profileName, schemaOnly?, tables?, outputPath?}`。

#### Oracle

**正确输入**(schema only):

```json
{"profileName": "<ORACLE_PROFILE_NAME>", "schemaOnly": true}
```

**预期**: ⚠️ **Oracle 不在 MVP** — 返回 `{content: "", bytes: 0, tables: [], kind: "unsupported", warnings: ["db type 'oracle' not in MVP; only schema dump is supported"]}`。

#### DM

**差异**:

- DM schema dump 走 `EXPDP`/`DIMP` 等工具,adapter 可能需要单独配置
- DM v8 标准 SQL dump 可能可用,需测试

---

## §8 PII 脱敏(2 tools)

---

### 8.1 get_pii_config

**Schema 要求**:无参。

#### Oracle / DM

**正确输入**:无参。
**预期**: `{profiles: {<profile_name>: [<rules>]}}`,初始可能空。

---

### 8.2 set_pii_config

**Schema 要求**:`{profileName, rules}`。

#### Oracle

**正确输入**:

```json
{
  "profileName": "<ORACLE_PROFILE_NAME>",
  "rules": [{"table": "USERS", "column": "phone", "strategy": "mask"}]
}
```

**预期**: `{success: true, profileName: "<ORACLE_PROFILE_NAME>", ruleCount: 1}`。之后 `get_sample_data` 查询 phone 列会脱敏。

**错误输入**(strategy 非法值):

```json
{"strategy": "xxx"}
```

**预期**: schema 校验拒绝。

#### DM

同 Oracle。

---

## §9 数据生成(1 tool)

---

### 9.1 generate_sample_data

**Schema 要求**:`{tableName, rowCount?, options?}` (rowCount 默认 10, 最大 10000)。需要 `insert + batch` 权限。

#### Oracle

**正确输入**(测试表已存在,列宽够):

```json
{"tableName": "TEST_REGRESSION_TBL", "rowCount": 3, "options": {"seed": 42}}
```

**预期**: 插入 3 行,返回成功。

**正确输入 2**(只生成部分列):

```json
{"tableName": "X", "rowCount": 5, "options": {"columns": ["col1", "col2"]}}
```

**预期**: 只插入指定列,其他列用 DEFAULT 或 NULL。

**错误输入 1**(列宽不够 — 已实测):

```json
{"tableName": "TEST_REGRESSION_TBL", "rowCount": 3}  // status VARCHAR2(20)
```

**预期**: `ORA-12899: value too large for column ... "STATUS" (actual: 85, maximum: 20)`(faker 生成超长字符串)。

**Workaround**: 用 `columnOverrides` 或 `rules` 限制生成内容长度。

#### DM

**差异**:

- DM v8 也用 `VARCHAR(N)` 类似的字符串类型,长度限制相同
- DM 错误码不同(非 ORA-12899),可能抛 `-6602` 等
- 同样的 columnOverrides 策略可用

---

## §10 查询体验(3 tools)

---

### 10.1 get_metrics

**Schema 要求**:`{category?}` (summary | slow_queries | all, 默认 summary)。

#### Oracle / DM

**正确输入**:

```json
{}
```

**预期**: `{counters: [...], histograms: [...], gauges: []}`,每次 `execute_query` 后 counters 增长。

---

### 10.2 get_query_history

**Schema 要求**:`{db?, kind?, since?, until?, limit?, onlyErrors?, profileName?, groupBy?}`。

#### Oracle

**正确输入 1**(默认):

```json
{"limit": 10}
```

**预期**: `{entries: [<query history>...]}`,每条含 ts / db / kind / sql / profile_name。

**正确输入 2**(groupBy profile):

```json
{"groupBy": "profile"}
```

**预期**: `[{"profileName": "<ORACLE_PROFILE_NAME>", "count": N, "errors": 0, "avg_ms": 50}]`。

**错误输入**:无(参数都可空)。

#### DM

同 Oracle(history 按 profile 区分)。

---

### 10.3 audit_log

**Schema 要求**:`{actor?, severity?, profileName?, since?, until?, limit?}`。

#### Oracle / DM

**正确输入**:

```json
{"limit": 10}
```

**预期**: 写操作的审计记录(severity='write'/'ddl')。

**错误输入**:无。

---

## 附录 A: 已知差异速查

| 维度                     | Oracle                                     | DM                                                                                     |
| ------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| 默认 schema              | 当前用户名 = schema(常`<ORACLE_SCHEMA>`) | 通常`SYSDBA` 或显式 `TEST`                                                         |
| placeholder              | `?` / `:1` 都可以                      | `?`(建议)                                                                            |
| PL/SQL 块                | `BEGIN..END;/`                           | `BEGIN..END;/`(类似)                                                                 |
| LIMIT 语法               | `FETCH FIRST N ROWS ONLY`                | 同                                                                                     |
| 字符串类型               | VARCHAR2(N)                                | VARCHAR(N)                                                                             |
| `execute_batch`        | 通常稳定                                   | ⚠️ Bug#54 -6804 间歇失败,workaround: 走 `execute_script` 或 `execute_query` 循环 |
| `export_backup`        | 不在 MVP                                   | 取决于 DM 版本,可能需 EXPDP                                                            |
| 大小写敏感               | 默认 uppercase,quoted 才区分               | 类似                                                                                   |
| 错误码 prefix            | `ORA-XXXXX`                              | `dmXXXXX` / `-XXXX`                                                                |
| 数据字典表               | `USER_TABLES` / `ALL_TABLES`           | `INFORMATION_SCHEMA` / `SYSOBJECTS`                                                |
| `get_enum_values` 抽样 | 不支持 RANDOM()(回退全 DISTINCT)           | 类似                                                                                   |

---

## 附录 B: 通用 permission 矩阵

`create_profile` / `update_profile` 的 `permissionMode` 与 `config.permissions` 对应关系:

| permissionMode | config.permissions (自动展开)                                        |
| -------------- | -------------------------------------------------------------------- |
| `safe`       | `["read"]`                                                         |
| `readwrite`  | `["read", "insert", "update"]`                                     |
| `full`       | `["read", "insert", "update", "delete", "ddl", "script", "batch"]` |
| (未设)         | `["read"]`(默认)                                                   |

如果用户显式设 `config.permissions`,permissionMode 不再展开(以显式为准)。

各 tool 要求的最小权限:

- `execute_query`: 根据 SQL 类型 — SELECT 需要 `read`,INSERT 需要 `insert`,DDL 需要 `ddl`
- `execute_batch`: `batch`
- `execute_script`: `script`
- `generate_sample_data`: `insert + batch`
- 其它 tools(查询类、template、profile 类): 仅 `read`(信息类操作)

---

## 附录 C: 测试执行 checklist

执行前确认:

- [ ] MCP 启动,`.db-profile` 指向 `<ORACLE_PROFILE_NAME>`(已激活 Oracle 连接)
- [ ] DM 测试用 profile `test-dm` 已 `create_profile` 并 `use_profile`
- [ ] 两个 profile 都是 `permissionMode: 'full'`(测所有写入类 tool)
- [ ] `DB_ALLOWED_FILE_PATHS` env 包含 `<cwd>`(测 export_table_csv / import_csv / execute_sql_file)

执行时:

- [ ] 按 §1 → §10 顺序逐个调用
- [ ] 每次记录:Oracle ✅/❌、DM ✅/❌、备注
- [ ] 异常用 lint_sql / explain_query_with_advice / execute_batch 验证 DB 是否正常
- [ ] 完成 §2.5 clear_cache 清理 schema 缓存

执行后:

- [ ] 填"测试结果记录表"(顶部)
- [ ] 把异常收集到 §附录 D (待写)
- [ ] commit 报告
