# Docs Cleanup Design (v3.3.0+)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (推荐) 或 inline execution。
> Spec owner: wangyubin | Date: 2026-07-26

**Goal:** 把仓库 docs/ 整理为统一中文文档体系,补全 wangyubin 自 v0.2.0 起开发但未文档化的功能,清理根 README.md 中英混杂,统一交叉引用结构。

**Context:**
- wangyubin 自 2026-01-23 起的 **414 个 commit**(覆盖 v0.2.0 → v3.3.0)
- CHANGELOG.md 记录了 v2.16 → v3.3.0 的功能,但 docs/ 大量 v0.2.0 ~ v2.15 的功能特性没有任何文档
- 根 `README.md` 553 行有 67 处中文片段(语言切换链接、达梦表名、`[EN]/[中文]` 集成标签)
- docs/01-09 已按编号重排,但内容是英文文件名 + 中文内容混合状态
- docs/04-integrations 下 55 对 `XXX.md` + `XXX.zh-CN.md` 双文件并存

---

## 决定(已与用户确认)

| # | 决定 | 备注 |
|---|------|------|
| 1 | docs/ 全部中文文件名 + 单语 | 例 `installation.md` 内容中文(已是);后续阶段 3 文件名可中文化 |
| 2 | 保留 04-integrations 55 个英文文件名 + 双文件对 | 外部 GitHub URL 稳定,不破坏外链 |
| 3 | 保留 `README.md`(英文)+ `README.zh-CN.md`(中文)双语 | 清理英文 README 里中文片段 |
| 4 | 4 类文档补全:operations + v3.2.x-v3.3.0 新功能 + development + reference | 阶段 2 执行 |
| 5 | 每篇文档末尾加"相关文档"交叉引用 | 阶段 1 + 全程 |
| 6 | 分 3 阶段交付 | 阶段 1(本轮)=清理/统一,阶段 2=补全,阶段 3=文件名重命名 |

---

## 阶段 1:清理 + 统一(本轮)

### 范围

| 任务 | 文件 | 操作 |
|------|------|------|
| 1.1 | `README.md` | 清理 67 处中文片段:语言切换 "中文文档"→"Chinese version";"达梦"→"Dameng" 表中保留(因为是产品名);`[EN]/[中文]` 集成链接标签改为纯英文 `[English]/[Chinese]`;中文分类 "Chinese" 保留(产品定位描述) |
| 1.2 | `README.zh-CN.md` | 不动(已全中文) |
| 1.3 | `docs/01-getting-started/installation.md` | 加"相关文档"段(链 quick-start / configuration / examples) |
| 1.4 | `docs/01-getting-started/quick-start.md` | 加"相关文档"段 |
| 1.5 | `docs/01-getting-started/configuration.md` | 加"相关文档"段 |
| 1.6 | `docs/01-getting-started/examples.md` | 加"相关文档"段 |
| 1.7 | `docs/02-databases/README.md` + 17 个 DB 文档 | 每篇加"相关文档"段,DB 文档互相链 |
| 1.8 | `docs/03-features/*` (8 个) | 每篇加"相关文档"段,特性文档互相链 |
| 1.9 | `docs/06-deployment/*` (5 个本地 + 4 个 cloud + wsl) | 每篇加"相关文档"段 |
| 1.10 | `docs/07-development/*` (8 个) | 每篇加"相关文档"段 |
| 1.11 | `docs/08-operations/*` (3 个) | 每篇加"相关文档"段 |
| 1.12 | `docs/09-reference/*` (3 个) | 每篇加"相关文档"段 |
| 1.13 | `docs/04-integrations/*` (55 对,110 文件) | 不动(已在 02 决定保留);每篇加最小化"相关文档"(链同主题文档) |

### 验证

- `grep -c '[\x{4e00}-\x{9fff}]' README.md` < 5 (允许 product name "Dameng/达梦" 之类)
- 每篇 docs/*.md 末尾有 `## 相关文档` 章节
- `git diff --stat` 只动 README + 各 docs/README + 加 1 段 / 文件

### 不在范围

- ❌ docs/02-09 文档内容补全 → 阶段 2
- ❌ 文件名重命名 → 阶段 3
- ❌ docs/04-integrations 内部结构改动 → 不动

---

## 阶段 2:4 类文档补全(下次执行)

### 范围

#### 2.1 — v3.2.x-v3.3.0 新功能(wangyubin 加的)在 docs/ 体现

| 来源 commit | 内容 | 文档目标 |
|------------|------|---------|
| v3.3.0 (12 commits, CSV) | `export_table_csv` + `import_csv` | `docs/03-features/data-migration.md` 已建 ✅ |
| v3.2.9 (ClickHouse Bug #50-#54) | 5 个协议 bug | `docs/02-databases/clickhouse.md` 末尾加 "v3.2.9 修复" 章节 |
| v3.2.8 (mysql/oracle/sqlserver/tidb/dm Bug #28-#49) | 22 个 bug | `docs/02-databases/{mysql,oracle,sqlserver,tidb,dameng}.md` 各加 "v3.2.8 修复" 章节 |
| v3.2.7 (mongo Bug #26/#27) | multi-arg + authSource | `docs/02-databases/mongodb.md` 末尾加 "v3.2.7 修复" 章节 |
| v3.2.4-v3.2.6 (Bug #7/#8/#25) | pg cold-start + lazy-load + sqlite undefined | `docs/03-features/lazy-loading.md` 已覆盖 #7/#8;`docs/03-features/observability.md` 加 #25 章节 |
| v3.1.0 (Index Advisor) | EXPLAIN + 索引建议 + plan diff | `docs/03-features/index-advisor.md` 已建 ✅ |
| v3.0.0 (Data Governance) | schema diff / backup / audit / PII | `docs/03-features/data-governance.md` 已建 ✅ |
| v2.20.0 (multi-profile) | Profile manager + YAML I/O | `docs/03-features/multi-profile.md` 已建 ✅ |
| v2.19.0 | (未查内容) | 待补充 |
| v2.16.0 (Observability) | Prometheus /metrics + 慢查询 | `docs/03-features/observability.md` 已建 ✅ |

#### 2.2 — operations/(0 → 5 个文档)

| 新文档 | 内容 |
|--------|------|
| `monitoring-alerting.md` | Prometheus 指标接入 + 告警规则示例 + get_metrics 用法 |
| `backup-recovery.md` | export_backup / import_csv 用法 + cron / systemd timer 示例 |
| `disaster-recovery.md` | Profile 备份恢复 + schema diff + 跨 DB 容灾 |
| `upgrade-procedure.md` | npm 升级流程 + CHANGELOG 阅读 + breaking changes 注意事项 |
| `capacity-planning.md` | 连接池调优 + 慢查询 ring buffer + 缓存 TTL |

#### 2.3 — development/(5 个补充)

| 新文档 | 内容 |
|--------|------|
| `adapter-onboarding-guide.md` | 扩展 adding-database.md,加各 adapter 接入细节(checklist + 单元测试模板) |
| `testing-guide.md` | vitest 单测 + e2e(tmp-e2e/*.cjs)+ unit coverage 要求 |
| `ci-flow.md` | GitHub Actions 工作流:.github/workflows/{test,publish,docs-link-check}.yml 详解 |
| `coding-conventions.md` | TypeScript strict 模式 + Conventional Commits + 中文/英文 comment 规则 |
| `release-checklist.md` | 发版前 6 步 checklist(测试/CHANGELOG/docs/build/provenance/verify) |

#### 2.4 — reference/(5 个补充)

| 新文档 | 内容 |
|--------|------|
| `api-complete-reference.md` | 45 个 tool 完整签名(从 tool-definitions.ts 自动生成) |
| `error-codes.md` | 错误码表 + 排查步骤 |
| `performance-benchmarks.md` | 各 DB 性能基准 + 缓存效果 |
| `faq.md` | 30+ 常见问题 |
| `compatibility-matrix.md` | 11 DB × 45 tool × 7 env var 完整矩阵 |

### 验证

- 4 类文档全部新建,总数 +18 篇
- 各文档末尾有"相关文档"段
- 所有 DB 文档(v2.16-v3.3.0 期间)有 "v3.x.x 修复" 章节

---

## 阶段 3:文件名重命名(最后执行)

### 范围

- `docs/01-getting-started/installation.md` → `安装.md`
- `docs/01-getting-started/quick-start.md` → `快速开始.md`
- `docs/01-getting-started/configuration.md` → `配置说明.md`
- `docs/01-getting-started/examples.md` → `使用示例.md`
- `docs/02-databases/clickhouse.md` → `clickhouse.md`(DB 名英文保留)
- `docs/02-databases/dameng.md` → `dameng.md`(DB 名英文保留)
- ...其他 15 个 DB 文档保留英文名
- `docs/03-features/observability.md` → `可观测性.md`
- `docs/03-features/data-governance.md` → `数据治理.md`
- ...其他 6 个特性文档改中文
- `docs/04-integrations/*` 不动(55 个英文文件名 + 双文件)
- `docs/05-http-api/API_REFERENCE.md` → `api-reference.md`
- ...其他 HTTP API / deployment / development / operations / reference 文档改中文

### 验证

- `.github/workflows/docs-link-check.yml` 跑通,无 broken link
- GitHub 永久 URL 通过 redirect 处理(`.github/workflows/redirect.yml` 或 repo 设置)
- 外部 README link 全部更新到新 URL

### 不在范围

- ❌ GitHub Pages 部署 → 后续独立任务
- ❌ search index → 后续独立任务

---

## 实施约束

- 不动 CHANGELOG.md / package.json / .github/workflows/publish.yml(发版相关)
- 不动 src/ 代码
- 不动 docs/superpowers/(内部 spec/plan)
- 每次 commit 单一目的:`docs(readme): 清理英文 README 中文片段` / `docs(cross-ref): 加每篇相关文档段`
- 用中文 commit message(本仓库约定)
- 阶段 1 一次性 commit;阶段 2 / 3 按子任务 commit