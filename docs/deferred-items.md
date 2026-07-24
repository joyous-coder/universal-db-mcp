# Deferred Items Ledger

**Last updated:** 2026-07-24 (v3.0.0 release)

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
| 索引建议 (EXPLAIN + schema 联动) | 🟡 v3.x | 2026-07-24 | bumped from v2.17/19 → v3.x (cross-DB plan parsing) |
| Query plan diff | 🟡 v3.x | 2026-07-24 | paired with 索引建议; needs EXPLAIN history |
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
