/**
 * Path Guard Tests
 * Tests file path validation against allowlist.
 */

import { describe, it, expect } from 'vitest';
import { resolveAndValidatePath } from '../../src/utils/path-guard.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

describe('resolveAndValidatePath', () => {
  const allowedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'allowed-'));
  const blockedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blocked-'));

  it('accepts path within allowed dir', () => {
    const filePath = path.join(allowedDir, 'safe.sql');
    fs.writeFileSync(filePath, '');
    const result = resolveAndValidatePath(filePath, [allowedDir], process.cwd());
    expect(result).toBe(fs.realpathSync(filePath));
  });

  it('rejects path outside allowed dirs', () => {
    const filePath = path.join(blockedDir, 'secret.sql');
    fs.writeFileSync(filePath, '');
    expect(() => resolveAndValidatePath(filePath, [allowedDir], process.cwd())).toThrow(/not in allowlist/i);
  });

  it('rejects path traversal attempt', () => {
    expect(() => resolveAndValidatePath(path.join(allowedDir, '..', 'secret.sql'), [allowedDir], process.cwd())).toThrow(/not in allowlist/i);
  });

  it('throws when no allowed dirs', () => {
    expect(() => resolveAndValidatePath('anywhere.sql', [], process.cwd())).toThrow(/not in allowlist/i);
  });
});