/**
 * CSV Writer 单元测试 (v3.3)
 *
 * 覆盖 quoteField / rowToCsv:
 *  - RFC 4180 转义 (逗号 / 双引号 / 换行符)
 *  - NULL 序列化 (空字符串)
 *  - 类型转换 (Date → ISO, Buffer → hex)
 *  - rowToCsv 列序与缺失列
 */
import { describe, expect, it } from 'vitest';
import { quoteField, rowToCsv, buildSelectSql } from '../../src/core/csv-writer.js';

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