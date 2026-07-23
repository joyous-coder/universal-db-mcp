/**
 * Script Permission Tests
 * Tests the script permission gating for execute_script and execute_sql_file.
 */

import { describe, it, expect } from 'vitest';
import { resolvePermissions } from '../../src/utils/safety.js';

describe('resolvePermissions with script/batch', () => {
  it('safe preset does NOT include script', () => {
    expect(resolvePermissions({ type: 'mysql', permissionMode: 'safe' })).toEqual(['read']);
  });

  it('readwrite preset does NOT include script', () => {
    expect(resolvePermissions({ type: 'mysql', permissionMode: 'readwrite' })).toEqual(['read', 'insert', 'update']);
  });

  it('full preset does NOT include script or batch (double opt-in required)', () => {
    expect(resolvePermissions({ type: 'mysql', permissionMode: 'full' })).toEqual(['read', 'insert', 'update', 'delete', 'ddl']);
  });

  it('custom permissions including script', () => {
    expect(resolvePermissions({ type: 'mysql', permissions: ['script'] })).toEqual(['read', 'script']);
  });

  it('custom permissions including batch', () => {
    expect(resolvePermissions({ type: 'mysql', permissions: ['batch'] })).toEqual(['read', 'batch']);
  });

  it('custom permissions with both script and batch', () => {
    expect(resolvePermissions({ type: 'mysql', permissions: ['script', 'batch'] })).toEqual(['read', 'script', 'batch']);
  });

  it('custom permissions deduplicates with read', () => {
    // 'read' is auto-added; if user explicitly includes it, no duplicate
    const result = resolvePermissions({ type: 'mysql', permissions: ['read', 'script'] });
    expect(result).toEqual(['read', 'script']);
    expect(result.length).toBe(2);
  });
});