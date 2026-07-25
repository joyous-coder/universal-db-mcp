/**
 * Database Service
 * Core business logic for database operations
 * Shared between MCP and HTTP modes
 */

import type { DbAdapter, DbConfig, QueryResult, SchemaInfo, TableInfo, EnumValuesResult, SampleDataResult } from '../types/adapter.js';
import { validateQuery, resolvePermissions, detectOperationType, DANGEROUS_ADMIN_KEYWORDS } from '../utils/safety.js';
import { isScriptLike } from '../utils/sql-detector.js';
import { splitStatements } from '../utils/sql-parser.js';
import { SchemaEnhancer, SchemaEnhancerConfig } from '../utils/schema-enhancer.js';
import { DataMasker, createDataMasker } from '../utils/data-masking.js';
import { metrics } from '../utils/metrics.js';
import type { RingBuffer } from '../utils/metrics-ringbuffer.js';
import type { QueryAnalyzer } from './query-analyzer.js';
import type { LintResult } from './query-analyzer-types.js';

/**
 * Schema 缓存配置
 */
export interface SchemaCacheConfig {
  /** 缓存过期时间（毫秒），默认 1 分钟 */
  ttl: number;
  /** 是否启用缓存，默认 true */
  enabled: boolean;
}

/**
 * Schema 增强配置（导出供外部使用）
 */
export type { SchemaEnhancerConfig };

/**
 * Schema 缓存统计信息
 */
export interface SchemaCacheStats {
  /** 缓存是否有效 */
  isCached: boolean;
  /** 缓存时间 */
  cachedAt: Date | null;
  /** 缓存过期时间 */
  expiresAt: Date | null;
  /** 缓存命中次数 */
  hitCount: number;
  /** 缓存未命中次数 */
  missCount: number;
}

/**
 * 默认缓存配置
 */
const DEFAULT_CACHE_CONFIG: SchemaCacheConfig = {
  ttl: 60 * 1000, // 1 minute (P1-3: reduced from 5)
  enabled: true,
};

/**
 * Database Service Class
 * Encapsulates all database operations with validation and error handling
 */
export class DatabaseService {
  private adapter: DbAdapter;
  private config: DbConfig;

  // Schema 缓存相关
  private schemaCache: SchemaInfo | null = null;
  private schemaCacheTime: number = 0;
  private cacheConfig: SchemaCacheConfig;
  private cacheHitCount: number = 0;
  private cacheMissCount: number = 0;

  // P1-5: query timeout (default 30s)
  private queryTimeoutMs: number = 30000;
  // P1-6: slow query threshold (default 5s)
  private slowQueryThresholdMs: number = 5000;
  // v2.16: slow query ring buffer
  private slowBufferSize: number = 100;
  private slowQueries: RingBuffer<{ ts: string; db: string; kind: string; seconds: number; sql: string; error: string | null; }>;
  // v2.17: query analyzer (optional)
  private queryAnalyzer: QueryAnalyzer | null = null;
  // v2.19: active profile provider — nullptr means legacy single-DB mode.
  private activeProfileProvider: (() => string | null) | null = null;

  // Schema 增强器
  private schemaEnhancer: SchemaEnhancer;

  // 数据脱敏器
  private dataMasker: DataMasker;

  constructor(
    adapter: DbAdapter,
    config: DbConfig,
    options?: Partial<{
      slowQueryThresholdMs: number;
      slowBufferSize: number;
    }> & Partial<SchemaCacheConfig>,
    enhancerConfig?: Partial<SchemaEnhancerConfig>
  ) {
    this.adapter = adapter;
    this.config = config;
    this.cacheConfig = { ...DEFAULT_CACHE_CONFIG, ...(options ?? {}) };
    if (options?.slowQueryThresholdMs !== undefined) this.slowQueryThresholdMs = options.slowQueryThresholdMs;
    if (options?.slowBufferSize !== undefined) this.slowBufferSize = options.slowBufferSize;
    this.slowQueries = metrics.ringBuffer('db_slow_queries', this.slowBufferSize);
    this.schemaEnhancer = new SchemaEnhancer(enhancerConfig);
    this.dataMasker = createDataMasker(true);
  }

  /**
   * v2.17: attach a QueryAnalyzer (optional). When set, execute_query response
   * includes a `lint` field, and queries are recorded to history.db.
   */
  setQueryAnalyzer(qa: QueryAnalyzer | null): void {
    this.queryAnalyzer = qa;
    // v2.19: propagate active-profile provider to the analyzer so
    // recordQuery automatically tags history rows.
    if (qa && this.activeProfileProvider) {
      qa.setProfileProvider(this.activeProfileProvider);
    }
  }

  /**
   * v2.19: register a callback returning the currently active profile name
   * (or `null` for legacy single-DB mode). The DatabaseService forwards
   * this to its QueryAnalyzer (when one is registered), so any history
   * recorded while executing a query automatically gets profile_name
   * populated. Pass `null` to clear.
   */
  setActiveProfileProvider(fn: (() => string | null) | null): void {
    this.activeProfileProvider = fn;
    if (fn && this.queryAnalyzer) {
      this.queryAnalyzer.setProfileProvider(fn);
    }
  }

  /** v2.19: returns the registered active-profile provider (for diagnostics). */
  getActiveProfileProvider(): (() => string | null) | null {
    return this.activeProfileProvider;
  }

  /**
   * Execute a query with validation
   *
   * 重要: query timeout 为"best-effort"。
   * - 调用方的 Promise 会在达到超时时间后立即 reject,
   *   这是保证 UI/上层不会无限等待的唯一手段。
   * - 但是,底层驱动(mysql2 / pg / mssql / oracledb 等)的 SQL 执行
   *   在原生层是同步或独立任务的,我们无法用可移植的方式真正取消它。
   * - 因此达到超时后,DB 端的语句**可能仍在执行** ——
   *   写操作尤其需要注意: BEGIN/COMMIT 仍然会落到连接池中。
   * - 若某个应用场景需要真正可取消的查询,请使用支持查询取消的专用 API。
   */
  async executeQuery(query: string, params?: unknown[]): Promise<QueryResult> {
    // Validate query safety
    this.validateQuery(query);

    // v3.2.3 Bug #6 fix: if SQL is multi-statement (PL/SQL block, BEGIN...END, etc.),
    // DO NOT silently route to executeScript — that path runs the statements but
    // returns an aggregated response (statementCount:1, lastResult:{}) that hides
    // changes from the caller. Instead, reject with a clear error pointing to the
    // dedicated execute_script tool. Users who actually want multi-stmt semantics
    // can call execute_script explicitly, which returns a structured per-stmt response.
    if (isScriptLike(query)) {
      const permissions = resolvePermissions(this.config);
      throw new Error(
        `检测到 PL/SQL 块或多语句脚本。execute_query 仅支持单语句。\n` +
        `请改用 execute_script 工具(需要 ${permissions.includes('script') ? '' : 'script 权限' + (permissions.includes('script') ? '' : '、')}并确保 connect_database 时 permissionMode='full')。`
      );
    }

    // Execute query with timeout + slow log (P1-5, P1-6) + metrics (v2.16)
    const start = Date.now();
    const dbType = this.config.type;
    const kind = (query.trim().split(/\s+/)[0] ?? 'unknown').toLowerCase();
    let result: QueryResult;
    let errorCode: string | null = null;
    try {
      result = await this.withTimeout(
        this.adapter.executeQuery(query, params),
        this.queryTimeoutMs,
        'executeQuery'
      );
    } catch (err) {
      errorCode = (err as { code?: string })?.code ?? 'UNKNOWN';
      metrics.counter('db_query_errors_total', 'Query errors by code').inc({ db: dbType, kind, code: errorCode });
      throw err;
    }
    const elapsed = Date.now() - start;
    metrics.counter('db_query_total', 'Total queries').inc({ db: dbType, kind, status: 'ok' });
    metrics.histogram('db_query_seconds', 'Query latency (seconds)').observe({ db: dbType, kind }, elapsed / 1000);
    if (elapsed > this.slowQueryThresholdMs) {
      console.error(`[SLOW QUERY] ${elapsed}ms: ${query.substring(0, 200)}`);
      metrics.counter('db_slow_queries_total', 'Slow queries').inc({ db: dbType, kind });
      const truncated = query.length > 4000 ? query.slice(0, 4000) + ' /* truncated */' : query;
      this.slowQueries.push({
        ts: new Date().toISOString(),
        db: dbType,
        kind,
        seconds: elapsed / 1000,
        sql: truncated,
        error: errorCode,
      });
    }

    // v2.17: lint (advisory) + recordQuery (fire-and-forget)
    if (this.queryAnalyzer) {
      const lint = this.queryAnalyzer.lint(query);
      (result as QueryResult & { lint?: LintResult }).lint = lint;
      this.queryAnalyzer.recordQuery({
        ts: new Date().toISOString(),
        db: dbType,
        kind,
        sql: query,
        params: params ? JSON.stringify(params) : null,
        duration_ms: elapsed,
        rows: result.rows?.length ?? null,
        error: null,
        error_code: null,
      }).catch(err => console.error('[queryAnalyzer] recordQuery failed:', err));
    }

    return result;
  }

  /**
   * Wrap a promise with a hard timeout.
   *
   * Limitations (see executeQuery doc comment):
   * - Only the **caller's wait** is bounded; the underlying DB query
   *   is NOT cancelled when the timer fires. Drivers like mysql2 / pg /
   *   mssql / oracledb do not expose a portable query cancellation API,
   *   so we accept the trade-off (bounded wait, possibly-continued DB work).
   * - The "best-effort" timeout is still useful: without it, a hanging
   *   connection would stall the MCP request indefinitely.
   */
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

  /**
   * Execute a multi-statement script or PL block.
   * Requires 'script' permission.
   */
  async executeScript(query: string, options?: { useTransaction?: boolean; maxStatements?: number }): Promise<QueryResult> {
    const permissions = resolvePermissions(this.config);
    if (!permissions.includes('script')) {
      throw new Error(
        'execute_script 需要 script 权限。当前权限: ' + permissions.join(', ') +
        '\n如何启用:connect_database 时设置 permissions 包含 script,或使用 --permissions script'
      );
    }

    // SECURITY: validate permissions PER STATEMENT, not just once on the whole script.
    // Without this, a malicious script like `SELECT 1; DROP TABLE victim;` would
    // bypass DDL permission checks (only the first SELECT is classified).
    const dialect = (this.adapter as any).getDialect?.() ?? 'mysql';
    const statements = splitStatements(query, dialect).filter((s: string) => s.trim());

    // Defense-in-depth: check for dangerous admin keywords (GRANT/REVOKE/etc.)
    // that detectOperationType doesn't catch but should require ddl permission.
    for (let i = 0; i < statements.length; i++) {
      const upperStmt = statements[i].trim().toUpperCase();
      const firstWord = upperStmt.split(/\s+/)[0];
      if (DANGEROUS_ADMIN_KEYWORDS.includes(firstWord) && !permissions.includes('ddl')) {
        throw new Error(
          `❌ 语句 #${i + 1} 操作被拒绝: ${firstWord} 需要 ddl 权限。\n` +
          `当前权限: ${permissions.join(', ')}。`
        );
      }
    }

    // Per-statement permission check (handles INSERT/UPDATE/DELETE/DDL)
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      const detected = detectOperationType(stmt);
      if (detected && !permissions.includes(detected.type)) {
        throw new Error(
          `❌ 语句 #${i + 1} 操作被拒绝: ${detected.keyword} 需要 ${detected.type} 权限。\n` +
          `当前权限: ${permissions.join(', ')}。\n` +
          `如果这是您预期的操作,请使用包含该权限的 custom permissions。`
        );
      }
    }

    const adapter = this.adapter as any;
    if (typeof adapter.executeScript !== 'function') {
      throw new Error('当前数据库适配器不支持 executeScript');
    }
    // v2.16: metrics wrapping
    const start = Date.now();
    const dbType = this.config.type;
    const result = await adapter.executeScript(query, options);
    const elapsed = Date.now() - start;
    metrics.counter('db_query_total', 'Total queries').inc({ db: dbType, kind: 'script', status: 'ok' });
    metrics.histogram('db_query_seconds', 'Query latency (seconds)').observe({ db: dbType, kind: 'script' }, elapsed / 1000);
    if (elapsed > this.slowQueryThresholdMs) {
      metrics.counter('db_slow_queries_total', 'Slow queries').inc({ db: dbType, kind: 'script' });
    }
    return result;
  }

  /**
   * Execute a batch DML operation.
   * Requires 'batch' permission.
   */
  async executeBatch(sql: string, paramsList: unknown[][], options?: { useTransaction?: boolean; maxBatchSize?: number }): Promise<{ affectedRowsPerStatement: number[]; totalAffectedRows: number; executionTime?: number }> {
    const permissions = resolvePermissions(this.config);
    if (!permissions.includes('batch')) {
      throw new Error(
        'execute_batch 需要 batch 权限。当前权限: ' + permissions.join(', ') +
        '\n如何启用:connect_database 时设置 permissions 包含 batch,或使用 --permissions batch'
      );
    }

    validateQuery(sql, this.config);

    const adapter = this.adapter as any;
    if (typeof adapter.executeBatch !== 'function') {
      throw new Error('当前数据库适配器不支持 executeBatch');
    }
    // v2.16: metrics wrapping
    const start = Date.now();
    const dbType = this.config.type;
    const result = await adapter.executeBatch(sql, paramsList, options);
    const elapsed = Date.now() - start;
    metrics.counter('db_query_total', 'Total queries').inc({ db: dbType, kind: 'batch', status: 'ok' });
    metrics.histogram('db_query_seconds', 'Query latency (seconds)').observe({ db: dbType, kind: 'batch' }, elapsed / 1000);
    if (elapsed > this.slowQueryThresholdMs) {
      metrics.counter('db_slow_queries_total', 'Slow queries').inc({ db: dbType, kind: 'batch' });
    }
    return result;
  }

  /**
   * Generate and insert sample data based on table structure + LLM-provided rules.
   * Requires 'insert' + 'batch' permissions.
   */
  async generateAndInsertSampleData(
    tableName: string,
    rowCount: number,
    options?: {
      seed?: number;
      rules?: any[];
      columnOverrides?: Record<string, unknown>;
      columns?: string[];
      overwrite?: boolean;
    }
  ): Promise<{ insertedRows: number; tableName: string; columns: string[]; executionTime: number }> {
    const permissions = resolvePermissions(this.config);
    if (!permissions.includes('insert') || !permissions.includes('batch')) {
      throw new Error('generate_sample_data 需要 insert + batch 权限');
    }

    const safeCount = Math.min(Math.max(1, rowCount), 10000);

    // Get table info
    const tableInfo = await this.getTableInfo(tableName);
    const columnsToInsert = options?.columns || tableInfo.columns.map(c => c.name);

    // Generate data using SampleDataGenerator
    const { SampleDataGenerator } = await import('../utils/sample-data-generator.js');
    const generator = new SampleDataGenerator({ seed: options?.seed });
    const rowsToInsert: unknown[][] = [];

    for (let i = 0; i < safeCount; i++) {
      const rowContext: Record<string, unknown> = {};
      const row: unknown[] = [];

      for (const colName of columnsToInsert) {
        const col = tableInfo.columns.find(c => c.name === colName);
        if (!col) continue;

        // Find applicable rule (exact columnName or columnNamePattern)
        const rule = options?.rules?.find((r: any) => {
          if (r.match?.columnName === colName) return true;
          if (r.match?.columnNamePattern && new RegExp(r.match.columnNamePattern).test(colName)) return true;
          return false;
        });

        const value = generator.generateValue(col, {
          overrides: options?.columnOverrides,
          rule,
          rowContext,
        }, i);

        // v3.2.6 Bug #25 fix: node:sqlite rejects binding `undefined` to ? placeholders.
        // Auto-increment columns return undefined from generator; convert to null so
        // INSERT works (sqlite treats null as new auto-increment value).
        row.push(value === undefined ? null : value);
        rowContext[colName] = value;
      }
      rowsToInsert.push(row);
    }

    // Overwrite
    if (options?.overwrite) {
      const tableIdent = this.quoteIdentifier(tableName);
      await this.executeQuery(`TRUNCATE TABLE ${tableIdent}`);
    }

    // Build INSERT SQL using dialect-correct placeholder syntax (?  vs $1, $2 / @p1, @p2 ...)
    const placeholders = this.buildPlaceholderString(columnsToInsert.length);
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

  /**
   * Execute SQL from a file path.
   * Requires 'script' permission and file path to be in configured allowlist.
   */
  async executeSqlFile(options: {
    filePath: string;
    useTransaction?: boolean;
    maxStatements?: number;
  }): Promise<QueryResult> {
    const permissions = resolvePermissions(this.config);
    if (!permissions.includes('script')) {
      throw new Error('execute_sql_file 需要 script 权限。当前权限: ' + permissions.join(', '));
    }

    const allowedDirs = (this.config as any).allowedSqlFilePaths as string[] | undefined;
    if (!allowedDirs || allowedDirs.length === 0) {
      throw new Error(
        'execute_sql_file 不可用:未配置 DB_ALLOWED_FILE_PATHS。\n' +
        '请在 .mcp.json 的 env 中设置 DB_ALLOWED_FILE_PATHS=<comma-separated-dirs>'
      );
    }

    // Lazy import to avoid circular deps
    const { resolveAndValidatePath } = await import('../utils/path-guard.js');
    const fs = await import('node:fs');

    const realPath = resolveAndValidatePath(options.filePath, allowedDirs, process.cwd());

    const stats = fs.statSync(realPath);
    const maxFileSize = 50 * 1024 * 1024; // 50MB
    if (stats.size > maxFileSize) {
      throw new Error(`File too large: ${stats.size} bytes (max ${maxFileSize})`);
    }

    const content = fs.readFileSync(realPath, 'utf-8');

    return this.executeScript(content, {
      useTransaction: options.useTransaction,
      maxStatements: options.maxStatements,
    });
  }

  /**
   * Get complete database schema
   * @param forceRefresh - 是否强制刷新缓存，忽略现有缓存
   */
  async getSchema(forceRefresh: boolean = false): Promise<SchemaInfo> {
    const now = Date.now();

    // 检查是否可以使用缓存
    if (
      !forceRefresh &&
      this.cacheConfig.enabled &&
      this.schemaCache &&
      (now - this.schemaCacheTime) < this.cacheConfig.ttl
    ) {
      this.cacheHitCount++;
      console.error(`📦 Schema 缓存命中 (命中率: ${this.getCacheHitRate()}%)`);
      return this.schemaCache;
    }

    // 缓存未命中或已过期，重新获取
    this.cacheMissCount++;
    console.error(`🔄 正在获取数据库 Schema${forceRefresh ? ' (强制刷新)' : this.schemaCache ? ' (缓存已过期)' : ' (首次加载)'}...`);

    const startTime = Date.now();
    const schema = await this.adapter.getSchema();
    const elapsed = Date.now() - startTime;

    // 增强 Schema 信息（隐式关系推断、关系类型细化）
    const enhancedSchema = this.enhanceSchema(schema);

    // 更新缓存
    if (this.cacheConfig.enabled) {
      this.schemaCache = enhancedSchema;
      this.schemaCacheTime = now;

      // 统计增强信息
      const explicitRelCount = schema.relationships?.length || 0;
      const totalRelCount = enhancedSchema.relationships?.length || 0;
      const inferredRelCount = totalRelCount - explicitRelCount;

      console.error(`✅ Schema 已缓存 (获取耗时: ${elapsed}ms, 表数量: ${enhancedSchema.tables.length}, 显式关系: ${explicitRelCount}, 推断关系: ${inferredRelCount}, 缓存有效期: ${this.cacheConfig.ttl / 1000}秒)`);
    }

    return enhancedSchema;
  }

  /**
   * 增强 Schema 信息
   * - 为现有外键关系添加 source 标记
   * - 推断隐式关系
   * - 细化关系类型
   */
  private enhanceSchema(schema: SchemaInfo): SchemaInfo {
    // 对于 NoSQL 数据库（Redis、MongoDB），不进行关系增强
    if (schema.databaseType === 'redis' || schema.databaseType === 'mongodb') {
      return schema;
    }

    // 增强关系信息
    const existingRelationships = schema.relationships || [];
    const enhancedRelationships = this.schemaEnhancer.enhanceRelationships(
      schema.tables,
      existingRelationships
    );

    return {
      ...schema,
      relationships: enhancedRelationships.length > 0 ? enhancedRelationships : undefined,
    };
  }

  /**
   * Get information about a specific table
   * @param tableName - 表名（支持 schema.table_name 格式）
   * @param forceRefresh - 是否强制刷新缓存
   */
  async getTableInfo(tableName: string, forceRefresh: boolean = false): Promise<TableInfo> {
    const schema = await this.getSchema(forceRefresh);

    // 1. 精确匹配 name 字段（已包含 schema 前缀）
    let table = schema.tables.find(t =>
      t.name === tableName ||
      t.name.toLowerCase() === tableName.toLowerCase()
    );

    // 2. 如果没找到且包含点号，尝试用 schema + 表名组合匹配
    if (!table && tableName.includes('.')) {
      const dotIndex = tableName.indexOf('.');
      const schemaName = tableName.substring(0, dotIndex);
      const tblName = tableName.substring(dotIndex + 1);
      table = schema.tables.find(t =>
        t.schema?.toLowerCase() === schemaName.toLowerCase() &&
        (t.name === tblName || t.name.toLowerCase() === tblName.toLowerCase() ||
         t.name.toLowerCase() === tableName.toLowerCase())
      );
    }

    // 3. 如果还没找到，尝试只匹配表名部分（不含 schema 前缀）
    if (!table) {
      const baseName = tableName.includes('.') ? tableName.substring(tableName.indexOf('.') + 1) : tableName;
      const matches = schema.tables.filter(t => {
        const tBaseName = t.name.includes('.') ? t.name.substring(t.name.indexOf('.') + 1) : t.name;
        return tBaseName.toLowerCase() === baseName.toLowerCase();
      });
      if (matches.length === 1) {
        table = matches[0];
      }
    }

    if (!table) {
      throw new Error(`表 "${tableName}" 不存在`);
    }

    return table;
  }

  /**
   * List all tables in the database
   * @param forceRefresh - 是否强制刷新缓存
   */
  async listTables(forceRefresh: boolean = false): Promise<string[]> {
    const schema = await this.getSchema(forceRefresh);
    return schema.tables.map(t => t.name);
  }

  /**
   * Test database connection
   */
  async testConnection(): Promise<boolean> {
    try {
      // Try a simple query to test connection
      await this.adapter.executeQuery('SELECT 1');
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 清除 Schema 缓存
   */
  clearSchemaCache(): void {
    this.schemaCache = null;
    this.schemaCacheTime = 0;
    console.error('🗑️ Schema 缓存已清除');
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats(): SchemaCacheStats {
    const now = Date.now();
    const isCached = this.schemaCache !== null && (now - this.schemaCacheTime) < this.cacheConfig.ttl;

    return {
      isCached,
      cachedAt: this.schemaCacheTime > 0 ? new Date(this.schemaCacheTime) : null,
      expiresAt: this.schemaCacheTime > 0 ? new Date(this.schemaCacheTime + this.cacheConfig.ttl) : null,
      hitCount: this.cacheHitCount,
      missCount: this.cacheMissCount,
    };
  }

  /**
   * 获取缓存命中率
   */
  getCacheHitRate(): string {
    const total = this.cacheHitCount + this.cacheMissCount;
    if (total === 0) return '0.00';
    return ((this.cacheHitCount / total) * 100).toFixed(2);
  }

  /**
   * 更新缓存配置
   */
  updateCacheConfig(config: Partial<SchemaCacheConfig>): void {
    this.cacheConfig = { ...this.cacheConfig, ...config };
    console.error(`⚙️ 缓存配置已更新: TTL=${this.cacheConfig.ttl}ms, 启用=${this.cacheConfig.enabled}`);
  }

  /**
   * 更新 Schema 增强配置
   */
  updateEnhancerConfig(config: Partial<SchemaEnhancerConfig>): void {
    this.schemaEnhancer.updateConfig(config);
    // 清除缓存以便下次获取时应用新配置
    this.clearSchemaCache();
    console.error(`⚙️ Schema 增强配置已更新`);
  }

  /**
   * 获取 Schema 增强配置
   */
  getEnhancerConfig(): SchemaEnhancerConfig {
    return this.schemaEnhancer.getConfig();
  }

  /**
   * Validate query against write permissions
   */
  private validateQuery(query: string): void {
    validateQuery(query, this.config);
  }

  /**
   * Get the underlying adapter
   */
  getAdapter(): DbAdapter {
    return this.adapter;
  }

  /**
   * Get the configuration
   */
  getConfig(): DbConfig {
    return this.config;
  }

  /**
   * 获取指定列的枚举值
   * 用于帮助 LLM 了解 status、type 等枚举列的所有可能值
   *
   * @param tableName - 表名
   * @param columnName - 列名
   * @param limit - 最大返回数量（默认 50，最大 100）
   * @param includeCount - 是否包含每个值的出现次数（默认 false）
   * @returns 枚举值查询结果
   */
  async getEnumValues(
    tableName: string,
    columnName: string,
    limit: number = 50,
    includeCount: boolean = false
  ): Promise<EnumValuesResult> {
    // 检查是否为 NoSQL 数据库
    if (this.config.type === 'redis' || this.config.type === 'mongodb') {
      throw new Error(
        `${this.config.type} 是 NoSQL 数据库，不支持 get_enum_values 工具。` +
        `请使用 execute_query 工具直接查询。`
      );
    }

    // 1. 验证表和列是否存在
    const tableInfo = await this.getTableInfo(tableName);
    const column = tableInfo.columns.find(
      c => c.name.toLowerCase() === columnName.toLowerCase()
    );

    if (!column) {
      throw new Error(
        `列 "${columnName}" 在表 "${tableName}" 中不存在。` +
        `该表的列有: ${tableInfo.columns.map(c => c.name).join(', ')}`
      );
    }

    // 使用实际的列名（保持原始大小写）
    const actualColumnName = column.name;
    const actualTableName = tableInfo.name;

    // 2. 限制返回数量（安全限制）
    const safeLimit = Math.min(Math.max(1, limit), 100);

    // 3. 构建查询 SQL
    let query: string;
    if (includeCount) {
      query = this.buildEnumValuesQueryWithCount(actualTableName, actualColumnName, safeLimit + 1);
    } else {
      query = this.buildEnumValuesQuery(actualTableName, actualColumnName, safeLimit + 1);
    }

    // 4. 执行查询
    const result = await this.adapter.executeQuery(query);

    // 5. 处理结果
    const hasMore = result.rows.length > safeLimit;
    const rows = hasMore ? result.rows.slice(0, safeLimit) : result.rows;

    const values = rows.map(row => row.value as string | number | null);
    const valueCounts = includeCount
      ? Object.fromEntries(rows.map(row => [String(row.value), Number(row.count)]))
      : undefined;

    return {
      tableName: actualTableName,
      columnName: actualColumnName,
      values,
      totalCount: values.length,
      isEnum: !hasMore,
      valueCounts,
      columnType: column.type,
    };
  }

  /**
   * 获取表的示例数据（已脱敏）
   * 用于帮助 LLM 理解数据格式（日期格式、ID 格式等）
   *
   * @param tableName - 表名
   * @param columns - 要查看的列（可选，默认全部）
   * @param limit - 返回行数（默认 3，最大 10）
   * @returns 示例数据查询结果
   */
  async getSampleData(
    tableName: string,
    columns?: string[],
    limit: number = 3
  ): Promise<SampleDataResult> {
    // 检查是否为 NoSQL 数据库
    if (this.config.type === 'redis' || this.config.type === 'mongodb') {
      throw new Error(
        `${this.config.type} 是 NoSQL 数据库，不支持 get_sample_data 工具。` +
        `请使用 execute_query 工具直接查询。`
      );
    }

    // 1. 验证表是否存在
    const tableInfo = await this.getTableInfo(tableName);
    const actualTableName = tableInfo.name;

    // 2. 验证并确定要查询的列
    let selectedColumns: string[];
    if (columns && columns.length > 0) {
      const validColumns = tableInfo.columns.map(c => c.name.toLowerCase());
      const invalidColumns = columns.filter(c => !validColumns.includes(c.toLowerCase()));
      if (invalidColumns.length > 0) {
        throw new Error(
          `列 "${invalidColumns.join(', ')}" 在表 "${tableName}" 中不存在。` +
          `该表的列有: ${tableInfo.columns.map(c => c.name).join(', ')}`
        );
      }
      // 使用实际的列名（保持原始大小写）
      selectedColumns = columns.map(c => {
        const found = tableInfo.columns.find(col => col.name.toLowerCase() === c.toLowerCase());
        return found ? found.name : c;
      });
    } else {
      // 默认查询所有列
      selectedColumns = tableInfo.columns.map(c => c.name);
    }

    // 3. 限制返回行数（安全限制）
    const safeLimit = Math.min(Math.max(1, limit), 10);

    // 4. 构建查询 SQL
    const query = this.buildSampleDataQuery(actualTableName, selectedColumns, safeLimit);

    // 5. 执行查询
    const result = await this.adapter.executeQuery(query);

    // 6. 脱敏处理
    const { maskedRows, maskedColumns } = this.dataMasker.maskRows(result.rows);

    return {
      tableName: actualTableName,
      columns: selectedColumns,
      rows: maskedRows,
      rowCount: maskedRows.length,
      masked: maskedColumns.length > 0,
      maskedColumns: maskedColumns.length > 0 ? maskedColumns : undefined,
    };
  }

  /**
   * 构建枚举值查询 SQL（不含计数）
   *
   * P1: 使用抽样策略避免对大表做完整的 DISTINCT 扫描。
   * 先随机抽样 10000 行（按 RANDOM()/RAND() 排序后取 LIMIT），
   * 再对这些样本做 DISTINCT 并按值排序，最后取所需 limit。
   *
   * 注意:抽样仅在支持 RAND()/RANDOM() + LIMIT 子查询的方言上启用:
   *   MySQL / TiDB / OceanBase / PolarDB / GoldenDB / PostgreSQL / SQLite。
   * Oracle 和 SQL Server 不能在子查询中使用 RANDOM()/RAND() 或 LIMIT,
   * 因此回退到简单的全表 DISTINCT(稍慢但是语义正确)。
   */
  private buildEnumValuesQuery(tableName: string, columnName: string, limit: number): string {
    const quotedTable = this.quoteIdentifier(tableName);
    const quotedColumn = this.quoteIdentifier(columnName);

    // 抽样策略仅对支持 RAND()/RANDOM() + LIMIT 子查询的方言可用
    if (!this.supportsEnumSampling()) {
      // Oracle / SQL Server: 回退到简单 DISTINCT,无抽样
      const baseQuery = `SELECT DISTINCT ${quotedColumn} as value FROM ${quotedTable} WHERE ${quotedColumn} IS NOT NULL ORDER BY ${quotedColumn}`;
      return this.appendLimit(baseQuery, limit);
    }

    // 抽样大小：固定 10000 行（足以覆盖大多数枚举分布）
    const sampleSize = 10000;
    // 抽样随机函数：MySQL 系用 RAND()，其他用 RANDOM()
    const randFunc = this.useMySQLRandom() ? 'RAND()' : 'RANDOM()';

    const sampleSubquery = `SELECT ${quotedColumn} FROM ${quotedTable} WHERE ${quotedColumn} IS NOT NULL ORDER BY ${randFunc} LIMIT ${sampleSize}`;

    // 外层：基于样本取 DISTINCT 并排序；DISTINCT 在样本中已经去重，但 ORDER BY 需要确定性，
    // 所以显式排序后再 LIMIT；appendLimit 处理各数据库的 LIMIT/FETCH/TOP 语法差异
    // v3.2.8 Bug #28 fix: MySQL requires derived tables to have an alias (FROM (subq) AS t)
    const baseQuery = `SELECT DISTINCT ${quotedColumn} as value FROM (${sampleSubquery}) AS t ORDER BY ${quotedColumn}`;

    return this.appendLimit(baseQuery, limit);
  }

  /**
   * 是否对当前方言启用 get_enum_values 的随机抽样优化。
   * 返回 false 时,buildEnumValuesQuery 回退到简单 DISTINCT。
   */
  private supportsEnumSampling(): boolean {
    const dbType = this.config.type;
    switch (dbType) {
      case 'mysql':
      case 'tidb':
      case 'oceanbase':
      case 'polardb':
      case 'goldendb':
      case 'postgres':
      case 'sqlite':
        return true;
      // Oracle / DM / Kingbase / GaussDB / Vastbase / HighGo / ClickHouse / SQL Server:
      // 由于 RAND() 不可用或子查询 + LIMIT 语义不同,禁用抽样
      default:
        return false;
    }
  }

  /**
   * 判断当前数据库是否使用 MySQL 风格的 RAND()（而不是 RANDOM()）。
   * MySQL / TiDB / OceanBase / PolarDB / GoldenDB 兼容 MySQL RAND()。
   */
  private useMySQLRandom(): boolean {
    const dbType = this.config.type;
    switch (dbType) {
      case 'mysql':
      case 'tidb':
      case 'oceanbase':
      case 'polardb':
      case 'goldendb':
        return true;
      default:
        return false;
    }
  }

  /**
   * 构建枚举值查询 SQL（含计数）
   */
  private buildEnumValuesQueryWithCount(tableName: string, columnName: string, limit: number): string {
    const quotedTable = this.quoteIdentifier(tableName);
    const quotedColumn = this.quoteIdentifier(columnName);

    const baseQuery = `SELECT ${quotedColumn} as value, COUNT(*) as count FROM ${quotedTable} WHERE ${quotedColumn} IS NOT NULL GROUP BY ${quotedColumn} ORDER BY count DESC`;

    return this.appendLimit(baseQuery, limit);
  }

  /**
   * 构建示例数据查询 SQL
   */
  private buildSampleDataQuery(tableName: string, columns: string[], limit: number): string {
    const quotedTable = this.quoteIdentifier(tableName);
    const quotedColumns = columns.map(c => this.quoteIdentifier(c)).join(', ');

    const baseQuery = `SELECT ${quotedColumns} FROM ${quotedTable}`;

    return this.appendLimit(baseQuery, limit);
  }

  /**
   * 引用标识符（表名、列名）
   * 根据数据库类型使用不同的引号
   * 支持 schema.table 格式：自动拆分并分别引用
   */
  private quoteIdentifier(identifier: string): string {
    // 检查是否包含 schema 限定（schema.table 格式）
    const dotIndex = identifier.indexOf('.');
    if (dotIndex > 0) {
      const schema = identifier.substring(0, dotIndex);
      const name = identifier.substring(dotIndex + 1);
      return `${this.quoteSimpleIdentifier(schema)}.${this.quoteSimpleIdentifier(name)}`;
    }

    return this.quoteSimpleIdentifier(identifier);
  }

  /**
   * 引用单个标识符（不含 schema 前缀）
   */
  private quoteSimpleIdentifier(identifier: string): string {
    const dbType = this.config.type;

    switch (dbType) {
      case 'mysql':
      case 'tidb':
      case 'oceanbase':
      case 'polardb':
      case 'goldendb':
        // MySQL 系使用反引号
        return `\`${identifier}\``;

      case 'sqlserver':
        // SQL Server 使用方括号
        return `[${identifier}]`;

      default:
        // PostgreSQL, Oracle, SQLite, 达梦, KingbaseES, GaussDB, Vastbase, HighGo, ClickHouse 等使用双引号
        return `"${identifier}"`;
    }
  }

  /**
   * 添加 LIMIT 子句
   * 根据数据库类型使用不同的语法
   */
  private appendLimit(query: string, limit: number): string {
    const dbType = this.config.type;

    switch (dbType) {
      case 'oracle':
      case 'dm':
        // Oracle/达梦 使用 FETCH FIRST
        return `${query} FETCH FIRST ${limit} ROWS ONLY`;

      case 'sqlserver':
        // SQL Server 使用 TOP（需要插入到 SELECT 后面）
        return query.replace(/^SELECT/i, `SELECT TOP ${limit}`);

      default:
        // MySQL, PostgreSQL, SQLite, TiDB, ClickHouse 等使用 LIMIT
        return `${query} LIMIT ${limit}`;
    }
  }

  /**
   * 生成 INSERT 占位符字符串
   *
   * 不同方言的参数占位符语法不同:
   *   - MySQL / Oracle / SQLite / DM / Kingbase / GaussDB / Vastbase / HighGo /
   *     ClickHouse / OceanBase / TiDB / PolarDB / GoldenDB: ? (anonymous)
   *   - PostgreSQL: $1, $2, ...
   *   - SQL Server: @p1, @p2, ...
   *
   * 这里生成的占位符串会被直接拼接到 "( ... )" 中,例如 "(?, ?, ?)" / "($1, $2, $3)"。
   */
  private buildPlaceholderString(columnCount: number): string {
    const dbType = this.config.type;

    if (dbType === 'postgres') {
      return Array.from({ length: columnCount }, (_, i) => `$${i + 1}`).join(', ');
    }
    if (dbType === 'sqlserver') {
      return Array.from({ length: columnCount }, (_, i) => `@p${i + 1}`).join(', ');
    }
    // MySQL / Oracle / SQLite / ClickHouse / DM / Kingbase / GaussDB /
    // Vastbase / HighGo / OceanBase / TiDB / PolarDB / GoldenDB: ?
    return Array.from({ length: columnCount }, () => '?').join(', ');
  }
}
