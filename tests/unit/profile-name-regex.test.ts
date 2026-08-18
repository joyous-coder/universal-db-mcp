import { describe, expect, it } from 'vitest';
import { isValidProfileName } from '../../src/core/profile-manager.js';

describe('isValidProfileName', () => {
  it('accepts alphanumeric + dash + underscore', () => {
    expect(isValidProfileName('bbz-cq-oracle')).toBe(true);
    expect(isValidProfileName('prod_db_1')).toBe(true);
    expect(isValidProfileName('MyProfile123')).toBe(true);
    expect(isValidProfileName('a')).toBe(true);
  });

  it('rejects dots, spaces, Chinese, slashes', () => {
    expect(isValidProfileName('bbz.cq')).toBe(false);
    expect(isValidProfileName('has space')).toBe(false);
    expect(isValidProfileName('中文')).toBe(false);
    expect(isValidProfileName('foo/bar')).toBe(false);
    expect(isValidProfileName('foo:bar')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidProfileName('')).toBe(false);
  });
});