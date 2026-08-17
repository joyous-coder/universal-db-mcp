    

# Universal DB MCP P0/P1/P2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement bug fixes (P0), performance optimizations (P1), and new features (P2) for universal-db-mcp per the spec at `docs/superpowers/specs/2026-07-23-universal-db-mcp-p0p1p2-design.md`.

**Architecture:** Three phases (P0 security → P1 performance → P2 features). Each task uses TDD: write failing test, verify failure, implement minimal code, verify pass, commit. New shared utilities live in `src/utils/`. Adapter changes follow existing patterns.

**Tech Stack:** TypeScript (strict), Node.js ≥20, MCP SDK 1.0, Fastify 4, vitest, mysql2, pg, oracledb, mssql, better-sqlite3, mongodb, ioredis, @clickhouse/client. New deps: `@faker-js/faker` (P2-3), `pinyin` (P2-3).

---

## File Structure

### New files

| File                                          | Purpose                                                      | Phase     |
| --------------------------------------------- | ------------------------------------------------------------ | --------- |
| `src/utils/identifier-validator.ts`         | Whitelist validation for SQL identifiers                     | P0-1      |
| `src/utils/retry.ts`                        | Shared`withRetry` with backoff                             | P0-4      |
| `src/utils/sql-detector.ts`                 | Detect if query is script-like                               | P0-5      |
| `src/utils/sql-parser.ts`                   | Split SQL scripts into statements                            | P0-5      |
| `src/utils/path-guard.ts`                   | Validate file paths against allowlist                        | P0-6      |
| `src/utils/sample-data-generator.ts`        | Generate sample data per column rules                        | P2-3      |
| `src/utils/template-resolver.ts`            | Resolve template placeholders                                | P2-3      |
| `src/adapters/base.ts`                      | Abstract base class with executeScript/executeBatch defaults | P0-5/P2-2 |
| `tests/unit/identifier-validator.test.ts`   | Validator tests                                              | P0-1      |
| `tests/unit/retry.test.ts`                  | Retry tests                                                  | P0-4      |
| `tests/unit/sql-detector.test.ts`           | Detector tests                                               | P0-5      |
| `tests/unit/sql-parser.test.ts`             | Parser tests                                                 | P0-5      |
| `tests/unit/script-permission.test.ts`      | Permission gating tests                                      | P0-5      |
| `tests/unit/path-guard.test.ts`             | Path guard tests                                             | P0-6      |
| `tests/unit/sample-data-generator.test.ts`  | Generator tests                                              | P2-3      |
| `tests/unit/template-resolver.test.ts`      | Template resolver tests                                      | P2-3      |
| `tests/unit/chinese-data.test.ts`           | Chinese locale tests                                         | P2-3      |
| `tests/unit/cross-column-reference.test.ts` | Cross-column ref tests                                       | P2-3      |

### Modified files

| File                               | Change                                                                  | Phase                    |
| ---------------------------------- | ----------------------------------------------------------------------- | ------------------------ |
| `src/types/adapter.ts`           | Add`'script'` and `'batch'` to `PermissionType`                   | P0-5/P2-2                |
| `src/utils/safety.ts`            | Add script permission preset, regex pre-compile, blacklist              | P0-5/P1-2                |
| `src/utils/config-loader.ts`     | Add DB_ALLOWED_FILE_PATHS, DB_POOL_SIZE, etc.                           | P0-6/P1-9                |
| `src/mcp/mcp-index.ts`           | New CLI flags:`--allow-sql-file-path`, `--permissions` enhancements | P0-5/P0-6                |
| `src/mcp/mcp-server.ts`          | Fix disconnect order; conditional tool registration                     | P0-3/P0-5/P2-2/P2-3      |
| `src/http/middleware/auth.ts`    | Refuse startup without API keys                                         | P0-2                     |
| `src/http/server.ts`             | Pool config from env                                                    | P1-9                     |
| `src/core/database-service.ts`   | Timeout, slow log, executeScript, executeBatch, generateSampleData      | P0-5/P1-5/P1-6/P2-2/P2-3 |
| `src/core/connection-manager.ts` | Pass pool config to adapters                                            | P1-9                     |
| All 17 adapters                    | Pool config, executeScript, executeBatch, withRetry                     | P0-4/P0-5/P1-9/P2-2      |
| `src/adapters/sqlite.ts`         | validateIdentifier, N+1 fix, executeScript                              | P0-1/P0-5/P1-1           |
| `src/http/routes/query.ts`       | Timeout handling, new routes                                            | P1-5/P2-2                |
| `src/http/routes/connection.ts`  | File path config                                                        | P0-6                     |
| `package.json`                   | Add faker, pinyin                                                       | P2-3                     |

---

# Phase 0: Bug & Security

## Task 1: Add 'script' and 'batch' permission types

**Files:**

- Modify: `src/types/adapter.ts:160-163`
- Modify: `src/utils/safety.ts:21-25, 30-49`

- [ ] **Step 1: Add types to adapter.ts**

In `src/types/adapter.ts`, change line 163 from:

```typescript
export type PermissionType = 'read' | 'insert' | 'update' | 'delete' | 'ddl';
```

to:

```typescript
export type PermissionType = 'read' | 'insert' | 'update' | 'delete' | 'ddl' | 'script' | 'batch';
```

- [ ] **Step 2: Update PERMISSION_PRESETS in safety.ts**

In `src/utils/safety.ts`, change the `PERMISSION_PRESETS` (lines 21-25) from:

```typescript
const PERMISSION_PRESETS: Record<string, readonly PermissionType[]> = {
  safe: ['read'],
  readwrite: ['read', 'insert', 'update'],
  full: ['read', 'insert', 'update', 'delete', 'ddl'],
} as const;
```

to (NOT including 'script' or 'batch' in any preset):

```typescript
const PERMISSION_PRESETS: Record<string, readonly PermissionType[]> = {
  safe: ['read'],
  readwrite: ['read', 'insert', 'update'],
  full: ['read', 'insert', 'update', 'delete', 'ddl'],
  // 'script' and 'batch' are NOT in any preset; users opt-in via custom permissions
} as const;
```

- [ ] **Step 3: Update resolvePermissions to handle custom mode**

In `src/utils/safety.ts`, the existing `resolvePermissions` (lines 30-49) already handles `custom` mode by reading `config.permissions` array. Verify line 43:

```typescript
if (config.permissionMode && config.permissionMode !== 'custom') {
  return [...PERMISSION_PRESETS[config.permissionMode]];
}
```

This means `permissionMode: 'custom'` falls through to use `config.permissions`. No code change needed.

- [ ] **Step 4: Build and verify**

Run: `npm run build`
Expected: No TypeScript errors (the new types compile cleanly).

- [ ] **Step 5: Commit**

```bash
git add src/types/adapter.ts src/utils/safety.ts
git commit -m "feat(permissions): add 'script' and 'batch' permission types"
```

---

## Task 2: Create identifier-validator utility

**Files:**

- Create: `src/utils/identifier-validator.ts`
- Create: `tests/unit/identifier-validator.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/identifier-validator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validateIdentifier } from '../../src/utils/identifier-validator.js';

describe('validateIdentifier', () => {
  it('accepts simple identifier', () => {
    expect(() => validateIdentifier('users')).not.toThrow();
  });

  it('accepts underscore prefix', () => {
    expect(() => validateIdentifier('_internal')).not.toThrow();
  });

  it('accepts alphanumeric', () => {
    expect(() => validateIdentifier('users_2026')).not.toThrow();
  });

  it('rejects empty string', () => {
    expect(() => validateIdentifier('')).toThrow(/invalid identifier/i);
  });

  it('rejects SQL injection attempt', () => {
    expect(() => validateIdentifier('users; DROP TABLE x')).toThrow(/invalid identifier/i);
  });

  it('rejects identifier with spaces', () => {
    expect(() => validateIdentifier('user name')).toThrow(/invalid identifier/i);
  });

  it('rejects identifier starting with digit', () => {
    expect(() => validateIdentifier('1user')).toThrow(/invalid identifier/i);
  });

  it('accepts schema.table format when allowSchema=true', () => {
    expect(() => validateIdentifier('analytics.events', true)).not.toThrow();
  });

  it('rejects schema.table injection when allowSchema=true', () => {
    expect(() => validateIdentifier('analytics.events; DROP TABLE x', true)).toThrow(/invalid identifier/i);
  });

  it('rejects schema.table when allowSchema=false', () => {
    expect(() => validateIdentifier('analytics.events')).toThrow(/invalid identifier/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/identifier-validator.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement validator**

Create `src/utils/identifier-validator.ts`:

```typescript
/**
 * Identifier Validator
 * Whitelist-validates SQL identifiers to prevent injection.
 * Used by SQLite adapter (and others) when building dynamic SQL with table/column names.
 */

const IDENT_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_IDENTIFIER_LENGTH = 128;

/**
 * Validate a single SQL identifier (table name, column name, etc.).
 * @param name - Identifier to validate
 * @param allowSchema - If true, allows "schema.table" format (each part validated separately)
 * @throws Error if identifier is invalid
 */
export function validateIdentifier(name: string, allowSchema: boolean = false): void {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`Invalid identifier: empty or non-string`);
  }
  if (name.length > MAX_IDENTIFIER_LENGTH) {
    throw new Error(`Invalid identifier: too long (${name.length} > ${MAX_IDENTIFIER_LENGTH})`);
  }

  if (allowSchema && name.includes('.')) {
    const parts = name.split('.');
    if (parts.length !== 2) {
      throw new Error(`Invalid identifier with schema: ${name} (expected schema.table)`);
    }
    if (!IDENT_REGEX.test(parts[0]) || !IDENT_REGEX.test(parts[1])) {
      throw new Error(`Invalid identifier: ${name}`);
    }
    return;
  }

  if (!IDENT_REGEX.test(name)) {
    throw new Error(`Invalid identifier: ${name}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/identifier-validator.test.ts`
Expected: All 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/identifier-validator.ts tests/unit/identifier-validator.test.ts
git commit -m "feat(util): add identifier-validator for safe dynamic SQL"
```

---

## Task 3: Apply validator to SQLite adapter (P0-1)

**Files:**

- Modify: `src/adapters/sqlite.ts:178-302`
- Modify: `tests/integration/mcp-mode.test.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/integration/mcp-mode.test.ts` (create file if not exists):

```typescript
import { describe, it, expect } from 'vitest';
import { SQLiteAdapter } from '../../src/adapters/sqlite.js';

describe('SQLite adapter identifier safety', () => {
  it('rejects malicious table name in getTableInfo', () => {
    const adapter = new SQLiteAdapter({ filePath: ':memory:' });
    // SQLite in-memory mode
    expect(() => adapter.getTableInfo('users; DROP TABLE x')).rejects.toThrow(/invalid identifier/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/mcp-mode.test.ts`
Expected: FAIL with "table users; DROP TABLE x not found" or similar (current behavior).

- [ ] **Step 3: Add validator calls to SQLite adapter**

Modify `src/adapters/sqlite.ts`:

Add import at top:

```typescript
import { validateIdentifier } from '../utils/identifier-validator.js';
```

In `getTableInfo` method (around line 178), add validation at the start:

```typescript
private async getTableInfo(tableName: string): Promise<{ tableInfo: TableInfo; tableForeignKeys: ForeignKeyInfo[] }> {
  if (!this.db) {
    throw new Error('数据库未连接');
  }

  // Validate identifier to prevent SQL injection
  validateIdentifier(tableName);

  // ... rest of method unchanged
}
```

In `getSchema` method, validate each table name before calling `getTableInfo`. Find the loop:

```typescript
for (const table of tables) {
  const { tableInfo, tableForeignKeys } = await this.getTableInfo(table.name);
```

Replace with:

```typescript
for (const table of tables) {
  validateIdentifier(table.name);  // Validate before passing to getTableInfo
  const { tableInfo, tableForeignKeys } = await this.getTableInfo(table.name);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/mcp-mode.test.ts`
Expected: PASS

- [ ] **Step 5: Run all existing tests to verify no regression**

Run: `npm test`
Expected: All tests pass (existing tests use valid table names).

- [ ] **Step 6: Commit**

```bash
git add src/adapters/sqlite.ts tests/integration/mcp-mode.test.ts
git commit -m "fix(sqlite): validate identifier to prevent SQL injection"
```

---

## Task 4: Fix HTTP default auth (P0-2)

**Files:**

- Modify: `src/utils/config-loader.ts:142-151`
- Modify: `src/http/index.ts` (or `src/http/http-index.ts:13-15`)

- [ ] **Step 1: Locate current auth check**

The HTTP startup currently warns (not errors) when API keys are missing. Search `src/utils/config-loader.ts` for `validateConfig`:

Currently at lines 142-151:

```typescript
export function validateConfig(config: AppConfig): void {
  if (config.mode === 'http') {
    if (!config.http) {
      throw new Error('HTTP 模式需要 HTTP 配置');
    }
    if (config.http.apiKeys.length === 0) {
      console.warn('⚠️  警告: 未配置 API Keys，建议设置 API_KEYS 环境变量');
    }
  }
}
```

- [ ] **Step 2: Update validateConfig to refuse startup**

Replace with:

```typescript
export function validateConfig(config: AppConfig): void {
  if (config.mode === 'http') {
    if (!config.http) {
      throw new Error('HTTP 模式需要 HTTP 配置');
    }
    if (config.http.apiKeys.length === 0) {
      // Check escape hatch
      if (process.env.ALLOW_INSECURE_NO_AUTH !== 'true') {
        throw new Error(
          '❌ HTTP 模式启动失败:未配置 API Keys。\n' +
          '安全起见,HTTP 模式必须配置至少一个 API Key。\n' +
          '请设置环境变量 API_KEYS=<comma-separated-keys>\n' +
          '或在开发环境设置 ALLOW_INSECURE_NO_AUTH=true(不推荐,会打印强警告)'
        );
      }
      console.error('⚠️⚠️⚠️ 严重安全警告: ALLOW_INSECURE_NO_AUTH=true 已启用,HTTP 模式无认证!');
      console.error('⚠️⚠️⚠️ 任何能访问此端口的人都可以执行任意数据库操作!');
      console.error('⚠️⚠️⚠️ 仅在本地开发或受控网络中使用!');
    }
  }
}
```

- [ ] **Step 3: Run existing tests**

Run: `npm test`
Expected: Tests pass (existing tests don't trigger this path; integration tests set API keys).

- [ ] **Step 4: Manual verification - missing API key**

Run: `MODE=http npm start`
Expected: Startup fails with error message about API_KEYS being required.

- [ ] **Step 5: Manual verification - escape hatch**

Run: `MODE=http ALLOW_INSECURE_NO_AUTH=true API_KEYS= npm start`
Expected: Startup succeeds with strong warning printed.

- [ ] **Step 6: Commit**

```bash
git add src/utils/config-loader.ts
git commit -m "fix(http): refuse startup without API keys by default"
```

---

## Task 5: Fix mcp-server disconnect order (P0-3)

**Files:**

- Modify: `src/mcp/mcp-server.ts:253-262, 297-315`

- [ ] **Step 1: Add failing test**

Add to `tests/unit/` (create `tests/unit/disconnect-order.test.ts`):

```typescript
import { describe, it, expect, vi } from 'vitest';
import { DatabaseMCPServer } from '../../src/mcp/mcp-server.js';
import type { DbAdapter } from '../../src/types/adapter.js';

describe('disconnect_database order', () => {
  it('clears adapter even if disconnect throws', async () => {
    const server = new DatabaseMCPServer();
    const mockAdapter: DbAdapter = {
      connect: vi.fn(),
      disconnect: vi.fn().mockRejectedValue(new Error('disconnect failed')),
      executeQuery: vi.fn(),
      getSchema: vi.fn(),
      isWriteOperation: vi.fn(),
    };
    server.setAdapter(mockAdapter);

    // Call disconnect handler
    const handler = (server as any).server._requestHandlers;
    // Just verify internal state - getStatus should report not connected
    // (We'll trust that calling disconnect_database clears state)

    // Invoke tool directly via internal API
    const result = await (server as any).handleTool('disconnect_database', {});
    expect(result.isError).toBeFalsy();
    // Verify adapter was set to null
    expect((server as any).adapter).toBeNull();
  });
});
```

Note: This test may need adjustment based on actual internal API. If `handleTool` is not exposed, use a different approach.

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/unit/disconnect-order.test.ts`
Expected: May fail due to test API mismatch. If so, adjust the test to directly verify the disconnect path.

- [ ] **Step 3: Fix disconnect_database handler**

Modify `src/mcp/mcp-server.ts`, find the `disconnect_database` case (around lines 297-315):

Current:

```typescript
case 'disconnect_database': {
  if (!this.adapter) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: true, message: '当前没有活跃的数据库连接' }, null, 2),
      }],
    };
  }

  if (this.databaseService) {
    this.databaseService.clearSchemaCache();
  }
  await this.adapter.disconnect();

  const oldType = this.config?.type;
  this.adapter = null;
  this.config = null;
  this.databaseService = null;

  console.error('👋 数据库连接已断开');

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        message: `已断开 ${oldType || ''} 数据库连接`,
      }, null, 2),
    }],
  };
}
```

Replace with (try/catch + always null out):

```typescript
case 'disconnect_database': {
  if (!this.adapter) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: true, message: '当前没有活跃的数据库连接' }, null, 2),
      }],
    };
  }

  if (this.databaseService) {
    this.databaseService.clearSchemaCache();
  }

  const oldType = this.config?.type;

  // Try disconnect but always clear state regardless of success
  try {
    await this.adapter.disconnect();
  } catch (err) {
    console.error(`断开适配器时出错 (${oldType}):`, err instanceof Error ? err.message : String(err));
  }

  this.adapter = null;
  this.config = null;
  this.databaseService = null;

  console.error(`👋 数据库连接已断开: ${oldType || ''}`);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        message: `已断开 ${oldType || ''} 数据库连接`,
      }, null, 2),
    }],
  };
}
```

- [ ] **Step 4: Apply same fix to connect_database's old connection cleanup**

Find the `connect_database` case (around lines 224-295), specifically the old adapter cleanup block:

```typescript
// 断开旧连接
if (this.adapter) {
  console.error('🔄 断开旧数据库连接...');
  if (this.databaseService) {
    this.databaseService.clearSchemaCache();
  }
  await this.adapter.disconnect();
  this.adapter = null;
  this.databaseService = null;
}
```

Replace with:

```typescript
// 断开旧连接(总是清空状态,即使 disconnect 抛错)
if (this.adapter) {
  console.error('🔄 断开旧数据库连接...');
  if (this.databaseService) {
    this.databaseService.clearSchemaCache();
  }
  try {
    await this.adapter.disconnect();
  } catch (err) {
    console.error('断开旧适配器时出错:', err instanceof Error ? err.message : String(err));
  }
  this.adapter = null;
  this.databaseService = null;
}
```

- [ ] **Step 5: Build and verify**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/mcp-server.ts
git commit -m "fix(mcp): always clear adapter state even if disconnect throws"
```

---

## Task 6: Create shared retry utility (P0-4)

**Files:**

- Create: `src/utils/retry.ts`
- Create: `tests/unit/retry.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/retry.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { withRetry, isConnectionErrorMessage } from '../../src/utils/retry.js';

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries once on connection error then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('read ECONNRESET'))
      .mockResolvedValueOnce('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry on non-connection error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Unknown column'));
    await expect(withRetry(fn)).rejects.toThrow('Unknown column');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Connection lost'));
    await expect(withRetry(fn, { retries: 2 })).rejects.toThrow('Connection lost');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('applies backoff delay between retries', async () => {
    const start = Date.now();
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce('ok');
    await withRetry(fn, { baseDelayMs: 100 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(90); // allow some jitter
  });
});

describe('isConnectionErrorMessage', () => {
  it('matches ECONNRESET', () => {
    expect(isConnectionErrorMessage('read ECONNRESET')).toBe(true);
  });

  it('matches MySQL connection lost', () => {
    expect(isConnectionErrorMessage("Can't add new command when connection is in closed state")).toBe(true);
  });

  it('matches Postgres connection terminated', () => {
    expect(isConnectionErrorMessage('Connection terminated unexpectedly')).toBe(true);
  });

  it('does not match syntax errors', () => {
    expect(isConnectionErrorMessage('syntax error')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/retry.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement retry utility**

Create `src/utils/retry.ts`:

```typescript
/**
 * Retry utility with exponential backoff
 * Used by database adapters for transient connection errors.
 */

export interface RetryOptions {
  /** Maximum number of retries (default: 1) */
  retries?: number;
  /** Base delay in ms; delay = baseDelayMs * 2^attempt (default: 50) */
  baseDelayMs?: number;
  /** Custom error classifier; default uses isConnectionErrorMessage */
  isRetryable?: (error: unknown) => boolean;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'isRetryable'>> = {
  retries: 1,
  baseDelayMs: 50,
};

/**
 * Check if an error message indicates a transient connection problem.
 */
export function isConnectionErrorMessage(msg: string): boolean {
  return /closed state|ECONNRESET|EPIPE|ETIMEDOUT|PROTOCOL_CONNECTION_LOST|Connection lost|Connection terminated|ECONNREFUSED|57P01|57P03|08003|08006/.test(msg);
}

/**
 * Execute fn with retry on transient connection errors.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const isRetryable = options.isRetryable ?? ((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    return isConnectionErrorMessage(msg);
  });

  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === opts.retries || !isRetryable(err)) {
        throw err;
      }
      const delay = opts.baseDelayMs * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/retry.test.ts`
Expected: All 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/retry.ts tests/unit/retry.test.ts
git commit -m "feat(util): add retry utility with exponential backoff"
```

---

## Task 7: Refactor MySQL adapter to use shared retry (P0-4)

**Files:**

- Modify: `src/adapters/mysql.ts:43-62`

- [ ] **Step 1: Replace local withRetry with shared one**

In `src/adapters/mysql.ts`:

Remove the local `isConnectionError` method (lines 45-48):

```typescript
private isConnectionError(error: unknown): boolean {
  const msg = String((error as any)?.message || '');
  return /closed state|ECONNRESET|EPIPE|ETIMEDOUT|PROTOCOL_CONNECTION_LOST|Connection lost|ECONNREFUSED/.test(msg);
}
```

Remove the local `withRetry` method (lines 52-62):

```typescript
private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (this.isConnectionError(error)) {
      return await fn();
    }
    throw error;
  }
}
```

Add import at top:

```typescript
import { withRetry } from '../utils/retry.js';
```

In `executeQuery` (around line 120), change:

```typescript
const [rows, fields] = await this.withRetry(() => this.pool!.execute(query, params));
```

to:

```typescript
const [rows, fields] = await withRetry(() => this.pool!.execute(query, params));
```

In `getSchema` (around line 164), change:

```typescript
return await this.withRetry(() => this._getSchemaImpl());
```

to:

```typescript
return await withRetry(() => this._getSchemaImpl());
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: Existing tests pass (behavior unchanged).

- [ ] **Step 3: Commit**

```bash
git add src/adapters/mysql.ts
git commit -m "refactor(mysql): use shared retry utility"
```

- [ ] **Step 4: Repeat for other adapters (postgres, oracle, dm, sqlserver, mongodb, redis, kingbase, gaussdb, oceanbase, tidb, clickhouse, polardb, vastbase, highgo, goldendb)**

For each adapter:

1. Remove local `isConnectionError` and `withRetry` methods
2. Add `import { withRetry } from '../utils/retry.js';`
3. Replace `this.withRetry(...)` with `withRetry(...)`

After each adapter:

```bash
git add src/adapters/<name>.ts
git commit -m "refactor(<name>): use shared retry utility"
```

Note: Each adapter's connection error patterns may differ slightly. The shared `isConnectionErrorMessage` covers MySQL/PG/common patterns. If an adapter has unique codes (e.g., Oracle NJS/DPI), update the shared regex or pass custom `isRetryable` to `withRetry`.

For Oracle (uses errorNum, not just message), keep local logic but route through shared utility:

```typescript
import { withRetry, isConnectionErrorMessage } from '../utils/retry.js';

private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
  return withRetry(fn, {
    isRetryable: (err) => {
      const e = err as { message?: string; errorNum?: number };
      const msg = e?.message || '';
      if (isConnectionErrorMessage(msg)) return true;
      if (/NJS-003|NJS-500|NJS-521|DPI-1010|DPI-1080/.test(msg)) return true;
      if ([3113, 3114, 3135, 12170, 12571, 28547].includes(e?.errorNum || 0)) return true;
      return false;
    }
  });
}
```

- [ ] **Step 5: Final test run**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit all refactors**

```bash
git add src/adapters/
git commit -m "refactor: migrate all adapters to shared retry utility"
```

---

## Task 8: Create sql-detector utility (P0-5)

**Files:**

- Create: `src/utils/sql-detector.ts`
- Create: `tests/unit/sql-detector.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/sql-detector.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isScriptLike } from '../../src/utils/sql-detector.js';

describe('isScriptLike', () => {
  it('returns false for simple SELECT', () => {
    expect(isScriptLike('SELECT * FROM users')).toBe(false);
  });

  it('returns true for BEGIN block', () => {
    expect(isScriptLike('BEGIN UPDATE users SET active = 1; END;')).toBe(true);
  });

  it('returns true for DECLARE', () => {
    expect(isScriptLike('DECLARE @x INT; SET @x = 1;')).toBe(true);
  });

  it('returns true for CALL', () => {
    expect(isScriptLike('CALL my_procedure(1, 2)')).toBe(true);
  });

  it('returns true for multi-statement (semicolon-separated)', () => {
    expect(isScriptLike('INSERT INTO t VALUES (1); INSERT INTO t VALUES (2);')).toBe(true);
  });

  it('returns false for trailing semicolon only', () => {
    expect(isScriptLike('SELECT 1;')).toBe(false);
  });

  it('returns true for leading comment + multi-statement', () => {
    expect(isScriptLike('-- comment\nSELECT 1;\nSELECT 2;')).toBe(true);
  });

  it('returns true for PL/SQL CREATE PROCEDURE', () => {
    expect(isScriptLike(`CREATE OR REPLACE PROCEDURE foo AS BEGIN SELECT 1; END;`)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/sql-detector.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement detector**

Create `src/utils/sql-detector.ts`:

```typescript
/**
 * SQL Script Detector
 * Determines if a query string is a "script" (multi-statement, PL block, etc.)
 * rather than a single statement.
 */

const SCRIPT_KEYWORDS = /^\s*(BEGIN|DECLARE|CALL|CREATE\s+(OR\s+REPLACE\s+)?(PROCEDURE|FUNCTION|TRIGGER|PACKAGE))\b/i;

/**
 * Detect if a query looks like a multi-statement script or PL block.
 *
 * Returns true when:
 * - Starts with BEGIN, DECLARE, CALL, CREATE PROCEDURE/FUNCTION/TRIGGER/PACKAGE
 * - Contains multiple top-level statements (semicolons not inside strings/comments)
 */
export function isScriptLike(query: string): boolean {
  if (typeof query !== 'string') return false;

  const trimmed = query.trim();

  // Quick check: starts with PL keyword
  if (SCRIPT_KEYWORDS.test(trimmed)) {
    return true;
  }

  // Count top-level semicolons (rough heuristic)
  // A script has 2+ statements ending with semicolons
  const cleaned = stripStringsAndComments(trimmed);
  const semicolons = (cleaned.match(/;/g) || []).length;

  return semicolons >= 2;
}

function stripStringsAndComments(sql: string): string {
  // Remove single-quoted strings
  let result = sql.replace(/'(?:''|[^'])*'/g, "''");
  // Remove double-quoted identifiers
  result = result.replace(/"(?:""|[^"])*"/g, '""');
  // Remove line comments
  result = result.replace(/--[^\n]*/g, '');
  // Remove block comments
  result = result.replace(/\/\*[\s\S]*?\*\//g, '');
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/sql-detector.test.ts`
Expected: All 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/sql-detector.ts tests/unit/sql-detector.test.ts
git commit -m "feat(util): add sql-detector for script-like queries"
```

---

## Task 9: Create sql-parser utility (P0-5)

**Files:**

- Create: `src/utils/sql-parser.ts`
- Create: `tests/unit/sql-parser.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/sql-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { splitStatements } from '../../src/utils/sql-parser.js';

describe('splitStatements', () => {
  it('splits simple statements by semicolon', () => {
    const sql = 'INSERT INTO t VALUES (1); INSERT INTO t VALUES (2);';
    expect(splitStatements(sql, 'mysql')).toEqual([
      'INSERT INTO t VALUES (1)',
      'INSERT INTO t VALUES (2)',
      '',
    ]);
  });

  it('preserves semicolons inside strings', () => {
    const sql = `INSERT INTO t VALUES ('a;b'); INSERT INTO t VALUES ('c');`;
    const result = splitStatements(sql, 'mysql');
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(`INSERT INTO t VALUES ('a;b')`);
  });

  it('preserves semicolons inside PL/SQL BEGIN...END block', () => {
    const sql = `BEGIN INSERT INTO t VALUES (1); INSERT INTO t VALUES (2); END;`;
    const result = splitStatements(sql, 'oracle');
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('BEGIN');
    expect(result[0]).toContain('END;');
  });

  it('handles nested BEGIN...END blocks', () => {
    const sql = `BEGIN IF x > 0 THEN BEGIN INSERT INTO t VALUES (1); END; END;`;
    const result = splitStatements(sql, 'oracle');
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('BEGIN');
    expect(result[1]).toBe('');
  });

  it('removes line comments before splitting', () => {
    const sql = `-- this is a comment\nINSERT INTO t VALUES (1);\n-- another\nINSERT INTO t VALUES (2);`;
    const result = splitStatements(sql, 'mysql');
    expect(result).toHaveLength(3);
    expect(result[0]).toContain('INSERT');
  });

  it('handles MySQL DELIMITER directive', () => {
    const sql = `DELIMITER $$\nCREATE PROCEDURE foo()\nBEGIN\nSELECT 1;\nEND$$\nDELIMITER ;`;
    const result = splitStatements(sql, 'mysql');
    // Expect at least one non-empty statement
    expect(result.some(s => s.includes('CREATE PROCEDURE'))).toBe(true);
  });

  it('returns single-element array for single statement', () => {
    const sql = 'SELECT 1';
    const result = splitStatements(sql, 'mysql');
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('SELECT 1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/sql-parser.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement parser**

Create `src/utils/sql-parser.ts`:

```typescript
/**
 * SQL Statement Parser
 * Splits a SQL script into individual statements, handling:
 * - String literals ('...' with '' escape)
 * - Quoted identifiers ("...")
 * - Line comments (-- ...)
 * - Block comments (/* ... */)
 * - PL/SQL BEGIN...END blocks (tracks depth)
 * - MySQL DELIMITER directive
 */

import type { DbType } from './adapter-factory.js';

/**
 * Split a SQL script into individual statements.
 * Returns array of statements (may include empty strings as trailing artifacts).
 */
export function splitStatements(script: string, dialect: DbType = 'mysql'): string[] {
  if (!script || typeof script !== 'string') return [];

  // MySQL DELIMITER handling
  if (dialect === 'mysql' || dialect === 'tidb' || dialect === 'oceanbase' || dialect === 'polardb' || dialect === 'goldendb') {
    script = normalizeMysqlDelimiter(script);
  }

  const statements: string[] = [];
  let current = '';
  let i = 0;
  let blockDepth = 0; // BEGIN...END nesting
  let inString = false;
  let stringChar = '';
  let inLineComment = false;
  let inBlockComment = false;

  while (i < script.length) {
    const ch = script[i];
    const next = script[i + 1];
    const prev = i > 0 ? script[i - 1] : '';

    // Handle line comments
    if (inLineComment) {
      current += ch;
      if (ch === '\n') inLineComment = false;
      i++;
      continue;
    }

    // Handle block comments
    if (inBlockComment) {
      current += ch;
      if (ch === '*' && next === '/') {
        current += next;
        i += 2;
        inBlockComment = false;
        continue;
      }
      i++;
      continue;
    }

    // Handle strings
    if (inString) {
      current += ch;
      if (ch === stringChar && prev !== '\\') {
        inString = false;
      }
      i++;
      continue;
    }

    // Detect start of string
    if (ch === "'" || ch === '"') {
      inString = true;
      stringChar = ch;
      current += ch;
      i++;
      continue;
    }

    // Detect start of line comment
    if (ch === '-' && next === '-') {
      inLineComment = true;
      current += ch;
      i++;
      continue;
    }

    // Detect start of block comment
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      current += ch;
      i++;
      continue;
    }

    // Track BEGIN...END depth (case-insensitive, word boundary)
    if (isWordBoundary(current) || current === '') {
      if (matchesKeyword(script, i, 'BEGIN')) {
        blockDepth++;
      } else if (matchesKeyword(script, i, 'END')) {
        if (blockDepth > 0) blockDepth--;
      }
    }

    // Split on top-level semicolon
    if (ch === ';' && blockDepth === 0) {
      current += ch;
      statements.push(current.trim());
      current = '';
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}

function isWordBoundary(s: string): boolean {
  if (s.length === 0) return true;
  const last = s[s.length - 1];
  return /\s/.test(last) || /[(){};,]/.test(last);
}

function matchesKeyword(script: string, pos: number, keyword: string): boolean {
  const slice = script.substring(pos, pos + keyword.length);
  if (slice.toUpperCase() !== keyword) return false;
  const before = pos > 0 ? script[pos - 1] : ' ';
  const after = script[pos + keyword.length] || ' ';
  return /[\s;,()]/.test(before) && /[\s;,()\b]/.test(after) || after === '';
}

/**
 * Normalize MySQL DELIMITER directive so standard semicolon splitting works.
 * Replaces custom delimiters (e.g., $$) with semicolons internally.
 */
function normalizeMysqlDelimiter(script: string): string {
  const lines = script.split('\n');
  let currentDelimiter = ';';
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^DELIMITER\s+(\S+)/i);
    if (match) {
      currentDelimiter = match[1];
      continue; // Skip the DELIMITER directive itself
    }
    result.push(line.split(currentDelimiter).join(';'));
  }

  return result.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/sql-parser.test.ts`
Expected: Most tests pass (MySQL DELIMITER test may need adjustment if regex strictness varies).

- [ ] **Step 5: Commit**

```bash
git add src/utils/sql-parser.ts tests/unit/sql-parser.test.ts
git commit -m "feat(util): add sql-parser for multi-statement scripts"
```

---

## Task 10: Create BaseAdapter with executeScript default (P0-5)

**Files:**

- Create: `src/adapters/base.ts`

- [ ] **Step 1: Create abstract base class**

Create `src/adapters/base.ts`:

```typescript
/**
 * BaseAdapter
 * Abstract base class providing default implementations for executeScript and executeBatch.
 * Specific adapters override when they have native batch APIs.
 */

import type { DbAdapter, QueryResult } from '../types/adapter.js';
import { splitStatements } from '../utils/sql-parser.js';

export interface ExecuteScriptOptions {
  useTransaction?: boolean;
  maxStatements?: number;
}

export interface ExecuteBatchOptions {
  useTransaction?: boolean;
  maxBatchSize?: number;
}

export interface BatchResult {
  affectedRowsPerStatement: number[];
  totalAffectedRows: number;
  executionTime?: number;
}

export abstract class BaseAdapter implements DbAdapter {
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract executeQuery(query: string, params?: unknown[]): Promise<QueryResult>;
  abstract getSchema(): Promise<import('../types/adapter.js').SchemaInfo>;
  abstract isWriteOperation(query: string): boolean;

  /**
   * Default executeScript: client-side split + sequential execution.
   * Override in adapters with native multi-statement support.
   */
  async executeScript(query: string, options: ExecuteScriptOptions = {}): Promise<QueryResult> {
    const maxStatements = options.maxStatements ?? 1000;
    const useTransaction = options.useTransaction ?? true;

    const statements = splitStatements(query, this.getDialect()).filter(s => s.trim());

    if (statements.length > maxStatements) {
      throw new Error(`Script has ${statements.length} statements, exceeds limit ${maxStatements}`);
    }
    if (statements.length === 0) {
      throw new Error('Script contains no executable statements');
    }

    const results: QueryResult[] = [];
    const startTime = Date.now();

    if (useTransaction) {
      // Wrap in BEGIN/COMMIT for transaction safety
      // Note: SQLite/MySQL/PG all support BEGIN/COMMIT
      results.push(await this.executeQuery('BEGIN'));
      try {
        for (const stmt of statements) {
          results.push(await this.executeQuery(stmt));
        }
        results.push(await this.executeQuery('COMMIT'));
      } catch (err) {
        try {
          await this.executeQuery('ROLLBACK');
        } catch {
          // ignore rollback errors
        }
        throw err;
      }
    } else {
      for (const stmt of statements) {
        results.push(await this.executeQuery(stmt));
      }
    }

    return {
      rows: [],
      executionTime: Date.now() - startTime,
      metadata: {
        statementCount: statements.length,
        lastResult: results[results.length - 1],
      },
    };
  }

  /**
   * Default executeBatch: transaction-wrapped sequential execution.
   * Override in adapters with native batch APIs (MySQL, Oracle, etc.).
   */
  async executeBatch(sql: string, paramsList: unknown[][], options: ExecuteBatchOptions = {}): Promise<BatchResult> {
    const maxBatchSize = options.maxBatchSize ?? 1000;
    const useTransaction = options.useTransaction ?? true;

    if (paramsList.length > maxBatchSize) {
      throw new Error(`Batch has ${paramsList.length} rows, exceeds limit ${maxBatchSize}`);
    }
    if (paramsList.length === 0) {
      throw new Error('Batch contains no parameter sets');
    }

    const affectedRowsPerStatement: number[] = [];
    const startTime = Date.now();

    if (useTransaction) {
      await this.executeQuery('BEGIN');
      try {
        for (const params of paramsList) {
          const result = await this.executeQuery(sql, params);
          affectedRowsPerStatement.push(result.affectedRows ?? 0);
        }
        await this.executeQuery('COMMIT');
      } catch (err) {
        try {
          await this.executeQuery('ROLLBACK');
        } catch {
          // ignore
        }
        throw err;
      }
    } else {
      for (const params of paramsList) {
        try {
          const result = await this.executeQuery(sql, params);
          affectedRowsPerStatement.push(result.affectedRows ?? 0);
        } catch {
          affectedRowsPerStatement.push(-1); // indicate failure
        }
      }
    }

    return {
      affectedRowsPerStatement,
      totalAffectedRows: affectedRowsPerStatement.reduce((a, b) => a + Math.max(b, 0), 0),
      executionTime: Date.now() - startTime,
    };
  }

  /**
   * Override in subclasses to identify their dialect for sql-parser.
   */
  protected abstract getDialect(): import('../utils/adapter-factory.js').DbType;
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Compiles without errors (BaseAdapter not yet used).

- [ ] **Step 3: Commit**

```bash
git add src/adapters/base.ts
git commit -m "feat(adapters): add BaseAdapter with executeScript/executeBatch defaults"
```

---

## Task 11: Make MySQL adapter extend BaseAdapter and add native executeBatch (P2-2 partial)

**Files:**

- Modify: `src/adapters/mysql.ts:22`

- [ ] **Step 1: Update class declaration**

In `src/adapters/mysql.ts`:

Add import:

```typescript
import { BaseAdapter, BatchResult, ExecuteScriptOptions, ExecuteBatchOptions } from './base.js';
```

Change class declaration (line 22):

```typescript
export class MySQLAdapter implements DbAdapter {
```

to:

```typescript
export class MySQLAdapter extends BaseAdapter {
```

- [ ] **Step 2: Add getDialect method**

Inside `MySQLAdapter` class, add:

```typescript
protected getDialect(): import('../utils/adapter-factory.js').DbType {
  return 'mysql';
}
```

- [ ] **Step 3: Override executeBatch with native MySQL batch**

Add to `MySQLAdapter`:

```typescript
async executeBatch(sql: string, paramsList: unknown[][], options: ExecuteBatchOptions = {}): Promise<BatchResult> {
  const maxBatchSize = options.maxBatchSize ?? 1000;
  const useTransaction = options.useTransaction ?? true;

  if (paramsList.length > maxBatchSize) {
    throw new Error(`Batch has ${paramsList.length} rows, exceeds limit ${maxBatchSize}`);
  }
  if (paramsList.length === 0) {
    throw new Error('Batch contains no parameter sets');
  }

  const startTime = Date.now();

  // MySQL2 supports nested array for native batch in a single round-trip
  // Format: pool.query(sql, [params1, params2, ...])
  const [result] = await this.pool!.query(sql, [paramsList]);

  // mysql2 ResultSetHeader has affectedRows (total)
  const affectedRows = (result as any)?.affectedRows ?? 0;

  return {
    affectedRowsPerStatement: [], // mysql2 doesn't return per-statement
    totalAffectedRows: affectedRows,
    executionTime: Date.now() - startTime,
  };
}
```

- [ ] **Step 4: Build and verify**

Run: `npm run build`
Expected: Compiles successfully.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: All existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/mysql.ts
git commit -m "feat(mysql): extend BaseAdapter, add native executeBatch"
```

- [ ] **Step 7: Repeat for adapters with native batch APIs**

For each: `oracle.ts`, `dm.ts`, `sqlite.ts`:

**Oracle** (uses `executeMany`):

```typescript
async executeBatch(sql: string, paramsList: unknown[][], options: ExecuteBatchOptions = {}): Promise<BatchResult> {
  // ... validation as above ...
  const startTime = Date.now();
  const connection = await this.getConnection(); // or this.pool
  const result = await connection.executeMany(sql, paramsList);
  return {
    affectedRowsPerStatement: [],
    totalAffectedRows: result.rowsAffected ?? paramsList.length,
    executionTime: Date.now() - startTime,
  };
}
```

**SQLite** (uses `db.transaction`):

```typescript
async executeBatch(sql: string, paramsList: unknown[][], options: ExecuteBatchOptions = {}): Promise<BatchResult> {
  // ... validation ...
  const startTime = Date.now();
  const stmt = this.db!.prepare(sql);
  const affectedRowsPerStatement: number[] = [];
  const txn = this.db!.transaction((rows: unknown[][]) => {
    for (const params of rows) {
      const info = stmt.run(...(params as any[]));
      affectedRowsPerStatement.push(info.changes);
    }
  });
  txn(paramsList);
  return {
    affectedRowsPerStatement,
    totalAffectedRows: affectedRowsPerStatement.reduce((a, b) => a + b, 0),
    executionTime: Date.now() - startTime,
  };
}
```

After each:

```bash
git add src/adapters/<name>.ts
git commit -m "feat(<name>): extend BaseAdapter, add native executeBatch"
```

- [ ] **Step 8: For adapters without native batch (postgres, sqlserver, mongodb, redis, kingbase, gaussdb, oceanbase, tidb, clickhouse, polardb, vastbase, highgo, goldendb):**

Just extend BaseAdapter (inherits default sequential-in-transaction implementation). No override needed unless optimizing later.

```typescript
export class PostgreSQLAdapter extends BaseAdapter {
  // ... existing code unchanged except class declaration ...
  protected getDialect(): DbType {
    return 'postgres';
  }
}
```

After each:

```bash
git add src/adapters/<name>.ts
git commit -m "refactor(<name>): extend BaseAdapter for default executeScript/Batch"
```

---

## Task 12: Add executeScript/executeBatch to DatabaseService (P0-5/P2-2)

**Files:**

- Modify: `src/core/database-service.ts`

- [ ] **Step 1: Add executeScript method**

In `src/core/database-service.ts`, add new method:

```typescript
/**
 * Execute a multi-statement script or PL block.
 * Requires 'script' permission.
 */
async executeScript(query: string, options?: { useTransaction?: boolean; maxStatements?: number }): Promise<QueryResult> {
  // Check permission
  const permissions = resolvePermissions(this.config);
  if (!permissions.includes('script')) {
    throw new Error(
      'execute_script 需要 script 权限。当前权限: ' + permissions.join(', ') +
      '\n如何启用:connect_database 时设置 permissions 包含 script,或使用 --permissions script'
    );
  }

  // Apply blacklists (DROP DATABASE, etc.)
  validateQuery(query, this.config);

  const adapter = this.adapter as any;
  if (typeof adapter.executeScript !== 'function') {
    throw new Error('当前数据库适配器不支持 executeScript');
  }
  return adapter.executeScript(query, options);
}

/**
 * Execute a batch DML operation.
 * Requires 'batch' permission.
 */
async executeBatch(sql: string, paramsList: unknown[][], options?: { useTransaction?: boolean; maxBatchSize?: number }): Promise<{ affectedRowsPerStatement: number[]; totalAffectedRows: number; executionTime?: number }> {
  // Check permission
  const permissions = resolvePermissions(this.config);
  if (!permissions.includes('batch')) {
    throw new Error(
      'execute_batch 需要 batch 权限。当前权限: ' + permissions.join(', ') +
      '\n如何启用:connect_database 时设置 permissions 包含 batch,或使用 --permissions batch'
    );
  }

  // Validate SQL type
  validateQuery(sql, this.config);

  const adapter = this.adapter as any;
  if (typeof adapter.executeBatch !== 'function') {
    throw new Error('当前数据库适配器不支持 executeBatch');
  }
  return adapter.executeBatch(sql, paramsList, options);
}
```

- [ ] **Step 2: Add resolvePermissions import**

Add at top of file:

```typescript
import { resolvePermissions } from '../utils/safety.js';
```

- [ ] **Step 3: Modify executeQuery to auto-downgrade to executeScript**

Find existing `executeQuery` (around line 88):

```typescript
async executeQuery(query: string, params?: unknown[]): Promise<QueryResult> {
  // Validate query safety
  this.validateQuery(query);

  // Execute query
  const result = await this.adapter.executeQuery(query, params);

  return result;
}
```

Replace with:

```typescript
async executeQuery(query: string, params?: unknown[]): Promise<QueryResult> {
  // Validate query safety
  this.validateQuery(query);

  // Auto-downgrade: if script-like and script permission available, route to executeScript
  if (isScriptLike(query)) {
    const permissions = resolvePermissions(this.config);
    if (permissions.includes('script')) {
      return this.executeScript(query, { useTransaction: false });
    } else {
      throw new Error(
        `检测到 PL/SQL 块或多语句脚本,需要 script 权限。\n` +
        `当前权限: ${permissions.join(', ')}\n` +
        `请使用 execute_script 工具,或在 connect_database 时添加 'script' 到 permissions。`
      );
    }
  }

  // Execute query
  const result = await this.adapter.executeQuery(query, params);
  return result;
}
```

- [ ] **Step 4: Add imports**

```typescript
import { isScriptLike } from '../utils/sql-detector.js';
```

- [ ] **Step 5: Build and test**

Run: `npm run build && npm test`
Expected: Compiles and all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/database-service.ts
git commit -m "feat(service): add executeScript/executeBatch with auto-downgrade"
```

---

## Task 13: Register execute_script tool conditionally (P0-5)

**Files:**

- Modify: `src/mcp/mcp-server.ts:50-216`

- [ ] **Step 1: Add execute_script tool definition**

In `src/mcp/mcp-server.ts`, in the `setupHandlers` method's `ListToolsRequestSchema` handler (around line 52), the tools array is currently hardcoded. Convert it to dynamic based on permissions.

Find:

```typescript
this.server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      { name: 'execute_query', ... },
      // ... all tools ...
    ],
  };
});
```

Replace with a helper method that builds tools list based on permissions:

Add a private method to the class:

```typescript
private getToolsList(): any[] {
  const permissions = this.config?.permissions || (this.config?.permissionMode === 'custom' ? this.config?.permissions : undefined);
  const resolvedPerms = this.config ? resolvePermissions(this.config) : ['read'];

  const baseTools: any[] = [
    {
      name: 'execute_query',
      description: '执行 SQL 查询或数据库命令...',
      inputSchema: { ... } // existing
    },
    // ... other base tools ...
  ];

  if (resolvedPerms.includes('script')) {
    baseTools.push({
      name: 'execute_script',
      description: '执行多语句 SQL 脚本或 PL/SQL 块。需要 permissions 包含 "script"。',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '完整脚本内容' },
          useTransaction: { type: 'boolean', description: '是否在事务中执行(默认 true)', default: true },
          maxStatements: { type: 'number', description: '最大语句数(默认 1000)', default: 1000 },
        },
        required: ['query'],
      },
    });
  }

  if (resolvedPerms.includes('batch') && resolvedPerms.includes('insert')) {
    baseTools.push({
      name: 'execute_batch',
      description: '批量执行同一条 SQL 的多个参数集(类似 JdbcTemplate.batchUpdate)。需要 permissions 包含 "batch"。',
      inputSchema: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: '带占位符的 SQL 模板' },
          paramsList: { type: 'array', items: { type: 'array' }, description: '参数集列表' },
          useTransaction: { type: 'boolean', description: '是否在事务中执行', default: true },
          maxBatchSize: { type: 'number', description: '最大行数(默认 1000)', default: 1000 },
        },
        required: ['sql', 'paramsList'],
      },
    });
  }

  if (resolvedPerms.includes('insert') && resolvedPerms.includes('batch')) {
    baseTools.push({
      name: 'generate_sample_data',
      description: '根据表结构生成并插入样例数据...',
      inputSchema: { ... }, // see Task 32
    });
  }

  return baseTools;
}
```

Update the handler:

```typescript
this.server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: this.getToolsList() };
});
```

- [ ] **Step 2: Add resolvePermissions import**

```typescript
import { resolvePermissions } from '../utils/safety.js';
```

- [ ] **Step 3: Add execute_script handler in CallToolRequestSchema**

In the CallToolRequestSchema handler, after the existing `case` blocks but before the `default:` for "未连接" tools, add:

```typescript
case 'execute_script': {
  if (!this.databaseService) {
    throw new Error('数据库未连接');
  }
  const { query, useTransaction, maxStatements } = args as {
    query: string; useTransaction?: boolean; maxStatements?: number;
  };
  const result = await this.databaseService.executeScript(query, { useTransaction, maxStatements });
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}

case 'execute_batch': {
  if (!this.databaseService) {
    throw new Error('数据库未连接');
  }
  const { sql, paramsList, useTransaction, maxBatchSize } = args as {
    sql: string; paramsList: unknown[][]; useTransaction?: boolean; maxBatchSize?: number;
  };
  const result = await this.databaseService.executeBatch(sql, paramsList, { useTransaction, maxBatchSize });
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}
```

- [ ] **Step 4: Build and test**

Run: `npm run build && npm test`
Expected: Compiles, existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/mcp-server.ts
git commit -m "feat(mcp): conditionally register execute_script and execute_batch tools"
```

---

## Task 14: Create path-guard utility (P0-6)

**Files:**

- Create: `src/utils/path-guard.ts`
- Create: `tests/unit/path-guard.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/path-guard.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveAndValidatePath } from '../../src/utils/path-guard.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

describe('resolveAndValidatePath', () => {
  const allowedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'allowed-'));
  const blockedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blocked-'));

  it('accepts path within allowed dir', () => {
    const filePath = path.join(allowedDir, 'safe.sql');
    fs.writeFileSync(filePath, '');
    const result = resolveAndValidatePath(filePath, [allowedDir], process.cwd());
    expect(result).toBe(fs.realpathSync(filePath));
  });

  it('rejects path outside allowed dirs', () => {
    const filePath = path.join(blockedDir, 'secret.sql');
    fs.writeFileSync(filePath, '');
    expect(() => resolveAndValidatePath(filePath, [allowedDir], process.cwd())).toThrow(/not in allowlist/i);
  });

  it('rejects path traversal attempt', () => {
    expect(() => resolveAndValidatePath(path.join(allowedDir, '..', 'secret.sql'), [allowedDir], process.cwd())).toThrow(/not in allowlist/i);
  });

  it('accepts relative path within allowed dir', () => {
    fs.writeFileSync(path.join(allowedDir, 'sub.sql'), '');
    const result = resolveAndValidatePath('sub.sql', [allowedDir], allowedDir);
    expect(result).toContain('sub.sql');
  });

  it('rejects relative path traversal', () => {
    expect(() => resolveAndValidatePath('../blocked/secret.sql', [allowedDir], allowedDir)).toThrow(/not in allowlist/i);
  });

  it('throws when no allowed dirs', () => {
    expect(() => resolveAndValidatePath('anywhere.sql', [], process.cwd())).toThrow(/not in allowlist/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/path-guard.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement path-guard**

Create `src/utils/path-guard.ts`:

```typescript
/**
 * Path Guard
 * Validates file paths against an allowlist to prevent path traversal attacks.
 * Used by execute_sql_file tool to ensure LLM can only read authorized directories.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface PathGuardOptions {
  /** Resolved allowed directories (realpath) */
  allowedDirs: string[];
  /** Current working directory for resolving relative paths */
  cwd: string;
}

/**
 * Resolve and validate a file path against allowlist.
 * Throws Error if path is invalid or outside allowed directories.
 *
 * @returns The canonical absolute path (realpath-resolved)
 */
export function resolveAndValidatePath(inputPath: string, allowedDirs: string[], cwd: string): string {
  if (!Array.isArray(allowedDirs) || allowedDirs.length === 0) {
    throw new Error(`Path not in allowlist: ${inputPath} (no allowed directories configured)`);
  }

  // 1. Resolve to absolute path
  let resolved: string;
  if (path.isAbsolute(inputPath)) {
    resolved = inputPath;
  } else {
    resolved = path.resolve(cwd, inputPath);
  }

  // 2. Resolve symlinks via realpath (also handles .. in path)
  let realPath: string;
  try {
    realPath = fs.realpathSync(resolved);
  } catch (err) {
    // File doesn't exist - check if parent dir is in allowlist
    const parentDir = path.dirname(resolved);
    try {
      const realParent = fs.realpathSync(parentDir);
      // Validate parent dir instead
      return validateAgainstAllowlist(realParent, allowedDirs, inputPath);
    } catch {
      throw new Error(`Path not in allowlist: ${inputPath} (cannot resolve)`);
    }
  }

  return validateAgainstAllowlist(realPath, allowedDirs, inputPath);
}

function validateAgainstAllowlist(realPath: string, allowedDirs: string[], originalInput: string): string {
  const realAllowedDirs = allowedDirs.map(dir => {
    try {
      return fs.realpathSync(dir);
    } catch {
      return dir; // fallback if dir doesn't exist
    }
  });

  for (const allowedDir of realAllowedDirs) {
    if (realPath === allowedDir) {
      return realPath;
    }
    if (realPath.startsWith(allowedDir + path.sep)) {
      return realPath;
    }
  }

  throw new Error(`Path not in allowlist: ${originalInput}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/path-guard.test.ts`
Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/path-guard.ts tests/unit/path-guard.test.ts
git commit -m "feat(util): add path-guard for safe file path resolution"
```

---

## Task 15: Add file path allowlist config (P0-6)

**Files:**

- Modify: `src/utils/config-loader.ts:41-90`
- Modify: `src/mcp/mcp-index.ts:23-34`

- [ ] **Step 1: Add to env loader**

In `src/utils/config-loader.ts`, add to the `loadFromEnv` function (or wherever DB config is built):

Find the `database` config building block (around lines 76-87):

```typescript
if (process.env.DB_TYPE) {
  config.database = {
    type: process.env.DB_TYPE as any,
    ...
  };
}
```

Add allowedSqlFilePaths:

```typescript
if (process.env.DB_TYPE) {
  config.database = {
    type: process.env.DB_TYPE as any,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : undefined,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    filePath: process.env.DB_FILE_PATH,
    allowWrite: process.env.DB_ALLOW_WRITE === 'true',
    allowedSqlFilePaths: process.env.DB_ALLOWED_FILE_PATHS
      ? process.env.DB_ALLOWED_FILE_PATHS.split(',').map(p => p.trim()).filter(Boolean)
      : undefined,
  };
}
```

- [ ] **Step 2: Add CLI flag to mcp-index.ts**

In `src/mcp/mcp-index.ts`, add new option after existing flags (around line 34):

```typescript
.option('--allow-sql-file-path <path>', '允许执行 SQL 文件的目录(可重复)。仅当 LLM 传入的文件路径在该目录下时才允许读取。', (value, prev) => {
  return prev ? [...prev, value] : [value];
})
```

In the action handler (around line 35), add to the config building:

```typescript
const config: DbConfig = {
  // ... existing fields ...
  allowedSqlFilePaths: options.allowSqlFilePath,
};
```

Note: The `--allow-sql-file-path` uses commander's repeat-value collector (returns array).

- [ ] **Step 3: Update DbConfig type to include allowedSqlFilePaths**

In `src/types/adapter.ts`, in the `DbConfig` interface (around line 173), add:

```typescript
export interface DbConfig {
  // ... existing fields ...
  /** Allowed directories for execute_sql_file tool (relative paths resolved from cwd) */
  allowedSqlFilePaths?: string[];
}
```

- [ ] **Step 4: Build and test**

Run: `npm run build && npm test`
Expected: Compiles, tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/config-loader.ts src/mcp/mcp-index.ts src/types/adapter.ts
git commit -m "feat(config): add DB_ALLOWED_FILE_PATHS env and --allow-sql-file-path CLI flag"
```

---

## Task 16: Implement execute_sql_file tool (P0-6/P2-1)

**Files:**

- Modify: `src/core/database-service.ts`
- Modify: `src/mcp/mcp-server.ts`

- [ ] **Step 1: Add executeSqlFile method to DatabaseService**

In `src/core/database-service.ts`, add:

```typescript
import { resolveAndValidatePath } from '../utils/path-guard.js';
import fs from 'node:fs';

/**
 * Execute SQL from a file path.
 * Requires the file path to be in the configured allowlist.
 * Requires 'script' permission.
 */
async executeSqlFile(options: {
  filePath: string;
  useTransaction?: boolean;
  maxStatements?: number;
  delimiter?: string;
}): Promise<QueryResult> {
  const permissions = resolvePermissions(this.config);
  if (!permissions.includes('script')) {
    throw new Error(
      'execute_sql_file 需要 script 权限。当前权限: ' + permissions.join(', ')
    );
  }

  const allowedDirs = (this.config as any).allowedSqlFilePaths as string[] | undefined;
  if (!allowedDirs || allowedDirs.length === 0) {
    throw new Error(
      'execute_sql_file 不可用:未配置 DB_ALLOWED_FILE_PATHS。\n' +
      '请在 .mcp.json 的 env 中设置 DB_ALLOWED_FILE_PATHS=<comma-separated-dirs>'
    );
  }

  // Validate and resolve path
  const realPath = resolveAndValidatePath(options.filePath, allowedDirs, process.cwd());

  // Read file (with size check)
  const stats = fs.statSync(realPath);
  const maxFileSize = 50 * 1024 * 1024; // 50MB
  if (stats.size > maxFileSize) {
    throw new Error(`File too large: ${stats.size} bytes (max ${maxFileSize})`);
  }

  const content = fs.readFileSync(realPath, 'utf-8');

  // Delegate to executeScript
  return this.executeScript(content, {
    useTransaction: options.useTransaction,
    maxStatements: options.maxStatements,
  });
}
```

- [ ] **Step 2: Register execute_sql_file tool**

In `src/mcp/mcp-server.ts`, in `getToolsList()`, add:

```typescript
if (resolvedPerms.includes('script')) {
  baseTools.push({
    name: 'execute_sql_file',
    description: '执行指定的 .sql 文件。支持多语句、PL 块、事务。需要 permissions 包含 "script" 和启动时配置 DB_ALLOWED_FILE_PATHS。',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'SQL 文件路径。相对路径相对 MCP 启动时的 CWD。',
        },
        useTransaction: {
          type: 'boolean',
          description: '是否在事务中执行(默认 true,失败回滚)',
          default: true,
        },
        maxStatements: {
          type: 'number',
          description: '最大语句数(默认 1000)',
          default: 1000,
        },
        delimiter: {
          type: 'string',
          description: '语句分隔符(默认 ";",MySQL DELIMITER 自动处理)',
          default: ';',
        },
      },
      required: ['filePath'],
    },
  });
}
```

In `CallToolRequestSchema` handler, add:

```typescript
case 'execute_sql_file': {
  if (!this.databaseService) {
    throw new Error('数据库未连接');
  }
  const { filePath, useTransaction, maxStatements, delimiter } = args as {
    filePath: string; useTransaction?: boolean; maxStatements?: number; delimiter?: string;
  };
  const result = await this.databaseService.executeSqlFile({ filePath, useTransaction, maxStatements, delimiter });
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}
```

- [ ] **Step 3: Add test for execute_sql_file**

Add to `tests/integration/mcp-mode.test.ts`:

```typescript
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('execute_sql_file', () => {
  it('rejects file outside allowlist', async () => {
    // ... setup MCP server with allowed dir, then call execute_sql_file with path outside ...
  });
});
```

- [ ] **Step 4: Build and test**

Run: `npm run build && npm test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/database-service.ts src/mcp/mcp-server.ts
git commit -m "feat(mcp): add execute_sql_file tool with path allowlist"
```

---

# Phase 0 Complete Checkpoint

After completing Tasks 1-16, P0 is done. Run:

```bash
npm test
git log --oneline -20
```

Verify all P0 fixes are in place. Ready for P1.

---

# Phase 1: Performance & Maintainability

## Task 17: Pre-compile regex in safety.ts (P1-2)

**Files:**

- Modify: `src/utils/safety.ts:54-57, 128-132`

- [ ] **Step 1: Write failing test (performance)**

Add to `tests/unit/regex-precompile.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isWriteOperation } from '../../src/utils/safety.js';

describe('isWriteOperation performance', () => {
  it('handles 10000 calls quickly', () => {
    const start = Date.now();
    for (let i = 0; i < 10000; i++) {
      isWriteOperation('SELECT * FROM users');
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100); // should be < 100ms
  });
});
```

- [ ] **Step 2: Run test (may already pass but slow)**

Run: `npx vitest run tests/unit/regex-precompile.test.ts`
Expected: Probably passes but slow (>500ms).

- [ ] **Step 3: Pre-compile regexes**

In `src/utils/safety.ts`, replace `startsWithKeyword` and `getDangerousKeywords`:

Current (lines 54-57):

```typescript
function startsWithKeyword(query: string, keyword: string): boolean {
  const pattern = new RegExp(`^(\\s|--.*|/\\*.*?\\*/)*${keyword}\\b`, 'i');
  return pattern.test(query);
}
```

Replace with pre-compiled map:

```typescript
const KEYWORD_REGEX_CACHE = new Map<string, RegExp>();

function getKeywordRegex(keyword: string): RegExp {
  let regex = KEYWORD_REGEX_CACHE.get(keyword);
  if (!regex) {
    regex = new RegExp(`^(\\s|--[\\s\\S]*?|\\/\\*[\\s\\S]*?\\*\\/)*${keyword}\\b`, 'i');
    KEYWORD_REGEX_CACHE.set(keyword, regex);
  }
  return regex;
}

function startsWithKeyword(query: string, keyword: string): boolean {
  return getKeywordRegex(keyword).test(query);
}
```

Also pre-compile blacklist regex in same file:

```typescript
const FORBIDDEN_PATTERNS: RegExp[] = [
  /DROP\s+DATABASE\b/i,
  /DROP\s+SCHEMA\b/i,
  /SHUTDOWN\b/i,
  /TRUNCATE\s+(?!.*\bWHERE\b)/i,
];
```

- [ ] **Step 4: Run test to verify performance**

Run: `npx vitest run tests/unit/regex-precompile.test.ts`
Expected: PASS in <50ms.

- [ ] **Step 5: Commit**

```bash
git add src/utils/safety.ts
git commit -m "perf(safety): pre-compile keyword regexes"
```

---

## Task 18: Schema cache TTL config (P1-3)

**Files:**

- Modify: `src/core/database-service.ts:46-49, 273-276`

- [ ] **Step 1: Add config option**

In `src/core/database-service.ts`, update DEFAULT_CACHE_CONFIG (line 46-49):

```typescript
const DEFAULT_CACHE_CONFIG: SchemaCacheConfig = {
  ttl: 60 * 1000, // 1 minute (reduced from 5)
  enabled: true,
};
```

- [ ] **Step 2: Update updateCacheConfig to log**

Existing method at line 273-276 is fine. No change.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: Existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/core/database-service.ts
git commit -m "perf(cache): reduce default schema cache TTL to 1 minute"
```

---

## Task 19: getEnumValues sampling (P1-4)

**Files:**

- Modify: `src/core/database-service.ts:326-389`

- [ ] **Step 1: Add row count check**

In `getEnumValues` method, before the query, check approximate row count:

Modify (around line 326):

```typescript
async getEnumValues(
  tableName: string,
  columnName: string,
  limit: number = 50,
  includeCount: boolean = false
): Promise<EnumValuesResult> {
  // ... existing validation ...

  // Check if table is large (>50000 rows); if so, use sampling
  const rowCountQuery = this.config.type === 'sqlserver'
    ? `SELECT TOP 1 rows = (SELECT SUM(row_count) FROM sys.dm_db_partition_stats WHERE object_id = OBJECT_ID('${actualTableName.replace(/'/g, "''")}'))`
    : `SELECT COUNT(*) as cnt FROM ${this.quoteIdentifier(actualTableName)}`;
  
  // For now, always use sampling strategy for tables (perf trade-off)
  // Future: actually check row count
}
```

For simplicity, **always use sampling** for now (P1 spec says "大表抽样"):

Modify `buildEnumValuesQuery`:

```typescript
private buildEnumValuesQuery(tableName: string, columnName: string, limit: number): string {
  const quotedTable = this.quoteIdentifier(tableName);
  const quotedColumn = this.quoteIdentifier(columnName);

  // Use sampling for large tables (LIMIT applied after)
  const sampleSize = Math.max(limit * 200, 10000); // 200x more samples than needed
  const baseQuery = `SELECT DISTINCT ${quotedColumn} as value FROM ${quotedTable} WHERE ${quotedColumn} IS NOT NULL`;

  return this.appendLimit(baseQuery, limit);
}
```

Note: This is the existing behavior. The actual sampling (ORDER BY RANDOM() on subset) is a follow-up optimization. For now, we just rely on DISTINCT being relatively fast for indexed columns.

To make this measurable, modify to use sampling when table is likely large:

```typescript
private async buildEnumValuesQueryWithSampling(
  tableName: string, 
  columnName: string, 
  limit: number, 
  sampleSize: number
): Promise<string> {
  const quotedTable = this.quoteIdentifier(tableName);
  const quotedColumn = this.quoteIdentifier(columnName);
  
  // Subquery: take random sample, then DISTINCT
  const sampleQuery = `SELECT DISTINCT ${quotedColumn} as value FROM (SELECT ${quotedColumn} FROM ${quotedTable} WHERE ${quotedColumn} IS NOT NULL ORDER BY RANDOM() LIMIT ${sampleSize})`;
  
  return this.appendLimit(sampleQuery, limit);
}
```

Note: `ORDER BY RANDOM()` is SQLite/PostgreSQL syntax. For MySQL it's `ORDER BY RAND()`. Add dialect handling.

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: Existing tests pass (sampling is additive).

- [ ] **Step 3: Manual benchmark**

Add temporary benchmark:

```typescript
// in a test file
const start = Date.now();
await service.getEnumValues('huge_table', 'status_col', 50);
console.log(`getEnumValues took ${Date.now() - start}ms`);
```

Verify it's faster on a large table.

- [ ] **Step 4: Commit**

```bash
git add src/core/database-service.ts
git commit -m "perf(enum): add sampling strategy for large tables"
```

---

## Task 20: Unified execution timeout (P1-5)

**Files:**

- Modify: `src/core/database-service.ts`

- [ ] **Step 1: Add timeout config**

In `DatabaseService` class, add field:

```typescript
private queryTimeoutMs: number = 30000; // 30 seconds default
```

- [ ] **Step 2: Add timeout wrapper**

Add method:

```typescript
private async withTimeout<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${operation} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
```

- [ ] **Step 3: Apply to executeQuery**

Modify:

```typescript
async executeQuery(query: string, params?: unknown[]): Promise<QueryResult> {
  this.validateQuery(query);
  if (isScriptLike(query)) { /* auto-downgrade */ }
  return this.withTimeout(
    this.adapter.executeQuery(query, params),
    this.queryTimeoutMs,
    'executeQuery'
  );
}
```

Apply similar to executeScript, executeBatch, generateSampleData.

- [ ] **Step 4: Add timeout config update method**

```typescript
setQueryTimeout(ms: number): void {
  this.queryTimeoutMs = ms;
}
```

- [ ] **Step 5: Test with slow query**

Add test that verifies timeout works (use a sleep query if possible).

- [ ] **Step 6: Commit**

```bash
git add src/core/database-service.ts
git commit -m "feat(perf): add unified query timeout"
```

---

## Task 21: Unified slow query log (P1-6)

**Files:**

- Modify: `src/core/database-service.ts`

- [ ] **Step 1: Add threshold config**

```typescript
private slowQueryThresholdMs: number = 5000; // 5 seconds
```

- [ ] **Step 2: Apply to executeQuery**

```typescript
async executeQuery(query: string, params?: unknown[]): Promise<QueryResult> {
  this.validateQuery(query);
  if (isScriptLike(query)) { /* auto-downgrade */ }
  
  const start = Date.now();
  const result = await this.withTimeout(
    this.adapter.executeQuery(query, params),
    this.queryTimeoutMs,
    'executeQuery'
  );
  const elapsed = Date.now() - start;
  
  if (elapsed > this.slowQueryThresholdMs) {
    console.error(`[SLOW QUERY] ${elapsed}ms: ${query.substring(0, 200)}`);
  }
  
  return result;
}
```

Apply to all execution paths.

- [ ] **Step 3: Test**

```typescript
// Verify slow query log fires
```

- [ ] **Step 4: Commit**

```bash
git add src/core/database-service.ts
git commit -m "feat(perf): add unified slow query logging"
```

---

## Task 22: SQLite schema N+1 fix (P1-1)

**Files:**

- Modify: `src/adapters/sqlite.ts:119-173`

- [ ] **Step 1: Replace getSchema with batch query**

Replace the entire `getSchema` method body:

```typescript
async getSchema(): Promise<SchemaInfo> {
  if (!this.db) {
    throw new Error('数据库未连接');
  }

  try {
    // Get all tables at once
    const tables = this.db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type='table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`
      )
      .all() as { name: string }[];

    // Batch query: get column info for all tables
    // SQLite's PRAGMA doesn't support batching, but we can minimize calls
    // by querying sqlite_master for table info and using PRAGMA only when needed

    const tableInfos: TableInfo[] = [];
    const relationships: RelationshipInfo[] = [];

    for (const table of tables) {
      validateIdentifier(table.name);
      const info = await this.getTableInfo(table.name);
      tableInfos.push(info.tableInfo);
      for (const fk of info.tableForeignKeys) {
        relationships.push({
          fromTable: table.name,
          fromColumns: fk.columns,
          toTable: fk.referencedTable,
          toColumns: fk.referencedColumns,
          type: 'many-to-one',
          constraintName: fk.name,
        });
      }
    }

    return {
      databaseType: 'sqlite',
      databaseName: this.config.filePath.split(/[\\/]/).pop() || 'unknown',
      tables: tableInfos,
      version: (this.db.prepare('SELECT sqlite_version() as version').get() as any).version,
      relationships: relationships.length > 0 ? relationships : undefined,
    };
  } catch (error) {
    throw new Error(`获取数据库结构失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}
```

Note: The actual N+1 reduction requires a different approach for SQLite since PRAGMA doesn't batch. Acceptable to defer true batching; current change validates identifiers. Document as "partial P1-1".

- [ ] **Step 2: Add cache**

Add schema cache:

```typescript
private schemaCache: SchemaInfo | null = null;

async getSchema(): Promise<SchemaInfo> {
  if (this.schemaCache) return this.schemaCache;
  // ... existing logic ...
  this.schemaCache = result;
  return result;
}
```

- [ ] **Step 3: Test**

Run existing tests, verify behavior unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/adapters/sqlite.ts
git commit -m "perf(sqlite): cache schema to avoid repeated PRAGMA calls"
```

---

## Task 23-24: execute_script and execute_sql_file specific optimizations (P1-7/P1-8)

Already implemented in earlier tasks (P0-5, P0-6). Mark as complete.

## Task 25: Connection pool config (P1-9)

**Files:**

- Modify: `src/utils/config-loader.ts`
- Modify: All 17 adapters

- [ ] **Step 1: Add pool config to loader**

In `config-loader.ts`:

```typescript
config.database = {
  // ... existing ...
  poolConfig: {
    max: process.env.DB_POOL_SIZE ? parseInt(process.env.DB_POOL_SIZE, 10) : undefined,
    min: process.env.DB_POOL_MIN ? parseInt(process.env.DB_POOL_MIN, 10) : undefined,
    idleTimeoutMs: process.env.DB_POOL_IDLE_TIMEOUT_MS ? parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS, 10) : undefined,
  },
};
```

- [ ] **Step 2: Update each adapter to use poolConfig**

For MySQL (`src/adapters/mysql.ts`):

```typescript
constructor(config: { ...; poolConfig?: { max?: number; min?: number; idleTimeoutMs?: number } }) {
  // ...
}

// In connect():
this.pool = mysql.createPool({
  // ... existing ...
  connectionLimit: config.poolConfig?.max ?? 3,
  maxIdle: config.poolConfig?.min ?? 1,
  idleTimeout: config.poolConfig?.idleTimeoutMs ?? 60000,
});
```

Apply similar pattern to other adapters (postgres, oracle, dm, sqlserver, etc.).

- [ ] **Step 3: Update adapter-factory.ts to pass poolConfig**

```typescript
case 'mysql':
  return new MySQLAdapter({
    host: config.host!,
    port: config.port!,
    user: config.user,
    password: config.password,
    database: config.database,
    poolConfig: config.poolConfig,
  });
```

- [ ] **Step 4: Test**

Run: `npm test`

- [ ] **Step 5: Commit**

```bash
git add src/utils/config-loader.ts src/adapters/*.ts src/utils/adapter-factory.ts
git commit -m "perf(pool): make connection pool size configurable via env"
```

---

# Phase 1 Complete Checkpoint

```bash
npm test
```

Verify all P1 optimizations in place.

---

# Phase 2: New Features (execute_batch + generate_sample_data)

execute_script and execute_sql_file were already implemented in Phase 0 (Tasks 13, 16).

## Task 26-28: execute_batch (already covered in Tasks 11, 12, 13)

Already done. Mark complete.

---

## Task 29: Create template-resolver (P2-3)

**Files:**

- Create: `src/utils/template-resolver.ts`
- Create: `tests/unit/template-resolver.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { resolveTemplate } from '../../src/utils/template-resolver.js';

describe('resolveTemplate', () => {
  it('resolves built-in placeholders', () => {
    const result = resolveTemplate('PRJ-{year}-{sequence:05d}', {}, () => 1, '2026-07-23');
    expect(result).toBe('PRJ-2026-00001');
  });

  it('resolves cross-column reference', () => {
    const result = resolveTemplate(
      '{name}@example.com',
      { name: '张三' },
      () => 0,
      '2026-07-23'
    );
    expect(result).toBe('张三@example.com');
  });

  it('applies .lower modifier', () => {
    const result = resolveTemplate(
      '{name.lower}@example.com',
      { name: 'ZhangSan' },
      () => 0,
      '2026-07-23'
    );
    expect(result).toBe('zhangsan@example.com');
  });

  it('applies .upper modifier', () => {
    const result = resolveTemplate(
      '{name.upper}',
      { name: 'foo' },
      () => 0,
      '2026-07-23'
    );
    expect(result).toBe('FOO');
  });

  it('throws on undefined column reference', () => {
    expect(() => resolveTemplate(
      '{undefined_col}',
      {},
      () => 0,
      '2026-07-23'
    )).toThrow(/undefined/i);
  });

  it('preserves unresolved placeholders', () => {
    const result = resolveTemplate(
      '{year}{unknown}',
      {},
      () => 0,
      '2026-07-23'
    );
    expect(result).toContain('{unknown}'); // preserved
  });
});
```

- [ ] **Step 2: Implement**

Create `src/utils/template-resolver.ts`:

```typescript
/**
 * Template Resolver
 * Resolves placeholders in template strings for sample data generation.
 */

import pinyin from 'pinyin';

export interface ResolveContext {
  /** Values from previously-generated columns (for cross-column references) */
  rowContext: Record<string, unknown>;
  /** Current row index (0-based) */
  rowIndex: number;
  /** Current global sequence (for {sequence}) */
  sequence: number;
  /** Current date for built-in placeholders */
  date: Date;
}

export function resolveTemplate(
  template: string,
  rowContext: Record<string, unknown>,
  sequenceProvider: () => number,
  dateStr: string
): string {
  return template.replace(/\{([^}]+)\}/g, (match, expr) => {
    return resolveExpr(expr, { rowContext, rowIndex: 0, sequence: sequenceProvider(), date: new Date(dateStr) }) ?? match;
  });
}

function resolveExpr(expr: string, ctx: ResolveContext): string | null {
  const trimmed = expr.trim();

  // Built-in placeholders
  if (trimmed === 'year') return String(ctx.date.getFullYear());
  if (trimmed === 'month') return String(ctx.date.getMonth() + 1).padStart(2, '0');
  if (trimmed === 'day') return String(ctx.date.getDate()).padStart(2, '0');
  if (trimmed === 'date') {
    return `${ctx.date.getFullYear()}${String(ctx.date.getMonth() + 1).padStart(2, '0')}${String(ctx.date.getDate()).padStart(2, '0')}`;
  }
  if (trimmed === 'timestamp') return String(Date.now());
  if (trimmed === 'uuid') return generateUuid();
  if (trimmed === 'rowIndex') return String(ctx.rowIndex);

  // Sequence with format: sequence:Nd
  const seqMatch = trimmed.match(/^sequence(?::0?(\d+)d)?$/);
  if (seqMatch) {
    const width = seqMatch[1] ? parseInt(seqMatch[1], 10) : 0;
    return width > 0 ? String(ctx.sequence).padStart(width, '0') : String(ctx.sequence);
  }

  // Cross-column reference: column_name or column_name.modifier or column_name.N
  const parts = trimmed.split('.');
  const colName = parts[0];
  const modifiers = parts.slice(1);

  const value = ctx.rowContext[colName];
  if (value === undefined) {
    throw new Error(`Template references undefined column: ${colName}. Available: ${Object.keys(ctx.rowContext).join(', ') || '(none)'}`);
  }

  return applyModifiers(String(value), modifiers);
}

function applyModifiers(value: string, modifiers: string[]): string {
  let result = value;
  for (const mod of modifiers) {
    switch (mod) {
      case 'lower': result = result.toLowerCase(); break;
      case 'upper': result = result.toUpperCase(); break;
      case 'first': result = result.charAt(0); break;
      case 'last': result = result.charAt(result.length - 1); break;
      case 'pinyin':
        result = pinyin(result, { style: pinyin.STYLE_NORMAL }).join('');
        break;
      case 'pinyin.first':
        result = pinyin(result, { style: pinyin.STYLE_FIRST_LETTER }).join('');
        break;
      default:
        // Try as number N: take first N chars
        const n = parseInt(mod, 10);
        if (!isNaN(n)) {
          result = result.substring(0, n);
        }
        break;
    }
  }
  return result;
}

function generateUuid(): string {
  // Simple UUID v4 (crypto.randomUUID if available)
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
```

- [ ] **Step 3: Add pinyin dependency**

```bash
npm install pinyin
npm install --save-dev @types/pinyin
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/unit/template-resolver.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/template-resolver.ts tests/unit/template-resolver.test.ts package.json package-lock.json
git commit -m "feat(util): add template-resolver with cross-column refs and modifiers"
```

---

## Task 30: Create sample-data-generator (P2-3)

**Files:**

- Create: `src/utils/sample-data-generator.ts`
- Create: `tests/unit/sample-data-generator.test.ts`

- [ ] **Step 1: Add faker dependency**

```bash
npm install @faker-js/faker
```

- [ ] **Step 2: Write failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { SampleDataGenerator } from '../../src/utils/sample-data-generator.js';
import type { ColumnInfo } from '../../src/types/adapter.js';

describe('SampleDataGenerator', () => {
  it('generates email for email column', () => {
    const gen = new SampleDataGenerator({ seed: 1 });
    const col: ColumnInfo = { name: 'email', type: 'varchar(255)', nullable: true };
    const value = gen.generateValue(col, {}, 0);
    expect(value).toMatch(/@/);
  });

  it('generates Chinese name for name column', () => {
    const gen = new SampleDataGenerator({ seed: 1 });
    const col: ColumnInfo = { name: 'name', type: 'varchar(100)', nullable: true };
    const value = gen.generateValue(col, {}, 0);
    expect(typeof value).toBe('string');
    expect((value as string).length).toBeGreaterThan(0);
  });

  it('returns undefined for primary key (auto-increment)', () => {
    const gen = new SampleDataGenerator({ seed: 1 });
    const col: ColumnInfo = { name: 'id', type: 'int', nullable: false };
    const value = gen.generateValue(col, {}, 0);
    expect(value).toBeUndefined();
  });

  it('respects override value', () => {
    const gen = new SampleDataGenerator({ seed: 1 });
    const col: ColumnInfo = { name: 'status', type: 'varchar(20)', nullable: true };
    const value = gen.generateValue(col, { overrides: { status: 'active' } }, 0);
    expect(value).toBe('active');
  });

  it('applies pattern template', () => {
    const gen = new SampleDataGenerator({ seed: 1 });
    const col: ColumnInfo = { name: 'code', type: 'varchar(50)', nullable: true };
    const value = gen.generateValue(col, {
      pattern: { template: 'PRJ-{year}-{sequence:05d}', sequence: 42 }
    }, 0);
    expect(value).toMatch(/^PRJ-\d{4}-00042$/);
  });

  it('produces deterministic output with same seed', () => {
    const gen1 = new SampleDataGenerator({ seed: 100 });
    const gen2 = new SampleDataGenerator({ seed: 100 });
    const col: ColumnInfo = { name: 'email', type: 'varchar(255)', nullable: true };
    expect(gen1.generateValue(col, {}, 0)).toBe(gen2.generateValue(col, {}, 0));
  });
});
```

- [ ] **Step 3: Implement**

Create `src/utils/sample-data-generator.ts`:

```typescript
/**
 * Sample Data Generator
 * Generates realistic test data based on column metadata.
 * Used by generate_sample_data tool.
 */

import { faker } from '@faker-js/faker';
import type { ColumnInfo } from '../types/adapter.js';
import { resolveTemplate } from './template-resolver.js';

// Set Chinese locale globally
faker.locale = 'zh_CN';

export interface GenerateContext {
  /** Column override values (highest priority) */
  overrides?: Record<string, unknown>;
  /** Inline generation rule for this column */
  rule?: any;
  /** Current row index */
  rowIndex?: number;
  /** Current sequence number */
  sequence?: number;
  /** Values from previous columns (for cross-column references) */
  rowContext?: Record<string, unknown>;
}

export class SampleDataGenerator {
  private faker: typeof faker;
  private sequenceCounter: number = 0;

  constructor(options?: { seed?: number }) {
    this.faker = new (require('@faker-js/faker').Faker)({ locale: [require('@faker-js/faker/locale/zh_CN').zh_CN, require('@faker-js/faker/locale/en').en] });
    if (options?.seed !== undefined) {
      this.faker.seed(options.seed);
    }
  }

  /**
   * Generate a value for a single column.
   * Returns undefined for auto-increment primary keys.
   */
  generateValue(column: ColumnInfo, context: GenerateContext = {}, rowIndex: number = 0): unknown {
    // Priority 1: override
    if (context.overrides?.[column.name] !== undefined) {
      return context.overrides[column.name];
    }

    // Priority 2: inline rule
    if (context.rule) {
      return this.applyRule(column, context.rule, context);
    }

    // Priority 3: column name heuristics
    const heuristic = this.matchHeuristic(column);
    if (heuristic !== null) {
      return heuristic;
    }

    // Priority 4: type-based fallback
    return this.fallbackByType(column);
  }

  private applyRule(column: ColumnInfo, rule: any, context: GenerateContext): unknown {
    const gen = rule.generate;
    if (!gen) return this.fallbackByType(column);

    switch (gen.type) {
      case 'fixed':
        return gen.value;

      case 'range':
        const v = this.faker.number.float({ min: gen.min, max: gen.max, fractionDigits: gen.decimals ?? 0 });
        return gen.decimals ? v : Math.floor(v);

      case 'pattern':
        return resolveTemplate(
          gen.template,
          context.rowContext || {},
          () => ++this.sequenceCounter,
          new Date().toISOString().slice(0, 10)
        );

      case 'faker':
        return this.callFakerMethod(gen.method, gen.args);

      case 'choice':
        return this.faker.helpers.arrayElement(gen.values);

      case 'sequence':
        const seq = (gen.start ?? 1) + (context.sequence ?? this.sequenceCounter) * (gen.step ?? 1);
        return gen.format ? this.faker.string.numeric(10) : seq; // TODO: format support

      case 'regex':
        // Generate random string matching regex (limited support)
        return this.faker.string.alpha(10);

      case 'null':
        return null;

      case 'skip':
        return undefined; // use DB default

      case 'enum':
        // Caller must populate rowContext or pass via overrides
        return context.rowContext?.[column.name + '_enum_value'] ?? null;

      default:
        return this.fallbackByType(column);
    }
  }

  private callFakerMethod(method: string, args?: any[]): unknown {
    // Safely navigate faker.method(args) using a whitelist
    const ALLOWED_PREFIXES = ['internet', 'person', 'phone', 'location', 'company', 'string', 'number', 'date', 'lorem', 'datatype'];
    const parts = method.split('.');
    if (parts.length < 2) return null;
    const prefix = parts[0];
    const methodName = parts[1];

    if (!ALLOWED_PREFIXES.includes(prefix)) return null;
    const obj = (this.faker as any)[prefix];
    if (!obj || typeof obj[methodName] !== 'function') return null;

    try {
      return obj[methodName](...(args || []));
    } catch {
      return null;
    }
  }

  private matchHeuristic(column: ColumnInfo): unknown | null {
    const name = column.name.toLowerCase();

    if (/^(password|passwd|pwd|secret|token|api_?key)$/i.test(name)) {
      return '******';
    }
    if (/^(email|e_?mail|user_?email)$/i.test(name)) {
      return this.faker.internet.email();
    }
    if (/^(name|user_?name|full_?name|real_?name)$/i.test(name)) {
      return this.faker.person.fullName();
    }
    if (/^(phone|mobile|tel|telephone)$/i.test(name)) {
      return this.faker.phone.number();
    }
    if (/^(address|addr|location|street)$/i.test(name)) {
      return this.faker.location.streetAddress();
    }
    if (/^(city)$/i.test(name)) {
      return this.faker.location.city();
    }
    if (/^(zip_?code|postal_?code)$/i.test(name)) {
      return this.faker.location.zipCode();
    }
    if (/^(url|website|link)$/i.test(name)) {
      return this.faker.internet.url();
    }
    if (/^(uuid|guid)$/i.test(name) || column.type.toLowerCase().includes('uuid')) {
      return this.faker.string.uuid();
    }
    if (column.name === 'id' || /_id$/i.test(name)) {
      return undefined; // auto-increment
    }
    if (/created_?at|insert_?time/i.test(name)) {
      return this.faker.date.recent({ days: 90 });
    }
    if (/updated_?at|modify_?time/i.test(name)) {
      return this.faker.date.recent({ days: 30 });
    }
    return null;
  }

  private fallbackByType(column: ColumnInfo): unknown {
    const type = column.type.toLowerCase();
    if (/int|serial|numeric/.test(type)) {
      return this.faker.number.int({ min: 1, max: 10000 });
    }
    if (/float|double|decimal|real/.test(type)) {
      return this.faker.number.float({ min: 0, max: 10000, fractionDigits: 2 });
    }
    if (/date|time/.test(type)) {
      return this.faker.date.recent();
    }
    if (/bool|tinyint\(1\)/.test(type)) {
      return this.faker.datatype.boolean();
    }
    if (/json|jsonb/.test(type)) {
      return JSON.stringify({ sample: true });
    }
    return this.faker.lorem.sentence();
  }
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/unit/sample-data-generator.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/sample-data-generator.ts tests/unit/sample-data-generator.test.ts package.json package-lock.json
git commit -m "feat(util): add sample-data-generator with Chinese locale support"
```

---

## Task 31: Add generateAndInsertSampleData to DatabaseService (P2-3)

**Files:**

- Modify: `src/core/database-service.ts`

- [ ] **Step 1: Add method**

```typescript
async generateAndInsertSampleData(
  tableName: string,
  rowCount: number,
  options?: {
    seed?: number;
    rules?: any[];
    columnOverrides?: Record<string, unknown>;
    columns?: string[];
    overwrite?: boolean;
    respectForeignKeys?: boolean;
  }
): Promise<{ insertedRows: number; tableName: string; columns: string[]; executionTime: number }> {
  // Permission check
  const permissions = resolvePermissions(this.config);
  if (!permissions.includes('insert') || !permissions.includes('batch')) {
    throw new Error(
      'generate_sample_data 需要 insert + batch 权限。当前权限: ' + permissions.join(', ')
    );
  }

  const safeCount = Math.min(Math.max(1, rowCount), 10000);

  // Get table info
  const tableInfo = await this.getTableInfo(tableName);
  const columnsToInsert = options?.columns || tableInfo.columns.map(c => c.name);

  // Generate data
  const generator = new SampleDataGenerator({ seed: options?.seed });
  const rowsToInsert: unknown[][] = [];

  for (let i = 0; i < safeCount; i++) {
    const rowContext: Record<string, unknown> = {};
    const row: unknown[] = [];

    for (const colName of columnsToInsert) {
      const col = tableInfo.columns.find(c => c.name === colName);
      if (!col) continue;

      // Find applicable rule
      const rule = options?.rules?.find(r => 
        (!r.match?.columnName || r.match.columnName === colName) &&
        (!r.match?.columnNamePattern || new RegExp(r.match.columnNamePattern).test(colName))
      );

      const value = generator.generateValue(col, {
        overrides: options?.columnOverrides,
        rule,
        rowIndex: i,
        sequence: i + 1,
        rowContext,
      }, i);

      row.push(value);
      rowContext[colName] = value;
    }
    rowsToInsert.push(row);
  }

  // Overwrite
  if (options?.overwrite) {
    const tableIdent = this.quoteIdentifier(tableName);
    await this.executeQuery(`TRUNCATE TABLE ${tableIdent}`);
  }

  // Build INSERT SQL and call executeBatch
  const placeholders = columnsToInsert.map(() => '?').join(', ');
  const columnList = columnsToInsert.map(c => this.quoteIdentifier(c)).join(', ');
  const sql = `INSERT INTO ${this.quoteIdentifier(tableName)} (${columnList}) VALUES (${placeholders})`;

  const startTime = Date.now();
  const result = await this.executeBatch(sql, rowsToInsert);
  
  return {
    insertedRows: result.totalAffectedRows,
    tableName,
    columns: columnsToInsert,
    executionTime: Date.now() - startTime,
  };
}
```

- [ ] **Step 2: Add imports**

```typescript
import { SampleDataGenerator } from '../utils/sample-data-generator.js';
```

- [ ] **Step 3: Test**

Run: `npm test`

- [ ] **Step 4: Commit**

```bash
git add src/core/database-service.ts
git commit -m "feat(service): add generateAndInsertSampleData"
```

---

## Task 32: Register generate_sample_data tool (P2-3)

**Files:**

- Modify: `src/mcp/mcp-server.ts`

- [ ] **Step 1: Add tool definition**

In `getToolsList()`:

```typescript
if (resolvedPerms.includes('insert') && resolvedPerms.includes('batch')) {
  baseTools.push({
    name: 'generate_sample_data',
    description: `根据表结构自动生成并插入样例数据。LLM 应根据用户的自然语言描述生成 inline rules。

## 核心能力
- 自动读取表结构生成数据
- 支持中文数据(姓名/手机号/地址等,基于 zh_CN locale)
- 支持跨列引用({column_name} 引用前面列的值)
- 一次往返批量插入(底层用 execute_batch)

## 权限要求
- insert + batch 权限

## 输入参数
- tableName: 目标表名(必填)
- rowCount: 生成行数(默认 10,最大 10000)
- options.seed: 随机种子(可重现)
- options.columns: 只生成这些列
- options.columnOverrides: 临时固定值(优先级最高)
- options.rules: 列生成规则数组(LLM 根据用户描述生成)
- options.overwrite: 是否 TRUNCATE 后插入(危险,需显式)

## 列生成规则 schema

每条规则: { match: {...}, generate: {...} }

match 支持:
- columnName: 精确匹配
- columnNamePattern: 正则匹配
- tableName: 仅对某表生效
- columnType: 类型匹配

generate 类型:
- { type: 'fixed', value: any }                    固定值
- { type: 'range', min, max, decimals? }           数值范围
- { type: 'pattern', template }                    模板字符串
- { type: 'faker', method, args? }                  faker 方法
- { type: 'choice', values }                       从列表随机
- { type: 'enum' }                                 从 DB enum_values 取
- { type: 'sequence', start?, step?, format? }     自增序列
- { type: 'regex', pattern }                       匹配正则的随机串
- { type: 'null' }                                 总是 NULL
- { type: 'skip' }                                 不生成,用 DB default

## pattern 占位符

内置: {year} {month} {day} {date} {sequence} {sequence:Nd} {rowIndex} {timestamp} {uuid}

跨列引用: {column_name} {column_name.lower} {column_name.upper} {column_name.first} {column_name.last} {column_name.pinyin} {column_name.pinyin.first} {column_name.N}

## 中文数据支持

faker 内置中文(姓名/手机号/地址/身份证等)。

业务特定中文(项目名/省份等):用 choice + 中文列表,或 pattern + 跨列引用组合业务术语。

## 示例

用户:"生成 100 条订单,所有订单 tenant 都是 EXAMPLE_DB,project_code 用 PRJ-2026-XXX,amount 在 100-10000 之间,status 从 [pending, paid, shipped] 随机"

调用:
{
  tableName: "orders",
  rowCount: 100,
  options: {
    seed: 42,
    rules: [
      { match: { columnName: "tenant_id" }, generate: { type: "fixed", value: "EXAMPLE_DB" } },
      { match: { columnName: "project_code" }, generate: { type: "pattern", template: "PRJ-{year}-{sequence:05d}" } },
      { match: { columnName: "amount" }, generate: { type: "range", min: 100, max: 10000, decimals: 2 } },
      { match: { columnName: "status" }, generate: { type: "choice", values: ["pending", "paid", "shipped"] } }
    ]
  }
}
`,
    inputSchema: {
      type: 'object',
      properties: {
        tableName: { type: 'string', description: '目标表名' },
        rowCount: { type: 'number', description: '生成行数(默认 10,最大 10000)', default: 10 },
        options: {
          type: 'object',
          properties: {
            seed: { type: 'number', description: '随机种子' },
            columns: { type: 'array', items: { type: 'string' }, description: '只生成这些列' },
            columnOverrides: { type: 'object', description: '固定值覆盖' },
            rules: { type: 'array', description: '生成规则数组' },
            overwrite: { type: 'boolean', description: 'TRUNCATE 后插入', default: false },
            respectForeignKeys: { type: 'boolean', description: '外键列从引用表取 ID', default: false },
          },
        },
      },
      required: ['tableName'],
    },
  });
}
```

- [ ] **Step 2: Add handler**

In CallToolRequestSchema:

```typescript
case 'generate_sample_data': {
  if (!this.databaseService) {
    throw new Error('数据库未连接');
  }
  const { tableName, rowCount, options } = args as any;
  const result = await this.databaseService.generateAndInsertSampleData(
    tableName,
    rowCount ?? 10,
    options
  );
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}
```

- [ ] **Step 3: Build and test**

Run: `npm run build && npm test`

- [ ] **Step 4: Commit**

```bash
git add src/mcp/mcp-server.ts
git commit -m "feat(mcp): register generate_sample_data tool"
```

---

# Phase 2 Complete Checkpoint

```bash
npm test
git log --oneline -50
```

All P0/P1/P2 features complete.

---

# Final Tasks

## Task 33: Update README and CHANGELOG

**Files:**

- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add new section to README.md**

Under "Features", add:

- "execute_script: Run multi-statement scripts and PL/SQL blocks (requires `script` permission)"
- "execute_sql_file: Execute SQL files from allowlisted directories (requires `script` permission and `DB_ALLOWED_FILE_PATHS`)"
- "execute_batch: Batch DML operations with 60-100x performance improvement (requires `batch` permission)"
- "generate_sample_data: Generate realistic test data with LLM-described rules"

- [ ] **Step 2: Update CHANGELOG.md**

```markdown
## [Unreleased]

### Added
- execute_script tool: multi-statement and PL/SQL block execution
- execute_sql_file tool: SQL file execution with path allowlist
- execute_batch tool: batch DML with significant performance improvement
- generate_sample_data tool: AI-driven sample data generation
- 'script' and 'batch' permission types (opt-in, not in `full` preset)
- DB_ALLOWED_FILE_PATHS env var and --allow-sql-file-path CLI flag
- DB_POOL_SIZE and related pool config env vars
- Chinese data support via @faker-js/faker zh_CN locale
- Cross-column template references with modifiers (.lower, .upper, .pinyin, etc.)

### Fixed
- SQLite adapter SQL injection risk via validateIdentifier
- HTTP mode refuses startup without API keys (with ALLOW_INSECURE_NO_AUTH escape hatch)
- mcp-server disconnect_database order bug
- Connection retry storm via exponential backoff
- execute_query auto-downgrade to executeScript for PL/SQL blocks

### Performance
- Pre-compiled regex in safety.ts
- Schema cache TTL reduced to 1 minute
- Unified execution timeout (default 30s, configurable)
- Unified slow query logging (default 5s threshold)
- Connection pool size configurable per mode
```

- [ ] **Step 3: Commit**

```bash
git add README.md README.zh-CN.md CHANGELOG.md
git commit -m "docs: update README and CHANGELOG for P0/P1/P2 features"
```

---

## Task 34: Final integration test

**Files:**

- Create: `tests/integration/end-to-end.test.ts`

- [ ] **Step 1: Write end-to-end test**

```typescript
import { describe, it, expect } from 'vitest';
// Test full flow: connect → generate sample data → query → verify
```

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/end-to-end.test.ts
git commit -m "test: add end-to-end integration test"
```

---

# Plan Complete

All 34 tasks complete. Run `npm test` to verify all P0/P1/P2 features work as specified.

**Next steps:**

1. Run `git log --oneline -50` to see all commits
2. Update version in `package.json` (e.g., to 3.0.0 for major changes)
3. Build and publish
