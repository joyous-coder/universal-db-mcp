# E2E Stdio Test Environment — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to create the implementation plan after approval.

**Date:** 2026-07-25
**Status:** Draft (brainstorming output)
**Phase:** stdio only (SSE + HTTP API deferred to separate specs)

## 1. Goal & Motivation

**Goal:** 在 WSL + Docker 中,对 `universal-db-mcp` 的 **stdio mode** 做端到端测试,捕获真实使用时会遇到的 bug,在用户碰到之前修掉。

**Why now:** v3.2.1 发布了 31 个 route-able MCP tool + 14 个 stateful core tool,代码复杂度上升。现有 15 个 vitest integration test 只用 `server.inject()` (HTTP mode),没有覆盖真实 Claude Desktop 通过 stdio JSON-RPC 调用 MCP server 的路径,也没有覆盖所有 17 个 DB 类型。

**Success criteria:**
- 17 个 DB 类型 × ~45 个 tool 的 e2e 烟雾测试全跑通(或明确标记 SKIP/INFRA 原因)
- 找出并修复至少 N 个真实 bug(N ≥ 5,目标 ≥ 10)
- 报告沉淀到 `docs/09-reference/e2e-stdio-report.md`
- 测试基础设施代码 commit 进 repo,后续 SSE + HTTP API 阶段可复用

## 2. Scope

### 2.1 In Scope
- **stdio mode** MCP server(子进程 + stdio JSON-RPC)
- **17 个 DB 类型** 全覆盖(SQLite + 16 个 RDBMS/NoSQL)
- **~45 个 MCP tool** 全覆盖(stateful core + lazy groups + meta + infoLazy)
- **WSL2 + Docker Hub**(所有镜像从 Docker Hub 拉,国产库允许第三方打包镜像)
- **vitest e2e + MCP native tool 驱动** 两阶段

### 2.2 Out of Scope (deferred)
- SSE mode 测试 → 后续独立 spec
- HTTP REST API 测试 → 后续独立 spec
- 真实 Claude Desktop UI 集成测试
- 性能压测(benchmark/load testing)
- CI 集成(Docker-in-Docker 兼容性,等基础设施稳定后再考虑)

## 3. Resource Constraints (hard limits)

| 约束 | 决定 | 原因 |
|---|---|---|
| **同时运行容器数** | **1 个**(严格) | 用户内存不够 |
| **同时测试 DB 数** | **1 个** | 一个跑完 → 拆 → 下个 |
| **镜像源** | **仅 Docker Hub** | 国产库用第三方打包镜像 |
| **国内网络** | **使用 Docker Hub 镜像站**(可选,见 §3.1) | 国内拉 docker hub 慢/超时 |
| **镜像总占用** | ~25-30GB(占 500GB 约 5-6%) | 完全够 |
| **镜像保留** | **默认保留**(不删)| SSE + HTTP API 阶段还要复用,删了重新拉浪费 |
| **容器清理** | `docker run --rm`(退出即删容器 layer)| 不留垃圾,但镜像保留 |
| **预拉策略** | 按需拉,跑哪个 DB 才拉哪个 | 避免一次性下载 |
| **DB 顺序** | 用户/脚本指定,默认从小的开始(sqlite → postgres → ...) | 大库(Oracle/OceanBase)放最后 |
| **WSL2 docker 存储** | 默认 vhdx 256GB(动态扩) | 完全够 |

### 3.1 Docker Hub 镜像站(国内加速)

国内拉 Docker Hub 经常超时/慢。fixture `db-images.json` 支持 `mirror` 字段:

```json
{
  "postgres": {
    "image": "postgres:16-alpine",
    "mirror": "registry.cn-hangzhou.aliyuncs.com/library/postgres:16-alpine",
    "fallbackMirrors": [
      "docker.m.daocloud.io/library/postgres:16-alpine",
      "hub-mirror.corp.example.com/library/postgres:16-alpine"
    ]
  }
}
```

`docker.ts` 拉取策略:
1. `docker pull <mirror>`(默认)
2. 失败 → 依次尝试 `fallbackMirrors[]`
3. 全部失败 → `docker pull <image>` 直连 docker hub
4. 全部失败 → 报告 `INFRA: image not found in any mirror`

**实现要点**:
- `~/.docker/daemon.json` 配 mirror(WSL 已配置,见 §3.2)
- daemon.json 是全局的,`docker pull postgres` 自动走 mirror
- fixture 里的 `mirror` 字段是 daemon.json 未配置时的手动 fallback

### 3.2 WSL Docker 状态(用户已配置)

- ✅ WSL2 已装好 docker daemon
- ✅ Docker 客户端命令在 WSL 可用
- ✅ daemon.json 已配置国内镜像站(用户声明)
- 此 spec **不包含** Docker 安装/配置任务,假设环境就绪

## 4. Architecture

### 4.1 Two-Phase Approach

```
┌────────────────────────────────────────────────────────┐
│ Phase 1: vitest e2e (broad sweep)                      │
│   • 17 个 DB × ~45 tool = ~765 case 自动跑              │
│   • 捕获:连接失败、参数错、崩服务、schema 不符         │
│   • 输出:per-DB JSON + 汇总 markdown                   │
└────────────────────────────────────────────────────────┘
                          ↓
┌────────────────────────────────────────────────────────┐
│ Phase 2: MCP native tool (depth + AI cognition)        │
│   • 把 MCP server 注册到本 Claude 会话                  │
│   • 我用 mcp__universal_db_mcp__* 调 tool               │
│   • 选 3-4 个代表 DB(postgres/mysql/mongodb/sqlite)     │
│   • 捕获:tool 描述歧义、默认参数缺失、错误信息 AI 难读│
└────────────────────────────────────────────────────────┘
                          ↓
┌────────────────────────────────────────────────────────┐
│ Phase 3: 沉淀 + 修复                                     │
│   • docs/09-reference/e2e-stdio-report.md               │
│   • 每个失败点:DB/tool/输入/输出/根因/修复 commit       │
└────────────────────────────────────────────────────────┘
```

### 4.2 Per-DB Execution Flow (strict serial)

```
scripts/e2e-stdio.ts postgres
  ↓
[docker pull postgres:16-alpine]   ← 若未拉
  ↓
docker run --rm -d postgres:16-alpine [env...]
  ↓ wait ready (pg_isready, 60s timeout)
  ↓
node dist/index.js   ← stdio subprocess (env: DB_HOST=...)
  ↓ JSON-RPC initialize
  ↓
vitest tests/e2e/stdio/postgres.test.ts
  ↓ 45 个 it() 串行(vitest 默认单 file 串行)
  ↓ 每个 it:tools/list 缓存 + tools/call + assert
  ↓
MCP subprocess.close()
docker stop <id>
docker wait <id>     ← 等彻底退出
  ↓
exit 0 / non-zero
```

**`--all` 模式**:
```typescript
for (const dbKey of ALL_DBS) {   // 严格串行,永不并行
  await runOne(dbKey)
}
```

## 5. Component Breakdown

### 5.1 Files to Create

```
tests/e2e/stdio/
├── helpers/
│   ├── docker.ts          # 容器生命周期(start/waitReady/stop+rm)
│   ├── mcp-stdio.ts       # spawn node dist/index.js + JSON-RPC 客户端
│   ├── tool-catalog.ts    # ~45 tool 的元数据(name/group/requiresProfile/testArgs)
│   └── report-writer.ts   # 写 docs/09-reference/e2e-stdio-report.md
├── fixtures/
│   └── db-images.json     # 17 DB 镜像元数据(image/env/port/readyCmd/memoryLimit)
├── postgres.test.ts       # 17 个 per-DB test file
├── mysql.test.ts
├── mongodb.test.ts
├── redis.test.ts
├── sqlite.test.ts         # 不启容器,本机模式
├── dm.test.ts             # 达梦 - Docker Hub 第三方镜像
├── kingbase.test.ts       # 人大金仓
├── gaussdb.test.ts        # 华为高斯
├── oceanbase.test.ts      # 蚂蚁金服 OceanBase CE
├── polardb.test.ts        # 阿里 PolarDB
├── goldendb.test.ts       # 中兴 GoldenDB
├── highgo.test.ts         # 瀚高
├── vastbase.test.ts       # 海量数据
├── tidb.test.ts           # PingCAP
├── clickhouse.test.ts
├── sqlserver.test.ts
└── oracle.test.ts

scripts/
└── e2e-stdio.ts           # CLI orchestrator: node scripts/e2e-stdio.ts [db-name|--all]

.claude/
└── mcp.json               # 注册本会话用 universal-db-mcp 子进程
```

### 5.2 Helper Interfaces

```typescript
// docker.ts
export interface ContainerInfo {
  containerId: string
  port: number
  env: Record<string, string>
  dbKey: string
}
export async function startContainer(dbKey: string): Promise<ContainerInfo>
export async function waitReady(info: ContainerInfo, timeoutMs?: number): Promise<void>
export async function stopContainer(info: ContainerInfo): Promise<void>   // stop + wait + rm

// mcp-stdio.ts
export interface McpStdioHandle {
  listTools(): Promise<Tool[]>
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>
  close(): Promise<void>
}
export async function spawnMcp(env: Record<string, string>): Promise<McpStdioHandle>

// tool-catalog.ts
export interface ToolMeta {
  name: string
  group: 'core' | 'query-experience' | 'profiles' | 'data-governance' | 'index-advisor' | 'meta' | 'infoLazy'
  requiresProfile: boolean
  testArgs: Record<string, unknown>      // 默认测试入参
  preCondition?: string                  // e.g. 'save_profile' 之前
  assertion?: (response: any) => void    // vitest assertion
}
export const TOOL_CATALOG: ToolMeta[]
```

### 5.3 Fixture Shape (`db-images.json`)

```json
{
  "postgres": {
    "image": "postgres:16-alpine",
    "env": { "POSTGRES_USER": "test", "POSTGRES_PASSWORD": "test", "POSTGRES_DB": "testdb" },
    "port": 5432,
    "readyCmd": ["docker", "exec", "{containerId}", "pg_isready", "-U", "test"],
    "memoryLimit": "1g",
    "requiresDocker": true
  },
  "sqlite": {
    "image": null,
    "requiresDocker": false,
    "localPath": ":memory:"
  },
  "dm": {
    "image": "<待调研:达梦 Docker Hub 第三方镜像>",
    "env": { "SYSDBA_PWD": "test" },
    "port": 5236,
    "readyCmd": ["docker", "exec", "{containerId}", "disql", "-h", "localhost", "-p", "5236"],
    "memoryLimit": "2g",
    "requiresDocker": true
  },
  // ... 其余 14 个
}
```

### 5.4 Tool Catalog (45 tools, categories)

**Stateful Core (14, always-on, tested via switch case):**
connect_database, disconnect_database, get_connection_status, execute_query,
get_schema, get_table_info, clear_cache, get_enum_values, get_sample_data,
execute_script, execute_sql_file, execute_batch, execute_template, get_metrics

**Lazy: query-experience (7):**
explain_query, lint_sql, get_query_history, save_template, list_templates,
get_template, delete_template

**Lazy: profiles (11):**
save_profile, list_profiles, get_global_schema, export_profiles, import_profiles,
get_profile, delete_profile, enable_profile, disable_profile, disconnect_profile,
compare_profile_schemas

**Lazy: data-governance (5):**
export_backup, audit_log, get_pii_config, set_pii_config, lint_sql (cross-listed)

**Lazy: index-advisor / plan-history (3):**
explain_query_with_advice, compare_query_plans, list_query_plans

**Info-Lazy (1):**
generate_sample_data (light schema by default)

**Meta (2):**
use_tool_group, use_tool_schema

**Stateful Lazy (kept in switch per v3.2 design):**
use_profile, execute_template, get_metrics

(总数 ≈ 43-45,具体数在实施时 tool-catalog.ts 落实)

## 6. Error Handling

### 6.1 Failure Classification

| 类型 | 谁处理 | 报告标签 |
|---|---|---|
| 镜像拉取失败 | docker.ts try/catch | `INFRA: image not found` |
| 容器启动失败 | docker.ts try/catch + exit code | `INFRA: container died` |
| 容器就绪超时(60s) | docker.ts timeout + cleanup | `INFRA: not ready in 60s` |
| MCP 子进程 spawn 失败 | mcp-stdio.ts try/catch | `INFRA: spawn failed` |
| MCP initialize 失败 | mcp-stdio.ts JSON-RPC error | `INFRA: protocol error` |
| Tool 调用出错 | 测试用例捕获 | `BUG: <error>` |
| 响应 shape 不对 | vitest assertion | `BUG: schema mismatch` |
| 响应慢(>10s) | mcp-stdio.ts 计时 | `PERF: 8.2s` |
| 容器泄漏 | afterAll finally + 日志 | `LEAK` |

### 6.2 Tool Test Result Structure

```typescript
interface ToolTestResult {
  dbKey: string
  toolName: string
  group: 'core' | 'profiles' | 'query-experience' | 'data-governance' | 'index-advisor' | 'meta' | 'infoLazy'
  status: 'pass' | 'fail' | 'skip' | 'infra-error'
  durationMs: number
  args: Record<string, unknown>
  responseShape?: string
  errorMessage?: string
  bugSeverity?: 'critical' | 'major' | 'minor' | 'cosmetic'
  notes?: string
}
```

## 7. Report Format

`docs/09-reference/e2e-stdio-report.md`:

```markdown
# E2E Stdio Test Report — universal-db-mcp

> 生成时间:2026-07-25  
> 阶段:stdio 模式  
> 总览:17 DB × 45 tool = ~765 case

## 总览矩阵

| DB | 容器 | MCP | 总 | pass | fail | skip | infra |
|----|------|-----|----|------|------|------|-------|
| postgres | ✅ | ✅ | 45 | 42 | 2 | 1 | 0 |
| dm | ❌ 镜像 | — | 0 | 0 | 0 | 0 | 1 |
| ... |

## 失败明细(per DB)

### postgres — 2 fail / 1 skip

#### ❌ `execute_template` — BUG: schema mismatch
- **入参**:`{name: 'q1', template: 'SELECT * FROM {{table}}'}`
- **实际**:返回 `{ok: false, error: 'template not found'}`
- **根因**:`src/mcp/tools/templates.ts:42` — `args.name` 没从 zod 校验
- **commit**:`<fix hash>`

#### ⚠️ `audit_log` — SKIP: requires DB_LAZY_LOAD_ENABLED=true
- 测试需要启 lazy mode 才挂载

## MCP native tool 阶段发现(AI 认知 bug)

### 1. `connect_database` 描述歧义
- 描述说"输入连接配置",没说必填字段 vs 可选,AI 第一次漏传 `type`
- **建议**:tool 描述写明必填字段清单
- **commit**:`<docs commit>`
```

**关键决策**:
- per-DB 串行(已确认)
- 失败也写报告(不阻断)
- `skip` 不算 fail(如 lazy-only tool 在默认模式跳过是预期)
- `infra-error` 单独统计(区分"测不了"vs"测了没过")
- 报告 commit 进 repo(每次跑追加 timestamp section)

## 8. .claude/mcp.json (Native Tool Mode)

```json
{
  "mcpServers": {
    "universal-db-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/dist/index.js"],
      "env": {
        "MODE": "mcp",
        "DB_TYPE": "postgres",
        "DB_HOST": "localhost",
        "DB_PORT": "5432",
        ...
      }
    }
  }
}
```

注册后,本会话可调 `mcp__universal_db_mcp__*` 系列 tool。

## 9. Testing Strategy

### 9.1 Test Phases

1. **Phase 1 烟雾**(`scripts/e2e-stdio.ts postgres`):
   - 跑单 DB,验证基础设施能工作
   - 调试 helper bug,确认报告格式
2. **Phase 1 广覆盖**(`scripts/e2e-stdio.ts --all`):
   - 串行跑全部 17 个 DB
   - 报告里标 INFRA vs BUG
3. **Phase 2 native tool**:
   - 注册 MCP server,选 3-4 个代表 DB,我手动调
   - 补充 AI 认知类 bug 到报告
4. **Phase 3 修复**:
   - 按报告里的 BUG 列表逐个修
   - 修一个跑一次对应 DB 的回归

### 9.2 Per-Test Pattern

```typescript
// postgres.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startContainer, waitReady, stopContainer } from './helpers/docker.js'
import { spawnMcp } from './helpers/mcp-stdio.js'
import { TOOL_CATALOG } from './helpers/tool-catalog.js'

let container, mcp

beforeAll(async () => {
  container = await startContainer('postgres')
  await waitReady(container)
  mcp = await spawnMcp({ DB_TYPE: 'postgres', DB_HOST: 'localhost', DB_PORT: String(container.port), ... })
})

afterAll(async () => {
  await mcp?.close()
  await stopContainer(container)
})

describe('postgres — all MCP tools', () => {
  for (const tool of TOOL_CATALOG) {
    it(`${tool.name}`, async () => {
      if (tool.skipFor?.includes('postgres')) return  // skip with reason
      const result = await mcp.callTool(tool.name, tool.testArgs)
      tool.assertion?.(result)
    }, 30000)
  }
})
```

## 10. Risks & Mitigations

| 风险 | 缓解 |
|---|---|
| 国产库镜像找不到(Docker Hub 没第三方) | 单 DB 标 `INFRA: image not found`,不影响其他 DB |
| 大库(OceanBase/Oracle) 内存吃紧 | `--memory=2g` 硬上限 + 顺序排最后 |
| 镜像 pull 超时(国内网络慢) | 重试 3 次 + 给镜像标注 source 注释 |
| MCP server 在某些 DB 下启动失败 | INFRA 标签 + skip 后续 test,不假阳性 |
| vitest + docker 协调 bug 漏掉清理 | afterAll 用 try/finally + 独立 `docker ps -a` 清理脚本 |
| 用户跑测试时环境被破坏(profiles.db 等) | tests 用 `.tmp-*` 路径(已有 cleanup helper) |

## 11. Out of Scope for This Spec

- SSE mode 测试 → `docs/superpowers/specs/2026-07-25-e2e-sse-test-env-design.md`(待)
- HTTP REST API 测试 → `docs/superpowers/specs/2026-07-25-e2e-http-api-test-env-design.md`(待)
- 镜像调研清单(17 DB 各自的 Docker Hub 镜像名) → 在 implementation plan 里以 task 落实
- tool-catalog.ts 里 45 个 tool 的 testArgs 细节 → 在 implementation plan 里以 task 落实

## 12. Open Questions

None — 关键决策已与用户确认:
- ✅ stdio only(SSE/HTTP 后续)
- ✅ 17 DB 全覆盖
- ✅ 一个容器一个 DB,严格串行
- ✅ 所有镜像从 Docker Hub(国产库用第三方)
- ✅ vitest e2e + MCP native tool 两阶段
- ✅ 数据用 MCP 自己建,无独立 fixture SQL
- ✅ 全 45 tool 调用一遍
- ✅ 报告沉淀到 `docs/09-reference/e2e-stdio-report.md`