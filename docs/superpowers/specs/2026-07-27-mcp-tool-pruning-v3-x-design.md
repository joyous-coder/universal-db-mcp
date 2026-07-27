# Universal DB MCP — v3.x MCP Tool 精简设计文档

**日期**: 2026-07-27
**作者**: brainstorming 会话
**状态**: 🚧 待用户最终 review
**范围**: v3.x 补丁 — 收紧默认 CORE tool、引入 `DB_VISIBLE_GROUPS` + `DB_VISIBLE_TOOLS` 双层过滤、描述压缩、`outputSchema` 输出结构化
**目标版本**: v3.4.x 或 v3.5.x(沿用 minor bump,**major stay 3**;v4 留给 router 合并,见 [§ Non-goals](#2-非目标-non-goals))

---

## 1. 背景与目标 (Background & Goals)

### 1.1 现状

v3.3.4 默认暴露 **~43 个 MCP tool**(实际 39-46,permission-conditional 数量随权限变化),占 system prompt ~2200 tokens。其中:

- 12 个 stateful 工具(连接/查询/Schema)硬编码在 `mcp-server.ts:413-444` 的 `getStatefulToolsForList()`
- 4 个 conditional 工具(需 permission):`execute_script` / `execute_sql_file` / `execute_batch` / `generate_sample_data`
- 2 个 meta(`use_tool_group` / `use_tool_schema`)
- 1 个 infoLazy(`generate_sample_data`)
- 3 个 stateful lazy 工具(`use_profile` / `execute_template` / `get_metrics`,走 fallback switch 而非 registry)
- 27 个 group 工具:`query-experience`(7)、`profiles`(10)、`data-governance`(7)、`index-advisor`(3)

### 1.2 已知问题

1. **token 浪费**:43 个 tool description ≈ 2200 tokens,占 Claude 上下文 ~1.1%
2. **LLM 选错率**:30-40 tool 已接近 Anthropic 警告的"中等风险"区
3. **Claude Code 不响应 `listChanged`**:v3.2 lazy loading 机制在 Claude Code 上失效,v3.3.2 已加 `shouldSkipLazyLoading()` workaround,使 Claude Code 用户仍看到全部 43 个
4. **MCP 官方 SEP-1576**(token bloat)已 closed as **DORMANT** — 官方 spec 短期无解
5. **业界趋势**:GitHub MCP(80 tool)、Sequential Thinking 等都被社区点名为 token 浪费典型

### 1.3 目标 (Goals)

| # | 目标 |
|---|---|
| **G1** | 默认 MCP session **只看到 CORE 12 + meta + infoLazy(15-16 个 tool)**,token 从 2200 降至 ~500 |
| **G2** | 引入 `DB_VISIBLE_GROUPS` 与 `DB_VISIBLE_TOOLS` 双层 env,允许静态启用被默认隐藏的工具 |
| **G3** | 压缩 43 tool description,平均字符数 -30%(从 ~70 到 ~47) |
| **G4'** | **默认行为硬切**(BREAKING):不设 env = 只 CORE;不沿用 v3.3.4 默认全开 |
| **G5** | 主要 tool 加 `outputSchema` 协议层字段,handler 返回 `structuredContent`,LLM 直接拿 JSON,节省输出 token 30-70% |
| **G6** | 零破坏 tool 名 / inputSchema / HTTP REST API |
| **G7** | CI 加 schema lint,防止后续 PR 重新引入冗余 description |
| **G8** | 完整迁移文档 + CHANGELOG BREAKING 标注 |

### 1.4 非目标 (Non-goals)

- ❌ **不** Router 合并(`profiles({action:...})` 形态)— 留 v4
- ❌ **不** Resources 转换(只读 tool 转 `schema://` URI)— 留 v4
- ❌ **不** 改 inputSchema 任何字段
- ❌ **不** 改 HTTP REST API
- ❌ **不** 动态 intent 检测(intent-based 注册)
- ❌ **不** 跨多 MCP 服务拆分 — 一进程一服务
- ❌ **不** 强制 ENABLE 老 v3.1 lazy 机制;`DB_LAZY_LOAD_ENABLED` / `DB_LAZY_DEFAULT_GROUP` 保留但不再推广

### 1.5 验收标准

- [ ] 未设任何 env 时,ListTools 返回 15 个 tool(12 CORE + 2 meta + 1 infoLazy;`generate_sample_data` 仅在 insert+batch 权限下可见,实际 14-15)
- [ ] 设 `DB_VISIBLE_GROUPS=query-experience` 时,ListTools 返回 12 + 8 + 2 meta + 1 infoLazy = 23 个
- [ ] 设 `DB_VISIBLE_TOOLS=audit_log` 时,ListTools 返回 12 + 1 + 2 meta + 1 infoLazy = 16 个
- [ ] 两个 env 同时设:合集生效
- [ ] 非法 env 值给出 `console.warn` + 不阻塞启动 + 回退合理默认
- [ ] 空字符串(`DB_VISIBLE_GROUPS=`)等同未设
- [ ] Claude Code client(模拟 clientInfo.name="claude-code-x.y.z")也只看到 CORE(+ 启用的 group)
- [ ] 主要 tool handler 返回 `{ content, structuredContent }`
- [ ] `npm test` 全绿
- [ ] CI lint 0 errors
- [ ] description 平均长度 ≤ 49 chars / 个(从 ~73 降至 ~49)
- [ ] CHANGELOG 标 BREAKING,README + MIGRATION 文档齐备

---

## 2. 工具分组定义 (Tool Categorization)

### 2.1 CORE 12 — 总是可见,不可被 env 关闭

| # | Tool | 类别 | 说明 |
|---|---|---|---|
| 1 | `connect_database` | 连接 | 启动会话 |
| 2 | `disconnect_database` | 连接 | 清理 |
| 3 | `get_connection_status` | 连接 | 内省 |
| 4 | `use_profile` | 连接 | 切换 saved profile |
| 5 | `execute_query` | 查询 | 万能 SQL |
| 6 | `execute_script` | 查询 | 多语句(需 script 权限) |
| 7 | `execute_batch` | 查询 | 批量(需 batch 权限) |
| 8 | `get_schema` | Schema | 概览 |
| 9 | `get_table_info` | Schema | 详情 |
| 10 | `get_enum_values` | Schema | 枚举值 |
| 11 | `get_sample_data` | Schema | 样例行 |
| 12 | `clear_cache` | Schema | 刷缓存 |

### 2.2 META — 总是可见

| # | Tool | 说明 |
|---|---|---|
| 13 | `use_tool_group` | 动态启用 lazy group |
| 14 | `use_tool_schema` | 加载 info-lazy schema |

### 2.3 INFO-LAZY — 总是可见(轻 schema)

| # | Tool | 说明 |
|---|---|---|
| 15 | `generate_sample_data` | 大 schema,完整版需 `use_tool_schema` 加载 |

### 2.4 LAZY GROUPS — 默认不可见,通过 env 或 `use_tool_group` 启用

#### `query-experience`(8 tools)

| # | Tool | 备注 |
|---|---|---|
| 16 | `explain_query` | EXPLAIN plan |
| 17 | `lint_sql` | SQL 静态检查 |
| 18 | `get_query_history` | 历史查询 |
| 19 | `execute_template` | 跑模板 |
| 20 | `save_template` | 存模板 |
| 21 | `list_templates` | 列模板 |
| 22 | `get_template` | 详情 |
| 23 | `delete_template` | 删模板 |
| 24 | `execute_sql_file` | 跑 .sql(需路径白名单) |

#### `profiles`(10 tools)

| # | Tool | 备注 |
|---|---|---|
| 25 | `save_profile` | |
| 26 | `list_profiles` | |
| 27 | `get_profile` | |
| 28 | `delete_profile` | |
| 29 | `enable_profile` | |
| 30 | `disable_profile` | |
| 31 | `get_global_schema` | |
| 32 | `export_profiles` | |
| 33 | `import_profiles` | |
| 34 | `disconnect_profile` | |

#### `data-governance`(7 tools)

| # | Tool | 备注 |
|---|---|---|
| 35 | `audit_log` | 审计日志 |
| 36 | `get_pii_config` | PII 配置查询 |
| 37 | `set_pii_config` | PII 配置修改 |
| 38 | `export_backup` | schema 备份 |
| 39 | `export_table_csv` | CSV 导出 |
| 40 | `import_csv` | CSV 导入 |
| 41 | `compare_profile_schemas` | profile schema 对比 |

#### `index-advisor`(4 tools)

| # | Tool | 备注 |
|---|---|---|
| 42 | `explain_query_with_advice` | EXPLAIN + 索引建议 |
| 43 | `compare_query_plans` | plan 对比 |
| 44 | `list_query_plans` | 列 plan |
| 45 | `get_metrics` | 指标(observability,v3.3.4 是 stateful,本次归组) |

**合计**: 15 总是可见 + 30 lazy group tools = 45 个 tool

### 2.5 总数对账

v3.3.4 写"~43"是因为 `execute_sql_file` 与 `generate_sample_data` 在 conditional 路径、permission-gated;
v3.x 设计**重新分类**(取消 conditional,改为明确归属于 group 或 infoLazy):

| 来源 | v3.3.4 数 | v3.x 数 | 差 |
|---|---|---|---|
| 总是可见(stateful+meta+infoLazy) | 13-16 | 15 | +2(因 `execute_script`/`execute_batch` 进 CORE,`get_metrics` 离 CORE 进 group) |
| lazy group(可隐藏) | ~27 + 3 个 stateful 隐蔽 | 30 | +1 |
| **总** | **~43** | **45** | +2 |

**与历史 e2e 测试矩阵(43)×(7-DB)**:新默认下大多数测试会"fail"(因为默认只 15 个 tool),需更新 e2e 范围说明,新增"默认场景"测试集(只 15 个 tool)。

### 2.6 e2e 测试范围影响说明

- **v3.3.4 e2e**:测全 43 tool × 7-DB = 301 用例,v3.x 默认下大量预期失败
- **v3.x 新增 e2e**:测 15 tool × 7-DB = 105 用例(默认 CORE)
- **v3.x 保留 e2e**:所有 45 tool × 至少 1 DB(配置 `DB_VISIBLE_GROUPS=all`),保留回归能力

| # | Tool | 备注 |
|---|---|---|
| 42 | `explain_query_with_advice` | EXPLAIN + 索引建议 |
| 43 | `compare_query_plans` | plan 对比 |
| 44 | `list_query_plans` | 列 plan |
| 45 | `get_metrics` | 指标(observability) |

**合计**: 15 总是可见 + 30 lazy group tools = 45 个 tool(超出 43 是因为 execute_sql_file 也归 query-experience,而 get_metrics 归 index-advisor)

### 2.5 总数对账

v3.3.4 写 43 个 tool 数是因为 execute_sql_file 被算在 conditional(getStatefulToolsForList 内 permission gated)。本次重新分类:

- 总是可见(CORE 12 + meta 2 + infoLazy 1)= 15
- lazy group 30
- 合计 45(其中 execute_sql_file 移入 query-experience,get_metrics 移入 index-advisor)

**与历史 e2e 测试的 43 差 2**:这次拆分更合理,后续 e2e 矩阵需更新。

---

## 3. 组件详细规则 (Components)

### 3.1 `ToolVisibilityFilter`(`src/mcp/tool-visibility-filter.ts`,原 visible-group-filter.ts 改名)

#### 接口

```typescript
export type ToolGroup = 'query-experience' | 'profiles' | 'data-governance' | 'index-advisor';

export interface ParseResult {
  /** 最终可见 tool 名字集合(包含 CORE stateful + meta + infoLazy + groups 命中 + individual 命中) */
  visibleTools: Set<string>;
  /** 非法值列表,启动时 console.warn */
  warnings: string[];
  /** 原始合法 group 列表(供调试) */
  parsedGroups: ToolGroup[];
  /** 原始合法 tool 列表(供调试) */
  parsedTools: string[];
}

export class ToolVisibilityFilter {
  static readonly DEFAULT_VISIBLE_GROUPS: ToolGroup[] = [];   // ← 重要:硬切默认
  static readonly DEFAULT_VISIBLE_TOOLS: string[] = [];

  /** 核心解析 */
  static parse(
    visibleGroupsRaw: string | undefined,
    visibleToolsRaw: string | undefined,
    allKnownTools: Set<string>,
    groupToolMap: Record<ToolGroup, string[]>
  ): ParseResult;

  static isValidGroup(name: string): name is ToolGroup;
  static isCoreTool(name: string): boolean;       // 是否在 CORE 12 + meta + infoLazy
}
```

#### env 解析规则

| `DB_VISIBLE_GROUPS` 输入 | 行为 |
|---|---|
| 未设 或 空字符串 | 用 `DEFAULT_VISIBLE_GROUPS = []`(硬切:无 group) |
| `profiles` | 单 group,验证后加入 |
| `profiles,query-experience` | 多 group,全部加入 |
| `profiles,xxx_invalid` | warning + 跳过 invalid,`profiles` 生效 |
| `xxx_invalid` 全非法 | warning + 用 `DEFAULT_VISIBLE_GROUPS = []` |

| `DB_VISIBLE_TOOLS` 输入 | 行为 |
|---|---|
| 未设 或 空 | 用 `DEFAULT_VISIBLE_TOOLS = []` |
| `explain_query` | 单 tool,验证后加入 |
| `explain_query,xxx_invalid` | warning + skip invalid |
| `execute_query`(CORE 内) | warning "CORE tools always visible, redundant declaration" + skip |
| `use_profile`(stateful CORE 内) | 同上 warning + skip |
| `use_tool_group`/`use_tool_schema`(meta) | 同上 warning + skip |

#### 优先级与运算

```typescript
const alwaysVisible = new Set([
  // CORE 12
  'connect_database', 'disconnect_database', 'get_connection_status',
  'use_profile', 'execute_query', 'execute_script', 'execute_batch',
  'get_schema', 'get_table_info', 'get_enum_values',
  'get_sample_data', 'clear_cache',
  // meta 2
  'use_tool_group', 'use_tool_schema',
  // infoLazy 1
  'generate_sample_data',
]);

const groupVisible = union of groupToolMap[g] for g in parsedGroups;
const toolsVisible = new Set(parsedTools);

const final = new Set([...alwaysVisible, ...groupVisible, ...toolsVisible]);
```

**关键**:
- CORE 不可被 env 关闭
- `DB_VISIBLE_GROUPS` 和 `DB_VISIBLE_TOOLS` 是**合集(union)**,不是交集
- 任何命中即可见

---

### 3.2 描述压缩(静态,build-time)

#### 目标

| metric | v3.3.4 | v3.x |
|---|---|---|
| 总字符数(45 tool) | ~3300 | ≤ 2200(-33%) |
| 平均字符/tool | ~73 | ≤ 49 |
| 最大字符 | ~250(`use_tool_group`) | ≤ 150 |
| 含 `vX.Y` 字样 | 多处 | 0 |
| 含 `[group:` 字样 | 30 处 | 0 |
| 含 `**vX**:**` 加粗 | 多处 | 0 |

#### 压缩规则(逐 tool 手工修改)

| 规则 | 操作 | 示例 |
|---|---|---|
| 删 `[group: xxx]` 后缀 | 删除 | `"连接数据库。[group: connection]"` → `"连接数据库。"` |
| 删版本备注 `vX.x:` | 删除 | `"查询历史 v3.1: ..."` → `"查询历史"` |
| 删 `**vX.x**:**` 加粗 | 删除 | `"**v3.3.1**: Claude Code..."` → `"Claude Code..."` |
| 统一中文标点 | 半角 → 全角 | — |
| 删 "(可选, 默认 false)" | 删除 | `"是否强制刷新缓存(可选,默认 false)"` → `"是否强制刷新缓存"` |
| 合并连续空白 | — | — |
| 重复副标题合并 | 第一句 | — |

#### 实现方式

**build-time 直接改源码**:每个 tool 的 `description` 字符串一次性精简,不引入 runtime 转换层。理由:
- 不增加运行时代价
- 代码 review 直观
- 后续 lint 工具可一眼对照

#### 涉及文件

- `src/mcp/tools/query-tools.ts` (`TOOL_DESCRIPTIONS`)
- `src/mcp/tools/profile-tools.ts` (`PROFILE_TOOL_DESCRIPTIONS`)
- `src/mcp/tools/data-governance.ts` (`DATA_GOVERNANCE_TOOL_DESCRIPTIONS`)
- `src/mcp/tools/csv-tools.ts` (`CSV_TOOL_DESCRIPTIONS`)
- `src/mcp/tools/plan-history.ts` (`PLAN_HISTORY_TOOL_DESCRIPTIONS`)
- `src/mcp/tools/metrics.ts` (`GET_METRICS_TOOL_DESCRIPTION`)
- `src/mcp/tool-definitions.ts`(meta + infoLazy + use_tool_group 描述)

---

### 3.3 `OutputSchemaRegistry`(`src/mcp/output-schemas.ts`)

#### 协议层背景

MCP 1.x 允许 tool handler 同时返回 `structuredContent`(JSON)+ `content`(人类可读文本)。v3.3.4 没用,本次启用。

```typescript
// before
return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };

// after
return {
  content: [{ type: 'text', text: `Returned ${rows.length} rows in ${durationMs}ms.` }],
  structuredContent: { rows, rowCount: rows.length, durationMs, columns }
};
```

#### 加 outputSchema 的 tool 清单

| Tool | outputSchema 结构 |
|---|---|
| `execute_query` | `{ rows: array, rowCount: number, durationMs: number, columns: array, truncated?: boolean }` |
| `execute_script` | `{ statements: array, success: boolean, errorIndex?: number }` |
| `execute_batch` | `{ affectedRows: number, batchCount: number, durationMs: number }` |
| `get_table_info` | `{ columns: array, indexes: array, rowCount?: number }` |
| `get_schema` | `{ tables: array, tableCount: number }` |
| `get_sample_data` | `{ rows: array, columns: array, masked: array, totalRows: number }` |
| `get_enum_values` | `{ values: array, counts?: object }` |
| `connect_database` | `{ connected: boolean, type: string, host?: string }` |
| `get_connection_status` | `{ connected: boolean, type?: string, host?: string }` |
| `list_templates` | `{ templates: array, count: number }` |
| `list_profiles` | `{ profiles: array, count: number }` |

未列出的 tool 输出变化小,可不加(增量收益低)。

#### handler 改造模式

```typescript
buildExecuteQueryHandler = (deps) => async (args, sessionId) => {
  const result = await this.adapter.query(args.sql, args.params);
  return {
    content: [{ type: 'text', text: `Returned ${result.rows.length} rows in ${result.durationMs}ms.` }],
    structuredContent: result,
    _meta: { outputSchemaVersion: '1' },  // 为后续 schema 演进留余地
  };
};
```

#### 兼容性

- 现有 LLM/client 读 `content[0].text` 不变
- 新 LLM 可读 `structuredContent`
- HTTP REST 不变(返回 JSON 字符串)
- **零 break**

---

## 4. 数据流 (Data Flow)

### 4.1 启动期

```
.env / process.env
  ↓ DB_VISIBLE_GROUPS, DB_VISIBLE_TOOLS raw string

[1] loadConfig() in src/utils/config-loader.ts (新增 ~25 行)
  ↓ 解析成 config.visibleGroups: string[] | null
  ↓       config.visibleTools:  string[] | null

[2] DatabaseMCPServer.configureFromAppConfig(config)
  ↓ 透传 visibleGroups, visibleTools

[3] rebuildToolRegistry() → buildToolRegistry({ ..., visibleGroups, visibleTools })
  ↓
[4] ToolVisibilityFilter.parse(...)  ← 新模块
  ↓ return { visibleTools: Set, warnings, parsedGroups, parsedTools }
  ↓ if warnings.length > 0 → console.warn

[5] new ToolRegistry({
       tools: {
         core: [...defs.meta, ...defs.infoLazy],      // ← 总是
         groups: pick visible groups only,             // ← 构造期过滤
       },
       visibleIndividualTools: Set(individualTools),    // ← 单独 track
       defaultActiveGroups: parsedGroups OR [],
     })

[6] server.start()  (stdio / SSE / Streamable HTTP)
```

### 4.2 ListToolsRequest handler

```typescript
// src/mcp/mcp-server.ts setupHandlers 内
this.server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools: Tool[] = [];

  // [A] CORE 12 (stateful, 硬编码)
  tools.push(...this.getCoreToolsForList());

  // [B] meta + infoLazy (registry core)
  tools.push(...this.toolRegistry.listCore());

  // [C] visible groups 的 tool (registry groups)
  for (const g of this.toolRegistry.getActiveGroups(sessionId)) {
    tools.push(...this.toolRegistry.listGroupTools(g));
  }

  // [D] individual visible tools (not in any group)
  tools.push(...this.toolRegistry.listIndividualTools());

  // [E] 注入 outputSchema
  for (const t of tools) {
    const schema = OutputSchemaRegistry.get(t.name);
    if (schema) t.outputSchema = schema;
  }

  // [F] 描述已在源码静态精简,无需运行时转

  return { tools };
});
```

#### Claude Code 特例(`shouldSkipLazyLoading`)的保留

- v3.3.2 检测到 client name 为 `claude-code` → 跳过 lazy
- v3.x 保留这个 hook,**但因为 visibleGroups 在 registry 构造期已生效**
- Claude Code 用户看到 = CORE + 他们的 visible groups × 各自的 tools
- 不再"Claude Code 看到全部 43"

### 4.3 CallToolRequest handler

```typescript
this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  // [1] routing
  if (this.isCoreStatefulTool(name)) {
    return this.handleCoreStateful(name, args);    // 直接路由
  }
  if (this.toolRegistry.isToolActive(sessionId, name)) {
    return this.toolRegistry.callTool(name, args, sessionId);
  }
  if (name === 'use_tool_group' || name === 'use_tool_schema') {
    return this.handleMetaTool(name, args);
  }

  // [2] 404
  return this.notFoundResponse(name, sessionId);
});
```

### 4.4 DB_VISIBLE_GROUPS / DB_VISIBLE_TOOLS / 既有 lazy 配置的关系

| 机制 | v3.2/v3.3 | v3.x |
|---|---|---|
| `DB_LAZY_LOAD_ENABLED` | 控制 lazy 是否启用 | 保留不动,继续生效 |
| `DB_LAZY_DEFAULT_GROUP` | session 启动预激活 group | 保留不动 |
| `DB_VISIBLE_GROUPS`(新) | — | registry 构造期过滤,**优先级最高** |
| `DB_VISIBLE_TOOLS`(新) | — | 单独加入 individual tools |
| `shouldSkipLazyLoading()`(Claude Code) | 跳过 lazy,全可见 | Claude Code 也只看到 visible |

**互不冲突**:
- `DB_LAZY_LOAD_ENABLED=false` + `DB_VISIBLE_GROUPS=...` → 用 visible 行为
- `DB_LAZY_LOAD_ENABLED=true` + `DB_VISIBLE_GROUPS=...` → 也用 visible 行为(visible 是构造期)

---

## 5. 错误处理 (Error Handling)

### 5.1 env 校验失败

| 场景 | 行为 |
|---|---|
| `DB_VISIBLE_GROUPS=xxx_invalid` | `console.warn` 列出非法值;回退 `DEFAULT = []`(硬切) |
| `DB_VISIBLE_GROUPS=` 空字符串 | 同未设,回退 `[]` |
| `DB_VISIBLE_GROUPS=a,,b`(空 token) | 跳过空值 |
| `DB_VISIBLE_GROUPS=profiles, QUERY-EXPERIENCE` (大小写不规范) | 小写化后验证 |
| 混合合法/非法 | 合法生效,非法 warning 跳过 |
| 全非法 | warning + 回退 `[]` |

| 场景 | 行为 |
|---|---|
| `DB_VISIBLE_TOOLS=audit_log`(group 内工具) | 直接加入,与 group 无关 |
| `DB_VISIBLE_TOOLS=execute_query`(CORE 内) | warning + skip + 提示"CORE 总是可见,无需声明" |
| `DB_VISIBLE_TOOLS=use_profile`(stateful CORE 内) | 同上 |
| `DB_VISIBLE_TOOLS=meta_tool`(meta 内) | 同上 |
| `DB_VISIBLE_TOOLS=xxx_invalid` | warning + skip |
| 全非法 | warning + `[]`(不阻塞启动) |

**不抛异常**。env 配置错误不该让 MCP server 起不来。

### 5.2 运行时 tool 调用错误

| 场景 | 现有行为 | v3.x 保留 |
|---|---|---|
| LLM 调 group 内未启用 tool | `lazyToolErrorResponse()` 提示调 `use_tool_group` | 保留 |
| LLM 调未注册 tool 名 | `notFoundResponse` 404 | 保留 |
| LLM 调 CORE tool 但 adapter 未连接 | `adapter is null` 错 | 保留 |

### 5.3 outputSchema 不匹配

| 场景 | 行为 |
|---|---|
| handler 返回的 `structuredContent` 不符 `outputSchema` | handler 内 validate;不符抛 `McpError` with details |
| handler 抛异常 | 现有逻辑,`isError: true` JSON |

### 5.4 迁移期 client 兼容

升级 v3.x 后老 client 调不到 hidden tool 的应对:

- 现有 `lazyToolErrorResponse` 文案微调:`'tool not available. To enable: call use_tool_group({name: "<group>"}) OR set DB_VISIBLE_GROUPS=<group>.'`
- 这样 client 知道下一步怎么恢复
- 不主动通知 client(避免 listChanged 噪音)

---

## 6. 测试策略 (Testing Strategy)

### 6.1 单元测试

| 文件(新增) | 覆盖 |
|---|---|
| `tests/unit/tool-visibility-filter.test.ts` | parse 默认/空/单值/多值/非法/全非法/大小写/混合/CORE meta 拒绝 |
| `tests/unit/output-schema-registry.test.ts` | 每个 tool 的 schema 注入正确 |
| `tests/unit/description-length.test.ts`(可选用 build-time 统计) | 验证 description 平均 ≤ 49 chars |

### 6.2 集成测试

| 文件 | 覆盖 |
|---|---|
| `tests/integration/visible-tools-pruning.test.ts`(新) | 启动注入 env → ListTools → 验证返回的 tool 数和名 |
| `tests/integration/call-tool-routing.test.ts`(扩) | DB_VISIBLE_GROUPS 只暴露 profiles 时,调 query-experience 内 tool 失败 |
| `tests/integration/lazy-load-e2e.test.ts`(扩) | 既有 e2e 测试保留,与 visibleGroups 协同 |
| `tests/integration/lazy-loading-notification.test.ts`(扩) | 同上 |

### 6.3 E2E

| 文件 | 覆盖 |
|---|---|
| `tests/e2e/claude-code-skip.test.ts`(扩) | 模拟 Claude Code client,验证 visibleGroups 仍生效 |
| `tests/e2e/mcp-sdk-default.test.ts`(新) | 用 `@modelcontextprotocol/sdk` 模拟多种 client,验证 ListTools 符合协议 |
| `tests/e2e/output-schema-protocol.test.ts`(新) | 验证 structuredContent 字段在 JSON-RPC 序列化中正确 |

### 6.4 回归

- `npm test` 必须全绿
- 现有 e2e D1-D27(7-DB × 43-tool 矩阵)需要更新,因为 tool 总数从 43 变成 45,且默认变 CORE only
- 旧 e2e 在新默认下大量"失败"是**预期**,文档说明

### 6.5 CI Schema Lint(新)

`npm run lint:tools`,扫描每个 tool 的 metadata:

| 规则 | 严重 |
|---|---|
| description > 150 chars | warning |
| description 包含 `vX.Y` 字样 | warning |
| description 包含 `[group:` 字样 | warning |
| description 包含 `**vX` 加粗 | warning |
| tool 缺失 description | error |
| tool 缺失 required 字段(name/schema) | error |
| enum 字段缺失 | error |

**0 errors 才允许 merge**。

---

## 7. CHANGELOG / 迁移 (Changelog & Migration)

### 7.1 CHANGELOG.md 条目格式

```markdown
## v3.4.0 (2026-07-xx) — Tool Pruning Patch

### ⚠️ BREAKING CHANGES

- **默认 CORE 收紧到 12 个 tool** — 详细见下方
- 30 个 group tool **默认不注册**;需 `use_tool_group` 启用,或设 `DB_VISIBLE_GROUPS` / `DB_VISIBLE_TOOLS` 静态启用
- 4 个 v3.3.4 默认可见的 tool 移到 group:`clear_cache`(保留 CORE,不在 group)、`execute_template`(query-experience)、`execute_sql_file`(query-experience)、`get_metrics`(index-advisor)
- Claude Code 用户此前看到的"全部 43 个 tool"现在也只看到 CORE + 启用的 group

### ✨ Features

- 新增 `DB_VISIBLE_GROUPS` env(粗粒度 group 控制)
- 新增 `DB_VISIBLE_TOOLS` env(细粒度 individual tool 控制)
- 主要 tool 增加 `outputSchema` + `structuredContent` 输出(LLM 拿 JSON,token 节省)
- 45 tool 描述精简,平均字符数 -33%(从 ~73 降至 ~49)
- CI 新增 `npm run lint:tools` schema lint

### 📖 Migration

详见 `docs/MIGRATION-v3.4-tool-pruning.md`
```

### 7.2 MIGRATION 文档要点

`docs/MIGRATION-v3.4-tool-pruning.md`:

1. **默认场景不动**:什么 env 都不设的 client 不受影响(只看到 CORE)
2. **常用 tool 迁移对照表**(v3.3.4 → v3.x):
   - `clear_cache` → 保留 CORE(不动)
   - `execute_template` → query-experience(默认不可见)
   - `execute_sql_file` → query-experience(默认不可见)
   - `audit_log` → data-governance(默认不可见)
   - `get_metrics` → index-advisor(默认不可见)
   - 共 30 个 tool 从"总是可见"移到 group(需 env 或 `use_tool_group` 启用)
3. **恢复 v3.1 全部行为**:
   ```bash
   DB_VISIBLE_GROUPS=query-experience,profiles,data-governance,index-advisor
   ```
4. **Claude Code 专项**:README 单独小节,推荐精简配置

### 7.3 README 改动

- 新增 "Tool pruning" 小节
- 给 "Claude Code 推荐配置":
  ```json
  {
    "env": {
      "DB_VISIBLE_GROUPS": "query-experience"
    }
  }
  ```
- 给 "全功能配置"(完整 45 个):
  ```json
  {
    "env": {
      "DB_VISIBLE_GROUPS": "query-experience,profiles,data-governance,index-advisor"
    }
  }
  ```

---

## 8. 实施计划入口 (Implementation Entry Point)

**不包含**具体任务分解(spec 已足够清晰)。实施阶段由 writing-plans skill 接管,产出 implementation plan。

**主要 touch point**:
- `src/utils/config-loader.ts` — 加两 env 解析
- `src/mcp/tool-visibility-filter.ts`(新)— 双 env 合并解析
- `src/mcp/tool-definitions.ts` — 注入 visible 过滤
- `src/mcp/tool-registry.ts` — 加 visibleIndividualTools 字段
- `src/mcp/output-schemas.ts`(新)— 10+ 个 outputSchema 定义
- `src/mcp/mcp-server.ts` — getCoreToolsForList + outputSchema 注入
- `src/mcp/tools/*.ts` — 描述精简 + 部分 handler 改 structuredContent
- `src/types/http.ts` — AppConfig 加 visibleGroups / visibleTools 字段
- `tests/` — 见第 6 节
- `package.json` — 加 `lint:tools` script
- `CHANGELOG.md` + `docs/MIGRATION-v3.4-tool-pruning.md` + `README.md`

**估计 LOC**:新增 ~600,修改 ~400,e2e + 单元 + linter test ~800。

---

## 9. 风险与缓解 (Risks & Mitigations)

| 风险 | 缓解 |
|---|---|
| **老 client / 老 prompt 引用隐藏 tool 名** | 提供完整 migration guide,tool 错误响应明确指向 `use_tool_group` 或 env |
| **env 配置错误导致起不来** | 全部容错:非法值 warning + 回退默认,不抛 |
| **description 改坏后 LLM 选错率上升** | CI lint + 现有 e2e 矩阵基线对比 |
| **outputSchema 与 handler 实际不符** | handler 内 validate;测试覆盖每个 schema 字段 |
| **Claude Code skipLazyLoading 行为变化破坏老 workaround** | README 显式说明:Claude Code 现在只看到 CORE + 启用的 group |
| **HTTP REST client 引用 hidden tool**(少见)| REST API 路径不变,只影响 MCP tool layer |

---

## 10. 后续 (Out of Scope)

| 项 | 留到版本 |
|---|---|
| Router 合并(`profiles({action:...})`)| **v4.0** |
| Resources 转换(get_* 转 `schema://`)| **v4.1** |
| Top-k 检索 / ToolHive 集成 | **v5** |
| 客户端代理(`mcp-lazy-proxy` 包装) | 推荐,用户自行配置,不在 server 包内 |
| 跨多 MCP 服务拆分 | 不做(单进程单服务) |

---

**END OF SPEC**
