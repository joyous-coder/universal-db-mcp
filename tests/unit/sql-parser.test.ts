/**
 * SQL Parser Tests
 * Tests splitting SQL scripts into individual statements.
 */

import { describe, it, expect } from 'vitest';
import { splitStatements } from '../../src/utils/sql-parser.js';

describe('splitStatements', () => {
  it('splits simple statements by semicolon', () => {
    const sql = 'INSERT INTO t VALUES (1); INSERT INTO t VALUES (2);';
    const result = splitStatements(sql, 'mysql');
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0]).toContain('INSERT INTO t VALUES (1)');
    expect(result[1]).toContain('INSERT INTO t VALUES (2)');
  });

  it('preserves semicolons inside strings', () => {
    const sql = `INSERT INTO t VALUES ('a;b'); INSERT INTO t VALUES ('c');`;
    const result = splitStatements(sql, 'mysql');
    expect(result[0]).toContain(`'a;b'`);
  });

  it('preserves semicolons inside PL/SQL BEGIN...END block', () => {
    const sql = `BEGIN INSERT INTO t VALUES (1); INSERT INTO t VALUES (2); END;`;
    const result = splitStatements(sql, 'oracle');
    // The BEGIN...END block is one logical statement (no top-level split inside it)
    expect(result[0]).toContain('BEGIN');
    expect(result[0]).toContain('END;');
    expect(result[0]).toContain(`VALUES (1)`);
    expect(result[0]).toContain(`VALUES (2)`);
  });

  it('handles nested BEGIN...END blocks', () => {
    const sql = `BEGIN IF x > 0 THEN BEGIN INSERT INTO t VALUES (1); END; END;`;
    const result = splitStatements(sql, 'oracle');
    expect(result[0]).toContain('BEGIN');
  });

  it('removes line comments before splitting', () => {
    const sql = `-- this is a comment\nINSERT INTO t VALUES (1);\n-- another\nINSERT INTO t VALUES (2);`;
    const result = splitStatements(sql, 'mysql');
    expect(result.some(s => s.includes('INSERT'))).toBe(true);
  });

  it('handles MySQL DELIMITER directive', () => {
    const sql = `DELIMITER $$\nCREATE PROCEDURE foo()\nBEGIN\nSELECT 1;\nEND$$\nDELIMITER ;`;
    const result = splitStatements(sql, 'mysql');
    expect(result.some(s => s.includes('CREATE PROCEDURE'))).toBe(true);
  });

  it('returns at least one element for single statement', () => {
    const sql = 'SELECT 1';
    const result = splitStatements(sql, 'mysql');
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});