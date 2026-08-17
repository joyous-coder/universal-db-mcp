# Universal DB MCP — v4.0 移除 Tool 懒加载 & infoLazy 设计文档

**日期**: 2026-08-17
**作者**: brainstorming 会话
**状态**: 🚧 待用户最终 review
**目标版本**: v4.0.0(major bump;从 v3.3.x 升)
**范围**: 移除 v3.2 per-DB-type tool 懒加载、infoLazy 模式、Claude Code workaround、group 概念;新增 `server.instructions` 字段

---

## 1. 背景与目标 (Background & Goals)

### 1.1 现状(v3.3.x)

v3.x 系列(v3.2 → v3.3.x)在三个层面构建了"延迟暴露 / 按需激活"的机制,目的是压低 tool schema 的 token 占用:

1. **v3.2 lazy load**(per-DB-type tool 注册)— `toolRegistry.listActiveTools()` 按当前连接返回 subset
2. **v3.2 group 激活** — `use_tool_group` 工具运行时激活组
3. **v3.2 infoLazy 模式** — `generate_sample_data` 用 stub schema,full schema 通过 `use_tool_schema` 加载
4. **v3.3.2 Claude Code workaround** — 检测客户端名,自动禁用 lazy load(因为 Claude Code 不响应 `listChanged` 通知)

### 1.2 触发变更的外部事实

Anthropic 官方文档(`https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search`)确认:

- **Tool search 默认开启**(v2.1.221+,Claude Code 2.1.227+)
- **deferred 模式**:session 启动只加载 tool name + server instructions;完整 schema 在 Claude 调用 `ToolSearch` 时按需加载
- `alwaysLoad: true` 可让关键 tool 跳过 search,直接常驻上下文
- `ENABLE_TOOL_SEARCH=false` 可关闭 deferred(对 Bedrock / Foundry / 旧代理等不支持 tool search 的环境)

### 1.3 deferred 模式与现有 lazy-load 机制的关系分析

| 维度 | Tool search 解决? | 现有 lazy-load 解决? | v4.0 后处理 |
|------|:---:|:---:|:---:|
| Tool schema 占多少 tokens | ✅(延后加载) | ❌ | 保留 deferred |
| Tool name 出现在 `tools/list` 的数量 | ❌(name 仍立即加载) | ✅(per-DB 过滤) | **删除** lazy load(因 deferred 让 name token 成本可控) |
| 切换 DB 后工具集变化 | ❌ | ✅(v3.2) | **删除**(改为全量常驻) |
| `listChanged` 通知触发客户端重拉 | ✅ 不需要(deferred 按需) | ❌ Claude Code 不响应 → 加 workaround | **删除** 整个机制 |
| 非 Claude Code 客户端(Bedrock / Foundry / Dify / Cline 等) | ❌ 多数不支持 tool search | ✅ 兜底 | **删除**(这些客户端的能力由 deferred 兜底) |
| 17 DB × 多 tool 的 LLM 选错率 | 部分(还是 ~43 name) | ✅(只暴露当前 DB) | **删除**(全量 tool + `instructions` 引导) |

**结论**:deferred 模式与 lazy-load 是**互补到替代**的关系 — lazy-load 解决的核心问题(deferred name token + 选错率)被 deferred 自身 + `server.instructions` 替代。

### 1.4 目标(Goals G1–G8)

| # | 目标 | 验证 |
|---|------|------|
| **G1** | 移除 v3.2 per-DB-type tool 懒加载过滤;`tools/list` 返回**全量 tool**(非 group 类) | grep `lazyLoad\|toolRegistry` 0 命中;非 group tool count 不变 |
| **G2** | 移除 infoLazy 模式:`generate_sample_data` 直接放完整 inputSchema;**删除** `use_tool_schema` tool | grep `use_tool_schema\|infoLazy\|getFullSchema` 0 命中 |
| **G3** | 移除 Claude Code workaround | grep 0 命中 |
| **G4** | **删除** `use_tool_group` tool + 移除 `listChanged: true` capability | grep 0 命中 |
| **G5** | 移除 `DB_LAZY_LOAD_ENABLED` / `DB_LAZY_DEFAULT_GROUP` env 解析;无效 env 静默忽略 | grep 0 命中 |
| **G6** | 所有 client 一视同仁,`tools/list` 返回完整 tool 集合,无 client-conditional 分支 | 单元测试覆盖所有 client |
| **G7** | **删除 group 概念**(`ToolGroup` / `GroupName` 类型 + 每个 tool 定义里的 `group` 字段)+ 删除 `DB_VISIBLE_GROUPS` / `DB_VISIBLE_TOOLS` env(为 v3.x 设计,本次不再实施) | grep `ToolGroup\|GroupName\|DB_VISIBLE_GROUPS\|DB_VISIBLE_TOOLS` 0 命中 |
| **G8** | **新增 `server.instructions` 字段** 到 InitializeResult,Markdown 格式,~500-1500 tokens,覆盖 server 定位 / 17 DB 分类 / 常用工作流 / tool 选择决策树 / 安全提示 | `initialize` 响应含非空 `instructions`;lint 校验 < 2000 chars |

### 1.5 改动后 tool 清单(对比 v3.3.x)

| Tool | v3.3.x | v4.0 |
|------|--------|------|
| `use_tool_group` | 存在,激活组 | **删除** |
| `use_tool_schema` | 存在,加载懒 schema | **删除** |
| `clear_cache` | 清 DB schema 缓存 | **保留,行为不变** |
| `generate_sample_data` | INFO-LAZY,full schema 需 lazy 加载 | 保留,**完整 schema 直接放** |
| 其他 ~40 个 tool | 正常 | 正常;**无 `group` 字段**;按 CORE + 非 CORE 扁平分类 |

**净变化**:`tools/list` count 减 2(v3.3.x 的 43 → v4.0 的 41)。

### 1.6 不动(明确保留)

- ✅ **`src/core/database-service.ts` 的 DB schema 缓存**(`schemaCache` / `schemaCacheTime` / TTL / `clearCache()`)— 真实有效的加速层,与 G1–G7 无关
- ✅ **`clear_cache` tool 实际功能** — 继续清 DB schema 缓存
- ✅ **DB schema 相关 tool**:`get_schema` / `get_table_info` / `get_enum_values` / `get_sample_data` 走原缓存路径
- ✅ 所有其他 40 个 tool 的 inputSchema 与行为
- ✅ HTTP / stdio / SSE 传输层
- ✅ MCP 协议层语义
- ✅ v3.x pruning 设计文档(`2026-07-27-mcp-tool-pruning-v3-x-design.md`)— 后续单独 brainstorm,本次不重写

### 1.7 非目标(Non-goals)

- ❌ **不**重写 tool 列表精简(等 v3.x pruning 设计后续单独处理)
- ❌ **不**改 `generate_sample_data` 的功能(只是 inputSchema 不再 split)
- ❌ **不**改 HTTP REST API / 传输层
- ❌ **不**改 MCP 协议层
- ❌ **不**改 `server.instructions` 的具体文本(本次只搭框架 + 初版文本;后续根据 Claude 召回实测迭代)
- ❌ **不**重写 v3.x pruning 设计(本次仅在其顶部加 superseded 横幅)

---

## 2. 文件清单与改动位置

### 2.1 完全删除的文件(10 个)

| 文件 | 估计 LOC | 原因 |
|------|---------|------|
| `src/mcp/tool-registry.ts` | 157 | 整个 v3.2 注册中心,被 G1+G2+G4+G7 取代 |
| `tests/unit/tool-registry.test.ts` | ~200 | 测已删除的 registry |
| `tests/integration/lazy-load-e2e.test.ts` | ~300 | 测已删除的 per-session lazy load 行为 |
| `tests/integration/info-lazy-e2e.test.ts` | ~150 | 测已删除的 infoLazy 模式 |
| `tests/integration/session-isolation-e2e.test.ts` | ~150 | 测已删除的 per-session group 隔离 |
| `tests/unit/lazy-loading-notification.test.ts` | ~150 | 测已删除的 `listChanged` 通知 |
| `tests/unit/client-detection.test.ts` | ~200 | 测已删除的 Claude Code workaround |
| `tests/unit/mcp-meta-tools.test.ts` | ~250 | 测已删除的 `use_tool_group` / `use_tool_schema` |
| `tests/unit/tool-definitions.test.ts` | ~200 | 测已删除的 group 分类 + infoLazy |
| `docs/03-features/lazy-loading.md` | 估算 | 旧设计文档 |

### 2.2 主要修改文件

#### A. `src/mcp/mcp-server.ts`(1565 LOC,改 350+)

| 行号 | 改动 | 对应 Goal |
|------|------|----------|
| L64 | ❌ `private toolRegistry: ToolRegistry \| null = null;` 删 | G1 |
| L67-68 | ❌ `lazyLoadEnabled` 字段 + 注释 删 | G1, G5 |
| L73 | ❌ `sessionClientInfo` Map 删 | G3 |
| L86-89 | `listChanged: true` → 删(默认 false) | G4 |
| L140-142 | ❌ `if (appConfig.lazyLoad?.enabled)` 整段删 | G5 |
| L203-206 | ❌ `setLazyLoadEnabled()` 方法删 | G5 |
| L216-241 | ❌ `isClaudeCodeClientName()` + `shouldSkipLazyLoading()` 删 | G3 |
| L246-261 | ❌ `rebuildToolRegistry()` 删 | G1 |
| L264-321 | ❌ `handleUseToolGroup()` 删 | G4 |
| L323-374 | ❌ `handleUseToolSchema()` 删 | G2 |
| L377-394 | ❌ `lazyToolErrorResponse()` 删 | G1, G4 |
| L413-444 | `getStatefulToolsForList()` 简化:删 `use_tool_group` / `use_tool_schema` | G4 |
| L456-477 | `InitializeRequest` handler 简化:删 Claude Code 检测;新增 `instructions` 注入 | G3, G8 |
| L480-495 | `ListToolsRequest` 简化:删 `treatAsLazyDisabled` 分支;直接调 `buildToolDefinitions()` 合并 stateful | G1, G6 |
| L919-921 | 删 meta-tool pre-check 注释 + 逻辑 | G2, G4 |
| L929-944 | 删 lazy dispatch 分支,合并到主 switch | G1, G6 |
| L1390 | 简化 fallback 路径 | G1 |

#### B. `src/mcp/tool-definitions.ts`(275 LOC,改 ~120)

| 行号 | 改动 | 对应 Goal |
|------|------|----------|
| L77 | ❌ `export type GroupName = ...` 删 | G7 |
| L79-83 | `ToolDefinitions` 接口简化:`groups` / `meta` / `infoLazy` → 单个 `tools: ToolDefinition[]` | G1, G7 |
| L85-87 | `tool()` 工厂函数去掉 `group` 参数 | G7 |
| L90-104 | `queryExperience` 数组 → 直接 push 进 `tools`,去掉 group 字段 | G1, G7 |
| L106-124 | `profiles` 同上 | G1, G7 |
| L126-145 | `dataGovernance` 同上 | G1, G7 |
| L147-157 | `indexAdvisor` 同上 | G1, G7 |
| L159-163 | ❌ `meta` 数组(整个)删 | G4 |
| L165-227 | ❌ `infoLazyFullSchemas` 删 | G2 |
| L229-248 | ❌ `infoLazy` 数组删;`generate_sample_data` 改用完整 schema | G2 |
| L249+ | `generate_sample_data` 直接用 `infoLazyFullSchemas.generate_sample_data` 的完整 schema 作为 `inputSchema` | G2 |
| L264-276 | `buildToolRegistry()` → 改名 `buildToolDefinitions()`,返回 `ToolDefinition[]` | G1, G7 |

#### C. `src/types/http.ts`

| 行号 | 改动 | 对应 Goal |
|------|------|----------|
| L71 | ❌ `lazyLoad?: LazyLoadConfig` 字段删 | G5 |
| L78-82 | ❌ `LazyLoadConfig` interface 删 | G5 |

#### D. `src/utils/config-loader.ts`

| 行号 | 改动 | 对应 Goal |
|------|------|----------|
| L219-220 | ❌ `DB_LAZY_LOAD_ENABLED` / `DB_LAZY_DEFAULT_GROUP` env 解析删 | G5 |
| L225-235 | ❌ lazyLoad config 块删 | G5 |
| L255 | ❌ lazyLoad 默认值删 | G5 |
| L277-279 | ❌ lazyLoad merge 删 | G5 |

#### E. 入口 + 传输层

| 文件 | 行号 | 改动 |
|------|------|------|
| `src/mcp/mcp-index.ts` | L133 | 注释提到 "lazyLoad",删 |
| `src/http/routes/mcp-sse.ts` | L74 | 同上,删 |

#### F. 测试保留 + 更新

| 文件 | 改动 |
|------|------|
| `tests/unit/config-loader.test.ts` | 删 lazyLoad 相关 test case |
| `tests/unit/audit-docs.test.ts` | 删 "lazy load" 引用相关 assertion |
| `tests/integration/*.test.ts`(其他非删文件) | 检查是否有依赖 `tools/list` 中已删除 tool 的 case,改写 |

### 2.3 新增内容(G8 `server.instructions`)

#### A. 新增文件:`src/mcp/instructions.ts`

```typescript
/**
 * v4.0: 构建 server.instructions 字段内容。
 *
 * 该字段在 InitializeResult 中返回,作为 deferred tool search 模式下 Claude
 * 决定"该不该 search 这个 server"以及"search 时用什么关键词"的核心线索。
 * Markdown 格式,长度硬上限 2000 chars(由 buildInstructions() 内 assert + CI lint 保证)。
 */

export function buildInstructions(): string {
  const text = `# universal-db-mcp — Database access for 17 DB types

Use me whenever the user needs to query, inspect, or modify data in MySQL,
PostgreSQL, Oracle, SQL Server, DM (达梦), Kingbase, GaussDB, MongoDB, Redis,
SQLite, ClickHouse, TiDB, OceanBase, PolarDB, Vastbase, Highgo, or GoldenDB.

## Workflow

1. **Connect first** — call \`connect_database\` with the DB type and credentials,
   or \`use_profile\` if a saved profile exists.
2. **Explore schema** — \`get_schema\` for overview, \`get_table_info\` for columns,
   \`get_sample_data\` for rows, \`get_enum_values\` for enum-like columns.
3. **Query** — \`execute_query\` for one-off SQL (always pass \`params\` to prevent
   injection). \`explain_query\` returns the plan.
4. **Write in bulk** — \`execute_batch\` (single SQL, multiple param sets) or
   \`execute_script\` (multi-statement, requires script permission).
5. **Profile-based setups** — \`list_profiles\` / \`save_profile\` / \`use_profile\`.
6. **Tune** — \`explain_query_with_advice\` returns index hints. \`lint_sql\` for
   static analysis.

## Permission modes

- **safe** (default): read-only. All write tools blocked.
- **readwrite**: INSERT/UPDATE/DELETE allowed, DDL blocked.
- **full**: DDL + destructive ops allowed.

## Safety

- Always pass \`params\`, never string-concatenate user input.
- Prefer \`lint_sql\` before \`execute_script\`.
- \`audit_log\` retrieves all recorded queries.
- PII columns are masked by default; \`get_pii_config\` shows current rules.`;

  // 长度硬上限:超过 2000 chars 直接抛错,防止后续 PR 偷偷往里加内容
  if (text.length > 2000) {
    throw new Error(`buildInstructions() exceeded 2000 chars: ${text.length}`);
  }
  return text;
}
```

#### B. `src/mcp/mcp-server.ts` 的 `InitializeRequest` handler 改为:

```typescript
this.server.setRequestHandler(InitializeRequestSchema, async (request) => {
  // 委托 SDK 默认 oninitialize(返回 protocolVersion/capabilities/serverInfo)
  const result = await (this.server as any)._oninitialize(request);
  // v4.0 G8: 注入 instructions
  return { ...result, instructions: buildInstructions() };
});
```

(同时移除 Claude Code 检测分支 G3)

#### C. 新增 lint 脚本:`scripts/lint-instructions.ts`

```typescript
/**
 * CI lint: 确保 buildInstructions() 输出 < 2000 chars 且非空。
 * 挂到 npm run lint。
 */
import { buildInstructions } from '../src/mcp/instructions.js';

const text = buildInstructions();
if (text.length === 0) throw new Error('instructions is empty');
if (text.length > 2000) throw new Error(`instructions too long: ${text.length} chars (max 2000)`);
console.log(`✓ instructions OK (${text.length} chars)`);
```

### 2.4 包元数据

| 文件 | 改动 |
|------|------|
| `package.json` | `version: "3.x.x"` → `"4.0.0"`(读实际值) |
| `package.json` | 新增 `scripts.lint:instructions: "tsx scripts/lint-instructions.ts"` |
| `package.json` | `scripts.lint` 链入 `lint:instructions` |
| `CHANGELOG.md` | 新增 `## [4.0.0] - 2026-08-17` 段,标 **BREAKING** |
| `README.md` | 加 "Breaking changes in v4" 段 + 移除所有 "lazy load" 描述 |
| `README.zh-CN.md` | 中文版同步 |
| `docs/03-features/README.md` | 移除 lazy-loading 条目 |
| `docs/09-reference/changelog.md` | 同 CHANGELOG |
| `docs/09-reference/deferred-items.md` | 删除 "Claude Code listChanged workaround" 后续清理项(已清) |
| `docs/MIGRATION-v4.md`(新增) | 用户迁移指南 |
| `docs/superpowers/specs/2026-07-27-mcp-tool-pruning-v3-x-design.md` | 顶部加 superseded 横幅 |

### 2.5 影响范围总计

| 类别 | 数量 | LOC |
|------|------|-----|
| 删除文件 | 10 | ~1900 |
| 主要修改文件 | 6 | ~700 改动 |
| 新增内容 | 1 文件 + 1 lint + 1 文档 | ~280 |
| 文档更新 | 6 | ~200 |
| **净减** | — | **~1900 LOC** |

---

## 3. 数据流变化 & 错误处理

### 3.1 关键流程对比

#### A. `initialize` 请求处理

```
[v3.3.x]                                  [v4.0]
client → initialize request               client → initialize request
       ↓                                          ↓
捕获 clientInfo                             捕获 clientInfo(保留,审计用)
       ↓                                          ↓
isClaudeCodeClientName?                    直接走
       ↓                                          ↓
shouldSkipLazyLoading = true/false         (无 client-conditional 分支)
       ↓
oninitialize (SDK)                         oninitialize (SDK)
       ↓                                          ↓
InitializeResult {                         InitializeResult {
  protocolVersion,                          protocolVersion,
  capabilities: {                           capabilities,
    tools: {                                serverInfo,
      listChanged: true                     instructions: buildInstructions() ← 新增
    }                                     }
  },                                       (listChanged 默认 false,不出现)
  serverInfo
}
```

**变化**:① Claude Code 检测分支删除(G3)② `listChanged: true` 移除(G4)③ 新增 `instructions` 字段(G8)。

#### B. `tools/list` 请求处理

```
[v3.3.x]                                          [v4.0]
client → tools/list                               client → tools/list
       ↓                                                  ↓
shouldSkipLazyLoading?                                  直接合并
       ↓
treatAsLazyDisabled = ...                              (无 client-conditional 分支)
       ↓
if (lazyLoadEnabled && !treatAsLazyDisabled):
    active = toolRegistry.listActiveTools()            flatTools = buildToolDefinitions()
    stateful = getStatefulToolsForList()               stateful = getStatefulToolsForList()
    合并去重 → 返回                                          合并去重 → 返回
else:
    走 v3.1 fallback(全量)
```

**变化**:单路径,无 client-conditional 分支(G1, G6)。`buildToolDefinitions()` 返回扁平 `ToolDefinition[]`,与 `getStatefulToolsForList()` 合并且去重。

#### C. `tools/call` 请求处理

```
[v3.3.x]                                          [v4.0]
client → tools/call { name, args }                 client → tools/call { name, args }
       ↓                                                  ↓
meta-tool? (use_tool_group/use_tool_schema)          meta-tool? → 已删除,直接跳过
       ↓
lazyLoadEnabled && tool exists?                      tool exists in flatToolDefs or statefulTools?
       ↓                                                  ↓
isToolActive? (false = 不在激活组)                   找到 handler,直接 dispatch
       ↓
有效 → callTool()                                    (无活跃组判断)
无效 → lazyToolErrorResponse
       ↓
stateful switch
```

**变化**:① meta-tool 分支移除(G2, G4)② `isToolActive` 检查移除(G1)③ `lazyToolErrorResponse` 移除(G4)④ 单一 dispatch 路径(G6)。

#### D. `get_schema` 数据流(DB schema 缓存路径,**不变**)

```
[v3.3.x] = [v4.0]
client → get_schema { forceRefresh? }
       ↓
database-service.getSchema(forceRefresh)
       ↓
if (schemaCache && !forceRefresh && (now - schemaCacheTime) < ttl):
    return schemaCache                                ← DB schema 缓存保留(G1 不动它)
else:
    adapter.fetchSchema()                             ← 直查 DB
    schemaCache = result
    schemaCacheTime = now
    return result
```

**这条流程完全不动**;G1 只针对 tool 懒加载,DB schema 缓存继续工作。

### 3.2 错误处理变化

| 场景 | v3.3.x 行为 | v4.0 行为 |
|------|---------|---------|
| 客户端调 `use_tool_group` | 返回激活结果 | MCP 标准 `UnknownTool` 错误(G4) |
| 客户端调 `use_tool_schema` | 返回 full schema | MCP 标准 `UnknownTool` 错误(G2) |
| 客户端调 `clear_cache` | 清 DB schema 缓存 | **不变** |
| 客户端调未注册 tool | `lazyToolErrorResponse` 提示激活组 | MCP 标准 `UnknownTool` 错误 |
| 客户端是 Claude Code | 跳过 lazy load(workaround) | 与其他 client 完全一致(G3) |
| `DB_LAZY_LOAD_ENABLED=true` | 启用 lazy load | 静默忽略(env 解析删除)(G5) |
| `DB_VISIBLE_GROUPS` / `DB_VISIBLE_TOOLS` | (v3.x 设计中,v3.3 还未生效) | 静默忽略(G7) |

### 3.3 兼容性影响

| 用户场景 | 影响 |
|---------|------|
| 已有 LLM 工作流调 `use_tool_group` / `use_tool_schema` | **断裂** — 需更新 prompt / 脚本(在 MIGRATION-v4.md 列出) |
| 设过 `DB_LAZY_LOAD_ENABLED=true` 的部署 | **静默失效** — env 被忽略;行为回退到"全量 tool" |
| 设过 `DB_LAZY_DEFAULT_GROUP=...` 的部署 | **静默失效** — 同上 |
| 设过 `DB_VISIBLE_GROUPS` / `DB_VISIBLE_TOOLS` 的部署(v3.x 设计未实施) | **静默失效** — 同上 |
| 用 `clear_cache` 清 DB schema 缓存 | **不变** |
| 用 `connect_database` / `use_profile` 等 41 个核心 tool | **不变** |
| Claude Code 用户(主战场) | **不变**(v3.3.2 workaround 一直让它走 v3.1 全量路径) |
| 非 Claude Code 客户端(Bedrock / Foundry / Dify / Cline) | **改进** — 一直受 lazy load 困扰,现在统一 |

---

## 4. 测试策略

### 4.1 TDD 任务顺序

| 阶段 | 内容 | 测试文件 | 验证 |
|------|------|---------|------|
| **T1** | `buildInstructions()` 单元测试 | `tests/unit/instructions.test.ts`(新建) | 测试先红后绿 |
| **T2** | `initialize` 响应含 `instructions` 字段 + 无 `listChanged` capability | `tests/integration/initialize.test.ts`(新建) | 同上 |
| **T3** | `tools/list` 返回完整 tool 集合(= v3.3.x 全量 - 2 个已删除 tool),无 client 差异 | `tests/integration/list-tools-full.test.ts`(新建) | 同上 |
| **T4** | `tools/call` 单路径 dispatch;未知 tool 报 `UnknownTool`;`use_tool_group` / `use_tool_schema` 报 `UnknownTool` | `tests/integration/call-tool-dispatch.test.ts`(新建) | 同上 |
| **T5** | `clear_cache` 行为保留(原 e2e 文件改写,只测 DB schema 缓存路径) | 改写既有 `tests/integration/clear-cache.test.ts` | 同上 |
| **T6** | config-loader 不再解析 lazyLoad env,无效 env 静默忽略 | 改写 `tests/unit/config-loader.test.ts`(删 lazyLoad 相关 case) | 同上 |
| **T7** | 删除 §2.1 列出的 9 个测试文件 + 检查其他 integration 文件无悬挂引用 | `npm test` | 全绿 |

### 4.2 字符上限校验(防止 spec 文本失控)

- `buildInstructions()` 内 assert `< 2000 chars`(运行时)
- `scripts/lint-instructions.ts` 在 `npm run lint` 链入(CI 静态检查)

### 4.3 文档同步 checklist

| 文件 | 改动 |
|------|------|
| `CHANGELOG.md` | 新增 `## [4.0.0] - 2026-08-17` 段,完整列出 BREAKING 列表 |
| `README.md` | 加 "Breaking changes in v4" 段 + 移除所有 "lazy load" 描述 |
| `README.zh-CN.md` | 中文版同步 |
| `docs/03-features/README.md` | 移除 lazy-loading 条目 |
| `docs/09-reference/changelog.md` | 同 CHANGELOG |
| `docs/09-reference/deferred-items.md` | 删除 "Claude Code listChanged workaround" 后续清理项 |
| 新增 `docs/MIGRATION-v4.md` | 用户迁移指南 |
| `docs/superpowers/specs/2026-07-27-mcp-tool-pruning-v3-x-design.md` | 顶部加 superseded 横幅 |

---

## 5. 发布计划

### 5.1 发布步骤(用现有 CONTRIBUTING.md 流程)

| 步骤 | 内容 |
|------|------|
| 1 | 提交所有改动到 `feat/v4.0-remove-lazy-load` 分支 |
| 2 | `npm test` + `npm run build` + `npm run lint` 全绿 |
| 3 | `git tag v4.0.0-rc.1` + 内部 e2e |
| 4 | `git tag v4.0.0` + 推送 |
| 5 | `gh release create v4.0.0 --notes-file release-notes-v4.md --verify-tag` |
| 6 | CI 自动 publish(OIDC,无需 NPM_TOKEN) |
| 7 | npmjs.com 验证 + 通知用户群 |

### 5.2 发布前 checklist(引用 CLAUDE.md)

- [ ] 所有测试通过(`npm test` exit 0)
- [ ] TypeScript 编译通过(`npm run build` exit 0)
- [ ] `npm run lint` exit 0(含 `lint:instructions`)
- [ ] `git status` 干净
- [ ] CHANGELOG v4.0.0 BREAKING 段齐
- [ ] `release-notes-v4.md` 写好
- [ ] 无 `.tmp-*` scratch 文件

### 5.3 CHANGELOG v4.0.0 BREAKING 列表(预填)

- **Removed tools** (2):`use_tool_group`, `use_tool_schema`
- **Removed env vars** (4):`DB_LAZY_LOAD_ENABLED`, `DB_LAZY_DEFAULT_GROUP`, `DB_VISIBLE_GROUPS`, `DB_VISIBLE_TOOLS`
- **Removed capability** (1):`tools.listChanged: true` (默认 false,不再声明)
- **Removed mechanisms** (3):per-DB-type tool 懒加载、infoLazy 模式、Claude Code 客户端 workaround
- **Removed concept** (1):tool `group` 字段
- **Added**:`InitializeResult.instructions` 字段(Markdown, < 2000 chars)

### 5.4 后续(不在 v4.0 范围)

| 任务 | 优先级 | 备注 |
|------|--------|------|
| 重写 v3.x pruning 设计文档(基于无 group 的新架构) | 中 | 单独 brainstorming |
| 优化 `server.instructions` 文本(实测 Claude 召回效果后迭代) | 中 | 等用户真实使用反馈 |
| 评估 CORE 精简(基于 v3.x 新架构) | 低 | 等上面两个做完 |

---

## 6. 验收标准(综合)

- [ ] 所有 G1–G8 验证项通过
- [ ] `npm test` + `npm run build` + `npm run lint` 全绿
- [ ] `tools/list` 工具数 = v3.3.x 数 − 2(精确数:43→41 或当前实际值−2)
- [ ] `clear_cache` 调用后,`get_schema` 实际重新查 DB(缓存确实被清了)
- [ ] `use_tool_group` / `use_tool_schema` **不再**出现在 `tools/list`
- [ ] `generate_sample_data` 的 inputSchema 完整且无 stub marker
- [ ] 代码层 grep 命中数为 0(见 §2.1 / §2.2 各表格)
- [ ] `docs/03-features/lazy-loading.md` 删除
- [ ] `docs/MIGRATION-v4.md` 新增
- [ ] CHANGELOG v4.0.0 标 BREAKING,完整列出 §5.3 列表
- [ ] Claude Code 实测:连接 MySQL + 切 profile,`tools/list` 返回 41 个 tool,无 `use_tool_group` / `use_tool_schema`
- [ ] `initialize` 响应含 `instructions` 字段,< 2000 chars

---

## 附录 A:相关链接

- 触发源:Claude Code 官方文档 `https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search`
- v3.2 设计:`docs/superpowers/specs/2026-07-25-v3.2-tool-lazy-loading-design.md`
- v3.x 设计(将被 supersede):`docs/superpowers/specs/2026-07-27-mcp-tool-pruning-v3-x-design.md`
- v3.x 实施计划:`docs/superpowers/plans/2026-07-27-mcp-tool-pruning-v3-x.md`
- 项目发布流程:`CONTRIBUTING.md` § "📦 发布流程"

---

## 附录 B:关键文件快速导航

| 关注点 | 文件 |
|--------|------|
| `tools/list` 输出 | `src/mcp/tool-definitions.ts` + `src/mcp/mcp-server.ts::getStatefulToolsForList` |
| `initialize` 响应 | `src/mcp/mcp-server.ts::setRequestHandler(InitializeRequestSchema, ...)` |
| `tools/call` dispatch | `src/mcp/mcp-server.ts::setRequestHandler(CallToolRequestSchema, ...)` |
| `server.instructions` 内容 | `src/mcp/instructions.ts`(新建) |
| DB schema 缓存(不动) | `src/core/database-service.ts` |
| env 解析(改) | `src/utils/config-loader.ts` |
| 传输层(只删注释) | `src/mcp/mcp-index.ts`, `src/http/routes/mcp-sse.ts` |
