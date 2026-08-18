import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildUseProfileHandler } from '../../src/mcp/tools/profile-tools.js';

describe('use_profile recordToProject', () => {
  let tmp: string;
  let pm: any;
  let cwdSpy: any;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'use-profile-test-'));
    // mock process.cwd() to tmp — 避免 vitest worker 不支持 chdir 的限制
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmp);
    pm = {
      loadProfile: vi.fn().mockResolvedValue({
        profile: { name: 'test-prof', type: 'oracle', role: 'primary', config: {} },
        adapter: {},
        service: {},
      }),
    };
  });
  afterEach(async () => {
    cwdSpy.mockRestore();
    try {
      await fs.rm(tmp, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it('omitting recordToProject does NOT write .profile', async () => {
    const handler = buildUseProfileHandler(pm);
    await handler({ name: 'test-prof' });
    const exists = await fs.stat(path.join(tmp, '.profile')).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  it('recordToProject=true writes .profile with profile=<name>', async () => {
    const handler = buildUseProfileHandler(pm);
    await handler({ name: 'test-prof', recordToProject: true });
    const content = await fs.readFile(path.join(tmp, '.profile'), 'utf8');
    expect(content).toBe('profile=test-prof\n');
  });

  it('recordToProject=true overwrites existing .profile', async () => {
    await fs.writeFile(path.join(tmp, '.profile'), 'profile=old\n');
    const handler = buildUseProfileHandler(pm);
    await handler({ name: 'test-prof', recordToProject: true });
    const content = await fs.readFile(path.join(tmp, '.profile'), 'utf8');
    expect(content).toBe('profile=test-prof\n');
  });
});