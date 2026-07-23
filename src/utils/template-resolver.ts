/**
 * Template Resolver
 * Resolves placeholders in template strings for sample data generation.
 *
 * Built-in placeholders:
 * - {year}, {month}, {day}, {date}, {timestamp}, {uuid}
 * - {sequence}, {sequence:Nd} (N-digit zero-padded sequence)
 * - {rowIndex}
 *
 * Cross-column references (column must be generated earlier in row):
 * - {column_name} (direct value)
 * - {column_name.lower} (lowercase)
 * - {column_name.upper} (uppercase)
 * - {column_name.first} (first character)
 * - {column_name.last} (last character)
 * - {column_name.pinyin} (Chinese → pinyin without tones)
 * - {column_name.pinyin.first} (Chinese → pinyin initials)
 * - {column_name.N} (first N characters)
 */

import * as pinyinNs from 'pinyin';
// pinyin is CJS — `pinyinNs.pinyin` is the function, `pinyinNs.Pinyin` is the class
const pinyin: (text: string, options?: any) => string[][] = (pinyinNs as any).pinyin;

export interface ResolveContext {
  /** Values from previously-generated columns (for cross-column references) */
  rowContext: Record<string, unknown>;
  /** Current row index (0-based) */
  rowIndex: number;
  /** Sequence provider for {sequence} */
  sequence: number;
  /** Current date */
  date: Date;
}

/**
 * Resolve all placeholders in template.
 * Unresolved placeholders are preserved as-is.
 */
export function resolveTemplate(
  template: string,
  rowContext: Record<string, unknown>,
  sequence: number,
  rowIndex: number = 0,
  date: Date = new Date()
): string {
  return template.replace(/\{([^}]+)\}/g, (match, expr) => {
    const resolved = resolveExpr(expr.trim(), { rowContext, rowIndex, sequence, date });
    return resolved ?? match;
  });
}

function resolveExpr(expr: string, ctx: ResolveContext): string | null {
  // Built-in placeholders
  if (expr === 'year') return String(ctx.date.getFullYear());
  if (expr === 'month') return String(ctx.date.getMonth() + 1).padStart(2, '0');
  if (expr === 'day') return String(ctx.date.getDate()).padStart(2, '0');
  if (expr === 'date') {
    return `${ctx.date.getFullYear()}${String(ctx.date.getMonth() + 1).padStart(2, '0')}${String(ctx.date.getDate()).padStart(2, '0')}`;
  }
  if (expr === 'timestamp') return String(Date.now());
  if (expr === 'uuid') return generateUuid();
  if (expr === 'rowIndex') return String(ctx.rowIndex);

  // Sequence with format: sequence:Nd
  const seqMatch = expr.match(/^sequence(?::0?(\d+)d)?$/);
  if (seqMatch) {
    const width = seqMatch[1] ? parseInt(seqMatch[1], 10) : 0;
    return width > 0 ? String(ctx.sequence).padStart(width, '0') : String(ctx.sequence);
  }

  // Cross-column reference: column_name[.modifier]+
  // Match compound modifiers like 'pinyin.first' before single ones
  const exprParsed = parseModifiers(expr);
  const colName = exprParsed.colName;
  const modifiers = exprParsed.modifiers;

  const value = ctx.rowContext[colName];
  if (value === undefined || value === null) {
    return null;
  }

  return applyModifiers(String(value), modifiers);
}

interface ParsedExpr {
  colName: string;
  modifiers: string[];
}

/**
 * Parse an expression like 'name.pinyin.first.lower' into:
 * - colName: 'name'
 * - modifiers: ['pinyin.first', 'lower']  (compound modifiers kept together)
 *
 * The first modifier may be compound if it's 'pinyin' or 'pinyin.first'.
 * Subsequent modifiers apply sequentially to the result.
 */
function parseModifiers(expr: string): ParsedExpr {
  const dotIdx = expr.indexOf('.');
  if (dotIdx < 0) return { colName: expr, modifiers: [] };
  const colName = expr.substring(0, dotIdx);
  let rest = expr.substring(dotIdx + 1);

  // Compound modifier handling: if rest starts with 'pinyin' or 'pinyin.first',
  // keep them together as one logical modifier
  if (rest === 'pinyin' || rest === 'pinyin.first') {
    return { colName, modifiers: [rest] };
  }
  if (rest.startsWith('pinyin.') || rest.startsWith('pinyin.first.')) {
    // e.g., 'pinyin.first.lower' or 'pinyin.lower'
    // Find boundary between 'pinyin' / 'pinyin.first' and remaining modifiers
    let compoundEnd: number;
    if (rest.startsWith('pinyin.first.')) {
      compoundEnd = 'pinyin.first'.length;
    } else {
      // rest starts with 'pinyin.' (but not 'pinyin.first.') - so 'pinyin' is alone
      compoundEnd = 'pinyin'.length;
    }
    const compound = rest.substring(0, compoundEnd);
    const remaining = rest.substring(compoundEnd + 1); // skip the '.'
    const modifiers = [compound];
    if (remaining) modifiers.push(...remaining.split('.'));
    return { colName, modifiers };
  }

  // Otherwise split remaining modifiers
  return { colName, modifiers: rest.split('.') };
}

function applyModifiers(value: string, modifiers: string[]): string {
  let result = value;
  for (const mod of modifiers) {
    switch (mod) {
      case 'lower': result = result.toLowerCase(); break;
      case 'upper': result = result.toUpperCase(); break;
      case 'first': result = result.charAt(0); break;
      case 'last': result = result.charAt(result.length - 1); break;
      case 'pinyin':
        result = pinyin(result, { style: pinyin.STYLE_NORMAL }).join('');
        break;
      case 'pinyin.first':
        result = pinyin(result, { style: pinyin.STYLE_FIRST_LETTER }).join('');
        break;
      default:
        const n = parseInt(mod, 10);
        if (!isNaN(n)) result = result.substring(0, n);
        break;
    }
  }
  return result;
}

function generateUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}