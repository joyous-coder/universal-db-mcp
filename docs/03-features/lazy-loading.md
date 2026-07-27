# Tool Lazy-Loading (v3.2)

## Why

In v3.1, 26 MCP tool definitions (description + schema) were loaded into every Claude Desktop session — ~1,750 tokens even when most tools weren't used.

v3.2 splits tools into:
- **12-14 core** (always-on; conditional on permission for `execute_script` / `execute_sql_file` / `execute_batch`)
- **28 lazy** (4 groups: query-experience / profiles / data-governance / index-advisor)
- **1 info-lazy** (generate_sample_data)

Default session now uses ~700 tokens (60% reduction).

> **Backward compat**: lazy-loading is **opt-in** via `DB_LAZY_LOAD_ENABLED=true`. Default behavior (v3.1) is unchanged — all 26+ tools always listed.

## ⚠️ Claude Code 客户端限制 (v3.3.1)

**MCP 协议规定** `notifications/tools/list_changed` 应该通知 client 刷新工具列表(我们的 server 在 v3.2.1 开始就调 `sendToolListChanged()`)。但实测发现:

| MCP 客户端 | 是否消费 listChanged 通知 | 备注 |
|---|---|---|
| **Claude Code** | ❌ **不消费** | 当前实现忽略通知,无法在 session 中刷新工具列表 |
| Claude Desktop | ⚠️ 同 Code 行为 | 客户端缓存 `ListTools` 到 session 启动时 |
| Cursor | ⚠️ 类似 | 也是会话启动时缓存 |
| **Cline / Continue / Dify / Cherry Studio** | ✅ 一般支持 | HTTP 长连接,能收到服务端发出的通知 |
| **5ire / HyperChat 等国内客户端** | ✅ 通常支持 | 多数独立实现了 refresh |

### 现象

在 Claude Code 中调用 `use_tool_group({ name: 'data-governance' })`,服务端会:
1. server 端状态机切换:`profiles` group active → `data-governance` group active
2. 调 `server.sendToolListChanged()` 发 `notifications/tools/list_changed` 到 stdout
3. Claude Code 客户端**不会刷新** → 已激活的 5 个 tool 仍对用户不可见
4. 用户必须**重启 Claude Code** 才能看到新 tool

### v3.3.1 修复

服务端这一侧已校正:
- ✅ `server.sendToolListChanged()` 调用加了 error 日志(原来静默吞 try/catch)
- ✅ `use_tool_group` / `use_tool_schema` tool description 明确告知"若客户端不消费 listChanged,需重启客户端或刷新 MCP 工具列表"
- ✅ 测试覆盖:`tests/unit/lazy-loading-notification.test.ts` 验证通知真的发出

但**真正修复 Claude Code 行为需要 Claude Code 升级** — 这是 Anthropic 客户端的问题,服务端无法绕过。

### Workaround(Claude Code 用户)

如果你真的想用懒加载,设环境变量 opt-in:

```jsonc
// .mcp.json
{
  "mcpServers": {
    "universal-db-mcp": {
      "command": "npx",
      "args": ["-y", "@joyous-coder/universal-db-mcp", "--type", "mysql", "--host", "..."],
      "env": {
        "DB_LAZY_LOAD_ENABLED": "true",
        "DB_LAZY_DEFAULT_GROUP": "query-experience"
      }
    }
  }
}
```

- 启动时只激活 `query-experience`(9 tool),最快
- 用 `use_tool_group({ name: 'profiles' })` 激活其他 group
- **必须重启 Claude Code** 才能看到新激活的 tool
- 这能 **节省 ListTools 返回的 token**(~700 vs ~1750),但**不会节省运行时 token**
- **不建议** Claude Code 用户启用 — 默认全激活是最稳定的用法

### 推荐用法对照

| 客户端 | 推荐设置 |
|---|---|
| Claude Code / Claude Desktop | `DB_LAZY_LOAD_ENABLED` 不设 / 设为 `false`(默认)— 全 tool 立即可见 |
| Cline / Continue / Dify / Cherry Studio | `DB_LAZY_LOAD_ENABLED=true` + `DB_LAZY_DEFAULT_GROUP=query-experience` — 真懒加载可用 |
| 自研 HTTP MCP 客户端 | 同上 — `use_tool_group` 后能 refresh |

## Groups

| Group | Tools | Purpose |
|---|---|---|
| `query-experience` (9) | explain_query, lint_sql, get_query_history, save/list/get/delete/execute_template, get_metrics | SQL analysis + templates + metrics |
| `profiles` (11) | save, list, use, global_schema, export, import, get, delete, enable, disable, disconnect | Multi-profile management + lifecycle |
| `data-governance` (5) | compare_profile_schemas, export_backup, audit_log, get_pii_config, set_pii_config | Schema diff + backup + audit + PII |
| `index-advisor` (3) | explain_query_with_advice, compare_query_plans, list_query_plans | Plan advice + diff + history |

## Meta-tools

### `use_tool_group({ name: <group> })`

Activates a group. Returns:

```json
{
  "alreadyActive": false,
  "activeGroups": ["data-governance"],
  "newlyAvailable": [
    { "name": "compare_profile_schemas", "description": "..." },
    { "name": "export_backup", "description": "..." },
    ...
  ]
}
```

### `use_tool_schema({ name: "generate_sample_data" })`

Returns the full JSON Schema (with examples) for info-lazy tools. Currently only `generate_sample_data`.

## Error format

When LLM calls a lazy tool without activation:

```json
{
  "error": "tool not available in current session",
  "tool": "compare_profile_schemas",
  "group": "data-governance",
  "hint": "call use_tool_group({ name: \"data-governance\" }) first",
  "activeGroups": ["profiles"]
}
```

When LLM calls `generate_sample_data` with missing fields:

```json
{
  "error": "missing required: tableName",
  "hint": "call use_tool_schema({ name: \"generate_sample_data\" }) to load full schema"
}
```

## Env vars

| Var | Default | Effect |
|---|---|---|
| `DB_LAZY_LOAD_ENABLED` | `false` | `true` = activate lazy-loading. `false` = v3.1 behavior (all tools always listed) |
| `DB_LAZY_DEFAULT_GROUP` | empty | Comma-separated groups to pre-activate at session start (e.g. `query-experience,profiles`) |

## Transport mode

| Mode | Behavior |
|---|---|
| **stdio** | ✅ Uses lazy-loading when enabled. `sessionId='stdio-default'` |
| **MCP SSE** (`/sse`) | ✅ Uses lazy-loading when enabled. `sessionId` = MCP transport session id |
| **Streamable HTTP** (`/mcp`) | ✅ Uses lazy-loading when enabled. `sessionId` = MCP SDK session id |
| **REST API** (`/api/...`) | ❌ Not affected. Same as v3.1 |

Per-session state is isolated — different sessions in the same server process have independent active groups.

## State lifecycle

- Active groups are **in-memory only** (not persisted)
- Each new MCP session starts with default groups (`DB_LAZY_DEFAULT_GROUP` if set, else empty)
- LLM must re-activate groups per session (one round-trip cost)