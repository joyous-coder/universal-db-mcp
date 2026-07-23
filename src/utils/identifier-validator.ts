/**
 * Identifier Validator
 * Whitelist-validates SQL identifiers to prevent injection.
 * Used by SQLite adapter (and others) when building dynamic SQL with table/column names.
 */

const IDENT_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_IDENTIFIER_LENGTH = 128;

/**
 * Validate a single SQL identifier (table name, column name, etc.).
 * @param name - Identifier to validate
 * @param allowSchema - If true, allows "schema.table" format (each part validated separately)
 * @throws Error if identifier is invalid
 */
export function validateIdentifier(name: string, allowSchema: boolean = false): void {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`Invalid identifier: empty or non-string`);
  }
  if (name.length > MAX_IDENTIFIER_LENGTH) {
    throw new Error(`Invalid identifier: too long (${name.length} > ${MAX_IDENTIFIER_LENGTH})`);
  }

  if (allowSchema && name.includes('.')) {
    const parts = name.split('.');
    if (parts.length !== 2) {
      throw new Error(`Invalid identifier with schema: ${name} (expected schema.table)`);
    }
    if (!IDENT_REGEX.test(parts[0]) || !IDENT_REGEX.test(parts[1])) {
      throw new Error(`Invalid identifier: ${name}`);
    }
    return;
  }

  if (!IDENT_REGEX.test(name)) {
    throw new Error(`Invalid identifier: ${name}`);
  }
}