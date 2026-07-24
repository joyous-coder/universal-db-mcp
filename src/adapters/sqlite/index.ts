/**
 * SQLite 数据库适配器
 *
 * 多后端支持:
 * 1. node:sqlite — Node 22.5+ 内置(零依赖、最快)
 * 2. better-sqlite3 — 兜底(需要 native binding,但更成熟)
 *
 * 通过 detectSqliteBackend() 运行时自动选择。
 */

import { BaseAdapter } from '../base.js';
import type {
  QueryResult,
  SchemaInfo,
  TableInfo,
  ColumnInfo,
  IndexInfo,
  ForeignKeyInfo,
  RelationshipInfo,
} from '../../types/adapter.js';
import { isWriteOperation as checkWriteOperation } from '../../utils/safety.js';
import { validateIdentifier } from '../../utils/identifier-validator.js';
import {
  detectSqliteBackend,
  type SQLiteConnection,
  type SQLiteBackend,
} from './types.js';

export class SQLiteAdapter extends BaseAdapter {
  private conn: SQLiteConnection | null = null;
  private backend: SQLiteBackend | null = null;
  private config: {
    filePath: string;
    readonly?: boolean;
  };

  constructor(config: {
    filePath: string;
    readonly?: boolean;
  }) {
    super();
    this.config = config;
  }

  /**
   * 连接到 SQLite 数据库
   */
  async connect(): Promise<void> {
    try {
      this.backend = await detectSqliteBackend();
      this.conn = await this.backend.open(this.config.filePath, {
        readonly: this.config.readonly,
      });
      // 启用外键约束
      this.conn.pragma('foreign_keys', 'ON');
    } catch (error) {
      throw new Error(
        `SQLite 连接失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 断开数据库连接
   */
  async disconnect(): Promise<void> {
    if (this.conn) {
      try {
        this.conn.close();
      } catch {
        // 忽略关闭连接时的错误
      }
      this.conn = null;
    }
  }

  /**
   * 执行 SQL 查询
   */
  async executeQuery(query: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.conn) {
      throw new Error('数据库未连接');
    }

    const startTime = Date.now();

    try {
      // 判断是否为查询操作
      const trimmedQuery = query.trim().toUpperCase();
      if (trimmedQuery.startsWith('SELECT') || trimmedQuery.startsWith('PRAGMA') || trimmedQuery.startsWith('EXPLAIN')) {
        // SELECT 查询
        const stmt = this.conn.prepare(query);
        const rows = params ? stmt.all(...params) : stmt.all();
        const executionTime = Date.now() - startTime;
        return {
          rows: rows as Record<string, unknown>[],
          executionTime,
          metadata: { rowCount: rows.length },
        };
      } else {
        // INSERT/UPDATE/DELETE 等操作
        const stmt = this.conn.prepare(query);
        const info = params ? stmt.run(...params) : stmt.run();
        const executionTime = Date.now() - startTime;
        return {
          rows: [],
          affectedRows: info.changes,
          executionTime,
          metadata: { lastInsertRowid: Number(info.lastInsertRowid) },
        };
      }
    } catch (error) {
      throw new Error(
        `查询执行失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 获取数据库结构信息
   */
  async getSchema(): Promise<SchemaInfo> {
    if (!this.conn) {
      throw new Error('数据库未连接');
    }

    try {
      // 获取 SQLite 版本
      const versionRow = this.conn.prepare('SELECT sqlite_version() as version').get() as { version: string };
      const version = versionRow.version;

      // 获取数据库文件名作为数据库名
      const databaseName = this.config.filePath.split(/[\\/]/).pop() || 'unknown';

      // 获取所有表（排除 sqlite 内部表）
      const tables = this.conn
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type='table' AND name NOT LIKE 'sqlite_%'
           ORDER BY name`
        )
        .all() as { name: string }[];

      const tableInfos: TableInfo[] = [];
      const relationships: RelationshipInfo[] = [];

      for (const table of tables) {
        const { tableInfo, tableForeignKeys } = await this.getTableInfo(table.name);
        tableInfos.push(tableInfo);

        for (const fk of tableForeignKeys) {
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
        databaseName,
        tables: tableInfos,
        version,
        relationships: relationships.length > 0 ? relationships : undefined,
      };
    } catch (error) {
      throw new Error(
        `获取数据库结构失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 清除 Schema 缓存（no-op,保留仅为向后兼容）
   */
  clearSchemaCache(): void {
    // no-op
  }

  /**
   * 获取单个表的详细信息
   */
  private async getTableInfo(tableName: string): Promise<{ tableInfo: TableInfo; tableForeignKeys: ForeignKeyInfo[] }> {
    if (!this.conn) {
      throw new Error('数据库未连接');
    }

    validateIdentifier(tableName);

    // 获取列信息
    const columns = this.conn
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as Array<{
        cid: number;
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
      }>;

    const columnInfos: ColumnInfo[] = columns.map((col) => ({
      name: col.name,
      type: col.type,
      nullable: col.notnull === 0,
      defaultValue: col.dflt_value || undefined,
    }));

    // 获取主键
    const primaryKeys = columns
      .filter((col) => col.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((col) => col.name);

    // 获取索引
    const indexes = this.conn
      .prepare(`PRAGMA index_list(${tableName})`)
      .all() as Array<{
        seq: number;
        name: string;
        unique: number;
        origin: string;
        partial: number;
      }>;

    const indexInfos: IndexInfo[] = [];
    for (const idx of indexes) {
      if (idx.origin === 'pk') continue;
      const indexColumns = this.conn
        .prepare(`PRAGMA index_info(${idx.name})`)
        .all() as Array<{
          seqno: number;
          cid: number;
          name: string;
        }>;
      indexInfos.push({
        name: idx.name,
        columns: indexColumns.map((col) => col.name),
        unique: idx.unique === 1,
      });
    }

    // 获取外键
    const foreignKeys = this.conn
      .prepare(`PRAGMA foreign_key_list(${tableName})`)
      .all() as Array<{
        id: number;
        seq: number;
        table: string;
        from: string;
        to: string;
        on_update: string;
        on_delete: string;
        match: string;
      }>;

    const fkMap = new Map<number, { columns: string[]; referencedTable: string; referencedColumns: string[]; onDelete?: string; onUpdate?: string }>();
    for (const fk of foreignKeys) {
      if (!fkMap.has(fk.id)) {
        fkMap.set(fk.id, {
          columns: [],
          referencedTable: fk.table,
          referencedColumns: [],
          onDelete: fk.on_delete !== 'NO ACTION' ? fk.on_delete : undefined,
          onUpdate: fk.on_update !== 'NO ACTION' ? fk.on_update : undefined,
        });
      }
      const fkInfo = fkMap.get(fk.id)!;
      fkInfo.columns.push(fk.from);
      fkInfo.referencedColumns.push(fk.to);
    }

    const foreignKeyInfos: ForeignKeyInfo[] = [];
    for (const [id, fkData] of fkMap.entries()) {
      foreignKeyInfos.push({
        name: `fk_${tableName}_${id}`,
        columns: fkData.columns,
        referencedTable: fkData.referencedTable,
        referencedColumns: fkData.referencedColumns,
        onDelete: fkData.onDelete,
        onUpdate: fkData.onUpdate,
      });
    }

    // 获取行数
    const countRow = this.conn
      .prepare(`SELECT COUNT(*) as count FROM ${tableName}`)
      .get() as { count: number };
    const estimatedRows = countRow.count;

    return {
      tableInfo: {
        name: tableName,
        columns: columnInfos,
        primaryKeys,
        indexes: indexInfos,
        foreignKeys: foreignKeyInfos.length > 0 ? foreignKeyInfos : undefined,
        estimatedRows,
      },
      tableForeignKeys: foreignKeyInfos,
    };
  }

  /**
   * 检查是否为写操作
   */
  isWriteOperation(query: string): boolean {
    return checkWriteOperation(query);
  }

  protected getDialect(): import('../../utils/adapter-factory.js').DbType {
    return 'sqlite';
  }
}