/**
 * Config env vars tests
 * Verifies DB_QUERY_TIMEOUT_MS and DB_SLOW_QUERY_THRESHOLD_MS parsing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadFromEnv } from '../../src/utils/config-loader.js';

describe('config env vars', () => {
  afterEach(() => {
    delete process.env.DB_QUERY_TIMEOUT_MS;
    delete process.env.DB_SLOW_QUERY_THRESHOLD_MS;
  });

  it('returns undefined when env vars not set', () => {
    delete process.env.DB_QUERY_TIMEOUT_MS;
    delete process.env.DB_SLOW_QUERY_THRESHOLD_MS;
    const cfg = loadFromEnv();
    expect(cfg.queryTimeoutMs).toBeUndefined();
    expect(cfg.slowQueryThresholdMs).toBeUndefined();
  });

  it('parses DB_QUERY_TIMEOUT_MS', () => {
    process.env.DB_QUERY_TIMEOUT_MS = '5000';
    const cfg = loadFromEnv();
    expect(cfg.queryTimeoutMs).toBe(5000);
  });

  it('parses DB_SLOW_QUERY_THRESHOLD_MS', () => {
    process.env.DB_SLOW_QUERY_THRESHOLD_MS = '2000';
    const cfg = loadFromEnv();
    expect(cfg.slowQueryThresholdMs).toBe(2000);
  });

  it('returns undefined for non-numeric values', () => {
    process.env.DB_QUERY_TIMEOUT_MS = 'not-a-number';
    const cfg = loadFromEnv();
    expect(cfg.queryTimeoutMs).toBeUndefined();
  });

  it('returns undefined for negative or zero values', () => {
    process.env.DB_QUERY_TIMEOUT_MS = '-1';
    process.env.DB_SLOW_QUERY_THRESHOLD_MS = '0';
    const cfg = loadFromEnv();
    expect(cfg.queryTimeoutMs).toBeUndefined();
    expect(cfg.slowQueryThresholdMs).toBeUndefined();
  });
});