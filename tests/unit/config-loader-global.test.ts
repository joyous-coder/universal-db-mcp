import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * v4.2.0: config-loader 默认路径必须用 ~/.universal-db-mcp
 * cwd 相对 fallback 已删除
 */
describe('config-loader v4.2.0 defaults', () => {
  let orig: Record<string, string | undefined>;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let tmpCwd: string;

  beforeEach(async () => {
    orig = {
      DB_GLOBAL_DIR: process.env.DB_GLOBAL_DIR,
      DB_PROFILES_DB_PATH: process.env.DB_PROFILES_DB_PATH,
      DB_HISTORY_DB_PATH: process.env.DB_HISTORY_DB_PATH,
      DB_TEMPLATES_DB_PATH: process.env.DB_TEMPLATES_DB_PATH,
      DB_PLAN_HISTORY_DB_PATH: process.env.DB_PLAN_HISTORY_DB_PATH,
      DB_MULTI_DB_ENABLED: process.env.DB_MULTI_DB_ENABLED,
      DB_QUERY_ANALYZER_ENABLED: process.env.DB_QUERY_ANALYZER_ENABLED,
      DB_PROFILE_ENCRYPTION_KEY: process.env.DB_PROFILE_ENCRYPTION_KEY,
      DB_HISTORY_DB_KEY: process.env.DB_HISTORY_DB_KEY,
    };
    delete process.env.DB_GLOBAL_DIR;
    delete process.env.DB_PROFILES_DB_PATH;
    delete process.env.DB_HISTORY_DB_PATH;
    delete process.env.DB_TEMPLATES_DB_PATH;
    delete process.env.DB_PLAN_HISTORY_DB_PATH;
    delete process.env.DB_PROFILE_ENCRYPTION_KEY;
    delete process.env.DB_HISTORY_DB_KEY;
    // v5.0.0: 测试 cwd 切到临时目录,避免真实 <cwd>/.db-profile 干扰
    // (用户项目 .db-profile 指向 bbz-cq-oracle 会让 per-profile path 优先)
    tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cfg-test-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpCwd);
  });
  afterEach(async () => {
    for (const [k, v] of Object.entries(orig)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    cwdSpy.mockRestore();
    try { await fs.rm(tmpCwd, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('profilesDbPath defaults to ~/.universal-db-mcp/profiles.db', async () => {
    process.env.DB_MULTI_DB_ENABLED = 'true';
    const { loadConfig } = await import('../../src/utils/config-loader.js');
    const cfg = loadConfig();
    expect(cfg.profileManager?.profilesDbPath).toBe(
      path.join(os.homedir(), '.universal-db-mcp', 'profiles.db'),
    );
  });

  it('historyDbPath defaults to ~/.universal-db-mcp/history.db (no _default subdir)', async () => {
    process.env.DB_QUERY_ANALYZER_ENABLED = 'true';
    const { loadConfig } = await import('../../src/utils/config-loader.js');
    const cfg = loadConfig();
    // v5.0.0: _default subdir removed — single root file is fallback when no .db-profile.
    // With .db-profile present, getProfileDbPath(activeProfile, 'history') is used.
    expect(cfg.queryAnalyzer?.historyDbPath).toBe(
      path.join(os.homedir(), '.universal-db-mcp', 'history.db'),
    );
  });

  it('templatesDbPath defaults to ~/.universal-db-mcp/templates.db (no _default subdir)', async () => {
    process.env.DB_QUERY_ANALYZER_ENABLED = 'true';
    const { loadConfig } = await import('../../src/utils/config-loader.js');
    const cfg = loadConfig();
    expect(cfg.queryAnalyzer?.templatesDbPath).toBe(
      path.join(os.homedir(), '.universal-db-mcp', 'templates.db'),
    );
  });

  // v5.0.0: with .db-profile present, paths follow per-profile subdir
  it('historyDbPath follows per-profile subdir when .db-profile is present', async () => {
    // .db-profile in our tmp cwd points to bbz-cq-oracle (mimicking user's setup)
    await fs.writeFile(path.join(tmpCwd, '.db-profile'), 'profile=bbz-cq-oracle\n');
    process.env.DB_QUERY_ANALYZER_ENABLED = 'true';
    const { loadConfig } = await import('../../src/utils/config-loader.js');
    const cfg = loadConfig();
    expect(cfg.queryAnalyzer?.historyDbPath).toBe(
      path.join(os.homedir(), '.universal-db-mcp', 'bbz-cq-oracle', 'history.db'),
    );
    expect(cfg.queryAnalyzer?.templatesDbPath).toBe(
      path.join(os.homedir(), '.universal-db-mcp', 'bbz-cq-oracle', 'templates.db'),
    );
  });

  it('explicit env var wins over default', async () => {
    process.env.DB_MULTI_DB_ENABLED = 'true';
    process.env.DB_PROFILES_DB_PATH = 'D:/custom/profiles.db';
    const { loadConfig } = await import('../../src/utils/config-loader.js');
    const cfg = loadConfig();
    expect(cfg.profileManager?.profilesDbPath).toBe('D:/custom/profiles.db');
  });

  it('v4.2.0: legacy credential env (DB_TYPE/DB_HOST/DB_USER/DB_PASSWORD) ignored with one-time stderr hint', async () => {
    process.env.DB_TYPE = 'oracle';
    process.env.DB_HOST = 'foo';
    process.env.DB_USER = 'bar';
    process.env.DB_PASSWORD = 'baz';
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { loadConfig } = await import('../../src/utils/config-loader.js');
    loadConfig();
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringMatching(/废弃|凭据|save_profile/i),
    );
    stderrSpy.mockRestore();
  });
});