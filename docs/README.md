# Documentation

This directory contains the complete documentation for Universal DB MCP.

## Quick Start

- [Installation](./01-getting-started/installation.md) — How to install
- [Quick Start](./01-getting-started/quick-start.md) — Get started in 5 minutes
- [Configuration](./01-getting-started/configuration.md) — Configuration options
- [Examples](./01-getting-started/examples.md) — Usage examples for all databases

## Databases

- [Overview](./02-databases/README.md) — Supported databases
- [MySQL](./02-databases/mysql.md)
- [PostgreSQL](./02-databases/postgresql.md)
- [Redis](./02-databases/redis.md)
- [Oracle](./02-databases/oracle.md)
- [SQL Server](./02-databases/sqlserver.md)
- [MongoDB](./02-databases/mongodb.md)
- [SQLite](./02-databases/sqlite.md)
- [Dameng (达梦)](./02-databases/dameng.md)
- [KingbaseES](./02-databases/kingbase.md)
- [GaussDB](./02-databases/gaussdb.md)
- [OceanBase](./02-databases/oceanbase.md)
- [TiDB](./02-databases/tidb.md)
- [ClickHouse](./02-databases/clickhouse.md)
- [PolarDB](./02-databases/polardb.md)
- [Vastbase](./02-databases/vastbase.md)
- [HighGo](./02-databases/highgo.md)
- [GoldenDB](./02-databases/goldendb.md)

## Core Features

- [Overview](./03-features/README.md) — Progressive feature lineage v2.16 → v3.3.0
- [Observability](./03-features/observability.md) — `/metrics` + 慢查询 (v2.16)
- [Query Experience](./03-features/query-experience.md) — EXPLAIN / LINT / history / templates (v2.17)
- [Multi-Profile](./03-features/multi-profile.md) — Profile manager + YAML I/O (v2.18-v2.20)
- [Data Governance](./03-features/data-governance.md) — schema diff / backup / audit / PII (v3.0)
- [Index Advisor](./03-features/index-advisor.md) — EXPLAIN + 索引建议 + plan diff (v3.1)
- [Lazy Loading](./03-features/lazy-loading.md) — 4 group lazy load + meta-tool (v3.2)
- [**Data Migration (NEW v3.3.0)**](./03-features/data-migration.md) — CSV import/export + streaming

## Integrations (MCP Clients)

- [Overview](./04-integrations/README.md) — 35+ MCP clients (Claude Desktop / Cursor / Cline / Cherry Studio / Coze / Dify / n8n / etc.)

## HTTP API

- [API Reference](./05-http-api/API_REFERENCE.md)
- [Deployment Guide](./05-http-api/DEPLOYMENT.md)

## Deployment

- [Overview](./06-deployment/README.md) — Deployment options overview
- [Local Deployment](./06-deployment/local.md) — Node.js / PM2 / systemd
- [Docker Deployment](./06-deployment/docker.md) — Dockerfile / Docker Compose
- [WSL Docker Setup](./06-deployment/wsl-docker-setup.md) — Windows WSL2 + Docker engine
- [HTTPS Configuration](./06-deployment/https-domain.md) — Domain and SSL setup
- [Cloud Deployment](./06-deployment/cloud/) — Huawei Cloud / Aliyun / AWS / Tencent

## Development

- [Overview](./07-development/README.md) — Architecture / how to extend
- [Architecture](./07-development/architecture.md) — Adapter / Service / Handler 三层架构
- [Adding a New Database](./07-development/adding-database.md) — Adapter 接入指南
- [Implementation Summary](./07-development/implementation.md) — 实施总结
- [Connection Stability](./07-development/connection-stability.md) — Pool tuning / retry / keepalive
- [MCP Interaction Flow](./07-development/mcp-interaction-flow.md) — request / response / listChanged 生命周期
- [text2sql Enhancement](./07-development/text2sql-enhancement.md) — Prompt 优化 + LLM 路由
- [Release Guide](./07-development/release.md) — GitHub Actions + Trusted Publishing

## Operations

- [Overview](./08-operations/README.md) — 上线 / 监控 / 故障排查
- [Operations Guide](./08-operations/guide.md) — 日常运维
- [Multi-tenant](./08-operations/multi-tenant.md) — 多租户隔离
- [Troubleshooting](./08-operations/troubleshooting.md) — 常见问题

## Reference

- [Overview](./09-reference/README.md) — Reference material
- [Changelog](./09-reference/changelog.md) — Version history (mirror of repo root CHANGELOG.md)
- [E2E Stdio Test Report](./09-reference/e2e-stdio-report.md) — 11 DB × 45 tool matrix
- [Deferred Items](./09-reference/deferred-items.md) — Known limitations / future work

---

For Chinese documentation, see [README.zh-CN.md](./README.zh-CN.md).