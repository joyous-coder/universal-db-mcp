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
      setConfig: vi.fn(),
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

  it('buildSetPiiConfigHandler calls PiiMasker.setConfig and returns count', async () => {
    const { PiiMasker } = await import('../../src/core/pii-masker.js');
    const handler = buildSetPiiConfigHandler();
    const result = await handler({
      profileName: 'prod',
      rules: [{ table: 'users', column: 'email', strategy: 'hash' }],
    });
    expect(PiiMasker.setConfig).toHaveBeenCalledWith('prod', [
      { table: 'users', column: 'email', strategy: 'hash' },
    ]);
    expect(result).toEqual({ success: true, profileName: 'prod', ruleCount: 1 });
  });
});