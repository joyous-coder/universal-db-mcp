# 添加新数据库支持

本文档介绍如何为 Universal DB MCP 添加新的数据库支持。

## 概述

添加新数据库需要以下步骤：

1. 创建适配器文件
2. 实现 DbAdapter 接口
3. 在工厂中注册
4. 添加依赖
5. 更新文档

## 步骤详解

### 1. 创建适配器文件

在 `src/adapters/` 目录下创建新文件，例如 `newdb.ts`：

```typescript
// src/adapters/newdb.ts
import type { DbAdapter, QueryResult, SchemaInfo, TableInfo } from '../types/adapter.js';

export interface NewDbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export class NewDbAdapter implements DbAdapter {
  private config: NewDbConfig;
  private connection: any; // 替换为实际的连接类型

  constructor(config: NewDbConfig) {
    this.config = config;
  }

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

  async getTableInfo(tableName: string): Promise<TableInfo> {
    // 实现获取表信息逻辑
  }

  isWriteOperation(query: string): boolean {
    // 实现写操作检测
    const writeKeywords = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE'];
    const upperQuery = query.toUpperCase().trim();
    return writeKeywords.some(keyword => upperQuery.startsWith(keyword));
  }
}
```

### 2. 实现 DbAdapter 接口

#### connect()

建立数据库连接：

```typescript
async connect(): Promise<void> {
  try {
    this.connection = await createConnection({
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database,
    });
  } catch (error) {
    throw new Error(`连接数据库失败: ${error.message}`);
  }
}
```

#### disconnect()

关闭数据库连接：

```typescript
async disconnect(): Promise<void> {
  if (this.connection) {
    await this.connection.close();
    this.connection = null;
  }
}
```

#### executeQuery()

执行 SQL 查询：

```typescript
async executeQuery(query: string, params?: unknown[]): Promise<QueryResult> {
  const result = await this.connection.query(query, params);
  return {
    rows: result.rows,
    rowCount: result.rowCount,
    fields: result.fields.map(f => ({
      name: f.name,
      type: f.dataType,
    })),
  };
}
```

#### getSchema()

获取数据库结构：

```typescript
async getSchema(): Promise<SchemaInfo> {
  // 查询所有表
  const tables = await this.getTables();

  // 获取每个表的信息
  const tableInfos = await Promise.all(
    tables.map(table => this.getTableInfo(table))
  );

  return {
    tables: tableInfos,
    databaseName: this.config.database,
  };
}
```

> **注意：多 Schema 支持**
>
> 如果新数据库支持 Schema（如 PostgreSQL 系、SQL Server、Oracle），需要在 `getSchema()` 中：
> 1. 查询所有用户 Schema 的表（排除系统 Schema）
> 2. 在 `TableInfo.name` 中使用 `schema.table_name` 格式（非默认 Schema 时）
> 3. 设置 `TableInfo.schema` 字段标记表所属 Schema
> 4. 参考 `src/adapters/postgres.ts` 中的 `makeTableKey()` 方法

#### getTableInfo()

获取表详细信息：

```typescript
async getTableInfo(tableName: string): Promise<TableInfo> {
  // 查询列信息
  const columns = await this.getColumns(tableName);

  // 查询主键
  const primaryKey = await this.getPrimaryKey(tableName);

  // 查询索引
  const indexes = await this.getIndexes(tableName);

  return {
    name: tableName,
    columns,
    primaryKey,
    indexes,
  };
}
```

### 3. 在工厂中注册

编辑 `src/utils/adapter-factory.ts`：

```typescript
import { NewDbAdapter } from '../adapters/newdb.js';

export class AdapterFactory {
  static createAdapter(type: string, config: any): DbAdapter {
    switch (type.toLowerCase()) {
      // ... 现有适配器 ...
      case 'newdb':
        return new NewDbAdapter(config);
      default:
        throw new Error(`不支持的数据库类型: ${type}`);
    }
  }
}
```

### 4. 添加依赖

在 `package.json` 中添加数据库驱动：

```json
{
  "dependencies": {
    "newdb-driver": "^1.0.0"
  }
}
```

如果是可选依赖（如达梦）：

```json
{
  "optionalDependencies": {
    "newdb-driver": "^1.0.0"
  }
}
```

### 5. 更新文档

#### 更新 README.md

在支持的数据库列表中添加新数据库。

#### 创建数据库指南

在 `docs/databases/` 创建 `newdb.md`。

#### 更新数据库概览

在 `docs/databases/README.md` 中添加新数据库。

## 参考示例

### MySQL 兼容数据库

参考 `src/adapters/mysql.ts`，适用于：
- TiDB
- OceanBase
- PolarDB
- GoldenDB

### PostgreSQL 兼容数据库

参考 `src/adapters/postgres.ts`，适用于：
- KingbaseES
- GaussDB
- Vastbase
- HighGo

### NoSQL 数据库

参考 `src/adapters/mongodb.ts` 或 `src/adapters/redis.ts`。

## 测试

### 单元测试

创建 `tests/unit/adapters/newdb.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { NewDbAdapter } from '../../../src/adapters/newdb';

describe('NewDbAdapter', () => {
  it('should connect successfully', async () => {
    const adapter = new NewDbAdapter({
      host: 'localhost',
      port: 1234,
      user: 'test',
      password: 'test',
      database: 'test',
    });

    await expect(adapter.connect()).resolves.not.toThrow();
  });
});
```

### 集成测试

创建 `tests/integration/newdb.test.ts`，测试实际数据库连接。

## 提交检查清单

- [ ] 实现 DbAdapter 接口的所有方法
- [ ] 在 AdapterFactory 中注册
- [ ] 添加数据库驱动依赖
- [ ] 创建数据库使用指南
- [ ] 更新 README.md
- [ ] 添加单元测试
- [ ] 代码通过 TypeScript 编译
- [ ] 关键逻辑添加中文注释
