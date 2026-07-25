# CLAUDE.md

This file provides AI coding agents with project-specific context.

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

For Claude session context, see the project memory at `.claude/projects/D--Links-Tools-universal-db-mcp/memory/publish-flow.md`.