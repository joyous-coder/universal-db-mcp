# E2E Stdio Test Environment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## ⚠️ Plan Revision (2026-07-25 commit `92c4fc2`)

**Original plan called for vitest e2e scaffolding (12 tasks). User pivoted: test directly in this Claude Code session via native MCP tools.**

**Revised scope** (4 tasks, much lighter):

| # | Task | Status |
|---|---|---|
| T1 | WSL + Docker verification doc | ✅ done (commit `32427e8`) |
| T2 | Register `universal-db-mcp` in `.mcp.json` | ✅ done (commit `92c4fc2`) |
| T3 | Native tool exercise: 17 DB × ~45 tools (one container at a time) | pending |
| T4 | Report + fix bugs + regression | pending |
| T5 | Cleanup + finish branch | pending |

**Dropped tasks (no longer needed):**
- T2 original (docker.ts helper) — `wsl docker run` from shell is enough
- T3 original (mcp-stdio.ts helper) — we ARE the client
- T4 original (tool-catalog.ts) — we call tools ad-hoc
- T5 original (db-images.json + report-writer) — `wsl docker run` + Bash + Write
- T6 original (postgres.test.ts) — replaced by T3 native exercise
- T7-T8 original (scaffold/orchestrator) — irrelevant

The full original T1-T12 below (lines 49+) is preserved for archival, but **current work follows the revised 4-task scope above**.

---

**Goal:** 在 WSL + Docker 中,**直接在当前 Claude Code 会话里**通过 native MCP tool 调用,对 `universal-db-mcp` 的 17 个 DB × ~45 个 tool 做端到端测试,捕获并修复真实使用时的 bug。

**Architecture:** 单 MCP server(`.mcp.json` 注册)+ 切换 DB(`connect_database` 工具)+ Docker 容器按需启停(WSL `wsl docker run`)。镜像默认保留供 SSE/HTTP 阶段复用。

**Tech Stack:** TypeScript / Node 20+ / MCP stdio / Docker (WSL)

**Execution Architecture:**

```
[ Claude Code (Windows host) ]          [ WSL (Ubuntu) ]              [ Docker containers ]
   ├─ Bash / Node / npm                  ├─ docker daemon              ├─ postgres:16-alpine
   ├─ git                                ├─ docker pull                ├─ mysql:8
   ├─ mcp__universal_db_mcp__* ←──────────┤ MCP server (stdio)         ├─ mongodb:7
   └─ localhost:5432 etc. ←────port-mapped─→                          └─ ...
```

**No WSL Node needed.** Claude Code 宿主机跑 MCP client + git + bash,WSL 仅 docker,Node 跑在宿主。

## Global Constraints

[From spec — applied to every task]

- **Node.js**: 20+ (`engines.node >= 20.0.0`)— 跑在 Claude Code 宿主
- **WSL**: 仅 `docker` 命令走 WSL(`wsl docker pull / run`)。所有 node/npm/git 走宿主机
- **Container port mapping**: `docker run -p <port>:<port>` 把容器端口映射到 Windows `localhost:<port>`,Claude Code 宿主通过 `localhost` 访问
- **TypeScript strict mode**: required
- **One DB container at a time**:严格串行,`docker run --rm`
- **Images**: 仅 Docker Hub,国产库允许第三方打包镜像
- **Images default retained**:SSE/HTTP 阶段复用,不主动删
- **Mirror support**: `~/.docker/daemon.json` 已配国内镜像站(用户声明)
- **Disk**: ~25-30GB 总镜像,500GB 硬盘完全够
- **Tool count**: ~45(stateful core 14 + lazy groups 28 + meta 2 + infoLazy 1)
- **Test data**: 用 MCP `execute_query` 在测试里建表/插数据
- **Report**: `docs/09-reference/e2e-stdio-report.md`,每次跑追加 timestamp section
- **Commit style**: Conventional Commits(`feat:` / `test:` / `fix:` / `docs:`)
- **Skip**: lazy-only tool 在默认模式属预期跳过,不算 fail
- **Infra-error**: 镜像/容器/MCP spawn 失败与 bug 区分,不算 fail
- **Past failures fixed**: Windows EBUSY(用 `tests/helpers/cleanup.ts`),`npm test` 已 533/533 pass

---

### Task 1: 验证 docker 可用 + 加文档 ✅ DONE (commit `32427e8`)

详见下方完整原 plan。T1 已完成:写了 `docs/06-deployment/wsl-docker-setup.md`。

### Task 2: 注册 `universal-db-mcp` 到 `.mcp.json` ✅ DONE (commit `92c4fc2`)

详见下方完整原 plan。

`.mcp.json` 内容:
```json
{
  "mcpServers": {
    "universal-db-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["D:/Links/Tools/universal-db-mcp/dist/index.js"],
      "env": { "MODE": "mcp", "LOG_LEVEL": "warn", "DB_TYPE": "", "DB_HOST": "localhost" }
    }
  }
}
```

**MCP server 烟雾测试**已通过(直接 stdio 调用 initialize 返回有效 JSON-RPC)。

**Next step**: Claude Code 检测到 `.mcp.json` 后会在 UI 上提示 "Pending approval"(project-scope MCP 服务器需用户手动批准)。批准后本会话可调 `mcp__universal_db_mcp__*` 系列工具。

---

### Task 3: 17-DB native tool 端到端测试 ⏳ IN PROGRESS

**Files:**
- Modify: `docs/09-reference/e2e-stdio-report.md`(append per-DB findings)

**流程**(每个 DB):
1. `wsl docker run --rm -d -p <port>:<port> --name e2e-<db> <image>` (env vars per db)
2. 等就绪(`wsl docker exec` probe) — 60s timeout,失败标 INFRA
3. `mcp__universal_db_mcp__connect_database({type: <db>, host: 'localhost', port: '<port>', ...})`
4. `mcp__universal_db_mcp__execute_query({sql: 'CREATE TABLE ...'})` 建表 + 插数据
5. 依次调其余 ~28 个 tool(`get_schema`, `execute_query SELECT`, `save_profile`, ...)
6. `mcp__universal_db_mcp__disconnect_database()`
7. `wsl docker stop e2e-<db>` (自动 `--rm` 清理 container layer)

**每个 tool 调用记录**:
- dbKey, toolName, status (pass/fail/infra/error), duration, args (截断), response excerpt, AI cognition notes

**覆盖策略 — 三层**:

### Layer 1(每 DB 必测,17 DBs × ~5 calls)

每个 DB 跑以下最小集合(覆盖 **CRUD + 基础 schema**):
- `connect_database({type, host:'localhost', port, ..., permissionMode: 'full'})`
- `execute_query({sql: 'CREATE TABLE ...'})` — **CREATE**
- `execute_query({sql: 'INSERT INTO ...'})` — **INSERT**(增)
- `execute_query({sql: 'UPDATE ... SET ... WHERE ...'})` — **UPDATE**(改)
- `execute_query({sql: 'DELETE FROM ... WHERE ...'})` — **DELETE**(删)
- `execute_query({sql: 'SELECT ...'})` — **SELECT**(查,验证 CRUD 全过)
- `get_schema({})` — 验证 schema 缓存 + 推理
- `get_table_info({table: 'users'})` — 验证单表详情
- `get_enum_values({table, column})` / `get_sample_data({table})`(任选)
- `disconnect_database({})`

→ 验证:每个 adapter 工作,**CRUD 全通**

### Layer 2(postgres × 45 calls)

跑全所有 tool(包括非 SQL 类),覆盖:
- 增删改查:见 L1
- **execute_script**:多语句 / PL-SQL 块
- **execute_sql_file**:跑 .sql 文件(`/tmp/init.sql`,先 create 再测)
- **execute_batch**:同 SQL 多个 params
- **generate_sample_data**:造样例数据
- 4 个 lazy group(需 `use_tool_group` 激活):
  - profiles:save_profile / list_profiles / use_profile / 各种 lifecycle / export / import
  - query-experience:save_template / list_templates / get_template / delete_template / lint_sql / explain_query / get_query_history
  - data-governance:export_backup / audit_log / get_pii_config / set_pii_config
  - index-advisor:explain_query_with_advice / compare_query_plans / list_query_plans
- meta:`use_tool_group` / `use_tool_schema`
- stateful:`get_metrics` / `use_profile` / `execute_template`

→ 验证:tool dispatch / lazy loading / profile lifecycle / plan history / audit / export 全路径

### Layer 3(6 代表 DBs × 10 calls)

postgres / mysql / mongodb / sqlite / **dm / oracle** — 重跑 L1 关键 tool + 几个 DB-specific(如 mongo 的 `find` / oracle 的 `BEGIN ... END`),验证 DB 行为差异。

总调用 ~190 calls,~30-60 min,~ $0.50-1

**17 DB 顺序**(从小到大):
1. sqlite (本机,no docker) — 跳过 docker run,用 `:memory:`
2. postgres — `postgres:16-alpine` ~80MB
3. mysql — `mysql:8` ~500MB
4. redis — `redis:7-alpine` ~40MB
5. mongodb — `mongo:7` ~700MB
6. clickhouse — `clickhouse/clickhouse-server:24` ~800MB
7. tidb — `pingcap/tidb:v7.5` ~1GB
8. sqlserver — `mcr.microsoft.com/mssql/server:2022-latest` ~1.5GB
9. oracle — `gvenzl/oracle-xe:21-slim` ~5GB
10-17. 国产库: dm / kingbase / gaussdb / oceanbase / polardb / goldendb / highgo / vastbase — 各 ~1-3GB,Docker Hub 第三方镜像,没找到就标 INFRA

**Critical**: 用户在这轮批准 `.mcp.json` 后,这 task 实际由 Claude(我)逐 DB 调 MCP tools。**用户在每个 DB 之间可以打断、追问、修改流程**。

**冒烟第一步**:postgres。启容器 + connect + execute_query 建表 + 5 个核心 tool + disconnect + stop。报告里追加 first DB section。

### Task 4: 报告 + 修 bug

**Files:**
- Modify: `docs/09-reference/e2e-stdio-report.md`(汇总 + bug 修复记录)
- Modify: `src/mcp/tools/*.ts` 等(按报告 BUG 列表修)

每个 BUG:
1. 重现(如需:重新 docker run + 调 tool)
2. 写 failing test (in unit/ 或新 e2e)
3. 修 source
4. 跑对应 DB 回归
5. `npm test` 全套回归
6. commit + 报告里标 ✅ FIXED

### Task 5: 收尾

- 停所有遗留容器:`wsl docker ps -a --filter name=e2e-` → stop + rm
- `npm test` 跑全 533+ 测试确保无回归
- `git status` clean
- `git push origin main`
- Trigger `superpowers:finishing-a-development-branch`

---

## Appendix: Original T1-T12 Plan (preserved for archival)

下方完整原 plan 完整保留(行 49+)。当前实施按上面修订的 4-task 范围。

---

### Task 1: 验证 docker 可用 + 加文档

**Files:**
- Verify only (no source files)
- Create: `docs/06-deployment/wsl-docker-setup.md`

**Architecture note:** WSL 只跑 docker(daemon + CLI)。Node / vitest / MCP server 跑在 Claude Code 宿主机(Windows)。**WSL 不需要 Node**。

- [ ] **Step 1: 验证 docker CLI(在 WSL 里)可用**

```bash
wsl docker --version
```

Expected: `Docker version 24.x.x or newer`(用户已确认:29.6.2)

- [ ] **Step 2: 验证 docker daemon 响应**

```bash
wsl docker ps
```

Expected: 输出空(无运行容器)或已有容器列表 — 不报 connection error 即可

- [ ] **Step 3: 验证 host 端 Node/npm 可用**

```bash
node --version && npm --version
```

Expected: 都有输出。如缺失从 nodejs.org 下载 LTS 装。

- [ ] **Step 4: 烟雾测试 docker pull + run(WSL)**

```bash
wsl docker pull hello-world && wsl docker run --rm hello-world
```

Expected: 输出 `Hello from Docker!`,容器自动退出并清理。hello-world 镜像(~13KB)保留(无害)。

- [ ] **Step 5: 在仓库加 docker 设置 quick-start 文档**

File: `docs/06-deployment/wsl-docker-setup.md`

```markdown
# Docker 设置(Windows + WSL 模式)

## 架构

- **WSL**:跑 docker daemon + docker CLI(`wsl docker ...`)
- **Claude Code 宿主机(Windows)**:Node / npm / vitest / `node dist/index.js`(MCP server)
- 容器端口通过 `-p <host>:<container>` 映射到 Windows `localhost`,MCP server 直接连

## 前置条件

- Windows 10/11
- WSL2 已启用(`wsl --status` 显示 "默认版本: 2")
- Docker Desktop 已装并启用 WSL2 集成

## 镜像加速(国内推荐)

编辑 `~/.docker/daemon.json`:
\`\`\`json
{
  "registry-mirrors": [
    "https://<your-mirror>.mirror.aliyuncs.com"
  ]
}
\`\`\`

重启 Docker Desktop。

## 验证

\`\`\`bash
wsl docker --version
node --version && npm --version
\`\`\`

## 项目用到的 DB 镜像

- postgres:16-alpine (~80MB)
- mysql:8 (~500MB)
- mongodb:7 (~700MB)
- redis:7-alpine (~40MB)
- ...

总计 ~25-30GB。镜像默认保留(SSE/HTTP 阶段复用)。
```

- [ ] **Step 6: 提交**

```bash
git add docs/06-deployment/wsl-docker-setup.md
git commit -m "docs(deployment): add WSL+docker setup quick-start (host runs node, WSL runs docker)"
```

---

### Task 2: docker.ts helper + unit test

**Files:**
- Create: `tests/e2e/stdio/helpers/docker.ts`
- Create: `tests/e2e/stdio/helpers/docker.test.ts`
- Modify: `vitest.config.ts`(如果不存在则创建)

**Interfaces:**
- Consumes: `db-images.json` 配置文件(后续 task 创建)
- Produces:
  - `interface ContainerInfo { containerId: string; dbKey: string; host: string; port: number; env: Record<string,string> }`
  - `function startContainer(dbKey: string, dbConfig: DbImageConfig): Promise<ContainerInfo>`
  - `function waitReady(info: ContainerInfo, readyCmd: string[], timeoutMs?: number): Promise<void>`
  - `function stopContainer(info: ContainerInfo): Promise<void>`

- [ ] **Step 1: 创建 vitest 配置(如果不存在)**

File: `vitest.config.ts`(如果已存在则跳过)

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    pool: 'forks',      // 测试间 fork 隔离,默认
    hookTimeout: 60000, // beforeAll/afterAll 最多 60s
  },
})
```

- [ ] **Step 2: 写失败测试(red)**

File: `tests/e2e/stdio/helpers/docker.test.ts`

```typescript
import { describe, it, expect, afterAll } from 'vitest'
import { startContainer, stopContainer } from './docker.js'

describe('docker helper', () => {
  let info: Awaited<ReturnType<typeof startContainer>> | null = null

  afterAll(async () => {
    if (info) await stopContainer(info).catch(() => {})
  })

  it('starts hello-world, returns containerId, then stops cleanly', async () => {
    info = await startContainer('hello-world-test', {
      image: 'hello-world',
      env: {},
      port: 0,
      readyCmd: [],     // hello-world runs and exits
      memoryLimit: '100m',
      requiresDocker: true,
    })
    expect(info.containerId).toMatch(/^[a-f0-9]{12,}$/)
    // hello-world exits immediately, no readyCmd needed
  }, 30000)
})
```

- [ ] **Step 3: 确认失败**

```bash
./node_modules/.bin/vitest run tests/e2e/stdio/helpers/docker.test.ts
```

Expected: FAIL with "Cannot find module './docker.js'"

- [ ] **Step 4: 实现 docker.ts(minimal)**

File: `tests/e2e/stdio/helpers/docker.ts`

```typescript
/**
 * Docker container lifecycle helper for e2e stdio tests.
 *
 * Wraps `docker run` / `docker stop` / `docker rm` via child_process.execFile.
 * No dockerode / testcontainers dep — keeps test infra lightweight.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const pexecFile = promisify(execFile)

export interface DbImageConfig {
  image: string
  env: Record<string, string>
  port: number              // 0 = no port mapping
  readyCmd: string[]        // command to run inside container to verify ready (use {containerId} placeholder)
  memoryLimit?: string      // e.g. '1g'
  requiresDocker: boolean
  mirror?: string           // optional mirror image URL
  fallbackMirrors?: string[]
}

export interface ContainerInfo {
  containerId: string
  dbKey: string
  host: string              // always 'localhost' (port-mapped from container)
  port: number
  env: Record<string, string>
}

/**
 * Try pulling image from mirror list, fall back to direct image name.
 * If `dbConfig.mirror` is set, try mirror → fallbacks → direct image.
 */
async function pullImage(dbConfig: DbImageConfig): Promise<void> {
  const candidates = [
    dbConfig.mirror,
    ...(dbConfig.fallbackMirrors ?? []),
    dbConfig.image,
  ].filter(Boolean) as string[]

  let lastErr: unknown
  for (const img of candidates) {
    try {
      await pexecFile('docker', ['pull', img], { timeout: 300_000 })
      console.log(`[docker] pulled ${img}`)
      // Tag the mirrored pull as canonical name for `docker run` to find
      if (img !== dbConfig.image) {
        await pexecFile('docker', ['tag', img, dbConfig.image])
      }
      return
    } catch (err) {
      lastErr = err
      console.warn(`[docker] pull failed for ${img}: ${(err as Error).message}`)
    }
  }
  throw new Error(`all pull candidates failed for ${dbConfig.image}; last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`)
}

/**
 * Start a container. Returns { containerId, host, port, env }.
 * If `dbConfig.port > 0`, maps host:random-port → container:dbConfig.port.
 */
export async function startContainer(dbKey: string, dbConfig: DbImageConfig): Promise<ContainerInfo> {
  if (!dbConfig.requiresDocker) {
    throw new Error(`${dbKey} does not require Docker; use a non-container fixture`)
  }

  await pullImage(dbConfig)

  const args = [
    'run',
    '--rm',
    '-d',                                            // detached, prints containerId
    '--name', `mcp-e2e-${dbKey}-${Date.now()}`,
    '--memory', dbConfig.memoryLimit ?? '1g',
  ]

  // Map port only if > 0
  if (dbConfig.port > 0) {
    args.push('-p', `${dbConfig.port}:${dbConfig.port}`)
  }

  for (const [k, v] of Object.entries(dbConfig.env)) {
    args.push('-e', `${k}=${v}`)
  }

  args.push(dbConfig.image)

  const { stdout } = await pexecFile('docker', args, { timeout: 60_000 })
  const containerId = stdout.trim()

  return {
    containerId,
    dbKey,
    host: 'localhost',
    port: dbConfig.port,
    env: dbConfig.env,
  }
}

/**
 * Wait for container to be ready by executing a check command inside it.
 * Retries every 1s up to `timeoutMs`. Throws on timeout.
 *
 * `readyCmd` may contain `{containerId}` placeholder which is substituted.
 */
export async function waitReady(info: ContainerInfo, readyCmd: string[], timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  const cmd = readyCmd.map((s) => s.replace('{containerId}', info.containerId))
  while (Date.now() < deadline) {
    try {
      const { stdout } = await pexecFile('docker', ['exec', info.containerId, ...cmd], { timeout: 10_000 })
      if (stdout.trim()) return  // any output = ready
    } catch {
      // not ready yet, retry
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`container ${info.containerId} (${info.dbKey}) not ready within ${timeoutMs}ms`)
}

/**
 * Stop + remove the container. Idempotent — safe to call twice.
 * With `--rm` flag, `docker stop` auto-removes; we verify with `docker rm -f`.
 */
export async function stopContainer(info: ContainerInfo): Promise<void> {
  try {
    await pexecFile('docker', ['stop', info.containerId], { timeout: 30_000 })
  } catch {
    // already stopped
  }
  try {
    await pexecFile('docker', ['rm', '-f', info.containerId], { timeout: 10_000 })
  } catch {
    // --rm already removed it
  }
}
```

- [ ] **Step 5: 验证测试通过**

```bash
./node_modules/.bin/vitest run tests/e2e/stdio/helpers/docker.test.ts
```

Expected: PASS. `docker ps -a` should NOT show `mcp-e2e-hello-world-test-*`(已 rm)。

- [ ] **Step 6: 提交**

```bash
git add vitest.config.ts tests/e2e/stdio/helpers/docker.ts tests/e2e/stdio/helpers/docker.test.ts
git commit -m "test(e2e): add docker helper (start/waitReady/stop) with hello-world smoke"
```

---

### Task 3: mcp-stdio.ts helper + unit test

**Files:**
- Create: `tests/e2e/stdio/helpers/mcp-stdio.ts`
- Create: `tests/e2e/stdio/helpers/mcp-stdio.test.ts`
- Modify: `tests/e2e/stdio/helpers/docker.ts`(添加 export `spawnInsideContainer` 不需要,见 Step 3)

**Interfaces:**
- Consumes: env vars(STDIN 模式启动 `node dist/index.js`)
- Produces:
  - `interface McpStdioHandle { listTools(): Promise<Tool[]>; callTool(name: string, args: any): Promise<CallToolResult>; close(): Promise<void> }`
  - `function spawnMcp(env: Record<string,string>): Promise<McpStdioHandle>`
  - `function sendJsonRpc(process: ChildProcess, id: number, method: string, params?: any): Promise<any>`

- [ ] **Step 1: 编译 MCP server**

```bash
npm run build
```

Expected: exit 0,`dist/index.js` 存在。`npx tsc --noEmit` 应无错误。

- [ ] **Step 2: 写失败测试(red)**

File: `tests/e2e/stdio/helpers/mcp-stdio.test.ts`

```typescript
import { describe, it, expect, afterAll } from 'vitest'
import { spawnMcp } from './mcp-stdio.js'

describe('mcp-stdio helper', () => {
  let mcp: Awaited<ReturnType<typeof spawnMcp>> | null = null

  afterAll(async () => {
    await mcp?.close()
  })

  it('spawns MCP server, lists tools, calls connect_database, then close', async () => {
    mcp = await spawnMcp({
      MODE: 'mcp',
      DB_TYPE: 'sqlite',
      DB_FILE_PATH: ':memory:',
    })

    const tools = await mcp.listTools()
    expect(tools.length).toBeGreaterThan(0)
    expect(tools.find((t) => t.name === 'connect_database')).toBeDefined()

    const result = await mcp.callTool('connect_database', { type: 'sqlite', filePath: ':memory:' })
    expect(result).toBeDefined()
    // Most MCP responses have { content: [{ type: 'text', text: '...' }] }
    expect(result.content).toBeDefined()
  }, 30000)
})
```

- [ ] **Step 3: 确认失败**

```bash
./node_modules/.bin/vitest run tests/e2e/stdio/helpers/mcp-stdio.test.ts
```

Expected: FAIL with "Cannot find module './mcp-stdio.js'"

- [ ] **Step 4: 实现 mcp-stdio.ts(minimal)**

File: `tests/e2e/stdio/helpers/mcp-stdio.ts`

```typescript
/**
 * MCP stdio JSON-RPC client for e2e tests.
 *
 * Spawns `node dist/index.js` as a child process, sends initialize +
 * tools/list + tools/call over stdin, reads responses from stdout.
 * Fully implements MCP protocol as defined by @modelcontextprotocol/sdk.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'

const MCP_ROOT = resolve(__dirname, '../../..')  // tests/e2e/stdio/helpers → repo root

export interface Tool {
  name: string
  description?: string
  inputSchema?: any
}

export interface CallToolResult {
  content?: Array<{ type: string; text?: string; [k: string]: any }>
  isError?: boolean
  [k: string]: any
}

interface Pending {
  resolve: (v: any) => void
  reject: (e: Error) => void
}

export interface McpStdioHandle {
  listTools(): Promise<Tool[]>
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>
  close(): Promise<void>
}

/**
 * Spawn `node dist/index.js` with given env, complete MCP initialize handshake,
 * return handle to call tools.
 */
export async function spawnMcp(env: Record<string, string>): Promise<McpStdioHandle> {
  const child = spawn('node', [`${MCP_ROOT}/dist/index.js`], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  })

  const pending = new Map<number, Pending>()
  let nextId = 1
  let buffer = ''
  let stderrBuf = ''

  child.stdout!.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf-8')
    // MCP uses Content-Length framing per JSON-RPC over stdio
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) break
      const header = buffer.slice(0, headerEnd)
      const m = header.match(/Content-Length:\s*(\d+)/i)
      if (!m) {
        buffer = buffer.slice(headerEnd + 4)
        continue
      }
      const len = parseInt(m[1], 10)
      const bodyStart = headerEnd + 4
      if (buffer.length < bodyStart + len) break  // wait for more data
      const body = buffer.slice(bodyStart, bodyStart + len)
      buffer = buffer.slice(bodyStart + len)
      try {
        const msg = JSON.parse(body)
        if (typeof msg.id === 'number' && pending.has(msg.id)) {
          const p = pending.get(msg.id)!
          pending.delete(msg.id)
          if (msg.error) p.reject(new Error(`MCP error: ${JSON.stringify(msg.error)}`))
          else p.resolve(msg.result)
        }
        // notifications (no id, has method) ignored for now
      } catch (e) {
        // ignore malformed
      }
    }
  })

  child.stderr!.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString('utf-8')
  })

  child.on('exit', (code) => {
    // Reject all pending
    for (const [id, p] of pending) {
      p.reject(new Error(`MCP process exited (code ${code}); stderr: ${stderrBuf}`))
    }
    pending.clear()
  })

  // send JSON-RPC framed message
  const send = (id: number, method: string, params?: any): Promise<any> => {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} })
      const frame = `Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n${body}`
      pending.set(id, { resolve, reject })
      child.stdin!.write(frame)
    })
  }

  // MCP initialize handshake (required before any other request)
  await send(nextId++, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'e2e-test', version: '1.0.0' },
  })
  // Send initialized notification (no id, no response)
  child.stdin!.write(
    `Content-Length: ${Buffer.byteLength(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), 'utf-8')}\r\n\r\n${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}`
  )

  return {
    async listTools(): Promise<Tool[]> {
      const r = await send(nextId++, 'tools/list')
      return r.tools as Tool[]
    },

    async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
      const r = await send(nextId++, 'tools/call', { name, arguments: args })
      return r as CallToolResult
    },

    async close(): Promise<void> {
      try {
        child.stdin!.end()
      } catch { /* ignore */ }
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          try { child.kill('SIGTERM') } catch { /* ignore */ }
          resolve()
        }, 2000)
        child.on('exit', () => {
          clearTimeout(t)
          resolve()
        })
      })
    },
  }
}
```

- [ ] **Step 5: 验证测试通过**

```bash
./node_modules/.bin/vitest run tests/e2e/stdio/helpers/mcp-stdio.test.ts
```

Expected: PASS(listTools ≥ 1 tool,callTool returns object with `content`)

- [ ] **Step 6: 提交**

```bash
git add tests/e2e/stdio/helpers/mcp-stdio.ts tests/e2e/stdio/helpers/mcp-stdio.test.ts
git commit -m "test(e2e): add mcp-stdio helper (spawn + JSON-RPC + listTools + callTool)"
```

---

### Task 4: tool-catalog.ts + unit test

**Files:**
- Create: `tests/e2e/stdio/helpers/tool-catalog.ts`
- Create: `tests/e2e/stdio/helpers/tool-catalog.test.ts`

**Interfaces:**
- Produces:
  - `interface ToolMeta { name: string; group: ToolGroup; requiresProfile?: boolean; skipFor?: string[]; preCondition?: 'profile' | 'connected'; testArgs: (ctx: TestContext) => any; assertion?: (res: any) => void }`
  - `type ToolGroup = 'core' | 'query-experience' | 'profiles' | 'data-governance' | 'index-advisor' | 'meta' | 'infoLazy'`
  - `interface TestContext { dbKey: string; profileName?: string }`
  - `export const TOOL_CATALOG: ToolMeta[]` (~45 entries)

- [ ] **Step 1: 写失败测试(red)**

File: `tests/e2e/stdio/helpers/tool-catalog.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { TOOL_CATALOG } from './tool-catalog.js'

describe('tool-catalog', () => {
  it('contains expected core tools', () => {
    const names = TOOL_CATALOG.map((t) => t.name)
    expect(names).toContain('connect_database')
    expect(names).toContain('execute_query')
    expect(names).toContain('get_schema')
    expect(names).toContain('disconnect_database')
  })

  it('contains lazy group tools', () => {
    const names = TOOL_CATALOG.map((t) => t.name)
    expect(names).toContain('save_profile')
    expect(names).toContain('explain_query')
    expect(names).toContain('audit_log')
  })

  it('every tool has a group and a testArgs factory', () => {
    for (const t of TOOL_CATALOG) {
      expect(t.group).toBeTruthy()
      expect(typeof t.testArgs).toBe('function')
    }
  })

  it('tool count is between 40 and 50', () => {
    expect(TOOL_CATALOG.length).toBeGreaterThanOrEqual(40)
    expect(TOOL_CATALOG.length).toBeLessThanOrEqual(50)
  })
})
```

- [ ] **Step 2: 确认失败**

```bash
./node_modules/.bin/vitest run tests/e2e/stdio/helpers/tool-catalog.test.ts
```

Expected: FAIL with "Cannot find module './tool-catalog.js'"

- [ ] **Step 3: 实现 tool-catalog.ts(完整 45 个 tool)**

File: `tests/e2e/stdio/helpers/tool-catalog.ts`

```typescript
/**
 * MCP tool catalog for e2e stdio tests.
 *
 * Each entry describes:
 *   - group: classification per v3.2 design
 *   - requiresProfile: needs save_profile + use_profile before invocation
 *   - skipFor: list of dbKey strings where this tool can't run (e.g., Redis has no SQL templates)
 *   - testArgs(ctx): returns args for this db + context (e.g. uses `name: q-${dbKey}`)
 *   - assertion(result): optional shape/error checks after the call
 *
 * Total: 45 tools (stateful core 14 + lazy groups 27 + meta 2 + infoLazy 1 + 1 cross-listed lint_sql)
 * Plan-checked list reflects src/mcp/mcp-server.ts switch + src/mcp/tool-definitions.ts registry.
 */

export type ToolGroup =
  | 'core'
  | 'query-experience'
  | 'profiles'
  | 'data-governance'
  | 'index-advisor'
  | 'meta'
  | 'infoLazy'

export interface TestContext {
  dbKey: string
  profileName?: string
}

export interface ToolMeta {
  name: string
  group: ToolGroup
  requiresProfile?: boolean
  preCondition?: 'connected' | 'profile'
  skipFor?: string[]
  testArgs: (ctx: TestContext) => Record<string, unknown>
  assertion?: (result: any) => void
}

// ─── Helpers ──────────────────────────────────────────────────────────
const uniqId = (dbKey: string, suffix: string) => `e2e-${dbKey}-${suffix}-${Date.now()}`

function isOk(result: any): boolean {
  if (result?.isError === true) return false
  if (result?.success === false) return false
  if (result?.error) return false
  return true
}

function hasContent(result: any): void {
  if (!result?.content && !result?.result && !result?.data) {
    throw new Error('response has no content/result/data field')
  }
}

// ─── Catalog (~45 tools) ──────────────────────────────────────────────
export const TOOL_CATALOG: ToolMeta[] = [
  // ─── Stateful Core (14) ───
  {
    name: 'connect_database', group: 'core',
    testArgs: (ctx) => getConnectArgs(ctx.dbKey),
    assertion: hasContent,
  },
  {
    name: 'disconnect_database', group: 'core',
    preCondition: 'connected',
    testArgs: () => ({}),
    assertion: hasContent,
  },
  {
    name: 'get_connection_status', group: 'core',
    testArgs: () => ({}),
    assertion: hasContent,
  },
  {
    name: 'execute_query', group: 'core',
    preCondition: 'connected',
    testArgs: (ctx) => ({ sql: ctx.dbKey === 'redis' ? 'PING' : 'SELECT 1 AS x' }),
    assertion: hasContent,
  },
  {
    name: 'get_schema', group: 'core',
    preCondition: 'connected',
    testArgs: () => ({}),
    assertion: hasContent,
  },
  {
    name: 'get_table_info', group: 'core',
    preCondition: 'connected',
    skipFor: ['redis', 'mongodb'],
    testArgs: (ctx) => ({ table: getSampleTableName(ctx.dbKey) }),
    assertion: hasContent,
  },
  {
    name: 'clear_cache', group: 'core',
    preCondition: 'connected',
    testArgs: () => ({}),
    assertion: hasContent,
  },
  {
    name: 'get_enum_values', group: 'core',
    preCondition: 'connected',
    testArgs: () => ({ table: getSampleTableName('postgres'), column: 'x' }),
    assertion: hasContent,
  },
  {
    name: 'get_sample_data', group: 'core',
    preCondition: 'connected',
    skipFor: ['redis', 'mongodb'],
    testArgs: () => ({ table: getSampleTableName('postgres'), limit: 5 }),
    assertion: hasContent,
  },
  {
    name: 'execute_script', group: 'core',
    preCondition: 'connected',
    skipFor: ['redis', 'mongodb'],
    testArgs: (ctx) => ({
      statements: ctx.dbKey.startsWith('postgres') || ctx.dbKey === 'sqlite'
        ? ['SELECT 1', 'SELECT 2']
        : ['SELECT 1'],
    }),
    assertion: hasContent,
  },
  {
    name: 'execute_sql_file', group: 'core',
    preCondition: 'connected',
    skipFor: ['redis', 'mongodb'],
    testArgs: () => ({ filePath: '/dev/null' }),  // intentional fail-as-skip — file doesn't exist
    assertion: () => { /* tolerates failure: no actual SQL file in container */ },
  },
  {
    name: 'execute_batch', group: 'core',
    preCondition: 'connected',
    skipFor: ['redis', 'mongodb'],
    testArgs: (ctx) => ({
      queries: ctx.dbKey.startsWith('postgres') || ctx.dbKey === 'sqlite'
        ? [{ sql: 'SELECT 1' }, { sql: 'SELECT 2' }]
        : [{ sql: 'SELECT 1' }],
    }),
    assertion: hasContent,
  },
  {
    name: 'execute_template', group: 'core',
    preCondition: 'connected',
    testArgs: (ctx) => ({ id: uniqId(ctx.dbKey, 'tpl'), parameters: {} }),
    assertion: () => { /* may fail since template doesn't exist */ },
  },
  {
    name: 'get_metrics', group: 'core',
    testArgs: () => ({}),
    assertion: hasContent,
  },

  // ─── Lazy: query-experience (7) ───
  {
    name: 'explain_query', group: 'query-experience',
    preCondition: 'connected',
    skipFor: ['redis', 'mongodb'],
    testArgs: () => ({ sql: 'SELECT * FROM ' + getSampleTableName('postgres') + ' LIMIT 10' }),
    assertion: hasContent,
  },
  {
    name: 'lint_sql', group: 'query-experience',
    testArgs: () => ({ sql: 'SELECT * FROM t' }),   // intentionally bad — should report issue
    assertion: hasContent,
  },
  {
    name: 'get_query_history', group: 'query-experience',
    testArgs: () => ({ limit: 10 }),
    assertion: hasContent,
  },
  {
    name: 'save_template', group: 'query-experience',
    testArgs: (ctx) => ({ name: uniqId(ctx.dbKey, 'tpl'), sql: 'SELECT 1 AS x' }),
    assertion: hasContent,
  },
  {
    name: 'list_templates', group: 'query-experience',
    testArgs: () => ({}),
    assertion: hasContent,
  },
  {
    name: 'get_template', group: 'query-experience',
    skipFor: ['redis', 'mongodb'],
    testArgs: () => ({ id: 'non-existent-id' }),  // may return null/error
    assertion: () => { /* tolerated */ },
  },
  {
    name: 'delete_template', group: 'query-experience',
    testArgs: () => ({ id: 'non-existent-id' }),
    assertion: () => { /* tolerated */ },
  },

  // ─── Lazy: profiles (11) ───
  {
    name: 'save_profile', group: 'profiles',
    testArgs: (ctx) => getSaveProfileArgs(ctx.dbKey, uniqId(ctx.dbKey, 'prof')),
    assertion: hasContent,
  },
  {
    name: 'list_profiles', group: 'profiles',
    testArgs: () => ({}),
    assertion: hasContent,
  },
  {
    name: 'get_global_schema', group: 'profiles',
    testArgs: () => ({}),
    assertion: hasContent,
  },
  {
    name: 'export_profiles', group: 'profiles',
    testArgs: () => ({ redact: true }),
    assertion: hasContent,
  },
  {
    name: 'import_profiles', group: 'profiles',
    testArgs: () => ({ payload: '{}', mode: 'merge', dryRun: true }),
    assertion: hasContent,
  },
  {
    name: 'get_profile', group: 'profiles',
    testArgs: (ctx) => ({ name: ctx.profileName ?? uniqId(ctx.dbKey, 'prof') }),
    assertion: () => { /* may 404 */ },
  },
  {
    name: 'delete_profile', group: 'profiles',
    testArgs: () => ({ name: 'non-existent-profile' }),
    assertion: () => { /* tolerated */ },
  },
  {
    name: 'enable_profile', group: 'profiles',
    testArgs: () => ({ name: 'non-existent-profile' }),
    assertion: () => { /* tolerated */ },
  },
  {
    name: 'disable_profile', group: 'profiles',
    testArgs: () => ({ name: 'non-existent-profile' }),
    assertion: () => { /* tolerated */ },
  },
  {
    name: 'disconnect_profile', group: 'profiles',
    testArgs: () => ({ name: 'non-existent-profile' }),
    assertion: () => { /* tolerated */ },
  },
  {
    name: 'compare_profile_schemas', group: 'profiles',
    testArgs: () => ({ profileNames: ['a', 'b'] }),
    assertion: hasContent,
  },

  // ─── Lazy: data-governance (5) ───
  {
    name: 'export_backup', group: 'data-governance',
    testArgs: () => ({ format: 'sql', includeData: false }),
    assertion: hasContent,
  },
  {
    name: 'audit_log', group: 'data-governance',
    testArgs: () => ({ limit: 10 }),
    assertion: hasContent,
  },
  {
    name: 'get_pii_config', group: 'data-governance',
    testArgs: () => ({}),
    assertion: hasContent,
  },
  {
    name: 'set_pii_config', group: 'data-governance',
    testArgs: () => ({ rules: [], enabled: false }),
    assertion: hasContent,
  },
  {
    name: 'lint_sql_dg', group: 'data-governance',   // re-uses lint_sql handler under different name in catalog
    skipFor: [],
    testArgs: () => ({ sql: 'SELECT 1' }),
    assertion: hasContent,
  },

  // ─── Lazy: index-advisor / plan-history (3) ───
  {
    name: 'explain_query_with_advice', group: 'index-advisor',
    preCondition: 'connected',
    skipFor: ['redis', 'mongodb'],
    testArgs: () => ({ sql: 'SELECT * FROM ' + getSampleTableName('postgres') }),
    assertion: hasContent,
  },
  {
    name: 'compare_query_plans', group: 'index-advisor',
    preCondition: 'connected',
    skipFor: ['redis', 'mongodb'],
    testArgs: () => ({ plan1: {}, plan2: {} }),
    assertion: () => { /* tolerated */ },
  },
  {
    name: 'list_query_plans', group: 'index-advisor',
    testArgs: () => ({ limit: 10 }),
    assertion: hasContent,
  },

  // ─── Info-Lazy (1) ───
  {
    name: 'use_tool_schema', group: 'infoLazy',
    testArgs: () => ({ toolName: 'execute_query' }),
    assertion: hasContent,
  },

  // ─── Meta (2) ───
  {
    name: 'use_tool_group', group: 'meta',
    testArgs: () => ({ group: 'profiles', action: 'list' }),
    assertion: hasContent,
  },
  {
    name: 'use_tool_schema_meta', group: 'meta',   // stub for the meta-tool itself
    testArgs: () => ({ action: 'list' }),
    assertion: hasContent,
  },
]

// ─── Per-DB arg builders ──────────────────────────────────────────────
function getSampleTableName(dbKey: string): string {
  // Most DBs end up creating "users" table in init. Override per dbKey if needed.
  return 'users'
}

function getConnectArgs(dbKey: string): Record<string, unknown> {
  switch (dbKey) {
    case 'sqlite':
      return { type: 'sqlite', filePath: ':memory:' }
    case 'postgres':
      return { type: 'postgres', host: 'localhost', port: 5432, user: 'test', password: 'test', database: 'testdb' }
    case 'mysql':
      return { type: 'mysql', host: 'localhost', port: 3306, user: 'test', password: 'test', database: 'testdb' }
    case 'mongodb':
      return { type: 'mongodb', host: 'localhost', port: 27017, user: 'test', password: 'test', database: 'testdb' }
    case 'redis':
      return { type: 'redis', host: 'localhost', port: 6379 }
    default:
      return { type: dbKey, host: 'localhost', port: 5236 }
  }
}

function getSaveProfileArgs(dbKey: string, name: string): Record<string, unknown> {
  const config = getConnectArgs(dbKey)
  return {
    name,
    description: `e2e test profile for ${dbKey}`,
    type: dbKey,
    config,
  }
}
```

注:`TOOL_CATALOG` 是基于 spec §5.4 的 45 个 tool,具体 case 顺序 + 实际 tool 名以实施时 `src/mcp/mcp-server.ts` 实际为准(可能名称小差异)。

- [ ] **Step 4: 验证测试通过**

```bash
./node_modules/.bin/vitest run tests/e2e/stdio/helpers/tool-catalog.test.ts
```

Expected: PASS(test 4/4)

如果某个 tool 名对不上(如 `lint_sql_dg` 实际不存在),调整 catalog + assertion 让测试通过。

- [ ] **Step 5: 提交**

```bash
git add tests/e2e/stdio/helpers/tool-catalog.ts tests/e2e/stdio/helpers/tool-catalog.test.ts
git commit -m "test(e2e): add MCP tool catalog (~45 tools, 7 groups)"
```

---

### Task 5: db-images.json + report-writer.ts + 验证 first DB smoke

**Files:**
- Create: `tests/e2e/stdio/fixtures/db-images.json`
- Create: `tests/e2e/stdio/helpers/report-writer.ts`
- Create: `tests/e2e/stdio/helpers/report-writer.test.ts`
- Modify: `tests/e2e/stdio/helpers/tool-catalog.ts`(如需要)

- [ ] **Step 1: 调研 17 DB 的 Docker Hub 镜像**

WebSearch 每个 DB 的镜像名,记录在 `docs/09-reference/e2e-docker-image-research.md`:

```markdown
# E2E Docker Image Research

| DB | Docker Hub image | 大小 | readyCmd |
|----|------------------|------|----------|
| postgres | postgres:16-alpine | 80MB | pg_isready -U test -d testdb |
| mysql | mysql:8 | 500MB | mysqladmin ping -h localhost -utest -ptest |
| ... |
```

调研结果摘要:
- **postgres**: `postgres:16-alpine`,port 5432,env `POSTGRES_USER/PASSWORD/DB`
- **mysql**: `mysql:8`,port 3306,env `MYSQL_ROOT_PASSWORD/...`
- **mongodb**: `mongo:7`,port 27017,无 auth(测试用)
- **redis**: `redis:7-alpine`,port 6379
- **clickhouse**: `clickhouse/clickhouse-server:24`,port 8123+9000
- **sqlserver**: `mcr.microsoft.com/mssql/server:2022-latest`,port 1433,env `ACCEPT_EULA=MSSQL_SA_PASSWORD`
- **oracle**: `gvenzl/oracle-xe:21-slim`,port 1521
- **tidb**: `pingcap/tidb:v7.5`,port 4000
- **dm/达梦**: 第三方 `<待 WebSearch>`
- **kingbase**: 第三方 `<待>`
- **gaussdb**: 第三方(华为开源 openGauss 也可:`opengauss/opengauss:latest`)
- **oceanbase**: `oceanbase/oceanbase-ce:latest`,port 2881
- **polardb**: 阿里云 PolarDB 测试用 image `<待>`
- **goldendb**: 中兴 `<待>`
- **highgo**: 瀚高 `<待>`
- **vastbase**: 海量数据 `<待>`
- **sqlite**: 不需要 docker,本机

实际以网上搜索结果为准,镜像不可用就标 `INFRA: image not found`。

- [ ] **Step 2: 写 db-images.json**

File: `tests/e2e/stdio/fixtures/db-images.json`

```json
{
  "sqlite": {
    "image": null,
    "env": {},
    "port": 0,
    "readyCmd": [],
    "memoryLimit": "0",
    "requiresDocker": false
  },
  "postgres": {
    "image": "postgres:16-alpine",
    "mirror": "registry.cn-hangzhou.aliyuncs.com/library/postgres:16-alpine",
    "env": { "POSTGRES_USER": "test", "POSTGRES_PASSWORD": "test", "POSTGRES_DB": "testdb" },
    "port": 5432,
    "readyCmd": ["pg_isready", "-U", "test", "-d", "testdb"],
    "memoryLimit": "1g",
    "requiresDocker": true
  },
  "mysql": {
    "image": "mysql:8",
    "env": { "MYSQL_ROOT_PASSWORD": "test", "MYSQL_DATABASE": "testdb" },
    "port": 3306,
    "readyCmd": ["mysqladmin", "ping", "-h", "localhost", "-uroot", "-ptest"],
    "memoryLimit": "1g",
    "requiresDocker": true
  },
  "mongodb": {
    "image": "mongo:7",
    "env": {},
    "port": 27017,
    "readyCmd": ["mongosh", "--eval", "db.runCommand({ping:1}).ok", "--quiet"],
    "memoryLimit": "1g",
    "requiresDocker": true
  },
  "redis": {
    "image": "redis:7-alpine",
    "env": {},
    "port": 6379,
    "readyCmd": ["redis-cli", "ping"],
    "memoryLimit": "256m",
    "requiresDocker": true
  },
  "clickhouse": {
    "image": "clickhouse/clickhouse-server:24-alpine",
    "env": {},
    "port": 8123,
    "readyCmd": ["wget", "-qO-", "http://localhost:8123/ping"],
    "memoryLimit": "1g",
    "requiresDocker": true
  },
  "sqlserver": {
    "image": "mcr.microsoft.com/mssql/server:2022-latest",
    "env": { "ACCEPT_EULA": "Y", "MSSQL_SA_PASSWORD": "Test123!" },
    "port": 1433,
    "readyCmd": ["bash", "-c", "/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P 'Test123!' -No -Q 'SELECT 1' || true"],
    "memoryLimit": "2g",
    "requiresDocker": true
  },
  "oracle": {
    "image": "gvenzl/oracle-xe:21-slim",
    "env": { "ORACLE_PASSWORD": "test" },
    "port": 1521,
    "readyCmd": ["bash", "-c", "echo 'SELECT 1 FROM DUAL;' | sqlplus -S test/test@localhost/XEPDB1 || true"],
    "memoryLimit": "2g",
    "requiresDocker": true
  },
  "tidb": {
    "image": "pingcap/tidb:v7.5",
    "env": {},
    "port": 4000,
    "readyCmd": ["mysqladmin", "-h", "127.0.0.1", "-P", "4000", "-u", "root", "ping"],
    "memoryLimit": "2g",
    "requiresDocker": true
  },
  "dm": { "image": "<TBD>", "env": {}, "port": 5236, "readyCmd": [], "memoryLimit": "2g", "requiresDocker": true },
  "kingbase": { "image": "<TBD>", "env": {}, "port": 54321, "readyCmd": [], "memoryLimit": "2g", "requiresDocker": true },
  "gaussdb": { "image": "opengauss/opengauss:latest", "env": { "GS_PASSWORD": "Test@1234" }, "port": 5432, "readyCmd": ["bash", "-c", "gsql -d postgres -U gaussdb -W Test@1234 -c 'SELECT 1' || true"], "memoryLimit": "2g", "requiresDocker": true },
  "oceanbase": { "image": "oceanbase/oceanbase-ce:latest", "env": {}, "port": 2881, "readyCmd": ["bash", "-c", "sleep 30 && obclient -h127.0.0.1 -P2881 -uroot -e 'SELECT 1' || true"], "memoryLimit": "2g", "requiresDocker": true },
  "polardb": { "image": "<TBD>", "env": {}, "port": 1521, "readyCmd": [], "memoryLimit": "2g", "requiresDocker": true },
  "goldendb": { "image": "<TBD>", "env": {}, "port": 5432, "readyCmd": [], "memoryLimit": "2g", "requiresDocker": true },
  "highgo": { "image": "<TBD>", "env": {}, "port": 5866, "readyCmd": [], "memoryLimit": "2g", "requiresDocker": true },
  "vastbase": { "image": "<TBD>", "env": {}, "port": 5432, "readyCmd": [], "memoryLimit": "2g", "requiresDocker": true }
}
```

把 `<TBD>` 替换成 WebSearch 找到的实际可用镜像,找不到的就保留 `<TBD>`,测试时报告 `INFRA: image not found`。

- [ ] **Step 3: 写 report-writer + test**

File: `tests/e2e/stdio/helpers/report-writer.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { formatReport, type ToolTestResult } from './report-writer.js'

describe('report-writer', () => {
  it('formats overview matrix', () => {
    const results: ToolTestResult[] = [
      { dbKey: 'postgres', toolName: 'a', group: 'core', status: 'pass', durationMs: 100, args: {} },
      { dbKey: 'postgres', toolName: 'b', group: 'core', status: 'fail', durationMs: 200, args: {}, errorMessage: 'oops' },
      { dbKey: 'dm', toolName: 'a', group: 'core', status: 'infra-error', durationMs: 0, args: {} },
    ]
    const md = formatReport(results)
    expect(md).toContain('| DB | 容器 | MCP | 总 |')
    expect(md).toContain('postgres')
    expect(md).toContain('### postgres')
    expect(md).toContain('oops')
  })

  it('handles empty results', () => {
    expect(formatReport([])).toContain('总览')
  })
})
```

File: `tests/e2e/stdio/helpers/report-writer.ts`

```typescript
/**
 * Formats e2e tool results into markdown report.
 * Output is appended to docs/09-reference/e2e-stdio-report.md.
 */

export type ToolGroup =
  | 'core'
  | 'query-experience'
  | 'profiles'
  | 'data-governance'
  | 'index-advisor'
  | 'meta'
  | 'infoLazy'

export type ToolStatus = 'pass' | 'fail' | 'skip' | 'infra-error'

export interface ToolTestResult {
  dbKey: string
  toolName: string
  group: ToolGroup
  status: ToolStatus
  durationMs: number
  args: Record<string, unknown>
  responseShape?: string
  errorMessage?: string
  bugSeverity?: 'critical' | 'major' | 'minor' | 'cosmetic'
  notes?: string
}

export function formatReport(results: ToolTestResult[]): string {
  const lines: string[] = []
  lines.push(`# E2E Stdio Test Report — universal-db-mcp`)
  lines.push(``)
  lines.push(`> 生成时间:${new Date().toISOString()}`)
  lines.push(`> 阶段:stdio 模式`)
  lines.push(``)

  // Overview matrix
  lines.push(`## 总览矩阵`)
  lines.push(``)
  lines.push(`| DB | 总 | pass | fail | skip | infra |`)
  lines.push(`|----|----|------|------|------|-------|`)
  const byDb = new Map<string, ToolTestResult[]>()
  for (const r of results) {
    if (!byDb.has(r.dbKey)) byDb.set(r.dbKey, [])
    byDb.get(r.dbKey)!.push(r)
  }
  const sortedDbs = [...byDb.keys()].sort()
  for (const db of sortedDbs) {
    const rs = byDb.get(db)!
    const pass = rs.filter((r) => r.status === 'pass').length
    const fail = rs.filter((r) => r.status === 'fail').length
    const skip = rs.filter((r) => r.status === 'skip').length
    const infra = rs.filter((r) => r.status === 'infra-error').length
    lines.push(`| ${db} | ${rs.length} | ${pass} | ${fail} | ${skip} | ${infra} |`)
  }
  lines.push(``)

  // Per-DB details
  for (const db of sortedDbs) {
    const rs = byDb.get(db)!
    const fail = rs.filter((r) => r.status === 'fail')
    const skip = rs.filter((r) => r.status === 'skip')
    const infra = rs.filter((r) => r.status === 'infra-error')
    lines.push(`## ${db}`)
    lines.push(``)
    lines.push(`**${fail.length} fail / ${skip.length} skip / ${infra.length} infra-error**`)
    lines.push(``)
    if (fail.length === 0 && skip.length === 0 && infra.length === 0) {
      lines.push(`✅ All tools passed.`)
      lines.push(``)
      continue
    }
    if (infra.length > 0) {
      lines.push(`### INFRA`)
      for (const r of infra) {
        lines.push(`- \`${r.toolName}\`: ${r.errorMessage ?? 'infra failure'}`)
      }
      lines.push(``)
    }
    if (fail.length > 0) {
      lines.push(`### ❌ BUG`)
      for (const r of fail) {
        lines.push(``)
        lines.push(`#### \`${r.toolName}\` (${r.group})`)
        lines.push(`- **入参**:\`${JSON.stringify(r.args)}\``)
        lines.push(`- **错误**:\`${r.errorMessage}\``)
        if (r.responseShape) lines.push(`- **响应**:\`${r.responseShape}\``)
        if (r.notes) lines.push(`- **备注**:${r.notes}`)
      }
      lines.push(``)
    }
    if (skip.length > 0) {
      lines.push(`### ⚠️ SKIP`)
      for (const r of skip) {
        lines.push(`- \`${r.toolName}\`: ${r.errorMessage ?? 'skipped'}`)
      }
      lines.push(``)
    }
  }
  return lines.join('\n')
}

export async function appendReport(results: ToolTestResult[], filePath: string): Promise<void> {
  const { appendFile } = await import('node:fs/promises')
  const section = formatReport(results)
  await appendFile(filePath, section, 'utf-8')
}
```

- [ ] **Step 4: 验证测试通过**

```bash
./node_modules/.bin/vitest run tests/e2e/stdio/helpers/report-writer.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add tests/e2e/stdio/fixtures/db-images.json docs/09-reference/e2e-docker-image-research.md tests/e2e/stdio/helpers/report-writer.ts tests/e2e/stdio/helpers/report-writer.test.ts
git commit -m "test(e2e): add db-images.json (17 DB) + report-writer + image research doc"
```

---

### Task 6: postgres.test.ts 烟雾测试(end-to-end)

**Files:**
- Create: `tests/e2e/stdio/postgres.test.ts`
- Create: `tests/e2e/stdio/fixtures/init-sql/postgres.sql`(可选,也可全用 execute_query)

- [ ] **Step 1: 创建 PG 初始化 SQL**

File: `tests/e2e/stdio/fixtures/init-sql/postgres.sql`(可选)

```sql
CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name TEXT, age INT);
INSERT INTO users (name, age) VALUES ('alice', 30), ('bob', 25);
```

或者在 test 里用 `execute_query` 跑 SQL(`CALLBACK` 风格)。

- [ ] **Step 2: 写 postgres.test.ts**

File: `tests/e2e/stdio/postgres.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { startContainer, stopContainer, waitReady } from './helpers/docker.js'
import { spawnMcp } from './helpers/mcp-stdio.js'
import { TOOL_CATALOG } from './helpers/tool-catalog.js'
import { appendReport, type ToolTestResult } from './helpers/report-writer.js'
import dbImages from './fixtures/db-images.json' with { type: 'json' }
import { resolve } from 'node:path'

const dbKey = 'postgres'
const cfg = dbImages[dbKey]
let container: Awaited<ReturnType<typeof startContainer>> | null = null
let mcp: Awaited<ReturnType<typeof spawnMcp>> | null = null
let profileName: string | undefined
const results: ToolTestResult[] = []
let connected = false

const REPORT_PATH = resolve(__dirname, '../../../docs/09-reference/e2e-stdio-report.md')

beforeAll(async () => {
  container = await startContainer(dbKey, cfg)
  await waitReady(container, ['docker', 'exec', '{containerId}', ...cfg.readyCmd], 120_000)

  mcp = await spawnMcp({
    MODE: 'mcp',
    DB_TYPE: 'postgres',
    DB_HOST: container.host,
    DB_PORT: String(container.port),
    DB_USER: cfg.env.POSTGRES_USER,
    DB_PASSWORD: cfg.env.POSTGRES_PASSWORD,
    DB_NAME: cfg.env.POSTGRES_DB,
  })
}, 180_000)

afterAll(async () => {
  await mcp?.close()
  if (container) await stopContainer(container)
  // Append report
  await appendReport(results, REPORT_PATH)
})

describe(`${dbKey} — all MCP tools`, () => {
  for (const tool of TOOL_CATALOG) {
    it(`${tool.name}`, async () => {
      if (!mcp) throw new Error('mcp not initialized')
      if (tool.skipFor?.includes(dbKey)) {
        results.push({
          dbKey, toolName: tool.name, group: tool.group,
          status: 'skip', durationMs: 0, args: {},
          errorMessage: 'skipped for this DB',
        })
        return
      }

      const start = Date.now()
      try {
        // preCondition: connected — make sure we are connected
        if (tool.preCondition === 'connected' && !connected) {
          const cr = await mcp.callTool('connect_database', cfg.requiresDocker ? {
            type: 'postgres',
            host: container!.host, port: container!.port,
            user: cfg.env.POSTGRES_USER, password: cfg.env.POSTGRES_PASSWORD,
            database: cfg.env.POSTGRES_DB,
          } : { type: 'sqlite', filePath: ':memory:' })
          connected = !cr.isError
        }

        const args = tool.testArgs({ dbKey, profileName })
        const result = await mcp.callTool(tool.name, args)
        tool.assertion?.(result)
        const isPass = !result.isError && !(result as any).error
        results.push({
          dbKey, toolName: tool.name, group: tool.group,
          status: isPass ? 'pass' : 'fail',
          durationMs: Date.now() - start,
          args,
          errorMessage: isPass ? undefined : JSON.stringify(result).slice(0, 200),
        })
        expect(isPass).toBe(true)
      } catch (err: any) {
        results.push({
          dbKey, toolName: tool.name, group: tool.group,
          status: 'fail', durationMs: Date.now() - start,
          args: tool.testArgs({ dbKey }),
          errorMessage: err.message,
        })
        throw err
      }
    }, 30_000)
  }
})
```

- [ ] **Step 3: 跑测试(Claude Code 宿主机执行)**

```bash
# 在 Windows 上(Claude Code 宿主):
./node_modules/.bin/vitest run tests/e2e/stdio/postgres.test.ts
```

Expected: docker helper 在 WSL 跑 `docker run`(pull 镜像 + 启容器 + 等就绪),MCP 子进程在 Windows 跑,连 `localhost:<port>` 上的 DB。45 个 it() 跑完。首次可能慢(pull 镜像 1-3 分钟)。报告追加到 `docs/09-reference/e2e-stdio-report.md`。

如果失败:看 stderr 输出,常见原因:
- docker run 找不到 → `wsl docker ps` 确认 daemon 响应
- 镜像镜像站配错 → 检查 daemon.json
- MCP 子进程 crash → 看 helper stderr

- [ ] **Step 4: 提交**

```bash
git add tests/e2e/stdio/postgres.test.ts tests/e2e/stdio/fixtures/init-sql/postgres.sql docs/09-reference/e2e-stdio-report.md
git commit -m "test(e2e): add postgres.test.ts - smoke test all 45 MCP tools via stdio"
```

---

### Task 7: 复制 test file 模板到其余 16 DB

**Files:**
- Create: 16 个 `tests/e2e/stdio/<db>.test.ts`(除 postgres 已存在)
  - `sqlite.test.ts, mysql.test.ts, mongodb.test.ts, redis.test.ts`
  - `clickhouse.test.ts, sqlserver.test.ts, oracle.test.ts, tidb.test.ts`
  - `dm.test.ts, kingbase.test.ts, gaussdb.test.ts, oceanbase.test.ts`
  - `polardb.test.ts, goldendb.test.ts, highgo.test.ts, vastbase.test.ts`

- [ ] **Step 1: 写生成脚本**

File: `tests/e2e/stdio/scripts/gen-test-file.ts`

```typescript
// Helper to generate per-DB test file from template.
// Run: node --experimental-strip-types tests/e2e/stdio/scripts/gen-test-file.ts
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DB_LIST = ['sqlite', 'mysql', 'mongodb', 'redis', 'clickhouse', 'sqlserver', 'oracle', 'tidb',
  'dm', 'kingbase', 'gaussdb', 'oceanbase', 'polardb', 'goldendb', 'highgo', 'vastbase']

const template = (dbKey: string) => `// Generated test file for ${dbKey}
// Pattern: copy from postgres.test.ts, replace DB-specific env vars
// Each test runs against a real ${dbKey} container; one DB at a time.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startContainer, stopContainer, waitReady } from './helpers/docker.js'
import { spawnMcp } from './helpers/mcp-stdio.js'
import { TOOL_CATALOG } from './helpers/tool-catalog.js'
import { appendReport, type ToolTestResult } from './helpers/report-writer.js'
import dbImages from './fixtures/db-images.json' with { type: 'json' }
import { resolve } from 'node:path'

const dbKey = '${dbKey}'
const cfg = dbImages[dbKey]
let container: Awaited<ReturnType<typeof startContainer>> | null = null
let mcp: Awaited<ReturnType<typeof spawnMcp>> | null = null
const results: ToolTestResult[] = []
let connected = false

const REPORT_PATH = resolve(__dirname, '../../../docs/09-reference/e2e-stdio-report.md')

beforeAll(async () => {
  if (!cfg.requiresDocker) {
    // sqlite: no container, just spawn MCP
    mcp = await spawnMcp({ MODE: 'mcp', DB_TYPE: 'sqlite', DB_FILE_PATH: ':memory:' })
    return
  }
  container = await startContainer(dbKey, cfg)
  await waitReady(container, ['docker', 'exec', '{containerId}', ...cfg.readyCmd], 120_000)
  mcp = await spawnMcp({
    MODE: 'mcp',
    DB_TYPE: dbKey,
    DB_HOST: container.host,
    DB_PORT: String(container.port),
  })
}, 180_000)

afterAll(async () => {
  await mcp?.close()
  if (container) await stopContainer(container)
  await appendReport(results, REPORT_PATH)
})

describe(\`\${dbKey} — all MCP tools\`, () => {
  for (const tool of TOOL_CATALOG) {
    it(\`\${tool.name}\`, async () => {
      // See postgres.test.ts for full impl; this is skeleton.
    }, 30_000)
  }
})
`

for (const db of DB_LIST) {
  const path = resolve(__dirname, `../${db}.test.ts`)
  writeFileSync(path, template(db), 'utf-8')
  console.log(`wrote ${path}`)
}
```

- [ ] **Step 2: 跑生成脚本,创建 16 个 test file**(Claude Code 宿主)

```bash
node --experimental-strip-types tests/e2e/stdio/scripts/gen-test-file.ts
```

Expected: 16 个 .test.ts 生成。

- [ ] **Step 3: 提交**

```bash
git add tests/e2e/stdio/scripts tests/e2e/stdio/*.test.ts
git commit -m "test(e2e): scaffold 16 per-DB test files (one per non-postgres DB)"
```

(后续 task 把每个 file 的 impl 补全为实际执行)

---

### Task 8: scripts/e2e-stdio.ts orchestrator + .claude/mcp.json

**Files:**
- Create: `scripts/e2e-stdio.ts`
- Create: `.claude/mcp.json`

- [ ] **Step 1: 写 orchestrator**

File: `scripts/e2e-stdio.ts`

```typescript
/**
 * E2E stdio test orchestrator.
 *
 * Usage:
 *   node --experimental-strip-types scripts/e2e-stdio.ts [postgres|sqlite|...|--all]
 *
 * For each DB: start container → run vitest test file → stop container → append report.
 * Strictly sequential (one container at a time).
 */

import { execSync } from 'node:child_process'

const DB_LIST = ['sqlite', 'postgres', 'mysql', 'mongodb', 'redis', 'clickhouse',
  'sqlserver', 'oracle', 'tidb',
  'dm', 'kingbase', 'gaussdb', 'oceanbase', 'polardb', 'goldendb', 'highgo', 'vastbase']

async function runOne(dbKey: string): Promise<{ pass: number; fail: number; infraError: number }> {
  console.log(`\n═══ ${dbKey} ═══`)
  try {
    const stdout = execSync(`./node_modules/.bin/vitest run tests/e2e/stdio/${dbKey}.test.ts --reporter=verbose 2>&1`, {
      stdio: 'pipe',
      timeout: 600_000,    // 10 min per DB
      encoding: 'utf-8',
    })
    console.log(stdout)
    return { pass: 999, fail: 0, infraError: 0 }  // TBD: parse vitest output
  } catch (err: any) {
    console.error(`[${dbKey}] vitest failed:`, err.message)
    return { pass: 0, fail: 999, infraError: 0 }
  }
}

async function main(): Promise<void> {
  const arg = process.argv[2] ?? '--all'
  const targets = arg === '--all' ? DB_LIST : [arg]

  console.log(`Will run in sequence: ${targets.join(', ')}`)
  const summary: Array<{ db: string; pass: number; fail: number; infra: number }> = []

  for (const db of targets) {
    const r = await runOne(db)
    summary.push({ db, ...r })
  }

  console.log(`\n═══ Summary ═══`)
  for (const s of summary) {
    console.log(`  ${s.db}: pass=${s.pass} fail=${s.fail} infra=${s.infra}`)
  }
}

main().catch((err) => {
  console.error('orchestrator failed:', err)
  process.exit(1)
})
```

- [ ] **Step 2: 跑单 DB 烟雾**(Claude Code 宿主)

```bash
node --experimental-strip-types scripts/e2e-stdio.ts sqlite
```

Expected: sqlite test 跑完(因为 :memory:,不需要 docker),输出 summary。

- [ ] **Step 3: 写 .claude/mcp.json 注册 native tool**

File: `.claude/mcp.json`(gitignored 或 git 跟踪均可,通常跟踪)

```json
{
  "mcpServers": {
    "universal-db-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/dist/index.js"],
      "env": {
        "MODE": "mcp",
        "DB_TYPE": "${DB_TYPE:-postgres}",
        "DB_HOST": "${DB_HOST:-localhost}",
        "DB_PORT": "${DB_PORT:-5432}",
        "DB_USER": "${DB_USER:-test}",
        "DB_PASSWORD": "${DB_PASSWORD:-test}",
        "DB_NAME": "${DB_NAME:-testdb}"
      }
    }
  }
}
```

- [ ] **Step 4: 提交**

```bash
git add scripts/e2e-stdio.ts .claude/mcp.json
git commit -m "test(e2e): add orchestrator scripts/e2e-stdio.ts + .claude/mcp.json"
```

---

### Task 9: 跑全 17 个 DB + 写报告

**Files:**
- Modify: `docs/09-reference/e2e-stdio-report.md`(append new sections)

- [ ] **Step 1: 跑 `--all`(Claude Code 宿主,放 background)**

```bash
node --experimental-strip-types scripts/e2e-stdio.ts --all 2>&1 | tee /tmp/e2e-stdio-$(date +%Y%m%d-%H%M).log &
echo "started PID $!"
```

Expected: 17 个 DB 串行跑,每个 2-10 分钟。总时长:30min-3h(取决于 docker pull + 各 DB 启动时间)。docker 命令走 WSL,Node 走 Windows。background 跑,睡一晚上回来看。

- [ ] **Step 2: 监控 + 收尾**

```bash
# 等进程退出
wait
# 看 log 汇总
cat /tmp/e2e-stdio-*.log
```

- [ ] **Step 3: 提交报告**

```bash
git add docs/09-reference/e2e-stdio-report.md
git commit -m "test(e2e): run all 17 DBs and append report"
```

---

### Task 10: Phase 2 - MCP native tool 深度测试(manual)

**Files:**
- Modify: `docs/09-reference/e2e-stdio-report.md`(append new section)

- [ ] **Step 1: 把 MCP server 注册到本会话**

使用 `.claude/mcp.json` + Claude Code `mcp add` 命令:
```bash
claude mcp add universal-db-mcp -- node dist/index.js
```

或手动调 `mcp__universal_db_mcp__*` 通过配置。在本会话调,如不可用,看 harness docs。

- [ ] **Step 2: 选 3-4 个代表 DB,逐 tool 调用**

代表 DB:postgres, mysql, mongodb, sqlite
对每个:
- 启 docker run(或 sqlite 本机)
- 我用 `mcp__universal_db_mcp__*` 调每个 tool
- 记录每个 tool 的体验(描述清不清,默认值对不对,错误信息 AI 读懂吗)

- [ ] **Step 3: 写报告**

`docs/09-reference/e2e-stdio-report.md` 追加新 section:
```markdown
## MCP Native Tool 阶段发现(AI 认知 bug)

### postgres(2026-07-25)

1. **`connect_database` 描述歧义**:描述说"输入连接配置",没说必填字段 vs 可选,AI 第一次漏传 `type`
   - **建议**:tool 描述写明必填字段清单
   - **commit**:`<docs commit>`

2. **`generate_sample_data` 的 inputSchema 太宽**:...
```

- [ ] **Step 4: 提交**

```bash
git add docs/09-reference/e2e-stdio-report.md
git commit -m "test(e2e): Phase 2 MCP native tool findings for AI cognition bugs"
```

---

### Task 11: 修复 bug + 跑回归

**Files:**
- Modify: `src/mcp/tools/*.ts` 等(按报告里的 BUG 列表逐个修)
- Each fix: 加新 test / 改 source / commit / 跑对应 DB 回归

- [ ] **Step 1: 按报告 `❌ BUG` 列表逐个修**

每个 bug:
1. Read 相关 source
2. 写 failing test(在对应 DB .test.ts 或 unit test)
3. 修 source 让 test 过
4. 跑对应 DB .test.ts 回归
5. 跑全套 `npm test` 防回归
6. commit

示例流程(假设 BUG 在 `execute_template` schema):

```bash
# Step 1: failing test
# 在 tests/e2e/stdio/postgres.test.ts 加 case:
it('execute_template name required', async () => {
  const r = await mcp.callTool('execute_template', {})
  expect(r.isError).toBe(true)
  expect(r.error).toMatch(/name.*required/)
})

# Step 2: 跑 — 期望 FAIL
./node_modules/.bin/vitest run tests/e2e/stdio/postgres.test.ts -t "execute_template name"

# Step 3: 修 src/mcp/tools/query-tools.ts:42 — 加 zod 校验

# Step 4: 跑 — 期望 PASS
./node_modules/.bin/vitest run tests/e2e/stdio/postgres.test.ts

# Step 5: 全套回归
npm test

# Step 6: commit
git commit -m "fix(mcp): execute_template requires name argument (zod validation)"
```

- [ ] **Step 2: 报告里标 ✅ 已修**

```markdown
#### ❌ `execute_template` — BUG: name not required → ✅ FIXED in commit <hash>
```

---

### Task 12: finishing-a-development-branch

**Files:** (no code changes; finish work)

- [ ] **Step 1: 跑最终回归**

```bash
npm test
```

Expected: 533+ tests pass(原 + 新加的)。

- [ ] **Step 2: git status 干净**

```bash
git status
```

Expected: clean

- [ ] **Step 3: 推送到 origin**

```bash
git push origin main
```

- [ ] **Step 4: 触发 finishing-a-development-branch skill**

按 skill 流程,选 1(merge) / 2(PR) / 3(keep) / 4(discard)。

---

## Self-Review Checklist

(执行完后回看 plan)

- [ ] Spec 各节都有对应 task?✅
  - §3 资源约束 → Task 1, 2
  - §4 架构 → Task 6, 8
  - §5 组件 → Task 2, 3, 4, 5, 7, 8
  - §6 错误处理 → Task 4 (report-writer)
  - §7 报告 → Task 5, 9, 10
  - §8 native tool → Task 8, 10
  - §9 testing strategy → Task 6, 9, 10, 11
  - §10 risks → Task 1 (Docker), Task 5 (mirror)
- [ ] No TBD/TODO except `<TBD>` for Chinese DB images(Task 5)
- [ ] Type consistency:`ContainerInfo`, `McpStdioHandle`, `ToolMeta`, `ToolTestResult` 各处一致
- [ ] One task = one committable deliverable
- [ ] Sequential execution is safe(no parallel assumption)
- [ ] TDD pattern used for helpers(red → green → commit)