/**
 * SQL Statement Parser
 * Splits a SQL script into individual statements, handling:
 * - String literals (single quotes with doubled-quote escape)
 * - Quoted identifiers (double quotes)
 * - Line comments (-- prefix)
 * - Block comments (slash-star ... star-slash)
 * - PL/SQL BEGIN...END blocks (tracks depth)
 * - MySQL DELIMITER directive
 */

import type { DbType } from './adapter-factory.js';

/**
 * Split a SQL script into individual statements.
 * Returns array of statements (may include empty strings as trailing artifacts).
 */
export function splitStatements(script: string, dialect: DbType = 'mysql'): string[] {
  if (!script || typeof script !== 'string') return [];

  // MySQL DELIMITER handling
  if (dialect === 'mysql' || dialect === 'tidb' || dialect === 'oceanbase' || dialect === 'polardb' || dialect === 'goldendb') {
    script = normalizeMysqlDelimiter(script);
  }

  const statements: string[] = [];
  let current = '';
  let i = 0;
  let blockDepth = 0; // BEGIN...END nesting
  let inString = false;
  let stringChar = '';
  let inLineComment = false;
  let inBlockComment = false;

  while (i < script.length) {
    const ch = script[i];
    const next = script[i + 1];
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

    // Track BEGIN...END depth (case-insensitive, word boundary)
    if (isWordBoundary(current) || current === '') {
      if (matchesKeyword(script, i, 'BEGIN')) {
        blockDepth++;
      } else if (matchesKeyword(script, i, 'END')) {
        if (blockDepth > 0) blockDepth--;
      }
    }

    // Split on top-level semicolon
    if (ch === ';' && blockDepth === 0) {
      current += ch;
      statements.push(current.trim());
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

function isWordBoundary(s: string): boolean {
  if (s.length === 0) return true;
  const last = s[s.length - 1];
  return /\s/.test(last) || /[(){};,]/.test(last);
}

function matchesKeyword(script: string, pos: number, keyword: string): boolean {
  const slice = script.substring(pos, pos + keyword.length);
  if (slice.toUpperCase() !== keyword) return false;
  const before = pos > 0 ? script[pos - 1] : ' ';
  const after = pos + keyword.length < script.length ? script[pos + keyword.length] : ' ';
  return /[\s;,()]/.test(before) && /[\s;,()\b]/.test(after) || after === ' ';
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