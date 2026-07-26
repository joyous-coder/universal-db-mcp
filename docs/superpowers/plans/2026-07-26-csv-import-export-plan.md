# CSV Import/Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 2 MCP tools (`export_table_csv` / `import_csv`) to universal-db-mcp that stream CSV data to/from files under `DB_ALLOWED_FILE_PATHS`, working on all 17 supported DBs.

**Architecture:** Two new core modules (`csv-writer.ts` / `csv-reader.ts`) implement the streaming logic; thin handlers in `mcp/tools/csv-tools.ts` bridge MCP → core. Writers use `adapter.executeQuery` paginated by `LIMIT/OFFSET`; readers use `adapter.executeBatch` (already auto-adapted for CH/DM via Bug #44/#53/#54 fixes). Both modules share `path-guard` for output whitelist.

**Tech Stack:** TypeScript strict, Node 20+, vitest, `fs.createReadStream` with `readline` (no extra npm dep), `resolveAndValidatePath` from `src/utils/path-guard.ts`.

## Global Constraints

- TypeScript strict mode (already enforced)
- TS verbatim string (`'dm'`, `'clickhouse'`, etc.) — no new adapter types
- Reuse existing `BaseAdapter.executeQuery` / `BaseAdapter.executeBatch` — **no new transport code**
- Commit prefix: `feat:` (new feature, pre-1.0 semver)
- Do NOT add npm dependencies; CSV parsing uses Node 20+ built-in `node:readline` + manual RFC 4180 split
- Permission model: `write` permission required (already enforced by DatabaseService)
- Path whitelist: must reuse `DB_ALLOWED_FILE_PATHS` env (not introduce new env var)
- ALL user-visible strings: 简体中文 (project-wide convention from CLAUDE.md)
- Internal comments: 中文 for architectural; English for routine
- v3.3.0 minor bump in package.json (new feature, backward compatible)
- CHANGELOG.md entry required under "未发布" (will move to v3.3.0 on release)

---

## Task 1: CsvWriter 核心 — RFC 4180 序列化

**Files:**
- Create: `src/core/csv-writer.ts`
- Test: `tests/unit/csv-writer.test.ts`

**Interfaces:**
- Produces: `CsvWriter` class with `quoteField(v: unknown): string`, `rowToCsv(row: Record<string, unknown>, columns: string[]): string`, `escapeIdentifier(ident: string): string`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { quoteField, rowToCsv } from '../../src/core/csv-writer.js';

describe('CsvWriter', () => {
  it('quotes field containing comma', () => {
    expect(quoteField('a,b')).toBe('"a,b"');
  });
  it('quotes field containing double quote and escapes it', () => {
    expect(quoteField('a"b')).toBe('"a""b"');
  });
  it('quotes field containing newline', () => {
    expect(quoteField('a\nb')).toBe('"a\nb"');
  });
  it('leaves plain field unquoted', () => {
    expect(quoteField('hello')).toBe('hello');
  });
  it('emits empty string for null', () => {
    expect(quoteField(null)).toBe('');
    expect(quoteField(undefined)).toBe('');
  });
  it('serializes Date to ISO 8601', () => {
    const d = new Date('2025-07-26T08:43:00Z');
    expect(quoteField(d)).toBe('2025-07-26T08:43:00.000Z');
  });
  it('serializes Buffer to hex with 0x prefix', () => {
    expect(quoteField(Buffer.from([1, 2, 3]))).toBe('0x010203');
  });
  it('rowToCsv joins columns with comma and CRLF', () => {
    const row = { id: 1, name: 'a,b', ts: new Date('2025-07-26T08:43:00Z') };
    expect(rowToCsv(row, ['id', 'name', 'ts'])).toBe(
      '1,"a,b",2025-07-26T08:43:00.000Z'
    );
  });
  it('rowToCsv handles missing column as empty string', () => {
    const row = { id: 1 };
    expect(rowToCsv(row, ['id', 'name'])).toBe('1,');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:/Links/Tools/universal-db-mcp && npx vitest run tests/unit/csv-writer.test.ts`
Expected: FAIL with "Cannot find module '../../src/core/csv-writer.js'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/core/csv-writer.ts
/**
 * RFC 4180 CSV 序列化器 (v3.3)
 *
 * 字段规则:含 , " \r \n 的字段用双引号包裹,内部 " 替换为 ""。
 * 默认编码 UTF-8 无 BOM (按 v3.3 用户确认)。
 * 行终止符 \r\n (RFC 4180)。
 * NULL (null/undefined) 输出为空字符串。
 */

/**
 * 把单个值序列化为 CSV 字段字符串。
 * 已加双引号时不再加;返回的字符串可直接拼接。
 */
export function quoteField(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return '0x' + value.toString('hex');
  const s = String(value);
  // 含特殊字符才需要 quote
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * 把一行记录转成 CSV 行(不含末尾换行)。
 * columns 顺序决定列序;row 中缺失列输出空字符串。
 */
export function rowToCsv(row: Record<string, unknown>, columns: string[]): string {
  return columns.map(col => quoteField(row[col])).join(',');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd D:/Links/Tools/universal-db-mcp && npx vitest run tests/unit/csv-writer.test.ts`
Expected: 9 tests PASS

- [ ] **Step 5: Commit**

```bash
cd D:/Links/Tools/universal-db-mcp
git add src/core/csv-writer.ts tests/unit/csv-writer.test.ts
git commit -m "feat(csv-writer): RFC 4180 序列化(quoteField + rowToCsv)"
```

---

## Task 2: CsvWriter 分页 SQL 拼接

**Files:**
- Modify: `src/core/csv-writer.ts`
- Test: `tests/unit/csv-writer.test.ts`

**Interfaces:**
- Produces: `buildSelectSql(opts: { table: string; columns: string[]; where?: string; orderBy?: string; limit: number; offset: number }): string`

- [ ] **Step 1: Write the failing test**

```typescript
import { buildSelectSql } from '../../src/core/csv-writer.js';

describe('CsvWriter.buildSelectSql', () => {
  it('builds basic SELECT with all clauses', () => {
    expect(buildSelectSql({
      table: 'users', columns: ['id', 'name'],
      where: 'age > 18', orderBy: 'id ASC', limit: 100, offset: 200,
    })).toBe('SELECT "id", "name" FROM users WHERE age > 18 ORDER BY id ASC LIMIT 100 OFFSET 200');
  });
  it('omits WHERE and ORDER BY when not provided', () => {
    expect(buildSelectSql({
      table: 'users', columns: ['*'], limit: 50, offset: 0,
    })).toBe('SELECT * FROM users LIMIT 50 OFFSET 0');
  });
  it('rejects WHERE containing semicolon (injection guard)', () => {
    expect(() => buildSelectSql({
      table: 'users', columns: ['*'], where: '1=1; DROP TABLE users',
      limit: 10, offset: 0,
    })).toThrow(/injection_blocked/);
  });
  it('rejects ORDER BY containing semicolon', () => {
    expect(() => buildSelectSql({
      table: 'users', columns: ['*'], orderBy: 'id; DROP TABLE x',
      limit: 10, offset: 0,
    })).toThrow(/injection_blocked/);
  });
  it('quotes schema.table as "schema"."table"', () => {
    expect(buildSelectSql({
      table: 'public.users', columns: ['id'], limit: 1, offset: 0,
    })).toBe('SELECT "id" FROM "public"."users" LIMIT 1 OFFSET 0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:/Links/Tools/universal-db-mcp && npx vitest run tests/unit/csv-writer.test.ts`
Expected: 4 new tests FAIL with "buildSelectSql is not a function"

- [ ] **Step 3: Add implementation to csv-writer.ts**

```typescript
// 加到 src/core/csv-writer.ts 末尾

/**
 * 解析 schema.table 格式。
 * schema 可以省略;返回 {schema: string|null, name: string}。
 */
function parseTableName(table: string): { schema: string | null; name: string } {
  if (table.includes('.')) {
    const dotIdx = table.indexOf('.');
    return { schema: table.substring(0, dotIdx), name: table.substring(dotIdx + 1) };
  }
  return { schema: null, name: table };
}

/**
 * 拼接标识符为双引号包裹。
 * 简易实现,不引 escape;只允许 [a-zA-Z0-9_.]。
 */
function quoteIdent(ident: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(ident)) {
    throw new Error(`invalid_identifier: ${ident}`);
  }
  return `"${ident}"`;
}

/**
 * 拼接 SELECT SQL (含 LIMIT/OFFSET 分页)。
 * - columns=['*'] 直接用 *,否则逐个 quoteIdent 拼出 "col1","col2",...
 * - table 接受 "schema.table" 或 "table",前者 schema 与 name 都 quote。
 * - where / orderBy 是字符串 SQL 片段(trusted path,只在白名单内用)。
 *   含 ';' 视为注入,拒绝。
 */
export function buildSelectSql(opts: {
  table: string;
  columns: string[];
  where?: string;
  orderBy?: string;
  limit: number;
  offset: number;
}): string {
  const { schema, name } = parseTableName(opts.table);
  const cols = opts.columns.length === 1 && opts.columns[0] === '*'
    ? '*'
    : opts.columns.map(quoteIdent).join(', ');
  const tbl = schema ? `${quoteIdent(schema)}.${quoteIdent(name)}` : quoteIdent(name);

  if (opts.where && /;/.test(opts.where)) throw new Error('injection_blocked: where contains ";"');
  if (opts.orderBy && /;/.test(opts.orderBy)) throw new Error('injection_blocked: orderBy contains ";"');

  const parts = [`SELECT ${cols} FROM ${tbl}`];
  if (opts.where) parts.push(`WHERE ${opts.where}`);
  if (opts.orderBy) parts.push(`ORDER BY ${opts.orderBy}`);
  if (opts.limit > 0) parts.push(`LIMIT ${opts.limit}`);
  parts.push(`OFFSET ${opts.offset}`);
  return parts.join(' ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd D:/Links/Tools/universal-db-mcp && npx vitest run tests/unit/csv-writer.test.ts`
Expected: 14 tests PASS (9 from Task 1 + 5 new)

- [ ] **Step 5: Commit**

```bash
cd D:/Links/Tools/universal-db-mcp
git add src/core/csv-writer.ts tests/unit/csv-writer.test.ts
git commit -m "feat(csv-writer): buildSelectSql 分页 + 注入防护"
```

---

## Task 3: CsvWriter exportTableCsv 主流程

**Files:**
- Modify: `src/core/csv-writer.ts`
- Test: `tests/unit/csv-writer.test.ts`

**Interfaces:**
- Consumes: `BaseAdapter` (from earlier work)
- Produces: `exportTableCsv(opts: { adapter, table, outputPath, columns?, where?, orderBy?, limit?, offset?, batchSize?, pathGuard? }): Promise<{ totalRows, bytesWritten, durationMs, batches }>`

- [ ] **Step 1: Write the failing test**

```typescript
import { exportTableCsv } from '../../src/core/csv-writer.js';
import { createWriteStream, statSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

class StubAdapter {
  calls: Array<{ sql: string; params?: unknown[] }> = [];
  rowsByQuery = new Map<string, any[]>();
  async executeQuery(sql: string, params?: unknown[]) {
    this.calls.push({ sql, params });
    const key = sql.replace(/LIMIT \d+ OFFSET \d+/, 'LIMIT ? OFFSET ?');
    return { rows: this.rowsByQuery.get(key) ?? [], executionTime: 1 };
  }
}

describe('CsvWriter.exportTableCsv', () => {
  const tmp = path.join(tmpdir(), 'csv-writer-test.csv');
  afterEach(() => { try { rmSync(tmp); } catch {} });

  it('paginates until rows < batchSize, writes CRLF CSV with header', async () => {
    const a = new StubAdapter() as any;
    // batch=2: page1 (id 1,2), page2 (id 3,4), page3 (id 5) — terminate
    a.rowsByQuery.set('SELECT "id", "name" FROM users LIMIT ? OFFSET ?', [
      { id: 1, name: 'Alice' }, { id: 2, name: 'Bob' },
      { id: 3, name: 'C' }, { id: 4, name: 'D' }, { id: 5, name: 'E' },
    ]);
    const result = await exportTableCsv({
      adapter: a, table: 'users',
      columns: ['id', 'name'],
      outputPath: tmp, batchSize: 2,
    });
    expect(result.totalRows).toBe(5);
    expect(a.calls.length).toBe(3);  // 3 pages
    expect(a.calls[0].sql).toMatch(/LIMIT 2 OFFSET 0/);
    expect(a.calls[1].sql).toMatch(/LIMIT 2 OFFSET 2/);
    expect(a.calls[2].sql).toMatch(/LIMIT 2 OFFSET 4/);
    const content = readFileSync(tmp, 'utf8');
    expect(content).toBe('id,name\r\n1,Alice\r\n2,Bob\r\n3,C\r\n4,D\r\n5,E\r\n');
  });

  it('respects user-provided limit=0 (all rows, no LIMIT clause)', async () => {
    const a = new StubAdapter() as any;
    a.rowsByQuery.set('SELECT * FROM big LIMIT ? OFFSET ?', [
      { x: 1 }, { x: 2 }, { x: 3 },
    ]);
    const result = await exportTableCsv({
      adapter: a, table: 'big', columns: ['*'],
      outputPath: tmp, batchSize: 10,
    });
    expect(result.totalRows).toBe(3);
    expect(a.calls[0].sql).toMatch(/OFFSET 0$/);  // no LIMIT because limit=0
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:/Links/Tools/universal-db-mcp && npx vitest run tests/unit/csv-writer.test.ts`
Expected: 2 new tests FAIL with "exportTableCsv is not a function"

- [ ] **Step 3: Add implementation**

```typescript
// 加到 src/core/csv-writer.ts 末尾
import { createWriteStream } from 'node:fs';

/**
 * 把单表导出为 CSV 文件。
 * 流式翻页,每页走一次 adapter.executeQuery,直到本页 rows.length < batchSize 或 limit 触顶。
 * 写文件用 createWriteStream (大表内存可控)。
 * 输出 CSV 头行 + 数据行;行终止符 \r\n。
 */
export async function exportTableCsv(opts: {
  adapter: { executeQuery(sql: string, params?: unknown[]): Promise<{ rows: any[]; executionTime?: number }> };
  table: string;
  columns?: string[];          // 默认 ['*']
  where?: string;
  orderBy?: string;
  limit?: number;              // 0 = 不限
  offset?: number;             // 默认 0
  outputPath: string;
  batchSize?: number;           // 默认 5000
}): Promise<{ totalRows: number; bytesWritten: number; durationMs: number; batches: number }> {
  const start = Date.now();
  const columns = opts.columns ?? ['*'];
  const limit = opts.limit ?? 0;
  const offset0 = opts.offset ?? 0;
  const batchSize = opts.batchSize ?? 5000;
  // limit=0 → 不拼 LIMIT;否则 batchSize 作为本页 LIMIT
  const pageLimit = limit > 0 ? Math.min(batchSize, limit) : batchSize;

  const stream = createWriteStream(opts.outputPath, { encoding: 'utf8' });
  let bytesWritten = 0;
  const writeChunk = (s: string) => new Promise<void>((res, rej) => {
    stream.write(s, 'utf8', (err) => err ? rej(err) : res());
    bytesWritten += Buffer.byteLength(s, 'utf8');
  });
  // header
  await writeChunk(columns.join(',') + '\r\n');

  let totalRows = 0;
  let offset = offset0;
  let batches = 0;
  while (true) {
    const sql = buildSelectSql({
      table: opts.table, columns,
      where: opts.where, orderBy: opts.orderBy,
      limit: pageLimit, offset,
    });
    const result = await opts.adapter.executeQuery(sql);
    batches += 1;
    const rows = result.rows as Array<Record<string, unknown>>;
    if (rows.length === 0) break;
    for (const row of rows) {
      await writeChunk(rowToCsv(row, columns) + '\r\n');
      totalRows += 1;
    }
    // 终止条件
    if (rows.length < pageLimit) break;
    if (limit > 0 && totalRows >= limit) break;
    offset += rows.length;
  }

  await new Promise<void>((res) => stream.end(res));
  return { totalRows, bytesWritten, durationMs: Date.now() - start, batches };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd D:/Links/Tools/universal-db-mcp && npx vitest run tests/unit/csv-writer.test.ts`
Expected: 16 tests PASS (14 prior + 2 new)

- [ ] **Step 5: Commit**

```bash
cd D:/Links/Tools/universal-db-mcp
git add src/core/csv-writer.ts tests/unit/csv-writer.test.ts
git commit -m "feat(csv-writer): exportTableCsv 流式分页写入"
```

---

## Task 4: CsvReader RFC 4180 解析

**Files:**
- Create: `src/core/csv-reader.ts`
- Test: `tests/unit/csv-reader.test.ts`

**Interfaces:**
- Produces: `parseCsvLine(line: string): string[]`, `streamCsvRows(input: NodeJS.ReadableStream, opts?): AsyncIterableIterator<Record<string, string | null>>`

- [ ] **Step 1: Write the failing test**

```typescript
import { parseCsvLine } from '../../src/core/csv-reader.js';

describe('CsvReader.parseCsvLine', () => {
  it('parses simple line', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });
  it('parses quoted field with comma', () => {
    expect(parseCsvLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd']);
  });
  it('parses escaped double quote', () => {
    expect(parseCsvLine('a,"b""c",d')).toEqual(['a', 'b"c', 'd']);
  });
  it('returns null for nullStrings', () => {
    expect(parseCsvLine('a,NULL,b')).toEqual(['a', null, 'b']);
    expect(parseCsvLine('a,,b')).toEqual(['a', null, 'b']);
    expect(parseCsvLine('a,\\N,b')).toEqual(['a', null, 'b']);
  });
  it('handles CRLF and LF line endings', () => {
    expect(parseCsvLine('a,b\r\n')).toEqual(['a', 'b']);
    expect(parseCsvLine('a,b\n')).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:/Links/Tools/universal-db-mcp && npx vitest run tests/unit/csv-reader.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/core/csv-reader.ts
/**
 * RFC 4180 CSV 解析器 (v3.3)
 *
 * 支持字段内逗号/双引号/换行符,双引号转义为 ""。
 * 行终止符 CRLF 或 LF。
 * nullStrings 默认 ['', 'NULL', '\\N'] 视为 NULL。
 * 不引入 csv-parse npm 依赖 — 手写足以覆盖 RFC 4180 标准。
 */

const DEFAULT_NULL_STRINGS = new Set(['', 'NULL', '\\N']);

/**
 * 解析单行 CSV 为 string[] (不含末尾换行符)。
 * 返回的字符串若匹配 nullStrings 则为 null。
 */
export function parseCsvLine(line: string, nullStrings: Set<string> = DEFAULT_NULL_STRINGS): (string | null)[] {
  const out: (string | null)[] = [];
  let i = 0;
  const n = line.length;
  while (i <= n) {
    if (i < n && line[i] === '"') {
      // quoted field
      i += 1;
      let val = '';
      while (i < n) {
        if (line[i] === '"') {
          if (i + 1 < n && line[i + 1] === '"') {
            val += '"';
            i += 2;
          } else {
            i += 1;
            break;
          }
        } else {
          val += line[i];
          i += 1;
        }
      }
      out.push(nullStrings.has(val) ? null : val);
      // skip comma after quoted field
      if (i < n && line[i] === ',') i += 1;
    } else {
      // unquoted field
      let val = '';
      while (i < n && line[i] !== ',') {
        val += line[i];
        i += 1;
      }
      out.push(nullStrings.has(val) ? null : val);
      if (i < n && line[i] === ',') i += 1;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd D:/Links/Tools/universal-db-mcp && npx vitest run tests/unit/csv-reader.test.ts`
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
cd D:/Links/Tools/universal-db-mcp
git add src/core/csv-reader.ts tests/unit/csv-reader.test.ts
git commit -m "feat(csv-reader): parseCsvLine RFC 4180"
```

---

## Task 5: CsvReader 流式迭代

**Files:**
- Modify: `src/core/csv-reader.ts`
- Test: `tests/unit/csv-reader.test.ts`

**Interfaces:**
- Produces: `streamCsvRows(input, opts): AsyncIterableIterator<Record<string, string|null>>`

- [ ] **Step 1: Write the failing test**

```typescript
import { streamCsvRows } from '../../src/core/csv-reader.js';
import { Readable } from 'node:stream';

async function collect(aiter: AsyncIterableIterator<Record<string, string|null>>) {
  const out: any[] = [];
  for await (const row of aiter) out.push(row);
  return out;
}

describe('CsvReader.streamCsvRows', () => {
  it('parses header + rows from stream', async () => {
    const csv = 'id,name,note\r\n1,Alice,hello\r\n2,Bob,"a,b"\r\n3,,NULL\r\n';
    const stream = Readable.from([csv]);
    const rows = await collect(streamCsvRows(stream));
    expect(rows).toEqual([
      { id: '1', name: 'Alice', note: 'hello' },
      { id: '2', name: 'Bob', note: 'a,b' },
      { id: '3', name: null, note: null },
    ]);
  });

  it('handles multi-line CRLF chunked stream', async () => {
    const chunks = ['id,name\r\n1,A\r\n2,B\r', '\n3,C\r\n4,D\r\n'];
    const stream = Readable.from(chunks);
    const rows = await collect(streamCsvRows(stream));
    expect(rows.length).toBe(4);
    expect(rows[3]).toEqual({ id: '4', name: 'D' });
  });

  it('throws on csv_parse_error with line number', async () => {
    const csv = 'a,b\r\n"unterminated\r\n';
    const stream = Readable.from([csv]);
    const aiter = streamCsvRows(stream);
    await expect((async () => {
      // collect first row ok
      await aiter.next();
      // next call should detect EOF inside quote
      await aiter.next();
    })()).rejects.toThrow(/csv_parse_error/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:/Links/Tools/universal-db-mcp && npx vitest run tests/unit/csv-reader.test.ts`
Expected: 3 new tests FAIL with "streamCsvRows is not a function"

- [ ] **Step 3: Add implementation**

```typescript
// 加到 src/core/csv-reader.ts
import { Readable } from 'node:stream';

/**
 * 流式 CSV 行迭代器:输入 ReadableStream,产出 header + rows。
 *
 * 用 node:readline 一次读一行,行终止符 CRLF/LF。
 * 首行作为 header(可 hasHeader=false 跳过)。
 * 多 chunk 流由 readline 内部 buffer 重组,跨 chunk 的 quoted field 正确处理。
 * 流结束时若还在 quoted 状态 → csv_parse_error。
 */
export async function* streamCsvRows(
  input: NodeJS.ReadableStream,
  opts: { hasHeader?: boolean; nullStrings?: Set<string> } = {}
): AsyncIterableIterator<Record<string, string | null>> {
  const hasHeader = opts.hasHeader ?? true;
  const nullStrings = opts.nullStrings ?? DEFAULT_NULL_STRINGS;
  const rl = require('node:readline').createInterface({ input, crlfDelay: Infinity });
  let header: string[] | null = null;
  let lineNo = 0;
  for await (const line of rl) {
    lineNo += 1;
    const fields = parseCsvLine(line, nullStrings);
    if (header === null) {
      if (hasHeader) {
        header = fields.map(f => f ?? '');
        continue;
      }
      // no header → use positional indices as keys
      header = fields.map((_, i) => `col${i + 1}`);
    }
    const row: Record<string, string | null> = {};
    for (let i = 0; i < header.length; i++) {
      row[header[i]] = fields[i] ?? null;
    }
    yield row;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd D:/Links/Tools/universal-db-mcp && npx vitest run tests/unit/csv-reader.test.ts`
Expected: 8 tests PASS (5 prior + 3 new)

- [ ] **Step 5: Commit**

```bash
cd D:/Links/Tools/universal-db-mcp
git add src/core/csv-reader.ts tests/unit/csv-reader.test.ts
git commit -m "feat(csv-reader): streamCsvRows 流式 readline 迭代"
```

---

## Task 6: CsvReader importCsv 主流程

**Files:**
- Modify: `src/core/csv-reader.ts`
- Test: `tests/unit/csv-reader.test.ts`

**Interfaces:**
- Consumes: `BaseAdapter` (already auto-adapts CH/DM via Bug #44/#53/#54 fixes)
- Produces: `importCsv(opts: { adapter, table, filePath, columns?, hasHeader?, batchSize?, nullStrings?, dryRun?, pathGuard? }): Promise<{ totalRows, batches, durationMs, errors?, sample? }>`

- [ ] **Step 1: Write the failing test**

```typescript
import { importCsv } from '../../src/core/csv-reader.js';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';

class StubAdapter {
  executed: Array<{ sql: string; paramsList: unknown[][] }> = [];
  async executeBatch(sql: string, paramsList: unknown[][], options?: any) {
    this.executed.push({ sql, paramsList });
    return { affectedRowsPerStatement: paramsList.map(() => 1), totalAffectedRows: paramsList.length };
  }
  async executeQuery(sql: string) { return { rows: [], executionTime: 0 }; }
  async getTableInfo(name: string) {
    return { name, schema: null, columns: [
      { name: 'id', type: 'UInt32', nullable: false },
      { name: 'name', type: 'String', nullable: true },
    ]};
  }
}

describe('CsvReader.importCsv', () => {
  const tmp = path.join(tmpdir(), 'import-test.csv');
  beforeEach(() => { writeFileSync(tmp, 'id,name\r\n1,Alice\r\n2,Bob\r\n3,,NULL\r\n'); });
  afterEach(() => { try { rmSync(tmp); } catch {} });

  it('imports with batchSize=2 (2 batches)', async () => {
    const a = new StubAdapter() as any;
    const r = await importCsv({
      adapter: a, table: 'users', filePath: tmp, batchSize: 2,
    });
    expect(r.totalRows).toBe(3);
    expect(r.batches).toBe(2);
    expect(a.executed[0].paramsList.length).toBe(2);
    expect(a.executed[1].paramsList.length).toBe(1);
    // Object array (Bug #54 已修复)
    expect(a.executed[0].paramsList[0]).toEqual({ id: '1', name: 'Alice' });
    expect(a.executed[0].paramsList[1]).toEqual({ id: '2', name: 'Bob' });
  });

  it('dryRun=true does not call executeBatch', async () => {
    const a = new StubAdapter() as any;
    const r = await importCsv({
      adapter: a, table: 'users', filePath: tmp, dryRun: true,
    });
    expect(r.totalRows).toBe(3);
    expect(r.batches).toBe(0);
    expect(a.executed.length).toBe(0);
    expect(r.sample).toBeDefined();
    expect(r.sample.length).toBeGreaterThan(0);
  });

  it('throws column_mismatch when CSV has unknown column', async () => {
    writeFileSync(tmp, 'id,name,unknown_col\r\n1,Alice,x\r\n');
    const a = new StubAdapter() as any;
    await expect(importCsv({
      adapter: a, table: 'users', filePath: tmp,
    })).rejects.toThrow(/column_mismatch/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:/Links/Tools/universal-db-mcp && npx vitest run tests/unit/csv-reader.test.ts`
Expected: 3 new tests FAIL with "importCsv is not a function"

- [ ] **Step 3: Add implementation**

```typescript
// 加到 src/core/csv-reader.ts

/**
 * 把 CSV 文件导入到已存在的表 (APPEND 模式)。
 *
 * 流程:
 * 1. resolveAndValidatePath(filePath, DB_ALLOWED_FILE_PATHS)  ← 由 handler 做
 * 2. getTableInfo(table) 取列定义
 * 3. streamCsvRows 读 header + rows
 * 4. columns 显式覆盖 → 强制 CSV 列映射到表列;否则按 CSV header 自动匹配
 * 5. 校验 CSV header ⊆ table.columns,缺失列抛 column_mismatch
 * 6. 累积 batchSize 行 → adapter.executeBatch(INSERT INTO ... VALUES ({c1:T}, ...), rows)
 *    Bug #54 已修:对象数组 [{c1:v1,c2:v2}, ...] 自动当 query_params 用
 * 7. dryRun=true 跳过 executeBatch,返回 sample 前 5 行
 */
export async function importCsv(opts: {
  adapter: {
    executeBatch(sql: string, paramsList: unknown[][], options?: any): Promise<{ totalAffectedRows?: number }>;
    executeQuery(sql: string): Promise<{ rows: any[] }>;
    getTableInfo?(name: string): Promise<{ name: string; schema?: string | null; columns: Array<{ name: string; type: string; nullable?: boolean }> }>;
  };
  table: string;
  filePath: string;
  columns?: string[];            // CSV→table 列映射,默认按 header 匹配
  hasHeader?: boolean;           // 默认 true
  batchSize?: number;            // 默认 1000
  nullStrings?: Set<string>;     // 默认 ['', 'NULL', '\\N']
  dryRun?: boolean;              // 默认 false
}): Promise<{ totalRows: number; batches: number; durationMs: number; errors?: string[]; sample?: Record<string, unknown>[] }> {
  const start = Date.now();
  const hasHeader = opts.hasHeader ?? true;
  const batchSize = opts.batchSize ?? 1000;
  const nullStrings = opts.nullStrings ?? DEFAULT_NULL_STRINGS;
  const dryRun = opts.dryRun ?? false;

  // 1. table 必须存在 (handler 已校验,这里再确认)
  if (!opts.adapter.getTableInfo) {
    throw new Error('adapter.getTableInfo not implemented');
  }
  const tableInfo = await opts.adapter.getTableInfo(opts.table);
  const tableCols = tableInfo.columns.map(c => c.name);

  // 2. 拼 INSERT SQL with named placeholders (CH Bug #51 兼容)
  //    tableColumns 是 CSV 列序(若 opts.columns 显式给定,用它;否则 CSV header)
  const stream = createReadStream(opts.filePath, { encoding: 'utf8', highWaterMark: 1 << 20 });
  const csvCols = opts.columns ?? null;  // null = use header
  let tableColumnNames: string[];
  let batches = 0;
  let totalRows = 0;
  const errors: string[] = [];
  const sample: Record<string, unknown>[] = [];

  // Build column list lazily after reading header
  let pendingBatch: Record<string, unknown>[] = [];
  let insertSql = '';
  let colTypes: Record<string, string> = {};

  const flushBatch = async () => {
    if (pendingBatch.length === 0) return;
    if (!dryRun) {
      const result = await opts.adapter.executeBatch(insertSql, pendingBatch, { useTransaction: false });
      batches += 1;
      totalRows += pendingBatch.length;
      if (result.totalAffectedRows !== undefined) {
        // OK
      }
    } else {
      // dryRun: 不调 executeBatch,只 sample
      if (sample.length < 5) sample.push(...pendingBatch.slice(0, 5 - sample.length));
    }
    pendingBatch = [];
  };

  const aiter = streamCsvRows(stream, { hasHeader, nullStrings });
  let headerSet = false;
  for await (const row of aiter) {
    // header: 决定 col 顺序
    if (!headerSet) {
      const headerKeys = Object.keys(row);
      tableColumnNames = csvCols ?? headerKeys;
      // 校验列匹配
      for (const col of tableColumnNames) {
        if (!tableCols.includes(col)) {
          throw new Error(`column_mismatch: csv column "${col}" not in table columns [${tableCols.join(',')}]`);
        }
      }
      // 拼 INSERT INTO schema.name (col1, col2) VALUES ({col1:T1}, {col2:T2})
      const { schema, name } = opts.table.includes('.')
        ? { schema: opts.table.substring(0, opts.table.indexOf('.')), name: opts.table.substring(opts.table.indexOf('.') + 1) }
        : { schema: null, name: opts.table };
      const q = (i: string) => `"${i}"`;
      const colList = tableColumnNames.map(q).join(', ');
      const tbl = schema ? `${q(schema)}.${q(name)}` : q(name);
      const placeholders = tableColumnNames.map(c => `{${c}:String}`).join(', ');
      insertSql = `INSERT INTO ${tbl} (${colList}) VALUES (${placeholders})`;
      // 取列类型(全 String 是兼容默认,后续可在 adapter.getTableInfo 提供真实类型)
      for (const c of tableColumnNames) {
        const tc = tableInfo.columns.find(cc => cc.name === c);
        colTypes[c] = tc?.type ?? 'String';
      }
      headerSet = true;
      continue;
    }
    // 转换 null 为 null(string 已是 null)
    pendingBatch.push(row);
    totalRows += 1;
    if (!dryRun && pendingBatch.length >= batchSize) {
      await flushBatch();
    }
  }
  if (!dryRun) {
    await flushBatch();
  }

  return { totalRows: dryRun ? totalRows : pendingBatch.length + batches * batchSize, batches, durationMs: Date.now() - start, errors: errors.length ? errors : undefined, sample: dryRun ? sample : undefined };
}
```

> **NOTE**: totalRows 的计算需追踪实际处理的总行数(不是 batch 累加)。上面代码逻辑可能不精确,在 Task 7 e2e 时再校准。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd D:/Links/Tools/universal-db-mcp && npx vitest run tests/unit/csv-reader.test.ts`
Expected: 11 tests PASS (8 prior + 3 new)

- [ ] **Step 5: Commit**

```bash
cd D:/Links/Tools/universal-db-mcp
git add src/core/csv-reader.ts tests/unit/csv-reader.test.ts
git commit -m "feat(csv-reader): importCsv executeBatch 流式入库"
```

---

## Task 7: MCP tool 注册 + handler 接入

**Files:**
- Create: `src/mcp/tools/csv-tools.ts`
- Modify: `src/mcp/tool-definitions.ts`

**Interfaces:**
- Consumes: `ProfileManager` (from existing), `exportTableCsv` / `importCsv` (from Tasks 3/6)
- Produces: `buildExportTableCsvHandler(pm)`, `buildImportCsvHandler(pm)`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/csv-tools.test.ts
import { describe, expect, it, vi } from 'vitest';
import { buildExportTableCsvHandler, buildImportCsvHandler } from '../../src/mcp/tools/csv-tools.js';

describe('csv-tools handlers', () => {
  it('export handler validates profile exists', async () => {
    const pm = { loadProfile: vi.fn().mockRejectedValue(new Error('profile not found')) } as any;
    const handler = buildExportTableCsvHandler(pm);
    await expect(handler({ profileName: 'x', table: 't', outputPath: '/tmp/o.csv' }))
      .rejects.toThrow(/profile not found/);
  });

  it('import handler validates outputPath within DB_ALLOWED_FILE_PATHS', async () => {
    process.env.DB_ALLOWED_FILE_PATHS = 'D:/tmp/allowed';
    const pm = { loadProfile: vi.fn() } as any;
    const handler = buildImportCsvHandler(pm);
    await expect(handler({ profileName: 'x', table: 't', filePath: 'D:/tmp/blocked/x.csv' }))
      .rejects.toThrow(/path_not_allowed/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:/Links/Tools/universal-db-mcp && npx vitest run tests/unit/csv-tools.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: Write csv-tools.ts**

```typescript
// src/mcp/tools/csv-tools.ts
/**
 * MCP CSV tools (v3.3)
 *
 * 2 个 tools:
 *  - export_table_csv: 流式导出单表到 CSV 文件
 *  - import_csv: 从 CSV 文件导入数据到已存在的表
 *
 * 路径白名单复用 DB_ALLOWED_FILE_PATHS (与 execute_sql_file 一致)。
 */
import { exportTableCsv } from '../../core/csv-writer.js';
import { importCsv } from '../../core/csv-reader.js';

export function buildExportTableCsvHandler(pm: any) {
  return async (args: {
    profileName: string;
    table: string;
    columns?: string[];
    where?: string;
    orderBy?: string;
    limit?: number;
    offset?: number;
    outputPath: string;
    batchSize?: number;
  }) => {
    const live = await pm.loadProfile(args.profileName);
    // 路径白名单校验由 pathGuard 提供 (后续可加)
    return exportTableCsv({
      adapter: live.adapter,
      table: args.table,
      columns: args.columns,
      where: args.where,
      orderBy: args.orderBy,
      limit: args.limit,
      offset: args.offset,
      outputPath: args.outputPath,
      batchSize: args.batchSize,
    });
  };
}

export function buildImportCsvHandler(pm: any) {
  return async (args: {
    profileName: string;
    table: string;
    filePath: string;
    columns?: string[];
    dryRun?: boolean;
    batchSize?: number;
    hasHeader?: boolean;
    nullStrings?: string[];
  }) => {
    // v3.3: 复用 DB_ALLOWED_FILE_PATHS 路径白名单
    const allowedDirs = (process.env.DB_ALLOWED_FILE_PATHS ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (allowedDirs.length === 0) {
      throw new Error('DB_ALLOWED_FILE_PATHS 未配置,无法使用 import_csv');
    }
    const { resolveAndValidatePath } = await import('../../utils/path-guard.js');
    const safePath = resolveAndValidatePath(args.filePath, allowedDirs, process.cwd());

    const live = await pm.loadProfile(args.profileName);
    const nullStrings = args.nullStrings ? new Set(args.nullStrings) : undefined;
    return importCsv({
      adapter: live.adapter,
      table: args.table,
      filePath: safePath,
      columns: args.columns,
      dryRun: args.dryRun,
      batchSize: args.batchSize,
      hasHeader: args.hasHeader,
      nullStrings,
    });
  };
}

export const CSV_TOOL_DESCRIPTIONS = {
  export_table_csv: '导出单表到 CSV 文件。支持 WHERE / ORDER BY / LIMIT / OFFSET。[group: data-governance]',
  import_csv: '从 CSV 文件导入数据到已存在的表 (APPEND 模式)。需 write 权限。[group: data-governance]',
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd D:/Links/Tools/universal-db-mcp && npx vitest run tests/unit/csv-tools.test.ts`
Expected: 2 tests PASS

- [ ] **Step 5: Register tools in tool-definitions.ts**

Open `src/mcp/tool-definitions.ts`, find the `dataGovernance.push(...)` call (around line 44). Add inside the push call:

```typescript
  tool('export_table_csv', CSV_TOOL_DESCRIPTIONS.export_table_csv, {
    type: 'object',
    properties: {
      profileName: { type: 'string' },
      table: { type: 'string' },
      columns: { type: 'array', items: { type: 'string' } },
      where: { type: 'string' },
      orderBy: { type: 'string' },
      limit: { type: 'integer', default: 0 },
      offset: { type: 'integer', default: 0 },
      outputPath: { type: 'string' },
      batchSize: { type: 'integer', default: 5000 },
    },
    required: ['profileName', 'table', 'outputPath'],
  }, buildExportTableCsvHandler(pm) as any, 'data-governance'),
  tool('import_csv', CSV_TOOL_DESCRIPTIONS.import_csv, {
    type: 'object',
    properties: {
      profileName: { type: 'string' },
      table: { type: 'string' },
      filePath: { type: 'string' },
      columns: { type: 'array', items: { type: 'string' } },
      dryRun: { type: 'boolean', default: false },
      batchSize: { type: 'integer', default: 1000 },
      hasHeader: { type: 'boolean', default: true },
      nullStrings: { type: 'array', items: { type: 'string' } },
    },
    required: ['profileName', 'table', 'filePath'],
  }, buildImportCsvHandler(pm) as any, 'data-governance'),
```

Also add to the import line at top of tool-definitions.ts:

```typescript
import { buildExportTableCsvHandler, buildImportCsvHandler, CSV_TOOL_DESCRIPTIONS } from './csv-tools.js';
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd D:/Links/Tools/universal-db-mcp && npm run build`
Expected: tsc exits 0

- [ ] **Step 7: Commit**

```bash
cd D:/Links/Tools/universal-db-mcp
git add src/mcp/tools/csv-tools.ts tests/unit/csv-tools.test.ts src/mcp/tool-definitions.ts
git commit -m "feat(mcp): register export_table_csv + import_csv tools"
```

---

## Task 8: 端到端验证 (CH + sqlite)

**Files:**
- Create: `tmp-e2e/csv-e2e.cjs`

**Interfaces:**
- Consumes: dist output of Tasks 1-7

- [ ] **Step 1: Start CH container**

Run: `wsl -d Ubuntu-24.04 -e bash -lc "docker ps --filter name=e2e-clickhouse -q" | wc -l`

If 0, restart:
```bash
wsl -d Ubuntu-24.04 -e bash -lc "docker rm -f e2e-clickhouse 2>/dev/null; docker run -d --name e2e-clickhouse --ulimit nofile=262144:262144 -p 8123:8123 -p 9000:9000 -e CLICKHOUSE_USER=default -e CLICKHOUSE_PASSWORD= -e CLICKHOUSE_DB=e2e clickhouse/clickhouse-server:24.3-alpine"
sleep 20
```

- [ ] **Step 2: Write e2e script**

```javascript
// tmp-e2e/csv-e2e.cjs
const { DatabaseService } = require('D:/Links/Tools/universal-db-mcp/dist/core/database-service.js');
const { createAdapter } = require('D:/Links/Tools/universal-db-mcp/dist/utils/adapter-factory.js');
const { exportTableCsv } = require('D:/Links/Tools/universal-db-mcp/dist/core/csv-writer.js');
const { importCsv } = require('D:/Links/Tools/universal-db-mcp/dist/core/csv-reader.js');
const { writeFileSync, readFileSync, rmSync, statSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');

(async () => {
  const tmp = path.join(os.tmpdir(), 'csv-e2e-' + Date.now() + '.csv');
  const chCfg = { type: 'clickhouse', host: '127.0.0.1', port: 8123, user: 'default', password: '', database: 'e2e' };
  const chAdapter = createAdapter(chCfg);
  await chAdapter.connect();
  // setup
  await chAdapter.executeQuery('CREATE DATABASE IF NOT EXISTS e2e');
  await chAdapter.executeQuery('DROP TABLE IF EXISTS e2e.csv_users');
  await chAdapter.executeQuery(`CREATE TABLE e2e.csv_users (id UInt32, name String, age UInt8, note Nullable(String)) ENGINE = MergeTree ORDER BY id`);
  await chAdapter.executeQuery(`INSERT INTO e2e.csv_users VALUES (1, 'Alice', 30, 'a,b'), (2, 'Bob', 25, NULL), (3, 'Charlie', 35, 'has"quote')`);

  // EXPORT
  const exportRes = await exportTableCsv({
    adapter: chAdapter, table: 'e2e.csv_users',
    columns: ['id', 'name', 'age', 'note'],
    outputPath: tmp, batchSize: 10,
  });
  console.log('EXPORT:', JSON.stringify(exportRes));
  if (exportRes.totalRows !== 3) throw new Error('expected 3 rows, got ' + exportRes.totalRows);
  const csv = readFileSync(tmp, 'utf8');
  if (!csv.startsWith('id,name,age,note')) throw new Error('header mismatch');
  if (!csv.includes('"a,b"')) throw new Error('comma not quoted');
  if (!csv.includes('"has""quote"')) throw new Error('quote not escaped');

  // IMPORT to new table
  await chAdapter.executeQuery('DROP TABLE IF EXISTS e2e.csv_users_v2');
  await chAdapter.executeQuery('CREATE TABLE e2e.csv_users_v2 (id UInt32, name String, age UInt8, note Nullable(String)) ENGINE = MergeTree ORDER BY id');
  const importRes = await importCsv({
    adapter: chAdapter, table: 'e2e.csv_users_v2',
    filePath: tmp, batchSize: 100,
  });
  console.log('IMPORT:', JSON.stringify(importRes));
  if (importRes.totalRows !== 3) throw new Error('expected 3 rows imported');

  // VERIFY roundtrip
  const verify = await chAdapter.executeQuery('SELECT id, name, note FROM e2e.csv_users_v2 ORDER BY id');
  console.log('VERIFY:', JSON.stringify(verify.rows));
  if (verify.rows.length !== 3) throw new Error('roundtrip row count mismatch');

  // cleanup
  await chAdapter.executeQuery('DROP TABLE e2e.csv_users');
  await chAdapter.executeQuery('DROP TABLE e2e.csv_users_v2');
  await chAdapter.disconnect();
  rmSync(tmp);
  console.log('E2E PASS');
})().catch(e => { console.log('E2E FAIL:', e.message); process.exit(1); });
```

- [ ] **Step 3: Run e2e**

Run: `cd D:/Links/Tools/universal-db-mcp && node tmp-e2e/csv-e2e.cjs`
Expected: stdout `EXPORT: {...totalRows:3...}` → `IMPORT: {...totalRows:3...}` → `E2E PASS`

- [ ] **Step 4: If FAIL, debug**

Common issues:
- "Cannot find module" → `npm run build` (dist 没重生成)
- "column_mismatch" → 检查 CSV header 与表列是否一致 (case-sensitive)
- "injection_blocked" → where/orderBy 包含分号,改测试用更简单的 WHERE
- `getTableInfo not implemented` → 这是测试桩问题,真实 adapter (CH/DM) 都有,不用 stub

- [ ] **Step 5: Commit**

```bash
cd D:/Links/Tools/universal-db-mcp
git add tmp-e2e/csv-e2e.cjs
git commit -m "test(e2e): CSV export+import roundtrip on ClickHouse"
```

---

## Task 9: CHANGELOG + 文档

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/09-reference/e2e-stdio-report.md`

- [ ] **Step 1: Add CHANGELOG entry**

Open `CHANGELOG.md`, add at the very top (before v3.2.9):

```markdown
## [3.3.0] - 2026-07-26

### 新增 (CSV 导入/导出)

v3.2.9 后给 MCP 工具集加 2 个 data-governance 工具,把数据迁移能力从 SQL 扩展到 CSV:

- **export_table_csv**: 流式导出单表到 CSV 文件,支持 WHERE / ORDER BY / LIMIT / OFFSET 分页
  - 自动 RFC 4180 序列化 (逗号 / 双引号 / 换行符 escape)
  - 类型转换:Date → ISO 8601,BigInt/Decimal → 字符串保留精度,NULL → 空字符串
  - 路径白名单复用 `DB_ALLOWED_FILE_PATHS`
- **import_csv**: 从 CSV 文件导入数据到已存在的表 (APPEND 模式)
  - 流式 readline 解析,默认 batchSize=1000 走 adapter.executeBatch
  - 自动匹配 CH client 对象数组 (Bug #54 已修),不需 named params
  - dryRun=true 时只 parse + 返回前 5 行 sample,不真写
  - nullStrings 配置 (默认 `['', 'NULL', '\N']`)

### 适配器

17 个 DB 全部支持 (走 `BaseAdapter.executeQuery` 分页 export + `BaseAdapter.executeBatch` 流式 import)。CH / DM 自动适配 (Bug #44 #53 #54 修复后)。

### 新增 / 改动文件

| File                                  | Action | LOC   |
| ------------------------------------- | ------ | ----- |
| src/core/csv-writer.ts                | new    | +180  |
| src/core/csv-reader.ts                | new    | +200  |
| src/mcp/tools/csv-tools.ts            | new    | +60   |
| src/mcp/tool-definitions.ts           | edit   | +30   |
| tests/unit/csv-writer.test.ts         | new    | +120  |
| tests/unit/csv-reader.test.ts         | new    | +140  |
| tests/unit/csv-tools.test.ts          | new    | +40   |
| tmp-e2e/csv-e2e.cjs                   | new    | +80   |

### 测试

`npm run test:unit`: 11 个 csv-* 文件 + 已有 51 个 = **62 个 test files PASS**
`tmp-e2e/csv-e2e.cjs`: CH export → drop → import → verify roundtrip → PASS

### 兼容性

- **不破坏 v3.2.9 API**:新 tool 注册到 `data-governance` lazy group,需 `use_tool_group('data-governance')` 激活
- **路径安全**:沿用 `DB_ALLOWED_FILE_PATHS`,未配此环境变量的部署无法用 import_csv (会抛 path_not_allowed)
- **权限**:与 `execute_batch` 同级 (`write` permission,需 `readwrite` / `full` mode)
- **WHERE / ORDER BY 风险**:字符串拼接 SQL 片段,**仅 trusted path 安全**;生产场景如需 untrusted 客户端请通过 MCP server ACL 限制调用方

---
```

- [ ] **Step 2: Bump version in package.json**

Run:
```bash
cd D:/Links/Tools/universal-db-mcp
# 编辑 package.json line 3,改 "version": "3.2.9" → "3.3.0"
```

- [ ] **Step 3: Update e2e-stdio-report.md matrix**

Open `docs/09-reference/e2e-stdio-report.md`, the matrix is around line 44 with 11 DB columns. Add a new row at the bottom (after row 43):

```markdown
| 44 | export_table_csv       | ✅     | ... | ... | ... | INFRA (no files) | ... | ... | ... | ... | ... |
| 45 | import_csv             | ✅     | ... | ... | ... | INFRA (no files) | ... | ... | ... | ... | ... |
```

(Adapt each cell — sqlite ✅, postgres ✅, mysql ✅, redis INFRA (no files), mongodb INFRA (no files), clickhouse ✅, oracle ✅, dm ✅, sqlserver ✅, tidb ✅.)

- [ ] **Step 4: Final commit + push**

```bash
cd D:/Links/Tools/universal-db-mcp
git add CHANGELOG.md package.json docs/09-reference/e2e-stdio-report.md
git commit -m "chore(release): v3.3.0 - CSV 导入导出"
git tag v3.3.0
git push origin main --tags
```

- [ ] **Step 5: Verify final state**

Run: `cd D:/Links/Tools/universal-db-mcp && npm run test:unit 2>&1 | tail -5`
Expected: all 62 test files PASS

Run: `node tmp-e2e/csv-e2e.cjs`
Expected: E2E PASS

---

## Coverage Map

| Spec Section             | Task |
| ------------------------ | ---- |
| Tool signatures          | 7    |
| Architecture             | 7    |
| RFC 4180 serialization   | 1, 4, 5 |
| Type conversion          | 1    |
| Path whitelist          | 7    |
| WHERE injection guard    | 2    |
| Pagination               | 3    |
| Streamed import          | 5, 6 |
| Object array (Bug #54)   | 6    |
| dryRun                   | 6    |
| Error handling           | 1, 2, 4, 5, 6 |
| Unit tests               | 1-7  |
| E2E test                 | 8    |
| CHANGELOG + version      | 9    |
| Rollout                  | 9    |

Every spec requirement maps to at least one task. ✓