# 多 Schema 支持完成报告

## 问题描述

GitHub Issue: **PostgreSQL 数据库中 get_table_info 无法获取非 public schema 的表信息**

在使用 `get_table_info` 等工具时，只能获取默认 Schema（如 PostgreSQL 的 `public`、SQL Server 的 `dbo`、Oracle/达梦 的当前用户）下的表信息，非默认 Schema 的表被完全忽略。

## 影响范围

### 受影响的适配器（8 个）

| 适配器 | 默认 Schema | 原始问题 |
|--------|------------|---------|
| PostgreSQL | `public` | 硬编码 `table_schema = 'public'` |
| GaussDB | `public` | 同 PostgreSQL |
| KingbaseES | `public` | 同 PostgreSQL |
| Vastbase | `public` | 同 PostgreSQL |
| HighGo | `public` | 同 PostgreSQL |
| SQL Server | `dbo` | 硬编码 `SCHEMA_NAME() = 'dbo'` 或 `SCHEMA_ID('dbo')` |
| Oracle | 当前用户 | 硬编码 `OWNER = USER`，使用 `USER_*` 视图 |
| DM（达梦） | 当前用户 | 硬编码 `OWNER = USER`，使用 `USER_*` 视图 |

### 不受影响的适配器（9 个）

MySQL、TiDB、OceanBase、PolarDB、GoldenDB、ClickHouse、SQLite、MongoDB、Redis — 这些数据库无 Schema 概念或已正确支持。

### 影响的架构层级（4 层）

1. **适配器 SQL 查询层** — 8 个适配器的 `getSchema()` SQL 查询
2. **类型定义层** — `TableInfo` 接口需要 `schema` 字段
3. **核心服务层** — `DatabaseService.getTableInfo()` 的表名匹配逻辑
4. **工具描述层** — MCP 工具和 HTTP API 的参数说明

## 修改内容

### 1. 类型定义 (`src/types/adapter.ts`)

- `TableInfo` 接口已有 `schema?: string` 字段，无需修改

### 2. PostgreSQL 系适配器（5 个文件）

**修改文件**: `src/adapters/postgres.ts`, `gaussdb.ts`, `kingbase.ts`, `vastbase.ts`, `highgo.ts`

- 所有 SQL 查询移除 `table_schema = 'public'` 硬编码
- 改为排除系统 Schema: `NOT IN ('pg_catalog', 'information_schema', 'pg_toast')`
- 所有 SELECT 添加 `table_schema` / `schema_name` 列
- 新增 `makeTableKey()` 方法: `public` Schema 表名不加前缀，其他 Schema 表名格式为 `schema.table_name`
- `assembleSchema()` 使用 schema-qualified key 组装数据
- 新增 `schemaByTable` Map 追踪表所属 Schema
- 外键查询添加 `pg_namespace rn` JOIN 获取引用表的 Schema

### 3. SQL Server 适配器 (`src/adapters/sqlserver.ts`)

- 移除 `SCHEMA_NAME() = 'dbo'` 和 `SCHEMA_ID('dbo')` 硬编码
- 改为排除系统 Schema: `NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest')`
- 所有查询添加 Schema 信息列
- 新增 `makeTableKey()` 方法: `dbo` Schema 表名不加前缀
- 外键查询同时获取源表和引用表的 Schema

### 4. Oracle 适配器 (`src/adapters/oracle.ts`)

- 移除 `OWNER = USER` 硬编码
- 改为排除 20 个系统用户: `NOT IN ('SYS', 'SYSTEM', 'DBSNMP', ...)`
- 所有 `ALL_*` 视图查询添加 OWNER 列
- `makeTableKey()` 使用 `SELECT USER FROM DUAL` 获取当前用户作为默认 Schema 判断依据

### 5. DM（达梦）适配器 (`src/adapters/dm.ts`)

- `USER_*` 视图改为 `ALL_*` 视图
- 排除 6 个系统用户: `NOT IN ('SYS', 'SYSTEM', 'SYSAUDITOR', 'SYSSSO', 'SYSDBA', 'CTISYS')`
- 所有查询结果的 `getValueByIndex()` 索引偏移 +1（因添加了 OWNER 列）
- `makeTableKey()` 使用 `toUpperCase()` 比较确保大小写不敏感

### 6. 核心服务层 (`src/core/database-service.ts`)

- `getTableInfo()` 实现 3 级表名匹配:
  1. 精确匹配 `name` 字段（含大小写不敏感）
  2. 拆分 `schema.table` 格式，分别匹配 `schema` 和 `name`
  3. 仅匹配表名部分（不含 Schema 前缀），若唯一则返回
- `quoteIdentifier()` 拆分为两个方法，支持 `schema.table` 格式自动拆分并分别引用
- `quoteSimpleIdentifier()` 根据数据库类型选择引号样式

### 7. MCP 工具描述 (`src/mcp/mcp-server.ts`)

- `get_schema`: 描述中添加"所有 Schema"说明
- `get_table_info`: `tableName` 参数说明添加 `schema.table_name` 格式支持
- `get_enum_values`: 同上
- `get_sample_data`: 同上

### 8. HTTP API 路由 (`src/http/routes/schema.ts`)

- `/api/enum-values`: `tableName` 参数描述添加 Schema 格式说明
- `/api/sample-data`: 同上

## 向后兼容性

- **默认 Schema 表名不变**: `public` / `dbo` / 当前用户下的表仍使用纯表名（如 `users`），不加 Schema 前缀
- **非默认 Schema 使用限定名**: 格式为 `schema.table_name`（如 `analytics.events`）
- **旧的查询方式完全兼容**: 不带 Schema 前缀的表名查询行为不变
- **新增 Schema 前缀查询**: 支持 `analytics.events` 格式精确定位非默认 Schema 的表

## 测试结果

- **TypeScript 编译**: 零错误通过
- **单元/集成测试**: 95/96 通过
  - 1 个失败为 **预存在的** CORS 测试（`tests/integration/http-api.test.ts:136`），与本次修改无关

## 设计决策

1. **排除法 vs 白名单**: 使用排除系统 Schema（`NOT IN (...)`）而非白名单，确保用户自定义 Schema 自动被发现
2. **默认 Schema 不加前缀**: 保持向后兼容，`public.users` → `users`，`analytics.events` → `analytics.events`
3. **3 级表名匹配**: 精确匹配 → Schema 拆分匹配 → 基础名唯一匹配，兼顾精确性和易用性
4. **标识符引用拆分**: `quoteIdentifier()` 自动处理 `schema.table` 格式，避免将完整名称当作单个标识符引用
