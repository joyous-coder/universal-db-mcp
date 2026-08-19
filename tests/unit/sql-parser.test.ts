/**
 * sql-parser v2 — PL/块跨方言支持
 */
import { describe, it, expect } from 'vitest';
import { splitStatements } from '../../src/utils/sql-parser.js';

describe('splitStatements — Oracle / DM (PL/SQL blocks)', () => {
  it('keeps simple BEGIN..END as one statement', () => {
    const sql = 'BEGIN\n  NULL;\nEND;';
    expect(splitStatements(sql, 'oracle')).toEqual(['BEGIN\n  NULL;\nEND;']);
  });

  it('keeps BEGIN..END with inner IF as one statement', () => {
    const sql = `BEGIN
  IF 1 = 1 THEN
    NULL;
  END IF;
END;`;
    expect(splitStatements(sql, 'oracle')).toEqual([sql]);
  });

  it('keeps BEGIN..END with nested LOOP + IF as one statement', () => {
    const sql = `BEGIN
  FOR i IN 1..10 LOOP
    IF i > 5 THEN
      CONTINUE;
    END IF;
  END LOOP;
END;`;
    expect(splitStatements(sql, 'oracle')).toEqual([sql]);
  });

  it('DECLARE section before BEGIN..END', () => {
    const sql = `DECLARE
  x NUMBER := 1;
BEGIN
  NULL;
END;`;
    expect(splitStatements(sql, 'oracle')).toEqual([sql]);
  });

  it('handles standalone `/` line as block terminator', () => {
    const sql = `BEGIN
  NULL;
END;
/
SELECT 1 FROM DUAL;
/
SELECT 2 FROM DUAL;`;
    const stmts = splitStatements(sql, 'oracle');
    expect(stmts).toEqual([
      'BEGIN\n  NULL;\nEND;',
      'SELECT 1 FROM DUAL;',
      'SELECT 2 FROM DUAL;',
    ]);
  });

  it('multiple blocks separated by `/`', () => {
    const sql = `BEGIN
  NULL;
END;
/
BEGIN
  NULL;
END;
/
SELECT 1 FROM DUAL;`;
    const stmts = splitStatements(sql, 'oracle');
    expect(stmts.length).toBe(3);
  });

  it('plain DDL+DML still splits on `;`', () => {
    const sql = `DROP TABLE X;
CREATE TABLE X (id NUMBER);
INSERT INTO X VALUES (1);`;
    expect(splitStatements(sql, 'oracle')).toEqual([
      'DROP TABLE X;',
      'CREATE TABLE X (id NUMBER);',
      'INSERT INTO X VALUES (1);',
    ]);
  });

  it('does NOT touch `/` in middle of line (not a terminator)', () => {
    const sql = `INSERT INTO T VALUES (1/2, 'a/b');
SELECT 1 FROM DUAL;`;
    expect(splitStatements(sql, 'oracle')).toEqual([
      "INSERT INTO T VALUES (1/2, 'a/b');",
      'SELECT 1 FROM DUAL;',
    ]);
  });

  it('DM dialect behaves same as Oracle', () => {
    const sql = `BEGIN
  IF 1 = 1 THEN NULL; END IF;
END;`;
    expect(splitStatements(sql, 'dm')).toEqual([sql]);
  });
});

describe('splitStatements — PostgreSQL (PL/pgSQL + $$ DO blocks)', () => {
  it('keeps DO $$ ... $$; as one statement', () => {
    const sql = `DO $$
BEGIN
  IF 1 = 1 THEN
    RAISE NOTICE 'yes';
  END IF;
END $$;`;
    expect(splitStatements(sql, 'postgres')).toEqual([sql]);
  });

  it('multiple DO blocks separated by `;`', () => {
    const sql = `DO $$ BEGIN RAISE NOTICE 'a'; END $$;
DO $$ BEGIN RAISE NOTICE 'b'; END $$;
SELECT 1;`;
    const stmts = splitStatements(sql, 'postgres');
    expect(stmts.length).toBe(3);
    expect(stmts[0]).toContain("'a'");
    expect(stmts[1]).toContain("'b'");
    expect(stmts[2]).toBe('SELECT 1;');
  });

  it('handles `;` inside $$ block (not split)', () => {
    const sql = `DO $$ DECLARE x INT; BEGIN x := 1; END $$;`;
    expect(splitStatements(sql, 'postgres')).toEqual([sql]);
  });
});

describe('splitStatements — MySQL / TiDB / OceanBase (DELIMITER)', () => {
  it('uses custom delimiter `$$` to keep procedure body together', () => {
    const sql = `DELIMITER $$
CREATE PROCEDURE p()
BEGIN
  SELECT 1;
END $$
DELIMITER ;
CALL p();`;
    const stmts = splitStatements(sql, 'mysql');
    // expect: CREATE PROCEDURE...$$ as 1 stmt (with internal ;), DELIMITER directive stripped, CALL p();
    expect(stmts.length).toBeGreaterThanOrEqual(2);
    expect(stmts[0]).toContain('CREATE PROCEDURE p()');
    expect(stmts[0]).toContain('SELECT 1;');
    expect(stmts.some(s => s.includes('CALL p()'))).toBe(true);
  });

  it('BEGIN..END with internal END IF recognized correctly', () => {
    const sql = `DELIMITER $$
BEGIN
  IF 1 = 1 THEN
    SELECT 1;
  END IF;
END $$
DELIMITER ;
SELECT 2;`;
    const stmts = splitStatements(sql, 'mysql');
    // First stmt: BEGIN..END IF..END (DELIMITER $$ normalized to `;` before main parse)
    expect(stmts[0]).toContain('BEGIN');
    expect(stmts[0]).toContain('END IF');
    expect(stmts[0]).toContain('END ;');  // normalized delimiter
    // Second stmt: SELECT 2;
    expect(stmts.some(s => s.includes('SELECT 2'))).toBe(true);
  });
});

describe('splitStatements — SQL Server (GO separator)', () => {
  it('treats standalone `GO` as statement separator', () => {
    const sql = `SELECT 1;
GO
SELECT 2;
GO
SELECT 3;`;
    const stmts = splitStatements(sql, 'sqlserver');
    expect(stmts).toEqual([
      'SELECT 1;',
      'SELECT 2;',
      'SELECT 3;',
    ]);
  });

  it('does NOT split on GO inside identifier', () => {
    const sql = `SELECT [GO] FROM T;`;
    expect(splitStatements(sql, 'sqlserver')).toEqual(['SELECT [GO] FROM T;']);
  });

  it('GO with leading whitespace', () => {
    const sql = `SELECT 1;
  GO
SELECT 2;`;
    const stmts = splitStatements(sql, 'sqlserver');
    expect(stmts).toEqual(['SELECT 1;', 'SELECT 2;']);
  });
});

describe('splitStatements — string literals & comments safety', () => {
  it('does NOT split on `;` inside string literal', () => {
    const sql = `INSERT INTO T VALUES ('a;b;c');`;
    expect(splitStatements(sql, 'oracle')).toEqual([
      "INSERT INTO T VALUES ('a;b;c');",
    ]);
  });

  it('does NOT split on `END` keyword inside string', () => {
    const sql = `INSERT INTO T VALUES ('BEGIN END');`;
    expect(splitStatements(sql, 'oracle')).toEqual([
      "INSERT INTO T VALUES ('BEGIN END');",
    ]);
  });

  it('does NOT split on `;` inside line comment', () => {
    const sql = `-- comment with semicolons ; ; ;\nSELECT 1;`;
    // parser must not split inside comment, so internal `;` are preserved
    const stmts = splitStatements(sql, 'oracle');
    // Either 1 stmt (comment + SELECT attached) or 2 stmts (split after SELECT) — both OK
    expect(stmts.length).toBeGreaterThanOrEqual(1);
    expect(stmts.some(s => s.includes('-- comment') && s.includes('SELECT 1'))).toBe(true);
  });

  it('does NOT split on `;` inside block comment', () => {
    const sql = `/* BEGIN END; SELECT 2; */\nSELECT 1;`;
    const stmts = splitStatements(sql, 'oracle');
    expect(stmts.length).toBeGreaterThanOrEqual(1);
    expect(stmts.some(s => s.includes('/* BEGIN END') && s.includes('SELECT 1'))).toBe(true);
  });
});

describe('splitStatements — edge cases', () => {
  it('empty input returns empty array', () => {
    expect(splitStatements('', 'oracle')).toEqual([]);
    expect(splitStatements(null as any, 'oracle')).toEqual([]);
  });

  it('mixed case keywords', () => {
    const sql = `begin\n  null;\nend;`;
    expect(splitStatements(sql, 'oracle')).toEqual(['begin\n  null;\nend;']);
  });

  it('default dialect is mysql', () => {
    expect(splitStatements('SELECT 1;').length).toBe(1);
  });
});

// v5.0.0: per-profile paths — covered by manual integration test.
// Add here if QueryAnalyzer.setProfilePathResolver becomes unit-testable.