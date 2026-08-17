# 文档中心

本目录包含 Universal DB MCP 的完整文档。

## 快速开始

- [安装指南](./01-getting-started/installation.md) — 安装方式
- [快速开始](./01-getting-started/quick-start.md) — 5 分钟上手
- [配置说明](./01-getting-started/configuration.md) — 配置选项
- [使用示例](./01-getting-started/examples.md) — 各数据库使用示例

## 数据库

- [数据库支持](./02-databases/README.md) — 支持的数据库列表
- [MySQL](./02-databases/mysql.md)
- [PostgreSQL](./02-databases/postgresql.md)
- [Redis](./02-databases/redis.md)
- [Oracle](./02-databases/oracle.md)
- [SQL Server](./02-databases/sqlserver.md)
- [MongoDB](./02-databases/mongodb.md)
- [SQLite](./02-databases/sqlite.md)
- [达梦](./02-databases/dameng.md)
- [KingbaseES](./02-databases/kingbase.md)
- [GaussDB](./02-databases/gaussdb.md)
- [OceanBase](./02-databases/oceanbase.md)
- [TiDB](./02-databases/tidb.md)
- [ClickHouse](./02-databases/clickhouse.md)
- [PolarDB](./02-databases/polardb.md)
- [Vastbase](./02-databases/vastbase.md)
- [HighGo](./02-databases/highgo.md)
- [GoldenDB](./02-databases/goldendb.md)

## 核心特性

- [特性索引](./03-features/README.md) — v2.16 → v3.3.0 渐进式能力
- [可观测性](./03-features/observability.md) — `/metrics` + 慢查询 (v2.16)
- [查询体验](./03-features/query-experience.md) — EXPLAIN / LINT / 历史 / 模板 (v2.17)
- [多 Profile 管理](./03-features/multi-profile.md) — Profile + YAML 导入导出 (v2.18-v2.20)
- [数据治理](./03-features/data-governance.md) — schema diff / backup / audit / PII (v3.0)
- [索引建议](./03-features/index-advisor.md) — EXPLAIN + 索引建议 + plan diff (v3.1)
- [**数据迁移（v3.3.0 新增）**](./03-features/data-migration.md) — CSV 导入导出 + 流式读写
- ~~懒加载~~ — **v4.0 已移除**,见 [MIGRATION-v4.md](./MIGRATION-v4.md)

## 第三方集成（MCP 客户端）

- [集成总览](./04-integrations/README.md) — 35+ MCP 客户端（Claude Desktop / Cursor / Cline / Cherry Studio / Coze / Dify / n8n 等）

## HTTP API

- [API 参考文档](./05-http-api/API_REFERENCE.zh-CN.md)
- [部署指南](./05-http-api/DEPLOYMENT.zh-CN.md)

## 部署

- [部署概览](./06-deployment/README.md) — 部署方式选择
- [本地部署](./06-deployment/local.md) — Node.js / PM2 / systemd
- [Docker 部署](./06-deployment/docker.md) — Dockerfile / Docker Compose
- [WSL Docker 配置](./06-deployment/wsl-docker-setup.md) — Windows WSL2 + Docker engine
- [HTTPS 配置](./06-deployment/https-domain.md) — 域名和 SSL 证书
- [云服务部署](./06-deployment/cloud/) — 华为云 / 阿里云 / AWS / 腾讯云

## 开发

- [开发总览](./07-development/README.md) — 架构 / 扩展指南
- [架构说明](./07-development/architecture.md) — Adapter / Service / Handler 三层架构
- [添加新数据库](./07-development/adding-database.md) — Adapter 接入指南
- [实现总结](./07-development/implementation.md) — 实施总结
- [连接稳定性](./07-development/connection-stability.md) — Pool 调优 / 重试 / keepalive
- [MCP 交互流程](./07-development/mcp-interaction-flow.md) — request / response / listChanged 生命周期
- [text2sql 增强](./07-development/text2sql-enhancement.md) — Prompt 优化 + LLM 路由
- [发布指南](./07-development/release.md) — GitHub Actions + Trusted Publishing

## 运维

- [运维总览](./08-operations/README.md) — 上线 / 监控 / 故障排查
- [运维指南](./08-operations/guide.md) — 日常运维
- [多租户](./08-operations/multi-tenant.md) — 多租户隔离
- [故障排查](./08-operations/troubleshooting.md) — 常见问题

## 参考

- [参考总览](./09-reference/README.md) — 参考资料
- [Changelog](./09-reference/changelog.md) — 版本历史（同步仓库根 CHANGELOG.md）
- [E2E 测试报告](./09-reference/e2e-stdio-report.md) — 11 DB × 45 tool 矩阵
- [未实现项](./09-reference/deferred-items.md) — 已知限制 / 后续工作

---

For English documentation, see [README.md](./README.md).