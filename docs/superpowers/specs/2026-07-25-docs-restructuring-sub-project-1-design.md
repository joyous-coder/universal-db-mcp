# v3.3.0 Docs Restructuring — Sub-project 1: Restructure + Audit

> **For agentic workers:** This is **Sub-project 1** of 4. Subsequent sub-projects: (2) fill content gaps from §6 audit; (3) Chinese translations Phase A — high-value docs; (4) Chinese translations Phase B — integration docs.

**Date**: 2026-07-25
**Author**: brainstorming session
**Status**: ✅ User approved all 6 sections
**Scope**: v3.3.0 docs/ folder restructure + audit script. **Does NOT** add new content or translations — those are Sub-projects 2, 3, 4.

---

## 1. Background & Goals

The `docs/` folder has grown organically over v2.13-v3.2 with **inconsistent structure**:

- 7 feature docs (`data-governance.md`, `index-advisor.md`, `lazy-loading.md`, `multi-profile.md`, `observability.md`, `query-experience.md`, `deferred-items.md`) sit at top level instead of grouped
- 4 directory categories have no clear hierarchy (getting-started, deployment, development, operations, integrations, http-api)
- `docs/plan/` duplicates `docs/superpowers/plans/`
- `docs/done/` is a historical archive mixed with active docs
- ~70 integration docs are 90% template content
- 6 个 audit 维度（tools / features / env-vars / HTTP API / adapters / examples）没有自动化检测

**Goals**:

1. **Restructure** to a 9-section user-journey layout (`01-` through `09-` numbered prefixes)
2. **Audit** which MCP tools / features / env vars / HTTP endpoints / adapters are missing documentation
3. **Foundation for Sub-projects 2-4** (which will fill gaps and add Chinese translations)

**Non-goals**:

- ❌ Add new documentation content (Sub-project 2)
- ❌ Translate docs to Chinese (Sub-projects 3 & 4)
- ❌ Refactor integration docs (70 → 10 templates) (Sub-project 4)
- ❌ Add backward-compatibility redirect stubs
- ❌ Update root `README.md` / `README.zh-CN.md` (separate concern)

---

## 2. Final Folder Structure

```
docs/
├── README.md                          # 索引（中英）
├── README.zh-CN.md
│
├── 01-getting-started/                # 第一站
│   ├── README.md                       # 导航
│   ├── installation.md / .zh-CN.md
│   ├── quick-start.md / .zh-CN.md
│   ├── configuration.md / .zh-CN.md
│   └── examples.md / .zh-CN.md
│
├── 02-databases/                      # 17 DB-specific docs（保留现有）
│   ├── README.md
│   ├── mysql.md / .zh-CN.md
│   ├── postgresql.md / .zh-CN.md
│   ├── ... (17 个 DB)
│
├── 03-features/                       # ⭐ 新建：v2.x-v3.x 特性集中
│   ├── README.md                       # ⭐ 新建
│   ├── observability.md (← 顶层) / .zh-CN.md
│   ├── query-experience.md (← 顶层) / .zh-CN.md
│   ├── multi-profile.md (← 顶层) / .zh-CN.md
│   ├── data-governance.md (← 顶层) / .zh-CN.md
│   ├── index-advisor.md (← 顶层) / .zh-CN.md
│   └── lazy-loading.md (← 顶层) / .zh-CN.md
│
├── 04-integrations/                   # MCP 客户端配置（保留）
│   ├── README.md / .zh-CN.md          # ⭐ 新建
│   ├── CLAUDE-DESKTOP.md / .zh-CN.md
│   ├── ... (70+ 客户端)
│   └── security.md (← docs/guides/) / .zh-CN.md
│
├── 05-http-api/                       # REST API 参考
│   ├── README.md / .zh-CN.md          # ⭐ 新建
│   ├── API_REFERENCE.md / .zh-CN.md
│   └── DEPLOYMENT.md / .zh-CN.md
│
├── 06-deployment/                     # 部署（保留）
│   ├── README.md / .zh-CN.md          # ⭐ 新建
│   ├── local.md / .zh-CN.md
│   ├── docker.md / .zh-CN.md
│   ├── https-domain.md / .zh-CN.md
│   └── cloud/
│       ├── aliyun.md / .zh-CN.md
│       ├── aws.md / .zh-CN.md
│       ├── huaweicloud.md / .zh-CN.md
│       └── tencent.md / .zh-CN.md
│
├── 07-development/                    # 开发文档
│   ├── README.md / .zh-CN.md          # ⭐ 新建
│   ├── architecture.md / .zh-CN.md
│   ├── mcp-interaction-flow.md / .zh-CN.md
│   ├── connection-stability.md / .zh-CN.md
│   ├── text2sql-enhancement.md / .zh-CN.md
│   ├── adding-database.md / .zh-CN.md
│   ├── release.md / .zh-CN.md         # ← 现有 (升级了内容)
│   └── implementation.md / .zh-CN.md
│
├── 08-operations/                     # 运维
│   ├── README.md / .zh-CN.md          # ⭐ 新建
│   ├── guide.md / .zh-CN.md
│   ├── troubleshooting.md / .zh-CN.md
│   └── multi-tenant.md (← docs/guides/) / .zh-CN.md
│
├── 09-reference/                      # ⭐ 新建：杂项 + 历史
│   ├── README.md / .zh-CN.md          # ⭐ 新建
│   ├── changelog.md / .zh-CN.md       # = repo 根 CHANGELOG.md 副本
│   ├── deferred-items.md / .zh-CN.md
│   ├── audit/                          # ⭐ 新建：gap 报告
│   │   ├── tools.json
│   │   ├── features.json
│   │   ├── env-vars.json
│   │   ├── api-endpoints.json
│   │   ├── adapters.json
│   │   └── examples.json
│   └── done/                           # ← 现有 docs/done/
│       ├── dynamic-connection-in-mcp-mode.md
│       ├── fix-stdio-graceful-shutdown.md
│       └── multi-schema-support.md
│
├── superpowers/                       # 保留不动
│   ├── plans/
│   └── specs/
│
└── _meta/                             # ⭐ 新建目录（保留为空，未来可能放）
```

### 删除的目录

- `docs/getting-started/` → 内容已移至 `01-getting-started/`
- `docs/guides/` → 内容已移至 `04-integrations/` 和 `08-operations/`
- `docs/done/` → 已移至 `09-reference/done/`
- `docs/plan/` → 与 `docs/superpowers/plans/` 重复，删除

---

## 3. File Move Mapping

### 3.1 Renames（数字前缀）

| From | To |
|---|---|
| `docs/databases/` | `docs/02-databases/` |
| `docs/integrations/` | `docs/04-integrations/` |
| `docs/http-api/` | `docs/05-http-api/` |
| `docs/deployment/` | `docs/06-deployment/` |
| `docs/development/` | `docs/07-development/` |
| `docs/operations/` | `docs/08-operations/` |

### 3.2 Cross-directory moves

| From | To |
|---|---|
| `docs/getting-started/installation.md` | `docs/01-getting-started/installation.md` |
| `docs/getting-started/quick-start.md` | `docs/01-getting-started/quick-start.md` |
| `docs/getting-started/configuration.md` | `docs/01-getting-started/configuration.md` |
| `docs/getting-started/examples.md` | `docs/01-getting-started/examples.md` |
| `docs/data-governance.md` | `docs/03-features/data-governance.md` |
| `docs/observability.md` | `docs/03-features/observability.md` |
| `docs/query-experience.md` | `docs/03-features/query-experience.md` |
| `docs/multi-profile.md` | `docs/03-features/multi-profile.md` |
| `docs/index-advisor.md` | `docs/03-features/index-advisor.md` |
| `docs/lazy-loading.md` | `docs/03-features/lazy-loading.md` |
| `docs/deferred-items.md` | `docs/09-reference/deferred-items.md` |
| `docs/guides/multi-tenant.md` | `docs/08-operations/multi-tenant.md` |
| `docs/guides/security.md` | `docs/04-integrations/security.md` |
| `docs/done/` | `docs/09-reference/done/` |
| `CHANGELOG.md` (repo 根) | + 副本 `docs/09-reference/changelog.md` |

### 3.3 Deletions

| Path | Reason |
|---|---|
| `docs/plan/` | 内容与 `docs/superpowers/plans/` 完全重复 |
| `docs/development/release.md`（旧版）| 移到 `docs/07-development/release.md`（位置不变；内容不变） |

### 3.4 Unchanged（保持原位）

- `docs/superpowers/plans/`, `docs/superpowers/specs/`
- `docs/02-databases/` 内文件（只移动父目录）
- `docs/04-integrations/` 内 70+ 集成文件（只移动父目录 + 加 security.md）
- `docs/05-http-api/` 内文件（只移动父目录）
- `docs/06-deployment/cloud/` 4 个云厂商文件
- `docs/07-development/architecture.md`, `mcp-interaction-flow.md`, `connection-stability.md`, `text2sql-enhancement.md`, `adding-database.md`, `implementation*.md`
- `docs/08-operations/guide.md`, `troubleshooting.md`
- Root `CLAUDE.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `README.md`, `README.zh-CN.md`

---

## 4. New README.md Template (per-directory)

每个数字目录加一个 README.md 作为导航。模板：

```markdown
# <目录中文名>（<English name>）

> **何时来这**：<一句话读者场景>

## 内容索引

| 文档 | 中文 | 英文 | 用途 |
|---|---|---|---|
| `<topic>.md` | ✅/❌ | ✅/❌ | <一句话> |

## 推荐阅读顺序

1. 第一次用 → `topic.md`
2. 深入了解 → `topic.md`
3. 排错 → `topic.md`

## 相关

- 上一步：[<prev>/](../<prev>/)
- 下一步：[<next>/](../<next>/)
- 完整目录树：[docs/README.md](../../README.md)
```

### 各 README 具体内容

| 目录 | "何时来这" 描述 |
|---|---|
| `01-getting-started/` | 第一次安装、配置、跑通 universal-db-mcp |
| `02-databases/` | 17 个 DB 适配器的特性矩阵 + 各自详细说明 |
| `03-features/` | 想了解 v2.x-v3.x 各版本加了什么能力 |
| `04-integrations/` | 用 Claude Desktop / Cursor / Cline 等 MCP 客户端接入 |
| `05-http-api/` | REST API 参考 |
| `06-deployment/` | 部署到生产（local / Docker / 4 个云厂商） |
| `07-development/` | 开发 / 贡献 / 添加新 DB / 发布版本 |
| `08-operations/` | 生产环境运维（多租户 / 故障排查）|
| `09-reference/` | 历史 / 已废弃 / 杂项 |

---

## 5. Gap Audit Methodology

### 5.1 审计维度（6 个）

| # | 维度 | 数据源 | 输出 |
|---|---|---|---|
| 1 | **Tools** | `src/mcp/tools/*.ts` 中所有 tool name + 一行描述 | `tools.json` |
| 2 | **Features** | `CHANGELOG.md` 的 `### 新增` 行（每个 version） | `features.json` |
| 3 | **Env vars** | `src/utils/config-loader.ts` 所有 `process.env.DB_*` | `env-vars.json` |
| 4 | **HTTP API** | `src/http/routes/*.ts` 的 fastify.get/post/delete | `api-endpoints.json` |
| 5 | **Adapters** | `src/adapters/*.ts` 17 个 adapter 文件名 | `adapters.json` |
| 6 | **Examples** | docs 中代码示例（grep + 用户场景） | `examples.json` |

### 5.2 审计产物

存储位置：`docs/09-reference/audit/`

每个 JSON 格式：

```jsonc
{
  "version": "v3.2.1",       // 审计时的版本
  "generatedAt": "2026-07-XX",
  "summary": {
    "totalItems": 43,
    "documented": 30,
    "missing": 13
  },
  "missing": [
    {
      "name": "compare_profile_schemas",
      "sourceLocation": "src/mcp/tools/data-governance.ts:14",
      "docLocation": "—",
      "docStatus": "missing",  // missing | partial | outdated
      "oneLineDescription": "Compare schemas of two saved profiles"
    }
  ]
}
```

### 5.3 审计脚本

新建 `scripts/audit-docs.ts`（Node.js + tsx 或 `--experimental-strip-types`）。

输出 6 个 JSON 到 `docs/09-reference/audit/`。

脚本可重复运行 —— 未来 v3.4 / v3.5 发布时再跑，看新增的工具 / 端点是否补了文档。

---

## 6. Git Migration Strategy

### 6.1 原则

1. **保留 git history** —— 用 `git mv`（不是 `git rm` + `git add`），git 自动识别为 rename
2. **每个 commit 单类操作** —— 一次只做 rename / write / delete 一类
3. **每个 commit 后跑测试** —— 确认无回归

### 6.2 Commit 序列（6 个 commit）

#### Commit 1: 加数字前缀（不写新内容）

```bash
git mv docs/databases       docs/02-databases
git mv docs/integrations    docs/04-integrations
git mv docs/http-api        docs/05-http-api
git mv docs/deployment      docs/06-deployment
git mv docs/development     docs/07-development
git mv docs/operations      docs/08-operations
git commit -m "refactor(docs): add numeric prefixes to doc directories (01-08)"
```

约 100+ files moved, 0 content change.

#### Commit 2: `01-getting-started/` + README

```bash
mkdir -p docs/01-getting-started
git mv docs/getting-started/installation.md    docs/01-getting-started/installation.md
git mv docs/getting-started/quick-start.md     docs/01-getting-started/quick-start.md
git mv docs/getting-started/configuration.md   docs/01-getting-started/configuration.md
git mv docs/getting-started/examples.md        docs/01-getting-started/examples.md
rmdir docs/getting-started
git add docs/01-getting-started/README.md
git commit -m "refactor(docs): rename getting-started → 01-getting-started with README"
```

#### Commit 3: `03-features/` + README

```bash
mkdir -p docs/03-features
git mv docs/data-governance.md     docs/03-features/data-governance.md
git mv docs/observability.md       docs/03-features/observability.md
git mv docs/query-experience.md    docs/03-features/query-experience.md
git mv docs/multi-profile.md       docs/03-features/multi-profile.md
git mv docs/index-advisor.md       docs/03-features/index-advisor.md
git mv docs/lazy-loading.md        docs/03-features/lazy-loading.md
git add docs/03-features/README.md
git commit -m "refactor(docs): move v2.x-v3.x feature docs into 03-features/"
```

#### Commit 4: 杂项合并 + `09-reference/` + 删除 `plan/`

```bash
mkdir -p docs/09-reference
git mv docs/guides/multi-tenant.md     docs/08-operations/multi-tenant.md
git mv docs/guides/security.md         docs/04-integrations/security.md
rmdir docs/guides
git mv docs/done                       docs/09-reference/done
git mv docs/deferred-items.md          docs/09-reference/deferred-items.md
git rm -r docs/plan                  # 内容与 superpowers/plans/ 重复
cp CHANGELOG.md docs/09-reference/changelog.md
git add docs/09-reference/changelog.md
git add docs/09-reference/README.md
git commit -m "refactor(docs): consolidate misc docs into 09-reference/ (delete redundant docs/plan/)"
```

#### Commit 5: 9 个新 README.md

```bash
# 一次性写 9 个 README
git add docs/01-getting-started/README.md \
        docs/02-databases/README.md \
        docs/03-features/README.md \
        docs/04-integrations/README.md \
        docs/05-http-api/README.md \
        docs/06-deployment/README.md \
        docs/07-development/README.md \
        docs/08-operations/README.md \
        docs/09-reference/README.md
git commit -m "docs: add per-directory README.md navigation pages (9 dirs)"
```

#### Commit 6: audit 脚本 + 6 个 JSON

```bash
node --experimental-strip-types scripts/audit-docs.ts
git add scripts/audit-docs.ts docs/09-reference/audit/*.json
git commit -m "docs(audit): add audit-docs.ts script + 6 gap reports"
```

### 6.3 测试 + 验证

每个 commit 后：

```bash
npm test           # 现有 485 tests 全部通过
npm run build      # 编译 0 错误
git log --follow docs/03-features/lazy-loading.md  # 显示 v3.2 历史保留
```

### 6.4 Backward Compatibility（推荐方案 B）

**不**保留旧路径 redirect 文件。理由：

- 简化迁移（不留历史负债）
- GitHub README 链接由新结构引导
- CHANGELOG v3.3.0 标注路径变更

**CHANGELOG entry 模板**：

```
## [3.3.0] - 2026-07-XX
### 文档重构（不兼容路径变更）
- docs/ 目录重新组织为 01-09 用户旅程分层
- 旧路径（如 docs/integrations/ → docs/04-integrations/）已变更
- 新增 6 个文档缺口审计报告（docs/09-reference/audit/）
- 历史文档（done/、plan/）整合到 09-reference/
```

---

## 7. Acceptance Criteria

### 7.1 Structure

- [ ] 9 个数字前缀目录存在（`01-` 到 `09-`）
- [ ] 顶层 7 个松散特性文档已移到 `03-features/`
- [ ] `docs/getting-started/`、`docs/guides/`、`docs/done/`、`docs/plan/` 目录已清空
- [ ] `docs/superpowers/plans/` + `specs/` 保留不动
- [ ] CLAUDE.md 和 CONTRIBUTING.md 留在 repo 根
- [ ] 每个数字目录有 `README.md`

### 7.2 Content

- [ ] 9 个新 README.md 内容完整（导航表 + 推荐顺序 + 相关链接）
- [ ] 6 个 audit JSON 生成（tools/features/env/api/adapters/examples）
- [ ] `scripts/audit-docs.ts` 脚本可重复运行

### 7.3 Tests + Quality

- [ ] 6 个 commit 全部通过 `npm test` + `npm run build`
- [ ] git history 保留：`git log --follow` 显示 v3.2 提交
- [ ] npm test 总数不变（485 + 0 = 485）

### 7.4 Backward Compatibility

- [ ] CHANGELOG v3.3.0 标注 docs 路径变更
- [ ] 旧路径（`docs/integrations/CLAUDE-DESKTOP.md` 等）不重定向（已确认）

---

## 8. Out of Scope (Sub-projects 2-4)

| Sub-project | Scope | 状态 |
|---|---|---|
| 2 — 文档补全 | 跑 audit 后填 6 个 JSON 的 missing 条目 | 后续 spec |
| 3 — Chinese 翻译 Phase A | getting-started / features / databases / http-api / development / operations | 后续 spec |
| 4 — Chinese 翻译 Phase B | integrations/ 70 个 | 后续 spec + 集成文档模板化 |

---

## 9. Future Tasks (Not in This Spec)

- Sub-project 2：补全 MCP tool reference（43 个工具的中英 reference）
- Sub-project 3：Chinese 翻译（高价值 doc）
- Sub-project 4：Chinese 翻译（integration docs） + 模板化整合
- v3.4+：每发布跑一次 `scripts/audit-docs.ts` 验证新工具都有文档