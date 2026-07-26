/**
 * CSV MCP tools 单元测试 (v3.3)
 *
 * 覆盖 handler 层:
 *  - export_table_csv / import_csv 验证 profile 加载
 *  - import_csv 路径白名单(DB_ALLOWED_FILE_PATHS)
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  buildExportTableCsvHandler,
  buildImportCsvHandler,
} from '../../src/mcp/tools/csv-tools.js';

describe('csv-tools handlers', () => {
  it('export handler validates profile exists', async () => {
    const pm = {
      loadProfile: vi.fn().mockRejectedValue(new Error('profile not found')),
    } as any;
    const handler = buildExportTableCsvHandler(pm);
    await expect(
      handler({ profileName: 'x', table: 't', outputPath: '/tmp/o.csv' })
    ).rejects.toThrow(/profile not found/);
  });

  it('import handler rejects when DB_ALLOWED_FILE_PATHS empty', async () => {
    process.env.DB_ALLOWED_FILE_PATHS = '';
    const pm = { loadProfile: vi.fn() } as any;
    const handler = buildImportCsvHandler(pm);
    await expect(
      handler({ profileName: 'x', table: 't', filePath: 'D:/tmp/x.csv' })
    ).rejects.toThrow(/DB_ALLOWED_FILE_PATHS/);
  });

  it('import handler rejects path outside whitelist', async () => {
    process.env.DB_ALLOWED_FILE_PATHS = 'D:/tmp/allowed';
    const pm = { loadProfile: vi.fn() } as any;
    const handler = buildImportCsvHandler(pm);
    await expect(
      handler({
        profileName: 'x',
        table: 't',
        filePath: 'D:/tmp/blocked/x.csv',
      })
    ).rejects.toThrow(/allowlist|not allowed/i);
  });
});