# v3.3.2 — Claude Code 客户端智能默认

## 核心问题

[Anthropic Claude Code MCP 客户端不消费 `notifications/tools/list_changed` 通知](https://github.com/anthropics/claude-code/issues/79826)(已确认 GitHub issues #79826/#78208 是回归)。用户在 Claude Code 下启用 `DB_LAZY_LOAD_ENABLED=true` 时,服务端会发通知,但客户端不刷新,新激活的 tool 永远不可见,必须重启 Claude Code。

## v3.3.2 修复

**服务端智能检测 Claude Code,自动绕过 lazy loading gating** — Claude Code 客户端发起的会话直接进入 v3.1 行为(全部 45 tool 可见),无需客户端重启。

### 实现

- 新增 `InitializeRequestSchema` handler,捕获 `clientInfo.{name,version}`
- 新增 `sessionClientInfo` per-session 状态
- 新增 `isClaudeCodeClientName(name)`:regex `/claude[\s_.\-]+code/i`
- 新增 `shouldSkipLazyLoading()`:per-session 决策
- `ListTools` + `CallTool` handler 增加 `treatAsLazyDisabled` / `effectiveLazyEnabled` 判定

### 用户影响

| 客户端 | v3.3.1 → v3.3.2 |
|---|---|
| **Claude Code** | ✅ 自动全部 45 tool 可见(无需重启,无需手动设 `DB_LAZY_LOAD_ENABLED=false`) |
| Cline / Continue / Dify / Cherry Studio / 5ire | 行为不变 — 真懒加载可用 |
| HTTP / REST API | 行为不变 |

## 兼容性

`use_tool_group` description 更新为说明 Claude Code 自动跳过 lazy loading,其他客户端仍正常用此工具激活新 group。

## 测试

- 33 个新测试 `tests/unit/client-detection.test.ts`:
  - 8 个 Claude Code 已知 clientInfo 名称(可识别)
  - 14 个非 Claude Code 客户端(不误识别)
  - 7 个 lazy loading 行为矩阵
- 修正 v3.3.1 测试用例以匹配 v3.3.2 新 description

`npm run test:unit`: **56 test files / 552 tests PASS**(519 → 552)