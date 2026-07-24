/**
 * SQL Linter (v2.17)
 *
 * Pure-rule lint engine: 10 regex-based rules. No IO, sync.
 * Output is advisory — caller decides whether to block (we don't).
 */

export type LintSeverity = 'error' | 'warning' | 'info';

export interface LintIssue {
  rule: string;
  severity: LintSeverity;
  message: string;
  suggestion?: string;
}

export interface LintResult {
  sql: string;
  issues: LintIssue[];
  hasErrors: boolean;
  hasWarnings: boolean;
}

type Rule = (sql: string) => LintIssue | null;

const RULES: Rule[] = [
  // 1. select-star
  (sql) => {
    if (/\bSELECT\s+\*/i.test(sql) && !/COUNT\s*\(\s*\*/i.test(sql)) {
      return {
        rule: 'select-star',
        severity: 'warning',
        message: 'Avoid SELECT * — specify columns explicitly',
        suggestion: 'List the columns you need',
      };
    }
    return null;
  },
  // 2. no-where-update (UPDATE/DELETE without WHERE)
  (sql) => {
    const m = sql.match(/^\s*(UPDATE|DELETE\s+FROM)\s+(\S+)/i);
    if (m && !/\bWHERE\b/i.test(sql)) {
      return {
        rule: 'no-where-update',
        severity: 'error',
        message: `${m[1].toUpperCase()} without WHERE affects all rows`,
      };
    }
    return null;
  },
  // 3. no-limit-update
  (sql) => {
    if (/^\s*(UPDATE|DELETE\s+FROM)\s+/i.test(sql) && /\bWHERE\b/i.test(sql) && !/\bLIMIT\b/i.test(sql)) {
      return {
        rule: 'no-limit-update',
        severity: 'warning',
        message: 'UPDATE/DELETE without LIMIT — add LIMIT to bound damage',
      };
    }
    return null;
  },
  // 4. in-thousand
  (sql) => {
    const m = sql.match(/\bIN\s*\(\s*([^)]+)\)/i);
    if (m && m[1].split(',').length > 1000) {
      return {
        rule: 'in-thousand',
        severity: 'warning',
        message: 'IN clause has > 1000 items — use a temp table or JOIN',
      };
    }
    return null;
  },
  // 5. leading-wildcard-like
  (sql) => {
    if (/\bLIKE\s+['"]%/i.test(sql)) {
      return {
        rule: 'leading-wildcard-like',
        severity: 'warning',
        message: 'Leading wildcard LIKE cannot use index',
      };
    }
    return null;
  },
  // 6. distinct-without-index-hint
  (sql) => {
    if (/\bSELECT\s+DISTINCT\b/i.test(sql)) {
      return {
        rule: 'distinct-without-index-hint',
        severity: 'info',
        message: 'DISTINCT may be slow without index — verify covering index exists',
      };
    }
    return null;
  },
  // 7. union-vs-union-all
  (sql) => {
    if (/\bUNION\s+(?!ALL\b)/i.test(sql)) {
      return {
        rule: 'union-vs-union-all',
        severity: 'info',
        message: 'UNION dedupes — use UNION ALL if duplicates are OK',
      };
    }
    return null;
  },
  // 8. order-by-no-limit
  (sql) => {
    if (/\bORDER\s+BY\b/i.test(sql) && !/\bLIMIT\b/i.test(sql) && /^\s*SELECT\b/i.test(sql)) {
      return {
        rule: 'order-by-no-limit',
        severity: 'info',
        message: 'ORDER BY without LIMIT may sort large result sets',
      };
    }
    return null;
  },
  // 9. double-quoted-identifier
  (sql) => {
    if (/"[a-zA-Z_][a-zA-Z0-9_]*"/.test(sql)) {
      return {
        rule: 'double-quoted-identifier',
        severity: 'warning',
        message: 'Double-quoted identifier — use backticks (MySQL) or square brackets (SQL Server)',
      };
    }
    return null;
  },
];

export function lintSql(sql: string): LintResult {
  const issues: LintIssue[] = [];
  for (const rule of RULES) {
    const issue = rule(sql);
    if (issue) issues.push(issue);
  }
  return {
    sql,
    issues,
    hasErrors: issues.some(i => i.severity === 'error'),
    hasWarnings: issues.some(i => i.severity === 'warning'),
  };
}
