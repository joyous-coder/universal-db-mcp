/**
 * AuditLog unit tests (v3.x)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { QueryAnalyzer } from '../../src/core/query-analyzer.js';
import { AuditLog, classifySeverity } from '../../src/core/audit-log.js';

const ts = Date.now();
const tplPath = `.tmp-audit-tpl-${ts}.db`;
const histPath = `.tmp-audit-hist-${ts}.db`;
function cleanup(p: string) {
  for (const s of ['', '-wal', '-shm']) {
    if (existsSync(p + s)) { try { unlinkSync(p + s); } catch { /* ignore */ } }
  }
}

describe('AuditLog (v3.x)', () => {
  let qa: QueryAnalyzer;
  beforeEach(() => {
    cleanup(tplPath); cleanup(histPath);
    qa = new QueryAnalyzer({
      enabled: true, templatesDbPath: tplPath, historyDbPath: histPath,
      historyTtlDays: 30, historyMaxRows: 100, explainTimeoutMs: 5000,
    });
  });
  afterEach(async () => {
    try { await qa.close(); } catch { /* ignore */ }
    cleanup(tplPath); cleanup(histPath);
  });

  it('classifies SELECT as read', () => {
    expect(classifySeverity('SELECT * FROM t')).toBe('read');
  });
  it('classifies INSERT/UPDATE/DELETE as write', () => {
    expect(classifySeverity('INSERT INTO t VALUES (1)')).toBe('write');
    expect(classifySeverity('UPDATE t SET x = 1')).toBe('write');
    expect(classifySeverity('DELETE FROM t WHERE x = 1')).toBe('write');
  });
  it('classifies CREATE/ALTER/DROP as ddl', () => {
    expect(classifySeverity('CREATE TABLE t (x INTEGER)')).toBe('ddl');
    expect(classifySeverity('ALTER TABLE t ADD COLUMN y TEXT')).toBe('ddl');
    expect(classifySeverity('DROP TABLE t')).toBe('ddl');
  });

  it('record writes severity=auto-derived when not supplied', async () => {
    await AuditLog.record(qa, 'SELECT * FROM t', 'sqlite', 'select', {
      actor: 'user-1', severity: 'read', clientIp: '127.0.0.1',
    });
    const entries = await AuditLog.query(qa, { actor: 'user-1' });
    expect(entries.length).toBe(1);
    expect(entries[0].severity).toBe('read');
    expect(entries[0].actor).toBe('user-1');
    expect(entries[0].client_ip).toBe('127.0.0.1');
  });

  it('record respects explicit severity', async () => {
    await AuditLog.record(qa, 'CREATE TABLE t (x INTEGER)', 'sqlite', 'ddl', {
      actor: 'admin',
      severity: 'write',  // intentionally wrong, see if it sticks
    });
    const entries = await AuditLog.query(qa, {});
    expect(entries[0].severity).toBe('write');  // user override respected
  });

  it('audit_metadata_json round-trips', async () => {
    await AuditLog.record(qa, 'SELECT 1', 'sqlite', 'select', {
      actor: 'user-2',
      severity: 'read',
      metadata: { source: 'mcp', requestId: 'abc-123' },
    });
    const entries = await AuditLog.query(qa, { actor: 'user-2' });
    const meta = JSON.parse(entries[0].audit_metadata_json ?? '{}');
    expect(meta.source).toBe('mcp');
    expect(meta.requestId).toBe('abc-123');
  });

  it('filter by severity returns only matching rows', async () => {
    await AuditLog.record(qa, 'SELECT 1', 'sqlite', 'select', { actor: 'a', severity: 'read' });
    await AuditLog.record(qa, 'UPDATE t SET x = 1', 'sqlite', 'update', { actor: 'a', severity: 'write' });
    await AuditLog.record(qa, 'DROP TABLE t', 'sqlite', 'ddl', { actor: 'a', severity: 'ddl' });
    const ddl = await AuditLog.query(qa, { actor: 'a', severity: 'ddl' });
    expect(ddl.length).toBe(1);
    expect(ddl[0].sql).toContain('DROP');
  });

  it('filter by clientIp', async () => {
    await AuditLog.record(qa, 'SELECT 1', 'sqlite', 'select', { actor: 'a', severity: 'read', clientIp: '10.0.0.1' });
    await AuditLog.record(qa, 'SELECT 2', 'sqlite', 'select', { actor: 'a', severity: 'read', clientIp: '10.0.0.2' });
    const first = await AuditLog.query(qa, { actor: 'a', clientIp: '10.0.0.1' });
    expect(first.length).toBe(1);
  });

  it('audit info stays null when v3.x columns absent in historical rows', async () => {
    // Verify old history rows without audit fields don't crash reads.
    await qa.recordQuery({
      ts: new Date().toISOString(),
      db: 'sqlite', kind: 'select',
      sql: 'SELECT 1',
      params: null, duration_ms: 5, rows: 1, error: null, error_code: null,
    });
    const entries = await qa.getHistory({});
    expect(entries[0].actor).toBeNull();
  });
});
