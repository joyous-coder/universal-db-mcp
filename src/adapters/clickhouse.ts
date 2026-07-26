/**
 * ClickHouse 数据库适配器
 * 使用 @clickhouse/client 驱动实现 DbAdapter 接口
 * ClickHouse 是高性能列式 OLAP 数据库
 */

import { createClient, ClickHouseClient } from '@clickhouse/client';
import { BaseAdapter } from './base.js';
import type {
  QueryResult,
  SchemaInfo,
  TableInfo,
  ColumnInfo,
  IndexInfo,
} from '../types/adapter.js';
import { isWriteOperation as checkWriteOperation } from '../utils/safety.js';
import { withRetry } from '../utils/retry.js';

export class ClickHouseAdapter extends BaseAdapter {
  private client: ClickHouseClient | null = null;
  private config: {
    host: string;
    port: number;
    user?: string;
    password?: string;
    database?: string;
  };

  constructor(config: {
    host: string;
    port: number;
    user?: string;
    password?: string;
    database?: string;
  }) {
    super();
    this.config = config;
  }

  /**
   * 连接到 ClickHouse 数据库
   */
  async connect(): Promise<void> {
    try {
      this.client = createClient({
        host: `http://${this.config.host}:${this.config.port}`,
        username: this.config.user || 'default',
        password: this.config.password,
        database: this.config.database || 'default',
      });

      // 测试连接
      await this.client.ping();
    } catch (error) {
      throw new Error(
        `ClickHouse 连接失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 断开数据库连接
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch {
        // 忽略关闭连接时的错误（连接可能已断开）
      }
      this.client = null;
    }
  }

  /**
   * 执行 SQL 查询
   */
  async executeQuery(query: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.client) {
      throw new Error('数据库未连接');
    }

    const startTime = Date.now();
    const isWrite = this.isWriteOperation(query);
    // v3.2.9 Bug #50 fix: 写操作(INSERT/UPDATE/DELETE/DDL)用 client.command(),
    // 它不会在 SQL 末尾 append `FORMAT <fmt>`,且返回 summary.written_rows。
    // 之前强制 format:'JSONEachRow' 让 driver 拼 `FORMAT JSONEachRow` 到 SQL 末尾
    // → INSERT ... VALUES(...) 后跟 `FORMAT` 报 "expected '(' before FORMAT JSONEachRow"。
    const trimmed = query.trim().replace(/;\s*$/, '');
    // v3.2.9 Bug #51+#54 fix: CH client 只支持 named params。数组/对象参数都需要
    // rewrite。`params && params.length` 对单对象 falsy(对象无 length 属性),
    // 所以用通用 truthy 判断。
    const hasParams = params !== undefined && params !== null
      && (!(params instanceof Array) || (params as unknown[]).length > 0);
    const { query: finalQuery, query_params: queryParams } = hasParams
      ? this.rewriteNamedPlaceholders(trimmed, params)
      : { query: trimmed, query_params: undefined };
    // node @clickhouse/client v1 的 .d.ts 没列 command,但运行时继承自 BaseClickHouseClient。
    const client = this.client as unknown as {
      query: (p: Record<string, unknown>) => Promise<{
        query_id: string;
        response_headers?: Record<string, string | string[]>;
        json: <T>() => Promise<T>;
      }>;
      command: (p: Record<string, unknown>) => Promise<{
        query_id: string;
        summary?: { written_rows?: string | number; read_rows?: string | number };
        response_headers?: Record<string, string | string[]>;
      }>;
    };
    try {
      if (isWrite) {
        const result = await withRetry(() => client.command({
          query: finalQuery,
          query_params: queryParams,
        }));
        let affected: number | undefined;
        if (result.summary?.written_rows !== undefined) {
          const w = typeof result.summary.written_rows === 'string'
            ? parseInt(result.summary.written_rows, 10)
            : result.summary.written_rows;
          if (!isNaN(w) && w > 0) affected = w;
        }
        return {
          rows: [],
          affectedRows: affected,
          executionTime: Date.now() - startTime,
          metadata: { query_id: result.query_id },
        };
      }
      const result = await withRetry(() => client.query({
        query: finalQuery,
        query_params: queryParams,
        format: 'JSONEachRow',
      }));
      const data = await result.json();
      const rows = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
      // v3.2.9 Bug #52 fix: CH JSONEachRow 默认 UInt64/Int128 输出为字符串避免
      // JS Number 精度丢失,但 count()/sum() 等聚合结果用户期望数字。启发式:
      // 纯数字字符串 → Number;非数字保持原样(可能是 Date/UUID 等)。
      for (const row of rows) {
        for (const k of Object.keys(row)) {
          const v = row[k];
          if (typeof v === 'string' && /^-?\d+$/.test(v)) {
            const n = Number(v);
            if (Number.isSafeInteger(n)) row[k] = n;
          }
        }
      }
      return {
        rows,
        affectedRows: undefined,
        executionTime: Date.now() - startTime,
        metadata: { query_id: result.query_id },
      };
    } catch (error) {
      throw new Error(
        `查询执行失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 转换参数为 ClickHouse 格式
   *
   * v3.2.9 Bug #51 fix: ClickHouse client 只支持命名参数 ({name:Type}) + 对象
   * query_params,不支持位置参数数组 + `?`。如果传入数组,我们生成
   * {param1, param2, ...} 并把 query 中按出现顺序的 `{<name>:<type>}` 改写
   * 为 `{paramN:<type>}` —— 用户用任意命名都能工作。
   *
   * v3.2.9 Bug #54 fix: 如果 params[0] 是对象(整个数组是对象数组,如 executeBatch),
   * 直接把对象当 query_params 用 —— 用户传 {id: 1, name: 'a'} → query_params {id: 1, name: 'a'}。
   */
  private rewriteNamedPlaceholders(query: string, params: unknown): { query: string; query_params: Record<string, unknown> } {
    const query_params: Record<string, unknown> = {};
    if (params === undefined || params === null) return { query, query_params };
    // Bug #54 fix: 对象数组 (executeBatch) 或单对象 — 直接当 query_params 用
    if (typeof params === 'object' && !Array.isArray(params)) {
      const obj = params as Record<string, unknown>;
      const rewritten = query.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*([a-zA-Z0-9_]+(\([^)]*\))?)\}/g, (match, name, type) => {
        if (Object.prototype.hasOwnProperty.call(obj, name)) {
          query_params[name] = obj[name];
          return `{${name}:${type}}`;
        }
        return match;
      });
      return { query: rewritten, query_params };
    }
    // 位置数组 → 改写 {name:Type} → {paramN:Type}
    const arr = params as unknown[];
    if (arr.length === 0) return { query, query_params };
    let n = 0;
    const rewritten = query.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*([a-zA-Z0-9_]+(\([^)]*\))?)\}/g, (_match, _name, type) => {
      n += 1;
      const key = `param${n}`;
      query_params[key] = arr[n - 1];
      return `{${key}:${type}}`;
    });
    for (let i = n; i < arr.length; i++) {
      query_params[`param${i + 1}`] = arr[i];
    }
    return { query: rewritten, query_params };
  }

  /**
   * 获取数据库结构信息
   */
  async getSchema(): Promise<SchemaInfo> {
    if (!this.client) {
      throw new Error('数据库未连接');
    }

    try {
      // 获取数据库版本
      const versionResult = await this.client.query({
        query: 'SELECT version() as version',
        format: 'JSONEachRow',
      });
      const versionData = await versionResult.json() as Array<{ version: string }>;
      const version = (Array.isArray(versionData) && versionData.length > 0) ? versionData[0]?.version : 'unknown';

      // 获取当前数据库名
      const databaseName = this.config.database || 'default';

      // 获取所有表
      const tablesResult = await this.client.query({
        query: `
          SELECT name
          FROM system.tables
          WHERE database = {database:String}
            AND engine NOT IN ('View', 'MaterializedView')
          ORDER BY name
        `,
        query_params: {
          database: databaseName,
        },
        format: 'JSONEachRow',
      });

      const tablesData = await tablesResult.json() as Array<{ name: string }>;
      const tables = Array.isArray(tablesData) ? tablesData : [];
      const tableInfos: TableInfo[] = [];

      for (const table of tables) {
        const tableInfo = await this.getTableInfo(table?.name);
        tableInfos.push(tableInfo);
      }

      return {
        databaseType: 'clickhouse',
        databaseName,
        tables: tableInfos,
        version,
      };
    } catch (error) {
      throw new Error(
        `获取数据库结构失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 获取单个表的详细信息
   */
  private async getTableInfo(tableName: string): Promise<TableInfo> {
    if (!this.client) {
      throw new Error('数据库未连接');
    }

    const databaseName = this.config.database || 'default';

    // 获取列信息
    const columnsResult = await this.client.query({
      query: `
        SELECT
          name,
          type,
          default_kind,
          default_expression,
          comment
        FROM system.columns
        WHERE database = {database:String}
          AND table = {table:String}
        ORDER BY position
      `,
      query_params: {
        database: databaseName,
        table: tableName,
      },
      format: 'JSONEachRow',
    });

    const columnsData = await columnsResult.json() as Array<{
      name: string;
      type: string;
      default_kind: string;
      default_expression: string;
      comment: string;
    }>;
    const columns = Array.isArray(columnsData) ? columnsData : [];

    const columnInfos: ColumnInfo[] = columns.map((col) => ({
      name: col?.name,
      type: col?.type,
      nullable: col?.type?.includes('Nullable') || false,
      defaultValue: col?.default_expression || undefined,
      comment: col?.comment || undefined,
    }));

    // 获取主键信息
    const primaryKeyResult = await this.client.query({
      query: `
        SELECT primary_key
        FROM system.tables
        WHERE database = {database:String}
          AND name = {table:String}
      `,
      query_params: {
        database: databaseName,
        table: tableName,
      },
      format: 'JSONEachRow',
    });

    const pkData = await primaryKeyResult.json() as Array<{ primary_key: string }>;
    const primaryKeyStr = (Array.isArray(pkData) && pkData.length > 0) ? pkData[0]?.primary_key : '';
    const primaryKeys = primaryKeyStr
      ? primaryKeyStr.split(',').map((k: string) => k.trim())
      : [];

    // 获取索引信息（ClickHouse 的索引称为 data skipping indexes）
    const indexesResult = await this.client.query({
      query: `
        SELECT
          name,
          expr,
          type
        FROM system.data_skipping_indices
        WHERE database = {database:String}
          AND table = {table:String}
      `,
      query_params: {
        database: databaseName,
        table: tableName,
      },
      format: 'JSONEachRow',
    });

    const indexesData = await indexesResult.json() as Array<{
      name: string;
      expr: string;
      type: string;
    }>;
    const indexes = Array.isArray(indexesData) ? indexesData : [];

    const indexInfos: IndexInfo[] = indexes.map((idx) => ({
      name: idx?.name,
      columns: [idx?.expr], // ClickHouse 索引表达式
      unique: false, // ClickHouse 索引不保证唯一性
    }));

    // 获取表行数估算和表注释
    const countResult = await this.client.query({
      query: `
        SELECT total_rows, comment
        FROM system.tables
        WHERE database = {database:String}
          AND name = {table:String}
      `,
      query_params: {
        database: databaseName,
        table: tableName,
      },
      format: 'JSONEachRow',
    });

    const countData = await countResult.json() as Array<{ total_rows: string; comment: string }>;
    const estimatedRows = (Array.isArray(countData) && countData.length > 0)
      ? parseInt(countData[0]?.total_rows || '0', 10)
      : 0;
    const tableComment = (Array.isArray(countData) && countData.length > 0)
      ? countData[0]?.comment || undefined
      : undefined;

    return {
      name: tableName,
      comment: tableComment,
      columns: columnInfos,
      primaryKeys,
      indexes: indexInfos,
      estimatedRows,
    };
  }

  /**
   * 检查是否为写操作
   */
  isWriteOperation(query: string): boolean {
    return checkWriteOperation(query);
  }
  protected getDialect(): import('../utils/adapter-factory.js').DbType {
    return 'clickhouse';
  }

  /**
   * v3.2.9 Bug #53 fix: ClickHouse driver 不支持 BEGIN/COMMIT 事务语法。
   * BaseAdapter 默认实现用 BEGIN/COMMIT 包 execute_script/batch → 报 "Expected TRANSACTION"。
   * 强制 useTransaction:false 走逐句 autoCommit 路径,放弃原子性保证(CH 反正没有跨语句事务)。
   */
  async executeScript(query: string, options: { useTransaction?: boolean; maxStatements?: number } = {}): Promise<QueryResult> {
    return super.executeScript(query, { ...options, useTransaction: false });
  }
  async executeBatch(sql: string, paramsList: unknown[][], options: { useTransaction?: boolean; maxBatchSize?: number } = {}): Promise<import('./base.js').BatchResult> {
    return super.executeBatch(sql, paramsList, { ...options, useTransaction: false });
  }

}
