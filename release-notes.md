## 摘要

**Universal DB MCP v5.0.0** 是一次重大版本升级，从「每次对话手动连数据库」全面转向 **profile-based 工作流**：一次配置、持久保存、随时切换、项目级自动激活。同时引入全局持久化目录、per-profile 数据隔离、PL/SQL 与多语句脚本增强，以及 8 个回归 bug 修复。

## 主要改动

### 🔥 BREAKING 变更

- **删除 `connect_database` / `disconnect_database` tool** — 用 `create_profile` + `use_profile` + `disconnect_profile` 替代。
- **`.mcp.json` 凭据 env 已废弃** (`DB_HOST` / `DB_USER` / `DB_PASSWORD` / `DB_TYPE` 等)。首次启动 stderr 一次性告警，功能静默失效。
- **移除 cwd-relative 默认路径** (`profiles.db` / `history.db` / `templates.db` / `plan_history.db`)。所有持久化统一到 `~/.universal-db-mcp/`(Windows: `%USERPROFILE%\.universal-db-mcp`)。
- **`save_profile` 重命名为 `create_profile`**（INSERT-only）；新增 `update_profile`（UPDATE-only）。旧 `save_profile` 名字仍兼容（别名）。
- **`.profile` → `.db-profile`** 项目级激活文件改名（避免和 shell/IDE 的 `.profile` 冲突）。旧文件作为 fallback 可读。

### ✨ 改进

- **每-profile 数据隔离**：`templates.db` / `history.db` / `plan_history.db` 存放到 `~/.universal-db-mcp/<profile-name>/` 子目录；切换 profile 自动切换子目录；`delete_profile` 同步清理子目录。
- **PL/SQL 块 + 多语句脚本支持**：`execute_script` 支持 `BEGIN..END` / `DECLARE..BEGIN..END` / 嵌套 IF/LOOP/CASE/WHILE，兼容 Oracle/DM/PostgreSQL/MySQL/SQL Server 方言及各自终止符。
- **Oracle adapter 保留 PL/SQL 块 trailing `;`**，只对非 PL/SQL 语句剥分号。
- **`execute_sql_file` bare filename 默认 `<cwd>/sql/``，与 csv-tools `defaultOutputPath` 一致。
- **`permissionMode: 'readwrite'` 现在包含 `batch`**：`execute_batch` 在 readwrite 下可用。
- **`use_profile` 默认同步写 `.db-profile`**，无需再显式传 `recordToProject: true`。
- **`disable_profile` 完整清 mcpServer state**，避免 stale adapter/databaseService/config 引用。
- **`loadProfile` 显式传递 `permissionMode` 到 DatabaseService**，修复 `full`/`readwrite` 被回退为 safe 的问题。

### 🐛 Bug 修复

- `generate_sample_data` NJS-098 / MAX(pk) case-insensitive（Bug #60/#60c）
- `get_enum_values` null values on Oracle（Bug #61）
- `disconnect_profile` 留 stale state（Bug #62）
- `OracleAdapter.executeBatch` 缺失 `maxBatchSize` / 空 `paramsList` 校验
- `delete_profile` 未知 name 行为变化
- `importProfiles(replace)` 内部 deleteProfile 卡 confirm

### 🧪 测试

- 新增 5 个 unit test：Oracle execute_batch 校验 + Bug #60/#60c/#61/#62 regression
- 修复 628 个 unit tests 中 46 个 v5.0.0 rename 残留失败
- 完整 smoke test：41/42 tools × 2 DBs（Oracle + DM）✅

## 迁移指南

1. 在 Claude Desktop / 其他 MCP 客户端把启动参数从旧 env 方式改为无参数启动（`npx universal-db-mcp`）。
2. 首次对话用 `create_profile` 保存数据库连接。
3. 用 `use_profile({ name: '...' })` 激活；若在当前项目目录调用，会自动生成 `.db-profile`，下次启动自动激活。
4. 旧 `.profile` 文件仍可读取，建议重命名为 `.db-profile`。

## 安装

```bash
npm install @joyous-coder/universal-db-mcp@5.0.0
```
