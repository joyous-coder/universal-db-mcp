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
});
