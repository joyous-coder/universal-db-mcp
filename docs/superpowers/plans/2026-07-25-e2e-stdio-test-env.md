# E2E Stdio Test Environment — Implementation Plan

> **For agentic workers:** This plan uses **direct MCP tool exercise in the current Claude Code session** (not subagent delegation). Native tool calls (`mcp__universal_db_mcp__*`) drive the e2e test. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Revision history:**
> - v0 (9e6a663): Initial 12-task vitest e2e plan
> - v1 (ff01283): Simplified to 4-task scope using direct native tool exercise
> - v2 (488eeb7 / d27b077): Tool coverage details for L1/L2/L3
> - v3 (2af4256 patches): Bug #5 + #6 found + fixed via L2 manual exercise
> - **v4 (current, 2026-07-25 04:50Z)**: Pivoted away from subagent delegation. **Direct native tool exercise by Claude Code. Container uses `--restart=always` (no `--rm`). Output format: DB×tool matrix table.**

**Goal:** 在 WSL+docker 中,对 universal-db-mcp 17 个 DB × 43 个 tool 做端到端测试,捕获并修复真实使用时的 bug。最终输出 DB×tool 关系表格 + 错误说明。

**Architecture:**
- 当前 Claude Code 会话调用 `mcp__universal_db_mcp__*`(已在 `.mcp.json` 注册 project-scope)
- WSL 跑 docker daemon + CLI(`wsl docker ...`)
- 每个 DB 启容器用 `--restart=always`(必须)— 不加 `--rm`(测试中途容器被 SIGTERM 会断连)
- 容器端口映射 `-p <port>:<port>` 到 Windows `localhost`
- 测试数据每个 DB 用 `execute_query` 自己建表 + 插数据

**Tech Stack:** TypeScript / Node 20+ / vitest / Docker (WSL2) / MCP stdio JSON-RPC

**Execution Architecture:**

```
[ Claude Code (Windows host, MCP client) ]  ← test driver
   ├─ Bash (启动容器 + docker ps/rm)
   ├─ mcp__universal_db_mcp__*  ← stdio JSON-RPC to MCP server
   └─ Read/Write reports
        ↓                       ↓                        ↓
   [ WSL Ubuntu ]           [ MCP server process ]    [ Docker container ]
   ├─ docker daemon          ├─ node dist/index.js     ├─ postgres:16-alpine
   └─ docker run             ├─ 17 adapter types      ├─ -p 5432:5432
                             └─ executeQuery etc.        └─ (--restart=always)
```

**Hard constraints (from spec, verified):**
- **One DB container at a time** — 严格串行,内存不够
- **`--restart=always` + no `--rm`** — 容器中断会丢失 connection,verify 持续 alive
- **WSL** — 仅 `wsl docker ...`;Node/npm/vitest 走 Claude Code 宿主
- **Tests calls drive through MCP server** — 不用 raw stdio(同 path,真实用户体验)
- **Bug fixes per SDD fix-loop** — 每 subagent/sub-task 后 review + fix
- **Bug #7 (pg connection drop)** — deferred,需 postgres adapter 改动
- **Bug #8 (listChanged not consumed)** — Claude Code 限制,not fixable from server side;文档化

---

## Task list

### ✅ P1 重写 plan/spec(直接测试)— in_progress
Plan + spec 更新到 v4。legacy SDD subagent workspace 留作历史。

### P2 postgres 容器 --restart=always
```bash
wsl docker rm -f e2e-pg 2>/dev/null || true
wsl docker run -d --restart=always -p 5432:5432 \
  -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb \
  --name e2e-pg postgres:16-alpine
sleep 4
wsl docker exec e2e-pg pg_isready -U test -d testdb
```
✅ Verify: `accepting connections`

### P3 L2 postgres × 43 tool — 全 table 测试
跑 45+ tool 调用,每调用记录 status。我(Claude)直接调 `mcp__universal_db_mcp__*`。
- 每个 core tool 调一次: connect, disconnect, get_connection_status, execute_query (CREATE/INSERT/UPDATE/SELECT/DELETE), get_schema, get_table_info, clear_cache, get_enum_values, get_sample_data, execute_script, execute_sql_file, execute_batch, execute_template, get_metrics, use_tool_group, use_tool_schema, generate_sample_data, use_profile
- 4 个 lazy group 激活 + 内部 tool 各调一次
- 写记录到 `docs/09-reference/e2e-stdio-report.md` (DB × tool 矩阵)

### P4–P19 L1 其他 16 DB
- sqlite (no docker) — `:memory:`
- mysql / redis / mongodb / clickhouse / sqlserver / oracle / tidb / dm / kingbase / gaussdb / oceanbase / polardb / goldendb / highgo / vastbase
- 流程: stop old → start new (`--restart=always`, no `--rm`) → wait ready → connect (full mode) → CRUD 5 calls + get_schema + get_table_info + disconnect (8 calls) → stop container
- 端口: `-p <port>:<port>` 用 DB 默认端口
- 国产库(dm/kingbase 等)Docker Hub 找不到镜像 → 标 INFRA(skill 该跳就跳)

### P20 report DB×tool 矩阵
写完整 markdown 表格到 `docs/09-reference/e2e-stdio-report.md`:
- 17 DB 列 + 1 Notes 列
- 43 tool 行 × 状态标识 `✅/❌/INFRA/⚠️/skip`
- 每格下方对应错误码 + 简述

### P21 修复期间发现的 bug
SDD fix-loop: failing test → fix → regression → commit

### P22 v3.2.4 release
bump version + CHANGELOG + tag + push + gh release(已发布 v3.2.3)

### P23 收尾
- 停所有容器 + docker rm
- clean orphan .tmp- / .db 文件
- npm test 全套
- finishing-a-development-branch

---

## Appendix: Legacy T1-T12 vitest plan (preserved for record)
