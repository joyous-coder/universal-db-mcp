import { describe, it, expect, vi } from 'vitest';
import { pgConvertPlaceholders } from '../../src/adapters/postgres.js';

// Bug N10: PG `pg` driver 不支持 `?` 占位符。executeBatch 必须把每行 SQL 中的 `?`
// 按出现顺序替换为 `$1, $2, ...`。这是 csv-reader → PG adapter 的关键路径。

describe('pgConvertPlaceholders (Bug N10)', () => {
  it('replaces single ? with $1', () => {
    expect(pgConvertPlaceholders('INSERT INTO t (a) VALUES (?)', 1)).toBe(
      'INSERT INTO t (a) VALUES ($1)',
    );
  });

  it('replaces multiple ? with $1, $2, $3 in order', () => {
    expect(
      pgConvertPlaceholders('INSERT INTO t (a, b, c) VALUES (?, ?, ?)', 3),
    ).toBe('INSERT INTO t (a, b, c) VALUES ($1, $2, $3)');
  });

  it('handles ? inside string literals (still counted as placeholder, naive)', () => {
    // 注: 当前实现不做 SQL 解析,字符串里的 `?` 也会被替换。
    // 这是已知限制 — 在 N10 范围内可接受;更严格需要 SQL 词法分析,后续 v5.1 优化。
    const sql = "UPDATE t SET name = '?' WHERE id = ?";
    expect(pgConvertPlaceholders(sql, 2)).toBe(
      "UPDATE t SET name = '$1' WHERE id = $2",
    );
  });

  it('passes through SQL without ? unchanged', () => {
    const sql = 'SELECT 1';
    expect(pgConvertPlaceholders(sql, 0)).toBe('SELECT 1');
  });

  it('handles UPDATE WHERE ? + ? = ? pattern', () => {
    expect(
      pgConvertPlaceholders('UPDATE users SET status = ? WHERE id = ? AND age = ?', 3),
    ).toBe('UPDATE users SET status = $1 WHERE id = $2 AND age = $3');
  });
});