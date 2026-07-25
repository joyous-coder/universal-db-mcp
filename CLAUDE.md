# CLAUDE.md

This file provides AI coding agents with project-specific context and work constraints.

## Project Snapshot

- **Name**: `@joyous-coder/universal-db-mcp`
- **Purpose**: MCP server connecting Claude Desktop (or any MCP client) to 17 database types (MySQL/PostgreSQL/Oracle/SQL Server/DM/Kingbase/GaussDB/MongoDB/Redis/SQLite/ClickHouse/etc.)
- **Language**: TypeScript (Node 20+)
- **Runtime modes**: stdio (Claude Desktop) | HTTP REST | MCP SSE / Streamable HTTP
- **Latest release**: see GitHub Releases (v3.2.1 as of 2026-07-25)

## Release Process

This project publishes via GitHub Actions + NPM Trusted Publishing (OIDC). **No NPM_TOKEN secret required**.

**Full step-by-step guide**: see [`CONTRIBUTING.md`](./CONTRIBUTING.md) § "📦 发布流程".

**Quick summary**:
1. Bump `version` in `package.json` + add CHANGELOG entry → `git commit` → `git tag vX.Y.Z`
2. `git push origin main` + `git push origin vX.Y.Z`
3. `gh release create vX.Y.Z --notes-file release-notes.md --verify-tag`
4. `.github/workflows/publish.yml` (trigger: `release: created`) auto-runs `npm publish --provenance --access public`
5. Verify via `gh release view vX.Y.Z` + check npmjs.com

**If workflow doesn't auto-trigger** (rare):
```bash
gh workflow run publish.yml --ref vX.Y.Z
```

**Do NOT use manual `npm login` + `npm publish`** — bypasses Trusted Publishing OIDC and breaks the provenance chain.

## AI Work Constraints

When working on this codebase, AI agents (Claude Code, etc.) **must** follow these rules:

### Pre-commit / Pre-PR

- [ ] **All tests pass**: `npm test` exits 0 (don't ship green CI breakages)
- [ ] **TypeScript compiles**: `npm run build` exits 0
- [ ] **No untracked working tree**: `git status` clean before commit
- [ ] **CHANGELOG.md updated**: if the change affects user-visible behavior, add an entry under "未发布" (unreleased) or the current dev version

### Pre-release (cutting a new version)

- [ ] **CHANGELOG.md has a version entry** for the version being released (publish.yml checks this — see below)
- [ ] **Version bump committed**: `package.json` version matches the git tag
- [ ] **Release notes written**: prepare a `release-notes.md` file before `gh release create`
- [ ] **No `.tmp-*` test scratch files** committed (`.gitignore` should exclude; check if any slipped through)

### Code Style

- **User-visible strings**: 简体中文 (Simplified Chinese). Examples: tool descriptions, error messages, console.error output.
- **Internal code comments**: 中文 for architectural decisions; English for routine comments.
- **Commit message prefix**: `feat:` / `fix:` / `refactor:` / `test:` / `docs:` / `chore:` / `perf:` (Conventional Commits style)
- **TS strict mode**: required. No `any` in new code unless wrapping an untyped legacy API.
- **YAGNI**: don't add features "for later". If a feature isn't immediately used, don't build it.

### Don'ts

- ❌ **Don't publish without testing** — `publish.yml` runs tests; failed tests block the publish.
- ❌ **Don't bump version in CHANGELOG without bumping `package.json`** (and vice versa) — publish.yml cross-checks.
- ❌ **Don't add dependencies** to `dependencies` for optional features. Use `optionalDependencies`.
- ❌ **Don't bypass the publish workflow** by manually running `npm publish` — breaks provenance.
- ❌ **Don't commit credentials** (DB passwords, API keys). Profiles store credentials in `profiles.db` (gitignored) — never in code.

### CI Enforcement

The following constraints are **enforced by `.github/workflows/publish.yml`** (not just docs):

- Tests must pass before `npm publish` runs (otherwise the workflow fails and the package is not pushed)
- `CHANGELOG.md` must contain an entry matching the `package.json` version (otherwise the workflow fails)
- Build must produce a `dist/` directory (otherwise the workflow fails)

If the publish fails, the version is **not** pushed to npmjs.com. No partial / silent releases.

## Project Memory

For Claude session context, see the project memory at `.claude/projects/D--Links-Tools-universal-db-mcp/memory/publish-flow.md`.