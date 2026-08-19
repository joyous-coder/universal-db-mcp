import { describe, it, expect } from 'vitest';
import { substituteParams } from '../../src/utils/sql-template.js';
import type { TemplateParam } from '../../src/core/query-analyzer-types.js';

describe('substituteParams', () => {
  it('replaces string param', () => {
    const params: TemplateParam[] = [{ name: 'name', type: 'string', required: true }];
    const r = substituteParams("SELECT * FROM t WHERE name = ${name}", { name: 'foo' }, params);
    expect(r).toBe("SELECT * FROM t WHERE name = 'foo'");
  });

  it('replaces number param', () => {
    const params: TemplateParam[] = [{ name: 'id', type: 'number', required: true }];
    const r = substituteParams('SELECT * FROM t WHERE id = ${id}', { id: 42 }, params);
    expect(r).toBe('SELECT * FROM t WHERE id = 42');
  });

  it('replaces date param as ISO string', () => {
    const params: TemplateParam[] = [{ name: 'd', type: 'date', required: true }];
    const r = substituteParams('SELECT * FROM t WHERE d > ${d}', { d: '2026-07-24' }, params);
    expect(r).toBe("SELECT * FROM t WHERE d > '2026-07-24'");
  });

  it('replaces sql_identifier via validateIdentifier (rejects injection)', () => {
    const params: TemplateParam[] = [{ name: 'col', type: 'sql_identifier', required: true }];
    expect(() => substituteParams('SELECT ${col} FROM t', { col: 'name; DROP TABLE x' }, params)).toThrow(/invalid identifier/i);
    const ok = substituteParams('SELECT ${col} FROM t', { col: 'name' }, params);
    expect(ok).toBe('SELECT name FROM t');
  });

  it('throws on missing required param', () => {
    const params: TemplateParam[] = [{ name: 'id', type: 'number', required: true }];
    expect(() => substituteParams('SELECT ${id}', {}, params)).toThrow(/missing required/i);
  });

  it('uses default for optional missing param', () => {
    const params: TemplateParam[] = [{ name: 'limit', type: 'number', required: false, default: 100 }];
    const r = substituteParams('SELECT * FROM t LIMIT ${limit}', {}, params);
    expect(r).toBe('SELECT * FROM t LIMIT 100');
  });

  // v5.0.1 Bug N18: json 类型占位符保留 JSON 结构(用于 MongoDB JSON template)
  it('replaces json param with JSON.stringify (no surrounding quotes)', () => {
    const params: TemplateParam[] = [{ name: 'status', type: 'json', required: true }];
    const r = substituteParams(
      '{"collection":"users","operation":"find","query":{"status":${status}}}',
      { status: 'active' },
      params,
    );
    // 不加单引号包 string,JSON 结构完整
    expect(r).toBe('{"collection":"users","operation":"find","query":{"status":"active"}}');
  });

  it('replaces json param with object value (full nested JSON)', () => {
    const params: TemplateParam[] = [{ name: 'filter', type: 'json', required: true }];
    const r = substituteParams(
      '{"collection":"users","operation":"find","query":${filter}}',
      { filter: { status: 'active', age: { $gt: 18 } } },
      params,
    );
    expect(r).toBe(
      '{"collection":"users","operation":"find","query":{"status":"active","age":{"$gt":18}}}',
    );
  });
});
