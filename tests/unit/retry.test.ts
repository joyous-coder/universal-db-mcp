/**
 * Retry Utility Tests
 * Tests the shared retry helper used by database adapters.
 */

import { describe, it, expect, vi } from 'vitest';
import { withRetry, isConnectionErrorMessage } from '../../src/utils/retry.js';

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries once on connection error then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('read ECONNRESET'))
      .mockResolvedValueOnce('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry on non-connection error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Unknown column'));
    await expect(withRetry(fn)).rejects.toThrow('Unknown column');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Connection lost'));
    await expect(withRetry(fn, { retries: 2 })).rejects.toThrow('Connection lost');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('applies backoff delay between retries', async () => {
    const start = Date.now();
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce('ok');
    await withRetry(fn, { baseDelayMs: 100 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(90); // allow some jitter
  });

  it('respects custom isRetryable with retries: 0', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('CUSTOM_ERROR'));
    await expect(withRetry(fn, {
      retries: 0,
      isRetryable: () => true // would retry but retries is 0
    })).rejects.toThrow('CUSTOM_ERROR');
    expect(fn).toHaveBeenCalledTimes(1); // only initial, no retries
  });
});

describe('isConnectionErrorMessage', () => {
  it('matches ECONNRESET', () => {
    expect(isConnectionErrorMessage('read ECONNRESET')).toBe(true);
  });

  it('matches MySQL connection lost', () => {
    expect(isConnectionErrorMessage("Can't add new command when connection is in closed state")).toBe(true);
  });

  it('matches Postgres connection terminated', () => {
    expect(isConnectionErrorMessage('Connection terminated unexpectedly')).toBe(true);
  });

  it('does not match syntax errors', () => {
    expect(isConnectionErrorMessage('syntax error')).toBe(false);
  });

  it('does not match permission errors', () => {
    expect(isConnectionErrorMessage('Access denied for user')).toBe(false);
  });
});