/**
 * BaseAdapter
 * Abstract base class providing default implementations for executeScript and executeBatch.
 * Specific adapters override when they have native batch APIs (MySQL, Oracle, SQLite).
 *
 * The default strategy is: client-side split + sequential execution within a transaction.
 * This works for all drivers but isn't the most performant — adapters with native
 * multi-statement or batch APIs should override.
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