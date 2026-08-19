/**
 * SQL Statement Parser (v2 — dialect-aware PL/blocks)
 *
 * Splits a SQL script into individual statements, handling:
 * - String literals (single quotes with doubled-quote escape)
 * - Quoted identifiers (double quotes)
 * - Line comments (-- prefix)
 * - Block comments (slash-star ... star-slash)
 * - PL/SQL & PL/pgSQL BEGIN...END blocks (tracks depth, with END IF/LOOP/CASE lookahead)
 * - Oracle/DM standalone `/` block terminator
 * - PostgreSQL `$$ ... $$` DO blocks
 * - SQL Server `GO` statement separator
 * - MySQL DELIMITER directive
 *
 * v2 changes:
 *   - END lookahead: `END IF` / `END LOOP` / `END CASE` / `END WHILE` 不减 depth
 *   - Oracle `/` standalone terminator (line containing only `/`)
 *   - PostgreSQL `$$` dollar-quoted block
 *   - SQL Server `GO` standalone terminator
 *   - All gated by dialect parameter so non-applicable dialects skip these
 */

import type { DbType } from './adapter-factory.js';

/** Dialects that use Oracle-style `/` as block terminator. */
const ORACLE_DIALECTS: ReadonlySet<DbType> = new Set<DbType>([
  'oracle', 'dm',
]);
/** Dialects that support `$$ ... $$` dollar-quoted DO blocks. */
const PG_DIALECTS: ReadonlySet<DbType> = new Set<DbType>([
  'postgres', 'kingbase', 'gaussdb', 'vastbase', 'highgo',
]);
/** Dialects that use `GO` as batch separator. */
const MSSQL_DIALECTS: ReadonlySet<DbType> = new Set<DbType>([
  'sqlserver',
]);
/** Dialects that support DELIMITER directive. */
const MYSQL_DIALECTS: ReadonlySet<DbType> = new Set<DbType>([
  'mysql', 'tidb', 'oceanbase', 'polardb', 'goldendb',
]);

/** Inner block terminators that should NOT decrement block depth. */
const INNER_BLOCK_END_RE = /^(IF|LOOP|CASE|WHILE)$/i;

/**
 * Split a SQL script into individual statements.
 * Returns array of statements (may include empty strings as trailing artifacts).
 */
export function splitStatements(script: string, dialect: DbType = 'mysql'): string[] {
  if (!script || typeof script !== 'string') return [];

  // MySQL DELIMITER handling (pre-pass)
  if (MYSQL_DIALECTS.has(dialect)) {
    script = normalizeMysqlDelimiter(script);
  }

  const statements: string[] = [];
  let current = '';
  let i = 0;
  let blockDepth = 0; // BEGIN...END nesting (only outer END counts)
  let declareSection = false; // v2: inside DECLARE...BEGIN, suppress `;` split
  let inString = false;
  let stringChar = '';
  let inLineComment = false;
  let inBlockComment = false;
  let inDollarQuote = false; // PG $$ ... $$ mode
  const oracleSlash = ORACLE_DIALECTS.has(dialect);
  const mssqlGo = MSSQL_DIALECTS.has(dialect);
  const pgDollar = PG_DIALECTS.has(dialect);

  while (i < script.length) {
    const ch = script[i];
    const next = i + 1 < script.length ? script[i + 1] : '';
    const prev = i > 0 ? script[i - 1] : '';

    // Handle line comments
    if (inLineComment) {
      current += ch;
      if (ch === '\n') inLineComment = false;
      i++;
      continue;
    }

    // Handle block comments
    if (inBlockComment) {
      current += ch;
      if (ch === '*' && next === '/') {
        current += next;
        i += 2;
        inBlockComment = false;
        continue;
      }
      i++;
      continue;
    }

    // Handle strings
    if (inString) {
      current += ch;
      if (ch === stringChar && prev !== '\\') {
        inString = false;
      }
      i++;
      continue;
    }

    // PG $$ dollar quote mode — bypass all other parsing until closing $$
    if (pgDollar && inDollarQuote) {
      current += ch;
      if (ch === '$' && next === '$') {
        current += next;
        i += 2;
        inDollarQuote = false;
        continue;
      }
      i++;
      continue;
    }

    // Detect start of string
    if (ch === "'" || ch === '"') {
      inString = true;
      stringChar = ch;
      current += ch;
      i++;
      continue;
    }

    // Detect start of line comment
    if (ch === '-' && next === '-') {
      inLineComment = true;
      current += ch;
      i++;
      continue;
    }

    // Detect start of block comment
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      current += ch;
      i++;
      continue;
    }

    // PG: $$ start of dollar-quoted block
    if (pgDollar && ch === '$' && next === '$') {
      inDollarQuote = true;
      current += '$$';
      i += 2;
      continue;
    }

    // Oracle/DM: standalone `/` on its own line = block terminator
    if (oracleSlash && blockDepth === 0 && ch === '/' && isLineOnlyWhitespace(current)) {
      i++;
      while (i < script.length && (script[i] === ' ' || script[i] === '\t')) i++;
      if (i < script.length && script[i] === '\n') i++;
      if (current.trim()) {
        statements.push(current.trim());
        current = '';
      }
      continue;
    }

    // SQL Server: standalone `GO` on its own line = batch separator
    if (mssqlGo && blockDepth === 0 && isLineOnlyWhitespace(current)) {
      if (matchesKeyword(script, i, 'GO')) {
        const afterGo = i + 2;
        const afterCh = afterGo < script.length ? script[afterGo] : '';
        if (afterCh === '' || afterCh === '\n' || afterCh === '\r' || afterCh === ' ' || afterCh === '\t') {
          i = afterGo;
          while (i < script.length && (script[i] === ' ' || script[i] === '\t')) i++;
          if (i < script.length && script[i] === '\n') i++;
          if (current.trim()) {
            statements.push(current.trim());
            current = '';
          }
          continue;
        }
      }
    }

    // v2: Detect DECLARE...BEGIN (PL/SQL anonymous block header)
    // Don't split on `;` inside DECLARE section — wait for BEGIN
    if (isWordBoundary(current) || current === '') {
      if (matchesKeyword(script, i, 'DECLARE') && blockDepth === 0) {
        declareSection = true;
      } else if (matchesKeyword(script, i, 'BEGIN')) {
        blockDepth++;
        declareSection = false;
      } else if (matchesKeyword(script, i, 'END')) {
        const nextTok = peekNextToken(script, i + 3);
        if (nextTok && INNER_BLOCK_END_RE.test(nextTok)) {
          // inner block end — don't decrement
        } else {
          if (blockDepth > 0) blockDepth--;
        }
      }
    }

    // Split on top-level semicolon (suppress in DECLARE section, in dollar quote, in PL block)
    if (ch === ';' && blockDepth === 0 && !inDollarQuote && !declareSection) {
      current += ch;
      if (current.trim()) statements.push(current.trim());
      current = '';
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}

/** Check if current buffer contains only whitespace (start of line check). */
function isLineOnlyWhitespace(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== ' ' && c !== '\t' && c !== '\r' && c !== '\n') return false;
  }
  return true;
}

/** Peek the next non-whitespace token after `pos`. Returns null if EOF. */
function peekNextToken(script: string, pos: number): string | null {
  let j = pos;
  while (j < script.length && /\s/.test(script[j])) j++;
  if (j >= script.length) return null;
  let end = j;
  while (end < script.length && /\w/.test(script[end])) end++;
  return script.substring(j, end);
}

/** Check if current buffer ends with whitespace/punctuation (word boundary). */
function isWordBoundary(s: string): boolean {
  if (s.length === 0) return true;
  const last = s[s.length - 1];
  return /\s/.test(last) || /[(){};,]/.test(last);
}

/** Match a keyword at position `pos` with word boundaries. */
function matchesKeyword(script: string, pos: number, keyword: string): boolean {
  const slice = script.substring(pos, pos + keyword.length);
  if (slice.toUpperCase() !== keyword.toUpperCase()) return false;
  const before = pos > 0 ? script[pos - 1] : ' ';
  const after = pos + keyword.length < script.length ? script[pos + keyword.length] : ' ';
  return /[\s;,()]/.test(before) && (/[\s;,()\b]/.test(after) || after === ' ');
}

/**
 * Normalize MySQL DELIMITER directive so standard semicolon splitting works.
 * Replaces custom delimiters (e.g., $$) with semicolons internally.
 */
function normalizeMysqlDelimiter(script: string): string {
  const lines = script.split('\n');
  let currentDelimiter = ';';
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^DELIMITER\s+(\S+)/i);
    if (match) {
      currentDelimiter = match[1];
      continue; // Skip the DELIMITER directive itself
    }
    result.push(line.split(currentDelimiter).join(';'));
  }

  return result.join('\n');
}