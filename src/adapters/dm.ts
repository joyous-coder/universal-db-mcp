/**
 * 达梦数据库适配器
 * 达梦数据库高度兼容 Oracle，使用类似的 API 和系统视图
 *
 * dmdb 驱动会作为可选依赖自动安装
 *
 * 性能优化：使用批量查询获取 Schema 信息，避免 N+1 查询问题
 *
 * 连接管理：使用心跳保活 + 断线自动重连 + 操作自动重试，确保长连接稳定性
 */

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
import { isConnectionErrorMessage, withRetry } from '../utils/retry.js';
import { splitStatements } from '../utils/sql-parser.js';

// 动态导入 dmdb，因为它是可选依赖
let dmdb: any = null;

async function loadDMDB() {
  if (dmdb) {
    return dmdb;
  }

  try {
    // @ts-ignore - dmdb 是可选依赖，可能未安装
    const module = await import('dmdb');
    dmdb = module.default || module;
    return dmdb;
  } catch (error) {
    throw new Error(
      '达梦数据库驱动未安装。\n' +
      '请运行以下命令安装：npm install dmdb\n' +
      '或者全局安装：npm install -g dmdb'
    );
  }
}

export class DMAdapter extends BaseAdapter {
  private connection: any = null;
  private pool: any = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private connectionConfig: any = null;
  private config: {
    host: string;
    port: number;
    user?: string;
    password?: string;
    database?: string;
    poolConfig?: { max?: number; min?: number; idleTimeoutMs?: number };
  };

  constructor(config: {
    host: string;
    port: number;
    user?: string;
    password?: string;
    database?: string;
    poolConfig?: { max?: number; min?: number; idleTimeoutMs?: number };
  }) {
    super();
    this.config = config;
  }

  private async reconnect(): Promise<void> {
    try {
      if (this.connection) { try { await this.connection.close(); } catch {} this.connection = null; }
      const DM = await loadDMDB();
      // 从连接池重新获取连接
      if (this.pool) {
        this.connection = await this.pool.getConnection();
      } else {
        const pool = await DM.createPool(this.connectionConfig);
        this.pool = pool;
        this.connection = await pool.getConnection();
      }
      console.error('达梦数据库重连成功');
    } catch (error) {
      console.error('达梦数据库重连失败:', error instanceof Error ? error.message : String(error));
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(async () => {
      try {
        if (this.connection) { await this.connection.execute('SELECT 1 FROM DUAL', []); }
      } catch {
        await this.reconnect();
      }
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    return withRetry(fn, {
      isRetryable: (error) => {
        const msg = error instanceof Error ? error.message : String(error);
        // 共享的连接错误检测 + DM 特定的中文连接错误消息
        return isConnectionErrorMessage(msg) || /closed|网络|连接/.test(msg);
      },
      // After retry, also reconnect (DM-specific behavior preserved)
      baseDelayMs: 50,
    }).catch(async (err) => {
      // If shared retry exhausted, try DM-specific reconnect path
      if (isConnectionErrorMessage(err instanceof Error ? err.message : String(err)) ||
          /closed|网络|连接/.test(err instanceof Error ? err.message : String(err))) {
        await this.reconnect();
        return fn();
      }
      throw err;
    });
  }

  /**
   * 连接到达梦数据库
   *
   * 注意：dmdb 驱动的 getConnection() 方法不支持 connectString 参数，
   * 只能通过 createPool + pool.getConnection() 的方式连接。
   * 同时需要通过 URL 参数 loginEncrypt=false 禁用消息加密，
   * 避免 Node.js 22 的 OpenSSL 3.0 与达梦加密算法不兼容的问题。
   */
  async connect(): Promise<void> {
    try {
      const DM = await loadDMDB();

      // 达梦数据库连接配置
      // 使用 connectString 格式，通过 URL 参数 loginEncrypt=false 禁用消息加密
      // 避免 Node.js 22 的 OpenSSL 3.0 与达梦加密算法不兼容的问题
      const port = this.config.port || 5236; // 达梦默认端口
      const connectString = `dm://${this.config.user}:${this.config.password}@${this.config.host}:${port}?loginEncrypt=false`;

      // P1: poolConfig (DB_POOL_SIZE / DB_POOL_MIN / DB_POOL_IDLE_TIMEOUT_MS)
      // dmdb 驱动的 poolTimeout 单位为秒（默认 60）
      const poolMax = this.config.poolConfig?.max ?? 3;
      const poolMin = this.config.poolConfig?.min ?? 1;
      const poolTimeoutSec = Math.max(
        0,
        Math.round((this.config.poolConfig?.idleTimeoutMs ?? 60000) / 1000)
      );

      // createPool 支持 connectString，getConnection 不支持
      // 所以先用 createPool 创建连接池，再从池中获取连接
      // v4.0.2 Bug #8 fix: dmdb is process-wide singleton — every pool needs a
      // unique `poolAlias`, otherwise the second createPool with the same alias
      // (default) fails with "[20006] 连接池别名已存在". Pass a random alias
      // per DM adapter instance so multiple DM connections can coexist.
      this.pool = await DM.createPool({
        connectString,
        poolMax,
        poolMin,
        poolAlias: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        poolTimeout: poolTimeoutSec,
      });
      this.connection = await this.pool.getConnection();
      this.connectionConfig = { connectString };

      // 测试连接
      await this.connection.execute('SELECT 1 FROM DUAL', []);
      this.startHeartbeat();
    } catch (error: any) {
      // 翻译常见错误
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes('用户名') || errorMessage.includes('密码')) {
        throw new Error('达梦数据库连接失败: 用户名或密码无效');
      } else if (errorMessage.includes('连接') || errorMessage.includes('网络')) {
        throw new Error('达梦数据库连接失败: 无法连接到数据库服务器，请检查主机地址和端口');
      }

      throw new Error(`达梦数据库连接失败: ${errorMessage}`);
    }
  }

  /**
   * 断开数据库连接
   */
  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    if (this.connection) {
      try {
        await this.connection.close();
      } catch (error) {
        // 忽略关闭连接时的错误
      }
      this.connection = null;
    }
    if (this.pool) {
      try {
        await this.pool.close();
      } catch (error) {
        // 忽略关闭连接池时的错误
      }
      this.pool = null;
    }
  }

  /**
   * 执行 SQL 查询
   */
  async executeQuery(query: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.connection) {
      throw new Error('数据库未连接');
    }

    const startTime = Date.now();

    try {
      // 达梦兼容 Oracle，不需要末尾的分号，移除它以避免语法错误
      let cleanQuery = query.trim();
      if (cleanQuery.endsWith(';')) {
        cleanQuery = cleanQuery.slice(0, -1).trim();
      }

      // 执行查询
      // 对于写操作（INSERT/UPDATE/DELETE），设置 autoCommit: true 确保操作立即提交
      // 对于读操作（SELECT），autoCommit 无影响
      // v3.2.8 Bug #40 fix: dmdb 默认 outFormat=ARRAY(返回数字键 0/1/2),
      // 必须显式设 OUT_FORMAT_OBJECT 才能返回列名键
      const isWrite = this.isWriteOperation(cleanQuery);
      const result: any = await this.withRetry(() => this.connection.execute(cleanQuery, params || [], {
        autoCommit: isWrite,
        outFormat: 4002, // OUT_FORMAT_OBJECT
      }));

      const executionTime = Date.now() - startTime;

      // 处理查询结果
      if (result.rows && result.rows.length > 0) {
        // SELECT 查询 - 将列名转换为小写
        const rows = result.rows.map((row: any) => {
          const lowerCaseRow: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(row)) {
            lowerCaseRow[key.toLowerCase()] = value;
          }
          return lowerCaseRow;
        });

        return {
          rows,
          executionTime,
          metadata: {
            columnCount: result.metaData?.length || 0,
          },
        };
      } else if (result.rowsAffected !== undefined && result.rowsAffected > 0) {
        // DML 操作 (INSERT/UPDATE/DELETE)
        return {
          rows: [],
          affectedRows: result.rowsAffected,
          executionTime,
        };
      } else {
        // 其他操作或空结果
        return {
          rows: [],
          executionTime,
        };
      }
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes('表') || errorMessage.includes('视图')) {
        throw new Error('查询执行失败: 表或视图不存在');
      } else if (errorMessage.includes('约束')) {
        throw new Error('查询执行失败: 违反唯一约束');
      }

      throw new Error(`查询执行失败: ${errorMessage}`);
    }
  }

  /**
   * 获取数据库结构信息（批量查询优化版本）
   *
   * 达梦数据库中：
   * - database 是数据库实例名（如 DAMENG）
   * - schema 是用户的命名空间（通常与用户名相同，如 SHOP）
   * - 表存储在 schema 下，不是 database 下
   *
   * 注意：dmdb 驱动返回的列名是数字索引（"0", "1", ...），不是列名！
   * 因此需要按索引位置访问数据。
   */
  /**
   * v4.0.3: Fast-path single-table metadata. Issues 4 targeted queries
   * filtered by table name/owner, avoiding full schema scan.
   */
  async getTableInfo(tableName: string): Promise<TableInfo | null> {
    if (!this.connection) {
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
    try {
      const [colRes, cmRes, pkRes, ixRes] = await Promise.all([
        this.connection.execute(
          `SELECT OWNER, TABLE_NAME, COLUMN_NAME, DATA_TYPE, DATA_LENGTH, DATA_PRECISION,
                  DATA_SCALE, NULLABLE, DATA_DEFAULT, COLUMN_ID
           FROM ALL_TAB_COLUMNS WHERE OWNER = :1 AND TABLE_NAME = :2 ORDER BY COLUMN_ID`,
          [owner, bareName]
        ),
        this.connection.execute(
          `SELECT COLUMN_NAME, COMMENTS FROM ALL_COL_COMMENTS
           WHERE OWNER = :1 AND TABLE_NAME = :2 AND COMMENTS IS NOT NULL`,
          [owner, bareName]
        ),
        this.connection.execute(
          `SELECT cols.COLUMN_NAME FROM ALL_CONSTRAINTS cons JOIN ALL_CONS_COLUMNS cols
             ON cons.CONSTRAINT_NAME = cols.CONSTRAINT_NAME AND cons.OWNER = cols.OWNER
           WHERE cons.OWNER = :1 AND cons.TABLE_NAME = :2 AND cons.CONSTRAINT_TYPE = 'P'
           ORDER BY cols.POSITION`,
          [owner, bareName]
        ),
        this.connection.execute(
          `SELECT i.INDEX_NAME, i.UNIQUENESS, ic.COLUMN_NAME, ic.COLUMN_POSITION
           FROM ALL_INDEXES i JOIN ALL_IND_COLUMNS ic
             ON i.INDEX_NAME = ic.INDEX_NAME AND i.OWNER = ic.IND_OWNER
           WHERE i.OWNER = :1 AND i.TABLE_NAME = :2 AND i.INDEX_TYPE != 'LOB'
           ORDER BY i.INDEX_NAME, ic.COLUMN_POSITION`,
          [owner, bareName]
        ),
      ]);
      if (!colRes.rows || colRes.rows.length === 0) return null;
      const cm = new Map<string, string>();
      for (const r of cmRes.rows ?? []) {
        const cn = this.getValueByIndex(r, 0) as string;
        const cs = this.getValueByIndex(r, 1) as string;
        cm.set(String(cn).toLowerCase(), String(cs));
      }
      const columns: ColumnInfo[] = [];
      for (const r of colRes.rows) {
        const cn = this.getValueByIndex(r, 2) as string;
        const dt = this.getValueByIndex(r, 3);
        const dl = this.getValueByIndex(r, 4) as number;
        const dp = this.getValueByIndex(r, 5) as number;
        const ds = this.getValueByIndex(r, 6) as number;
        const nullable = this.getValueByIndex(r, 7) as string;
        const defv = this.getValueByIndex(r, 8);
        columns.push({
          name: String(cn).toLowerCase(),
          type: this.formatDMType(dt as any, dl, dp, ds),
          nullable: nullable === 'Y',
          defaultValue: defv ? String(defv).trim() : undefined,
          comment: cm.get(String(cn).toLowerCase()),
        });
      }
      const primaryKeys: string[] = [];
      for (const r of pkRes.rows ?? []) {
        primaryKeys.push(String(this.getValueByIndex(r, 0) as string).toLowerCase());
      }
      const ixMap = new Map<string, { columns: string[]; unique: boolean }>();
      for (const r of ixRes.rows ?? []) {
        const iname = String(this.getValueByIndex(r, 0) as string);
        const uniq = String(this.getValueByIndex(r, 1) as string);
        const cn = String(this.getValueByIndex(r, 2) as string);
        if (iname.includes('PK_') || iname.startsWith('INDEX') || iname.includes('SYS_')) continue;
        if (!ixMap.has(iname)) ixMap.set(iname, { columns: [], unique: uniq === 'UNIQUE' });
        ixMap.get(iname)!.columns.push(cn.toLowerCase());
      }
      const indexes = Array.from(ixMap.entries()).map(([name, v]) => ({ name, columns: v.columns, unique: v.unique }));
      const tableKey = bareName.toLowerCase();
      return {
        name: tableKey,
        schema: owner || '',
        columns,
        primaryKeys,
        indexes,
        estimatedRows: 0,
      } as TableInfo;
    } catch {
      return null;
    }
  }

  async getSchema(): Promise<SchemaInfo> {
    if (!this.connection) {
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
      // 获取达梦数据库版本
      const versionResult = await this.connection.execute(
        `SELECT BANNER FROM V$VERSION WHERE ROWNUM = 1`,
        []
      );
      const version = versionResult.rows?.[0]
        ? this.getValueByIndex(versionResult.rows[0], 0) as string
        : 'unknown';

      // 获取当前 schema（在达梦中，schema 通常与用户名相同）
      const schemaResult = await this.connection.execute(
        `SELECT SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') FROM DUAL`,
        []
      );
      const currentSchema = schemaResult.rows?.[0]
        ? this.getValueByIndex(schemaResult.rows[0], 0) as string
        : '';

      // 获取当前用户（作为备选）
      const userResult = await this.connection.execute('SELECT USER FROM DUAL', []);
      const currentUser = userResult.rows?.[0]
        ? this.getValueByIndex(userResult.rows[0], 0) as string
        : '';

      // schema 名称：优先使用当前 schema，其次使用当前用户，最后使用配置的用户名
      const schemaName = (currentSchema || currentUser || this.config.user || '').toUpperCase();
      const databaseName = schemaName || 'unknown';

      // 获取所有表的列信息
      // 列顺序: 0=OWNER, 1=TABLE_NAME, 2=COLUMN_NAME, 3=DATA_TYPE, 4=DATA_LENGTH,
      //        5=DATA_PRECISION, 6=DATA_SCALE, 7=NULLABLE, 8=DATA_DEFAULT, 9=COLUMN_ID
      // v3.2.8 Bug #41+#42 fix: remove 'SYSDBA' from exclusion list (current user's schema).
      // Otherwise user-created tables in SYSDBA schema are invisible.
      const allColumnsResult = await this.connection.execute(
        `SELECT OWNER, TABLE_NAME, COLUMN_NAME, DATA_TYPE, DATA_LENGTH, DATA_PRECISION,
                DATA_SCALE, NULLABLE, DATA_DEFAULT, COLUMN_ID
         FROM ALL_TAB_COLUMNS
         WHERE OWNER NOT IN ('SYS', 'SYSTEM', 'SYSAUDITOR', 'SYSSSO', 'CTISYS')
         ORDER BY OWNER, TABLE_NAME, COLUMN_ID`,
        []
      );

      // 获取所有列注释
      // 列顺序: 0=OWNER, 1=TABLE_NAME, 2=COLUMN_NAME, 3=COMMENTS
      const allCommentsResult = await this.connection.execute(
        `SELECT OWNER, TABLE_NAME, COLUMN_NAME, COMMENTS
         FROM ALL_COL_COMMENTS
         WHERE OWNER NOT IN ('SYS', 'SYSTEM', 'SYSAUDITOR', 'SYSSSO', 'CTISYS')
           AND COMMENTS IS NOT NULL`,
        []
      );

      // 获取所有主键信息
      // 列顺序: 0=OWNER, 1=TABLE_NAME, 2=COLUMN_NAME, 3=POSITION
      const allPrimaryKeysResult = await this.connection.execute(
        `SELECT cons.OWNER, cons.TABLE_NAME, cols.COLUMN_NAME, cols.POSITION
         FROM ALL_CONSTRAINTS cons
         JOIN ALL_CONS_COLUMNS cols
           ON cons.CONSTRAINT_NAME = cols.CONSTRAINT_NAME AND cons.OWNER = cols.OWNER
         WHERE cons.CONSTRAINT_TYPE = 'P'
           AND cons.OWNER NOT IN ('SYS', 'SYSTEM', 'SYSAUDITOR', 'SYSSSO', 'CTISYS')
         ORDER BY cons.OWNER, cons.TABLE_NAME, cols.POSITION`,
        []
      );

      // 获取所有索引信息
      // 列顺序: 0=OWNER, 1=TABLE_NAME, 2=INDEX_NAME, 3=UNIQUENESS, 4=COLUMN_NAME, 5=COLUMN_POSITION
      const allIndexesResult = await this.connection.execute(
        `SELECT i.OWNER, i.TABLE_NAME, i.INDEX_NAME, i.UNIQUENESS, ic.COLUMN_NAME, ic.COLUMN_POSITION
         FROM ALL_INDEXES i
         JOIN ALL_IND_COLUMNS ic
           ON i.INDEX_NAME = ic.INDEX_NAME AND i.OWNER = ic.INDEX_OWNER
         WHERE i.OWNER NOT IN ('SYS', 'SYSTEM', 'SYSAUDITOR', 'SYSSSO', 'CTISYS')
         ORDER BY i.OWNER, i.TABLE_NAME, i.INDEX_NAME, ic.COLUMN_POSITION`,
        []
      );

      // 获取所有表的行数估算和表注释
      // 列顺序: 0=OWNER, 1=TABLE_NAME, 2=NUM_ROWS, 3=TABLE_COMMENT
      const allStatsResult = await this.connection.execute(
        `SELECT t.OWNER, t.TABLE_NAME, t.NUM_ROWS, c.COMMENTS AS TABLE_COMMENT
         FROM ALL_TABLES t
         LEFT JOIN ALL_TAB_COMMENTS c ON t.TABLE_NAME = c.TABLE_NAME AND t.OWNER = c.OWNER
         WHERE t.OWNER NOT IN ('SYS', 'SYSTEM', 'SYSAUDITOR', 'SYSSSO', 'CTISYS')`,
        []
      );

      // 获取所有外键信息
      // 列顺序: 0=OWNER, 1=TABLE_NAME, 2=CONSTRAINT_NAME, 3=COLUMN_NAME, 4=REFERENCED_TABLE,
      //        5=REFERENCED_COLUMN, 6=DELETE_RULE, 7=REF_OWNER, 8=POSITION
      let allForeignKeys: any[] = [];
      try {
        const allForeignKeysResult = await this.connection.execute(
          `SELECT
            c.OWNER,
            c.TABLE_NAME,
            c.CONSTRAINT_NAME,
            cc.COLUMN_NAME,
            rc.TABLE_NAME AS REFERENCED_TABLE,
            rcc.COLUMN_NAME AS REFERENCED_COLUMN,
            c.DELETE_RULE,
            rc.OWNER AS REF_OWNER,
            cc.POSITION
          FROM ALL_CONSTRAINTS c
          JOIN ALL_CONS_COLUMNS cc ON c.CONSTRAINT_NAME = cc.CONSTRAINT_NAME AND c.OWNER = cc.OWNER
          JOIN ALL_CONSTRAINTS rc ON c.R_CONSTRAINT_NAME = rc.CONSTRAINT_NAME AND c.R_OWNER = rc.OWNER
          JOIN ALL_CONS_COLUMNS rcc ON rc.CONSTRAINT_NAME = rcc.CONSTRAINT_NAME AND rc.OWNER = rcc.OWNER AND cc.POSITION = rcc.POSITION
          WHERE c.CONSTRAINT_TYPE = 'R'
            AND c.OWNER NOT IN ('SYS', 'SYSTEM', 'SYSAUDITOR', 'SYSSSO', 'CTISYS')
          ORDER BY c.OWNER, c.TABLE_NAME, c.CONSTRAINT_NAME, cc.POSITION`,
          []
        );
        allForeignKeys = allForeignKeysResult.rows || [];
      } catch (error) {
        // 外键查询失败时忽略，返回空数组
        console.error('获取外键信息失败，跳过:', error instanceof Error ? error.message : String(error));
      }

      return this.assembleSchemaFromIndexedRows(
        databaseName,
        version,
        allColumnsResult.rows || [],
        allCommentsResult.rows || [],
        allPrimaryKeysResult.rows || [],
        allIndexesResult.rows || [],
        allStatsResult.rows || [],
        allForeignKeys,
        schemaName
      );
  }

  /**
   * 按索引获取对象的值（dmdb 驱动返回的列名是数字索引）
   */
  private getValueByIndex(obj: any, index: number): unknown {
    if (!obj || typeof obj !== 'object') {
      return undefined;
    }
    // 尝试按数字索引访问
    if (obj[index] !== undefined) {
      return obj[index];
    }
    // 尝试按字符串索引访问
    if (obj[String(index)] !== undefined) {
      return obj[String(index)];
    }
    // 尝试按位置获取值
    const values = Object.values(obj);
    return values.length > index ? values[index] : undefined;
  }

  private makeTableKey(owner: string, tableName: string, currentUser: string): string {
    return owner.toUpperCase() === currentUser.toUpperCase() ? tableName : `${owner}.${tableName}`;
  }

  /**
   * 组装 Schema 信息（处理 dmdb 驱动返回的数字索引列名）
   */
  private assembleSchemaFromIndexedRows(
    databaseName: string,
    version: string,
    allColumns: any[],
    allComments: any[],
    allPrimaryKeys: any[],
    allIndexes: any[],
    allStats: any[],
    allForeignKeys: any[],
    currentUser: string
  ): SchemaInfo {
    // 按表名分组列信息
    // 列顺序: 0=OWNER, 1=TABLE_NAME, 2=COLUMN_NAME, 3=DATA_TYPE, 4=DATA_LENGTH,
    //        5=DATA_PRECISION, 6=DATA_SCALE, 7=NULLABLE, 8=DATA_DEFAULT, 9=COLUMN_ID
    const columnsByTable = new Map<string, ColumnInfo[]>();
    const schemaByTable = new Map<string, string>();

    for (const col of allColumns) {
      const owner = this.getValueByIndex(col, 0) as string;
      const tableName = this.getValueByIndex(col, 1) as string;
      const columnName = this.getValueByIndex(col, 2) as string;
      const dataType = this.getValueByIndex(col, 3);
      const dataLength = this.getValueByIndex(col, 4) as number;
      const dataPrecision = this.getValueByIndex(col, 5) as number;
      const dataScale = this.getValueByIndex(col, 6) as number;
      const nullable = this.getValueByIndex(col, 7) as string;
      const dataDefault = this.getValueByIndex(col, 8);

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
        name: String(columnName).toLowerCase(),
        type: this.formatDMType(
          dataType as string | number | null | undefined,
          dataLength,
          dataPrecision,
          dataScale
        ),
        nullable: nullable === 'Y',
        defaultValue: dataDefault ? String(dataDefault).trim() : undefined,
      });
    }

    // 按表名分组列注释
    // 列顺序: 0=OWNER, 1=TABLE_NAME, 2=COLUMN_NAME, 3=COMMENTS
    const commentsByTable = new Map<string, Map<string, string>>();
    for (const comment of allComments) {
      const owner = this.getValueByIndex(comment, 0) as string;
      const tableName = this.getValueByIndex(comment, 1) as string;
      const columnName = this.getValueByIndex(comment, 2) as string;
      const comments = this.getValueByIndex(comment, 3) as string;

      // 跳过无效数据
      if (!tableName || !columnName || !comments) {
        continue;
      }

      const tableKey = this.makeTableKey(owner, tableName, currentUser);

      if (!commentsByTable.has(tableKey)) {
        commentsByTable.set(tableKey, new Map());
      }
      commentsByTable.get(tableKey)!.set(
        String(columnName).toLowerCase(),
        String(comments)
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
    // 列顺序: 0=OWNER, 1=TABLE_NAME, 2=COLUMN_NAME, 3=POSITION
    const primaryKeysByTable = new Map<string, string[]>();
    for (const pk of allPrimaryKeys) {
      const owner = this.getValueByIndex(pk, 0) as string;
      const tableName = this.getValueByIndex(pk, 1) as string;
      const columnName = this.getValueByIndex(pk, 2) as string;

      // 跳过无效数据
      if (!tableName || !columnName) {
        continue;
      }

      const tableKey = this.makeTableKey(owner, tableName, currentUser);

      if (!primaryKeysByTable.has(tableKey)) {
        primaryKeysByTable.set(tableKey, []);
      }
      primaryKeysByTable.get(tableKey)!.push(String(columnName).toLowerCase());
    }

    // 按表名分组索引信息
    // 列顺序: 0=OWNER, 1=TABLE_NAME, 2=INDEX_NAME, 3=UNIQUENESS, 4=COLUMN_NAME, 5=COLUMN_POSITION
    const indexesByTable = new Map<string, Map<string, { columns: string[]; unique: boolean }>>();

    for (const idx of allIndexes) {
      const owner = this.getValueByIndex(idx, 0) as string;
      const tableName = this.getValueByIndex(idx, 1) as string;
      const indexName = this.getValueByIndex(idx, 2) as string;
      const uniqueness = this.getValueByIndex(idx, 3) as string;
      const columnName = this.getValueByIndex(idx, 4) as string;

      // 跳过无效数据
      if (!tableName || !indexName || !columnName) {
        continue;
      }

      // 跳过主键索引和系统索引
      const idxNameStr = String(indexName);
      if (idxNameStr.includes('PK_') || idxNameStr.startsWith('INDEX') || idxNameStr.includes('SYS_')) {
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
          unique: uniqueness === 'UNIQUE',
        });
      }

      tableIndexes.get(indexName)!.columns.push(String(columnName).toLowerCase());
    }

    // 按表名分组行数统计
    // 列顺序: 0=OWNER, 1=TABLE_NAME, 2=NUM_ROWS, 3=TABLE_COMMENT
    const rowsByTable = new Map<string, number>();
    const tableCommentsByTable = new Map<string, string>();
    for (const stat of allStats) {
      const owner = this.getValueByIndex(stat, 0) as string;
      const tableName = this.getValueByIndex(stat, 1) as string;
      const numRows = this.getValueByIndex(stat, 2);
      const tableComment = this.getValueByIndex(stat, 3) as string;
      if (tableName) {
        const tableKey = this.makeTableKey(owner, tableName, currentUser);
        rowsByTable.set(tableKey, Number(numRows) || 0);
        if (tableComment) {
          tableCommentsByTable.set(tableKey, tableComment);
        }
      }
    }

    // 按表名分组外键信息
    // 列顺序: 0=OWNER, 1=TABLE_NAME, 2=CONSTRAINT_NAME, 3=COLUMN_NAME, 4=REFERENCED_TABLE,
    //        5=REFERENCED_COLUMN, 6=DELETE_RULE, 7=REF_OWNER, 8=POSITION
    const foreignKeysByTable = new Map<string, Map<string, { columns: string[]; referencedTable: string; referencedColumns: string[]; onDelete?: string }>>();
    const relationships: RelationshipInfo[] = [];

    for (const fk of allForeignKeys) {
      const owner = this.getValueByIndex(fk, 0) as string;
      const tableName = this.getValueByIndex(fk, 1) as string;
      const constraintName = this.getValueByIndex(fk, 2) as string;
      const columnName = this.getValueByIndex(fk, 3) as string;
      const referencedTable = this.getValueByIndex(fk, 4) as string;
      const referencedColumn = this.getValueByIndex(fk, 5) as string;
      const deleteRule = this.getValueByIndex(fk, 6) as string;
      const refOwner = this.getValueByIndex(fk, 7) as string;

      if (!tableName || !constraintName) continue;

      const tableKey = this.makeTableKey(owner, tableName, currentUser);
      const refTableKey = this.makeTableKey(refOwner, referencedTable, currentUser);

      if (!foreignKeysByTable.has(tableKey)) {
        foreignKeysByTable.set(tableKey, new Map());
      }

      const tableForeignKeys = foreignKeysByTable.get(tableKey)!;

      if (!tableForeignKeys.has(constraintName)) {
        tableForeignKeys.set(constraintName, {
          columns: [],
          referencedTable: String(refTableKey).toLowerCase(),
          referencedColumns: [],
          onDelete: deleteRule,
        });
      }

      const fkInfo = tableForeignKeys.get(constraintName)!;
      fkInfo.columns.push(String(columnName).toLowerCase());
      fkInfo.referencedColumns.push(String(referencedColumn).toLowerCase());
    }

    // 生成全局关系视图
    for (const [tableKey, tableForeignKeys] of foreignKeysByTable.entries()) {
      for (const [constraintName, fkInfo] of tableForeignKeys.entries()) {
        relationships.push({
          fromTable: String(tableKey).toLowerCase(),
          fromColumns: fkInfo.columns,
          toTable: fkInfo.referencedTable,
          toColumns: fkInfo.referencedColumns,
          type: 'many-to-one',
          constraintName,
        });
      }
    }

    // 组装表信息
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
            referencedTable: fkData.referencedTable,
            referencedColumns: fkData.referencedColumns,
            onDelete: fkData.onDelete,
          });
        }
      }

      tableInfos.push({
        name: String(tableKey).toLowerCase(),
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
      databaseType: 'dm',
      databaseName,
      tables: tableInfos,
      version,
      relationships: relationships.length > 0 ? relationships : undefined,
    };
  }

  /**
   * 格式化达梦数据类型
   */
  private formatDMType(
    dataType: string | number | undefined | null,
    length?: number,
    precision?: number,
    scale?: number
  ): string {
    // 处理空值
    if (dataType === null || dataType === undefined) {
      return 'UNKNOWN';
    }

    // 达梦的 TYPE$ 可能是数字类型代码，需要转换
    const typeMap: Record<number, string> = {
      0: 'CHAR',
      1: 'VARCHAR',
      2: 'VARCHAR2',
      3: 'BIT',
      4: 'TINYINT',
      5: 'SMALLINT',
      6: 'INT',
      7: 'BIGINT',
      8: 'DECIMAL',
      9: 'FLOAT',
      10: 'DOUBLE',
      11: 'BLOB',
      12: 'DATE',
      13: 'TIME',
      14: 'DATETIME',
      15: 'TIMESTAMP',
      17: 'BINARY',
      18: 'VARBINARY',
      19: 'CLOB',
      21: 'TEXT',
      22: 'IMAGE',
      23: 'BFILE',
    };

    let typeName: string;
    if (typeof dataType === 'number') {
      typeName = typeMap[dataType] || `TYPE_${dataType}`;
    } else {
      typeName = String(dataType);
    }

    // 添加长度/精度信息
    switch (typeName) {
      case 'DECIMAL':
      case 'NUMBER':
      case 'NUMERIC':
        if (precision && scale && scale > 0) {
          return `${typeName}(${precision},${scale})`;
        } else if (precision) {
          return `${typeName}(${precision})`;
        } else if (length) {
          return `${typeName}(${length})`;
        }
        return typeName;

      case 'VARCHAR':
      case 'VARCHAR2':
      case 'CHAR':
        if (length) {
          return `${typeName}(${length})`;
        }
        return typeName;

      default:
        return typeName;
    }
  }

  /**
   * P0-3 + Bug #44: Override withTransaction to pin all statements to a single physical connection.
   *
   * v3.2.8 设计:用 BEGIN/COMMIT 包,期望 atomic。但 dmdb npm driver 发 BEGIN/COMMIT 时
   * 协议层异常(connection drop / [-2007] 语法错误 第 10 列[]),实测独立 SELECT/INSERT 都 OK,
   * 一旦 BEGIN/COMMIT 包就 ECONNRESET。原因推测 dmdb driver 在 autoCommit:false 模式下
   * 没正确发送 BEGIN,DM 把它当普通 SQL 解析 → "BEGIN" 5 字符 第 10 列 不存在。
   *
   * v3.2.8 妥协方案:去掉 BEGIN/COMMIT,只保单连接。每条 statement autoCommit:true
   * 独立提交。代价:execute_script 不再 atomic(部分失败部分成功)。
   * 文档化为 DM adapter limitation;真 atomic 需用 PL/SQL BEGIN...END;...;END; 单 block,
   * dmdb 协议层正常,但 splitStatements 对 PL/SQL BEGIN/END 的处理需后续验证。
   */
  async withTransaction<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    if (!this.pool) {
      throw new Error('数据库未连接');
    }
    const conn = await this.pool.getConnection();
    try {
      const tx: TransactionContext = {
        executeQuery: async (query: string, params?: unknown[]) => {
          const startTime = Date.now();
          let cleanQuery = query.trim();
          if (cleanQuery.endsWith(';')) cleanQuery = cleanQuery.slice(0, -1).trim();
          // Bug #44 fix:每个 statement 走 autoCommit:true 默认提交,
          // 避免 dmdb BEGIN/COMMIT 协议层 ECONNRESET。
          const result = await conn.execute(cleanQuery, params || []);
          const executionTime = Date.now() - startTime;
          if (result.rows && result.rows.length > 0) {
            const rows = result.rows.map((row: any) => {
              const lowerCaseRow: Record<string, unknown> = {};
              for (const [key, value] of Object.entries(row)) {
                lowerCaseRow[key.toLowerCase()] = value;
              }
              return lowerCaseRow;
            });
            return {
              rows,
              executionTime,
              metadata: { columnCount: result.metaData?.length || 0 },
            };
          } else if (result.rowsAffected !== undefined && result.rowsAffected > 0) {
            return { rows: [], affectedRows: result.rowsAffected, executionTime };
          } else {
            return { rows: [], executionTime };
          }
        },
      };
      const result = await fn(tx);
      return result;
    } catch (err) {
      throw err;
    } finally {
      try { await conn.close(); } catch { /* ignore */ }
    }
  }

  /**
   * P0-3 + Bug #44 fix: Override executeScript.
   * 使用 withTransaction(单连接 + 每句 autoCommit),multi-statement 可跑但非 atomic。
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
   * Bug #44 fix follow-up: Override executeBatch.
   * BaseAdapter.executeBatch 默认发 `BEGIN`/`COMMIT`/`ROLLBACK`(见 src/adapters/base.ts:215),
   * dmdb driver 在 DM 上发 BEGIN 立即 [-2007]/ECONNRESET(协议层 bug,跟 withTransaction 同根)。
   * 复用 withTransaction 的 skip-BEGIN 思路:每行 autoCommit:true 独立提交,非 atomic。
   */
  async executeBatch(sql: string, paramsList: unknown[][], options: ExecuteBatchOptions = {}): Promise<BatchResult> {
    if (options.useTransaction === false) {
      return super.executeBatch(sql, paramsList, { ...options, useTransaction: false });
    }
    // 强制走 autoCommit per-stmt 路径(走 super.useTransaction:false 分支 = BaseAdapter else 分支)
    return super.executeBatch(sql, paramsList, { ...options, useTransaction: false });
  }

  /**
   * 检查是否为写操作
   */
  isWriteOperation(query: string): boolean {
    // 首先使用通用的写操作检测
    if (checkWriteOperation(query)) {
      return true;
    }

    // 添加达梦特定的写操作检测（类似 Oracle）
    const trimmedQuery = query.trim().toUpperCase();

    // MERGE 语句（达梦支持）
    if (trimmedQuery.startsWith('MERGE')) {
      return true;
    }

    // PL/SQL 块（达梦兼容 Oracle PL/SQL）
    if (trimmedQuery.startsWith('BEGIN') || trimmedQuery.startsWith('DECLARE')) {
      return true;
    }

    // CALL 存储过程
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
    return 'dm';
  }

}
