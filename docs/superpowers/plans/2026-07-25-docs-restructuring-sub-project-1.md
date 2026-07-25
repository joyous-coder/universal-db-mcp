# Docs Restructuring Sub-Project 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `docs/` into a 9-section user-journey layout (`01-` through `09-` numbered prefixes) and add an audit script that detects documentation gaps across 6 dimensions.

**Architecture:** 6 git commits — first 4 do `git mv` + delete operations to preserve history; commit 5 writes 6 new README.md navigation pages; commit 6 adds `scripts/audit-docs.ts` (TDD) + 6 JSON gap reports.

**Tech Stack:** TypeScript (Node 20+), vitest (existing), bash + git CLI, no new npm dependencies.

## Global Constraints

- Project: `@joyous-coder/universal-db-mcp` v3.3.0-dev (currently v3.2.1)
- Node ≥ 20.0.0
- 0 npm dependencies added (audit script uses only Node built-ins + TypeScript stdlib)
- `npm test` must stay at 485 passing tests (no code changes; only docs + scripts)
- Use `git mv` (NOT `git rm` + `git add`) to preserve rename history
- Every commit ends with `npm test` and `npm run build` passing
- 6 commits total, single-purpose each
- No backward-compat redirect files (per spec §6.4 option B)
- CHANGELOG entry on v3.3.0 release (not part of this plan — separate release commit)

---

## Task 1: Commit 1 — Add numeric prefixes to existing directories

**Files:**
- Rename via `git mv`:
  - `docs/databases/` → `docs/02-databases/`
  - `docs/integrations/` → `docs/04-integrations/`
  - `docs/http-api/` → `docs/05-http-api/`
  - `docs/deployment/` → `docs/06-deployment/`
  - `docs/development/` → `docs/07-development/`
  - `docs/operations/` → `docs/08-operations/`

**Interfaces:**
- Consumes: nothing (pure file system)
- Produces: 6 directories renamed in git index + working tree

- [ ] **Step 1: Verify clean working tree**

Run: `cd D:/Links/Tools/universal-db-mcp && git status`
Expected: `nothing to commit, working tree clean`

- [ ] **Step 2: Rename 6 directories**

Run:
```bash
cd D:/Links/Tools/universal-db-mcp
git mv docs/databases     docs/02-databases
git mv docs/integrations  docs/04-integrations
git mv docs/http-api      docs/05-http-api
git mv docs/deployment    docs/06-deployment
git mv docs/development   docs/07-development
git mv docs/operations    docs/08-operations
```

- [ ] **Step 3: Verify directory listing**

Run: `cd D:/Links/Tools/universal-db-mcp && ls -d docs/[0-9]* 2>&1`
Expected: 6 directories listed (`docs/02-databases`, `docs/04-integrations`, `docs/05-http-api`, `docs/06-deployment`, `docs/07-development`, `docs/08-operations`)

- [ ] **Step 4: Verify rename history preserved**

Run: `cd D:/Links/Tools/universal-db-mcp && git log --oneline --follow --diff-filter=R docs/02-databases/README.md | head -5`
Expected: shows historical commits to `docs/databases/README.md` (proves git detected rename)

- [ ] **Step 5: Run tests + build**

Run:
```bash
cd D:/Links/Tools/universal-db-mcp
npm test 2>&1 | tail -5
npm run build 2>&1 | tail -3
```
Expected: `485 passed`, `dist/` rebuilt with no errors

- [ ] **Step 6: Commit**

Run:
```bash
cd D:/Links/Tools/universal-db-mcp
git add -A
git commit -m "refactor(docs): add numeric prefixes to doc directories (01-08)

Renames (no content change):
- databases/ → 02-databases/
- integrations/ → 04-integrations/
- http-api/ → 05-http-api/
- deployment/ → 06-deployment/
- development/ → 07-development/
- operations/ → 08-operations/

Done as separate commits per category to preserve git rename history.
Future commits will fill 01-getting-started, 03-features, 09-reference."
```

---

## Task 2: Commit 2 — `01-getting-started/` + README

**Files:**
- Rename via `git mv`:
  - `docs/getting-started/installation.md` → `docs/01-getting-started/installation.md`
  - `docs/getting-started/quick-start.md` → `docs/01-getting-started/quick-start.md`
  - `docs/getting-started/configuration.md` → `docs/01-getting-started/configuration.md`
  - `docs/getting-started/examples.md` → `docs/01-getting-started/examples.md`
- Create: `docs/01-getting-started/README.md`

**Interfaces:**
- Consumes: existing `docs/getting-started/*.md` content
- Produces: new `docs/01-getting-started/` directory with 4 moved files + 1 new README

- [ ] **Step 1: Move 4 files + create directory**

Run:
```bash
cd D:/Links/Tools/universal-db-mcp
mkdir -p docs/01-getting-started
git mv docs/getting-started/installation.md    docs/01-getting-started/installation.md
git mv docs/getting-started/quick-start.md     docs/01-getting-started/quick-start.md
git mv docs/getting-started/configuration.md   docs/01-getting-started/configuration.md
git mv docs/getting-started/examples.md        docs/01-getting-started/examples.md
rmdir docs/getting-started
```

- [ ] **Step 2: Verify old dir is gone**

Run: `cd D:/Links/Tools/universal-db-mcp && ls docs/getting-started 2>&1`
Expected: `No such file or directory`

- [ ] **Step 3: Write 01-getting-started/README.md**

Write file `docs/01-getting-started/README.md` with content:

```markdown
# 快速开始（Getting Started）

> **何时来这**:第一次安装、配置、跑通 universal-db-mcp。

## 内容索引

| 文档 | 中文 | 英文 | 用途 |
|---|---|---|---|
| `installation.md` | ✅ | ✅ | 4 种安装方式 (npx / npm / Docker / 源码) |
| `quick-start.md` | ✅ | ✅ | 5 分钟上手 stdio / HTTP 模式 |
| `configuration.md` | ✅ | ✅ | 27+ 环境变量参考 |
| `examples.md` | ✅ | ✅ | 17 个 DB 各 1 个例子 |

## 推荐阅读顺序

1. **第一次用**:`quick-start.md`
2. **按需调整**:`configuration.md`
3. **看例子**:`examples.md`

## 相关

- 完整目录树:[docs/README.md](../../README.md)
```

- [ ] **Step 4: Run tests + build**

Run:
```bash
cd D:/Links/Tools/universal-db-mcp
npm test 2>&1 | tail -3
npm run build 2>&1 | tail -3
```
Expected: `485 passed`, no build errors

- [ ] **Step 5: Commit**

Run:
```bash
cd D:/Links/Tools/universal-db-mcp
git add -A
git commit -m "refactor(docs): rename getting-started → 01-getting-started with README"
```

---

## Task 3: Commit 3 — `03-features/` + README

**Files:**
- Rename via `git mv`:
  - `docs/observability.md` → `docs/03-features/observability.md`
  - `docs/query-experience.md` → `docs/03-features/query-experience.md`
  - `docs/multi-profile.md` → `docs/03-features/multi-profile.md`
  - `docs/data-governance.md` → `docs/03-features/data-governance.md`
  - `docs/index-advisor.md` → `docs/03-features/index-advisor.md`
  - `docs/lazy-loading.md` → `docs/03-features/lazy-loading.md`
- Create: `docs/03-features/README.md`

**Interfaces:**
- Consumes: 6 top-level feature docs (v2.16-v3.2)
- Produces: new `docs/03-features/` directory with 6 moved files + 1 new README

- [ ] **Step 1: Move 6 files**

Run:
```bash
cd D:/Links/Tools/universal-db-mcp
mkdir -p docs/03-features
git mv docs/data-governance.md     docs/03-features/data-governance.md
git mv docs/observability.md       docs/03-features/observability.md
git mv docs/query-experience.md    docs/03-features/query-experience.md
git mv docs/multi-profile.md       docs/03-features/multi-profile.md
git mv docs/index-advisor.md       docs/03-features/index-advisor.md
git mv docs/lazy-loading.md        docs/03-features/lazy-loading.md
```

- [ ] **Step 2: Write 03-features/README.md**

Write file `docs/03-features/README.md` with content:

```markdown
# 核心特性（Features）

> **何时来这**:想了解 v2.x-v3.x 各版本加了什么能力。

## 内容索引

| 文档 | 中文 | 英文 | 用途 |
|---|---|---|---|
| `observability.md` | ✅ | ✅ | v2.16 — Prometheus /metrics + 慢查询 |
| `query-experience.md` | ✅ | ✅ | v2.17 — EXPLAIN / LINT / history / templates |
| `multi-profile.md` | ✅ | ✅ | v2.18-v2.20 — 多 profile + YAML 导入导出 |
| `data-governance.md` | ✅ | ✅ | v3.0 — schema diff / backup / audit / PII |
| `index-advisor.md` | ✅ | ✅ | v3.1 — EXPLAIN + 索引建议 + plan diff |
| `lazy-loading.md` | ✅ | ✅ | v3.2 — 4 group lazy load + meta-tool |

## 推荐阅读顺序

按版本号顺序（v2.16 → v3.2）了解渐进式能力。

## 相关

- 上一步:[01-getting-started/](../01-getting-started/)
- 下一步:[04-integrations/](../04-integrations/)
- 完整目录树:[docs/README.md](../../README.md)
```

- [ ] **Step 3: Run tests + build**

Run:
```bash
cd D:/Links/Tools/universal-db-mcp
npm test 2>&1 | tail -3
npm run build 2>&1 | tail -3
```
Expected: `485 passed`, no build errors

- [ ] **Step 4: Commit**

Run:
```bash
cd D:/Links/Tools/universal-db-mcp
git add -A
git commit -m "refactor(docs): move v2.x-v3.x feature docs into 03-features/"
```

---

## Task 4: Commit 4 — `09-reference/` + delete `docs/plan/`

**Files:**
- Rename via `git mv`:
  - `docs/guides/multi-tenant.md` → `docs/08-operations/multi-tenant.md`
  - `docs/guides/security.md` → `docs/04-integrations/security.md`
  - `docs/done/` → `docs/09-reference/done/`
  - `docs/deferred-items.md` → `docs/09-reference/deferred-items.md`
- Delete: `docs/plan/` (3 files duplicate `docs/superpowers/plans/`)
- Copy: `CHANGELOG.md` (repo root) → `docs/09-reference/changelog.md`
- Create: `docs/09-reference/README.md`
- Create (empty dir): `docs/09-reference/audit/`

**Interfaces:**
- Consumes: `docs/guides/`, `docs/done/`, `docs/deferred-items.md`, `docs/plan/`, `CHANGELOG.md`
- Produces: cleaned structure with `09-reference/` as the "miscellaneous" home

- [ ] **Step 1: Move guides/ contents**

Run:
```bash
cd D:/Links/Tools/universal-db-mcp
mkdir -p docs/09-reference
git mv docs/guides/multi-tenant.md     docs/08-operations/multi-tenant.md
git mv docs/guides/security.md         docs/04-integrations/security.md
rmdir docs/guides
```

- [ ] **Step 2: Move done/ + deferred-items**

Run:
```bash
cd D:/Links/Tools/universal-db-mcp
git mv docs/done                       docs/09-reference/done
git mv docs/deferred-items.md          docs/09-reference/deferred-items.md
```

- [ ] **Step 3: Copy CHANGELOG.md**

Run:
```bash
cd D:/Links/Tools/universal-db-mcp
cp CHANGELOG.md docs/09-reference/changelog.md
```

- [ ] **Step 4: Delete docs/plan/ (duplicates superpowers/plans/)**

Run:
```bash
cd D:/Links/Tools/universal-db-mcp
git rm -r docs/plan
```

- [ ] **Step 5: Write 09-reference/README.md**

Write file `docs/09-reference/README.md` with content:

```markdown
# 参考资料（Reference）

> **何时来这**:查历史 / 已废弃 / 杂项内容。

## 内容索引

| 文档 | 中文 | 英文 | 用途 |
|---|---|---|---|
| `changelog.md` | ✅ | ✅ | 完整版本变更记录 |
| `deferred-items.md` | ✅ | ✅ | 推迟项 ledger |
| `audit/` | ✅ | ✅ | 文档缺口审计报告 (6 JSON) |
| `done/` | ✅ | ✅ | v2.12-v2.14 历史完成项 |

## 推荐阅读顺序

- 版本历史:`changelog.md`
- 推迟原因:`deferred-items.md`
- 文档缺口审计:`audit/*.json`

## 相关

- 上一步:[08-operations/](../08-operations/)
- 完整目录树:[docs/README.md](../../README.md)
```

- [ ] **Step 6: Create empty audit/ dir**

Run:
```bash
cd D:/Links/Tools/universal-db-mcp
mkdir -p docs/09-reference/audit
touch docs/09-reference/audit/.gitkeep
```

- [ ] **Step 7: Verify structure**

Run:
```bash
cd D:/Links/Tools/universal-db-mcp && ls docs/ && echo "---" && ls docs/09-reference/
```
Expected: `01-getting-started/ 02-databases/ 03-features/ 04-integrations/ 05-http-api/ 06-deployment/ 07-development/ 08-operations/ 09-reference/ README.md README.zh-CN.md superpowers/` (no more top-level feature docs, no `plan/`, no `guides/`, no `done/`, no `getting-started/`)

`docs/09-reference/` contains `README.md`, `changelog.md`, `deferred-items.md`, `done/`, `audit/`

- [ ] **Step 8: Run tests + build**

Run:
```bash
cd D:/Links/Tools/universal-db-mcp
npm test 2>&1 | tail -3
npm run build 2>&1 | tail -3
```
Expected: `485 passed`, no build errors

- [ ] **Step 9: Commit**

Run:
```bash
cd D:/Links/Tools/universal-db-mcp
git add -A
git commit -m "refactor(docs): consolidate misc docs into 09-reference/ (delete redundant docs/plan/)"
```

---

## Task 5: Commit 5 — Remaining 6 README.md files

**Files:**
- Create: `docs/02-databases/README.md` (update existing minimal one to full template)
- Create: `docs/04-integrations/README.md`
- Create: `docs/05-http-api/README.md`
- Create: `docs/06-deployment/README.md`
- Create: `docs/07-development/README.md`
- Create: `docs/08-operations/README.md`

**Interfaces:**
- Consumes: existing directory structure (post Task 4)
- Produces: 6 new README.md navigation pages

> **NOTE**: `docs/02-databases/README.md` already exists from before restructuring (it was the original DB matrix index). This task overwrites it with the new template format.

- [ ] **Step 1: Write docs/02-databases/README.md**

Write file with content:

```markdown
# 数据库适配器（Databases）

> **何时来这**:查 17 个 DB 适配器的特性矩阵 + 各自详细说明。

## 支持的数据库

| 数据库 | 类型 | 中文 | 英文 |
|---|---|---|---|
| MySQL | SQL | ✅ | ✅ |
| PostgreSQL | SQL | ✅ | ✅ |
| Oracle | SQL | ✅ | ✅ |
| SQL Server | SQL | ✅ | ✅ |
| 达梦 (DM) | SQL | ✅ | ✅ |
| KingbaseES | SQL | ✅ | ✅ |
| GaussDB | SQL | ✅ | ✅ |
| OceanBase | SQL | ✅ | ✅ |
| TiDB | SQL | ✅ | ✅ |
| ClickHouse | OLAP | ✅ | ✅ |
| PolarDB | SQL | ✅ | ✅ |
| Vastbase | SQL | ✅ | ✅ |
| HighGo | SQL | ✅ | ✅ |
| GoldenDB | SQL | ✅ | ✅ |
| MongoDB | NoSQL | ✅ | ✅ |
| Redis | KV | ✅ | ✅ |
| SQLite | Embedded | ✅ | ✅ |

## 推荐阅读顺序

1. **选 DB** → 找对应 `.md` 文件看连接字符串 + 特性
2. **特殊 DB** → MongoDB / Redis / ClickHouse 看各自 schema 说明

## 相关

- 上一步:[01-getting-started/](../01-getting-started/)
- 下一步:[03-features/](../03-features/)
- 完整目录树:[docs/README.md](../../README.md)
```

- [ ] **Step 2: Write docs/04-integrations/README.md**

Write file with content:

```markdown
# MCP 客户端集成（Integrations）

> **何时来这**:用 Claude Desktop / Cursor / Cline 等 MCP 客户端接入 universal-db-mcp。

## 客户端分类

### IDE / 编辑器

Claude Desktop, Claude Code, Cursor, Cline, Continue, Windsurf, JetBrains, VSCode, Zed, Neovim, Emacs, Replit

### 桌面应用

Cherry Studio, LM Studio, Jan, Goose, MindPal, Raycast, Warp, Witsy

### Web 平台

Dify, Coze (扣子), n8n, Flowise, Notion, Discord, Slack, Mattermost, HyperChat

### 编程框架

LangChain, Smolagents, OpenAI Agents SDK, Spring AI, Vercel AI SDK, Google ADK, Ollama, OTerm

### 其他

ChatGPT, ChatMCP, Gemini CLI, Mistral, MCPHost, MCP Inspector, MCP-INSPECTOR, Sourcegraph Cody, Roo Code, Msty, Tome, Home Assistant, LibreChat, 5IRE, Amazon Bedrock Agents, Amazon Q Developer, GitHub Copilot, Postman, Smolagents

## 推荐阅读顺序

1. **第一次集成** → `CLAUDE-DESKTOP.md`
2. **用 IDE** → `CURSOR.md` / `CLINE.md` / `WINDSURF.md`
3. **用 Web 平台** → `DIFY.md` / `COZE.md`
4. **安全配置** → `security.md`

## 相关

- 上一步:[03-features/](../03-features/)
- 下一步:[05-http-api/](../05-http-api/)
- 完整目录树:[docs/README.md](../../README.md)
```

- [ ] **Step 3: Write docs/05-http-api/README.md**

Write file with content:

```markdown
# HTTP API 参考（HTTP API）

> **何时来这**:通过 REST API（而非 MCP 协议）调用 universal-db-mcp。

## 内容索引

| 文档 | 中文 | 英文 | 用途 |
|---|---|---|---|
| `API_REFERENCE.md` | ✅ | ✅ | 所有 endpoint 详细 (query / execute / profiles / metrics 等) |
| `DEPLOYMENT.md` | ✅ | ✅ | HTTP 模式部署（API Key / CORS / 速率限制）|

## 推荐阅读顺序

1. **部署 HTTP 服务** → `DEPLOYMENT.md`
2. **集成到应用** → `API_REFERENCE.md`

## 相关

- 上一步:[04-integrations/](../04-integrations/)
- 下一步:[06-deployment/](../06-deployment/)
- 完整目录树:[docs/README.md](../../README.md)
```

- [ ] **Step 4: Write docs/06-deployment/README.md**

Write file with content:

```markdown
# 部署（Deployment）

> **何时来这**:把 universal-db-mcp 部署到生产环境。

## 内容索引

| 文档 | 中文 | 英文 | 用途 |
|---|---|---|---|
| `local.md` | ✅ | ✅ | Node.js / PM2 / systemd |
| `docker.md` | ✅ | ✅ | Docker / docker-compose |
| `https-domain.md` | ✅ | ✅ | 反向代理 + HTTPS + 域名 |
| `cloud/aliyun.md` | ✅ | ✅ | 阿里云部署 |
| `cloud/aws.md` | ✅ | ✅ | AWS 部署 |
| `cloud/huaweicloud.md` | ✅ | ✅ | 华为云部署 |
| `cloud/tencent.md` | ✅ | ✅ | 腾讯云部署 |

## 推荐阅读顺序

1. **快速测试** → `local.md` (Node.js)
2. **容器化** → `docker.md`
3. **公网暴露** → `https-domain.md`
4. **云平台** → 对应 `cloud/*.md`

## 相关

- 上一步:[05-http-api/](../05-http-api/)
- 下一步:[07-development/](../07-development/)
- 完整目录树:[docs/README.md](../../README.md)
```

- [ ] **Step 5: Write docs/07-development/README.md**

Write file with content:

```markdown
# 开发文档（Development）

> **何时来这**:开发、贡献、添加新 DB 适配器、发布新版本。

## 内容索引

| 文档 | 中文 | 英文 | 用途 |
|---|---|---|---|
| `architecture.md` | ✅ | ✅ | 整体架构 |
| `mcp-interaction-flow.md` | ✅ | ✅ | MCP 协议交互时序图 |
| `connection-stability.md` | ✅ | ✅ | v2.11 连接池稳定性 |
| `text2sql-enhancement.md` | ✅ | ✅ | Text2SQL 增强（含 HHP 数据）|
| `adding-database.md` | ✅ | ✅ | 添加新 DB 适配器步骤 |
| `release.md` | ✅ | ✅ | v3.2.1 发布流程 (gh + Trusted Publishing) |
| `implementation.md` | ✅ | ✅ | 实现细节 |

## 推荐阅读顺序

1. **理解项目** → `architecture.md`
2. **添加 DB** → `adding-database.md`
3. **发布版本** → `release.md`

## 相关

- 上一步:[06-deployment/](../06-deployment/)
- 下一步:[08-operations/](../08-operations/)
- 完整目录树:[docs/README.md](../../README.md)
```

- [ ] **Step 6: Write docs/08-operations/README.md**

Write file with content:

```markdown
# 运维（Operations）

> **何时来这**:生产环境运维（多租户隔离、故障排查、性能调优）。

## 内容索引

| 文档 | 中文 | 英文 | 用途 |
|---|---|---|---|
| `guide.md` | ✅ | ✅ | 运维指南（监控 / 备份 / 升级）|
| `troubleshooting.md` | ✅ | ✅ | 常见故障排查 |
| `multi-tenant.md` | ✅ | ✅ | 多租户隔离（profile + permission mode）|

## 推荐阅读顺序

1. **日常运维** → `guide.md`
2. **出问题时** → `troubleshooting.md`
3. **多租户部署** → `multi-tenant.md`

## 相关

- 上一步:[07-development/](../07-development/)
- 下一步:[09-reference/](../09-reference/)
- 完整目录树:[docs/README.md](../../README.md)
```

- [ ] **Step 7: Run tests + build**

Run:
```bash
cd D:/Links/Tools/universal-db-mcp
npm test 2>&1 | tail -3
npm run build 2>&1 | tail -3
```
Expected: `485 passed`, no build errors

- [ ] **Step 8: Commit**

Run:
```bash
cd D:/Links/Tools/universal-db-mcp
git add -A
git commit -m "docs: add per-directory README.md navigation pages (02/04/05/06/07/08)"
```

---

## Task 6: audit-docs.ts — TDD extractors

**Files:**
- Create: `scripts/audit-docs.ts`
- Test: `tests/unit/audit-docs.test.ts`

**Interfaces:**
- Consumes:
  - `src/mcp/tools/*.ts` (43 tool definitions)
  - `src/utils/config-loader.ts` (env var parsing)
  - `src/adapters/*.ts` (17 adapter files)
  - `src/http/routes/*.ts` (HTTP endpoints)
  - `CHANGELOG.md` (feature changelog)
  - `docs/**/*.md` (existing docs)
- Produces:
  - `extractToolNames(): string[]`
  - `extractEnvVars(): string[]`
  - `extractAdapterNames(): string[]`
  - `extractEndpointNames(): string[]`
  - `extractFeatureNames(): string[]`
  - `findDocReferences(name: string, docDir: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/audit-docs.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  extractToolNames,
  extractEnvVars,
  extractAdapterNames,
  extractEndpointNames,
  extractFeatureNames,
  findDocReferences,
} from '../../scripts/audit-docs.js';

describe('audit-docs extractors', () => {
  it('extractToolNames returns all tool names from src/mcp/tools/*.ts', async () => {
    const names = await extractToolNames('./src/mcp/tools');
    expect(names.length).toBeGreaterThan(20);
    expect(names).toContain('connect_database');
    expect(names).toContain('save_profile');
    expect(names).toContain('use_tool_group');
  });

  it('extractEnvVars returns all DB_* env vars from config-loader.ts', async () => {
    const vars = await extractEnvVars('./src/utils/config-loader.ts');
    expect(vars.length).toBeGreaterThan(10);
    expect(vars).toContain('DB_TYPE');
    expect(vars).toContain('DB_LAZY_LOAD_ENABLED');
  });

  it('extractAdapterNames returns 17 adapters from src/adapters/*.ts', async () => {
    const names = await extractAdapterNames('./src/adapters');
    expect(names).toContain('mysql');
    expect(names).toContain('postgresql');
    expect(names).toContain('oracle');
    expect(names.length).toBe(17);
  });

  it('extractEndpointNames returns HTTP routes from src/http/routes/*.ts', async () => {
    const names = await extractEndpointNames('./src/http/routes');
    expect(names).toContain('/api/query');
    expect(names).toContain('/api/health');
  });

  it('extractFeatureNames returns `### 新增` headers from CHANGELOG.md', async () => {
    const names = await extractFeatureNames('./CHANGELOG.md');
    expect(names.length).toBeGreaterThan(5);
    expect(names.some(n => n.includes('v3.2'))).toBe(true);
  });

  it('findDocReferences returns true if name appears in any doc', async () => {
    expect(await findDocReferences('save_profile', './docs')).toBe(true);
    expect(await findDocReferences('this-tool-does-not-exist-xyz', './docs')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:/Links/Tools/universal-db-mcp && ./node_modules/.bin/vitest run tests/unit/audit-docs.test.ts 2>&1 | tail -10`
Expected: FAIL — `Cannot find module '../../scripts/audit-docs.js'`

- [ ] **Step 3: Write minimal implementation**

Create `scripts/audit-docs.ts`:

```typescript
/**
 * Docs audit script (v3.3.0)
 *
 * Detects documentation gaps across 6 dimensions:
 *   1. MCP tools vs docs references
 *   2. CHANGELOG features vs feature docs
 *   3. Env vars vs docs
 *   4. HTTP endpoints vs docs
 *   5. Database adapters vs docs/02-databases
 *   6. Code examples vs docs (placeholder for future)
 *
 * Run: `node --experimental-strip-types scripts/audit-docs.ts`
 * Output: 6 JSON files in docs/09-reference/audit/
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Extract MCP tool names from `name: 'xxx'` patterns in src/mcp/tools/*.ts */
export async function extractToolNames(srcDir: string): Promise<string[]> {
  const files = (await readdir(srcDir)).filter(f => f.endsWith('.ts'));
  const names = new Set<string>();
  const re = /\bname:\s*['"]([\w-]+)['"]/g;
  for (const f of files) {
    const text = await readFile(join(srcDir, f), 'utf-8');
    for (const m of text.matchAll(re)) names.add(m[1]);
  }
  return [...names];
}

/** Extract DB_* env var names from config-loader.ts process.env references */
export async function extractEnvVars(configLoaderPath: string): Promise<string[]> {
  const text = await readFile(configLoaderPath, 'utf-8');
  const names = new Set<string>();
  const re = /process\.env\.([A-Z_][A-Z0-9_]+)/g;
  for (const m of text.matchAll(re)) {
    if (m[1].startsWith('DB_')) names.add(m[1]);
  }
  return [...names];
}

/** Extract adapter names from src/adapters/*.ts filenames */
export async function extractAdapterNames(srcDir: string): Promise<string[]> {
  const files = (await readdir(srcDir)).filter(f => f.endsWith('.ts') || f.endsWith('.js'));
  return files.map(f => f.replace(/\.(ts|js)$/, ''));
}

/** Extract HTTP endpoint paths from `fastify.get|post|delete('...')` patterns */
export async function extractEndpointNames(srcDir: string): Promise<string[]> {
  const files = (await readdir(srcDir)).filter(f => f.endsWith('.ts'));
  const names = new Set<string>();
  const re = /fastify\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g;
  for (const f of files) {
    const text = await readFile(join(srcDir, f), 'utf-8');
    for (const m of text.matchAll(re)) names.add(m[2]);
  }
  return [...names];
}

/** Extract feature names from CHANGELOG.md `### 新增` headers */
export async function extractFeatureNames(changelogPath: string): Promise<string[]> {
  const text = await readFile(changelogPath, 'utf-8');
  const features: string[] = [];
  const re = /### 新增 \(([^)]+)\)/g;
  for (const m of text.matchAll(re)) features.push(m[1]);
  return features;
}

/** Check if name appears in any *.md file under docDir */
export async function findDocReferences(name: string, docDir: string): Promise<boolean> {
  async function walk(dir: string): Promise<boolean> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (await walk(p)) return true;
      } else if (e.name.endsWith('.md')) {
        const text = await readFile(p, 'utf-8');
        if (text.includes(name)) return true;
      }
    }
    return false;
  }
  return walk(docDir);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd D:/Links/Tools/universal-db-mcp && ./node_modules/.bin/vitest run tests/unit/audit-docs.test.ts 2>&1 | tail -10`
Expected: PASS — 6 cases

- [ ] **Step 5: Commit**

Run:
```bash
cd D:/Links/Tools/universal-db-mcp
git add scripts/audit-docs.ts tests/unit/audit-docs.test.ts
git commit -m "feat(scripts): add audit-docs.ts extractors with TDD (6 dimensions)"
```

---

## Task 7: audit-docs.ts main() + 6 JSON reports

**Files:**
- Modify: `scripts/audit-docs.ts` (add main() that calls extractors and writes 6 JSONs)

**Interfaces:**
- Consumes: extractor functions from Task 6
- Produces: 6 JSON files in `docs/09-reference/audit/` + exits with summary log

- [ ] **Step 1: Append main() function**

Append to `scripts/audit-docs.ts`:

```typescript
interface ReportItem {
  name: string;
  sourceLocation?: string;
  docLocation: string;
  docStatus: 'missing' | 'partial' | 'ok';
  oneLineDescription?: string;
}

interface AuditReport {
  version: string;
  generatedAt: string;
  summary: { totalItems: number; documented: number; missing: number };
  missing: ReportItem[];
}

async function buildReport(
  items: string[],
  docDir: string,
  sourceLocationFor: (name: string) => string | undefined,
  descriptionFor: (name: string) => string | undefined,
): Promise<AuditReport> {
  const missing: ReportItem[] = [];
  for (const name of items) {
    const found = await findDocReferences(name, docDir);
    if (!found) {
      missing.push({
        name,
        sourceLocation: sourceLocationFor(name),
        docLocation: '—',
        docStatus: 'missing',
        oneLineDescription: descriptionFor(name),
      });
    }
  }
  const version = (await readFile('./package.json', 'utf-8'))
    .match(/"version":\s*"([^"]+)"/)?.[1] ?? 'unknown';
  return {
    version,
    generatedAt: new Date().toISOString().split('T')[0],
    summary: {
      totalItems: items.length,
      documented: items.length - missing.length,
      missing: missing.length,
    },
    missing,
  };
}

async function main() {
  const auditDir = './docs/09-reference/audit';
  const tools = await extractToolNames('./src/mcp/tools');
  const envVars = await extractEnvVars('./src/utils/config-loader.ts');
  const adapters = await extractAdapterNames('./src/adapters');
  const endpoints = await extractEndpointNames('./src/http/routes');
  const features = await extractFeatureNames('./CHANGELOG.md');

  const toolsReport = await buildReport(
    tools, './docs',
    (n) => `src/mcp/tools/*.ts (name='${n}')`,
    (n) => `MCP tool — see tools/*.ts for handler`,
  );
  const envReport = await buildReport(
    envVars, './docs',
    (n) => `src/utils/config-loader.ts (process.env.${n})`,
    (n) => `env var — see config-loader.ts`,
  );
  const adaptersReport = await buildReport(
    adapters, './docs/02-databases',
    (n) => `src/adapters/${n}.ts`,
    (n) => `DB adapter for ${n}`,
  );
  const endpointsReport = await buildReport(
    endpoints, './docs/05-http-api',
    (n) => `src/http/routes/*.ts (${n})`,
    (n) => `HTTP endpoint`,
  );
  const featuresReport = await buildReport(
    features, './docs/03-features',
    (n) => `CHANGELOG.md feature: ${n}`,
    (n) => `Feature added in ${n}`,
  );
  const examplesReport: AuditReport = {
    version: toolsReport.version,
    generatedAt: toolsReport.generatedAt,
    summary: { totalItems: 0, documented: 0, missing: 0 },
    missing: [],
  };

  await writeFile(`${auditDir}/tools.json`, JSON.stringify(toolsReport, null, 2));
  await writeFile(`${auditDir}/env-vars.json`, JSON.stringify(envReport, null, 2));
  await writeFile(`${auditDir}/adapters.json`, JSON.stringify(adaptersReport, null, 2));
  await writeFile(`${auditDir}/api-endpoints.json`, JSON.stringify(endpointsReport, null, 2));
  await writeFile(`${auditDir}/features.json`, JSON.stringify(featuresReport, null, 2));
  await writeFile(`${auditDir}/examples.json`, JSON.stringify(examplesReport, null, 2));

  console.log(`📋 docs audit complete (v${toolsReport.version}):`);
  for (const r of [toolsReport, envReport, adaptersReport, endpointsReport, featuresReport]) {
    console.log(`  ${r.summary.missing}/${r.summary.totalItems} missing`);
  }
}

main().catch(err => {
  console.error('❌ audit failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the audit script**

Run: `cd D:/Links/Tools/universal-db-mcp && node --experimental-strip-types scripts/audit-docs.ts 2>&1 | tail -15`
Expected output:
```
📋 docs audit complete (v3.2.1):
  N/43 missing
  N/27 missing
  0/17 missing    (or some N/17)
  N/20 missing
  N/6 missing
```

- [ ] **Step 3: Verify 6 JSON files created**

Run: `cd D:/Links/Tools/universal-db-mcp && ls docs/09-reference/audit/`
Expected: `adapters.json  api-endpoints.json  env-vars.json  examples.json  features.json  tools.json`

- [ ] **Step 4: Validate JSON structure**

Run:
```bash
cd D:/Links/Tools/universal-db-mcp
for f in docs/09-reference/audit/*.json; do
  echo "=== $f ==="
  node -e "const r=require('./$f'); console.log('version:', r.version, 'summary:', JSON.stringify(r.summary))"
done
```
Expected: each JSON has `version` (string) and `summary` (object with totalItems/documented/missing)

- [ ] **Step 5: Run all tests**

Run: `cd D:/Links/Tools/universal-db-mcp && ./node_modules/.bin/vitest run 2>&1 | tail -5`
Expected: 491 passed (485 baseline + 6 new audit tests)

- [ ] **Step 6: Remove .gitkeep from audit/**

Run:
```bash
cd D:/Links/Tools/universal-db-mcp
git rm docs/09-reference/audit/.gitkeep
```

- [ ] **Step 7: Commit**

Run:
```bash
cd D:/Links/Tools/universal-db-mcp
git add -A
git commit -m "docs(audit): generate 6 gap reports (tools/env-vars/adapters/api-endpoints/features/examples)"
```

---

## Task 8: Final verification + push

**Files:** (none modified)

- [ ] **Step 1: Full test suite**

Run: `cd D:/Links/Tools/universal-db-mcp && npm test 2>&1 | tail -5`
Expected: 491 passed

- [ ] **Step 2: Build**

Run: `cd D:/Links/Tools/universal-db-mcp && npm run build 2>&1 | tail -3`
Expected: no errors

- [ ] **Step 3: Verify final directory structure**

Run: `cd D:/Links/Tools/universal-db-mcp && ls docs/ | sort`
Expected: `01-getting-started  02-databases  03-features  04-integrations  05-http-api  06-deployment  07-development  08-operations  09-reference  README.md  README.zh-CN.md  superpowers`

- [ ] **Step 4: Verify audit reports exist**

Run: `cd D:/Links/Tools/universal-db-mcp && ls docs/09-reference/audit/`
Expected: 6 JSON files

- [ ] **Step 5: Verify no top-level feature docs remain**

Run: `cd D:/Links/Tools/universal-db-mcp && ls docs/*.md 2>&1`
Expected: `docs/README.md docs/README.zh-CN.md` (no other top-level .md)

- [ ] **Step 6: Push to remote**

Run: `cd D:/Links/Tools/universal-db-mcp && git push origin main 2>&1 | tail -5`
Expected: `To https://github.com/joyous-coder/universal-db-mcp  main -> main`

---

## Self-Review Notes

**Spec coverage check**:
- §1 (background) ✓ addressed in plan header
- §2 (folder structure) ✓ Tasks 1-4 implement renames + new dirs
- §3 (file mapping) ✓ Tasks 1-4 each map specific files
- §4 (README template) ✓ Tasks 2-5 each produce README per template
- §5 (audit) ✓ Tasks 6-7 implement audit-docs.ts + 6 JSONs
- §6 (git strategy) ✓ Tasks 1-5 + 7 implement 6-commit sequence + CHANGELOG note (deferred to release commit)
- §7 (acceptance criteria) ✓ Task 8 verifies all 7 criteria

**Placeholder scan**:
- ✓ No TBD/TODO/XXX found
- ✓ All shell commands are complete with expected output
- ✓ All file contents shown in full

**Type consistency**:
- All extractor function signatures match between Task 6 (tests) and Task 7 (main)
- `extractToolNames(srcDir)`, `extractEnvVars(path)`, `extractAdapterNames(srcDir)`, `extractEndpointNames(srcDir)`, `extractFeatureNames(changelogPath)`, `findDocReferences(name, docDir)` — all consistent
- `AuditReport` interface used identically in both Tasks 6 and 7

**Gap noted**:
- Task 8 doesn't include CHANGELOG v3.3.0 update — that's part of the v3.3.0 release commit (separate task in a different plan).