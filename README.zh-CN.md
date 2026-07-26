<p align="center">
  <img src="assets/logo.png" alt="Universal DB MCP Logo" width="200">
</p>

<h1 align="center">Universal DB MCP</h1>
<p align="center">
  <strong>用自然语言连接 AI 与你的数据库</strong>
</p>

<p align="center">
  一个实现了模型上下文协议（MCP）和 HTTP API 的通用数据库连接器，让 AI 助手能够使用自然语言查询和分析你的数据库。支持 Claude Desktop、Cursor、Windsurf、VS Code、ChatGPT 等 50+ 平台。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/universal-db-mcp"><img src="https://img.shields.io/npm/v/universal-db-mcp.svg?style=flat-square&color=blue" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/universal-db-mcp"><img src="https://img.shields.io/npm/dm/universal-db-mcp.svg?style=flat-square&color=green" alt="npm downloads"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen?style=flat-square" alt="Node.js Version"></a>
  <a href="https://github.com/Anarkh-Lee/universal-db-mcp/stargazers"><img src="https://img.shields.io/github/stars/Anarkh-Lee/universal-db-mcp?style=flat-square" alt="GitHub Stars"></a>
</p>

<p align="center">
  <a href="#-特性">特性</a> •
  <a href="#-快速开始">快速开始</a> •
  <a href="#-支持的数据库">数据库</a> •
  <a href="#-文档">文档</a> •
  <a href="#-贡献">贡献</a>
</p>

<p align="center">
  <a href="./README.md">English</a> | <a href="./README.zh-CN.md">中文文档</a>
</p>

---

## 🆕 v3.3.0 最新动态

- **CSV 导入 / 导出** (`export_table_csv` + `import_csv`) — 流式导出单表为 CSV，支持 `WHERE` / `ORDER BY` / `LIMIT` / `OFFSET` 过滤；批量入库到已存在表。RFC 4180 序列化，路径白名单复用 `DB_ALLOWED_FILE_PATHS`。
- **11 种数据库 × 43 个 tool × 2 个 CSV tool** = **45 个 tool × 11 DB** 全链路 e2e 覆盖，514 个 unit tests PASS。
- **ClickHouse 协议 bug 修复 (v3.2.9)** — 修复 5 个生产级 bug：`format:JSONEachRow` 影响 INSERT、命名参数重写、UInt64→Number 转换、`execute_script`/`execute_batch` BEGIN 路径、`execute_batch` 对象数组处理。
- **达梦 (DM) export_backup (v3.2.8)** — 用 `ALL_TABLES` + `ALL_TAB_COLUMNS` 替代 `INFORMATION_SCHEMA`；`generate_sample_data` 不再为 `id` 列返回 NULL。
- **MongoDB 认证 (v3.2.7)** — 自动注入 `authSource=admin`；多参 `db.collection.method(args)` 解析修复。
- **17 种 adapter, 11 种 e2e 验证** — sqlite / redis / mongodb / postgres / mysql / oracle / sqlserver / tidb / dm / clickhouse。详见 [e2e 报告](docs/09-reference/e2e-stdio-report.md)。

---

## 为什么选择 Universal DB MCP？

想象一下，你问 AI 助手：*"帮我查一下这个月订单金额最高的 10 个客户"*，然后立即从数据库获得结果——无需编写 SQL。Universal DB MCP 通过模型上下文协议（MCP）和 HTTP API 将 AI 助手与你的数据库连接起来，让这一切成为可能。

```
你: "最近 30 天注册用户的平均订单金额是多少？"

AI: 让我帮你查询一下...

┌─────────────────────────────────────┐
│ 平均订单金额: ¥127.45               │
│ 新用户总数: 1,247                   │
│ 有订单的用户: 892 (71.5%)           │
└─────────────────────────────────────┘
```

## ✨ 特性

- **支持 17 种数据库** - MySQL、PostgreSQL、Redis、Oracle、SQL Server、MongoDB、SQLite，以及 10 种国产数据库
- **适配 55+ 平台** - 支持 Claude Desktop、Cursor、VS Code、ChatGPT、Dify 等 [50+ 平台](#-支持的平台)
- **灵活架构** - 2 种启动模式（stdio/http），4 种接入方式：MCP stdio、MCP SSE、MCP Streamable HTTP、REST API
- **安全第一** - 默认只读模式，防止意外的数据修改
- **智能缓存** - Schema 缓存支持可配置的 TTL，性能极速
- **批量查询优化** - 大型数据库的 Schema 获取速度提升高达 100 倍
- **Schema 增强** - 表注释、隐式关系推断，提升 Text2SQL 准确性
- **多 Schema 支持** - 自动发现所有用户 Schema（PostgreSQL、SQL Server、Oracle、达梦等）
- **数据迁移** - SQL 备份 (`export_backup`) + **CSV 导入导出 (v3.3.0)** RFC 4180 序列化,分页读 + 批量写（[文档](docs/03-features/data-migration.md)）
- **数据脱敏** - 自动保护敏感数据（手机号、邮箱、身份证、银行卡等）
- **连接稳定性** - 连接池、TCP Keep-Alive、断线自动重试，保障长时间会话稳定运行
- **生产可观测性** - Prometheus `/metrics` 端点 + MCP `get_metrics` 工具 + 慢查询环形 buffer，零新依赖（[文档](docs/03-features/observability.md)）
- **数据治理** - Profile 备份恢复 (`export_profiles` / `import_profiles`)、Schema diff、PII 脱敏、审计日志（[文档](docs/03-features/data-governance.md)）

### 性能提升

| 表数量 | 优化前 | 优化后 | 提升 |
|--------|--------|--------|------|
| 50 张表 | ~5 秒 | ~200 毫秒 | **25 倍** |
| 100 张表 | ~10 秒 | ~300 毫秒 | **33 倍** |
| 500 张表 | ~50 秒 | ~500 毫秒 | **100 倍** |

## 🚀 快速开始

### 安装

```bash
npm install -g @joyous-coder/universal-db-mcp
```

### MCP 模式（Claude Desktop）

将以下配置添加到 Claude Desktop 配置文件：

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "my-database": {
      "command": "npx",
      "args": [
        "universal-db-mcp",
        "--type", "mysql",
        "--host", "localhost",
        "--port", "3306",
        "--user", "root",
        "--password", "your_password",
        "--database", "your_database"
      ]
    }
  }
}
```

重启 Claude Desktop，然后开始提问：

- *"帮我查看 users 表的结构"*
- *"统计最近 7 天的订单数量"*
- *"找出销量最高的 5 个产品"*

### HTTP API 模式

```bash
# 设置环境变量
export MODE=http
export HTTP_PORT=3000
export API_KEYS=your-secret-key

# 启动服务
npx @joyous-coder/universal-db-mcp
```

```bash
# 测试 API
curl http://localhost:3000/api/health
```

### MCP SSE 模式（Dify 和远程访问）

在 HTTP 模式下运行时，服务器还会通过 SSE（Server-Sent Events）和 Streamable HTTP 暴露 MCP 协议端点。这使得 Dify 等平台可以直接使用 MCP 协议连接。

**SSE 端点（传统方式）：**
```
GET http://localhost:3000/sse?type=mysql&host=localhost&port=3306&user=root&password=xxx&database=mydb
```

**Streamable HTTP 端点（MCP 2025 规范，推荐）：**
```
POST http://localhost:3000/mcp
请求头：
  X-DB-Type: mysql
  X-DB-Host: localhost
  X-DB-Port: 3306
  X-DB-User: root
  X-DB-Password: your_password
  X-DB-Database: your_database
请求体：MCP JSON-RPC 请求
```

| 端点 | 方法 | 说明 |
|------|------|------|
| `/sse` | GET | 建立 SSE 连接（传统方式） |
| `/sse/message` | POST | 向 SSE 会话发送消息 |
| `/mcp` | POST | Streamable HTTP 端点（推荐） |
| `/mcp` | GET | Streamable HTTP 的 SSE 流 |
| `/mcp` | DELETE | 关闭会话 |

详细配置说明请参阅 [Dify 集成指南](./docs/04-integrations/DIFY.zh-CN.md)。

## 📊 支持的数据库

| 数据库 | 类型参数 | 默认端口 | 分类 |
|--------|----------|----------|------|
| MySQL | `mysql` | 3306 | 开源 |
| PostgreSQL | `postgres` | 5432 | 开源 |
| Redis | `redis` | 6379 | NoSQL |
| Oracle | `oracle` | 1521 | 商业 |
| SQL Server | `sqlserver` | 1433 | 商业 |
| MongoDB | `mongodb` | 27017 | NoSQL |
| SQLite | `sqlite` | - | 嵌入式 |
| 达梦 | `dm` | 5236 | 国产 |
| 人大金仓 | `kingbase` | 54321 | 国产 |
| 华为 GaussDB | `gaussdb` | 5432 | 国产 |
| 蚂蚁 OceanBase | `oceanbase` | 2881 | 国产 |
| TiDB | `tidb` | 4000 | 分布式 |
| ClickHouse | `clickhouse` | 8123 | OLAP |
| 阿里云 PolarDB | `polardb` | 3306 | 云数据库 |
| 海量 Vastbase | `vastbase` | 5432 | 国产 |
| 瀚高 HighGo | `highgo` | 5866 | 国产 |
| 中兴 GoldenDB | `goldendb` | 3306 | 国产 |

## 🏗️ 架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Universal DB MCP                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  启动模式：                                                               │
│  ┌────────────────────────────┬────────────────────────────────────┐    │
│  │ stdio 模式                 │ http 模式                          │    │
│  │ (npm run start:mcp)        │ (npm run start:http)               │    │
│  └─────────────┬──────────────┴───────────────┬────────────────────┘    │
│                │                              │                          │
│                ▼                              ▼                          │
│  ┌─────────────────────────┐    ┌───────────────────────────────────┐   │
│  │      MCP 协议           │    │           HTTP 服务器             │   │
│  │    (stdio 传输)         │    │                                   │   │
│  │                         │    │  ┌─────────────────────────────┐  │   │
│  │  工具：                 │    │  │       MCP 协议              │  │   │
│  │  • execute_query        │    │  │  (SSE / Streamable HTTP)    │  │   │
│  │  • get_schema           │    │  │                             │  │   │
│  │  • get_table_info       │    │  │  工具：（与 stdio 相同）    │  │   │
│  │  • clear_cache          │    │  │  • execute_query            │  │   │
│  │  • get_enum_values      │    │  │  • get_schema               │  │   │
│  │  • get_sample_data      │    │  │  • get_table_info           │  │   │
│  │  • connect_database     │    │  │  • clear_cache              │  │   │
│  │  • disconnect_database  │    │  │  • get_enum_values          │  │   │
│  │  • get_connection_status│    │  │  • get_sample_data          │  │   │
│  │                         │    │  │  • connect_database         │  │   │
│  │  适用：Claude Desktop,  │    │  │  • disconnect_database      │  │   │
│  │        Cursor 等        │    │  │  • get_connection_status    │  │   │
│  └─────────────┬───────────┘    │  │                             │  │   │
│                │                │  │  适用：Dify、远程访问       │  │   │
│                │                │  └──────────────┬──────────────┘  │   │
│                │                │                 │                 │   │
│                │                │  ┌──────────────┴──────────────┐  │   │
│                │                │  │        REST API             │  │   │
│                │                │  │                             │  │   │
│                │                │  │  端点：                     │  │   │
│                │                │  │  • /api/connect             │  │   │
│                │                │  │  • /api/query               │  │   │
│                │                │  │  • /api/schema              │  │   │
│                │                │  │  • ...（10+ 端点）          │  │   │
│                │                │  │                             │  │   │
│                │                │  │  适用：Coze、n8n、自定义    │  │   │
│                │                │  └──────────────┬──────────────┘  │   │
│                │                └─────────────────┼─────────────────┘   │
│                │                                  │                     │
│                └──────────────────┬───────────────┘                     │
│                                   ▼                                     │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                       核心业务逻辑层                               │  │
│  │  • 查询执行          • Schema 缓存                               │  │
│  │  • 安全校验          • 连接管理                                  │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     ▼                                   │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                      数据库适配器层                                │  │
│  │  MySQL │ PostgreSQL │ Redis │ Oracle │ MongoDB │ SQLite │ ...    │  │
│  │          （连接池 + TCP Keep-Alive + 断线自动重试）               │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## 🔒 安全

默认情况下，Universal DB MCP 运行在**只读模式**，会阻止所有写操作（INSERT、UPDATE、DELETE、DROP 等）。

### 权限模式

支持细粒度权限控制，可根据需求灵活配置：

| 模式 | 允许的操作 | 说明 |
|------|-----------|------|
| `safe`（默认） | SELECT | 只读，最安全 |
| `readwrite` | SELECT, INSERT, UPDATE | 读写但不能删除 |
| `full` | 所有操作 | 完全控制（危险！） |
| `custom` | 自定义组合 | 通过 `--permissions` 指定 |

**权限类型：**
- `read` - SELECT 查询（始终包含）
- `insert` - INSERT, REPLACE
- `update` - UPDATE
- `delete` - DELETE, TRUNCATE
- `ddl` - CREATE, ALTER, DROP, RENAME

**使用示例：**

```bash
# 只读模式（默认）
npx @joyous-coder/universal-db-mcp --type mysql ...

# 读写但不能删除
npx @joyous-coder/universal-db-mcp --type mysql --permission-mode readwrite ...

# 自定义：只允许读和插入
npx @joyous-coder/universal-db-mcp --type mysql --permissions read,insert ...

# 完全控制（等价于原来的 --danger-allow-write）
npx @joyous-coder/universal-db-mcp --type mysql --permission-mode full ...
```

**不同传输方式的权限配置：**

> ⚠️ 不同传输方式的参数命名风格不同，请注意区分！

| 传输方式 | 参数位置 | 权限模式参数 | 自定义权限参数 |
|---------|---------|-------------|---------------|
| STDIO (Claude Desktop) | 命令行 | `--permission-mode` | `--permissions` |
| SSE (Dify 等) | URL Query | `permissionMode` | `permissions` |
| Streamable HTTP | HTTP Header | `X-DB-Permission-Mode` | `X-DB-Permissions` |
| REST API | JSON Body | `permissionMode` | `permissions` |

**最佳实践：**
- 生产环境永远不要启用写入模式
- 使用专用的只读数据库账号
- 通过 VPN 或跳板机连接
- 定期审计查询日志

## 🔌 支持的平台

Universal DB MCP 可与任何支持 MCP 协议或 REST API 的平台配合使用。以下是完整列表：

### AI 代码编辑器 & IDE

| 平台 | 接入方式 | 说明 | 集成指南 |
|------|----------|------|----------|
| [Cursor](https://cursor.sh/) | MCP stdio | 内置 MCP 支持的 AI 代码编辑器 | [EN](./docs/04-integrations/CURSOR.md) / [中文](./docs/04-integrations/CURSOR.zh-CN.md) |
| [Windsurf](https://codeium.com/windsurf) | MCP stdio | Codeium 的 AI IDE，带 Cascade 智能体 | [EN](./docs/04-integrations/WINDSURF.md) / [中文](./docs/04-integrations/WINDSURF.zh-CN.md) |
| [VS Code](https://code.visualstudio.com/) | MCP stdio / REST API | 通过 GitHub Copilot 代理模式或 Cline/Continue 扩展 | [EN](./docs/04-integrations/VSCODE.md) / [中文](./docs/04-integrations/VSCODE.zh-CN.md) |
| [Zed](https://zed.dev/) | MCP stdio | 高性能开源代码编辑器 | [EN](./docs/04-integrations/ZED.md) / [中文](./docs/04-integrations/ZED.zh-CN.md) |
| [IntelliJ IDEA](https://www.jetbrains.com/idea/) | MCP stdio | JetBrains IDE，支持 MCP（2025.1+） | [EN](./docs/04-integrations/JETBRAINS.md) / [中文](./docs/04-integrations/JETBRAINS.zh-CN.md) |
| [PyCharm](https://www.jetbrains.com/pycharm/) | MCP stdio | JetBrains Python IDE | [EN](./docs/04-integrations/JETBRAINS.md) / [中文](./docs/04-integrations/JETBRAINS.zh-CN.md) |
| [WebStorm](https://www.jetbrains.com/webstorm/) | MCP stdio | JetBrains JavaScript IDE | [EN](./docs/04-integrations/JETBRAINS.md) / [中文](./docs/04-integrations/JETBRAINS.zh-CN.md) |
| [Android Studio](https://developer.android.com/studio) | MCP stdio | 通过 JetBrains MCP 插件 | [EN](./docs/04-integrations/JETBRAINS.md) / [中文](./docs/04-integrations/JETBRAINS.zh-CN.md) |
| [Neovim](https://neovim.io/) | MCP stdio | 通过 MCPHub.nvim 插件 | [EN](./docs/04-integrations/NEOVIM.md) / [中文](./docs/04-integrations/NEOVIM.zh-CN.md) |
| [Emacs](https://www.gnu.org/software/emacs/) | MCP stdio | 通过 mcp.el 包 | [EN](./docs/04-integrations/EMACS.md) / [中文](./docs/04-integrations/EMACS.zh-CN.md) |

### AI 编程助手

| 平台 | 接入方式 | 说明 | 集成指南 |
|------|----------|------|----------|
| [Claude Code](https://claude.ai/code) | MCP stdio | Anthropic 的智能编程工具 | [EN](./docs/04-integrations/CLAUDE-CODE.md) / [中文](./docs/04-integrations/CLAUDE-CODE.zh-CN.md) |
| [GitHub Copilot](https://github.com/features/copilot) | MCP stdio | VS Code/JetBrains 中的代理模式 | [EN](./docs/04-integrations/GITHUB-COPILOT.md) / [中文](./docs/04-integrations/GITHUB-COPILOT.zh-CN.md) |
| [Cline](https://github.com/cline/cline) | MCP stdio / REST API | VS Code 自主编程智能体 | [EN](./docs/04-integrations/CLINE.md) / [中文](./docs/04-integrations/CLINE.zh-CN.md) |
| [Continue](https://continue.dev/) | MCP stdio | 开源 AI 代码助手 | [EN](./docs/04-integrations/CONTINUE.md) / [中文](./docs/04-integrations/CONTINUE.zh-CN.md) |
| [Roo Code](https://github.com/roovet/roo-code) | MCP stdio | Cline 的 VS Code 分支 | [EN](./docs/04-integrations/ROO-CODE.md) / [中文](./docs/04-integrations/ROO-CODE.zh-CN.md) |
| [Sourcegraph Cody](https://sourcegraph.com/cody) | MCP stdio | AI 编程助手 | [EN](./docs/04-integrations/SOURCEGRAPH-CODY.md) / [中文](./docs/04-integrations/SOURCEGRAPH-CODY.zh-CN.md) |
| [Amazon Q Developer](https://aws.amazon.com/q/developer/) | MCP stdio | AWS AI 编程助手 | [EN](./docs/04-integrations/AMAZON-Q-DEVELOPER.md) / [中文](./docs/04-integrations/AMAZON-Q-DEVELOPER.zh-CN.md) |
| [Devin](https://devin.ai/) | MCP stdio | AI 软件工程师 | [EN](./docs/04-integrations/DEVIN.md) / [中文](./docs/04-integrations/DEVIN.zh-CN.md) |
| [Goose](https://github.com/block/goose) | MCP stdio | Block 的 AI 编程智能体 | [EN](./docs/04-integrations/GOOSE.md) / [中文](./docs/04-integrations/GOOSE.zh-CN.md) |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | MCP stdio | Google 命令行 AI 工具 | [EN](./docs/04-integrations/GEMINI-CLI.md) / [中文](./docs/04-integrations/GEMINI-CLI.zh-CN.md) |

### 桌面 AI 聊天应用

| 平台 | 接入方式 | 说明 | 集成指南 |
|------|----------|------|----------|
| [Claude Desktop](https://claude.ai/download) | MCP stdio | Anthropic 官方桌面应用 | [EN](./docs/04-integrations/CLAUDE-DESKTOP.md) / [中文](./docs/04-integrations/CLAUDE-DESKTOP.zh-CN.md) |
| [ChatGPT Desktop](https://openai.com/chatgpt/desktop/) | MCP SSE/Streamable HTTP | OpenAI 桌面应用，支持 MCP 连接器 | [EN](./docs/04-integrations/CHATGPT.md) / [中文](./docs/04-integrations/CHATGPT.zh-CN.md) |
| [Cherry Studio](https://github.com/kangfenmao/cherry-studio) | MCP stdio | 多模型桌面聊天应用 | [EN](./docs/04-integrations/CHERRY-STUDIO.md) / [中文](./docs/04-integrations/CHERRY-STUDIO.zh-CN.md) |
| [LM Studio](https://lmstudio.ai/) | MCP stdio | 本地运行 LLM，支持 MCP | [EN](./docs/04-integrations/LM-STUDIO.md) / [中文](./docs/04-integrations/LM-STUDIO.zh-CN.md) |
| [Jan](https://jan.ai/) | MCP stdio | 开源 ChatGPT 替代品 | [EN](./docs/04-integrations/JAN.md) / [中文](./docs/04-integrations/JAN.zh-CN.md) |
| [Msty](https://msty.app/) | MCP stdio | 桌面 AI 聊天应用 | [EN](./docs/04-integrations/MSTY.md) / [中文](./docs/04-integrations/MSTY.zh-CN.md) |
| [LibreChat](https://github.com/danny-avila/LibreChat) | MCP stdio | 开源聊天界面 | [EN](./docs/04-integrations/LIBRECHAT.md) / [中文](./docs/04-integrations/LIBRECHAT.zh-CN.md) |
| [Witsy](https://witsy.app/) | MCP stdio | 桌面 AI 助手 | [EN](./docs/04-integrations/WITSY.md) / [中文](./docs/04-integrations/WITSY.zh-CN.md) |
| [5ire](https://github.com/5ire-tech/5ire) | MCP stdio | 跨平台 AI 聊天 | [EN](./docs/04-integrations/5IRE.md) / [中文](./docs/04-integrations/5IRE.zh-CN.md) |
| [ChatMCP](https://github.com/daodao97/chatmcp) | MCP stdio | MCP 专用聊天界面 | [EN](./docs/04-integrations/CHATMCP.md) / [中文](./docs/04-integrations/CHATMCP.zh-CN.md) |
| [HyperChat](https://github.com/BigSweetPotatoStudio/HyperChat) | MCP stdio | 多平台聊天应用 | [EN](./docs/04-integrations/HYPERCHAT.md) / [中文](./docs/04-integrations/HYPERCHAT.zh-CN.md) |
| [Tome](https://github.com/runebook/tome) | MCP stdio | macOS 本地 LLM 应用 | [EN](./docs/04-integrations/TOME.md) / [中文](./docs/04-integrations/TOME.zh-CN.md) |

### Web AI 平台

| 平台 | 接入方式 | 说明 | 集成指南 |
|------|----------|------|----------|
| [Claude.ai](https://claude.ai/) | MCP SSE/Streamable HTTP | Anthropic 网页界面 | [EN](./docs/04-integrations/CLAUDE-AI.md) / [中文](./docs/04-integrations/CLAUDE-AI.zh-CN.md) |
| [ChatGPT](https://chat.openai.com/) | MCP SSE/Streamable HTTP | 通过自定义连接器 | [EN](./docs/04-integrations/CHATGPT.md) / [中文](./docs/04-integrations/CHATGPT.zh-CN.md) |
| [Dify](https://dify.ai/) | MCP SSE/Streamable HTTP | LLM 应用开发平台 | [EN](./docs/04-integrations/DIFY.md) / [中文](./docs/04-integrations/DIFY.zh-CN.md) |
| [Coze](https://www.coze.com/) | REST API | 字节跳动 AI 机器人平台 | [EN](./docs/04-integrations/COZE.md) / [中文](./docs/04-integrations/COZE.zh-CN.md) |
| [n8n](https://n8n.io/) | REST API / MCP | 工作流自动化平台 | [EN](./docs/04-integrations/N8N.md) / [中文](./docs/04-integrations/N8N.zh-CN.md) |
| [Replit](https://replit.com/) | MCP stdio | 在线 IDE，带 AI 智能体 | [EN](./docs/04-integrations/REPLIT.md) / [中文](./docs/04-integrations/REPLIT.zh-CN.md) |
| [MindPal](https://mindpal.io/) | MCP SSE/Streamable HTTP | 无代码 AI 智能体构建器 | [EN](./docs/04-integrations/MINDPAL.md) / [中文](./docs/04-integrations/MINDPAL.zh-CN.md) |

### 智能体框架 & SDK

| 平台 | 接入方式 | 说明 | 集成指南 |
|------|----------|------|----------|
| [LangChain](https://langchain.com/) | MCP stdio | 流行的 LLM 框架 | [EN](./docs/04-integrations/LANGCHAIN.md) / [中文](./docs/04-integrations/LANGCHAIN.zh-CN.md) |
| [Smolagents](https://github.com/huggingface/smolagents) | MCP stdio | Hugging Face 智能体库 | [EN](./docs/04-integrations/SMOLAGENTS.md) / [中文](./docs/04-integrations/SMOLAGENTS.zh-CN.md) |
| [OpenAI Agents SDK](https://platform.openai.com/) | MCP SSE/Streamable HTTP | OpenAI 智能体框架 | [EN](./docs/04-integrations/OPENAI-AGENTS-SDK.md) / [中文](./docs/04-integrations/OPENAI-AGENTS-SDK.zh-CN.md) |
| [Amazon Bedrock Agents](https://aws.amazon.com/bedrock/) | MCP SSE/Streamable HTTP | AWS AI 智能体服务 | [EN](./docs/04-integrations/AMAZON-BEDROCK-AGENTS.md) / [中文](./docs/04-integrations/AMAZON-BEDROCK-AGENTS.zh-CN.md) |
| [Google ADK](https://cloud.google.com/) | MCP stdio | Google 智能体开发套件 | [EN](./docs/04-integrations/GOOGLE-ADK.md) / [中文](./docs/04-integrations/GOOGLE-ADK.zh-CN.md) |
| [Vercel AI SDK](https://sdk.vercel.ai/) | MCP stdio | Vercel AI 开发套件 | [EN](./docs/04-integrations/VERCEL-AI-SDK.md) / [中文](./docs/04-integrations/VERCEL-AI-SDK.zh-CN.md) |
| [Spring AI](https://spring.io/projects/spring-ai) | MCP stdio | Java/Spring AI 框架 | [EN](./docs/04-integrations/SPRING-AI.md) / [中文](./docs/04-integrations/SPRING-AI.zh-CN.md) |

### CLI 工具 & 终端

| 平台 | 接入方式 | 说明 | 集成指南 |
|------|----------|------|----------|
| [Claude Code CLI](https://claude.ai/code) | MCP stdio | 终端编程智能体 | [EN](./docs/04-integrations/CLAUDE-CODE.md) / [中文](./docs/04-integrations/CLAUDE-CODE.zh-CN.md) |
| [Warp](https://www.warp.dev/) | MCP stdio | AI 驱动的终端 | [EN](./docs/04-integrations/WARP.md) / [中文](./docs/04-integrations/WARP.zh-CN.md) |
| [Oterm](https://github.com/ggozad/oterm) | MCP stdio | 通过 CLI 与 Ollama 聊天 | [EN](./docs/04-integrations/OTERM.md) / [中文](./docs/04-integrations/OTERM.zh-CN.md) |
| [MCPHost](https://github.com/mark3labs/mcphost) | MCP stdio | CLI LLM 聊天工具 | [EN](./docs/04-integrations/MCPHOST.md) / [中文](./docs/04-integrations/MCPHOST.zh-CN.md) |

### 效率 & 自动化工具

| 平台 | 接入方式 | 说明 | 集成指南 |
|------|----------|------|----------|
| [Raycast](https://raycast.com/) | MCP stdio | macOS 效率启动器 | [EN](./docs/04-integrations/RAYCAST.md) / [中文](./docs/04-integrations/RAYCAST.zh-CN.md) |
| [Notion](https://notion.so/) | MCP SSE/Streamable HTTP | 带 AI 集成的工作空间 | [EN](./docs/04-integrations/NOTION.md) / [中文](./docs/04-integrations/NOTION.zh-CN.md) |
| [Obsidian](https://obsidian.md/) | MCP stdio | 通过 MCP Tools 插件 | [EN](./docs/04-integrations/OBSIDIAN.md) / [中文](./docs/04-integrations/OBSIDIAN.zh-CN.md) |
| [Home Assistant](https://www.home-assistant.io/) | MCP stdio | 智能家居平台 | [EN](./docs/04-integrations/HOME-ASSISTANT.md) / [中文](./docs/04-integrations/HOME-ASSISTANT.zh-CN.md) |

### 即时通讯平台集成

| 平台 | 接入方式 | 说明 | 集成指南 |
|------|----------|------|----------|
| [Slack](https://slack.com/) | MCP stdio / REST API | 通过 Slack MCP 机器人 | [EN](./docs/04-integrations/SLACK.md) / [中文](./docs/04-integrations/SLACK.zh-CN.md) |
| [Discord](https://discord.com/) | MCP stdio / REST API | 通过 Discord MCP 机器人 | [EN](./docs/04-integrations/DISCORD.md) / [中文](./docs/04-integrations/DISCORD.zh-CN.md) |
| [Mattermost](https://mattermost.com/) | MCP stdio | 开源即时通讯 | [EN](./docs/04-integrations/MATTERMOST.md) / [中文](./docs/04-integrations/MATTERMOST.zh-CN.md) |

### 本地 LLM 运行器

| 平台 | 接入方式 | 说明 | 集成指南 |
|------|----------|------|----------|
| [Ollama](https://ollama.ai/) | MCP stdio | 本地运行 LLM | [EN](./docs/04-integrations/OLLAMA.md) / [中文](./docs/04-integrations/OLLAMA.zh-CN.md) |
| [LM Studio](https://lmstudio.ai/) | MCP stdio | 本地 LLM 桌面应用 | [EN](./docs/04-integrations/LM-STUDIO.md) / [中文](./docs/04-integrations/LM-STUDIO.zh-CN.md) |
| [Jan](https://jan.ai/) | MCP stdio | 离线 ChatGPT 替代品 | [EN](./docs/04-integrations/JAN.md) / [中文](./docs/04-integrations/JAN.zh-CN.md) |

### 开发 & 测试工具

| 平台 | 接入方式 | 说明 | 集成指南 |
|------|----------|------|----------|
| [MCP Inspector](https://github.com/modelcontextprotocol/inspector) | MCP stdio | 官方 MCP 调试工具 | [EN](./docs/04-integrations/MCP-INSPECTOR.md) / [中文](./docs/04-integrations/MCP-INSPECTOR.zh-CN.md) |
| [Postman](https://postman.com/) | REST API / MCP | API 测试平台 | [EN](./docs/04-integrations/POSTMAN.md) / [中文](./docs/04-integrations/POSTMAN.zh-CN.md) |

> **提示**：任何 MCP 兼容客户端都可以通过 stdio（本地）或 SSE/Streamable HTTP（远程）连接。任何 HTTP 客户端都可以使用 REST API。

## 📚 文档

### 快速开始
- [安装指南](./docs/01-getting-started/installation.md)
- [快速开始](./docs/01-getting-started/quick-start.md)
- [配置说明](./docs/01-getting-started/configuration.md)
- [使用示例](./docs/01-getting-started/examples.md)

### 部署
- [部署概览](./docs/06-deployment/README.md)
- [本地部署](./docs/06-deployment/local.md)
- [Docker 部署](./docs/06-deployment/docker.md)
- [云服务部署](./docs/06-deployment/cloud/)

### 数据库指南
- [数据库支持概览](./docs/02-databases/README.md)
- [MySQL](./docs/02-databases/mysql.md)
- [PostgreSQL](./docs/02-databases/postgresql.md)
- [ClickHouse](./docs/02-databases/clickhouse.md)（v3.2.9 — 修复 5 个协议 bug）
- [达梦 (DM)](./docs/02-databases/dameng.md)（v3.2.8 — 备份 + 样例数据修复）
- [MongoDB](./docs/02-databases/mongodb.md)（v3.2.7 — authSource + 多参解析）
- [更多数据库...](./docs/02-databases/)

### 功能特性
- [数据治理](./docs/03-features/data-governance.md) — Profile 备份、Schema diff、PII、审计
- [数据迁移](./docs/03-features/data-migration.md) — **CSV 导入导出 (v3.3.0)** + SQL 备份
- [多 Profile](./docs/03-features/multi-profile.md) — 多 DB 路由、Schema 聚合
- [可观测性](./docs/03-features/observability.md) — Prometheus + 慢查询环形 buffer

### HTTP API
- [API 参考](./docs/05-http-api/API_REFERENCE.md)
- [部署指南](./docs/05-http-api/DEPLOYMENT.md)

### 集成

**AI 编辑器 & IDE：**
[Cursor](./docs/04-integrations/CURSOR.zh-CN.md) |
[VS Code](./docs/04-integrations/VSCODE.zh-CN.md) |
[JetBrains](./docs/04-integrations/JETBRAINS.zh-CN.md) |
[Windsurf](./docs/04-integrations/WINDSURF.zh-CN.md) |
[Zed](./docs/04-integrations/ZED.zh-CN.md) |
[Neovim](./docs/04-integrations/NEOVIM.zh-CN.md) |
[Emacs](./docs/04-integrations/EMACS.zh-CN.md)

**AI 助手：**
[Claude Desktop](./docs/04-integrations/CLAUDE-DESKTOP.zh-CN.md) |
[Claude Code](./docs/04-integrations/CLAUDE-CODE.zh-CN.md) |
[GitHub Copilot](./docs/04-integrations/GITHUB-COPILOT.zh-CN.md) |
[Cline](./docs/04-integrations/CLINE.zh-CN.md) |
[Continue](./docs/04-integrations/CONTINUE.zh-CN.md)

**AI 平台：**
[Dify](./docs/04-integrations/DIFY.zh-CN.md) |
[Coze](./docs/04-integrations/COZE.zh-CN.md) |
[n8n](./docs/04-integrations/N8N.zh-CN.md) |
[ChatGPT](./docs/04-integrations/CHATGPT.zh-CN.md) |
[LangChain](./docs/04-integrations/LANGCHAIN.zh-CN.md)

**桌面应用：**
[Cherry Studio](./docs/04-integrations/CHERRY-STUDIO.zh-CN.md) |
[LM Studio](./docs/04-integrations/LM-STUDIO.zh-CN.md) |
[Jan](./docs/04-integrations/JAN.zh-CN.md) |
[Ollama](./docs/04-integrations/OLLAMA.zh-CN.md)

**即时通讯：**
[Slack](./docs/04-integrations/SLACK.zh-CN.md) |
[Discord](./docs/04-integrations/DISCORD.zh-CN.md)

**工具：**
[MCP Inspector](./docs/04-integrations/MCP-INSPECTOR.zh-CN.md) |
[Postman](./docs/04-integrations/POSTMAN.zh-CN.md)

> 📁 [查看全部 55+ 个集成指南](./docs/04-integrations/) | English version: remove `.zh-CN` from filename

### 进阶
- [安全指南](./docs/08-operations/multi-tenant.md) (security section)
- [多租户指南](./docs/08-operations/multi-tenant.md)
- [架构说明](./docs/07-development/architecture.md)
- [故障排查](./docs/08-operations/troubleshooting.md)

## 🤝 贡献

欢迎贡献代码！请在提交 Pull Request 之前阅读我们的[贡献指南](./CONTRIBUTING.md)。

```bash
# 克隆仓库
git clone https://github.com/Anarkh-Lee/universal-db-mcp.git

# 安装依赖
npm install

# 构建
npm run build

# 运行测试
npm test
```

## 📄 许可证

本项目采用 [MIT 许可证](./LICENSE)。

## 🌟 Star 历史

如果你觉得这个项目有用，请考虑给它一个 Star！你的支持帮助我们持续改进 Universal DB MCP。

[![Star History Chart](https://api.star-history.com/svg?repos=Anarkh-Lee/universal-db-mcp&type=Date)](https://star-history.com/#Anarkh-Lee/universal-db-mcp&Date)

## 📝 更新日志

详见 [CHANGELOG.md](./CHANGELOG.md) 了解详细的版本历史。

---

<p align="center">
  由 <a href="https://github.com/Anarkh-Lee">Anarkh-Lee</a> 用 ❤️ 打造
</p>
