# Deferred Items Ledger

**Last updated:** 2026-07-27 (v3.3.2 release — Claude Code listChanged workaround)

This document is the **single source of truth** for items that have been
deferred in past versions. It exists to prevent the same item from being
mentioned in every new spec without ever being delivered.

Each item is in one of three states:

- ✅ **Delivered** — implemented in a specific version (cross-link below).
- 🟡 **Pending** — planned for a specific future version with owner.
- 🔴 **Abandoned** — explicitly NOT going to be delivered, with reason +
  pointer to alternative (if any).

When a new spec is written, the author should:
1. Search this file for related items.
2. Either:
   - Move it to ✅ Delivered if the spec implements it,
   - Or keep the existing state with a new reference to the spec.

---

## Index

| Item | State | Last touched | See |
|---|---|---|---|
| **Claude Code listChanged workaround cleanup (v3.3.2)** | 🟡 pending | 2026-07-27 | [see below](#claude-code-listchanged-client-bug-workaround) |
| Profile 加密 (SQLCipher for profiles.db) | ✅ v2.19 | 2026-07-24 | [v2.19 spec](superpowers/specs/2026-07-24-v2.19-multi-profile-design.md) |
| **SQLCipher for templates.db / history.db** | ✅ v2.20 | 2026-07-24 | [v2.20 spec](superpowers/specs/2026-07-24-v2.20-profile-hardening-design.md) |
| 跨 profile 模板/历史 + groupBy | ✅ v2.19 | 2026-07-24 | [v2.19 spec](superpowers/specs/2026-07-24-v2.19-multi-profile-design.md) |
| **Profile YAML / JSON import/export** | ✅ v2.20 | 2026-07-24 | [v2.20 spec](superpowers/specs/2026-07-24-v2.20-profile-hardening-design.md) |
| **Key rotation** | ✅ v2.20 | 2026-07-24 | [v2.20 spec](superpowers/specs/2026-07-24-v2.20-profile-hardening-design.md) |
| **History FTS5 全文搜索** | ✅ v2.20 | 2026-07-24 | [v2.20 spec](superpowers/specs/2026-07-24-v2.20-profile-hardening-design.md) |
| **Schema diff (multi-profile)** | ✅ v3.0 | 2026-07-24 | [v3.x spec](superpowers/specs/2026-07-24-v3-data-governance-design.md) |
| **SQL dump backup** | ✅ v3.0 | 2026-07-24 | [v3.x spec](superpowers/specs/2026-07-24-v3-data-governance-design.md) |
| **SQL audit log** | ✅ v3.0 | 2026-07-24 | [v3.x spec](superpowers/specs/2026-07-24-v3-data-governance-design.md) |
| **PII dynamic masking** | ✅ v3.0 | 2026-07-24 | [v3.x spec](superpowers/specs/2026-07-24-v3-data-governance-design.md) |
| #41 db-connect skill 文档 (v2.16-v3.x 全量) | 🟡 pending | 2026-07-24 | Task #41 (always-deferred) |
| 索引建议 (EXPLAIN + schema 联动) | ✅ v3.1 | 2026-07-24 | [v3.1 spec](superpowers/specs/2026-07-24-v3.1-index-advisor-design.md) |
| Query plan diff | ✅ v3.1 | 2026-07-24 | [v3.1 spec](superpowers/specs/2026-07-24-v3.1-index-advisor-design.md) |
| OpenTelemetry integration | 🔴 abandoned | 2026-07-24 | YAGNI — Prometheus pull is enough for v2.16+ metrics; OTel adds complexity without onboarding |
| 远程 Prometheus push gateway | 🔴 abandoned | 2026-07-24 | YAGNI — Prometheus scrape is operator's job |
| 指标持久化 (file/Redis backend) | 🔴 abandoned | 2026-07-24 | YAGNI — in-memory + WAL ringbuffer sufficient |
| Admin UI dashboard | 🔴 abandoned | 2026-07-24 | belongs in Grafana / external tool |
| multi-process 指标聚合 | 🔴 abandoned | 2026-07-24 | YAGNI — single-process is the deployment model |
| Custom alert rule | 🔴 abandoned | 2026-07-24 | belongs in Alertmanager / external tool |
| traceId 关联 | 🔴 abandoned | 2026-07-24 | meaningless without OTel; abandoned with OTel |
| EXPLAIN ANALYZE (真实执行) | 🔴 abandoned | 2026-07-24 | safety risk on production DBs — EXPLAIN covers 99% |
| 模板版本控制 | 🔴 abandoned | 2026-07-24 | templates change infrequently; git-commit `templates.db` is enough |
| 模板权限控制 | 🔴 abandoned | 2026-07-24 | OS-level permissions cover this (multi-tenant = use separate DB) |
| Profile 跨 profile JOIN | 🔴 abandoned | 2026-07-24 | distributed JOINs are an anti-pattern for MCP clients; use individual queries + join client-side |
| Profile 跨 profile 事务 (XA / 2PC) | 🔴 abandoned | 2026-07-24 | complex + rarely needed; document as "not supported" |
| 读副本延迟自动检测 | 🔴 abandoned | 2026-07-24 | replicas already have native lag metrics; agent can read them |
| OS keyring 集成 | 🔴 abandoned | 2026-07-24 | cross-platform differences; env var documented enough |

---

## Claude Code listChanged client bug workaround

**Status:** 🟡 pending (workaround in v3.3.2, await upstream fix)

**Anthropic Claude Code MCP 客户端不消费 `notifications/tools/list_changed` 通知。**
当 MCP server 在 session 中激活新 group 后,服务端会按协议发通知,但 Claude Code
不刷新,新激活的 tool 永远不可见,必须重启 Claude Code。

### 上游证据(2026-07-27 实测)

GitHub `anthropics/claude-code` 上多个 open/closed issue 确认:

- [#79826](https://github.com/anthropics/claude-code/issues/79826) — "MCP: tools list is not refreshed on notifications/tools/list_changed (stale tools until session restart)" 🔴 OPEN
- [#78208](https://github.com/anthropics/claude-code/issues/78208) — "MCP notifications/tools/list_changed ignored over Streamable HTTP in 2.1.211 (regression from 2.1.210)" 🔴 OPEN / regression
- [#77314](https://github.com/anthropics/claude-code/issues/77314) — "MCP client does not re-fetch tools/list on notifications/tools/list_changed — new tools unreachable until full session restart" ⚫ CLOSED
- [#79986](https://github.com/anthropics/claude-code/issues/79986) — "Claude Desktop: external stdio MCP tools announced but never dispatched in Chat mode" 🔴 OPEN

本仓库实测复现:用 `.mcp.json` 设置 `DB_LAZY_DEFAULT_GROUP=query-experience` 重启
Claude Code,`use_tool_group({name:'data-governance'})` 立即调 `audit_log({})` 返
回 `No such tool available`。Server 端 `activeGroups` 已更新,但客户端 tool list
冻结。Claude Code 用户 **必须重启** 才能看到新 tool。

### v3.3.2 workaround

服务端智能检测 Claude Code 客户端(`clientInfo.name` 匹配 regex
`/claude[\s_.\-]+code/i`),在 ListTools / CallTool handler 判定该 session 时
**自动跳过 lazy loading gating** —— 等同 v3.1 行为,全部 45 tool 可见,
无需客户端重启。

**实现**:
- `src/mcp/mcp-server.ts`: `InitializeRequest` handler 捕获 `clientInfo`,
  新增 `sessionClientInfo: Map<sessionId, {name, version?}>`,`isClaudeCodeClientName()`,
  `shouldSkipLazyLoading()`,`ListTools` 和 `CallTool` 路径加 `treatAsLazyDisabled` /
  `effectiveLazyEnabled` 判定
- `src/mcp/tool-definitions.ts` + `mcp-server.ts` 同步更新 `use_tool_group` description

**测试**:
- `tests/unit/client-detection.test.ts` — 33 个新测试(8 个 Claude Code 已知
  clientInfo 名称可识别 + 14 个非 Claude Code 客户端不误识别 + 7 个 lazy
  loading 行为矩阵)
- `tests/unit/lazy-loading-notification.test.ts` — 5 个 listChanged 通知发送测试

**用户影响**:

| 客户端 | 行为 |
|---|---|
| **Claude Code** | ✅ 自动全部 45 tool 可见(无需重启,无需手动 env) |
| Cline / Continue / Dify / Cherry Studio / 5ire | 行为不变 — 真懒加载可用 |
| HTTP / REST API | 行为不变 |

### 清理条件 (cleanup criteria)

**当以下任一情况成立时,workaround 应被移除,回到真正的懒加载默认行为**:

1. **Anthropic 修复 Claude Code 客户端** — 关注上面 4 个 issue,直到 `closed + state: completed`。
   重点看 #79826 的处理(看是 #78208 regression 的 fix,还是 2.1.x → 2.2.x
   完整修复)。
2. **Anthropic 正式 release note 提到 listChanged 修复** — Claude Code changelog
   有相关条目。
3. **本仓库决定不再支持 Claude Code 作为 lazy loading 目标** — 比如所有用户
   都迁移到 Cline / Dify 之类真支持 listChanged 的客户端。

### 清理步骤(等条件满足时执行)

1. **删除 v3.3.2 临时逻辑**:
   - `src/mcp/mcp-server.ts` 删除 `InitializeRequest` handler
   - 删除 `sessionClientInfo` / `isClaudeCodeClientName` / `shouldSkipLazyLoading`
   - `ListTools` / `CallTool` 路径移除 `treatAsLazyDisabled` / `effectiveLazyEnabled` 分支
2. **恢复原描述**:
   - `use_tool_group` description 改回 v3.2.x 版本(去掉"Claude Code 自动跳过")
3. **删除对应测试**:
   - `tests/unit/client-detection.test.ts` 整个文件
   - `tests/unit/lazy-loading-notification.test.ts` 删除 Claude Code 相关断言
4. **回退 .mcp.json 默认**:
   - `DB_LAZY_LOAD_ENABLED=true` 用户建议: 重新启用 `DB_LAZY_DEFAULT_GROUP=query-experience`
     opt-in 行为(因为 Claude Code 已能正常响应 listChanged)
5. **更新文档**:
   - `docs/03-features/lazy-loading.md` 删除 ⚠️ Claude Code 限制章节
   - `CHANGELOG.md` 加 vX.Y.Z 条目,标注"revert Claude Code workaround"
6. **关闭本 deferred item**:
   - 在本文件 index 表中把状态改成 ✅ vX.Y.Z

### 检查频率

- **每次 Anthropic Claude Code 发布新版本** — 看 release notes 是否提到
  listChanged fix
- **每月查一次 #79826 状态** — 直到 closed
- **有新 MCP 客户端测试需求时** — 确认本仓库仍然支持 Claude Code 路径

### 不清理的风险

如果 Anthropic 修复 Claude Code listChanged 后 **不清理 workaround**:
- 浪费检测逻辑(CPU 可忽略,主要是代码复杂度)
- Claude Code 用户**永远用不到懒加载节省的 ~1.7k token**(因为我们强制全开)
- Bug #8 注释永远不正确(写"Claude Code 不响应",但实际已响应)
- 客户端行为被本仓库覆盖,长期看是技术债

### 相关链接

- 仓库 PR/commit 引用:
  - `feat(v3.3.2): Claude Code 客户端智能 lazy loading 默认` (commit `3c390e3`)
- 上游 issue:
  - https://github.com/anthropics/claude-code/issues/79826
  - https://github.com/anthropics/claude-code/issues/78208
  - https://github.com/anthropics/claude-code/issues/77314
  - https://github.com/anthropics/claude-code/issues/79986

---

## Versioned summary

### v2.16 (2026-07-24)

- ✅ 7 items delivered (Prometheus metrics, slow query ring, MCP `get_metrics`, HTTP `/metrics`, `/api/health` extension, multi-backend SQLite, etc.)
- 🔴 9 items explicitly abandoned (OTel, push gateway, alert rules, etc.) — see above.

### v2.17 (2026-07-24)

- ✅ 4 items delivered (Explain Plan, SQL Lint, query history, parameterized templates)
- 🔴 3 items abandoned in this round: EXPLAIN ANALYZE, 模板版本化, 模板权限.

### v2.18 (2026-07-24)

- ✅ Multi-DB profile management + read/write routing + global schema view
- 🔴 4 items moved to v2.19+: SQLCipher profiles.db (done v2.19), 跨 profile JOIN, 跨 profile 事务, 读副本延迟检测.
- 🟡 Profile import/export (planned v2.18, deferred to v2.20 — done).

### v2.19 (2026-07-24)

- ✅ Profile 加密 + 跨 profile 模板/历史 + groupBy='profile' aggregate
- 🟡 4 items moved to v2.20 — all delivered in v2.20.0.

### v2.20 (2026-07-24) — this release

- ✅ 4 items delivered: SQLCipher tpl/hist, Profile YAML import/export, Key rotation, History FTS5
- 🟡 #41 db-connect skill doc — still pending
- 🟡 索引建议 / Query plan diff — bumped from v2.17/19 to v3.x

---

## How to add a new deferred item

When you find yourself writing "留待 v2.X+ 做" in a spec, **add an entry here
instead**. If you don't, the same item will crop up in every new spec and never
get delivered.

Format:

```markdown
| Item short name | 🟡 v2.X | YYYY-MM-DD | spec-link |
```

When you start the work in v2.X:

- Change state to ✅ v2.X
- Cross-link to the spec that delivered it
