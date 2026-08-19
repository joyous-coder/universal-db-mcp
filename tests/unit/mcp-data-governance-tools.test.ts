import { describe, it, expect, vi } from 'vitest';
import {
  buildExportBackupHandler,
  buildAuditLogHandler,
  buildGetPiiConfigHandler,
  buildSetPiiConfigHandler,
} from '../../src/mcp/tools/data-governance.js';

// Mock core modules
vi.mock('../../src/core/backup-writer.js', () => ({
  BackupWriter: {
    dump: vi.fn().mockResolvedValue({ content: '-- dump --', bytes: 10, tables: ['users'], kind: 'full' }),
  },
}));

vi.mock('../../src/core/audit-log.js', () => ({
  AuditLog: {
    query: vi.fn().mockResolvedValue([{ id: 1, actor: 'admin' }]),
  },
}));

vi.mock('../../src/core/pii-masker.js', () => {
  const config = { profiles: { prod: [{ table: 'users', column: 'email', strategy: 'hash' }] } };
  return {
    PiiMasker: {
      getConfig: vi.fn().mockImplementation(() => config),
      setProfileConfig: vi.fn(),
    },
  };
});

describe('data-governance MCP tool handlers', () => {
  it('buildExportBackupHandler calls BackupWriter.dump', async () => {
    const handler = buildExportBackupHandler({} as any);
    const result = await handler({ profileName: 'prod', schemaOnly: false });
    expect(result.content).toBe('-- dump --');
  });

  it('buildAuditLogHandler calls AuditLog.query', async () => {
    const handler = buildAuditLogHandler({} as any);
    const result = await handler({ actor: 'admin', severity: 'write' });
    expect(result).toEqual([{ id: 1, actor: 'admin' }]);
  });

  it('buildGetPiiConfigHandler returns current config', async () => {
    const handler = buildGetPiiConfigHandler();
    const result = await handler();
    expect(result.profiles.prod[0].strategy).toBe('hash');
  });

  it('buildSetPiiConfigHandler calls PiiMasker.setProfileConfig and returns count', async () => {
    const { PiiMasker } = await import('../../src/core/pii-masker.js');
    const handler = buildSetPiiConfigHandler();
    const result = await handler({
      profileName: 'prod',
      rules: [{ table: 'users', column: 'email', strategy: 'hash' }],
    });
    expect(PiiMasker.setProfileConfig).toHaveBeenCalledWith(
      'prod',
      [{ table: 'users', column: 'email', strategy: 'hash' }],
      true
    );
    expect(result).toEqual({ success: true, profileName: 'prod', ruleCount: 1 });
  });

  // v5.0.1 Bug N12: export_backup handler 之前忽略 outputPath, 现在写盘并返回 writtenTo
  it('buildExportBackupHandler writes content to outputPath when provided', async () => {
    const path = await import('node:path');
    const fs = await import('node:fs');
    const { unlinkSync } = await import('node:fs');
    const tmpFile = path.join(process.cwd(), '.tmp-bk-handler-test.sql');
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
    process.env.DB_ALLOWED_FILE_PATHS = process.cwd();
    try {
      const handler = buildExportBackupHandler({} as any);
      const result = await handler({ profileName: 'any', outputPath: tmpFile });
      expect(result.writtenTo).toBeTruthy();
      const onDisk = fs.readFileSync(tmpFile, 'utf8');
      expect(onDisk).toBe('-- dump --');
    } finally {
      try { unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });

  it('buildExportBackupHandler without outputPath returns content unchanged', async () => {
    const handler = buildExportBackupHandler({} as any);
    const result = await handler({ profileName: 'any' });
    expect(result.content).toBe('-- dump --');
    expect(result.writtenTo).toBeUndefined();
  });
});