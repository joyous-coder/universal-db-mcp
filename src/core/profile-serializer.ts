/**
 * Profile YAML / JSON serializer (v2.20)
 *
 * Exports profiles to a vendor-neutral text format (YAML v1.2 minimal subset
 * or JSON), with password redaction by default. Imports validate profiles
 * and reject unknown types.
 *
 * The chosen YAML subset is intentionally small — keys/strings/ints/bools,
 * lists and nested maps — sufficient for profile documents and parseable by
 * humans. We hand-roll a parser to avoid pulling in js-yaml.
 */

import type { Profile, ProfileRole } from './profile-manager.js';

/** Redaction placeholder for sensitive fields when includeSecrets=false. */
export const REDACTED = 'REDACTED';

/** Profile as exposed to YAML/JSON — config may have REDACTED passwords. */
export interface ProfileExport {
  name: string;
  description: string;
  type: string;
  config: Record<string, unknown>;
  role: ProfileRole;
  tags: string[];
  enabled: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  use_count: number;
}

/** Top-level YAML document with version tag. */
export interface ProfileYAML {
  version: 1;
  profiles: ProfileExport[];
}

export type ImportMode = 'merge' | 'replace';

export interface ImportResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
}

/** Known profile `type` values (sync with `createAdapter` in adapter-factory). */
const KNOWN_TYPES = new Set([
  'sqlite', 'mysql', 'postgresql', 'redis', 'oracle', 'dameng', 'dm',
  'mssql', 'sqlserver', 'mongodb', 'mongo', 'kingbase', 'kingbasees',
  'gaussdb', 'opengauss', 'oceanbase', 'tidb', 'pingcap', 'clickhouse',
  'polardb', 'vastbase', 'highgo', 'goldendb',
]);

const KNOWN_ROLES = new Set<ProfileRole>(['primary', 'replica', 'analytics']);

/** Detect whether a config object likely contains a sensitive field. */
function isSensitiveKey(k: string): boolean {
  return /^(password|passwd|secret|token|key)$/i.test(k);
}

/** Deep clone a config object, replacing sensitive fields with REDACTED. */
export function redactConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (isSensitiveKey(k)) {
      out[k] = REDACTED;
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = redactConfig(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Convert a stored Profile → export shape. */
export function profileToExport(p: Profile, opts?: { includeSecrets?: boolean }): ProfileExport {
  const cfg = opts?.includeSecrets
    ? { ...p.config as unknown as Record<string, unknown> }
    : redactConfig(p.config as unknown as Record<string, unknown>);
  return {
    name: p.name,
    description: p.description,
    type: p.type,
    config: cfg,
    role: p.role,
    tags: p.tags ?? [],
    enabled: p.enabled,
    created_by: p.created_by,
    created_at: p.created_at,
    updated_at: p.updated_at,
    use_count: p.use_count,
  };
}

/**
 * Validate a profile export. Returns array of error strings (empty = OK).
 * Does NOT validate REDACTED config — that's the caller's import logic.
 */
export function validateProfileExport(p: ProfileExport): string[] {
  const errs: string[] = [];
  if (!p.name || typeof p.name !== 'string') errs.push('name missing or not a string');
  if (!p.type || typeof p.type !== 'string') errs.push('type missing or not a string');
  else if (!KNOWN_TYPES.has(p.type)) errs.push(`unknown profile type: ${p.type}`);
  if (!p.role || !KNOWN_ROLES.has(p.role)) errs.push(`role must be one of ${[...KNOWN_ROLES].join('|')}, got: ${p.role}`);
  if (typeof p.config !== 'object' || p.config === null || Array.isArray(p.config)) {
    errs.push('config must be an object');
  }
  if (!Array.isArray(p.tags)) errs.push('tags must be an array');
  if (typeof p.enabled !== 'boolean') errs.push('enabled must be a boolean');
  return errs;
}

// ============================================================================
// YAML (minimal subset) — hand-rolled to avoid js-yaml
// ============================================================================

/** Serialize a {@link ProfileYAML} to YAML text. */
export function toYAML(doc: ProfileYAML): string {
  const lines: string[] = ['version: ' + doc.version, 'profiles:'];
  for (const p of doc.profiles) {
    lines.push(`  - name: ${yamlQuote(p.name)}`);
    lines.push(`    description: ${yamlQuote(p.description)}`);
    lines.push(`    type: ${yamlQuote(p.type)}`);
    lines.push('    config:');
    lines.push(...yamlMapLines(p.config, 6));
    lines.push(`    role: ${yamlQuote(p.role)}`);
    lines.push(`    enabled: ${p.enabled ? 'true' : 'false'}`);
    lines.push(`    tags: [${p.tags.map(yamlQuote).join(', ')}]`);
    lines.push(`    created_by: ${yamlQuote(p.created_by)}`);
    lines.push(`    created_at: ${yamlQuote(p.created_at)}`);
    lines.push(`    updated_at: ${yamlQuote(p.updated_at)}`);
    lines.push(`    use_count: ${typeof p.use_count === 'number' ? p.use_count : 0}`);
  }
  return lines.join('\n') + '\n';
}

function yamlQuote(v: string): string {
  if (v === '' || /[:#\n"'[\]{}]/.test(v)) {
    return JSON.stringify(v);
  }
  return v;
}

function yamlMapLines(obj: Record<string, unknown>, indent: number): string[] {
  const pad = ' '.repeat(indent);
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) {
      out.push(`${pad}${k}: null`);
    } else if (typeof v === 'string') {
      out.push(`${pad}${k}: ${yamlQuote(v)}`);
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      out.push(`${pad}${k}: ${String(v)}`);
    } else if (Array.isArray(v)) {
      out.push(`${pad}${k}: [${v.map(x => typeof x === 'string' ? yamlQuote(x) : String(x)).join(', ')}]`);
    } else if (typeof v === 'object') {
      out.push(`${pad}${k}:`);
      out.push(...yamlMapLines(v as Record<string, unknown>, indent + 2));
    }
  }
  return out;
}

/**
 * Minimal YAML parser — supports the subset {@link toYAML} emits:
 * - 2-space indentation (no tabs)
 * - `version: N`
 * - `profiles:` then a list of `  - ...` blocks
 * - `key: value` lines
 * - `[a, b, c]` flow lists
 * - bare strings / quoted JSON strings / numbers / booleans
 */
export function parseYAML(input: string): ProfileYAML {
  const lines = input.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
  if (lines.length < 2) throw new Error('YAML too short or empty');
  const versionLine = lines[0];
  const m = /^version:\s*(\d+)\s*$/.exec(versionLine);
  if (!m) throw new Error(`expected "version: N" on first line, got: ${versionLine}`);
  if (m[1] !== '1') {
    throw new Error(`unsupported version: ${m[1]}, expected 1`);
  }
  const profilesLine = lines[1];
  if (!/^profiles:\s*$/.test(profilesLine)) {
    throw new Error(`expected "profiles:" on second line, got: ${profilesLine}`);
  }
  const profiles: ProfileExport[] = [];
  let i = 2;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.startsWith('  - ')) {
      i++;
      continue;
    }
    // Block item: starts with '  - key: value', followed by '    key: value' lines.
    const profile: Partial<ProfileExport> = {};
    profile.config = {};
    profile.tags = [];
    const firstKey = line.slice(4).split(':')[0];
    if (firstKey && firstKey !== 'name' && firstKey !== 'config') {
      // First line is "  - key: value" — extract key/value
      const [k, ...rest] = line.slice(4).split(':');
      const v = rest.join(':').trim();
      if (k.trim() === 'name') profile.name = yamlUnquote(v);
      // Note: this branch only handles one immediate key on `- line`.
      // For multi-line profiles (the case above with "  - name: ...") we
      // need to read subsequent indented lines.
    }
    if (line.slice(4).startsWith('name:')) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const [_k, ...rest] = line.slice(4).split(':');
      profile.name = yamlUnquote(rest.join(':').trim());
    }
    i++;
    // Read subsequent indented fields (until next '  - ' or EOF)
    while (i < lines.length && !lines[i].startsWith('  - ')) {
      const l = lines[i];
      if (l.startsWith('    ') && l.trim()) {
        // Strip leading '    '
        const content = l.slice(4);
        // config is nested (6 spaces), others are 4-space direct fields.
        if (l.startsWith('      ')) {
          // nested config: 6 spaces → config map
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const [ckey, ...crest] = content.split(':');
          const key = ckey.trim();
          const v = crest.join(':').trim();
          (profile.config as Record<string, unknown>)[key] = yamlValue(v);
        } else {
          const [k, ...rest] = content.split(':');
          const key = k.trim();
          const v = rest.join(':').trim();
          switch (key) {
            case 'description':
              profile.description = yamlUnquote(v); break;
            case 'type':
              profile.type = yamlUnquote(v); break;
            case 'role':
              profile.role = yamlUnquote(v) as ProfileRole; break;
            case 'enabled':
              profile.enabled = v === 'true'; break;
            case 'tags': {
              const m = /^\[(.*)\]$/.exec(v);
              if (m) {
                profile.tags = m[1].split(',').map(s => yamlUnquote(s.trim())).filter(Boolean);
              }
              break;
            }
            case 'created_by':
              profile.created_by = yamlUnquote(v); break;
            case 'created_at':
              profile.created_at = yamlUnquote(v); break;
            case 'updated_at':
              profile.updated_at = yamlUnquote(v); break;
            case 'use_count':
              profile.use_count = Number(v); break;
            case 'config':
              profile.config = {};
              // Skip sub-content (already handled in nested branch above)
              break;
            default:
              // ignore unknown field
              break;
          }
        }
      }
      i++;
    }
    profiles.push(profile as ProfileExport);
  }
  return { version: 1 as const, profiles };
}

function yamlUnquote(v: string): string {
  v = v.trim();
  if (v.startsWith('"') && v.endsWith('"')) return JSON.parse(v);
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  return v;
}

function yamlValue(v: string): unknown {
  v = v.trim();
  if (v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (/^-?\d+\.\d+$/.test(v)) return Number(v);
  return yamlUnquote(v);
}

// ============================================================================
// JSON — straightforward
// ============================================================================

export function toJSON(doc: ProfileYAML): string {
  return JSON.stringify(doc, null, 2) + '\n';
}

export function parseJSON(input: string): ProfileYAML {
  const parsed = JSON.parse(input);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('JSON root must be an object');
  }
  if (parsed.version !== 1) {
    throw new Error(`unsupported version: ${parsed.version}, expected 1`);
  }
  if (!Array.isArray(parsed.profiles)) {
    throw new Error('profiles must be an array');
  }
  return parsed as ProfileYAML;
}

// ============================================================================
// Convenience facade
// ============================================================================

export class ProfileSerializer {
  static toYAML(profiles: Profile[], opts?: { includeSecrets?: boolean }): string {
    return toYAML({ version: 1, profiles: profiles.map(p => profileToExport(p, opts)) });
  }

  static toJSON(profiles: Profile[], opts?: { includeSecrets?: boolean }): string {
    return toJSON({ version: 1, profiles: profiles.map(p => profileToExport(p, opts)) });
  }

  static parse(input: string, format: 'yaml' | 'json'): ProfileYAML {
    return format === 'json' ? parseJSON(input) : parseYAML(input);
  }

  static validate(p: ProfileExport): string[] {
    return validateProfileExport(p);
  }
}
