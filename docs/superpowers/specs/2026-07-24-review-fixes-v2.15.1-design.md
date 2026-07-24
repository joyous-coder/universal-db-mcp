# Review 遗留修复 v2.15.1 Design

**日期**: 2026-07-24
**作者**: brainstorming 会话
**状态**: 待用户审阅
**范围**: v2.15.0 发布后,code review 发现的 4 个遗留问题修复

---

## 1. 背景

v2.15.0 已发布,包含 P0/P1/P2 全部主要功能。Code quality review (commit `a41c7ac0`) 发现了 4 个未实现项:

1. `DB_QUERY_TIMEOUT_MS` / `DB_SLOW_QUERY_THRESHOLD_MS` 写在 `.env.example` 但 `config-loader.ts` 没读取,DatabaseService 用硬编码 30s/5s
2. HTTP `/api/query` 和 `/api/execute` 路由所有错误都返回 500,timeout 应该返回 504
3. Pooled adapter 事务不绑定同一连接(`executeScript` 的 BEGIN/COMMIT 可能跨连接)
4. HTTP 模式没有 `/api/execute-sql-file` 端点(spec 明确要求,MCP 已实现)

本次设计将 4 项合并到一个 spec,作为 v2.15.1 修复。

---

## 2. 非目标 (Non-goals)

- 不修复 pre-existing 测试失败(CORS, MCP startup) - 单独 spec
- 不改 better-sqlite3 native module 重建 - 环境问题
- 不重写 BaseAdapter.executeScript 全部 17 个 adapter - 实施时按 phase 分批
- 不增加新的连接池指标(P2 留到下个版本)

---

## 3. 设计

### 3.1 P0-1: env vars 接入 config-loader

**问题**: `DB_QUERY_TIMEOUT_MS` / `DB_SLOW_QUERY_THRESHOLD_MS` 在 `.env.example` 已记录,但 `src/utils/config-loader.ts:loadFromEnv()` 没读取,DatabaseService 实例化时使用硬编码 30s/5s。

**修复方案**:

1. `src/utils/config-loader.ts` 在 `loadFromEnv` 中读取:
```typescript
function parseIntOrUndefined(val: string | undefined): number | undefined {
  if (!val) return undefined;
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// 在 loadFromEnv 的 database 配置块中:
return {
  // ... existing fields ...
  queryTimeoutMs: parseIntOrUndefined(process.env.DB_QUERY_TIMEOUT_MS),
  slowQueryThresholdMs: parseIntOrUndefined(process.env.DB_SLOW_QUERY_THRESHOLD_MS),
};
```

2. `AppConfig` type 添加两个字段:
```typescript
export interface AppConfig {
  // ... existing ...
  queryTimeoutMs?: number;
  slowQueryThresholdMs?: number;
}
```

3. `src/index.ts:loadConfig` 之后传给 `startHttpServer` 或 `startMcpServer`,让 DatabaseService 读取:
```typescript
const config = loadConfig();
// 透传到 service
const service = new DatabaseService(adapter, dbConfig, cacheConfig, enhancerConfig, {
  queryTimeoutMs: config.queryTimeoutMs,
  slowQueryThresholdMs: config.slowQueryThresholdMs,
});
```

4. DatabaseService 构造函数接收 service options,优先使用 options,否则用硬编码默认:
```typescript
constructor(
  adapter, config, cacheConfig, enhancerConfig,
  serviceOptions?: { queryTimeoutMs?: number; slowQueryThresholdMs?: number }
) {
  this.adapter = adapter;
  this.config = config;
  this.cacheConfig = { ...DEFAULT_CACHE_CONFIG, ...cacheConfig };
  this.schemaEnhancer = new SchemaEnhancer(enhancerConfig);
  this.dataMasker = createDataMasker(true);
  if (serviceOptions?.queryTimeoutMs) this.queryTimeoutMs = serviceOptions.queryTimeoutMs;
  if (serviceOptions?.slowQueryThresholdMs) this.slowQueryThresholdMs = serviceOptions.slowQueryThresholdMs;
}
```

**测试**:
- `tests/unit/config-env-vars.test.ts` 验证 env vars 解析
- 手动验证:设置 `DB_QUERY_TIMEOUT_MS=5000`,启动后用 sleep 查询验证超时时间

---

### 3.2 P0-2: HTTP 状态码映射

**问题**: `src/http/routes/query.ts` 的两个端点(`/api/query`, `/api/execute`) 所有错误统一返回 500。Timeout 应该返回 504,auth 错误应该 401/403。

**修复方案**:

定义错误类型映射表(共享 util):
```typescript
// src/http/middleware/error-mapping.ts
export function mapErrorToStatus(error: Error): { status: number; code: string } {
  const msg = error.message;
  if (msg.includes('timed out') || msg.includes('timeout')) {
    return { status: 504, code: 'TIMEOUT' };
  }
  if (msg.includes('API key') || msg.includes('unauthorized')) {
    return { status: 401, code: 'UNAUTHORIZED' };
  }
  if (msg.includes('forbidden') || msg.includes('permission')) {
    return { status: 403, code: 'FORBIDDEN' };
  }
  if (msg.includes('not found') || msg.includes('does not exist')) {
    return { status: 404, code: 'NOT_FOUND' };
  }
  if (msg.includes('not in allowlist') || msg.includes('not configured')) {
    return { status: 404, code: 'NOT_FOUND' };
  }
  return { status: 500, code: 'INTERNAL_ERROR' };
}
```

应用到所有 HTTP 路由 - 创建统一错误处理器:
```typescript
// src/http/middleware/error-handler.ts
import { mapErrorToStatus } from './error-mapping.js';

export function setupErrorHandler(fastify: FastifyInstance) {
  fastify.setErrorHandler((error, request, reply) => {
    const { status, code } = mapErrorToStatus(error);
    reply.code(status);
    return {
      success: false,
      error: {
        code,
        message: error.message,
      },
      metadata: { timestamp: new Date().toISOString(), requestId: request.id },
    };
  });
}
```

修改 `src/http/server.ts` 挂载统一错误处理,移除每个路由的 try/catch(简化代码)。

**测试**:
- `tests/unit/error-mapping.test.ts` 覆盖各种错误类型
- 集成测试:慢查询 → 504,SQL 错误 → 500,not-found → 404

---

### 3.3 P0-3: Pooled adapter 事务语义 (Phase 1)

**问题**: BaseAdapter.executeScript 默认实现中,BEGIN/语句/COMMIT 通过 `executeQuery()` 多次调用。对 pool-backed 驱动(mysql2, pg, mssql, oracledb),每次调用可能用不同连接。导致事务不保证 all-or-nothing。

**修复方案 (Phase 1 - 关键 adapters)**:

`BaseAdapter` 已添加 `withTransaction<T>(fn: (tx: TransactionContext) => Promise<T>)` 抽象方法,默认 throw。现在为关键 adapters 实现:

**MySQL** (`src/adapters/mysql.ts`):

```typescript
import type { TransactionContext } from './base.js';

async withTransaction<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
  const conn = await this.pool!.getConnection();
  try {
    await conn.query('BEGIN');
    const tx: TransactionContext = {
      executeQuery: async (query, params) => {
        const [rows, fields] = await conn.execute(query, params);
        // ... 与 executeQuery 相同的处理逻辑 ...
      }
    };
    const result = await fn(tx);
    await conn.query('COMMIT');
    return result;
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    conn.release();
  }
}

async executeScript(query, options) {
  if (options?.useTransaction !== false) {
    return this.withTransaction(async (tx) => {
      // 通过 tx.executeQuery 执行每条语句
    });
  }
  // 非事务模式: 走基类默认
  return super.executeScript(query, { ...options, useTransaction: false });
}
```

**PostgreSQL** (`src/adapters/postgres.ts`): 同样的模式,使用 `pool.connect()` 获取 client。

**Oracle** (`src/adapters/oracle.ts`): 同样的模式,使用 `getConnection()`。

**DM** (`src/adapters/dm.ts`): 同样的模式(DM 的 createPool 已有 getConnection)。

**Phase 1 范围**: mysql + pg + oracle + dm + mssql(5 个最常用)

**Phase 2 留到下个 spec**: kingbase/gaussdb/oceanbase/tidb/polardb/vastbase/highgo/goldendb(8 个)

**测试**:
- `tests/unit/with-transaction-mysql.test.ts` 等 - 用 mock connection 测试事务原子性
- 集成测试(需要真实 DB): 模拟失败确保 ROLLBACK 触发

---

### 3.4 P0-4: HTTP /api/execute-sql-file 路由

**问题**: MCP 有 `execute_sql_file` 工具,HTTP 没有对应端点。Spec 明确要求 HTTP 模式支持。

**修复方案**:

新增路由 `src/http/routes/sql-file.ts`:
```typescript
import type { FastifyInstance } from 'fastify';
import type { SqlFileRequest, ApiResponse } from '../../types/http.js';
import type { QueryResult } from '../../types/adapter.js';
import { ConnectionManager } from '../../core/connection-manager.js';

export async function setupSqlFileRoutes(
  fastify: FastifyInstance,
  connectionManager: ConnectionManager
): Promise<void> {
  fastify.post<{
    Body: SqlFileRequest;
    Reply: ApiResponse<QueryResult>;
  }>('/api/execute-sql-file', {
    schema: {
      body: {
        type: 'object',
        required: ['sessionId', 'filePath'],
        properties: {
          sessionId: { type: 'string' },
          filePath: { type: 'string', description: 'SQL 文件绝对路径' },
          useTransaction: { type: 'boolean', default: true },
        },
      },
    },
  }, async (request, reply) => {
    const { sessionId, filePath, useTransaction } = request.body;
    const service = connectionManager.getService(sessionId);
    const result = await service.executeSqlFile({ filePath, useTransaction });
    return {
      success: true,
      data: result,
      metadata: { timestamp: new Date().toISOString(), requestId: request.id },
    };
    // 错误处理由 setupErrorHandler 统一处理
  });
}
```

类型定义添加:
```typescript
// src/types/http.ts
export interface SqlFileRequest {
  sessionId: string;
  filePath: string;
  useTransaction?: boolean;
}
```

挂载到 `src/http/server.ts:setupRoutes`。

**测试**:
- 集成测试:通过 /api/execute-sql-file 读取一个测试 .sql 文件,验证执行成功
- 错误测试:路径不在白名单 → 404;script 权限不足 → 403

---

## 4. 测试策略

| 变更 | 测试类型 |
|---|---|
| env vars 接入 | 单元测试 (config-env-vars.test.ts) + 手动验证 |
| HTTP 错误映射 | 单元测试 (error-mapping.test.ts) + 集成测试 |
| Pooled adapter 事务 | 单元测试 (mock connection) + 集成测试 (需要真 DB) |
| HTTP /api/execute-sql-file | 集成测试 |

**回归测试**: 跑 `npm test -- --run` 确认 209+ 测试不回归(预存在 2-3 个失败与本次无关)。

---

## 5. 风险

| 风险 | 缓解 |
|---|---|
| Pooled adapter 改造可能引入连接泄漏 | 测试覆盖 `release()`,`finally` 块保证 |
| HTTP 错误映射可能改变预存在的 500 行为 | 集成测试覆盖关键路径 |
| DB_QUERY_TIMEOUT_MS 改动可能影响用户配置 | 默认值保持 30000ms,只有显式 env var 才会改变 |
| execute_sql-file 路由可能让 HTTP 用户访问任意文件 | 复用现有 path-guard 白名单机制 |

---

## 6. 验收标准

- [ ] `DB_QUERY_TIMEOUT_MS=5000` 启动后查询 6 秒后超时
- [ ] `/api/query` 慢查询返回 504,SQL 错误返回 500,not-found 返回 404
- [ ] mysql/pg/oracle/dm/mssql adapter 的 executeScript 在事务中,所有语句在同一连接
- [ ] `/api/execute-sql-file` 与 MCP `execute_sql_file` 行为一致
- [ ] 209+ 测试通过,无新增失败
- [ ] Build 通过

---

## 7. 后续 (Phase 2 / 下个版本)

- Phase 2 Pooled adapter 事务覆盖(8 个剩余 adapter)
- better-sqlite3 native module 重建
- pre-existing 测试失败修复
- P2 下一阶段(运维可观测性、查询体验、多库管理、数据治理)
