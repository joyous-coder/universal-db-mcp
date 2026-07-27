# v3.3.1 — Lazy-Loading ListChanged 通知修复

## Server 端 listChanged 通知改善

- **之前**: `use_tool_group` 调 `server.sendToolListChanged()`,但用 try/catch **静默吞掉** 任何错误,运维无法察觉通知发送失败。
- **现在**: catch 块打印 `console.error`,SDK 异常有日志可见。

## Tool description 升级

`use_tool_group` 描述明确告知客户端缓存限制:

> 激活后服务端会按 MCP 协议发 `notifications/tools/list_changed`;**若客户端不消费该通知(已知 Claude Code 当前实现),需要重启客户端或在 MCP 客户端设置中手动刷新**。

`use_tool_schema` 描述明确告知:不影响工具列表,无需刷新。

## 5 个新增 unit tests

`tests/unit/lazy-loading-notification.test.ts`:
- SDK `sendToolListChanged` 真的发出 JSON-RPC `notifications/tools/list_changed` 帧
- SDK capability 声明不抛错
- `ToolRegistry.activateGroup` 行为正确
- `listActiveTools` 反映 per-session 状态
- tool definitions 文案包含 `notifications/tools/list_changed` + `Claude Code` + `重启/刷新`

## 文档澄清

`docs/03-features/lazy-loading.md` 加 **⚠️ Claude Code 客户端限制** 章节:

- 列出 7+ MCP 客户端的 listChanged 支持情况
- 解释 Claude Code 行为根因(客户端缓存 ListTools 到 session 启动)
- 提供 Claude Code 用户的 workaround(`DB_LAZY_DEFAULT_GROUP=query-experience`)
- 推荐用法对照表

## 用户影响

| 客户端 | 行为 |
|---|---|
| **Cline / Continue / Dify / Cherry Studio / 5ire 等** | lazy loading 真的可验证 — 服务端发通知 + 日志可查 |
| **Claude Code** | 行为不变(必须重启 Claude Code 看到新 tool),但 tool description + 文档已告知用户 |
| **所有用户** | 测试覆盖 + 错误日志更可观测 |

## 兼容性

Patch release,无新 API,无 breaking changes。

`npm run test:unit`: **55 test files / 519 tests PASS**(从 514 → 519,+5 新增)