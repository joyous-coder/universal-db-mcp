# Universal DB MCP — P0/P1/P2 综合设计文档

**日期**: 2026-07-23
**作者**: brainstorming 会话
**状态**: 待用户审阅
**范围**: P0 (bug/安全) + P1 (性能/可维护性) + P2 部分 (3 执行入口 + batch + generate_sample_data)

---

## 1. 背景与目标

`universal-db-mcp` 是一个支持 17 种数据库的 MCP server,提供 stdio 和 HTTP 两种运行模式。本次设计涵盖三个阶段:

| 阶段 | 主题 | 主项数(含子项) |
|---|---|---|
| **P0** | Bug 与安全修复 | 6 项 |
| **P1** | 性能与可维护性 | 9 主项(P1-7/P1-8 各含 4 子项) |
| **P2** | 新功能 | 3 主项(其中 P2-1 涵盖三个执行入口的职责划分) |

**后续 spec**(本次不展开,留待 v2.x/v3.x):
- 运维可观测性(连接池指标、Prometheus)
- 查询体验(Explain Plan、查询历史、SQL Lint)
- 多库管理(同时连接多个数据库、连接模板)
- 数据治理剩余(Schema diff、备份导出、自定义脱敏规则)

**配套后续任务**:
- 基于本项目 + 现有 `db-connect` 工具编写 skill 文档

---

## 2. 非目标 (Non-goals)

- 不破坏现有 API 向后兼容(无破坏性变更)
- 不引入新的连接池抽象层(沿用驱动原生池)
- 不重写 `DatabaseService` 或 `ConnectionManager` 核心结构
- 不发明新的权限配置机制(沿用 `permissions` 数组)
- 不发明新的配置文件(沿用 `.mcp.json` env 注入)

---

## 3. P0: Bug 与安全修复

### P0-1: SQLite 适配器 SQL 注入风险

**问题**: `src/adapters/sqlite.ts` 在多处将动态标识符直接拼入 SQL:
- `PRAGMA table_info(${tableName})` (line 185)
- `PRAGMA index_list(${tableName})` (line 210)
- `PRAGMA index_info(${idx.name})` (line 227)
- `PRAGMA foreign_key_list(${tableName})` (line 243)
- `SELECT COUNT(*) FROM ${tableName}` (line 287)

LLM 传入恶意表名(虽不太可能但理论存在)可执行任意 SQL。

**修复**:
1. 新增 `src/utils/identifier-validator.ts`,导出 `validateIdentifier(name: string, allowSchema: boolean = false)`,严格白名单校验(正则 `^[A-Za-z_][A-Za-z0-9_]*$`,可选 `schema.table` 格式)
2. SQLite 适配器所有动态标识符入口调用 `validateIdentifier`
3. `database-service.ts::getTableInfo`、`buildSampleDataQuery`、`buildEnumValuesQuery` 等同样调用

**测试**: `tests/unit/identifier-validator.test.ts`
- 合法标识符通过
- 包含特殊字符(`;`, `--`, 空格)拒绝
- schema.table 格式解析正确
- 空字符串、过长字符串拒绝

---

### P0-2: HTTP 模式默认无鉴权

**问题**: `src/http/middleware/auth.ts:33` 当未配置 `API_KEYS` 时直接放行所有请求。`.env.example` 默认空,生产环境容易忘记配置。

**修复**:
- HTTP 模式启动时,`apiKeys.length === 0` **直接拒绝启动**(throw error)
- 提供逃生通道:环境变量 `ALLOW_INSECURE_NO_AUTH=true` 显式允许(打印强警告)
- MCP stdio 模式不受影响

**测试**:
- 启动验证:无 API_KEYS 时启动失败并给出明确错误
- 启动验证:有 ALLOW_INSECURE_NO_AUTH=true 时启动成功但日志警告
- 运行时:有 API_KEYS 时正常鉴权

---

### P0-3: `mcp-server.ts::disconnect_database` 顺序缺陷

**问题**: `src/mcp/mcp-server.ts:253-262` 旧连接断开失败会导致状态不一致(`this.adapter` 仍指向旧对象)。

**修复**: 用 `try/catch` 包裹 `disconnect()` 调用,记录失败原因但继续往下走,旧对象无论如何都置空。

**测试**:
- 模拟 disconnect 抛错,验证 this.adapter 仍被清空
- 模拟 disconnect 正常完成,验证流程不变

---

### P0-4: `withRetry` 重试风暴防护

**问题**: 各适配器的 `withRetry` 仅简单重试一次,死连接 + 慢查询场景下多个并发查询都触发重试,加剧雪崩。

**修复**:
1. 抽象到 `src/utils/retry.ts`,导出 `withRetry(fn, { retries, baseDelayMs })`
2. 指数退避:`delay = baseDelayMs * 2^attempt`
3. 重试前检查连接池状态(尽力而为,某些驱动不支持)
4. 默认参数 `retries: 1, baseDelayMs: 50`

**测试**: `tests/unit/retry.test.ts`
- 正常情况:1 次调用
- 1 次失败后成功:2 次调用
- 连续失败:达到重试上限后抛错
- 指数退避时序验证

---

### P0-5: `execute_query` PL/SQL 与多语句支持

**问题**: 各适配器走参数化路径,无法处理 `BEGIN...END` 块、存储过程、多语句脚本。

**修复**:

1. **新增 `script` 权限类型**(`src/types/adapter.ts`):
   ```typescript
   export type PermissionType = 'read' | 'insert' | 'update' | 'delete' | 'ddl' | 'script' | 'batch';
   ```
   - `script` 不在 `full` preset 里(双重 opt-in,显式声明才启用)
   - 通过现有 `--permissions` flag / `DB_PERMISSIONS` env / MCP `permissions` 参数启用

2. **新增 `execute_script` 工具**(`src/mcp/mcp-server.ts`):
   - 仅当 `permissions.includes('script')` 时注册
   - 输入: `query: string, useTransaction?: boolean, maxStatements?: number`
   - 工具描述明确"需要 script 权限"

3. **新增 `executeScript` 方法**(`src/core/database-service.ts` + 各适配器):
   - **统一策略**: 客户端解析 + 顺序执行(更安全,不依赖驱动多语句模式)
     - 用 `sql-parser.ts` 把脚本切成单语句序列
     - `useTransaction: true` 时:BEGIN → 逐条 executeQuery → COMMIT/ROLLBACK
     - `useTransaction: false` 时:逐条 executeQuery(每条自动提交)
   - **不使用** `multipleStatements: true`(单条查询池保持 `false` 以防 SQL 注入)
   - **Oracle/DM 可选优化**: 若脚本全是简单 INSERT/UPDATE/DELETE,可调用 `connection.executeMany()` 走原生 batch(待性能测试后决定是否启用)
   - 统一抽象基类 `BaseAdapter.executeScript()` 提供默认事务串行实现,各驱动按需 override

4. **`execute_query` 自动降级**(`src/core/database-service.ts`):
   - 检测 `BEGIN|DECLARE|CALL|^\s*\(|^\s*\/\*` 等块语法关键字
   - 有权限时静默升级到 `executeScript`
   - 无权限时报错并提示如何启用

5. **`src/utils/sql-detector.ts`**: 导出 `isScriptLike(query: string): boolean`

6. **SQL 解析器**(`src/utils/sql-parser.ts`): 导出 `splitStatements(script: string, dialect: DbType): string[]`,处理:
   - BEGIN...END 块内的分号
   - 字符串字面量内的分号
   - 注释(-- /* */)
   - MySQL DELIMITER 指令

7. **运行时安全检查**:
   - 语句数 ≤ `maxStatements`(默认 1000)
   - 黑名单正则(DROP DATABASE / DROP SCHEMA / SHUTDOWN / 无 WHERE 的 TRUNCATE)
   - 仅允许 INSERT/UPDATE/DELETE/REPLACE/DDL 等白名单语句类型(由 `validateQuery` 校验)

**测试**:
- `tests/unit/sql-detector.test.ts` - 检测逻辑
- `tests/unit/sql-parser.test.ts` - 解析逻辑
- `tests/unit/script-permission.test.ts` - 权限门控
- `tests/integration/mcp-mode.test.ts` - 端到端执行 PL/SQL 块

---

### P0-6: 文件路径白名单机制

**问题**: 准备新增的 `execute_sql_file` 工具(见 P2-1)需要读取磁盘文件,直接接受任意路径是严重安全风险。

**修复**:

1. **新增配置**(沿用 `DB_*` env 命名风格):
   - 环境变量: `DB_ALLOWED_FILE_PATHS=<dir1>,<dir2>` (逗号分隔)
   - CLI 参数: `--allow-sql-file-path <dir>` (可重复)
   - **不在 `.mcp.json` 之外的配置文件**(保持简洁)
   - 通过 `.mcp.json` 的 `env` 块注入最自然

2. **路径解析与校验**(`src/utils/path-guard.ts`):
   ```typescript
   export function resolveAndValidatePath(
     inputPath: string,
     allowedDirs: string[],
     cwd: string
   ): string {
     // 1. 相对路径 → 相对 cwd 解析
     // 2. 绝对路径 → 直接使用
     // 3. realpathSync 解析 .. 和 symlink
     // 4. 校验规范化后路径是否在任一允许目录下
     // 5. 不在 → 抛 403 错误
   }
   ```

3. **HTTP 模式**: 服务端从环境变量读全局白名单,无配置时 `execute_sql_file` 端点直接 404

**测试**:
- 合法路径通过
- 路径遍历(`../secret`)拒绝
- 软链接指向外部拒绝
- 绝对路径在白名单内通过,白名单外拒绝
- 相对路径相对 cwd 解析

---

## 4. P1: 性能与可维护性

### P1-1: SQLite Schema 获取 N+1 查询

**问题**: `src/adapters/sqlite.ts:144-159` 对每张表调用 `getTableInfo`,每张表 5+ 次 PRAGMA + 1 次 COUNT(*)。N 张表 = N×6 次往返。

**修复**:
1. 改用 `sqlite_master` 一次性查所有表/视图
2. SQLite 3.37+ 使用 `PRAGMA table_list`(如果可用)
3. 批量元数据查询,通过 `WHERE name IN (...)` 减少 PRAGMA 调用次数
4. 缓存查询结果(同一 schema 内)

**测试**:
- 100 张表的数据库,从 N×6 次降到 ~5 次查询
- 返回的 schema 信息保持一致

---

### P1-2: `isWriteOperation` 正则预编译

**问题**: `src/utils/safety.ts:55` 每次调用 `startsWithKeyword` 都 `new RegExp(...)` 重新编译。

**修复**:
- 模块级预编译常量 `KEYWORD_REGEX_MAP`
- 所有 OPERATION_KEYWORDS 对应正则一次编译

**测试**:
- 性能基准:1000 次调用 < 5ms
- 行为不变(回归测试)

---

### P1-3: Schema 缓存粒度细化

**问题**: `src/core/database-service.ts:60` 整个 schema 一个缓存条目,任何表结构变化需等 TTL(默认 5 分钟)或手动 `clear_cache`。

**修复**:
- 默认 TTL 缩短至 1 分钟(从 5 分钟)
- 新增 `setCacheTtl(ms: number)` 运行时配置
- 留口子(不实现)给 P2 加按表失效

**测试**:
- TTL 缩短后行为正确
- 运行时修改 TTL 生效

---

### P1-4: `getEnumValues` 大表取样优化

**问题**: `SELECT DISTINCT column FROM table` 对百万行表极慢。

**修复**: 大表(超过 50000 行)启用随机抽样:
```sql
SELECT DISTINCT column FROM (
  SELECT column FROM table WHERE column IS NOT NULL 
  ORDER BY RANDOM() LIMIT 10000
) ORDER BY column LIMIT 51
```

**测试**:
- 大表场景下返回时间 < 200ms
- 结果包含代表性枚举值(覆盖率 > 80%)

---

### P1-5: 统一的执行超时控制

**范围**: 覆盖 `execute_query` / `execute_script` / `execute_sql_file` 三种路径

**修复**:
- 在 `DatabaseService` 层用 `Promise.race` + `setTimeout` 实现
- 默认 30 秒,可配置(`DB_QUERY_TIMEOUT_MS`)
- 超时后强制中断(`connection.destroy()` 尽力而为)
- HTTP 模式返回 504 Gateway Timeout

**测试**:
- 慢查询被超时打断
- 超时后连接仍可复用
- HTTP 模式正确返回 504

---

### P1-6: 统一的慢查询日志

**范围**: 覆盖三种执行路径

**修复**:
- 在 `DatabaseService.executeQuery/Script/Batch/File` 中,执行时间 > 阈值(默认 5 秒)输出 WARN 日志
- 可配置(`DB_SLOW_QUERY_THRESHOLD_MS`)
- 不引入第三方日志库,console.error 即可
- HTTP 模式可选写 `.slow-query.log` 文件

**测试**:
- 慢查询日志输出正确
- 阈值可配置

---

### P1-7: `execute_script` 专项优化

- **P1-7a 语句解析缓存**: 相同脚本短时间内重复执行时缓存解析结果
- **P1-7b 智能 BEGIN...END 分隔**: `sql-parser.ts` 处理嵌套块、字符串字面量、注释
- **P1-7c 双重超时**: 整体超时(默认 5 分钟) + 单语句超时(默认 30 秒)
- **P1-7d 解析错误位置提示**: 解析失败时指出第 N 条语句

**测试**:
- 嵌套 BEGIN...END 块正确分割
- 字符串内分号不被切分
- 解析错误位置提示准确

---

### P1-8: `execute_sql_file` 专项优化

- **P1-8a 流式读取**: `createReadStream` 按行流式,避免 100MB 文件撑爆内存
- **P1-8b 文件大小上限**: 默认 50MB,超过直接拒绝
- **P1-8c 编码自动检测**: BOM 检测 + UTF-8/GBK fallback
- **P1-8d mtime 缓存**: 相同 path + 相同 mtime 跳过重复解析

**测试**:
- 100MB 文件不撑爆内存
- 大于 50MB 文件拒绝
- UTF-8 BOM / GBK 编码正确识别
- mtime 缓存生效

---

### P1-9: 连接池按模式自适应

**问题**: `mysql.ts:78` 等硬编码 `connectionLimit: 3, maxIdle: 1`,MCP 单用户浪费,HTTP 多用户严重不足。

**修复**:
- 新增配置: `DB_POOL_SIZE`, `DB_POOL_MIN`, `DB_POOL_MAX_IDLE`, `DB_POOL_IDLE_TIMEOUT_MS`
- 模式感知默认值: `getDefaultPoolSize('mcp')` 返回 2,`getDefaultPoolSize('http')` 返回 10
- 各适配器读取这些值(MCP stdio / HTTP 两种入口分别传入)
- 池监控指标收集(`active`, `idle`, `waiting`)留待 P2

**测试**:
- MCP 模式默认池大小为 2
- HTTP 模式默认池大小为 10
- 环境变量覆盖生效

---

## 5. P2: 新功能

### P2-1: 三个执行入口(execute_query / execute_script / execute_sql_file)

**设计要点**(详见 P0-5、P0-6):
- **execute_query**: 单条参数化 SQL,默认工具
- **execute_script**: 多语句/PL 块,需要 `script` 权限
- **execute_sql_file**: 从文件读 SQL,需要文件白名单

工具间的分工和自动降级行为在 P0-5 中定义。

---

### P2-2: `execute_batch` 工具

**目的**: 类似 Java `JdbcTemplate.batchUpdate()` 的批量 DML,60-100x 性能提升。

**修复**:
1. **新增 `batch` 权限类型**(`src/types/adapter.ts`,与 `script` 平级)
2. **新增 `execute_batch` 工具**(`src/mcp/mcp-server.ts`):
   - 仅当 `permissions.includes('batch')` 时注册
   - 输入: `sql: string, paramsList: unknown[][], useTransaction?: boolean, maxBatchSize?: number`
3. **`BaseAdapter.executeBatch()` 抽象**(`src/adapters/base.ts`):
   - 默认实现:事务内串行(所有驱动 work,但非最优)
4. **各驱动 override**:
   - MySQL: `pool.query(sql, [paramsList])` 原生 batch
   - Oracle/DM: `connection.executeMany(sql, binds)` 原生 batch
   - SQLite: `db.transaction(() => {...})` 原生事务
   - PostgreSQL/SQL Server: 默认事务串行
5. **防御性约束**:
   - 行数上限(默认 1000)
   - 单参数集大小检查
   - 仅允许 INSERT/UPDATE/DELETE/REPLACE
   - 沿用现有权限检查(validateQuery)

**测试**:
- 1000 行 INSERT,事务模式全部回滚
- 单条失败时返回 failedAtIndex
- 非事务模式部分成功部分失败
- 行数超 maxBatchSize 拒绝
- SELECT 语句拒绝
- 无 batch 权限时工具不注册
- MySQL 原生 batch 性能基准

---

### P2-3: `generate_sample_data` 工具

**目的**: 根据表结构自动生成并插入样例数据。LLM 根据用户自然语言描述生成 inline rules。

**修复**:

1. **新增依赖**: `@faker-js/faker` (~5MB),`pinyin` (~50KB)

2. **新增 `generate_sample_data` 工具**(`src/mcp/mcp-server.ts`):
   - 需要 `insert` + `batch` 权限
   - 输入: `tableName`, `rowCount`, `options` 含 `rules`, `columnOverrides`, `seed`, `columns`, `overwrite`, `respectForeignKeys`

3. **工具 description 内嵌**完整 schema + 中文支持说明 + 跨列引用规则 + 领域知识引导(~2000 字符)

4. **`src/utils/sample-data-generator.ts`**:
   - 基于 `@faker-js/faker` zh_CN locale
   - 列名启发式规则(姓名/邮箱/手机号/地址等)
   - 类型 fallback
   - 支持 10 种 generate 类型: `fixed`, `range`, `pattern`, `faker`, `enum`, `choice`, `sequence`, `regex`, `null`, `skip`
   - 模板占位符: 内置 + 跨列引用 + 修饰符(.lower, .upper, .pinyin, .pinyin.first, .first, .last, .N)
   - 行内顺序生成,维护 rowContext 支持跨列引用

5. **`DatabaseService.generateAndInsertSampleData()`**:
   - 整合 get_table_info / get_enum_values / execute_batch
   - 优先级: `columnOverrides` > `rules` > 内置预设 > 类型 fallback
   - 行数上限 10000
   - 安全敏感表警告(非强制禁止)
   - overwrite=true 时 TRUNCATE

6. **`src/utils/template-resolver.ts`**:
   - 解析模板占位符
   - 应用修饰符链
   - 引用未生成列时报错并提示

**测试**:
- `tests/unit/sample-data-generator.test.ts` - 生成器逻辑
- `tests/unit/template-resolver.test.ts` - 模板解析
- `tests/unit/chinese-data.test.ts` - 中文支持
- `tests/unit/cross-column-reference.test.ts` - 跨列引用
- 端到端: 100 行 users 表,所有列生成合理值

---

## 6. 测试策略

### 单元测试
每个新增模块配套单元测试:
- `tests/unit/identifier-validator.test.ts`
- `tests/unit/retry.test.ts`
- `tests/unit/sql-detector.test.ts`
- `tests/unit/sql-parser.test.ts`
- `tests/unit/script-permission.test.ts`
- `tests/unit/path-guard.test.ts`
- `tests/unit/sample-data-generator.test.ts`
- `tests/unit/template-resolver.test.ts`
- `tests/unit/chinese-data.test.ts`
- `tests/unit/cross-column-reference.test.ts`

### 集成测试
- `tests/integration/mcp-mode.test.ts` - 端到端测试三个执行入口
- `tests/integration/http-api.test.ts` - HTTP 鉴权、超时、文件路径校验

### 回归测试
现有 4 个测试文件不能 fail:
- `tests/unit/adapter-factory.test.ts`
- `tests/unit/config-loader.test.ts`
- `tests/unit/connection-stability.test.ts`
- `tests/unit/data-masking.test.ts`

### 手动验证清单
- HTTP 启动无 API key 时拒绝启动
- HTTP 启动有 ALLOW_INSECURE_NO_AUTH 时警告启动
- MCP disconnect 在旧连接出错时仍能切换
- `execute_script` 无 script 权限时拒绝注册
- `execute_batch` 在 MySQL/PG/DM 上性能对比
- `generate_sample_data` 真实 dm 数据库生成测试数据
- 文件路径遍历攻击被拒绝

---

## 7. 风险与权衡

| 风险 | 缓解措施 |
|---|---|
| `execute_script` 增加误删库风险 | 强制显式 `script` 权限;黑名单正则;内容审计 |
| `generate_sample_data` 大量写入影响生产 | 默认 10000 行上限;`overwrite` 需显式开启;敏感表警告 |
| `DB_ALLOWED_FILE_PATHS` 配置错误导致功能失效 | 启动时校验路径存在性;加载失败报警告不报错 |
| 连接池自适应可能不够精确 | 留口子让用户通过 env 覆盖;提供监控指标 |
| 工具 description 过长消耗 token | 先保持现状,实测再优化 |
| faker 依赖增加包大小 ~5MB | faker 是主流库,~5MB 可接受 |

---

## 8. 后续任务(不在本 spec)

- **db-connect + universal-db-mcp skill 文档**: 整合现有 `db-connect` 工具和本项目,产出 skill 文档,引用本 spec 的配置项(`DB_ALLOWED_FILE_PATHS` 等)

- **v2.x spec**: 运维可观测性(连接池指标、Prometheus、健康检查)+ 查询体验(Explain Plan、查询历史、SQL Lint)

- **v3.x spec**: 多库管理 + 数据治理剩余(Schema diff、备份导出、自定义脱敏规则)

---

## 9. 验收标准

本 spec 完成时:
- 所有 P0 bug 已修复(测试覆盖)
- 所有 P1 性能优化已实施(基准对比可量化)
- P2 三个新工具(`execute_script` / `execute_batch` / `generate_sample_data`)已实现并通过测试
- 现有测试不回归
- 文档已更新(README、CHANGELOG)
- MCP 工具描述清晰,LLM 能基于描述正确使用
