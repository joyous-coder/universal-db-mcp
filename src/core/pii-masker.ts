/**
 * PiiMasker (v3.x)
 *
 * Column-level PII masking. Strategies:
 *  - mask: replace with '***'  (default)
 *  - mask_last4: keep last 4 chars, mask rest
 *  - hash: SHA-256 hex of input (deterministic, useful for joins across rows)
 *  - redact: replace with 'REDACTED'
 *  - passthrough: no change (off-switch for a column)
 *
 * Configuration: loaded once at startup from `pii.config.json`. Configurable
 * per-profile (record-level scoping). Runtime updates via `setProfileConfig`.
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

export type MaskStrategy = 'mask' | 'mask_last4' | 'hash' | 'redact' | 'passthrough';

export interface PiiColumnConfig {
  table: string;
  column: string;
  strategy: MaskStrategy;
}

export interface PiiConfig {
  profiles: Record<string, PiiColumnConfig[]>;
}

const VALID_STRATEGIES: ReadonlyArray<MaskStrategy> = ['mask', 'mask_last4', 'hash', 'redact', 'passthrough'];

export class PiiMasker {
  private static cfg: PiiConfig = { profiles: {} };

  /**
   * Load PII configuration from a JSON file. Throws on invalid config.
   */
  static loadFromFile(path: string): PiiConfig {
    if (!existsSync(path)) return { profiles: {} };
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    this.validate(parsed);
    this.cfg = parsed;
    return this.cfg;
  }

  /** Pure validator — exported for use by config-loader. */
  static validate(cfg: unknown): asserts cfg is PiiConfig {
    if (!cfg || typeof cfg !== 'object') throw new Error('pii config: root must be an object');
    const c = cfg as Record<string, unknown>;
    if (typeof c.profiles !== 'object' || c.profiles === null) throw new Error('pii config: profiles must be an object');
    for (const [profileName, cols] of Object.entries(c.profiles as Record<string, unknown>)) {
      if (!Array.isArray(cols)) throw new Error(`pii config: profile "${profileName}" columns must be an array`);
      for (const col of cols as unknown[]) {
        if (!col || typeof col !== 'object') throw new Error(`pii config: column entry in ${profileName} must be an object`);
        const cc = col as Record<string, unknown>;
        if (typeof cc.table !== 'string' || typeof cc.column !== 'string') {
          throw new Error(`pii config: column entry missing table/column (${profileName})`);
        }
        if (!VALID_STRATEGIES.includes(cc.strategy as MaskStrategy)) {
          throw new Error(`pii config: invalid strategy "${cc.strategy}" — must be one of ${VALID_STRATEGIES.join(', ')}`);
        }
      }
    }
  }

  /** Direct setter — used by MCP / HTTP set_pii_config. */
  static setProfileConfig(profileName: string, columns: PiiColumnConfig[], replace: boolean): void {
    if (!replace) {
      const existing = this.cfg.profiles[profileName] ?? [];
      this.cfg.profiles[profileName] = [...existing, ...columns];
    } else {
      this.cfg.profiles[profileName] = columns;
    }
  }

  /** Read-only accessor — used by MCP / HTTP get_pii_config. */
  static getConfig(): PiiConfig { return this.cfg; }

  /** Apply a single strategy to a value. */
  static applyStrategy(value: unknown, strategy: MaskStrategy): unknown {
    if (value === null || value === undefined) return value;  // preserve nulls
    switch (strategy) {
      case 'mask':
        return '***';
      case 'mask_last4': {
        const s = String(value);
        if (s.length <= 4) return '****';
        return '*'.repeat(s.length - 4) + s.slice(-4);
      }
      case 'hash': {
        return createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
      }
      case 'redact':
        return 'REDACTED';
      case 'passthrough':
        return value;
      default:
        return value;
    }
  }

  /**
   * Apply masking to a list of result rows. The `table` argument is matched
   * by exact case-insensitive substring (e.g. schema='public', table='users'
   * → matches 'public.users'). Unknown tables fall through with no mask.
   */
  static mask(
    profileName: string,
    table: string,
    rows: Record<string, unknown>[],
  ): Record<string, unknown>[] {
    if (!rows || rows.length === 0) return rows;
    const cols = this.cfg.profiles[profileName];
    if (!cols || cols.length === 0) return rows;
    const tableLower = table.toLowerCase();
    const matching = cols.filter(c => c.table.toLowerCase() === tableLower);
    if (matching.length === 0) return rows;
    return rows.map(row => {
      const out = { ...row };
      for (const c of matching) {
        if (c.column in out) {
          out[c.column] = this.applyStrategy(out[c.column], c.strategy);
        }
      }
      return out;
    });
  }
}
