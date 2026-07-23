/**
 * SQL Detector Tests
 * Tests detection of multi-statement scripts and PL blocks.
 */

import { describe, it, expect } from 'vitest';
import { isScriptLike } from '../../src/utils/sql-detector.js';

describe('isScriptLike', () => {
  it('returns false for simple SELECT', () => {
    expect(isScriptLike('SELECT * FROM users')).toBe(false);
  });

  it('returns true for BEGIN block', () => {
    expect(isScriptLike('BEGIN UPDATE users SET active = 1; END;')).toBe(true);
  });

  it('returns true for DECLARE', () => {
    expect(isScriptLike('DECLARE @x INT; SET @x = 1;')).toBe(true);
  });

  it('returns true for CALL', () => {
    expect(isScriptLike('CALL my_procedure(1, 2)')).toBe(true);
  });

  it('returns true for multi-statement (semicolon-separated)', () => {
    expect(isScriptLike('INSERT INTO t VALUES (1); INSERT INTO t VALUES (2);')).toBe(true);
  });

  it('returns false for trailing semicolon only', () => {
    expect(isScriptLike('SELECT 1;')).toBe(false);
  });

  it('returns true for leading comment + multi-statement', () => {
    expect(isScriptLike('-- comment\nSELECT 1;\nSELECT 2;')).toBe(true);
  });

  it('returns true for PL/SQL CREATE PROCEDURE', () => {
    expect(isScriptLike(`CREATE OR REPLACE PROCEDURE foo AS BEGIN SELECT 1; END;`)).toBe(true);
  });
});