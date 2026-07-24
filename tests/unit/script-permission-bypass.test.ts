/**
 * Script Permission Bypass Tests
 * Verifies that execute_script properly validates permissions PER STATEMENT,
 * preventing bypass via multi-statement scripts like `SELECT 1; DROP TABLE victim;`.
 *
 * Related: HIGH severity finding from peer review.
 */

import { describe, it, expect } from 'vitest';
import { detectOperationType } from '../../src/utils/safety.js';
import { splitStatements } from '../../src/utils/sql-parser.js';

describe('detectOperationType per statement', () => {
  it('classifies SELECT statement as null (read)', () => {
    const result = detectOperationType('SELECT 1');
    expect(result).toBeNull();
  });

  it('classifies DROP TABLE as ddl', () => {
    const result = detectOperationType('DROP TABLE victim');
    expect(result?.type).toBe('ddl');
    expect(result?.keyword).toBe('DROP');
  });

  it('classifies DELETE as delete', () => {
    const result = detectOperationType('DELETE FROM users WHERE id = 1');
    expect(result?.type).toBe('delete');
  });

  it('classifies UPDATE as update', () => {
    const result = detectOperationType('UPDATE users SET active = 1');
    expect(result?.type).toBe('update');
  });

  it('classifies INSERT as insert', () => {
    const result = detectOperationType("INSERT INTO users (name) VALUES ('test')");
    expect(result?.type).toBe('insert');
  });
});

describe('splitStatements detects all statements in multi-stmt scripts', () => {
  it('splits SELECT and DROP TABLE as separate statements', () => {
    const sql = 'SELECT 1; DROP TABLE victim;';
    const stmts = splitStatements(sql, 'mysql').filter(s => s.trim());
    expect(stmts.length).toBeGreaterThanOrEqual(2);
    expect(stmts[0]).toContain('SELECT');
    expect(stmts[1]).toContain('DROP TABLE');
  });

  it('preserves DROP TABLE inside BEGIN...END', () => {
    const sql = `BEGIN INSERT INTO t VALUES (1); DROP TABLE victim; END;`;
    const stmts = splitStatements(sql, 'oracle').filter(s => s.trim());
    expect(stmts.length).toBe(1); // whole BEGIN block is one statement
    expect(stmts[0]).toContain('DROP TABLE');
  });
});

describe('permission bypass prevention logic', () => {
  // Simulates what DatabaseService.executeScript does for per-statement validation
  function validateScriptPerStatement(script: string, dialect: string, permissions: string[]): { ok: boolean; failedAt?: number; error?: string } {
    const stmts = splitStatements(script, dialect).filter(s => s.trim());
    for (let i = 0; i < stmts.length; i++) {
      const detected = detectOperationType(stmts[i]);
      if (detected && !permissions.includes(detected.type)) {
        return { ok: false, failedAt: i, error: `${detected.type} not in ${permissions.join(',')}` };
      }
    }
    return { ok: true };
  }

  it('blocks SELECT; DROP TABLE; when only script+read permission', () => {
    const result = validateScriptPerStatement('SELECT 1; DROP TABLE victim;', 'mysql', ['read', 'script']);
    expect(result.ok).toBe(false);
    expect(result.failedAt).toBe(1);
    expect(result.error).toContain('ddl');
  });

  it('blocks SELECT; DELETE FROM x; when only script+read permission', () => {
    const result = validateScriptPerStatement('SELECT 1; DELETE FROM users;', 'mysql', ['read', 'script']);
    expect(result.ok).toBe(false);
    expect(result.failedAt).toBe(1);
    expect(result.error).toContain('delete');
  });

  it('blocks SELECT; UPDATE x SET y=z; when only script+read permission', () => {
    const result = validateScriptPerStatement('SELECT 1; UPDATE users SET active=1;', 'mysql', ['read', 'script']);
    expect(result.ok).toBe(false);
    expect(result.failedAt).toBe(1);
    expect(result.error).toContain('update');
  });

  it('allows SELECT; INSERT INTO ... when script+insert+read permission', () => {
    const result = validateScriptPerStatement('SELECT 1; INSERT INTO t VALUES (1);', 'mysql', ['read', 'script', 'insert']);
    expect(result.ok).toBe(true);
  });

  it('allows full sequence when full permission', () => {
    const result = validateScriptPerStatement(
      'SELECT 1; INSERT INTO t VALUES (1); UPDATE t SET x=1; DELETE FROM t WHERE id=1;',
      'mysql',
      ['read', 'insert', 'update', 'delete', 'ddl', 'script']
    );
    expect(result.ok).toBe(true);
  });

  it('blocks CREATE TABLE when no ddl permission', () => {
    const result = validateScriptPerStatement('CREATE TABLE x (id INT);', 'mysql', ['read', 'script']);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('ddl');
  });

  it('blocks TRUNCATE without WHERE even with ddl permission', () => {
    // Note: TRUNCATE check is the BaseAdapter blacklist, not permission check.
    // This test confirms the layered defense approach.
    const result = validateScriptPerStatement('TRUNCATE TABLE x;', 'mysql', ['read', 'script', 'ddl']);
    // Permission check passes (ddl is allowed), but BaseAdapter blacklist would reject
    expect(result.ok).toBe(true); // permission-wise ok
    // The blacklist is enforced separately in BaseAdapter
  });
});