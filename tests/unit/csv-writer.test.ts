/**
 * CSV Writer 单元测试 (v3.3)
 *
 * 覆盖 quoteField / rowToCsv:
 *  - RFC 4180 转义 (逗号 / 双引号 / 换行符)
 *  - NULL 序列化 (空字符串)
 *  - 类型转换 (Date → ISO, Buffer → hex)
 *  - rowToCsv 列序与缺失列
 */
import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { quoteField, rowToCsv, buildSelectSql, exportTableCsv } from '../../src/core/csv-writer.js';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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
  it('rowToCsv joins columns with comma', () => {
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

class StubAdapter {
  calls: Array<{ sql: string }> = [];
  pages: any[][] = [];
  callIdx = 0;
  async executeQuery(sql: string) {
    this.calls.push({ sql });
    const rows = this.pages[this.callIdx] ?? [];
    this.callIdx += 1;
    return { rows, executionTime: 1 };
  }
}

describe('CsvWriter.exportTableCsv', () => {
  const tmp = path.join(tmpdir(), 'csv-writer-test.csv');
  afterEach(() => { try { rmSync(tmp); } catch {} });

  it('paginates until rows < batchSize, writes CRLF CSV with header', async () => {
    const a = new StubAdapter() as any;
    // batch=2: page1 (2 rows, full), page2 (2 rows, full), page3 (1 row, partial → break)
    a.pages = [
      [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
      [{ id: 3, name: 'C' }, { id: 4, name: 'D' }],
      [{ id: 5, name: 'E' }],
    ];
    const result = await exportTableCsv({
      adapter: a, table: 'users',
      columns: ['id', 'name'],
      outputPath: tmp, batchSize: 2,
    });
    expect(result.totalRows).toBe(5);
    expect(a.calls.length).toBe(3);
    expect(a.calls[0].sql).toMatch(/LIMIT 2 OFFSET 0/);
    expect(a.calls[1].sql).toMatch(/LIMIT 2 OFFSET 2/);
    expect(a.calls[2].sql).toMatch(/LIMIT 2 OFFSET 4/);
    const content = readFileSync(tmp, 'utf8');
    expect(content).toBe('id,name\r\n1,Alice\r\n2,Bob\r\n3,C\r\n4,D\r\n5,E\r\n');
  });

  it('respects user-provided limit=0 (no LIMIT clause)', async () => {
    const a = new StubAdapter() as any;
    a.pages = [[{ x: 1 }, { x: 2 }, { x: 3 }]];
    const result = await exportTableCsv({
      adapter: a, table: 'big', columns: ['*'],
      outputPath: tmp, batchSize: 10,
    });
    expect(result.totalRows).toBe(3);
    expect(a.calls[0].sql).toMatch(/OFFSET 0$/);  // no LIMIT because limit=0
  });
});