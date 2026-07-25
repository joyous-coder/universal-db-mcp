# 贡献指南

感谢你对 MCP 数据库万能连接器的关注！我们欢迎所有形式的贡献。

## 🤝 如何贡献

### 报告 Bug

如果你发现了 Bug，请在 [GitHub Issues](https://github.com/yourusername/universal-db-mcp/issues) 中提交，并包含：

- 详细的问题描述
- 复现步骤
- 预期行为 vs 实际行为
- 环境信息（操作系统、Node.js 版本、数据库版本）

### 提交功能建议

我们欢迎新功能建议！请先在 Issues 中讨论，确保该功能符合项目方向。

### 提交代码

1. **Fork 本仓库**
2. **创建特性分支**: `git checkout -b feature/amazing-feature`
3. **编写代码**: 遵循下面的代码规范
4. **提交更改**: `git commit -m '添加某某功能'`
5. **推送分支**: `git push origin feature/amazing-feature`
6. **创建 Pull Request**

## 📝 代码规范

- 使用 TypeScript 严格模式
- 关键架构决策需要添加中文注释
- 用户可见的消息必须使用简体中文
- 遵循现有的代码风格

## 🔌 添加新数据库支持

如果你想添加新的数据库支持（如 MongoDB、SQLite），请按以下步骤：

1. 在 `src/adapters/` 下创建新文件（如 `mongodb.ts`）
2. 实现 `DbAdapter` 接口
3. 在 `src/index.ts` 中添加对应的 case 分支
4. 在 `src/types/adapter.ts` 中更新类型定义
5. 更新 `README.md` 的支持列表
6. 添加相应的 npm 依赖

### 参考示例

可以参考现有的适配器实现：
- **MySQL** (`src/adapters/mysql.ts`) - SQL 数据库的基础模式
- **PostgreSQL** (`src/adapters/postgres.ts`) - 复杂的 Schema 查询
- **Redis** (`src/adapters/redis.ts`) - NoSQL 数据库的适配
- **Oracle** (`src/adapters/oracle.ts`) - 企业级数据库的完整实现
- **达梦** (`src/adapters/dm.ts`) - 国产数据库适配，兼容 Oracle
- **SQL Server** (`src/adapters/sqlserver.ts`) - 微软数据库，支持 Azure SQL
- **MongoDB** (`src/adapters/mongodb.ts`) - 文档型 NoSQL 数据库
- **SQLite** (`src/adapters/sqlite.ts`) - 轻量级嵌入式数据库
- **KingbaseES** (`src/adapters/kingbase.ts`) - 国产数据库，兼容 PostgreSQL
- **GaussDB** (`src/adapters/gaussdb.ts`) - 华为国产数据库，兼容 PostgreSQL
- **OceanBase** (`src/adapters/oceanbase.ts`) - 分布式数据库，兼容 MySQL
- **TiDB** (`src/adapters/tidb.ts`) - 分布式 NewSQL 数据库，兼容 MySQL 5.7
- **ClickHouse** (`src/adapters/clickhouse.ts`) - 列式 OLAP 数据库，使用 HTTP 协议
- **PolarDB** (`src/adapters/polardb.ts`) - 云原生数据库，兼容 MySQL
- **Vastbase** (`src/adapters/vastbase.ts`) - 国产数据库，兼容 PostgreSQL
- **HighGo** (`src/adapters/highgo.ts`) - 国产数据库，兼容 PostgreSQL
- **GoldenDB** (`src/adapters/goldendb.ts`) - 国产分布式数据库，兼容 MySQL

### 示例结构

```typescript
// src/adapters/mongodb.ts
import type { DbAdapter, QueryResult, SchemaInfo } from '../types/adapter.js';

export class MongoDBAdapter implements DbAdapter {
  async connect(): Promise<void> {
    // 实现连接逻辑
  }

  async disconnect(): Promise<void> {
    // 实现断开连接逻辑
  }

  async executeQuery(query: string, params?: unknown[]): Promise<QueryResult> {
    // 实现查询逻辑
  }

  async getSchema(): Promise<SchemaInfo> {
    // 实现获取结构逻辑
  }

  isWriteOperation(query: string): boolean {
    // 实现写操作检测
  }
}
```

## ✅ 提交前检查清单

- [ ] 代码通过 TypeScript 编译 (`npm run build`)
- [ ] 关键逻辑添加了中文注释
- [ ] 用户可见消息使用简体中文
- [ ] 更新了相关文档
- [ ] 测试了基本功能

## 📦 发布流程

本项目通过 GitHub Actions + NPM Trusted Publishing 自动发布，**无需 `NPM_TOKEN` secret**。

### 维护者发布步骤

1. **本地准备**
   ```bash
   # 修改 package.json 的 version 字段（手动或 npm version <major|minor|patch>）
   # 在 CHANGELOG.md 顶部加新版本条目
   git add package.json CHANGELOG.md
   git commit -m "chore(release): vX.Y.Z — <summary>"
   git tag vX.Y.Z
   ```

2. **推送**
   ```bash
   git push origin main
   git push origin vX.Y.Z
   ```

3. **创建 GitHub Release**（触发 `.github/workflows/publish.yml`）
   ```bash
   # 准备 release notes（推荐从 CHANGELOG 提炼）
   gh release create vX.Y.Z \
     --title "vX.Y.Z — <short summary>" \
     --notes-file release-notes.md \
     --target main \
     --verify-tag
   ```

4. **监控 publish workflow**
   ```bash
   gh run list --workflow=publish.yml --limit 1
   # 若未自动触发（罕见），手动触发：
   gh workflow run publish.yml --ref vX.Y.Z
   ```

5. **验证**
   ```bash
   gh release view vX.Y.Z
   # 访问 https://www.npmjs.com/package/@joyous-coder/universal-db-mcp
   ```

### 发布机制说明

- **触发条件**: `.github/workflows/publish.yml` 监听 GitHub Release `created` 事件
- **认证**: NPM Trusted Publishing via OIDC（无需 `NPM_TOKEN` secret）
- **包来源**: `@joyous-coder/universal-db-mcp`（public 访问）
- **Provenance**: 自动启用（`--provenance` 标志），npmjs.com 显示构建来源

### 版本号规范

- 遵循 [Semantic Versioning](https://semver.org/)
- `major.minor.patch`：`X.Y.Z`
- 重大不兼容 → major；新功能（向后兼容）→ minor；bug 修复 → patch

### 发布前检查清单

- [ ] 所有测试通过 (`npm test`)
- [ ] 构建成功 (`npm run build`)
- [ ] CHANGELOG.md **顶部**新增当前版本的 `## [vX.Y.Z] - YYYY-MM-DD` 条目（**强约束**：publish.yml 会校验缺失则发布失败）
- [ ] README 反映最新功能
- [ ] 没有未提交的本地修改 (`git status` clean)

> **CI 强制项**（v3.2.1+）：publish.yml 现在会运行 `npm test` 并校验 CHANGELOG.md。失败则 **不会发布**（无 partial / silent release）。完整约束清单见 [`CLAUDE.md`](./CLAUDE.md) § "AI Work Constraints"。

## 📄 许可证

提交代码即表示你同意将代码以 MIT 许可证开源。

## 💬 联系方式

如有疑问，欢迎在 Issues 中讨论或联系维护者。

---

再次感谢你的贡献！🎉
