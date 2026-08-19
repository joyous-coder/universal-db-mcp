/**
 * CSV MCP tools 单元测试 (v3.3 + v4.0.8 fallback + v4.0.9 sql/default-path)
 *
 * 覆盖 handler 层:
 *  - export_table_csv / import_csv 验证 profile 加载
 *  - import_csv 路径白名单(DB_ALLOWED_FILE_PATHS)
 *  - v4.0.8: profileName 可选,省略时回退到 active adapter
 *  - v4.0.9: sql 参数 (二选一替代 table) + 默认输出路径 <cwd>/sql/
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import {
  buildExportTableCsvHandler,
  buildImportCsvHandler,
} from '../../src/mcp/tools/csv-tools.js';

describe('csv-tools handlers', () => {
  // 用项目根目录 (process.cwd()) 作为白名单基址
  // (注意 — 测试需保证 path-guard 拿到的 file 已存在,这样 realpathSync 直接命中,
  //  不会 fallback 到父目录触发 Windows + vitest worker 下偶发的 EISDIR uncaught)
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = process.cwd();
    process.env.DB_ALLOWED_FILE_PATHS = tmpRoot;
  });
  afterEach(() => {
    delete process.env.DB_ALLOWED_FILE_PATHS;
  });

  it('export handler validates profile exists', async () => {
    const pm = {
      loadProfile: vi.fn().mockRejectedValue(new Error('profile not found')),
    } as any;
    const handler = buildExportTableCsvHandler(pm, () => null);
    await expect(
      handler({ profileName: 'x', table: 't', outputPath: path.join(tmpRoot, 'o.csv') })
    ).rejects.toThrow(/profile not found/);
  });

  it('v4.0.9: empty DB_ALLOWED_FILE_PATHS falls back to cwd (no rejection)', async () => {
    process.env.DB_ALLOWED_FILE_PATHS = '';
    const pm = {
      loadProfile: vi.fn().mockRejectedValue(new Error('profile not found')),
    } as any;
    const handler = buildImportCsvHandler(pm, () => null);
    // 不再抛 "DB_ALLOWED_FILE_PATHS 未配置" — 回退到 cwd 白名单
    // 继续走到 pm.loadProfile('x') → 报 "profile not found"
    await expect(
      handler({ profileName: 'x', table: 't', filePath: path.join(tmpRoot, 'x.csv') })
    ).rejects.toThrow(/profile not found/);
  });

  it('import handler rejects path outside whitelist', async () => {
    const pm = { loadProfile: vi.fn() } as any;
    const handler = buildImportCsvHandler(pm, () => null);
    await expect(
      handler({
        profileName: 'x',
        table: 't',
        filePath: path.join(os.tmpdir(), 'definitely-not-allowed-x9y8.csv'),
      })
    ).rejects.toThrow(/allowlist|not allowed/i);
  });

  it('export handler falls back to active adapter when profileName omitted', async () => {
    const pm = { loadProfile: vi.fn() } as any;
    const activeAdapter = { executeQuery: vi.fn() };
    activeAdapter.executeQuery.mockResolvedValue({ rows: [] });
    const handler = buildExportTableCsvHandler(pm, () => activeAdapter as any);
    const outPath = path.join(tmpRoot, '.tmp-csv-test-export.csv');
    // 预创建空文件 — 让 realpathSync 直接命中,避免父目录 fallback 触发 Windows EISDIR
    await fs.writeFile(outPath, '', 'utf8');
    try {
      const result = await handler({
        table: 't',
        outputPath: outPath,
      });
      expect(pm.loadProfile).not.toHaveBeenCalled();
      expect(activeAdapter.executeQuery).toHaveBeenCalled();
      expect(result.totalRows).toBe(0);
    } finally {
      await fs.unlink(outPath).catch(() => {});
    }
  });

  it('export handler throws when neither profileName nor active adapter set', async () => {
    const pm = { loadProfile: vi.fn() } as any;
    const handler = buildExportTableCsvHandler(pm, () => null);
    await expect(
      handler({ table: 't', outputPath: path.join(tmpRoot, '.tmp-csv-test.csv') })
    ).rejects.toThrow(/profileName.*active/i);
  });

  it('import handler falls back to active adapter when profileName omitted', async () => {
    const pm = { loadProfile: vi.fn() } as any;
    const activeAdapter = {
      getTableInfo: vi.fn().mockResolvedValue({
        name: 't',
        columns: [{ name: 'a' }],
      }),
      executeBatch: vi.fn().mockResolvedValue({ totalAffectedRows: 0 }),
    };
    const tmpCsv = path.join(tmpRoot, '.tmp-csv-test-import.csv');
    // 1 header (a) + 2 data rows (1, 2)
    await fs.writeFile(tmpCsv, 'a\r\n1\r\n2\r\n', 'utf8');
    try {
      const handler = buildImportCsvHandler(pm, () => activeAdapter as any);
      const result = await handler({
        table: 't',
        filePath: tmpCsv,
        dryRun: true,
      });
      expect(pm.loadProfile).not.toHaveBeenCalled();
      expect(activeAdapter.getTableInfo).toHaveBeenCalled();
      expect(result.totalRows).toBe(2);
    } finally {
      await fs.unlink(tmpCsv).catch(() => {});
    }
  });

  it('import handler throws when neither profileName nor active adapter set', async () => {
    const pm = { loadProfile: vi.fn() } as any;
    const handler = buildImportCsvHandler(pm, () => null);
    await expect(
      handler({ table: 't', filePath: path.join(tmpRoot, '.tmp-csv-test.csv') })
    ).rejects.toThrow(/profileName.*active/i);
  });

  it('v4.0.9: sql mode passes sql as-is to adapter', async () => {
    const pm = { loadProfile: vi.fn() } as any;
    const activeAdapter = { executeQuery: vi.fn().mockResolvedValue({ rows: [] }) };
    const handler = buildExportTableCsvHandler(pm, () => activeAdapter as any);
    const outPath = path.join(tmpRoot, '.tmp-csv-sql-mode.csv');
    await fs.writeFile(outPath, '', 'utf8');
    try {
      await handler({
        sql: 'SELECT * FROM "BBZ_CQ"."MD_PERIOD_TYPE" WHERE ROWNUM <= 100',
        columns: ['id', 'name'],
        outputPath: outPath,
      });
      expect(pm.loadProfile).not.toHaveBeenCalled();
      // adapter 收到的 sql 必须原样,无 LIMIT/OFFSET 附加
      expect(activeAdapter.executeQuery).toHaveBeenCalledWith(
        'SELECT * FROM "BBZ_CQ"."MD_PERIOD_TYPE" WHERE ROWNUM <= 100',
      );
    } finally {
      await fs.unlink(outPath).catch(() => {});
    }
  });

  it('v4.0.9: default output path is <cwd>/sql/<table>.csv when outputPath omitted', async () => {
    const pm = { loadProfile: vi.fn() } as any;
    const activeAdapter = { executeQuery: vi.fn().mockResolvedValue({ rows: [] }) };
    const handler = buildExportTableCsvHandler(pm, () => activeAdapter as any);
    const sqlDir = path.join(tmpRoot, 'sql');
    const expected = path.join(sqlDir, 'BBZ_CQ_MD_PERIOD_TYPE.csv');
    // 预创建文件 (绕过 Windows EISDIR — path-guard 的 realpathSync 找到现存文件)
    fsSync.mkdirSync(sqlDir, { recursive: true });
    fsSync.writeFileSync(expected, '', 'utf8');
    try {
      const result = await handler({
        table: 'BBZ_CQ.MD_PERIOD_TYPE',
      });
      // 返回的 totalRows 来自 adapter(空)
      expect(result.totalRows).toBe(0);
      // 文件应该被创建(由 csv-writer 写入 header)
      const stat = await fs.stat(expected);
      expect(stat.isFile()).toBe(true);
      const content = await fs.readFile(expected, 'utf8');
      // adapter 返回 0 行 + columns=['*'] → header 就是 "*"
      expect(content).toBe('*\r\n');
    } finally {
      await fs.unlink(expected).catch(() => {});
      await fs.rmdir(sqlDir).catch(() => {});
    }
  });

  it('v4.0.9: error when neither table nor sql given', async () => {
    const pm = { loadProfile: vi.fn() } as any;
    const handler = buildExportTableCsvHandler(pm, () => ({ executeQuery: vi.fn() }) as any);
    const outPath = path.join(tmpRoot, '.tmp-csv-no-args.csv');
    await fs.writeFile(outPath, '', 'utf8');
    try {
      await expect(handler({ outputPath: outPath })).rejects.toThrow(/table.*sql/);
    } finally {
      await fs.unlink(outPath).catch(() => {});
    }
  });

  // v5.0.1 Bug N9: redis adapter 不支持 export_table_csv,handler 应早抛清晰错误
  it('export_table_csv rejects redis adapter with clear message', async () => {
    const pm = { loadProfile: vi.fn() } as any;
    const redisAdapter = { config: { type: 'redis' }, executeQuery: vi.fn() } as any;
    const handler = buildExportTableCsvHandler(pm, () => redisAdapter);
    const outPath = path.join(tmpRoot, '.tmp-csv-redis-export.csv');
    fsSync.writeFileSync(outPath, '', 'utf8');
    try {
      await expect(handler({ table: 'keys_string', outputPath: outPath })).rejects.toThrow(
        /不支持.*redis|nosql/i,
      );
    } finally {
      await fs.unlink(outPath).catch(() => {});
    }
  });

  // v5.0.1 Bug N11: redis adapter 不支持 import_csv,handler 应早抛清晰错误
  it('import_csv rejects redis adapter with clear message', async () => {
    const pm = { loadProfile: vi.fn() } as any;
    const redisAdapter = { config: { type: 'redis' } } as any;
    const handler = buildImportCsvHandler(pm, () => redisAdapter);
    const inPath = path.join(tmpRoot, '.tmp-csv-redis-import.csv');
    fsSync.writeFileSync(inPath, '', 'utf8');
    try {
      await expect(handler({ table: 'k', filePath: inPath })).rejects.toThrow(
        /不支持.*redis|nosql/i,
      );
    } finally {
      await fs.unlink(inPath).catch(() => {});
    }
  });

  // v5.0.1 Bug N11 兜底: import_csv 内部 csv-reader 在 getTableInfo 返回 null 时
  // 抛清晰错误(而不是 null.map NPE)
  it('import_csv surfaces clear error when adapter.getTableInfo returns null', async () => {
    const pm = { loadProfile: vi.fn() } as any;
    // adapter 不是 redis(避免被 NoSQL guard 拦下),但 getTableInfo 返回 null
    const fakeAdapter = {
      config: { type: 'sqlite' },
      getTableInfo: vi.fn().mockResolvedValue(null),
    } as any;
    const handler = buildImportCsvHandler(pm, () => fakeAdapter);
    const inPath = path.join(tmpRoot, '.tmp-csv-null-tableinfo.csv');
    fsSync.writeFileSync(inPath, '', 'utf8');
    try {
      await expect(handler({ table: 't', filePath: inPath, dryRun: true })).rejects.toThrow(
        /getTableInfo returned null|NoSQL/i,
      );
    } finally {
      await fs.unlink(inPath).catch(() => {});
    }
  });
});