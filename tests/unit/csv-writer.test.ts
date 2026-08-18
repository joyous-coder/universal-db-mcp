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
  it('builds basic SELECT without LIMIT/OFFSET (v4.0.9)', () => {
    expect(buildSelectSql({
      table: 'users', columns: ['id', 'name'],
      where: 'age > 18', orderBy: 'id ASC',
    })).toBe('SELECT "id", "name" FROM users WHERE age > 18 ORDER BY id ASC');
  });
  it('omits WHERE and ORDER BY when not provided', () => {
    expect(buildSelectSql({
      table: 'users', columns: ['*'],
    })).toBe('SELECT * FROM users');
  });
  it('rejects WHERE containing semicolon (injection guard)', () => {
    expect(() => buildSelectSql({
      table: 'users', columns: ['*'], where: '1=1; DROP TABLE users',
    })).toThrow(/injection_blocked/);
  });
  it('rejects ORDER BY containing semicolon', () => {
    expect(() => buildSelectSql({
      table: 'users', columns: ['*'], orderBy: 'id; DROP TABLE x',
    })).toThrow(/injection_blocked/);
  });
  it('quotes schema.table as "schema"."table"', () => {
    expect(buildSelectSql({
      table: 'public.users', columns: ['id'],
    })).toBe('SELECT "id" FROM "public"."users"');
  });
});

class StubAdapter {
  calls: Array<{ sql: string }> = [];
  rows: any[] = [];
  async executeQuery(sql: string) {
    this.calls.push({ sql });
    return { rows: this.rows, executionTime: 1 };
  }
}

describe('CsvWriter.exportTableCsv', () => {
  const tmp = path.join(tmpdir(), 'csv-writer-test.csv');
  afterEach(() => { try { rmSync(tmp); } catch {} });

  it('table mode: writes all rows in one query (no LIMIT/OFFSET, no pagination)', async () => {
    const a = new StubAdapter() as any;
    a.rows = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
      { id: 3, name: 'C' },
    ];
    const result = await exportTableCsv({
      adapter: a, table: 'users',
      columns: ['id', 'name'],
      outputPath: tmp,
    });
    expect(result.totalRows).toBe(3);
    expect(a.calls.length).toBe(1);            // 单次查询,不分页
    expect(a.calls[0].sql).toBe('SELECT "id", "name" FROM users');
    expect(a.calls[0].sql).not.toMatch(/LIMIT/i);
    expect(a.calls[0].sql).not.toMatch(/OFFSET/i);
    const content = readFileSync(tmp, 'utf8');
    expect(content).toBe('id,name\r\n1,Alice\r\n2,Bob\r\n3,C\r\n');
  });

  it('sql mode: uses sql as-is (Oracle-compatible pagination)', async () => {
    const a = new StubAdapter() as any;
    a.rows = [{ x: 1 }, { x: 2 }];
    const result = await exportTableCsv({
      adapter: a,
      sql: 'SELECT x FROM big_table WHERE ROWNUM <= 1000 ORDER BY x',
      columns: ['x'],
      outputPath: tmp,
    });
    expect(result.totalRows).toBe(2);
    expect(a.calls[0].sql).toBe('SELECT x FROM big_table WHERE ROWNUM <= 1000 ORDER BY x');
    // 不添加任何 LIMIT/OFFSET
    expect(a.calls[0].sql).not.toMatch(/LIMIT/i);
  });

  it('sql mode: strips trailing semicolon', async () => {
    const a = new StubAdapter() as any;
    a.rows = [{ x: 1 }];
    await exportTableCsv({
      adapter: a,
      sql: 'SELECT x FROM t;',
      columns: ['x'],
      outputPath: tmp,
    });
    expect(a.calls[0].sql).toBe('SELECT x FROM t');
  });

  it('rejects when neither table nor sql provided', async () => {
    const a = new StubAdapter() as any;
    await expect(exportTableCsv({
      adapter: a, columns: ['x'], outputPath: tmp,
    })).rejects.toThrow(/table.*sql/);
  });

  it('rejects when both table and sql provided', async () => {
    const a = new StubAdapter() as any;
    await expect(exportTableCsv({
      adapter: a, table: 't', sql: 'SELECT * FROM t', columns: ['x'], outputPath: tmp,
    })).rejects.toThrow(/不能同时/);
  });

  it('infers CSV header from first row when columns=["*"]', async () => {
    const a = new StubAdapter() as any;
    a.rows = [{ id: 1, name: 'A' }];
    await exportTableCsv({
      adapter: a, table: 't', columns: ['*'], outputPath: tmp,
    });
    const content = readFileSync(tmp, 'utf8');
    expect(content.startsWith('id,name\r\n')).toBe(true);
  });
});