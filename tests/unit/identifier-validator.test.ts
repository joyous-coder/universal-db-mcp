import { describe, it, expect } from 'vitest';
import { validateIdentifier } from '../../src/utils/identifier-validator.js';

describe('validateIdentifier', () => {
  it('accepts simple identifier', () => {
    expect(() => validateIdentifier('users')).not.toThrow();
  });

  it('accepts underscore prefix', () => {
    expect(() => validateIdentifier('_internal')).not.toThrow();
  });

  it('accepts alphanumeric', () => {
    expect(() => validateIdentifier('users_2026')).not.toThrow();
  });

  it('rejects empty string', () => {
    expect(() => validateIdentifier('')).toThrow(/invalid identifier/i);
  });

  it('rejects SQL injection attempt', () => {
    expect(() => validateIdentifier('users; DROP TABLE x')).toThrow(/invalid identifier/i);
  });

  it('rejects identifier with spaces', () => {
    expect(() => validateIdentifier('user name')).toThrow(/invalid identifier/i);
  });

  it('rejects identifier starting with digit', () => {
    expect(() => validateIdentifier('1user')).toThrow(/invalid identifier/i);
  });

  it('accepts schema.table format when allowSchema=true', () => {
    expect(() => validateIdentifier('analytics.events', true)).not.toThrow();
  });

  it('rejects schema.table injection when allowSchema=true', () => {
    expect(() => validateIdentifier('analytics.events; DROP TABLE x', true)).toThrow(/invalid identifier/i);
  });

  it('rejects schema.table when allowSchema=false', () => {
    expect(() => validateIdentifier('analytics.events')).toThrow(/invalid identifier/i);
  });
});