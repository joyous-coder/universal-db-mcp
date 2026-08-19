/**
 * Oracle 数据库适配器
 * 使用 oracledb 驱动实现 DbAdapter 接口
 *
 * 性能优化：使用批量查询获取 Schema 信息，避免 N+1 查询问题
 * 连接管理：使用连接池 + 连接健康检测 + 断线自动重试，确保长连接稳定性
 */

import oracledb from 'oracledb';
import { BaseAdapter, ExecuteScriptOptions, ExecuteBatchOptions, TransactionContext, BatchResult } from './base.js';
import type {
  QueryResult,
  SchemaInfo,
  TableInfo,
  ColumnInfo,
  IndexInfo,
  ForeignKeyInfo,
  RelationshipInfo,
} from '../types/adapter.js';
import { isWriteOperation as checkWriteOperation } from '../utils/safety.js';
import { withRetry, isConnectionErrorMessage } from '../utils/retry.js';
import { splitStatements } from '../utils/sql-parser.js';

/**
 * v4.0.2 Bug #12 fix: oracledb uses named bind placeholders (:1, :2, :3) rather
 * than anonymous "?". To accept the same SQL syntax as DM/MySQL/Postgres
 * adapters (e.g. `INSERT INTO t VALUES (?, ?, ?)`), convert ? to :N in the
 * SQL string before passing to oracledb.execute(). Skips placeholders inside
 * single-quoted string literals (e.g. `WHERE name = 'what?'`).
 */
function convertQuestionMarks(sql: string): string {
  let out = '';
  let inString = false;
  let stringChar = '';
  let bindIdx = 0;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const prev = i > 0 ? sql[i - 1] : '';
    if (inString) {
      out += ch;
      if (ch === stringChar && prev !== '\\') inString = false;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inString = true;
      stringChar = ch;
      out += ch;
      continue;
    }
    if (ch === '?') {
      bindIdx++;
      out += `:${bindIdx}`;
      continue;
    }
    out += ch;
  }
  return out;
}

export class OracleAdapter extends BaseAdapter {
  private pool: oracledb.Pool | null = null;
  private config: {
    host: string;
    port: number;
    user?: string;
    password?: string;
    database?: string;
    serviceName?: string;
    sid?: string;
    connectString?: string;
    oracleClientPath?: string;
    poolConfig?: { max?: number; min?: number; idleTimeoutMs?: number };
  };
  private static thickModeInitialized = false;

  constructor(config: {
    host: string;
    port: number;
    user?: string;
    password?: string;
    database?: string;
    serviceName?: string;
    sid?: string;
    connectString?: string;
    oracleClientPath?: string;
    poolConfig?: { max?: number; min?: number; idleTimeoutMs?: number };
  }) {
    super();
    this.config = config;

    // 如果提供了 Oracle Client 路径，启用 Thick 模式（支持 11g）
    if (config.oracleClientPath && !OracleAdapter.thickModeInitialized) {
      try {
        oracledb.initOracleClient({ libDir: config.oracleClientPath });
        OracleAdapter.thickModeInitialized = true;
        console.error(`🔧 Oracle Thick 模式已启用，Client 路径: ${config.oracleClientPath}`);
      } catch (error: any) {
        // 如果已经初始化过，忽略错误
        if (error.message && error.message.includes('already initialized')) {
          OracleAdapter.thickModeInitialized = true;
        } else {
          throw new Error(`Oracle Client 初始化失败: ${error.message || String(error)}`);
        }
      }
    }

    // 配置 oracledb 全局设置
    oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
    oracledb.fetchAsString = [oracledb.CLOB];
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    return withRetry(fn, {
      isRetryable: (err) => {
        const e = err as { message?: string; errorNum?: number };
        const msg = e?.message || '';
        if (isConnectionErrorMessage(msg)) return true;
        // Oracle-specific connection errors
        if (/NJS-003|NJS-500|NJS-521|DPI-1010|DPI-1080/.test(msg)) return true;
        if ([3113, 3114, 3135, 12170, 12571, 28547].includes(e?.errorNum || 0)) return true;
        return false;
      }
    });
  }

  private async withConnection<T>(fn: (conn: oracledb.Connection) => Promise<T>): Promise<T> {
    const connection = await this.pool!.getConnection();
    try { return await fn(connection); } finally { await connection.close(); }
  }

  /**
   * 构建 Oracle 连接字符串
   */
  private buildConnectionString(): string {
    // 优先级: connectString > serviceName > sid > database
    if (this.config.connectString) {
      return this.config.connectString;
    }

    const host = this.config.host;
    const port = this.config.port || 1521;
    const service = this.config.serviceName || this.config.sid || this.config.database;

    if (!service) {
      throw new Error('必须提供 database、serviceName 或 sid');
    }

    // 构建 Easy Connect 字符串
    return `${host}:${port}/${service}`;
  }

  /**
   * 连接到 Oracle 数据库
   */
  async connect(): Promise<void> {
    try {
      const connectionString = this.buildConnectionString();
      // P1: poolConfig (DB_POOL_SIZE / DB_POOL_MIN / DB_POOL_IDLE_TIMEOUT_MS)，
      // poolTimeout 在 oracledb 中单位为秒，需要从毫秒转换
      const poolMax = this.config.poolConfig?.max ?? 3;
      const poolMin = this.config.poolConfig?.min ?? 1;
      const poolTimeoutSec = Math.max(
        1,
        Math.round((this.config.poolConfig?.idleTimeoutMs ?? 60000) / 1000)
      );

      this.pool = await oracledb.createPool({
        user: this.config.user,
        password: this.config.password,
        connectString: connectionString,
        poolMin: poolMin,
        poolMax: poolMax,
        poolTimeout: poolTimeoutSec,
        poolPingInterval: 30,
      });
      // 测试连接
      const connection = await this.pool.getConnection();
      try { await connection.execute('SELECT 1 FROM DUAL'); } finally { await connection.close(); }
    } catch (error: any) {
      if (error.errorNum === 1017) throw new Error('Oracle 连接失败: 用户名或密码无效');
      else if (error.errorNum === 12154) throw new Error('Oracle 连接失败: 无法解析连接标识符，请检查 TNS 配置');
      else if (error.errorNum === 12541) throw new Error('Oracle 连接失败: TNS 无监听程序');
      throw new Error(`Oracle 连接失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 断开数据库连接
   */
  async disconnect(): Promise<void> {
    if (this.pool) {
      try { await this.pool.close(0); } catch {}
      this.pool = null;
    }
  }

  /**
   * 执行 SQL 查询
   */
  async executeQuery(query: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.pool) throw new Error('数据库未连接');
    const startTime = Date.now();
    try {
      return await this.withRetry(() => this.withConnection(async (connection) => {
        let cleanQuery = query.trim();
        // v5.0.0: PL/SQL 块(`BEGIN...END;` 或 `DECLARE...BEGIN...END;`)必须以 `;` 结尾
        // — oracledb 严格要求 trailing `;`。只对非 PL/SQL 语句剥 `;`。
        const looksLikePlsqlBlock = /^\s*(BEGIN|DECLARE)\b/i.test(cleanQuery) && /\bEND\s*;?\s*$/i.test(cleanQuery);
        if (!looksLikePlsqlBlock && cleanQuery.endsWith(';')) {
          cleanQuery = cleanQuery.slice(0, -1).trim();
        }
        // v4.0.2 Bug #12: convert ? to :1, :2, ... for oracledb named binds.
        const oracledbSql = convertQuestionMarks(cleanQuery);
        const result = await connection.execute(oracledbSql, params || [], { autoCommit: true, outFormat: oracledb.OUT_FORMAT_OBJECT });
        const executionTime = Date.now() - startTime;
        if (result.rows && result.rows.length > 0) {
          // v5.0.0: 去掉 k.toLowerCase() — 现在 row keys 按 DB 原 case 返回(Oracle 默认 uppercase)。
          // 之前 lowercase 是为了和 MySQL/Postgres 等保持一致,但破坏了 CSV writer 等需要
          // 大小写敏感查找的工具。统一行为由 consumer 层(csv-writer / csv-reader)做
          // case-insensitive lookup 来兼容所有 DB。
          return { rows: result.rows as Array<Record<string, unknown>>, executionTime, metadata: { columnCount: result.metaData?.length || 0 } };
        } else if (result.rowsAffected !== undefined && result.rowsAffected > 0) {
          return { rows: [], affectedRows: result.rowsAffected, executionTime };
        } else {
          return { rows: [], executionTime };
        }
      }));
    } catch (error: any) {
      if (error.errorNum === 942) throw new Error('查询执行失败: 表或视图不存在');
      else if (error.errorNum === 1) throw new Error('查询执行失败: 违反唯一约束');
      throw new Error(`查询执行失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * v4.0.3: Fast-path single-table metadata query. Avoids scanning the
   * entire schema (8 dict queries on getSchema) when caller only wants
   * one table. Issues 5 targeted queries against data dictionary filtered
   * by TABLE_NAME / OWNER.
   */
  async getTableInfo(tableName: string): Promise<TableInfo | null> {
    if (!this.pool) {
      throw new Error('数据库未连接');
    }
    let owner = '';
    let bareName = tableName;
    if (tableName.includes('.')) {
      const dot = tableName.indexOf('.');
      owner = tableName.substring(0, dot).toUpperCase();
      bareName = tableName.substring(dot + 1).toUpperCase();
    } else {
      bareName = tableName.toUpperCase();
    }
    if (!owner) {
      // Default to current user schema
      const u = await this.withConnection(async (conn) => {
        const r = await conn.execute('SELECT USER FROM DUAL');
        return Object.values(r.rows?.[0] ?? {})[0] as string;
      });
      owner = u.toUpperCase();
    }
    return this.withConnection(async (conn) => {
      const colRes = await conn.execute(
        `SELECT OWNER, TABLE_NAME, COLUMN_NAME, DATA_TYPE, DATA_LENGTH, DATA_PRECISION,
                DATA_SCALE, NULLABLE, DATA_DEFAULT, COLUMN_ID
         FROM ALL_TAB_COLUMNS
         WHERE OWNER = :1 AND TABLE_NAME = :2
         ORDER BY COLUMN_ID`,
        [owner, bareName]
      );
      if (!colRes.rows || colRes.rows.length === 0) return null;
      const cmRes = await conn.execute(
        `SELECT COLUMN_NAME, COMMENTS FROM ALL_COL_COMMENTS
         WHERE OWNER = :1 AND TABLE_NAME = :2 AND COMMENTS IS NOT NULL`,
        [owner, bareName]
      );
      // v4.0.3.2 Bug #17: 查 ALL_TAB_IDENTITY_COLS (Oracle 12c+) 标记 IDENTITY 列
      let identityCols = new Set<string>();
      try {
        const idRes = await conn.execute(
          `SELECT COLUMN_NAME FROM ALL_TAB_IDENTITY_COLS WHERE OWNER = :1 AND TABLE_NAME = :2`,
          [owner, bareName]
        );
        for (const r of idRes.rows ?? []) {
          identityCols.add(String((r as Record<string, unknown>)['COLUMN_NAME'] ?? '').toLowerCase());
        }
      } catch {
        // 视图不可用/老版本 — fallback 到 generator 的 PK+type 启发式
      }
      const pkRes = await conn.execute(
        `SELECT cols.COLUMN_NAME, cols.POSITION
         FROM ALL_CONSTRAINTS cons JOIN ALL_CONS_COLUMNS cols
           ON cons.CONSTRAINT_NAME = cols.CONSTRAINT_NAME AND cons.OWNER = cols.OWNER
         WHERE cons.OWNER = :1 AND cons.TABLE_NAME = :2 AND cons.CONSTRAINT_TYPE = 'P'
         ORDER BY cols.POSITION`,
        [owner, bareName]
      );
      const ixRes = await conn.execute(
        `SELECT i.INDEX_NAME, i.UNIQUENESS, ic.COLUMN_NAME, ic.COLUMN_POSITION
         FROM ALL_INDEXES i JOIN ALL_IND_COLUMNS ic
           ON i.INDEX_NAME = ic.INDEX_NAME AND i.OWNER = ic.INDEX_OWNER
         WHERE i.OWNER = :1 AND i.TABLE_NAME = :2 AND i.INDEX_TYPE != 'LOB'
         ORDER BY i.INDEX_NAME, ic.COLUMN_POSITION`,
        [owner, bareName]
      );
      const tcRes = await conn.execute(
        `SELECT c.COMMENTS FROM ALL_TAB_COMMENTS c
         WHERE c.OWNER = :1 AND c.TABLE_NAME = :2`,
        [owner, bareName]
      );
      // Reuse the assembly logic by collecting into a fake "all tables" set
      const columnsByTable = new Map<string, ColumnInfo[]>();
      const schemaByTable = new Map<string, string>();
      const primaryKeysByTable = new Map<string, string[]>();
      const indexesByTable = new Map<string, Map<string, { columns: string[]; unique: boolean }>>();
      const tableCommentsByTable = new Map<string, string>();
      const tableKey = bareName.toLowerCase();
      columnsByTable.set(tableKey, []);
      schemaByTable.set(tableKey, owner);
      // Oracle's outFormat OBJECT gives column-named keys, so use direct lookup.
      const rowObj = (r: any) => r as Record<string, unknown>;
      const cm = new Map<string, string>();
      for (const r of cmRes.rows ?? []) {
        const o = rowObj(r);
        const cn = String(o['COLUMN_NAME'] ?? '');
        const cs = String(o['COMMENTS'] ?? '');
        if (cn) cm.set(cn.toLowerCase(), cs);
      }
      for (const r of colRes.rows) {
        const o = rowObj(r);
        const cn = String(o['COLUMN_NAME'] ?? '');
        const dt = o['DATA_TYPE'];
        const dl = o['DATA_LENGTH'] as number;
        const dp = o['DATA_PRECISION'] as number;
        const ds = o['DATA_SCALE'] as number;
        const nullable = String(o['NULLABLE'] ?? 'Y');
        const defv = o['DATA_DEFAULT'];
        columnsByTable.get(tableKey)!.push({
          name: cn.toLowerCase(),
          type: this.formatOracleType(dt as any, dl, dp, ds),
          nullable: nullable === 'Y',
          defaultValue: defv ? String(defv).trim() : undefined,
          comment: cm.get(cn.toLowerCase()),
          // v4.0.3.2 Bug #17: 标记 IDENTITY 自增列
          autoIncrement: identityCols.has(cn.toLowerCase()),
        });
      }
      for (const r of pkRes.rows ?? []) {
        const o = rowObj(r);
        const cn = String(o['COLUMN_NAME'] ?? '');
        if (!primaryKeysByTable.has(tableKey)) primaryKeysByTable.set(tableKey, []);
        primaryKeysByTable.get(tableKey)!.push(cn.toLowerCase());
      }
      const ixMap = new Map<string, { columns: string[]; unique: boolean }>();
      for (const r of ixRes.rows ?? []) {
        const o = rowObj(r);
        const iname = String(o['INDEX_NAME'] ?? '');
        const uniq = String(o['UNIQUENESS'] ?? '');
        const cn = String(o['COLUMN_NAME'] ?? '');
        if (iname.includes('PK_') || iname.startsWith('INDEX') || iname.includes('SYS_')) continue;
        if (!ixMap.has(iname)) {
          ixMap.set(iname, { columns: [], unique: uniq === 'UNIQUE' });
        }
        ixMap.get(iname)!.columns.push(cn.toLowerCase());
      }
      indexesByTable.set(tableKey, ixMap);
      const tcRow = tcRes.rows?.[0];
      if (tcRow) {
        const o = rowObj(tcRow);
        const tc = o['COMMENTS'] as string;
        if (tc) tableCommentsByTable.set(tableKey, String(tc));
      }
      return {
        name: tableKey,
        schema: owner,
        comment: tableCommentsByTable.get(tableKey),
        columns: columnsByTable.get(tableKey) ?? [],
        primaryKeys: primaryKeysByTable.get(tableKey) ?? [],
        indexes: Array.from(ixMap.entries()).map(([name, v]) => ({
          name,
          columns: v.columns,
          unique: v.unique,
        })),
        estimatedRows: 0,
      } as TableInfo;
    });
  }

  /**
   * 获取数据库结构信息（批量查询优化版本）
   */
  async getSchema(): Promise<SchemaInfo> {
    if (!this.pool) {
      throw new Error('数据库未连接');
    }

    try {
      return await this.withRetry(() => this._getSchemaImpl());
    } catch (error) {
      throw new Error(
        `获取数据库结构失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async _getSchemaImpl(): Promise<SchemaInfo> {
    return this.withConnection(async (connection) => {
      // 获取 Oracle 版本
      const versionResult = await connection.execute(
        `SELECT banner FROM v$version WHERE banner LIKE 'Oracle%'`
      );
      const version = versionResult.rows?.[0]
        ? Object.values(versionResult.rows[0])[0] as string
        : 'unknown';

      // 获取当前用户
      const userResult = await connection.execute('SELECT USER FROM DUAL');
      const currentUser = userResult.rows?.[0]
        ? Object.values(userResult.rows[0])[0] as string
        : 'unknown';
      const databaseName = currentUser;

      // 批量获取所有表的列信息
      const allColumnsResult = await connection.execute(
        `SELECT OWNER, TABLE_NAME, COLUMN_NAME, DATA_TYPE, DATA_LENGTH, DATA_PRECISION,
                DATA_SCALE, NULLABLE, DATA_DEFAULT, COLUMN_ID
         FROM ALL_TAB_COLUMNS
         WHERE OWNER NOT IN (
           'SYS', 'DBSNMP', 'APPQOSSYS', 'DBSFWUSER',
           'OUTLN', 'GSMADMIN_INTERNAL', 'GGSYS', 'XDB', 'WMSYS',
           'MDSYS', 'ORDDATA', 'CTXSYS', 'ORDSYS', 'OLAPSYS',
           'LBACSYS', 'DVSYS', 'AUDSYS', 'OJVMSYS', 'REMOTE_SCHEDULER_AGENT'
         )
         ORDER BY TABLE_NAME, COLUMN_ID`
      );

      // 批量获取所有列注释
      const allCommentsResult = await connection.execute(
        `SELECT OWNER, TABLE_NAME, COLUMN_NAME, COMMENTS
         FROM ALL_COL_COMMENTS
         WHERE OWNER NOT IN (
           'SYS', 'DBSNMP', 'APPQOSSYS', 'DBSFWUSER',
           'OUTLN', 'GSMADMIN_INTERNAL', 'GGSYS', 'XDB', 'WMSYS',
           'MDSYS', 'ORDDATA', 'CTXSYS', 'ORDSYS', 'OLAPSYS',
           'LBACSYS', 'DVSYS', 'AUDSYS', 'OJVMSYS', 'REMOTE_SCHEDULER_AGENT'
         )
           AND COMMENTS IS NOT NULL`
      );

      // 批量获取所有主键信息
      const allPrimaryKeysResult = await connection.execute(
        `SELECT cons.OWNER, cons.TABLE_NAME, cols.COLUMN_NAME, cols.POSITION
         FROM ALL_CONSTRAINTS cons
         JOIN ALL_CONS_COLUMNS cols
           ON cons.CONSTRAINT_NAME = cols.CONSTRAINT_NAME
           AND cons.OWNER = cols.OWNER
         WHERE cons.CONSTRAINT_TYPE = 'P'
           AND cons.OWNER NOT IN (
             'SYS', 'DBSNMP', 'APPQOSSYS', 'DBSFWUSER',
             'OUTLN', 'GSMADMIN_INTERNAL', 'GGSYS', 'XDB', 'WMSYS',
             'MDSYS', 'ORDDATA', 'CTXSYS', 'ORDSYS', 'OLAPSYS',
             'LBACSYS', 'DVSYS', 'AUDSYS', 'OJVMSYS', 'REMOTE_SCHEDULER_AGENT'
           )
         ORDER BY cons.TABLE_NAME, cols.POSITION`
      );

      // 批量获取所有索引信息
      const allIndexesResult = await connection.execute(
        `SELECT i.TABLE_OWNER AS OWNER, i.TABLE_NAME, i.INDEX_NAME, i.UNIQUENESS, ic.COLUMN_NAME, ic.COLUMN_POSITION
         FROM ALL_INDEXES i
         JOIN ALL_IND_COLUMNS ic
           ON i.INDEX_NAME = ic.INDEX_NAME
           AND i.OWNER = ic.INDEX_OWNER
         WHERE i.OWNER NOT IN (
           'SYS', 'DBSNMP', 'APPQOSSYS', 'DBSFWUSER',
           'OUTLN', 'GSMADMIN_INTERNAL', 'GGSYS', 'XDB', 'WMSYS',
           'MDSYS', 'ORDDATA', 'CTXSYS', 'ORDSYS', 'OLAPSYS',
           'LBACSYS', 'DVSYS', 'AUDSYS', 'OJVMSYS', 'REMOTE_SCHEDULER_AGENT'
         )
           AND i.INDEX_TYPE != 'LOB'
         ORDER BY i.TABLE_NAME, i.INDEX_NAME, ic.COLUMN_POSITION`
      );

      // 批量获取所有表的行数估算和表注释
      const allStatsResult = await connection.execute(
        `SELECT t.OWNER, t.TABLE_NAME, t.NUM_ROWS, c.COMMENTS AS TABLE_COMMENT
         FROM ALL_TABLES t
         LEFT JOIN ALL_TAB_COMMENTS c ON t.TABLE_NAME = c.TABLE_NAME AND t.OWNER = c.OWNER
         WHERE t.OWNER NOT IN (
           'SYS', 'DBSNMP', 'APPQOSSYS', 'DBSFWUSER',
           'OUTLN', 'GSMADMIN_INTERNAL', 'GGSYS', 'XDB', 'WMSYS',
           'MDSYS', 'ORDDATA', 'CTXSYS', 'ORDSYS', 'OLAPSYS',
           'LBACSYS', 'DVSYS', 'AUDSYS', 'OJVMSYS', 'REMOTE_SCHEDULER_AGENT'
         )
           AND t.TEMPORARY = 'N'`
      );

      // 批量获取所有外键信息
      let allForeignKeys: any[] = [];
      try {
        const allForeignKeysResult = await connection.execute(
          `SELECT
            c.OWNER,
            c.TABLE_NAME,
            c.CONSTRAINT_NAME,
            cc.COLUMN_NAME,
            rc.OWNER AS REF_OWNER,
            rc.TABLE_NAME AS REFERENCED_TABLE,
            rcc.COLUMN_NAME AS REFERENCED_COLUMN,
            c.DELETE_RULE,
            cc.POSITION
          FROM ALL_CONSTRAINTS c
          JOIN ALL_CONS_COLUMNS cc ON c.CONSTRAINT_NAME = cc.CONSTRAINT_NAME AND c.OWNER = cc.OWNER
          JOIN ALL_CONSTRAINTS rc ON c.R_CONSTRAINT_NAME = rc.CONSTRAINT_NAME AND c.R_OWNER = rc.OWNER
          JOIN ALL_CONS_COLUMNS rcc ON rc.CONSTRAINT_NAME = rcc.CONSTRAINT_NAME AND rc.OWNER = rcc.OWNER AND cc.POSITION = rcc.POSITION
          WHERE c.CONSTRAINT_TYPE = 'R'
            AND c.OWNER NOT IN (
              'SYS', 'DBSNMP', 'APPQOSSYS', 'DBSFWUSER',
              'OUTLN', 'GSMADMIN_INTERNAL', 'GGSYS', 'XDB', 'WMSYS',
              'MDSYS', 'ORDDATA', 'CTXSYS', 'ORDSYS', 'OLAPSYS',
              'LBACSYS', 'DVSYS', 'AUDSYS', 'OJVMSYS', 'REMOTE_SCHEDULER_AGENT'
            )
          ORDER BY c.TABLE_NAME, c.CONSTRAINT_NAME, cc.POSITION`
        );
        allForeignKeys = allForeignKeysResult.rows || [];
      } catch (error) {
        // 外键查询失败时忽略，返回空数组
        console.error('获取外键信息失败，跳过:', error instanceof Error ? error.message : String(error));
      }

      // v4.0.3.2 Bug #17: 查 ALL_TAB_IDENTITY_COLS 标记 IDENTITY 列 (Oracle 12c+)
      let allIdentityCols: any[] = [];
      try {
        const allIdentityColsResult = await connection.execute(
          `SELECT OWNER, TABLE_NAME, COLUMN_NAME FROM ALL_TAB_IDENTITY_COLS
           WHERE OWNER NOT IN ('SYS', 'SYSTEM', 'SYSAUX', 'XDB', 'CTXSYS', 'MDSYS',
                                'OLAPSYS', 'APEX_030200', 'ORDDATA', 'WMSYS')`,
          []
        );
        allIdentityCols = allIdentityColsResult.rows || [];
      } catch {
        // 视图不存在 / 老版本 Oracle — skip
      }

      return this.assembleSchema(
        databaseName,
        version,
        allColumnsResult.rows || [],
        allCommentsResult.rows || [],
        allPrimaryKeysResult.rows || [],
        allIndexesResult.rows || [],
        allStatsResult.rows || [],
        allForeignKeys,
        allIdentityCols,
        currentUser
      );
    });
  }

  private makeTableKey(owner: string, tableName: string, currentUser: string): string {
    return owner === currentUser ? tableName : `${owner}.${tableName}`;
  }

  /**
   * 组装 Schema 信息
   */
  private assembleSchema(
    databaseName: string,
    version: string,
    allColumns: any[],
    allComments: any[],
    allPrimaryKeys: any[],
    allIndexes: any[],
    allStats: any[],
    allForeignKeys: any[],
    allIdentityCols: any[] = [],
    currentUser: string
  ): SchemaInfo {
    // v4.0.3.2 Bug #17: 按 tableKey 索引 IDENTITY 列
    const identityByTable = new Map<string, Set<string>>();
    for (const ic of allIdentityCols) {
      const owner = String(ic.OWNER ?? '');
      const tableName = String(ic.TABLE_NAME ?? '');
      const columnName = String(ic.COLUMN_NAME ?? '');
      if (!tableName || !columnName) continue;
      const tableKey = this.makeTableKey(owner, tableName, currentUser);
      if (!identityByTable.has(tableKey)) identityByTable.set(tableKey, new Set());
      identityByTable.get(tableKey)!.add(columnName.toLowerCase());
    }
    // 按表名分组列信息
    const columnsByTable = new Map<string, ColumnInfo[]>();
    const schemaByTable = new Map<string, string>();

    for (const col of allColumns) {
      const owner = col.OWNER;
      const tableName = col.TABLE_NAME;
      const columnName = col.COLUMN_NAME;

      // 跳过无效数据
      if (!tableName || !columnName) {
        continue;
      }

      const tableKey = this.makeTableKey(owner, tableName, currentUser);

      if (!columnsByTable.has(tableKey)) {
        columnsByTable.set(tableKey, []);
        schemaByTable.set(tableKey, owner);
      }

      columnsByTable.get(tableKey)!.push({
        name: columnName.toLowerCase(),
        type: this.formatOracleType(
          col.DATA_TYPE,
          col.DATA_LENGTH,
          col.DATA_PRECISION,
          col.DATA_SCALE
        ),
        nullable: col.NULLABLE === 'Y',
        defaultValue: col.DATA_DEFAULT?.trim() || undefined,
        // v4.0.3.2 Bug #17: IDENTITY 自增标记
        autoIncrement: identityByTable.get(tableKey)?.has(columnName.toLowerCase()),
      });
    }

    // 按表名分组列注释
    const commentsByTable = new Map<string, Map<string, string>>();
    for (const comment of allComments) {
      const owner = comment.OWNER;
      const tableName = comment.TABLE_NAME;
      const columnName = comment.COLUMN_NAME;
      const comments = comment.COMMENTS;

      // 跳过无效数据
      if (!tableName || !columnName || !comments) {
        continue;
      }

      const tableKey = this.makeTableKey(owner, tableName, currentUser);

      if (!commentsByTable.has(tableKey)) {
        commentsByTable.set(tableKey, new Map());
      }
      commentsByTable.get(tableKey)!.set(
        columnName.toLowerCase(),
        comments
      );
    }

    // 将注释添加到列信息中
    for (const [tableKey, columns] of columnsByTable.entries()) {
      const tableComments = commentsByTable.get(tableKey);
      if (tableComments) {
        for (const col of columns) {
          if (tableComments.has(col.name)) {
            col.comment = tableComments.get(col.name);
          }
        }
      }
    }

    // 按表名分组主键信息
    const primaryKeysByTable = new Map<string, string[]>();
    for (const pk of allPrimaryKeys) {
      const owner = pk.OWNER;
      const tableName = pk.TABLE_NAME;
      const columnName = pk.COLUMN_NAME;

      // 跳过无效数据
      if (!tableName || !columnName) {
        continue;
      }

      const tableKey = this.makeTableKey(owner, tableName, currentUser);

      if (!primaryKeysByTable.has(tableKey)) {
        primaryKeysByTable.set(tableKey, []);
      }
      primaryKeysByTable.get(tableKey)!.push(columnName.toLowerCase());
    }

    // 按表名分组索引信息
    const indexesByTable = new Map<string, Map<string, { columns: string[]; unique: boolean }>>();

    for (const idx of allIndexes) {
      const owner = idx.OWNER;
      const tableName = idx.TABLE_NAME;
      const indexName = idx.INDEX_NAME;
      const columnName = idx.COLUMN_NAME;

      // 跳过无效数据
      if (!tableName || !indexName || !columnName) {
        continue;
      }

      // 跳过主键索引
      if (indexName.includes('PK_') || indexName.includes('SYS_')) {
        continue;
      }

      const tableKey = this.makeTableKey(owner, tableName, currentUser);

      if (!indexesByTable.has(tableKey)) {
        indexesByTable.set(tableKey, new Map());
      }

      const tableIndexes = indexesByTable.get(tableKey)!;

      if (!tableIndexes.has(indexName)) {
        tableIndexes.set(indexName, {
          columns: [],
          unique: idx.UNIQUENESS === 'UNIQUE',
        });
      }

      tableIndexes.get(indexName)!.columns.push(columnName.toLowerCase());
    }

    // 按表名分组行数统计
    const rowsByTable = new Map<string, number>();
    const tableCommentsByTable = new Map<string, string>();
    for (const stat of allStats) {
      const owner = stat.OWNER;
      const tableName = stat.TABLE_NAME;
      if (tableName) {
        const tableKey = this.makeTableKey(owner, tableName, currentUser);
        rowsByTable.set(tableKey, stat.NUM_ROWS || 0);
        if (stat.TABLE_COMMENT) {
          tableCommentsByTable.set(tableKey, stat.TABLE_COMMENT);
        }
      }
    }

    // 按表名分组外键信息
    const foreignKeysByTable = new Map<string, Map<string, { columns: string[]; referencedTable: string; referencedColumns: string[]; onDelete?: string }>>();
    const relationships: RelationshipInfo[] = [];

    for (const fk of allForeignKeys) {
      const owner = fk.OWNER;
      const tableName = fk.TABLE_NAME;
      const constraintName = fk.CONSTRAINT_NAME;

      if (!tableName || !constraintName) continue;

      const tableKey = this.makeTableKey(owner, tableName, currentUser);
      const refOwner = fk.REF_OWNER;
      const refTableKey = this.makeTableKey(refOwner, fk.REFERENCED_TABLE, currentUser);

      if (!foreignKeysByTable.has(tableKey)) {
        foreignKeysByTable.set(tableKey, new Map());
      }

      const tableForeignKeys = foreignKeysByTable.get(tableKey)!;

      if (!tableForeignKeys.has(constraintName)) {
        tableForeignKeys.set(constraintName, {
          columns: [],
          referencedTable: refTableKey,
          referencedColumns: [],
          onDelete: fk.DELETE_RULE,
        });
      }

      const fkInfo = tableForeignKeys.get(constraintName)!;
      fkInfo.columns.push(String(fk.COLUMN_NAME).toLowerCase());
      fkInfo.referencedColumns.push(String(fk.REFERENCED_COLUMN).toLowerCase());
    }

    // 生成全局关系视图
    for (const [tableKey, tableForeignKeys] of foreignKeysByTable.entries()) {
      for (const [constraintName, fkInfo] of tableForeignKeys.entries()) {
        relationships.push({
          fromTable: tableKey.toLowerCase(),
          fromColumns: fkInfo.columns,
          toTable: fkInfo.referencedTable.toLowerCase(),
          toColumns: fkInfo.referencedColumns,
          type: 'many-to-one',
          constraintName,
        });
      }
    }

    // 组装表信息（基于列信息构建，不依赖 ALL_TABLES 的结果）
    const tableInfos: TableInfo[] = [];

    for (const [tableKey, columns] of columnsByTable.entries()) {
      const tableIndexes = indexesByTable.get(tableKey);
      const indexInfos: IndexInfo[] = [];

      if (tableIndexes) {
        for (const [indexName, indexData] of tableIndexes.entries()) {
          indexInfos.push({
            name: indexName,
            columns: indexData.columns,
            unique: indexData.unique,
          });
        }
      }

      // 组装外键信息
      const tableForeignKeys = foreignKeysByTable.get(tableKey);
      const foreignKeyInfos: ForeignKeyInfo[] = [];

      if (tableForeignKeys) {
        for (const [constraintName, fkData] of tableForeignKeys.entries()) {
          foreignKeyInfos.push({
            name: constraintName,
            columns: fkData.columns,
            referencedTable: fkData.referencedTable.toLowerCase(),
            referencedColumns: fkData.referencedColumns,
            onDelete: fkData.onDelete,
          });
        }
      }

      tableInfos.push({
        name: tableKey.toLowerCase(),
        schema: schemaByTable.get(tableKey),
        comment: tableCommentsByTable.get(tableKey) || undefined,
        columns,
        primaryKeys: primaryKeysByTable.get(tableKey) || [],
        indexes: indexInfos,
        foreignKeys: foreignKeyInfos.length > 0 ? foreignKeyInfos : undefined,
        estimatedRows: rowsByTable.get(tableKey) || 0,
      });
    }

    // 按表名排序
    tableInfos.sort((a, b) => a.name.localeCompare(b.name));

    return {
      databaseType: 'oracle',
      databaseName,
      tables: tableInfos,
      version,
      relationships: relationships.length > 0 ? relationships : undefined,
    };
  }

  /**
   * 格式化 Oracle 数据类型
   */
  private formatOracleType(
    dataType: string | undefined | null,
    length?: number,
    precision?: number,
    scale?: number
  ): string {
    // 处理空值
    if (!dataType) {
      return 'UNKNOWN';
    }

    switch (dataType) {
      case 'NUMBER':
        if (precision !== null && precision !== undefined) {
          if (scale !== null && scale !== undefined && scale > 0) {
            return `NUMBER(${precision},${scale})`;
          }
          return `NUMBER(${precision})`;
        }
        return 'NUMBER';

      case 'VARCHAR2':
      case 'CHAR':
        if (length) {
          return `${dataType}(${length})`;
        }
        return dataType;

      case 'TIMESTAMP':
        if (scale !== null && scale !== undefined) {
          return `TIMESTAMP(${scale})`;
        }
        return 'TIMESTAMP';

      default:
        return dataType;
    }
  }

  /**
   * P0-3: Override withTransaction to pin all statements to a single physical connection.
   * Without this, BEGIN/COMMIT and individual statements could end up on different
   * pooled connections, breaking "all-or-nothing" semantics.
   */
  async withTransaction<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    if (!this.pool) {
      throw new Error('数据库未连接');
    }
    const connection = await this.pool.getConnection();
    try {
      // v4.0.2 Bug #9 fix: oracledb's `autoCommit:false` mode auto-begins a
      // transaction; do NOT explicitly execute `BEGIN` because that's a PL/SQL
      // keyword requiring a block. oracledb rejects bare `BEGIN` with
      // ORA-06550: PLS-00103 'Encountered the symbol "end-of-file" ...'.
      // Similarly DDL (CREATE/DROP) implicit-commits, so true atomicity for
      // mixed DDL+DML scripts is best-effort; the executeQuery calls below
      // still use autoCommit:false so DML rolls back together.
      const tx: TransactionContext = {
        executeQuery: async (query: string, params?: unknown[]) => {
          const startTime = Date.now();
          let cleanQuery = query.trim();
          // v5.0.0: PL/SQL 块(`BEGIN...END;`)必须保留 trailing `;`,只对非 PL/SQL 语句剥。
          const looksLikePlsqlBlock = /^\s*(BEGIN|DECLARE)\b/i.test(cleanQuery) && /\bEND\s*;?\s*$/i.test(cleanQuery);
          if (!looksLikePlsqlBlock && cleanQuery.endsWith(';')) {
            cleanQuery = cleanQuery.slice(0, -1).trim();
          }
          // v4.0.2 Bug #12: convert ? to :1, :2, ... for oracledb named binds.
          const oracledbSql = convertQuestionMarks(cleanQuery);
          const result = await connection.execute(oracledbSql, params || [], {
            autoCommit: false,
            outFormat: oracledb.OUT_FORMAT_OBJECT,
          });
          const executionTime = Date.now() - startTime;
          if (result.rows && result.rows.length > 0) {
            const rows = result.rows.map((row: any) => {
              const r: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(row)) {
                r[k.toLowerCase()] = v;
              }
              return r;
            });
            return { rows, executionTime, metadata: { columnCount: result.metaData?.length || 0 } };
          } else if (result.rowsAffected !== undefined && result.rowsAffected > 0) {
            return { rows: [], affectedRows: result.rowsAffected, executionTime };
          } else {
            return { rows: [], executionTime };
          }
        },
      };
      const result = await fn(tx);
      await connection.execute('COMMIT', [], { autoCommit: false });
      return result;
    } catch (err) {
      try { await connection.execute('ROLLBACK', [], { autoCommit: false }); } catch { /* ignore */ }
      throw err;
    } finally {
      try { await connection.close(); } catch { /* ignore */ }
    }
  }

  /**
   * P0-3: Override executeScript to use withTransaction.
   * All statements run on a single connection so BEGIN/COMMIT are atomic.
   * Non-transactional mode falls back to the BaseAdapter default.
   */
  async executeScript(query: string, options: ExecuteScriptOptions = {}): Promise<QueryResult> {
    if (options.useTransaction === false) {
      return super.executeScript(query, { ...options, useTransaction: false });
    }
    return this.withTransaction(async (tx) => {
      const statements = splitStatements(query, this.getDialect()).filter(s => s.trim());
      const startTime = Date.now();
      const lastResult = statements.length > 0
        ? await tx.executeQuery(statements[0])
        : { rows: [], executionTime: 0 };
      for (let i = 1; i < statements.length; i++) {
        await tx.executeQuery(statements[i]);
      }
      return {
        rows: [],
        executionTime: Date.now() - startTime,
        metadata: { statementCount: statements.length, lastResult },
      };
    });
  }

  /**
   * v4.0.2 Bug #10 fix: Override executeBatch.
   * BaseAdapter.executeBatch defaults to wrapping in BEGIN/COMMIT/ROLLBACK
   * (src/adapters/base.ts:215). oracledb rejects bare BEGIN with ORA-06550
   * PLS-00103 (it's a PL/SQL keyword requiring a block). Same workaround as
   * Bug #9: route through withTransaction so autoCommit:false + the existing
   * tx.executeQuery handle atomicity without sending BEGIN.
   *
   * DDL inside a batch is not supported (DDL implicit-commits in Oracle).
   * DML only.
   */
  async executeBatch(sql: string, paramsList: unknown[][], options: ExecuteBatchOptions = {}): Promise<BatchResult> {
    if (options.useTransaction === false) {
      return super.executeBatch(sql, paramsList, { ...options, useTransaction: false });
    }
    return this.withTransaction(async (tx) => {
      const affectedRowsPerStatement: number[] = [];
      for (const params of paramsList) {
        const r = await tx.executeQuery(sql, params);
        affectedRowsPerStatement.push(r.affectedRows ?? 0);
      }
      return {
        affectedRowsPerStatement,
        totalAffectedRows: affectedRowsPerStatement.reduce((a, b) => a + Math.max(b, 0), 0),
      };
    });
  }

  /**
   * 检查是否为写操作
   */
  isWriteOperation(query: string): boolean {
    // 首先使用通用的写操作检测
    if (checkWriteOperation(query)) {
      return true;
    }

    // 添加 Oracle 特定的写操作检测
    const trimmedQuery = query.trim().toUpperCase();

    // MERGE 语句（Oracle 的 upsert 操作）
    if (trimmedQuery.startsWith('MERGE')) {
      return true;
    }

    // PL/SQL 块（可能包含写操作）
    if (trimmedQuery.startsWith('BEGIN') || trimmedQuery.startsWith('DECLARE')) {
      return true;
    }

    // CALL 存储过程（可能包含写操作）
    if (trimmedQuery.startsWith('CALL')) {
      return true;
    }

    // 事务控制语句
    if (trimmedQuery.startsWith('COMMIT') || trimmedQuery.startsWith('ROLLBACK')) {
      return true;
    }

    return false;
  }
  protected getDialect(): import('../utils/adapter-factory.js').DbType {
    return 'oracle';
  }

}
