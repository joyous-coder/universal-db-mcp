<p align="center">
  <img src="assets/logo.png" alt="Universal DB MCP Logo" width="200">
</p>

<h1 align="center">Universal DB MCP</h1>

<p align="center">
  <strong>Connect AI to Your Database with Natural Language</strong>
</p>

<p align="center">
  A universal database connector implementing the Model Context Protocol (MCP) and HTTP API, enabling AI assistants to query and analyze your databases using natural language. Works with Claude Desktop, Cursor, Windsurf, VS Code, ChatGPT, and 50+ other platforms.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@joyous-coder/universal-db-mcp"><img src="https://img.shields.io/npm/v/@joyous-coder/universal-db-mcp.svg?style=flat-square&color=blue" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@joyous-coder/universal-db-mcp"><img src="https://img.shields.io/npm/dm/@joyous-coder/universal-db-mcp.svg?style=flat-square&color=green" alt="npm downloads"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen?style=flat-square" alt="Node.js Version"></a>
  <a href="https://github.com/Anarkh-Lee/universal-db-mcp/stargazers"><img src="https://img.shields.io/github/stars/Anarkh-Lee/universal-db-mcp?style=flat-square" alt="GitHub Stars"></a>
</p>

<p align="center">
  <a href="#-features">Features</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-supported-databases">Databases</a> •
  <a href="#-documentation">Docs</a> •
  <a href="#-contributing">Contributing</a>
</p>

<p align="center">
  <a href="./README.md">English</a> | <a href="./README.zh-CN.md">中文文档</a>
</p>

---

## 🆕 What's New in v4.0.3 (latest)

- **`get_table_info` 50-100× 提速** (Oracle 60-90s → 526-866ms;DM 30-60s → 696-852ms) — 新增 `DbAdapter.getTableInfo?(tableName)` 4 SQL 单表查询路径,跳过 `getSchema` 全表扫描
- **`generate_sample_data` 主键智能生成** — IDENTITY 列自动跳过 (DB 自填)、`CHAR(36)/VARCHAR2(36)` UUID PK 生成 uuid v4、非 IDENTITY `INT/NUMBER PK` 用 `MAX(pk) + rowIndex + 1` 避免冲突、Oracle `NUMBER` 类型 regex 修复 (`ORA-01722`)
- **DM `get_table_info` Bug #15** — `ALL_IND_COLUMNS` join 列名错 + 裸名表 owner fallback
- **41 tools** × Oracle + DM e2e 验证 (参见 `docs/04-reports/`);**553 unit tests** / 0 failed
- 完整变更日志见 [CHANGELOG.md](./CHANGELOG.md);Release notes 见 [GitHub Releases](https://github.com/joyous-coder/universal-db-mcp/releases)

---

## 🆕 What's New in v3.3.0

- **CSV Import / Export** (`export_table_csv` + `import_csv`) — stream single tables to CSV with `WHERE` / `ORDER BY` / `LIMIT` / `OFFSET` filtering; import back to existing tables in batches. RFC 4180 serialization, `DB_ALLOWED_FILE_PATHS` whitelist.
- **11 databases × 43 tools × 2 CSV tools** = **45 tool × 11 DB** e2e coverage, 514 unit tests pass.
- **ClickHouse protocol fixes (v3.2.9)** — fixed 5 production bugs: `format:JSONEachRow` breaking INSERT, named-param rewriting, UInt64→Number coercion, `execute_script`/`execute_batch` BEGIN path, `execute_batch` object-array handling.
- **DM (达梦) export_backup (v3.2.8)** — uses `ALL_TABLES` + `ALL_TAB_COLUMNS` (replaces `INFORMATION_SCHEMA`); `generate_sample_data` no longer returns NULL for `id` columns.
- **MongoDB auth (v3.2.7)** — auto-injects `authSource=admin`; multi-arg `db.collection.method(args)` parses.
- **17 adapters, 11 e2e-verified** — sqlite / redis / mongodb / postgres / mysql / oracle / sqlserver / tidb / dm / clickhouse. See [e2e report](docs/09-reference/e2e-stdio-report.md).

---

## Why Universal DB MCP?

Imagine asking your AI assistant: *"Show me the top 10 customers by order value this month"* and getting instant results from your database - no SQL writing required. Universal DB MCP makes this possible by bridging AI assistants with your databases through the Model Context Protocol (MCP) and HTTP API.

```
You: "What's the average order value for users who signed up in the last 30 days?"

AI: Let me query that for you...

┌─────────────────────────────────────┐
│ Average Order Value: $127.45        │
│ Total New Users: 1,247              │
│ Users with Orders: 892 (71.5%)      │
└─────────────────────────────────────┘
```

## ✨ Features

- **17 Database Support** - MySQL, PostgreSQL, Redis, Oracle, SQL Server, MongoDB, SQLite, and 10 Chinese domestic databases
- **55+ Platform Integrations** - Works with Claude Desktop, Cursor, VS Code, ChatGPT, Dify, and [50+ other platforms](#-supported-platforms)
- **41 MCP Tools** - Connection, query, schema, profile, template, governance, sample-data, PII, audit ([full list](#-available-tools-41-total))
- **Flexible Architecture** - 2 startup modes (stdio/http) with 4 access methods: MCP stdio, MCP SSE, MCP Streamable HTTP, and REST API
- **Security First** - Read-only mode by default prevents accidental data modifications
- **Intelligent Caching** - Schema caching with configurable TTL for blazing-fast performance
- **50-100× `get_table_info` (v4.0.3)** - Per-table metadata path for Oracle/DM, skips full schema scan ([release notes](https://github.com/joyous-coder/universal-db-mcp/releases))
- **Batch Query Optimization** - Up to 100x faster schema retrieval for large databases
- **Schema Enhancement** - Table comments, implicit relationship inference for better Text2SQL accuracy
- **Multi-Schema Support** - Automatic discovery of all user schemas (PostgreSQL, SQL Server, Oracle, DM, and more)
- **Data Migration** - SQL backup (`export_backup`) + **CSV import/export (v3.3.0)** with RFC 4180 serialization, partitioned reads, batched writes ([docs](docs/03-features/data-migration.md))
- **Data Masking** - Automatic sensitive data protection (phone, email, ID card, bank card, etc.)
- **Connection Stability** - Connection pooling, TCP Keep-Alive, and automatic reconnection for long-running sessions
- **Production Observability** - Prometheus `/metrics` endpoint + MCP `get_metrics` tool + slow-query ring buffer, zero new dependencies ([docs](docs/03-features/observability.md))
- **Data Governance** - Profile backup/restore (`export_profiles` / `import_profiles`), schema diff, PII masking, audit log ([docs](docs/03-features/data-governance.md))
- **Smart Sample Data (v4.0.3)** - `generate_sample_data` auto-detects PK type: IDENTITY (skip), UUID (uuid v4), INT/NUMBER (`MAX+rowIndex+1`)

### Performance Improvements

| Operation | Before | After | Improvement |
|-----------|--------|-------|-------------|
| `get_table_info` (Oracle) | 60-90s | 526-866ms | **50-100×** |
| `get_table_info` (DM) | 30-60s | 696-852ms | **50-100×** |
| `get_sample_data` / `get_enum_values` | 30-60s | ~150ms | **200×** |
| Schema cache (50 tables) | ~5s | ~200ms | **25×** |
| Schema cache (500 tables) | ~50s | ~500ms | **100×** |

## 🛠️ Available Tools (41 total)

### Connection (4)
| Tool | Description |
|------|-------------|
| `connect_database` | Connect to a database with credentials + permission mode (`safe` |
| `disconnect_database` | Close the current database connection |
| `get_connection_status` | Show connection state, schema cache hit rate, last error |
| `get_metrics` | Prometheus-style counters + histograms + slow-query ring buffer |

### Query / Schema (7)
| Tool | Description |
|------|-------------|
| `execute_query` | Run SQL with bound `?` params (SQL injection safe) |
| `execute_script` | Multi-statement SQL / PL block execution (script permission) |
| `execute_batch` | Single SQL × multiple param sets (1000-row batch limit) |
| `get_table_info` | Single-table metadata — **50-100× faster than v3.x** (per-table SQL path) |
| `get_sample_data` | N sample rows with PII auto-masking |
| `get_enum_values` | Unique values + counts for enum-like columns |
| `clear_cache` | Invalidate the schema cache |

### Data Generation / Templates (5)
| Tool | Description |
|------|-------------|
| `generate_sample_data` | Smart sample data insertion — auto-detects **IDENTITY PK** (skip), **UUID PK** (uuid v4), **INT PK** (MAX+sequence);`rules` API for column-level overrides |
| `save_template` | Save parameterized SQL template (`${name}` placeholders) |
| `list_templates` | List templates with tag search |
| `get_template` | Fetch one template by id |
| `delete_template` | Delete a template |
| `execute_template` | Run a template with params (safe substitution) |

### Profile Management (6)
| Tool | Description |
|------|-------------|
| `save_profile` | Save named connection profile (credentials encrypted at rest) |
| `list_profiles` | List with role/tag/enabled filters |
| `get_profile` | Fetch one profile |
| `use_profile` | Switch active connection (works without current DB connection) |
| `enable_profile` / `disable_profile` | Toggle profile active state |
| `delete_profile` | Delete a profile |
| `disconnect_profile` | Disconnect a profile without deleting |
| `export_profiles` | Dump all profiles (passwords REDACTED by default) |
| `import_profiles` | Restore profiles from YAML/JSON |

### Data Governance (6)
| Tool | Description |
|------|-------------|
| `set_pii_config` | Set per-table/per-column PII masking rules |
| `get_pii_config` | View current PII rules |
| `audit_log` | Query recorded query history (filters: db, kind, since, until, onlyErrors) |
| `get_query_history` | Same data via analytics-friendly API |
| `explain_query` | Get EXPLAIN plan only (no advice) |
| `explain_query_with_advice` | EXPLAIN + index-tuning hints |
| `lint_sql` | Static SQL analysis (issues / warnings) |
| `list_query_plans` | List captured EXPLAIN plans by query hash |
| `compare_query_plans` | Diff two plans for the same query hash |

### SQL File / Sample Data (3)
| Tool | Description |
|------|-------------|
| `execute_sql_file` | Run a `.sql` file from `DB_ALLOWED_FILE_PATHS` whitelist (script permission) |
| `export_backup` | Dump schema as SQL DDL to a file |
| `import_csv` / `export_table_csv` | RFC 4180 CSV import/export with `WHERE/ORDER BY/LIMIT` filter |

### Legacy / Removed (v4.0)
- ❌ `use_tool_group` — removed (lazy-load removed in v4.0)
- ❌ `use_tool_schema` — removed (full schemas in `tools/list` now)

See [tools reference](./docs/03-features/tools.md) for parameter details.

## 🚀 Quick Start

### Installation

```bash
npm install -g @joyous-coder/universal-db-mcp
```

### MCP Mode (Claude Desktop)

Add to your Claude Desktop configuration file:

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

Restart Claude Desktop and start asking questions:

- *"Show me the structure of the users table"*
- *"Count orders from the last 7 days"*
- *"Find the top 5 products by sales"*

### HTTP API Mode

```bash
# Set environment variables
export MODE=http
export HTTP_PORT=3000
export API_KEYS=your-secret-key

# Start the server
npx @joyous-coder/universal-db-mcp
```

```bash
# Test the API
curl http://localhost:3000/api/health
```

### MCP SSE Mode (Dify and Remote Access)

When running in HTTP mode, the server also exposes MCP protocol endpoints via SSE (Server-Sent Events) and Streamable HTTP. This allows platforms like Dify to connect using the MCP protocol directly.

**SSE Endpoint (Legacy):**
```
GET http://localhost:3000/sse?type=mysql&host=localhost&port=3306&user=root&password=xxx&database=mydb
```

**Streamable HTTP Endpoint (MCP 2025 Spec, Recommended):**
```
POST http://localhost:3000/mcp
Headers:
  X-DB-Type: mysql
  X-DB-Host: localhost
  X-DB-Port: 3306
  X-DB-User: root
  X-DB-Password: your_password
  X-DB-Database: your_database
Body: MCP JSON-RPC request
```

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/sse` | GET | Establish SSE connection (legacy) |
| `/sse/message` | POST | Send message to SSE session |
| `/mcp` | POST | Streamable HTTP endpoint (recommended) |
| `/mcp` | GET | SSE stream for Streamable HTTP |
| `/mcp` | DELETE | Close session |

See [Dify Integration Guide](./docs/04-integrations/DIFY.md) for detailed setup instructions.

## 📊 Supported Databases

| Database | Type | Default Port | Category |
|----------|------|--------------|----------|
| MySQL | `mysql` | 3306 | Open Source |
| PostgreSQL | `postgres` | 5432 | Open Source |
| Redis | `redis` | 6379 | NoSQL |
| Oracle | `oracle` | 1521 | Commercial |
| SQL Server | `sqlserver` | 1433 | Commercial |
| MongoDB | `mongodb` | 27017 | NoSQL |
| SQLite | `sqlite` | - | Embedded |
| Dameng (达梦) | `dm` | 5236 | Chinese |
| KingbaseES | `kingbase` | 54321 | Chinese |
| GaussDB | `gaussdb` | 5432 | Chinese (Huawei) |
| OceanBase | `oceanbase` | 2881 | Chinese (Ant) |
| TiDB | `tidb` | 4000 | Distributed |
| ClickHouse | `clickhouse` | 8123 | OLAP |
| PolarDB | `polardb` | 3306 | Cloud (Alibaba) |
| Vastbase | `vastbase` | 5432 | Chinese |
| HighGo | `highgo` | 5866 | Chinese |
| GoldenDB | `goldendb` | 3306 | Chinese (ZTE) |

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Universal DB MCP                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Startup Modes:                                                          │
│  ┌────────────────────────────┬────────────────────────────────────┐    │
│  │ stdio mode                 │ http mode                          │    │
│  │ (npm run start:mcp)        │ (npm run start:http)               │    │
│  └─────────────┬──────────────┴───────────────┬────────────────────┘    │
│                │                              │                          │
│                ▼                              ▼                          │
│  ┌─────────────────────────┐    ┌───────────────────────────────────┐   │
│  │      MCP Protocol       │    │           HTTP Server             │   │
│  │    (stdio transport)    │    │                                   │   │
│  │                         │    │  ┌─────────────────────────────┐  │   │
│  │  Tools:                 │    │  │      MCP Protocol           │  │   │
│  │  • execute_query        │    │  │  (SSE / Streamable HTTP)    │  │   │
│  │  • get_schema           │    │  │                             │  │   │
│  │  • get_table_info       │    │  │  Tools: (same as stdio)     │  │   │
│  │  • clear_cache          │    │  │  • execute_query            │  │   │
│  │  • get_enum_values      │    │  │  • get_schema               │  │   │
│  │  • get_sample_data      │    │  │  • get_table_info           │  │   │
│  │  • connect_database     │    │  │  • clear_cache              │  │   │
│  │  • disconnect_database  │    │  │  • get_enum_values          │  │   │
│  │  • get_connection_status│    │  │  • get_sample_data          │  │   │
│  │                         │    │  │  • connect_database         │  │   │
│  │  For: Claude Desktop,   │    │  │  • disconnect_database      │  │   │
│  │       Cursor, etc.      │    │  │  • get_connection_status    │  │   │
│  └─────────────┬───────────┘    │  │                             │  │   │
│                │                │  │  For: Dify, Remote Access   │  │   │
│                │                │  └──────────────┬──────────────┘  │   │
│                │                │                 │                 │   │
│                │                │  ┌──────────────┴──────────────┐  │   │
│                │                │  │        REST API             │  │   │
│                │                │  │                             │  │   │
│                │                │  │  Endpoints:                 │  │   │
│                │                │  │  • /api/connect             │  │   │
│                │                │  │  • /api/query               │  │   │
│                │                │  │  • /api/schema              │  │   │
│                │                │  │  • ... (10+ endpoints)      │  │   │
│                │                │  │                             │  │   │
│                │                │  │  For: Coze, n8n, Custom     │  │   │
│                │                │  └──────────────┬──────────────┘  │   │
│                │                └─────────────────┼─────────────────┘   │
│                │                                  │                     │
│                └──────────────────┬───────────────┘                     │
│                                   ▼                                     │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                     Core Business Logic                           │  │
│  │  • Query Execution    • Schema Caching                           │  │
│  │  • Safety Validation  • Connection Management                    │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     ▼                                   │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    Database Adapter Layer                         │  │
│  │  MySQL │ PostgreSQL │ Redis │ Oracle │ MongoDB │ SQLite │ ...    │  │
│  │        (Connection Pool + TCP Keep-Alive + Auto-Retry)           │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## 🔒 Security

By default, Universal DB MCP runs in **read-only mode**, blocking all write operations (INSERT, UPDATE, DELETE, DROP, etc.).

### Permission Modes

Fine-grained permission control is supported for flexible configuration:

| Mode | Allowed Operations | Description |
|------|-------------------|-------------|
| `safe` (default) | SELECT | Read-only, safest |
| `readwrite` | SELECT, INSERT, UPDATE | Read/write but no delete |
| `full` | All operations | Full control (dangerous!) |
| `custom` | Custom combination | Specify via `--permissions` |

**Permission Types:**
- `read` - SELECT queries (always included)
- `insert` - INSERT, REPLACE
- `update` - UPDATE
- `delete` - DELETE, TRUNCATE
- `ddl` - CREATE, ALTER, DROP, RENAME

**Usage Examples:**

```bash
# Read-only mode (default)
npx @joyous-coder/universal-db-mcp --type mysql ...

# Read/write but no delete
npx @joyous-coder/universal-db-mcp --type mysql --permission-mode readwrite ...

# Custom: only read and insert
npx @joyous-coder/universal-db-mcp --type mysql --permissions read,insert ...

# Full control (equivalent to --danger-allow-write)
npx @joyous-coder/universal-db-mcp --type mysql --permission-mode full ...
```

**Permission Configuration by Transport:**

> ⚠️ Different transports use different parameter naming conventions!

| Transport | Parameter Location | Permission Mode | Custom Permissions |
|-----------|-------------------|-----------------|-------------------|
| STDIO (Claude Desktop) | CLI args | `--permission-mode` | `--permissions` |
| SSE (Dify, etc.) | URL Query | `permissionMode` | `permissions` |
| Streamable HTTP | HTTP Header | `X-DB-Permission-Mode` | `X-DB-Permissions` |
| REST API | JSON Body | `permissionMode` | `permissions` |

**Best Practices:**
- Never enable write mode in production
- Use dedicated read-only database accounts
- Connect through VPN or bastion hosts
- Regularly audit query logs

## 🔌 Supported Platforms

Universal DB MCP works with any platform that supports the MCP protocol or REST API. Here's a comprehensive list:

### AI-Powered Code Editors & IDEs

| Platform | Access Method | Description | Guide |
|----------|---------------|-------------|-------|
| [Cursor](https://cursor.sh/) | MCP stdio | AI-powered code editor with built-in MCP support | [EN](./docs/04-integrations/CURSOR.md) / [中文](./docs/04-integrations/CURSOR.zh-CN.md) |
| [Windsurf](https://codeium.com/windsurf) | MCP stdio | Codeium's AI IDE with Cascade agent | [EN](./docs/04-integrations/WINDSURF.md) / [中文](./docs/04-integrations/WINDSURF.zh-CN.md) |
| [VS Code](https://code.visualstudio.com/) | MCP stdio / REST API | Via GitHub Copilot agent mode or Cline/Continue extensions | [EN](./docs/04-integrations/VSCODE.md) / [中文](./docs/04-integrations/VSCODE.zh-CN.md) |
| [Zed](https://zed.dev/) | MCP stdio | High-performance open-source code editor | [EN](./docs/04-integrations/ZED.md) / [中文](./docs/04-integrations/ZED.zh-CN.md) |
| [IntelliJ IDEA](https://www.jetbrains.com/idea/) | MCP stdio | JetBrains IDE with MCP support (2025.1+) | [EN](./docs/04-integrations/JETBRAINS.md) / [中文](./docs/04-integrations/JETBRAINS.zh-CN.md) |
| [PyCharm](https://www.jetbrains.com/pycharm/) | MCP stdio | JetBrains Python IDE | [EN](./docs/04-integrations/JETBRAINS.md) / [中文](./docs/04-integrations/JETBRAINS.zh-CN.md) |
| [WebStorm](https://www.jetbrains.com/webstorm/) | MCP stdio | JetBrains JavaScript IDE | [EN](./docs/04-integrations/JETBRAINS.md) / [中文](./docs/04-integrations/JETBRAINS.zh-CN.md) |
| [Android Studio](https://developer.android.com/studio) | MCP stdio | Via JetBrains MCP plugin | [EN](./docs/04-integrations/JETBRAINS.md) / [中文](./docs/04-integrations/JETBRAINS.zh-CN.md) |
| [Neovim](https://neovim.io/) | MCP stdio | Via MCPHub.nvim plugin | [EN](./docs/04-integrations/NEOVIM.md) / [中文](./docs/04-integrations/NEOVIM.zh-CN.md) |
| [Emacs](https://www.gnu.org/software/emacs/) | MCP stdio | Via mcp.el package | [EN](./docs/04-integrations/EMACS.md) / [中文](./docs/04-integrations/EMACS.zh-CN.md) |

### AI Coding Assistants

| Platform | Access Method | Description | Guide |
|----------|---------------|-------------|-------|
| [Claude Code](https://claude.ai/code) | MCP stdio | Anthropic's agentic coding tool | [EN](./docs/04-integrations/CLAUDE-CODE.md) / [中文](./docs/04-integrations/CLAUDE-CODE.zh-CN.md) |
| [GitHub Copilot](https://github.com/features/copilot) | MCP stdio | Agent mode in VS Code/JetBrains | [EN](./docs/04-integrations/GITHUB-COPILOT.md) / [中文](./docs/04-integrations/GITHUB-COPILOT.zh-CN.md) |
| [Cline](https://github.com/cline/cline) | MCP stdio / REST API | Autonomous coding agent for VS Code | [EN](./docs/04-integrations/CLINE.md) / [中文](./docs/04-integrations/CLINE.zh-CN.md) |
| [Continue](https://continue.dev/) | MCP stdio | Open-source AI code assistant | [EN](./docs/04-integrations/CONTINUE.md) / [中文](./docs/04-integrations/CONTINUE.zh-CN.md) |
| [Roo Code](https://github.com/roovet/roo-code) | MCP stdio | Fork of Cline for VS Code | [EN](./docs/04-integrations/ROO-CODE.md) / [中文](./docs/04-integrations/ROO-CODE.zh-CN.md) |
| [Sourcegraph Cody](https://sourcegraph.com/cody) | MCP stdio | AI coding assistant | [EN](./docs/04-integrations/SOURCEGRAPH-CODY.md) / [中文](./docs/04-integrations/SOURCEGRAPH-CODY.zh-CN.md) |
| [Amazon Q Developer](https://aws.amazon.com/q/developer/) | MCP stdio | AWS AI coding assistant | [EN](./docs/04-integrations/AMAZON-Q-DEVELOPER.md) / [中文](./docs/04-integrations/AMAZON-Q-DEVELOPER.zh-CN.md) |
| [Devin](https://devin.ai/) | MCP stdio | AI software engineer | [EN](./docs/04-integrations/DEVIN.md) / [中文](./docs/04-integrations/DEVIN.zh-CN.md) |
| [Goose](https://github.com/block/goose) | MCP stdio | Block's AI coding agent | [EN](./docs/04-integrations/GOOSE.md) / [中文](./docs/04-integrations/GOOSE.zh-CN.md) |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | MCP stdio | Google's command-line AI tool | [EN](./docs/04-integrations/GEMINI-CLI.md) / [中文](./docs/04-integrations/GEMINI-CLI.zh-CN.md) |

### Desktop AI Chat Applications

| Platform | Access Method | Description | Guide |
|----------|---------------|-------------|-------|
| [Claude Desktop](https://claude.ai/download) | MCP stdio | Anthropic's official desktop app | [EN](./docs/04-integrations/CLAUDE-DESKTOP.md) / [中文](./docs/04-integrations/CLAUDE-DESKTOP.zh-CN.md) |
| [ChatGPT Desktop](https://openai.com/chatgpt/desktop/) | MCP SSE/Streamable HTTP | OpenAI's desktop app with MCP connectors | [EN](./docs/04-integrations/CHATGPT.md) / [中文](./docs/04-integrations/CHATGPT.zh-CN.md) |
| [Cherry Studio](https://github.com/kangfenmao/cherry-studio) | MCP stdio | Multi-model desktop chat app | [EN](./docs/04-integrations/CHERRY-STUDIO.md) / [中文](./docs/04-integrations/CHERRY-STUDIO.zh-CN.md) |
| [LM Studio](https://lmstudio.ai/) | MCP stdio | Run local LLMs with MCP support | [EN](./docs/04-integrations/LM-STUDIO.md) / [中文](./docs/04-integrations/LM-STUDIO.zh-CN.md) |
| [Jan](https://jan.ai/) | MCP stdio | Open-source ChatGPT alternative | [EN](./docs/04-integrations/JAN.md) / [中文](./docs/04-integrations/JAN.zh-CN.md) |
| [Msty](https://msty.app/) | MCP stdio | Desktop AI chat application | [EN](./docs/04-integrations/MSTY.md) / [中文](./docs/04-integrations/MSTY.zh-CN.md) |
| [LibreChat](https://github.com/danny-avila/LibreChat) | MCP stdio | Open-source chat interface | [EN](./docs/04-integrations/LIBRECHAT.md) / [中文](./docs/04-integrations/LIBRECHAT.zh-CN.md) |
| [Witsy](https://witsy.app/) | MCP stdio | Desktop AI assistant | [EN](./docs/04-integrations/WITSY.md) / [中文](./docs/04-integrations/WITSY.zh-CN.md) |
| [5ire](https://github.com/5ire-tech/5ire) | MCP stdio | Cross-platform AI chat | [EN](./docs/04-integrations/5IRE.md) / [中文](./docs/04-integrations/5IRE.zh-CN.md) |
| [ChatMCP](https://github.com/daodao97/chatmcp) | MCP stdio | MCP-focused chat UI | [EN](./docs/04-integrations/CHATMCP.md) / [中文](./docs/04-integrations/CHATMCP.zh-CN.md) |
| [HyperChat](https://github.com/BigSweetPotatoStudio/HyperChat) | MCP stdio | Multi-platform chat app | [EN](./docs/04-integrations/HYPERCHAT.md) / [中文](./docs/04-integrations/HYPERCHAT.zh-CN.md) |
| [Tome](https://github.com/runebook/tome) | MCP stdio | macOS app for local LLMs | [EN](./docs/04-integrations/TOME.md) / [中文](./docs/04-integrations/TOME.zh-CN.md) |

### Web-Based AI Platforms

| Platform | Access Method | Description | Guide |
|----------|---------------|-------------|-------|
| [Claude.ai](https://claude.ai/) | MCP SSE/Streamable HTTP | Anthropic's web interface | [EN](./docs/04-integrations/CLAUDE-AI.md) / [中文](./docs/04-integrations/CLAUDE-AI.zh-CN.md) |
| [ChatGPT](https://chat.openai.com/) | MCP SSE/Streamable HTTP | Via custom connectors | [EN](./docs/04-integrations/CHATGPT.md) / [中文](./docs/04-integrations/CHATGPT.zh-CN.md) |
| [Dify](https://dify.ai/) | MCP SSE/Streamable HTTP | LLM app development platform | [EN](./docs/04-integrations/DIFY.md) / [中文](./docs/04-integrations/DIFY.zh-CN.md) |
| [Coze](https://www.coze.com/) | REST API | ByteDance's AI bot platform | [EN](./docs/04-integrations/COZE.md) / [中文](./docs/04-integrations/COZE.zh-CN.md) |
| [n8n](https://n8n.io/) | REST API / MCP | Workflow automation platform | [EN](./docs/04-integrations/N8N.md) / [中文](./docs/04-integrations/N8N.zh-CN.md) |
| [Replit](https://replit.com/) | MCP stdio | Online IDE with AI agent | [EN](./docs/04-integrations/REPLIT.md) / [中文](./docs/04-integrations/REPLIT.zh-CN.md) |
| [MindPal](https://mindpal.io/) | MCP SSE/Streamable HTTP | No-code AI agent builder | [EN](./docs/04-integrations/MINDPAL.md) / [中文](./docs/04-integrations/MINDPAL.zh-CN.md) |

### Agent Frameworks & SDKs

| Platform | Access Method | Description | Guide |
|----------|---------------|-------------|-------|
| [LangChain](https://langchain.com/) | MCP stdio | Popular LLM framework | [EN](./docs/04-integrations/LANGCHAIN.md) / [中文](./docs/04-integrations/LANGCHAIN.zh-CN.md) |
| [Smolagents](https://github.com/huggingface/smolagents) | MCP stdio | Hugging Face agent library | [EN](./docs/04-integrations/SMOLAGENTS.md) / [中文](./docs/04-integrations/SMOLAGENTS.zh-CN.md) |
| [OpenAI Agents SDK](https://platform.openai.com/) | MCP SSE/Streamable HTTP | OpenAI's agent framework | [EN](./docs/04-integrations/OPENAI-AGENTS-SDK.md) / [中文](./docs/04-integrations/OPENAI-AGENTS-SDK.zh-CN.md) |
| [Amazon Bedrock Agents](https://aws.amazon.com/bedrock/) | MCP SSE/Streamable HTTP | AWS AI agent service | [EN](./docs/04-integrations/AMAZON-BEDROCK-AGENTS.md) / [中文](./docs/04-integrations/AMAZON-BEDROCK-AGENTS.zh-CN.md) |
| [Google ADK](https://cloud.google.com/) | MCP stdio | Google's Agent Development Kit | [EN](./docs/04-integrations/GOOGLE-ADK.md) / [中文](./docs/04-integrations/GOOGLE-ADK.zh-CN.md) |
| [Vercel AI SDK](https://sdk.vercel.ai/) | MCP stdio | Vercel's AI development kit | [EN](./docs/04-integrations/VERCEL-AI-SDK.md) / [中文](./docs/04-integrations/VERCEL-AI-SDK.zh-CN.md) |
| [Spring AI](https://spring.io/projects/spring-ai) | MCP stdio | Java/Spring AI framework | [EN](./docs/04-integrations/SPRING-AI.md) / [中文](./docs/04-integrations/SPRING-AI.zh-CN.md) |

### CLI Tools & Terminal

| Platform | Access Method | Description | Guide |
|----------|---------------|-------------|-------|
| [Claude Code CLI](https://claude.ai/code) | MCP stdio | Terminal-based coding agent | [EN](./docs/04-integrations/CLAUDE-CODE.md) / [中文](./docs/04-integrations/CLAUDE-CODE.zh-CN.md) |
| [Warp](https://www.warp.dev/) | MCP stdio | AI-powered terminal | [EN](./docs/04-integrations/WARP.md) / [中文](./docs/04-integrations/WARP.zh-CN.md) |
| [Oterm](https://github.com/ggozad/oterm) | MCP stdio | Chat with Ollama via CLI | [EN](./docs/04-integrations/OTERM.md) / [中文](./docs/04-integrations/OTERM.zh-CN.md) |
| [MCPHost](https://github.com/mark3labs/mcphost) | MCP stdio | CLI chat with LLMs | [EN](./docs/04-integrations/MCPHOST.md) / [中文](./docs/04-integrations/MCPHOST.zh-CN.md) |

### Productivity & Automation

| Platform | Access Method | Description | Guide |
|----------|---------------|-------------|-------|
| [Raycast](https://raycast.com/) | MCP stdio | macOS productivity launcher | [EN](./docs/04-integrations/RAYCAST.md) / [中文](./docs/04-integrations/RAYCAST.zh-CN.md) |
| [Notion](https://notion.so/) | MCP SSE/Streamable HTTP | Workspace with AI integration | [EN](./docs/04-integrations/NOTION.md) / [中文](./docs/04-integrations/NOTION.zh-CN.md) |
| [Obsidian](https://obsidian.md/) | MCP stdio | Via MCP Tools plugin | [EN](./docs/04-integrations/OBSIDIAN.md) / [中文](./docs/04-integrations/OBSIDIAN.zh-CN.md) |
| [Home Assistant](https://www.home-assistant.io/) | MCP stdio | Home automation platform | [EN](./docs/04-integrations/HOME-ASSISTANT.md) / [中文](./docs/04-integrations/HOME-ASSISTANT.zh-CN.md) |

### Messaging Platform Integrations

| Platform | Access Method | Description | Guide |
|----------|---------------|-------------|-------|
| [Slack](https://slack.com/) | MCP stdio / REST API | Via Slack MCP bots | [EN](./docs/04-integrations/SLACK.md) / [中文](./docs/04-integrations/SLACK.zh-CN.md) |
| [Discord](https://discord.com/) | MCP stdio / REST API | Via Discord MCP bots | [EN](./docs/04-integrations/DISCORD.md) / [中文](./docs/04-integrations/DISCORD.zh-CN.md) |
| [Mattermost](https://mattermost.com/) | MCP stdio | Open-source messaging | [EN](./docs/04-integrations/MATTERMOST.md) / [中文](./docs/04-integrations/MATTERMOST.zh-CN.md) |

### Local LLM Runners

| Platform | Access Method | Description | Guide |
|----------|---------------|-------------|-------|
| [Ollama](https://ollama.ai/) | MCP stdio | Run local LLMs | [EN](./docs/04-integrations/OLLAMA.md) / [中文](./docs/04-integrations/OLLAMA.zh-CN.md) |
| [LM Studio](https://lmstudio.ai/) | MCP stdio | Local LLM desktop app | [EN](./docs/04-integrations/LM-STUDIO.md) / [中文](./docs/04-integrations/LM-STUDIO.zh-CN.md) |
| [Jan](https://jan.ai/) | MCP stdio | Offline ChatGPT alternative | [EN](./docs/04-integrations/JAN.md) / [中文](./docs/04-integrations/JAN.zh-CN.md) |

### Development & Testing Tools

| Platform | Access Method | Description | Guide |
|----------|---------------|-------------|-------|
| [MCP Inspector](https://github.com/modelcontextprotocol/inspector) | MCP stdio | Official MCP debugging tool | [EN](./docs/04-integrations/MCP-INSPECTOR.md) / [中文](./docs/04-integrations/MCP-INSPECTOR.zh-CN.md) |
| [Postman](https://postman.com/) | REST API / MCP | API testing platform | [EN](./docs/04-integrations/POSTMAN.md) / [中文](./docs/04-integrations/POSTMAN.zh-CN.md) |

> **Note**: Any MCP-compatible client can connect via stdio (local) or SSE/Streamable HTTP (remote). Any HTTP client can use the REST API.

## 📚 Documentation

### Getting Started
- [Installation Guide](./docs/01-getting-started/installation.md)
- [Quick Start](./docs/01-getting-started/quick-start.md)
- [Configuration](./docs/01-getting-started/configuration.md)
- [Usage Examples](./docs/01-getting-started/examples.md)

### Deployment
- [Deployment Overview](./docs/06-deployment/README.md)
- [Local Deployment](./docs/06-deployment/local.md)
- [Docker Deployment](./docs/06-deployment/docker.md)
- [Cloud Deployment](./docs/06-deployment/cloud/)

### Database Guides
- [Database Support Overview](./docs/02-databases/README.md)
- [MySQL](./docs/02-databases/mysql.md)
- [PostgreSQL](./docs/02-databases/postgresql.md)
- [ClickHouse](./docs/02-databases/clickhouse.md) (v3.2.9 — 5 protocol bugs fixed)
- [DM (达梦)](./docs/02-databases/dameng.md) (v3.2.8 — backup + sample-data fixes)
- [MongoDB](./docs/02-databases/mongodb.md) (v3.2.7 — authSource + multi-arg)
- [More databases...](./docs/02-databases/)

### Features
- [Data Governance](./docs/03-features/data-governance.md) — profile backup, schema diff, PII, audit
- [Data Migration](./docs/03-features/data-migration.md) — **CSV import/export (v3.3.0)** + SQL backup
- [Multi-Profile](./docs/03-features/multi-profile.md) — multi-DB routing, schema aggregation
- [Observability](./docs/03-features/observability.md) — Prometheus + slow-query ring buffer

### HTTP API
- [API Reference](./docs/05-http-api/API_REFERENCE.md)
- [Deployment Guide](./docs/05-http-api/DEPLOYMENT.md)

### Integrations

**AI Editors & IDEs:**
[Cursor](./docs/04-integrations/CURSOR.md) |
[VS Code](./docs/04-integrations/VSCODE.md) |
[JetBrains](./docs/04-integrations/JETBRAINS.md) |
[Windsurf](./docs/04-integrations/WINDSURF.md) |
[Zed](./docs/04-integrations/ZED.md) |
[Neovim](./docs/04-integrations/NEOVIM.md) |
[Emacs](./docs/04-integrations/EMACS.md)

**AI Assistants:**
[Claude Desktop](./docs/04-integrations/CLAUDE-DESKTOP.md) |
[Claude Code](./docs/04-integrations/CLAUDE-CODE.md) |
[GitHub Copilot](./docs/04-integrations/GITHUB-COPILOT.md) |
[Cline](./docs/04-integrations/CLINE.md) |
[Continue](./docs/04-integrations/CONTINUE.md)

**AI Platforms:**
[Dify](./docs/04-integrations/DIFY.md) |
[Coze](./docs/04-integrations/COZE.md) |
[n8n](./docs/04-integrations/N8N.md) |
[ChatGPT](./docs/04-integrations/CHATGPT.md) |
[LangChain](./docs/04-integrations/LANGCHAIN.md)

**Desktop Apps:**
[Cherry Studio](./docs/04-integrations/CHERRY-STUDIO.md) |
[LM Studio](./docs/04-integrations/LM-STUDIO.md) |
[Jan](./docs/04-integrations/JAN.md) |
[Ollama](./docs/04-integrations/OLLAMA.md)

**Messaging:**
[Slack](./docs/04-integrations/SLACK.md) |
[Discord](./docs/04-integrations/DISCORD.md)

**Tools:**
[MCP Inspector](./docs/04-integrations/MCP-INSPECTOR.md) |
[Postman](./docs/04-integrations/POSTMAN.md)

> 📁 [View all 55+ integration guides](./docs/04-integrations/) | 中文版本请在对应文档名后加 `.zh-CN`

### Advanced
- [Security Guide](./docs/08-operations/multi-tenant.md) (security section)
- [Multi-tenant Guide](./docs/08-operations/multi-tenant.md)
- [Architecture](./docs/07-development/architecture.md)
- [Troubleshooting](./docs/08-operations/troubleshooting.md)

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](./CONTRIBUTING.md) before submitting a Pull Request.

```bash
# Clone the repository
git clone https://github.com/Anarkh-Lee/universal-db-mcp.git

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test
```

## 📄 License

This project is licensed under the [MIT License](./LICENSE).

## 🌟 Star History

If you find this project useful, please consider giving it a star! Your support helps us continue improving Universal DB MCP.

[![Star History Chart](https://api.star-history.com/svg?repos=Anarkh-Lee/universal-db-mcp&type=Date)](https://star-history.com/#Anarkh-Lee/universal-db-mcp&Date)

## 📝 Changelog

See [CHANGELOG.md](./CHANGELOG.md) for a detailed version history.

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/Anarkh-Lee">Anarkh-Lee</a>
</p>
