# v3.2.2 — Patch: docs restructure + test cleanup + CI enforcement

> Released 2026-07-25 — patch release, no API changes, fully backwards-compatible with v3.2.1.

## 修复

- **Windows test cleanup EBUSY** — `better-sqlite3` 在 Windows 下 `afterAll` 中 `unlinkSync` 时常因文件仍持锁而失败。新增 `tests/helpers/cleanup.ts` 提供 `closeAllStores()` / `safeUnlink()` / `cleanupTestArtifacts()` helper,2 个 integration 测试已迁移。顺手清理了 62 个孤儿 `.tmp-*` 文件。

## 工具 (developer)

- **`scripts/audit-docs.ts`** — TDD 实现,6 维度扫描 docs vs code 覆盖差距,输出 6 份 JSON gap report 到 `docs/09-reference/audit/`。配套 npm 脚本与 unit test。

## 文档

- **`docs/` 结构重组** — 9 个编号用户旅程目录(01-09),每个目录带 README 导航页。删除冗余 `docs/plan/`,v2.x-v3.x feature docs 统一归入 `03-features/`。
- **`CLAUDE.md`** 新建在 repo root,记录项目 AI 工作约束(pre-commit / pre-release / code style / don'ts / CI enforcement)。
- **`CONTRIBUTING.md`** 新增 `## 📦 发布流程` 章节(gh CLI + NPM Trusted Publishing OIDC)。

## CI / 自动化

- **`publish.yml` 加固**:
  - 新增 `npm test` 步骤 — 测试失败阻断 publish
  - 新增 `Verify CHANGELOG entry exists for this version` 步骤 — 防止 version bump 遗漏 CHANGELOG
  - 失败时自动评论到 GitHub Release,便于排查

## 兼容性

- 无 API 变更
- HTTP REST / MCP tool 行为完全同 v3.2.1
- 升级 3.2.1 → 3.2.2 无需任何 migration
- DB_* 环境变量、profile 配置、audit log、plan history 全部不需 reset

## 验证

- `npm test` → 533/533 passed (66 test files)
- `npm run build` → exit 0
- `git status` clean