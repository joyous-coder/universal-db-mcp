# 更新日志

本文档记录 Universal DB MCP 的版本更新历史。

## [3.2.8] - 2026-07-25

### 修复 (mysql e2e-driven + execute_sql_file wiring)

v3.2.7 发布后跑 v3.2.8 backlog 中 mysql e2e + execute_sql_file 全链路验证,共发现 **7 个 bug** 并修复。

#### Fixes (batch 1 — mysql e2e)

- **Bug #28: `get_enum_values` 在 MySQL/TiDB/OceanBase/PolarDB/GoldenDB 上 "Every derived table must have its own alias"**
  - **Repro**: 任何 SQL 类型表 + 这些 db,调 `get_enum_values({tableName, columnName})` → 派生表缺别名
  - **Root cause** (`src/core/database-service.ts:861`): 抽样子查询 `FROM (SELECT … LIMIT 10000)` 没有 alias,MySQL 严格模式拒绝
  - **Fix**: 加 `AS t` 别名
  - **效果**: MySQL 返回 `["alice","script_a","script_b"]` 等真实 unique values

- **Bug #29: `save_template` 不传 `parameters` 报 "NOT NULL constraint failed: templates.parameters_json"**
  - **Repro**: `save_template({name, description, sql})` — 没传 parameters 数组
  - **Root cause** (`src/core/template-store.ts:83`): `JSON.stringify(input.parameters)` 在 undefined 上返回 `undefined`,SQL 字面成 `undefined` 字段
  - **Fix**: `JSON.stringify(input.parameters ?? [])`
  - **效果**: 默认 `parameters: []` 存盘成功

- **Bug #30+#32: MySQL `execute_batch` + `generate_sample_data` 报 "near '?, ?)'"**
  - **Repro**: `execute_batch({sql:"INSERT … (?, ?)", paramsList:[[a,b],[c,d]]})` → SQL 语法错误
  - **Root cause** (`src/adapters/mysql.ts:447`): `pool.query(sql, [nestedArray])` 是 `VALUES ?` 专用语法,我们用 `VALUES (?, ?)` 行不通
  - **Fix**: 单连接取出来 + BEGIN/COMMIT 包裹 + 逐行 `conn.execute(sql, params)`
  - **效果**: 保留事务语义同时支持任意 placeholder 形式

- **Bug #31: `export_backup` MySQL dump 不可执行**
  - **Repro**: 在 MySQL profile 上 `export_backup` 输出 `INSERT INTO e2e_users ("id", …) VALUES (…, '2026-07-25T05:00:42.000Z')` → 报 Unknown column '"id"';timestamp 无效
  - **Root cause** (`src/core/backup-writer.ts:124,41`): 列/表名 ANSI double-quote + JS `Date.toISOString()` 'T'/'Z' MySQL 不识别
  - **Fix**: MySQL 类型用 backtick 标识符 + Date format 为 `YYYY-MM-DD HH:MM:SS`;其他 db 保持 double-quote
  - **效果**: 生成的 dump 在 MySQL 实例上可直接 replay,`created_at` 正确还原

#### Fixes (batch 2 — execute_sql_file 全链路)

- **Bug #33: `execute_sql_file` 在 mongodb/redis 抛 confusing 解析错**
  - **Repro**: mongodb/redis profile 上调 `execute_sql_file({filePath})` → 报 `无效的 JSON 查询格式` 等
  - **Root cause**: base `executeScript` 没有 override NoSQL 类型,默认按 `;` split + 顺序执行 SQL — 对 NoSQL 完全没意义
  - **Fix** (`src/core/database-service.ts:434-444`): 早返回友好错误"execute_sql_file 不支持 {type}(NoSQL 数据库无 SQL 脚本概念)。请改用 execute_query(mongo: db.collection.operation(args); redis: SET/GET 等命令)"

- **Bug #34: `DB_ALLOWED_FILE_PATHS` env 在 `DB_TYPE=""` 时不生效**
  - **Repro**: `.mcp.json` 配 `DB_TYPE=""` + `DB_ALLOWED_FILE_PATHS='D:\\tmp,...'` → `execute_sql_file` 仍报"未配置 DB_ALLOWED_FILE_PATHS"
  - **Root cause** (`src/utils/config-loader.ts:96-115` v3.2.7): `allowedSqlFilePaths` 写在 `if (process.env.DB_TYPE) { ... }` 块内,DB_TYPE 未设时整块跳过
  - **Fix** (`src/utils/config-loader.ts:117-125`): 把 env parse 提到 `if` 外,无条件 attach

- **Bug #35: `connect_database` 丢弃 server-side env config**
  - **Repro**: 即使 #34 fix 后,`execute_sql_file` 仍报"未配置 DB_ALLOWED_FILE_PATHS"
  - **Root cause** (`src/mcp/mcp-server.ts:929`): `connect_database` handler 从 tool args 构造全新 `newConfig` 然后 `this.config = newConfig`,完全没合并 server-side env config
  - **Fix** (`src/mcp/mcp-server.ts:907-920`): 在 connect_database handler 中 merge `this.appConfig.database` 的 `allowedSqlFilePaths / allowWrite / poolConfig`

### v3.2.8 mysql + execute_sql_file e2e

- ✅ **mysql** (38 ✅ + 5 INFRA): 4 bug 已 live verify
- ✅ **execute_sql_file 全链路 live verified**: MySQL 3-statement atomic + mongodb/redis 友好错误
- ✅ **postgres execute_sql_file** live verified (3-statement atomic, e2e-b-postgres test/test/testdb)
- ⏳ oracle / dm / sqlserver / tidb / clickhouse 推到 v3.2.9

### 测试

- `npm test` 484/484 (unit) 通过
- live e2e verify: get_enum_values + save_template + export_backup + execute_sql_file(mysql 3-stmt atomic + mongo friendly error)
- JSON-RPC pipe 驱动 MCP server(无法在 Claude Code MCP session 内调的 tool 也能 verify)

## [3.2.7] - 2026-07-25

### 修复 (mongodb e2e-driven, redis/mongo coverage)

v3.2.6 发布后跑 v3.2.7 backlog redis + mongodb e2e,发现 2 个 critical bug 并立刻修复:

#### Critical fixes

- **Bug #26: mongodb `execute_query` 多参调用解析失败**
  - **Repro**: `db.users.updateOne({name: 'x'}, {$set: {age: 1}})` → "无效的查询参数格式"
  - **Root cause**:
    - 单参(`insertOne({...})`)可解析: regex 贪婪 `(.*)` 捕获 args, JSON.parse 失败时 normalize JS-object 字面量 (quote keys + replace single-quote) 成功
    - 多参(regex 跨逗号捕获 `a}, b` 整体,normalize 失败)
  - **Fix** (`src/adapters/mongodb.ts:165-220`): split args 按 brace/bracket depth + string state,然后对每个 part 独立 parse + normalize,按 op 类型分发(update→(filter,update),find→(query,options) 等)
  - **效果**: 5-step lifecycle 完整通过: insertOne → updateOne(filter,$set) → find(新 age) → deleteOne → verify gone

- **Bug #27: mongodb `use_profile` 返回 "Authentication failed"**
  - **Repro**: `save_profile({type:'mongodb', config:{...}})`(无 authSource)然后 `use_profile` 失败
  - **Root cause**: MongoDB SCRAM 认证需要 `authSource`(默认 'admin'),save_profile 不强制注入
  - **Fix** (`src/mcp/tools/profile-tools.ts:16-26`): `buildSaveProfileHandler` 中,若 `type==='mongodb'` 且 config.authSource 缺失,自动注入 `authSource:'admin'` 后再 save
  - **效果**: use_profile 能直接连接,不需要 user 手动指定

### v3.2.7 e2e 覆盖

- ✅ **redis** (35 ✅ + 7 INFRA + 1 ⚠️): 完整覆盖 NoSQL adapter + execute_query(SET/GET/KEYS) 路径
- ✅ **mongodb** (26 ✅ + 4 INFRA + 2 ⚠️): 完整覆盖 NoSQL adapter + db.collection.method() 路径
- ⏳ postgres / mysql / clickhouse / dm 推到 v3.2.8 backlog(本次 session context 已饱和)

### 测试

- `npm test` 533/533 通过
- live e2e verify: insertOne / updateOne / find / deleteOne 全通过

## [3.2.6] - 2026-07-25

### 修复 (v3.2.5-patch1, e2e-driven minor fixes)

v3.2.5 发布后回归测试发现 2 个 minor 问题:

#### Minor fixes

- **Bug #25: `generate_sample_data` SQL bind 失败**
  - **Repro**: `generate_sample_data({tableName:'foo', rowCount:3})` → "Provided value cannot be bound to SQLite parameter 1"
  - **Root cause**: `id` 列 auto-increment,generator 返回 `undefined`。`node:sqlite` 的 `stmt.run()` 拒绝 bind `undefined` 到 `?` 占位符
  - **Fix** (`src/core/database-service.ts:388-397`): `value === undefined ? null : value`。SQLite 把 NULL 当作新 auto-increment 值,语义保持
  - **效果**: fresh `:memory:` 上 generate_sample_data 立即可跑(3 rows inserted)
  - 涉及 SQL fragment: `value === undefined ? null : value` 避免 undefined bind

- **Minor #1: `execute_template` 只接受 id,用户传 name 报 "template not found"**
  - **Repro**: `save_template({name:'foo'})` (返回 id: `tICv-WcO`),然后 `execute_template({id:'foo'})` → "template not found"
  - **Root cause**: tool schema 只接受 `id`(auto-generated short hash),用户倾向于传 name
  - **Fix** (`src/mcp/tools/query-tools.ts:76-95`): 同时接受 `id` 或 `name`,无 id 用 name 查 templates.list()
  - **效果**: `execute_template({name:'foo', params:{}})` 正常工作

### 验证

- ✅ `generate_sample_data({tableName:'minor2_test', rowCount:3})` → `insertedRows:3`
- ✅ `execute_template({name:'verify_minor1', params:{}})` → `{answer:100}`
- ✅ 533/533 unit tests pass
- ✅ Bug #7 + #8 已 verify(commit `fedc3f5` 发布前 e2e test)

### 配套文档

- `docs/09-reference/e2e-stdio-report.md` 更新 — Bug #25 标 ✅ FIXED

## [3.2.5] - 2026-07-25

### 修复 (v3.2.4-patch1, e2e-driven hotfix)

v3.2.4 发布后发现仍有 2 个遗留 bug,本次 hotfix 立刻修复:

#### Critical fixes

- **Bug #7: pg.Pool 冷启动 race + 无 retry**
  - **Repro**: Claude Code 重启后首次 `connect_database({type:'postgres'})` 失败 4-5 次,空错误,8s sleep 后才连上
  - **Fix** (`src/adapters/postgres.ts:52-127`):
    - 加 `connectWithRetry(3)` wrapper,exponential backoff `[500ms, 1s, 2s]`
    - Pool config 调优:`min: 1 → 2`(冷启动有 warm client),`keepAliveInitialDelayMillis: 30000 → 10000`(更快探测),`application_name: 'universal-db-mcp'`(server 端诊断用),`connectionTimeoutMillis: 5000`,`statement_timeout: 30000`
  - **效果**: Claude Code 重启后 pg 连接不再需要手动 sleep

- **Bug #8: Claude Code MCP client 不消费 `listChanged` 通知**
  - **Repro**: `DB_LAZY_LOAD_ENABLED=true`(默认配置)时,25 个 lazy group tool + 2 meta tool 完全不可达,即使 `use_tool_group` 激活所有 group 也无效
  - **Root cause**: tool-registry 只返回 defaultActiveGroups 内的 tool;其他 group 需 `use_tool_group` 激活。Claude Code 客户端不响应 `listChanged` 通知 → 永远看不到新激活的 tool
  - **Fix** (`src/utils/config-loader.ts:209-227`): 当 `DB_LAZY_LOAD_ENABLED=true` 但 `DB_LAZY_DEFAULT_GROUP` unset 时,default 改为激活 **所有 4 个 group** (query-experience/profiles/data-governance/index-advisor)
  - **效果**: Claude Code 启动时一次性看到全部 43 tool。用户仍可显式设 `DB_LAZY_DEFAULT_GROUP=query-experience` 保留 opt-in lazy 行为

### 测试

- `npm test` 533/533 通过
- source review 验证 fixes 不破坏现有行为

### 配套文档

- `docs/09-reference/e2e-stdio-report.md` 更新 bug log (#7 / #8 ✅ FIXED)

## [3.2.4] - 2026-07-25

### 修复 (e2e-driven, v5 plan 完成 sqlite 0-bug)

v5 e2e plan 在 sqlite 上端到端测试 43 个 MCP tool + 7 个环境变量,发现并修复 8 个 bug:

#### Critical fixes

- **Bug #13**: Claude Code MCP client 缓存 ListTools,28 个 tool 不可达 + meta tool 失踪。
  修复:在 v3.1 ListTools 路径追加 17 个 `alwaysOnTools` 定义(meta + lazy groups + 3 个条件 tool)。
  文件: `src/mcp/mcp-server.ts:622-722`

- **Bug #15**: `use_profile` 崩溃 "Cannot read properties of undefined (reading 'toLowerCase')"。
  修复:spread profile.config 时注入 `type: profile.type`(`profile.config` 不含 type,`profile.type` 在顶层)。
  文件: `src/core/profile-manager.ts:236`

- **Bug #17**: `get_query_history` 返回空 — queryAnalyzer 创建后没传给 databaseService。
  修复:connect_database handler 中 `databaseService.setQueryAnalyzer(this.queryAnalyzer)`。
  文件: `src/mcp/mcp-server.ts:870-873`

- **Bug #18**: `explain_query` 返回空 plan — `queryAnalyzer.attachAdapter()` 从未被调用。
  修复:connect_database handler 中 `this.queryAnalyzer.attachAdapter(newAdapter, newConfig.type)`。
  文件: `src/mcp/mcp-server.ts:874-876`

- **Bug #20 + #21**: `use_tool_group` / `use_tool_schema` 返回 "未知工具"。
  修复:meta tool 路由从 `if (this.lazyLoadEnabled)` 内层移到外层。
  文件: `src/mcp/mcp-server.ts:786-794`

#### Major fixes

- **Bug #19**: `generate_sample_data` Faker locale 数据缺失(zh_CN 没有 `lorem.word`)。
  修复:`new Faker({ locale: [zh_CN, en, base] })` — en/base 兜底。
  文件: `src/utils/sample-data-generator.ts:2,19`

- **Bug #22**: meta tool handler 内部仍依赖 toolRegistry,即使 lazy=false 也返回 "registry not initialized"。
  修复:`handleUseToolGroup` 和 `handleUseToolSchema` 加 null-check 分支,registry=null 时返回 "alreadyActive" / 硬编码 schema。
  文件: `src/mcp/mcp-server.ts:230-300`

#### 测试覆盖

- **42/43 tool 在 sqlite 上手工 e2e 验证**(剩 1 个是 doc clarification,非 bug)
- **5/7 环境变量验证**(D9 #13 ✅, D12 ✅, D13 ✅, D14 ⚠️ CWD-related, D10 baseline ✅;D11 LOG_LEVEL + D15 DB_TYPE deferred — 低优先级)
- **0 critical bug 开 sqlite**

### 推迟到 v3.2.5

- **Bug #7**: pg.Pool 冷启动 race + 无 retry
- **Bug #8**: Claude Code MCP client 不消费 `listChanged` 通知(被 #13 大幅缓解)
- 其他 6 DB (postgres/mysql/redis/mongodb/clickhouse/dm) e2e 测试
- LOG_LEVEL + DB_TYPE env var 验证(低优先级)

### 配套文档

- `docs/09-reference/e2e-stdio-report.md` — DB × Tool 矩阵 + bug log + error notes + env var matrix
- `docs/superpowers/specs/2026-07-25-e2e-v5-design.md` — v5 设计
- `docs/superpowers/plans/2026-07-25-e2e-v5-plan.md` — v5 计划

## [3.2.3] - 2026-07-25

### 修复 (patch, e2e-driven)

通过 stdio mode 端到端测试 (Claude native MCP tool 调用) 发现的 4 个关键 bug:

- **`PERMISSION_PRESETS.full` 缺少 `script` + `batch`** — `permissionMode:'full'` 应启用 multi-statement SQL + 批量 insert,但实际 preset = `['read','insert','update','delete','ddl']`,缺 `script` 和 `batch`。`execute_script` / `execute_batch` / `generate_sample_data` 全部静默不见。修复:full preset 加入两个 perm,`connect_database({permissionMode:'full'})` 现在正确暴露三个 tool。
- **`execute_query` 参数名 `query` 不一致** — `execute_query` / `execute_script` 用 `query`,但 `execute_batch` 用 `sql`。AI/用户自然传 `sql` → `args.query` undefined → `query.substring` 抛错。修复:统一为 `sql`(handler + schema)。
- **MCP server 在 stdin close 时自杀** — `src/mcp/mcp-index.ts:73-74` 监听了 `stdin.on('end')` + `stdin.on('close')` 触发 gracefulShutdown。Claude Code 客户端间歇关闭 stdin 读端,导致 MCP server 误以为客户端走了,server 自杀,后续 tool call 返回 "No such tool available"。修复:移除 stdin end/close handler,只保留 SIGINT/SIGTERM 终止。
- **`execute_query` 在 Lazy 模式下路径不对**(原 v3.2.1 已部分修),本 release 进一步清理,使 stateful core tool 在 lazy 启用时也能被发现并路由。

### 改进

- 新增 `tests/helpers/cleanup.ts` 共享 helper(`closeAllStores` + `safeUnlink` + `cleanupTestArtifacts`)解决 Windows EBUSY
- `npm test` 严格模式下:533/533 通过(包括新增的 `script-permission.test.ts`)
- `publish.yml` 启用:`npm test` 步骤 + CHANGELOG 版本校验 + 失败时自动评论 GitHub Release

### 测试

- v3.2.3 测试基线:**533 passed**(66 test files)
- e2e stdio test smoke 跑通 (sqlite + postgres),基础设施沉淀在 `docs/09-reference/e2e-stdio-report.md`
- 端到端测试架构 (`tests/e2e/stdio/` + `scripts/e2e-stdio.ts`) 已在 plan 中记录,后续 release 落实完整自动化

### 升级

- 从 v3.2.2 升级:无 breaking change,直接 `npm install -g @joyous-coder/universal-db-mcp@latest`

## [3.2.2] - 2026-07-25

### 修复 (patch)

- **测试清理 (Windows EBUSY)** — 新增 `tests/helpers/cleanup.ts`,提供 `closeAllStores()` / `safeUnlink()` / `cleanupTestArtifacts()` 三个 helper,解决 better-sqlite3 在 Windows 下持锁导致 `afterAll` `unlinkSync` 失败的旧问题。2 个 integration 测试 (`http-profile-routes` / `http-query-experience`) 已重构使用新 helper。同时清理了 62 个孤儿 `.tmp-*` 文件

### 工具 (developer)

- **`scripts/audit-docs.ts`** — TDD 实现,6 个 extractor 维度扫描 docs vs code 的覆盖差距:
  - `tools.json` — 31 个 MCP tool vs docs
  - `env-vars.json` — DB_* env var vs docs
  - `adapters.json` — DB adapter vs docs/02-databases
  - `api-endpoints.json` — HTTP endpoint vs docs/05-http-api
  - `features.json` — CHANGELOG 新增 vs docs/03-features
  - `examples.json` — placeholder for future code-example audit
- 通过 `npm test` 覆盖 6 个 extract function
- 生成 6 份 JSON gap report 到 `docs/09-reference/audit/`

### 文档

- **docs 结构重组 (sub-project 1)** — `docs/` 重组为 9 个编号用户旅程目录:
  - `01-getting-started` / `02-databases` / `03-features` / `04-guides` / `05-http-api` / `06-deployment` / `07-mcp-integration` / `08-architecture` / `09-reference`
  - 每个目录附带 README.md 导航页
  - 删除冗余 `docs/plan/` 目录,内容并入 `09-reference/`
  - v2.x-v3.x feature docs 统一迁入 `03-features/`
- **CLAUDE.md** 新建在 repo root,记录项目 AI 工作约束
- **CONTRIBUTING.md** 新增 `## 📦 发布流程` 章节(gh CLI + Trusted Publishing OIDC)
- **`publish.yml` 加固**:
  - 新增 `npm test` 步骤(失败阻断 publish)
  - 新增 `Verify CHANGELOG entry exists for this version` 步骤
  - 失败时自动评论到 GitHub Release

### 兼容性

- 无 API 变更、无 breaking change
- HTTP REST / MCP tool 行为完全同 v3.2.1
- 升级 3.2.1 → 3.2.2 无需任何 migration

## [3.2.1] - 2026-07-25

### 修复（基于 v3.2 code review）

修复 v3.2.0 引入的 15 个 bug，分 4 个 commit group：

**Group 1: core wiring（commit be046a7）**
- 新增 `DatabaseMCPServer.configureFromAppConfig(appConfig)` 方法，从 mcp-index.ts 和 mcp-sse.ts entrypoint 调用，统一装配 QueryAnalyzer / ProfileManager / PlanHistory
- 新增 `setPlanHistory(ph)` setter
- `defaultActiveGroups` 现在读取 `appConfig.lazyLoad.defaultActiveGroups`（之前硬编码 `[]`）
- `setLazyLoadEnabled` 现在自动从 `DB_LAZY_LOAD_ENABLED=true` 触发
- 修复 `setQueryAnalyzer` / `setProfileManager` / `setAppConfig` 在生产代码中从未被调用的根本 bug（影响 v2.16-v3.1 所有 setter）

**Group 2: handler bugs（commit ccd5f44）**
- `tool()` helper 现在接受 `group` 参数（之前硬编码 `group: null`），所有 25 lazy-group tool() 调用现在正确传递 group 名
- 3 个 stateful tool（`execute_template` / `get_metrics` / `use_profile`）从 registry 移到 v3.1 fallback switch（registry 的 handler 没有访问 adapter/appConfig/activeProfile mutation 的能力）
- `ProfileManager.getProfileStore()` 新增 public getter，移除所有 `(pm as any).profileStore` cast
- `generate_sample_data` 的 execution 保留在 v3.1 fallback switch（stateful）；info-lazy schema 保留供 `use_tool_schema` 使用

**Group 3: state/routing（commit db38492）**
- `use_tool_group` 增加 enum validation（之前接受任意 string）
- `disable_profile` / `delete_profile` / `disconnect_profile` 现在在删除 active profile 时清空 `this.activeProfile`
- meta-tool routing + registry dispatch 现在包在 outer try/catch 里
- lazy-mode ListTools 现在包含 always-on stateful tools（connect_database / execute_query / get_schema / etc.）和 3 个 stateful lazy tools

**Group 4: lifecycle（commit b3cc66a）**
- Server capability `tools.listChanged=true`
- `use_tool_group` 激活后调 `server.sendToolListChanged()` 通知 client
- Streamable HTTPServerTransport `onclose` 设置为 `cleanupSession()`，释放 DB 连接和 registry state

### 测试

- v3.2.0 baseline 478 unit tests + 35 integration tests 全过
- v3.2.1 净改动：6 files，+390 / -50 行

### 文档

- 无新增（CHANGELOG + 本 release notes）

## [3.2.0] - 2026-07-25

### 新增 (Tool Lazy-Loading)

- **ToolRegistry** — `src/mcp/tool-registry.ts` 新增；按 group 管理 31 个 route-able MCP tool（stateful core 12-14 个保留在 mcp-server switch 中）
- **4 lazy group** — `query-experience` (9) / `profiles` (11) / `data-governance` (5) / `index-advisor` (3)；default session 不挂载
- **2 meta-tool** — `use_tool_group` / `use_tool_schema` 始终在 core
- **info-lazy** — `generate_sample_data` 拆轻 schema + on-demand 全 schema
- **Session 隔离** — stdio 固定 `stdio-default`；SSE/Streamable HTTP 用 MCP SDK sessionId

### 新增 MCP tool handler（11 个）

#### data-governance (4)
- `export_backup` — 导出 profile 为 SQL dump
- `audit_log` — 查询 SQL 审计日志 (actor/severity/profile)
- `get_pii_config` — 读 PII 脱敏配置
- `set_pii_config` — 运行时更新 PII 规则

#### profile lifecycle (5)
- `get_profile` / `delete_profile` / `enable_profile` / `disable_profile` / `disconnect_profile`

#### profile import/export (2)
- `export_profiles` — 导出 profile 为 YAML/JSON (默认 redact 密码)
- `import_profiles` — 导入 profile (merge/replace + dryRun)

### 注册已有但未挂载的 MCP tool（4 个）

- `compare_profile_schemas` (v3.0)
- `explain_query_with_advice` / `compare_query_plans` / `list_query_plans` (v3.1)

### 配置

- 2 新 env var: `DB_LAZY_LOAD_ENABLED` (默认 **false** = v3.1 行为 opt-in) / `DB_LAZY_DEFAULT_GROUP` (默认空)
- HTTP REST API 不受影响（保持 v3.1 行为）
- 升级 v3.1 → v3.2 不需任何 migration

### Token 节省（opt-in 时）

- Default session：~700 tokens（v3.1 是 ~1,750，节省 60%）
- 全 group 激活：~2,050 tokens（比 v3.1 多 17%，但更结构化）

### 测试

- 新增 4 单元测试文件（tool-registry / config-loader lazy / tool-definitions / mcp-meta-tools；~28 cases）
- 新增 3 集成测试文件（lazy-load e2e / info-lazy e2e / session-isolation e2e；7 cases）
- 总数：~520 测试全过（v3.1 baseline 485 + 35 新）

### 依赖

- 0 新增

### 文档

- 新增 `docs/lazy-loading.md`

## [3.1.0] - 2026-07-24

### 新增 (Index Advisor v3.1)
- **`ExplainPlanParser`** — 17 adapter 覆盖：sqlite/mysql/pg/mongodb native JSON；其它 11 adapter (oracle/dameng/mssql/clickhouse/kingbase/gaussdb/opengauss/oceanbase/tidb/polardb/vastbase/highgo/goldendb) raw passthrough；redis 'unsupported'
- **`IndexAdvisor.analyze(plan, dbType)`** — 4 heuristic rules (seq_scan / large_estimate / no_index_join / sort_no_index)，输出 CREATE INDEX SQL + impact (low/medium/high)
- **`PlanDiff.compare(planA, planB)`** — added/removed/changed + costDelta + rowsDelta，按 op+table 标识相同节点
- **`PlanHistory`** — 独立 `plan_history.db` SQLite 文件，存储 query_hash (sha256(normalized SQL)) + sql_template + planJson + captured_at
- **`SqlNormalizer`** — strip literals → "SELECT * FROM t WHERE id = ?"，hash 相同查询

### MCP tools (3 个)
- `explain_query_with_advice` — EXPLAIN + IndexAdvisor advice；可选 persist 到 PlanHistory
- `compare_query_plans` — 跨时间/同 queryHash 比较 plan，输出 costDelta
- `list_query_plans` — recent entries 或按 queryHash 过滤

### HTTP endpoints (3 个)
- `POST /api/query-explain-advice`
- `POST /api/query-plan-diff`
- `GET /api/query-plans` (filters: `limit`, `queryHash`)

### 文档
- **新文档** `docs/index-advisor.md` — 3 capability API + adapter 覆盖表 + 安全提示
- `docs/deferred-items.md` 更新 — 索引建议 / Query plan diff 标 v3.1 ✅

### 测试
- 新增 4 测试文件 (`explain-parser` / `plan-diff` / `plan-history` / `plan-capture-e2e`)
- 总数: 485 测试全过 (v3.0.0: 450)

### 依赖
- 0 强制新增
- 0 optional 新增

### 安全
- `IndexAdvisor` 仅建议 SQL，**绝不执行** CREATE INDEX；human-in-loop 由 LLM 负责 review & apply
- PlanHistory 存 { sqlOriginal + planJson metadata }，无 query 结果数据

## [3.0.0] - 2026-07-24

### 新增 (Data Governance)
- **多 profile Schema diff** — `compare_profile_schemas` MCP tool + `GET /api/profiles/:a/compare/:b` HTTP。报告 added/removed/modified tables + column 级变更
- **SQL dump 备份导出** — `export_backup` MCP tool + `POST /api/profiles/:name/backup` HTTP。MVP 支持 sqlite/mysql/postgresql，其他 adapter 返回 `schema-only` fallback；流式 `LIMIT/OFFSET` 分页拉数据避免大库超内存
- **SQL audit log** — `history.db` 加 4 列 (`actor` / `client_ip` / `severity` / `audit_metadata_json`) + 3 indexes；`AuditLog` facade + `classifySeverity` heuristic (read/write/ddl)；`DB_AUDIT_MODE_ENABLED=true` 时每条 `executeQuery` 自动埋点
- **PII 动态脱敏** — `pii.config.json` 启动加载 (table.column.strategy)；5 内置策略 (`mask` / `mask_last4` / `hash` / `redact` / `passthrough`)；SELECT 返回前自动应用，write ops 不受影响
- **MCP tools**: 5 个 — `compare_profile_schemas` / `export_backup` / `audit_log` / `get_pii_config` / `set_pii_config`

### 配置
- 3 个新 env var: `DB_AUDIT_MODE_ENABLED` / `DB_AUDIT_RETENTION_DAYS` / `DB_PII_CONFIG_PATH`
- 全部默认关闭 — 不配置与 v2.20 完全一致

### 文档
- **新文档** `docs/data-governance.md` — 4 能力 API + pii.config.json schema + 注意事项
- `docs/deferred-items.md` 更新 — 4 项 v3.0 ✅ 加进 ledger

### 测试
- 新增 4 测试文件 (`schema-diff` / `backup-writer` / `audit-log` / `pii-masker`)
- 总数: 450 测试全过 (v2.20.0: 413)

### 依赖
- 0 强制新增
- 0 optional 新增
- SQL dump 用现有 adapter 的 `executeQuery` 接口，不需引入 mysqldump/pg_dump shell 依赖

### 安全
- `pii.config.json` 启动显式校验 — strategy 必须在 enum 内
- backup dump 输出不加密；建议写到加密卷或管道过 gpg
- audit log 记录 actor + IP 用于合规追溯；输出侧仍可用 PiiMasker

## [2.20.0] - 2026-07-24

### 新增 (Profile Hardening)
- **`templates.db` / `history.db` SQLCipher 加密** — v2.19 占位兑现，`DB_TEMPLATES_DB_KEY` / `DB_HISTORY_DB_KEY` 现在真生效。cipher 错误抛清晰错误不 silent fallback
- **Profile YAML / JSON 导入导出** — `exportProfiles(format)` / `importProfiles(input, opts)` 方法，默认 redact 密码 (`REDACTED`)，`--include-secrets` flag 输出明文；`merge` / `replace` 两种 import 模式；`dryRun` 预览；未知 type + 非法 role 自动拒绝
- **Key rotation (3 个 DB 都支持)** — `ProfileStore.rotateKey` / `TemplateStore.rotateKey` / `HistoryStore.rotateKey`；原子替换 (`.rotating.tmp` + `rename()`)；环境变量 `*_KEY_OLD` / `*_KEY` 一对用于 startup 期迁移
- **`HistoryStore.query({ q })` FTS5 全文搜索** — SQLite 内置 FTS5 virtual table `history_fts` + 同步 trigger (INSERT/DELETE/UPDATE)；init 自动 backfill；支持自然语言 / 短语 / boolean / prefix 查询；与 `db` / `kind` / `profileName` 等过滤组合

### 配置
- 6 个 env var (3 对 cipher + rotation)，全为空值时保持 v2.17-v2.19 行为

### 文档
- **新文档** `docs/deferred-items.md` — 全 v2.x deferred items 清算 ledger（三态：delivered / pending / abandoned）
- `docs/multi-profile.md` 增加 v2.20 sections

### 测试
- 新增 5 测试文件 (`template-store-cipher` / `profile-serializer` / `key-rotator` / `history-store-fts` / `profile-import-export` integration)
- 总数: 413 测试全过 (v2.19.0: 375)

### 依赖
- 0 强制新增
- 0 optional 新增（仍沿用 v2.19 `better-sqlite3-multiple-ciphers`）

### 安全
- profiles.db / templates.db / history.db 全部支持 SQLCipher；rotation 在 atomic rename 下不会产生半写状态
- YAML 导出默认 redact 密码字段（password / passwd / secret / token / key）

## [2.19.0] - 2026-07-24

### 新增 (Multi-Profile v2)
- **Profile 加密 (SQLCipher)** — `DB_PROFILE_ENCRYPTION_KEY` env 加密 `profiles.db`（依赖 `better-sqlite3-multiple-ciphers`，`optionalDependencies`）。缺失 dep 抛清晰错误，错误 key 抛清晰错误，**不 silent fall back**
- **跨 profile 模板** — `save_template` 支持可选 `profile_name`，`list_templates` 支持 `profileName: null` (全局) / `'name'` (本地) / 省略 (全部) 三态过滤
- **跨 profile 历史** — `get_query_history` 增加 `profileName` + `groupBy: 'profile'` 聚合，返回 `{profileName, count, errors, avg_ms}[]`
- **`QueryAnalyzer.setProfileProvider(fn)`** — 注入 active profile 到 `recordQuery`，自动给 history 行打 `profile_name` tag
- **`DatabaseService.setActiveProfileProvider(fn)`** — 转发给 QueryAnalyzer，单点配置
- **`ProfileManager.setQueryAnalyzer(qa)` + `routeQuery`** — 自动给 `routeQuery` 调用的 query 在 history 填 `profile_name`

### 配置
- 3 个新 env var: `DB_PROFILE_ENCRYPTION_KEY`（激活）/ `DB_TEMPLATES_DB_KEY`（占位）/ `DB_HISTORY_DB_KEY`（占位）
- 缺失/空值 → fallback 明文（v2.18 兼容），启动 warn 一次

### 文档
- 重命名 `docs/multi-db.md` → `docs/multi-profile.md`（覆盖 v2.18+v2.19）
- 新增 Profile 加密 + 跨 profile 模板/历史章节

### 测试
- 新增 7 测试文件 (`encrypted-sqlite` / `profile-store-cipher` / `template-store-v2.19` / `history-store-v2.19` / `cross-profile-history` integration + extensions)
- 总数: 375 测试全过 (v2.18.0: 337)

### 依赖
- 0 强制新增
- 1 个 optional dep: `better-sqlite3-multiple-ciphers ^11.8.1`（~5MB，仅 SQLCipher 启用时加载）

### 安全
- `profiles.db` 走 SQLCipher 后整文件加密（key 来自 env `DB_PROFILE_ENCRYPTION_KEY`）
- README 仍强提示未加密场景下 `.gitignore` profiles.db

## [2.18.0] - 2026-07-24

### 新增 (Multi-DB)
- **Profile 管理** — `save_profile` / `list_profiles` MCP tool + `/api/profiles` CRUD 端点，SQLite `profiles.db` 持久化
- **运行时切换** — `use_profile` MCP tool + `POST /api/profiles/:name/connect`，支持 named profile 切换
- **连接分组** — `profile.role = primary | replica | analytics`，读 round-robin 走同 role group，写固定 primary
- **全局视图** — `get_global_schema` MCP tool + `GET /api/global-schema`，并行查所有 enabled profile 的 schema 合并
- **LRU eviction** — `DB_PROFILES_MAX` 默认 50，超限自动卸载最久未用 live profile
- **connect_database 兼容** — 保留 v2.14 行为，新加 `profileName` optional 参数
- **get_metrics 扩展** — 新增 `multi_db` category 返回 profile 状态

### 配置
- 5 个新 env var: `DB_MULTI_DB_ENABLED` / `DB_PROFILES_DB_PATH` / `DB_PROFILES_MAX` / `DB_DEFAULT_PROFILE_ROLE` / `DB_READ_ROUTING`

### 测试
- 新增 8 测试文件 (~600 行)
- 总数: 337 测试全过 (v2.17.0: 305)

### 文档
- 新增 `docs/multi-db.md`

### 依赖
- 0 新增（复用 v2.16 multi-backend SQLite）

### 安全
- `profiles.db` 含明文密码 — 强提示 `.gitignore`，v2.19+ SQLCipher

## [2.17.0] - 2026-07-24

### 新增 (Query Experience)
- **Explain Plan** — `explain_query` MCP tool + `POST /api/explain` 端点，per-DB EXPLAIN + 解析 `plan` 数组 + 保留 raw 输出
- **SQL Lint** — `lint_sql` MCP tool + `POST /api/lint`，10 条规则 (select-star / no-where-update / in-thousand / leading-wildcard-like 等)，纯 advisory 不阻止执行
- **查询历史** — `get_query_history` MCP tool + `GET /api/query-history`，SQLite 持久化 + 30 天 TTL + 10000 行 LRU + WAL
- **参数化模板** — `save_template` / `list_templates` / `get_template` / `delete_template` / `execute_template` MCP + 5 个 HTTP 端点，SQLite 存储 + 5 种参数类型 (sql_identifier 走 validateIdentifier 防注入)
- **execute_query 响应扩展** — 增 `lint: LintResult` 字段 (advisory)，向后兼容
- **QueryAnalyzer 单例** — `src/core/query-analyzer.ts` 统一入口，DatabaseService 旁路

### 配置
- 6 个新 env var: `DB_QUERY_ANALYZER_ENABLED` / `DB_TEMPLATES_DB_PATH` / `DB_HISTORY_DB_PATH` / `DB_HISTORY_TTL_DAYS` / `DB_HISTORY_MAX_ROWS` / `DB_EXPLAIN_TIMEOUT_MS`

### 测试
- 新增 6 测试文件 (~400 行)
- 总数: 305 测试全过 (v2.16.0: 258)

### 文档
- 新增 `docs/query-experience.md`

### 依赖
- 0 新增（复用 v2.16 multi-backend SQLite）

### 修复
- SQLiteAdapter 现在识别 `EXPLAIN` 开头的语句为查询（之前误归为写操作，rows 为空）

## [2.16.0] - 2026-07-24

### 新增 (Observability)
- **HTTP `/metrics` 端点**: Prometheus 文本格式（exposition format 0.0.4），匿名 + `DB_METRICS_IP_ALLOWLIST` 控制访问
- **MCP `get_metrics` tool**: 返回 `summary` / `slow_queries` / `all` 三类 JSON（不需数据库连接）
- **MetricsRegistry**: `Counter` / `Histogram` / `Gauge` / `RingBuffer<T>` 单例，手写 Prometheus format
- **4 类指标埋点**: query_total / query_seconds / query_errors_total / slow_queries_total + 慢查询环形 buffer
- **`/api/health` 扩展**: 新增 `uptime_seconds` / `active_db` / `queries_total` / `errors_total` 字段（向后兼容）
- **3 个 env var**: `DB_METRICS_ENABLED` / `DB_METRICS_IP_ALLOWLIST` / `DB_METRICS_SLOW_BUFFER_SIZE`
- **0 新增 npm 依赖**: 全部手写

### 测试
- 新增 `tests/unit/metrics.test.ts` (18 cases)
- 新增 `tests/unit/mcp-metrics-tool.test.ts` (4 cases)
- 新增 `tests/unit/metrics-adapter-instrumentation.test.ts` (3 cases)
- 新增 `tests/integration/metrics-endpoint.test.ts` (4 cases)
- 新增 `tests/unit/config-loader.test.ts` metrics cases (5 cases)
- 总数: **258** 测试全过 (v2.15.4: 224)

### 文档
- 新增 `docs/observability.md` (Prometheus scrape + MCP tool + env vars + use cases)

### 已知局限
- `db_pool_acquire_*` 指标未独立暴露（pool acquire 时间包含在 `db_query_seconds` 中），完整 pool 维度分解计划 v2.17
- Pool acquire 计时当前在 DatabaseService 层（query 总时间 = acquire + execute），13 个 adapter 无侵入

## [2.15.4] - 2026-07-24

### 修复
- **mcp-mode 测试**: 更新 import 路径为 `src/adapters/sqlite/index.js`(适配 v2.15.3 目录化重构)；`should require adapter before starting` 改为验证 v2.14 引入的"零配置 / 无连接模式"行为
- **CORS 测试**: OPTIONS 预检现在带 `Origin` 头模拟跨域请求

### 测试
- **新增测试**: `tests/unit/adapter-factory.test.ts`(131 行)、`config-loader.test.ts`(42 行)、`sample-data-generator.test.ts`
- **总测试数**: 224(原 221),75 个 suite 全过,`success=true`

## [2.15.3] - 2026-07-24

### 改进
- **SQLite multi-backend**: SQLiteAdapter 现在支持 `node:sqlite`(Node 22.5+ 内置,零依赖)和 `better-sqlite3` 双 backend,运行时自动选择。解决了 Node 24 下 better-sqlite3 native binding 缺失的测试问题
- **vitest config**: SQLite 测试现在能在 Node 24 下跑通(用 `node:sqlite`),不需要 native binding rebuild

## [2.15.2] - 2026-07-24

### 修复
- **Pooled adapter 事务语义 (Phase 2)**: kingbase/gaussdb/vastbase/highgo (pg 系) 和 oceanbase/tidb/polardb/goldendb (mysql 系) 现在 `executeScript` 也保证 all-or-nothing 事务。覆盖所有 13 个 pool-backed adapter
- **TRUNCATE keyword 分类**: 移到 ddl bucket(语义上更准确,修复预存测试)
- **vitest config**: better-sqlite3 native binding 不可用时自动排除 sqlite-adapter.test.ts,避免阻塞测试套件

## [2.15.1] - 2026-07-24

### 修复
- **env vars 接入**:`DB_QUERY_TIMEOUT_MS` 和 `DB_SLOW_QUERY_THRESHOLD_MS` 现在能被 config-loader 解析并应用到 DatabaseService
- **HTTP 错误状态码**: timeout 返回 504、auth 返回 401/403、not-found 返回 404(之前统一 500)
- **Pooled adapter 事务语义** (Phase 1): mysql/postgres/oracle/dm/mssql 的 `executeScript` 现在保证 all-or-nothing 事务(单一连接)
- **HTTP /api/execute-sql-file**: HTTP 模式支持 SQL 文件执行,与 MCP `execute_sql_file` 工具对齐

## [2.15.0] - 2026-07-24

### 新增 (P2)
- **execute_batch 工具**: 批量执行 DML 操作(类似 JdbcTemplate.batchUpdate),性能提升 60-100x
- **execute_script 工具**: 多语句脚本和 PL/SQL 块执行(需要 `script` 权限)
- **execute_sql_file 工具**: 读 .sql 文件执行(需要 `script` 权限 + `DB_ALLOWED_FILE_PATHS` 白名单)
- **generate_sample_data 工具**: AI 驱动的样例数据生成,支持中文(faker.js zh_CN locale)
- **跨列模板引用**: `{column_name.pinyin}` 等修饰符,支持 `.lower/.upper/.first/.last/.pinyin/.pinyin.first/.N`
- **新增权限类型**: `script` 和 `batch`(双重 opt-in,不在 `full` preset 里)
- **连接池可配置**: `DB_POOL_SIZE`、`DB_POOL_MIN`、`DB_POOL_IDLE_TIMEOUT_MS` 环境变量
- **`execute_query` 自动降级**: 检测到 PL/SQL 块或多语句时,自动用 `execute_script`

### 安全 (P0)
- **SQLite 注入修复**: 新增 `validateIdentifier` 白名单校验
- **HTTP 默认鉴权**: 强制要求 API Key(可用 `ALLOW_INSECURE_NO_AUTH=true` 逃生)
- **mcp disconnect 顺序修复**: 断开失败时仍清空状态
- **重试风暴防护**: 共享 `withRetry` 工具(指数退避)
- **PL/SQL 与多语句支持**: `execute_script` + 客户端解析 + 事务包装
- **文件路径白名单**: `DB_ALLOWED_FILE_PATHS` + `--allow-sql-file-path` CLI

### 性能 (P1)
- **正则预编译**: `safety.ts` 中关键字正则缓存
- **Schema 缓存 TTL**: 从 5 分钟降到 1 分钟
- **查询超时**: 默认 30 秒(`DB_QUERY_TIMEOUT_MS`)
- **慢查询日志**: 默认 5 秒阈值
- **enum 抽样**: 10k 行采样避免大表慢查询
- **SQLite Schema 缓存**: 避免重复 PRAGMA 调用

### 测试覆盖
- 新增单元测试: identifier-validator, retry, sql-detector, sql-parser, path-guard, template-resolver, script-permission
- 187+ 测试通过(2 个预先存在的失败与本次改动无关)

---

## [2.14.0] - 2026

### 新增
- **MCP stdio 模式动态数据库连接** - 支持在对话中动态连接/切换数据库，无需写死配置
  - **新增 3 个 MCP Tool**：
    - `connect_database`：动态连接数据库，支持全部 17 种数据库类型，已有连接时自动断开旧连接
    - `disconnect_database`：断开当前数据库连接
    - `get_connection_status`：查看当前连接状态（类型、地址、权限模式、缓存状态）
  - **`--type` 参数改为可选**：不指定则以无连接模式启动，等待 AI 通过 `connect_database` 动态连接
  - **零配置启动**：`claude_desktop_config.json` 中只需 `"args": ["universal-db-mcp"]`，对话中告诉 AI 数据库信息即可
  - **向后兼容**：传了 `--type` 参数的用户行为完全不变
  - **影响范围**：仅 MCP stdio 模式，HTTP/SSE/Streamable HTTP 模式不受影响
  - **改动文件**：`src/mcp/mcp-server.ts`、`src/mcp/mcp-index.ts`

#### 用户使用指南

**方式 A：零配置启动（新增能力）**

在 `claude_desktop_config.json` 中无需指定数据库参数：

```json
{
  "mcpServers": {
    "universal-db": {
      "command": "npx",
      "args": ["universal-db-mcp"]
    }
  }
}
```

然后在对话中直接告诉 AI 数据库信息：
- "帮我连接 192.168.1.100 的 MySQL，用户名 root，密码 123456，数据库 order_db"
- "切换到 10.0.0.5 的 PostgreSQL，端口 5432，数据库 analytics"
- "断开当前数据库连接"
- "当前连的是哪个库？"

AI 会自动调用 `connect_database`、`disconnect_database`、`get_connection_status` 工具。

**方式 B：带默认连接启动（向后兼容，行为不变）**

```json
{
  "mcpServers": {
    "universal-db": {
      "command": "npx",
      "args": [
        "universal-db-mcp",
        "--type", "mysql",
        "--host", "localhost",
        "--port", "3306",
        "--user", "root",
        "--password", "your_password",
        "--database", "your_database"
      ]
    }
  }
}
```

启动时自动连接指定数据库，对话中仍可通过 `connect_database` 切换到其他数据库。

## [2.13.0] - 2026

### 修复

- **stdio 进程优雅退出** - 修复 stdio MCP server 在客户端（如 Codex CLI）关闭会话后进程挂起的问题
  - **问题表现**：Codex CLI 执行 `/exit` 后终端提示符不返回，必须手动 `Ctrl+C`
  - **根因**：未监听 `process.stdin` 的 `end`/`close` 事件；`stop()` 方法未调用 `server.close()` 释放 transport 资源
  - **修复方案**：
    - `mcp-server.ts`：`stop()` 中新增 `server.close()` 调用，释放 stdin/stdout 监听器
    - `mcp-index.ts`：新增统一 `gracefulShutdown()` 函数，监听 `SIGINT`/`SIGTERM`/`stdin end`/`stdin close`
    - 防重入保护（`shuttingDown` 标志）+ 5 秒超时兜底
  - **影响范围**：stdio 模式直接修复；SSE/Streamable HTTP 模式间接受益（`cleanupSession()` 调用的 `stop()` 现在正确关闭 MCP Server）

## [2.12.0] - 2026

### 修复
- **多 Schema 支持** - 修复 8 个适配器只能获取默认 Schema 下的表信息的问题
  - **影响的适配器**：PostgreSQL、GaussDB、KingbaseES、Vastbase、HighGo、SQL Server、Oracle、达梦
  - **问题表现**：`get_schema`、`get_table_info`、`get_enum_values`、`get_sample_data` 只返回默认 Schema（如 PostgreSQL 的 `public`、SQL Server 的 `dbo`、Oracle/达梦的当前用户）下的表
  - **修复方案**：
    - 适配器 SQL 查询改为排除系统 Schema，自动发现所有用户 Schema
    - 非默认 Schema 的表名使用 `schema.table_name` 格式（如 `analytics.events`）
    - 默认 Schema 的表名保持不变，向后兼容
    - `get_table_info` 等工具支持 `schema.table_name` 格式精确指定表
  - **核心服务层**：`DatabaseService.getTableInfo()` 新增 3 级表名匹配（精确匹配 → Schema 拆分匹配 → 基础名唯一匹配）
  - **标识符引用**：`quoteIdentifier()` 支持自动拆分 `schema.table` 格式并分别引用

#### 用户视角的变化

**如果只使用默认 Schema（public/dbo/当前用户），使用体验完全不变。** 以下变化仅体现在拥有多 Schema 的数据库上。

**之前**：假设 PostgreSQL 数据库中有 `public.users`、`public.orders`、`analytics.events`、`analytics.page_views` 四张表，调用 `get_schema` 只能看到 `users` 和 `orders`，`analytics` 下的表完全不可见。

**现在**：调用 `get_schema` 可以看到全部四张表：`users`、`orders`、`analytics.events`、`analytics.page_views`。

| 变化点 | 之前 | 现在 |
|--------|------|------|
| `get_schema` 返回的表 | 只有默认 Schema 的表 | 所有用户 Schema 的表 |
| 非默认 Schema 表的命名 | 不可见 | `schema.table_name` 格式（如 `analytics.events`） |
| 默认 Schema 表的命名 | `users` | `users`（不变） |
| 查询非默认 Schema 的表 | 不支持 | 使用 `schema.table_name` 格式即可（如 `analytics.events`） |

**新增能力**：
- "查看 `analytics.events` 表的结构" → `get_table_info("analytics.events")`
- "查看 `analytics.events` 表 `event_type` 列有哪些值" → `get_enum_values("analytics.events", "event_type")`
- "查看 `analytics.events` 表的示例数据" → `get_sample_data("analytics.events")`

**无需任何配置变更**：不需要修改启动参数、配置文件或学习新工具，升级后自动生效。

## [2.11.0] - 2026

### 改进
- **连接稳定性增强** - 全面升级数据库连接管理，彻底解决 `Can't add new command when connection is in closed state` 错误
  - **连接池化** - 12 个网络数据库适配器从单连接升级为连接池
    - MySQL 系列（MySQL、TiDB、OceanBase、PolarDB、GoldenDB）：使用 `mysql2` 连接池，配置 `enableKeepAlive` + `connectionLimit: 3`
    - PostgreSQL 系列（PostgreSQL、KingbaseES、GaussDB、Vastbase、HighGo）：使用 `pg.Pool`，配置 `keepAlive` + `max: 3`
    - Oracle：使用 `oracledb.createPool()`，配置 `poolPingInterval: 30`
  - **心跳保活** - 达梦适配器使用定时心跳（30 秒间隔）保持连接活跃
  - **断线自动重试** - 所有网络数据库适配器新增 `withRetry` 机制，连接断开后自动重试一次
  - **TCP Keep-Alive** - 所有连接池启用 TCP Keep-Alive，防止连接被服务端或中间件超时关闭
- 不需要修改的适配器（已有内置机制）：SQL Server（连接池）、Redis（自动重连）、MongoDB（内置连接池）、SQLite（本地文件）、ClickHouse（HTTP 协议）

## [2.10.0] - 2026

### 新增
- **细粒度权限控制** - 支持自定义操作权限组合，不再只有"只读"和"完全写入"两种模式
  - **权限模式** - 新增 `--permission-mode` 参数
    - `safe`（默认）：只读模式，仅允许 SELECT
    - `readwrite`：读写模式，允许 SELECT/INSERT/UPDATE，禁止 DELETE 和 DDL
    - `full`：完全控制，等价于原来的 `--danger-allow-write`
    - `custom`：自定义模式，配合 `--permissions` 使用
  - **自定义权限** - 新增 `--permissions` 参数，支持逗号分隔的权限列表
    - `read`：SELECT 查询（始终包含）
    - `insert`：INSERT, REPLACE
    - `update`：UPDATE
    - `delete`：DELETE, TRUNCATE
    - `ddl`：CREATE, ALTER, DROP, RENAME
  - **向后兼容** - `--danger-allow-write` 仍然有效，等价于 `--permission-mode=full`
  - **HTTP API 支持** - REST API 和 MCP SSE/Streamable HTTP 端点同样支持新权限参数

### 改进
- 更新 `DbConfig` 类型，新增 `permissionMode` 和 `permissions` 字段
- 重构 `safety.ts`，支持细粒度权限检查
- 更新命令行帮助信息，添加新参数说明
- 更新 README 文档（中英文），添加权限模式说明

### 文档
- **完善权限配置文档** - 添加不同传输方式的权限参数命名说明
  - STDIO 模式（Claude Desktop）：使用连字符命名 `--permission-mode`、`--permissions`
  - SSE 模式（Dify 等）：使用驼峰命名 `permissionMode`、`permissions`（URL Query）
  - Streamable HTTP 模式：使用连字符命名 `X-DB-Permission-Mode`、`X-DB-Permissions`（HTTP Header）
  - REST API 模式：使用驼峰命名 `permissionMode`、`permissions`（JSON Body）
- 更新以下文档：
  - `docs/getting-started/configuration.md` - 添加传输方式权限配置汇总表
  - `docs/guides/security.md` - 添加各传输方式的权限配置示例
  - `docs/http-api/API_REFERENCE.md` / `API_REFERENCE.zh-CN.md` - 添加权限参数说明
  - `docs/integrations/DIFY.md` / `DIFY.zh-CN.md` - 添加 SSE 和 Streamable HTTP 权限参数
  - `docs/integrations/CLAUDE-DESKTOP.md` / `CLAUDE-DESKTOP.zh-CN.md` - 添加参数命名提示
  - `docs/integrations/COZE.md` / `COZE.zh-CN.md` - 添加 REST API 权限参数
  - `README.md` / `README.zh-CN.md` - 添加传输方式权限配置汇总表

## [2.9.0] - 2026

### 新增
- **按需增强工具** - 新增两个 MCP 工具，帮助 LLM 更好地理解数据内容
  - **`get_enum_values`** - 获取指定列的所有唯一值
    - 适用于枚举类型列、状态列等有限值集合
    - 支持 limit 参数控制返回数量
    - 返回值包含 `isComplete` 标识是否返回了全部值
  - **`get_sample_data`** - 获取表的示例数据
    - 自动数据脱敏，保护敏感信息（手机号、邮箱、身份证、银行卡等）
    - 支持按列名模式匹配和按值格式自动检测两种脱敏方式
    - 可通过 `masking` 参数控制是否启用脱敏
- **数据脱敏工具** - 新增 `DataMasker` 工具类（`src/utils/data-masking.ts`）
  - 支持 7 种脱敏类型：phone、email、idcard、bankcard、password、partial、full
  - 支持自定义脱敏规则
  - 自动检测敏感数据格式
- **REST API 端点** - 新增两个 HTTP API 端点
  - `GET /api/enum-values` - 获取枚举值
  - `GET /api/sample-data` - 获取示例数据

### 改进
- 新增 `EnumValuesResult` 和 `SampleDataResult` 类型定义
- 更新 API 参考文档（中英文），添加新端点说明
- 新增 20 个数据脱敏单元测试

## [2.8.0] - 2026

### 新增
- **Schema 核心增强** - 提升 LLM 对数据库结构的理解，提高 Text2SQL 准确性
  - **表注释支持** - Schema 信息现在包含表级别注释（`comment` 字段）
    - 支持的数据库：MySQL、PostgreSQL、Oracle、SQL Server、TiDB、达梦、KingbaseES、GaussDB、OceanBase、PolarDB、Vastbase、HighGo、GoldenDB、ClickHouse（14个）
    - 不支持：Redis、MongoDB（NoSQL）、SQLite（无原生表注释）
  - **隐式关系推断** - 基于列命名规则自动推断表间关系
    - 支持模式：`xxx_id` → `xxxs.id`、`xxxId` → `xxxs.id`（驼峰）、`xxx_code` → `xxxs.code`、`xxx_no` → `xxxs.xxx_no`
    - 推断规则：不覆盖显式外键、验证目标表存在、验证目标列存在
    - 置信度评分：0.7-0.95，LLM 可根据置信度判断关系可靠性
  - **关系类型细化** - 通过检查唯一约束区分 `one-to-one` 和 `many-to-one`
  - **关系来源标注** - `source` 字段区分 `foreign_key`（显式外键）和 `inferred`（推断关系）

### 改进
- 新增 `SchemaEnhancer` 工具类（`src/utils/schema-enhancer.ts`）
- 更新 `RelationshipInfo` 类型，添加 `source` 和 `confidence` 字段
- 更新 `TableInfo` 类型，添加 `comment` 字段
- 更新 14 个数据库适配器，添加表注释查询支持

## [2.7.0] - 2026

### 新增
- **外键关系支持** - Schema 信息现在包含外键和表关系数据，帮助 LLM 更好地理解数据库结构
  - `foreignKeys` - 表级别外键约束信息，包含约束名、列、引用表、引用列、ON DELETE/UPDATE 规则
  - `relationships` - 全局关系视图，展示所有表之间的关联关系
  - 支持的数据库：MySQL、PostgreSQL、Oracle、SQL Server、SQLite、达梦、KingbaseES、GaussDB、OceanBase、TiDB、PolarDB、Vastbase、HighGo、GoldenDB
  - NoSQL 数据库（Redis、MongoDB、ClickHouse）不支持传统外键，返回结果中不包含这些字段

### 改进
- 更新 API 参考文档（中英文），添加外键和关系字段的示例
- 更新数据库功能支持表，添加"外键关系"功能行

## [2.6.0] - 2026

### 新增
- **MCP SSE/Streamable HTTP 传输支持** - 在 HTTP 模式下新增 MCP 协议端点
  - `/sse` - SSE 传输端点（传统方式），支持通过 URL 参数配置数据库连接
  - `/sse/message` - SSE 消息接收端点
  - `/mcp` (POST) - Streamable HTTP 端点（MCP 2025 规范，推荐），支持通过请求头配置数据库连接
  - `/mcp` (GET) - Streamable HTTP 的 SSE 流端点
  - `/mcp` (DELETE) - 关闭会话端点
- Dify 等平台现在可以直接通过 MCP 协议连接，无需使用自定义 API 工具
- 灵活架构：2 种启动模式（stdio/http），4 种接入方式（MCP stdio、MCP SSE、MCP Streamable HTTP、REST API）
- **统一 API Key 认证** - MCP SSE/Streamable HTTP 端点现在也支持 API Key 认证，与 REST API 保持一致

### 改进
- 更新架构文档，清晰区分启动模式和接入方式
- 更新 Dify 集成指南，添加 MCP 协议集成方式（SSE 和 Streamable HTTP）
- 更新 API 参考文档，添加 MCP 协议端点说明

### 安全
- 所有 HTTP 端点（包括 MCP SSE/Streamable HTTP）现在统一使用 API Key 认证
- 如果未配置 `API_KEYS` 环境变量，则跳过认证（开发模式）

## [2.5.0] - 2026

### 新增
- Oracle 11g 及以前老版本支持（通过 Thick 模式）

## [2.3.8] - 2026

### 修复
- Oracle、达梦执行 SQL 去掉分号

## [2.3.7] - 2026

### 修复
- 达梦 get_schema 问题修复

## [2.3.6] - 2026

### 修复
- 达梦 get_schema 问题修复

## [2.3.5] - 2026

### 修复
- 达梦 get_schema 问题修复

## [2.3.4] - 2026

### 修复
- 达梦 get_schema 问题修复

## [2.3.3] - 2026

### 修复
- 达梦 get_schema 问题，达梦不使用批量查询优化功能

## [2.3.2] - 2026

### 修复
- 达梦 get_schema 返回 table 为空问题处理

## [2.3.1] - 2026

### 修复
- 达梦适配器修复列名规范化、空值检查、类型安全

## [2.3.0] - 2026

### 性能优化
- 为 Oracle、达梦增加批量查询优化功能

## [2.2.0] - 2026

### 性能优化
- 批量查询优化，大幅提升 Schema 获取性能
- 支持的数据库：MySQL、PostgreSQL、SQL Server、Oracle、达梦等 13 个适配器

### 性能提升
| 表数量 | 优化前 | 优化后 | 提升 |
|--------|--------|--------|------|
| 50 张表 | ~5 秒 | ~200 毫秒 | 25x |
| 100 张表 | ~10 秒 | ~300 毫秒 | 33x |
| 500 张表 | ~50 秒 | ~500 毫秒 | 100x |

## [2.1.0] - 2026

### 新增
- Schema 缓存机制
- 缓存 TTL 配置
- 强制刷新功能
- 缓存统计信息

## [2.0.0] - 2026

### 新增
- HTTP API 模式
- 双模式架构（MCP + HTTP）
- API Key 认证
- 速率限制
- CORS 配置
- Docker 部署支持
- Serverless 部署配置（阿里云、腾讯云、AWS、Vercel）
- PaaS 部署配置（Railway、Render、Fly.io）

### 文档
- HTTP API 参考文档
- 部署指南
- 集成指南（Coze、n8n、Dify）

## [1.0.0] - 2026

### 新增
- 支持 17 种数据库
  - MySQL、PostgreSQL、Redis、Oracle、SQL Server
  - MongoDB、SQLite、达梦、KingbaseES、GaussDB
  - OceanBase、TiDB、ClickHouse、PolarDB
  - Vastbase、HighGo、GoldenDB
- MCP 协议支持
- 只读安全模式
- Claude Desktop 集成

---

## 版本号说明

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)：

- **主版本号**：不兼容的 API 修改
- **次版本号**：向下兼容的功能性新增
- **修订号**：向下兼容的问题修正
