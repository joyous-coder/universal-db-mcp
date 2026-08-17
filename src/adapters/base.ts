/**
 * BaseAdapter
 * Abstract base class providing default implementations for executeScript and executeBatch.
 * Specific adapters override when they have native batch APIs (MySQL, Oracle, SQLite).
 *
 * The default strategy is: client-side split + sequential execution within a transaction.
 * This works for all drivers but isn't the most performant — adapters with native
 * multi-statement or batch APIs should override.
 *
 * ============================================================================
 * 重要 —— 关于 executeScript / executeBatch 的事务语义 (pooled adapters)
 * ============================================================================
 * 默认实现把脚本拆分成单条语句,然后通过 `BEGIN`, 语句1, 语句2, ..., `COMMIT`
 * 这样的多次 `executeQuery` 调用执行。对于使用连接池的适配器(mysql2, pg, mssql,
 * oracledb 等),**每次 `executeQuery` 调用都可能从池中拿到不同的连接**。
 *
 * 这意味着默认实现中:
 *   1. BEGIN 在连接 A 上发起;
 *   2. 第一条语句在连接 B 上执行 —— 注意: **可能不在事务中**;
 *   3. COMMIT 在连接 C 上 —— 提交一个空事务。
 *
 * 因此默认实现**不保证 "all-or-nothing"**: 部分语句可能落在事务外。
 * 若需要真正的事务保证(对 pool-backed 驱动),具体的适配器(mysql.ts, pg.ts,
 * mssql.ts, oracle.ts 等)**必须重写 executeScript**,从池中借一个连接并把
 * 所有语句都在该连接上执行。
 *
 * 推荐的做法是实现 `withTransaction(fn)` 抽象方法 — 接受一个
 * TransactionContext(只暴露 `executeQuery` 接口),把 callback 内的语句钉在
 * 同一个连接上,然后统一提交 / 回滚。
 *
 * 当前 PR 添加了 `withTransaction` 的抽象方法和默认实现(抛 "not supported"),
 * 这样后续可以逐步迁移 adapter 而不会破坏类型签名。
 * ============================================================================
 */

import type { DbAdapter, QueryResult } from '../types/adapter.js';
import { splitStatements } from '../utils/sql-parser.js';

/**
 * Forbidden patterns in scripts (per spec P0-5):
 * - DROP DATABASE / DROP SCHEMA
 * - SHUTDOWN
 * - TRUNCATE without WHERE
 *
 * Note: DROP TABLE / DELETE / UPDATE / CREATE are NOT blanket-forbidden here -
 * per-statement permission checks in DatabaseService.executeScript handle those
 * via the permission system (script permission alone is not enough).
 */
const FORBIDDEN_PATTERNS: RegExp[] = [
  /DROP\s+DATABASE\b/i,
  /DROP\s+SCHEMA\b/i,
  /\bSHUTDOWN\b/i,
  /TRUNCATE\s+(?!.*\bWHERE\b)/i,
];

function checkForbiddenPatterns(script: string): void {
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(script)) {
      throw new Error(`Forbidden pattern detected in script: ${pattern.source}`);
    }
  }
}

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

/**
 * TransactionContext
 *
 * 通过 `withTransaction(fn)` 暴露给 callback 的执行上下文。
 * `executeQuery` 一定运行在同一个连接上 — 这是 "all-or-nothing" 事务保证的核心。
 *
 * 适配器通过实现 `withTransaction` 来提供这个保证。对于没有实现此方法的适配器,
 * 调用应当被拒绝(见 BaseAdapter.withTransaction 的默认实现)。
 */
export interface TransactionContext {
  /**
   * 在当前事务的同一个连接上执行一条 SQL。
   * @param query SQL 语句
   * @param params 可选参数化绑定
   */
  executeQuery(query: string, params?: unknown[]): Promise<QueryResult>;
}

export abstract class BaseAdapter implements DbAdapter {
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract executeQuery(query: string, params?: unknown[]): Promise<QueryResult>;
  abstract getSchema(): Promise<import('../types/adapter.js').SchemaInfo>;
  abstract isWriteOperation(query: string): boolean;

  /**
   * Override in adapters to identify their dialect for sql-parser.
   */
  protected abstract getDialect(): import('../utils/adapter-factory.js').DbType;

  /**
   * 把一段逻辑放在"事务上下文"中运行。
   *
   * 实现要求:
   *   - callback 内的所有 `tx.executeQuery` 必须运行在同一个物理连接上;
   *   - 若 callback 成功,实现应当在退出前提交事务;
   *   - 若 callback 抛出异常,实现应当回滚事务后再抛出。
   *
   * 默认实现: 抛 "not supported"。Pool-backed 适配器(mysql2 / pg / mssql /
   * oracledb 等)**必须重写此方法**,否则 executeScript / executeBatch 不能
   * 提供真正的事务保证(详见上方注释)。
   *
   * 对单连接的适配器(SQLite)如果没有重写,调用者会拿到此错误 ——
   * SQLite 不需要事务上下文(它是单连接的),所以 DatabaseService 的默认
   * executeScript 路径应该优先被使用。
   */
  async withTransaction<T>(_fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    throw new Error(
      'withTransaction is not supported by this adapter. Pool-backed adapters ' +
      '(mysql / postgres / sqlserver / oracle / etc.) must override withTransaction ' +
      'to provide true "all-or-nothing" transaction semantics. See BaseAdapter ' +
      'doc comment for details.'
    );
  }

  /**
   * Default executeScript: client-side split + sequential execution.
   *
   * 限制: 见 BaseAdapter 顶部的"关于事务语义"注释。对 pool-backed 适配器,
   * 应当重写此方法以调用 withTransaction(...) 来获得真正的事务保证。
   *
   * Override in adapters with native multi-statement support.
   */
  async executeScript(query: string, options: ExecuteScriptOptions = {}): Promise<QueryResult> {
    const maxStatements = options.maxStatements ?? 1000;
    const useTransaction = options.useTransaction ?? true;

    // Reject forbidden patterns before executing anything
    checkForbiddenPatterns(query);

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
      // Wrap in BEGIN/COMMIT for transaction safety.
      // P1-NOTE: 对 pool-backed 适配器这是 best-effort — 各 executeQuery
      // 调用可能落在不同的物理连接上。重写 executeScript 配合 withTransaction 可修复。
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
   * Override in adapters with native batch APIs (MySQL, Oracle, SQLite).
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
        const result = await this.executeQuery(sql, params);
        // v4.0 G8 / Bug #1 fix: NO silent failure. Any error here throws so the
        // caller knows the row did NOT insert. We previously swallowed errors
        // into -1 which masked data loss (e.g. DM pool.execute failing on 3+ params).
        affectedRowsPerStatement.push(result.affectedRows ?? 0);
      }
    }

    return {
      affectedRowsPerStatement,
      totalAffectedRows: affectedRowsPerStatement.reduce((a, b) => a + Math.max(b, 0), 0),
      executionTime: Date.now() - startTime,
    };
  }
}