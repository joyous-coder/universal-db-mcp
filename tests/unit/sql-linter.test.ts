import { describe, it, expect } from 'vitest';
import { lintSql } from '../../src/utils/sql-linter.js';

describe('SQL Linter', () => {
  it('flags SELECT *', () => {
    const r = lintSql('SELECT * FROM users');
    expect(r.issues.some(i => i.rule === 'select-star')).toBe(true);
  });

  it('flags UPDATE without WHERE as error', () => {
    const r = lintSql('UPDATE users SET active = 0');
    const issue = r.issues.find(i => i.rule === 'no-where-update');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('error');
  });

  it('flags DELETE without WHERE as error', () => {
    const r = lintSql('DELETE FROM users');
    expect(r.issues.some(i => i.rule === 'no-where-update' && i.severity === 'error')).toBe(true);
  });

  it('flags UPDATE without LIMIT as warning', () => {
    const r = lintSql("UPDATE users SET active=0 WHERE id=1");
    expect(r.issues.some(i => i.rule === 'no-limit-update')).toBe(true);
  });

  it('flags IN with > 1000 items as warning', () => {
    const items = Array.from({length: 1001}, (_, i) => i).join(',');
    const r = lintSql(`SELECT * FROM t WHERE id IN (${items})`);
    expect(r.issues.some(i => i.rule === 'in-thousand')).toBe(true);
  });

  it('flags leading wildcard LIKE', () => {
    const r = lintSql("SELECT * FROM t WHERE name LIKE '%abc%'");
    expect(r.issues.some(i => i.rule === 'leading-wildcard-like')).toBe(true);
  });

  it('flags UNION without ALL as info', () => {
    const r = lintSql('SELECT a FROM t1 UNION SELECT a FROM t2');
    expect(r.issues.some(i => i.rule === 'union-vs-union-all')).toBe(true);
  });

  it('flags ORDER BY without LIMIT as info', () => {
    const r = lintSql('SELECT * FROM t ORDER BY created_at');
    expect(r.issues.some(i => i.rule === 'order-by-no-limit')).toBe(true);
  });

  it('flags SELECT DISTINCT as info', () => {
    const r = lintSql('SELECT DISTINCT name FROM t');
    expect(r.issues.some(i => i.rule === 'distinct-without-index-hint')).toBe(true);
  });

  it('flags double-quoted identifiers as warning', () => {
    const r = lintSql('SELECT "name" FROM t');
    expect(r.issues.some(i => i.rule === 'double-quoted-identifier')).toBe(true);
  });

  it('returns no issues for clean SQL', () => {
    const r = lintSql("SELECT id, name FROM users WHERE active = 1 LIMIT 10");
    expect(r.issues).toEqual([]);
    expect(r.hasErrors).toBe(false);
    expect(r.hasWarnings).toBe(false);
  });

  it('hasErrors is true when any error-severity issue present', () => {
    const r = lintSql('DELETE FROM users');
    expect(r.hasErrors).toBe(true);
  });
});
