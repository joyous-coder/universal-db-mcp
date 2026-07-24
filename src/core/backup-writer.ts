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
const MYSQL_TYPES = new Set(['mysql', 'dameng', 'dm', 'kingbase', 'kingbasees', 'gaussdb', 'opengauss', 'oceanbase', 'tidb', 'pingcap', 'polardb', 'vastbase', 'highgo', 'goldendb']);
const POSTGRES_TYPES = new Set(['postgresql', 'postgres']);

function sqlEscape(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value instanceof Date) return `'${value.toISOString().replace(/'/g, "''")}'`;
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
  } else {
    throw new Error(`unsupported db type for backup: ${dbType} (MVP supports sqlite/mysql/postgresql)`);
  }
  return (result.rows ?? []).map((r: any) => String((r as Record<string, unknown>).name ?? r.table_name ?? '')).filter(Boolean);
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
  safeIdent(table);
  // Pagination via LIMIT/OFFSET works on sqlite, mysql, pg.
  const out: string[] = [];
  let offset = 0;
  while (true) {
    const res = await live.adapter.executeQuery(
      `SELECT * FROM ${table} LIMIT ${MAX_INSERT_ROWS_PER_STATEMENT} OFFSET ${offset}`
    );
    const rows = (res.rows ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) break;
    const cols = Object.keys(rows[0] as Record<string, unknown>);
    const colList = cols.map(c => `"${c}"`).join(', ');
    for (let i = 0; i < rows.length; i += MAX_INSERT_ROWS_PER_STATEMENT) {
      const chunk = rows.slice(i, i + MAX_INSERT_ROWS_PER_STATEMENT);
      const values = chunk.map(r => `(${cols.map(c => sqlEscape(r[c])).join(', ')})`).join(', ');
      out.push(`INSERT INTO ${table} (${colList}) VALUES ${values};`);
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

    const mvpSupported = dbType === 'sqlite' || MYSQL_TYPES.has(dbType) || POSTGRES_TYPES.has(dbType);
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
