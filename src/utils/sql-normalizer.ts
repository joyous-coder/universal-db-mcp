/**
 * sql-normalizer (v3.1)
 *
 * Strip literals from SQL to produce a stable template that hashes the same
 * for "the same query" with different parameters. Used by PlanHistory to
 * group EXPLAIN snapshots across versions of the same logical query.
 *
 * Examples:
 *   SELECT * FROM users WHERE id = 5
 *     → SELECT * FROM users WHERE id = ?
 *   SELECT a, b FROM t WHERE a IN (1, 2, 3)
 *     → SELECT a, b FROM t WHERE a IN (?, ?, ?)
 *
 * Conservative: only replaces literals we can identify with high confidence.
 */

import { createHash } from 'node:crypto';

export interface NormalizedSql {
  template: string;
  hash: string;
}

const LITERAL_PATTERNS: [RegExp, string][] = [
  // single-quoted strings (incl. doubled-quote escapes)
  [/'([^']|'')*'/g, '?'],
  // double-quoted strings
  [/\"([^\"]|\"\")*\"/g, '?'],
  // numeric literals (int / float / negative)
  [/\b-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g, '?'],
  // boolean / null
  [/\b(?:true|false|null)\b/gi, '?'],
];

function replaceLiterals(sql: string): string {
  let out = sql;
  for (const [pattern, replacement] of LITERAL_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  // Collapse repeated `?, ?, ?` to `IN (?)` shorthand? No — keep positional
  // placeholders as-is so query_hashes distinguish different IN-list sizes.
  return out;
}

function normalizeWhitespace(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

export class SqlNormalizer {
  /** Normalize and hash SQL. */
  static normalize(sql: string): NormalizedSql {
    const template = normalizeWhitespace(replaceLiterals(sql));
    const hash = createHash('sha256').update(template).digest('hex').slice(0, 16);
    return { template, hash };
  }

  /** Just the hash. */
  static hash(sql: string): string {
    return this.normalize(sql).hash;
  }
}
