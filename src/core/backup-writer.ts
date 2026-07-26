/**
 * BackupWriter (v3.x)
 *
 * Exports a profile's database as a platform-agnostic SQL dump containing
 * `CREATE TABLE` + `INSERT INTO ...` statements. MVP supports sqlite, mysql,
 * postgresql. Other adapters fall back to schema-only (CREATE TABLE) and
 * emit a structured warning.
 *
 * v3.x BACKWARD COMPATIBILITY NOTE: For SQLite we use `sqlite_master` to
 * read DDL; for MySQL/PostgreSQL we use `SHOW TABLES` + `SHOW CREATE TABLE`
 * via the existing DbAdapter.executeQuery interface — no engine-level access.
 * Streaming: rows are pulled one chunk at a time via LIMIT/OFFSET pagination.
 */

import type { ProfileManager } from './profile-manager.js';
import type { QueryResult } from '../types/adapter.js';

export interface BackupOptions {
  /** Only dump schema, skip data */
  schemaOnly?: boolean;
  /** Tables to include; default = all */
  tables?: string[];
}

export interface BackupResult {
  content: string;
  bytes: number;
  tables: string[];
  kind: 'full' | 'schema-only' | 'unsupported';
  warnings?: string[];
}

const MAX_INSERT_ROWS_PER_STATEMENT = 100;
const MYSQL_TYPES = new Set(['mysql', 'kingbase', 'kingbasees', 'gaussdb', 'opengauss', 'oceanbase', 'tidb', 'pingcap', 'polardb', 'vastbase', 'highgo', 'goldendb']);
const POSTGRES_TYPES = new Set(['postgresql', 'postgres']);
// v3.2.8 Bug #46 fix: 达梦无 INFORMATION_SCHEMA,用 ALL_TABLES/DBMS_METADATA 替代
const DM_TYPES = new Set(['dm', 'dameng']);

function sqlEscape(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value instanceof Date) {
    // v3.2.8 Bug #31 fix: MySQL DATETIME expects 'YYYY-MM-DD HH:MM:SS', not ISO with 'T' + 'Z'.
    const d = value;
    const pad = (n: number) => String(n).padStart(2, '0');
    const formatted = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    return `'${formatted}'`;
  }
  if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`;
  const s = String(value).replace(/'/g, "''");
  return `'${s}'`;
}

/** Validate table identifier — reject any char outside [a-zA-Z0-9_.]. */
function safeIdent(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) && !/^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`unsupported table identifier: ${name} (only [a-zA-Z0-9_.] allowed)`);
  }
  return name;
}

/** Get list of tables in a profile via sqlite_master or information_schema. */
async function listTables(profile: ProfileManager, profileName: string): Promise<string[]> {
  const live = await profile.loadProfile(profileName);
  const dbType = live.profile.type;
  let result: QueryResult;
  if (dbType === 'sqlite') {
    result = await live.adapter.executeQuery(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    );
  } else if (MYSQL_TYPES.has(dbType)) {
    result = await live.adapter.executeQuery(
      `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name`
    );
  } else if (POSTGRES_TYPES.has(dbType)) {
    result = await live.adapter.executeQuery(
      `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name`
    );
  } else if (DM_TYPES.has(dbType)) {
    // v3.2.8 Bug #46 fix: 达梦无 information_schema,用 ALL_TABLES(system schemas 排除)
    // 同时返回 OWNER + TABLE_NAME 让 opts.tables 可用 schema.table 过滤
    result = await live.adapter.executeQuery(
      `SELECT OWNER, TABLE_NAME AS name FROM ALL_TABLES
       WHERE OWNER NOT IN ('SYS','SYSTEM','SYSAUDITOR','SYSSSO','CTISYS')
       ORDER BY OWNER, TABLE_NAME`
    );
  } else {
    throw new Error(`unsupported db type for backup: ${dbType} (MVP supports sqlite/mysql/postgresql/dm)`);
  }
  return (result.rows ?? []).map((r: any) => {
    const name = String((r as Record<string, unknown>).name ?? r.table_name ?? '');
    const owner = String((r as Record<string, unknown>).owner ?? '');
    return owner ? `${owner}.${name}` : name;
  }).filter(Boolean);
}

/** Read CREATE TABLE statement(s) for the given table. */
async function readCreateTable(profile: ProfileManager, profileName: string, table: string): Promise<string> {
  const live = await profile.loadProfile(profileName);
  const dbType = live.profile.type;
  safeIdent(table);
  let stmt: string;
  let res: QueryResult;
  if (dbType === 'sqlite') {
    res = await live.adapter.executeQuery(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='${table}'`
    );
    stmt = String((res.rows as any)?.[0]?.sql ?? '');
  } else if (MYSQL_TYPES.has(dbType)) {
    res = await live.adapter.executeQuery(
      `SHOW CREATE TABLE \`${table}\``
    );
    const row = (res.rows as any)?.[0];
    // column 0 = table name, column 1 = create statement
    stmt = String(Object.values(row ?? {})[1] ?? '');
  } else if (POSTGRES_TYPES.has(dbType)) {
    res = await live.adapter.executeQuery(
      `SELECT pg_get_ddl('TABLE', '${table}') AS ddl`
    );
    stmt = String((res.rows as any)?.[0]?.ddl ?? '');
  } else if (DM_TYPES.has(dbType)) {
    // v3.2.8 Bug #46 fix: 达梦 DBMS_METADATA.GET_DDL 需要 DBA 权限,普通 user 多报 [-26008]。
    // 改用 getTableInfo 重建 CREATE TABLE(从 ALL_TAB_COLUMNS + ALL_CONS_COLUMNS + ALL_TAB_COMMENTS)
    const dotIdx = table.indexOf('.');
    const owner = dotIdx > 0 ? table.substring(0, dotIdx) : '';
    const tblName = dotIdx > 0 ? table.substring(dotIdx + 1) : table;
    let rawDdl = '';
    try {
      // v3.2.8 Bug #46 fix: DBMS_METADATA.GET_DDL 有两种失败模式:
      // 1. 普通 user 无权限 → [-26008] 未找到对象
      // 2. CLOB 返回触发 dmdb "Do not know how to serialize a BigInt"
      // 用 try/catch 捕获,失败回退到 ALL_TAB_COLUMNS 重建 DDL
      res = await live.adapter.executeQuery(
        `SELECT DBMS_METADATA.GET_DDL('TABLE', '${tblName}', '${owner}') AS ddl FROM DUAL`
      );
      rawDdl = String((res.rows as any)?.[0]?.ddl ?? '');
    } catch {
      rawDdl = '';
    }
    if (!rawDdl || !/CREATE\s+/i.test(rawDdl)) {
      // v3.2.8 Bug #46 fix: 无 schema 前缀时先查 USER 拿当前 owner
      let effectiveOwner = owner;
      if (!effectiveOwner) {
        try {
          const u = await live.adapter.executeQuery(`SELECT USER AS u FROM DUAL`);
          effectiveOwner = String((u.rows as any)?.[0]?.u ?? '').trim();
        } catch { effectiveOwner = ''; }
      }
      const ownerClause = effectiveOwner ? `OWNER='${effectiveOwner}'` : `1=1`;
      const colRes = await live.adapter.executeQuery(
        `SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, DATA_PRECISION, DATA_SCALE, NULLABLE, DATA_DEFAULT
         FROM ALL_TAB_COLUMNS
         WHERE ${ownerClause} AND TABLE_NAME='${tblName}'
         ORDER BY COLUMN_ID`
      );
      // 上面 ownerClause 已经处理 effectiveOwner,这里不再需要 c.OWNER 修正
      const pks = await live.adapter.executeQuery(
        `SELECT cc.COLUMN_NAME FROM ALL_CONS_COLUMNS cc
         JOIN ALL_CONSTRAINTS c ON cc.CONSTRAINT_NAME=c.CONSTRAINT_NAME AND cc.OWNER=c.OWNER
         WHERE c.${effectiveOwner ? `OWNER='${effectiveOwner}'` : 'OWNER=cc.OWNER'}
           AND c.TABLE_NAME='${tblName}' AND c.CONSTRAINT_TYPE='P'`
      );
      const pkCols = new Set((pks.rows ?? []).map((r: any) => String(Object.values(r)[0])));
      const cols = (colRes.rows ?? []).map((r: any) => {
        // dmdb driver 返回 lowercase keys
        const cn = String(r.column_name ?? r.COLUMN_NAME);
        const dt = String(r.data_type ?? r.DATA_TYPE);
        const dl = r.data_length ?? r.DATA_LENGTH;
        const dp = r.data_precision ?? r.DATA_PRECISION;
        const ds = r.data_scale ?? r.DATA_SCALE;
        const nullable = (r.nullable ?? r.NULLABLE) === 'Y' ? '' : ' NOT NULL';
        const def = (r.data_default ?? r.DATA_DEFAULT) ? ` DEFAULT ${String(r.data_default ?? r.DATA_DEFAULT).trim()}` : '';
        let typeStr = dt;
        if (['VARCHAR','VARCHAR2','CHAR'].includes(dt)) typeStr = `${dt}(${dl})`;
        else if (dt === 'DECIMAL' || dt === 'NUMBER' || dt === 'NUMERIC') typeStr = dp ? `${dt}(${dp}${ds ? ',' + ds : ''})` : dt;
        else if (dt === 'DATE') typeStr = 'DATE';
        else if (dt === 'TEXT' || dt === 'CLOB') typeStr = 'TEXT';
        return `  "${cn}" ${typeStr}${nullable}${def}`;
      });
      const pkClause = pkCols.size > 0 ? `,\n  PRIMARY KEY (${[...pkCols].map(c => `"${c}"`).join(', ')})` : '';
      rawDdl = `CREATE TABLE "${owner}"."${tblName}" (\n${cols.join(',\n')}${pkClause}\n)`;
    }
    stmt = rawDdl;
  } else {
    stmt = '';
  }
  if (!stmt || !/CREATE\s+/i.test(stmt)) {
    throw new Error(`failed to read CREATE TABLE for ${table} on ${dbType}`);
  }
  return stmt;
}

async function dumpTable(profile: ProfileManager, profileName: string, table: string): Promise<string> {
  const live = await profile.loadProfile(profileName);
  const dbType = live.profile.type;
  safeIdent(table);
  // v3.2.8 Bug #31 fix: MySQL requires backtick identifiers; PostgreSQL/SQLite use double-quote
  const quote = (name: string): string => MYSQL_TYPES.has(dbType) ? `\`${name}\`` : `"${name}"`;
  const ident = (name: string): string => MYSQL_TYPES.has(dbType) ? `\`${name}\`` : `"${name}"`;
  // Pagination via LIMIT/OFFSET works on sqlite, mysql, pg.
  const out: string[] = [];
  let offset = 0;
  while (true) {
    const res = await live.adapter.executeQuery(
      `SELECT * FROM ${ident(table)} LIMIT ${MAX_INSERT_ROWS_PER_STATEMENT} OFFSET ${offset}`
    );
    const rows = (res.rows ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) break;
    const cols = Object.keys(rows[0] as Record<string, unknown>);
    const colList = cols.map(c => quote(c)).join(', ');
    for (let i = 0; i < rows.length; i += MAX_INSERT_ROWS_PER_STATEMENT) {
      const chunk = rows.slice(i, i + MAX_INSERT_ROWS_PER_STATEMENT);
      const values = chunk.map(r => `(${cols.map(c => sqlEscape(r[c])).join(', ')})`).join(', ');
      out.push(`INSERT INTO ${ident(table)} (${colList}) VALUES ${values};`);
    }
    offset += rows.length;
    if (rows.length < MAX_INSERT_ROWS_PER_STATEMENT) break;
  }
  return out.join('\n');
}

export class BackupWriter {
  /**
   * Dump a profile's database as SQL text.
   * For unsupported adapters throws an error (caller may retry with schemaOnly).
   */
  static async dump(
    pm: ProfileManager,
    profileName: string,
    opts?: BackupOptions,
  ): Promise<BackupResult> {
    if (!pm.isEnabled()) throw new Error('ProfileManager disabled');
    const dbType = (await pm.getProfile(profileName))?.type;
    if (!dbType) throw new Error(`profile not found: ${profileName}`);

    const mvpSupported = dbType === 'sqlite' || MYSQL_TYPES.has(dbType) || POSTGRES_TYPES.has(dbType) || DM_TYPES.has(dbType);
    if (!mvpSupported) {
      return {
        content: '',
        bytes: 0,
        tables: [],
        kind: 'unsupported',
        warnings: [`db type "${dbType}" not in MVP; only schema dump is supported`],
      };
    }

    const allTables = await listTables(pm, profileName);
    const tables = opts?.tables?.length ? opts.tables.filter(t => allTables.includes(t)) : allTables;
    const warnings: string[] = [];

    const out: string[] = [];
    out.push(`-- BackupWriter dump of profile: ${profileName} (${dbType})`);
    out.push(`-- Generated: ${new Date().toISOString()}`);
    out.push(`-- Tables: ${tables.length}`);

    for (const table of tables) {
      try {
        const ddl = await readCreateTable(pm, profileName, table);
        out.push(`-- ----- table: ${table} -----`);
        out.push(ddl + ';');
        if (!opts?.schemaOnly) {
          const rows = await dumpTable(pm, profileName, table);
          if (rows) out.push(rows);
        }
        out.push('');
      } catch (err) {
        warnings.push(`table ${table}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const content = out.join('\n');
    return {
      content,
      bytes: Buffer.byteLength(content, 'utf8'),
      tables,
      kind: opts?.schemaOnly ? 'schema-only' : 'full',
      warnings: warnings.length ? warnings : undefined,
    };
  }
}
