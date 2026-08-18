import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readProjectProfile, writeProjectProfile } from '../../src/utils/path-resolver.js';

describe('.profile read/write (path-resolver)', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-test-'));
  });
  afterEach(async () => {
    try {
      await fs.rm(tmp, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it('reads valid .profile', async () => {
    await fs.writeFile(path.join(tmp, '.profile'), 'profile=bbz-cq-oracle\n');
    expect(readProjectProfile(tmp)).toEqual({ profile: 'bbz-cq-oracle' });
  });

  it('returns null when .profile missing', () => {
    expect(readProjectProfile(tmp)).toBeNull();
  });

  it('ignores malformed .profile (returns null)', async () => {
    await fs.writeFile(path.join(tmp, '.profile'), 'not a key value pair\n');
    expect(readProjectProfile(tmp)).toBeNull();
  });

  it('ignores malformed profile name (returns null)', async () => {
    await fs.writeFile(path.join(tmp, '.profile'), 'profile=has.dot\n');
    expect(readProjectProfile(tmp)).toBeNull();
  });

  it('writes profile=<name> to .profile', () => {
    writeProjectProfile(tmp, 'my-profile');
    const content = fsSync.readFileSync(path.join(tmp, '.profile'), 'utf8');
    expect(content).toBe('profile=my-profile\n');
  });
});