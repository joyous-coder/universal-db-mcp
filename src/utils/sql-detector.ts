/**
 * SQL Script Detector
 * Determines if a query string is a "script" (multi-statement, PL block, etc.)
 * rather than a single statement.
 */

const SCRIPT_KEYWORDS = /^\s*(BEGIN|DECLARE|CALL|CREATE\s+(OR\s+REPLACE\s+)?(PROCEDURE|FUNCTION|TRIGGER|PACKAGE)|\/\*|\()/i;

/**
 * Detect if a query looks like a multi-statement script or PL block.
 *
 * Returns true when:
 * - Starts with BEGIN, DECLARE, CALL, CREATE PROCEDURE/FUNCTION/TRIGGER/PACKAGE
 * - Contains multiple top-level statements (semicolons not inside strings/comments)
 */
export function isScriptLike(query: string): boolean {
  if (typeof query !== 'string') return false;

  const trimmed = query.trim();

  // Quick check: starts with PL keyword
  if (SCRIPT_KEYWORDS.test(trimmed)) {
    return true;
  }

  // Count top-level semicolons (rough heuristic)
  // A script has 2+ statements ending with semicolons
  const cleaned = stripStringsAndComments(trimmed);
  const semicolons = (cleaned.match(/;/g) || []).length;

  return semicolons >= 2;
}

function stripStringsAndComments(sql: string): string {
  // Remove single-quoted strings
  let result = sql.replace(/'(?:''|[^'])*'/g, "''");
  // Remove double-quoted identifiers
  result = result.replace(/"(?:""|[^"])*"/g, '""');
  // Remove line comments
  result = result.replace(/--[^\n]*/g, '');
  // Remove block comments
  result = result.replace(/\/\*[\s\S]*?\*\//g, '');
  return result;
}