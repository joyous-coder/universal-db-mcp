/**
 * SQL Template (v2.17)
 *
 * Substitute ${param} placeholders with type-checked, SQL-safe values.
 * sql_identifier type reuses v2.15.0 validateIdentifier for whitelist.
 */

import { validateIdentifier } from './identifier-validator.js';
import type { TemplateParam } from '../core/query-analyzer-types.js';

export function substituteParams(
  sql: string,
  params: Record<string, unknown>,
  paramDefs: TemplateParam[]
): string {
  // Validate all params first
  for (const def of paramDefs) {
    const v = params[def.name];
    if (v === undefined || v === null) {
      if (def.required && def.default === undefined) {
        throw new Error(`missing required param: ${def.name}`);
      }
    }
  }
  return sql.replace(/\$\{(\w+)\}/g, (_, name) => {
    const def = paramDefs.find(p => p.name === name);
    if (!def) throw new Error(`unknown placeholder: ${name}`);
    const v = params[name] ?? def.default;
    if (v === undefined || v === null) return 'NULL';
    switch (def.type) {
      case 'string':
      case 'date':
        return `'${String(v).replace(/'/g, "''")}'`;
      case 'number':
        if (typeof v !== 'number' && !/^-?\d+(\.\d+)?$/.test(String(v))) {
          throw new Error(`param ${name} must be number, got: ${v}`);
        }
        return String(v);
      case 'boolean':
        return v ? '1' : '0';
      case 'sql_identifier': {
        if (typeof v !== 'string') {
          throw new Error(`param ${name} must be string for sql_identifier, got: ${typeof v}`);
        }
        try {
          validateIdentifier(v);
        } catch {
          throw new Error(`invalid identifier for param ${name}: ${v}`);
        }
        return v;
      }
      default:
        return `'${String(v).replace(/'/g, "''")}'`;
    }
  });
}
