/**
 * QueryAnalyzer (v2.17)
 *
 * Main facade for Explain Plan / SQL Lint / query history / parameterized templates.
 * Wraps TemplateStore + HistoryStore + Explainer + lintSql + substituteParams.
 */

import { TemplateStore } from './template-store.js';
import { HistoryStore } from './history-store.js';
import { Explainer } from './explainer.js';
import { lintSql } from '../utils/sql-linter.js';
import { substituteParams } from '../utils/sql-template.js';
import type { BaseAdapter } from '../adapters/base.js';
import type { DbAdapter, QueryResult } from '../types/adapter.js';
import type {
  LintResult,
  ExplainResult,
  QueryHistoryEntry,
  QueryHistoryInput,
  HistoryFilter,
  ProfileHistoryAggregate,
  Template,
  TemplateInput,
  QueryAnalyzerOptions,
} from './query-analyzer-types.js';

export type { LintResult, ExplainResult, QueryHistoryEntry, QueryHistoryInput, HistoryFilter, Template, TemplateInput, QueryAnalyzerOptions } from './query-analyzer-types.js';

export class QueryAnalyzer {
  private templates: TemplateStore;
  private history: HistoryStore;
  private explainer: Explainer | null = null;
  private enabled: boolean;
  /** v2.19: optional callback returning the active profile name (or null). */
  private profileProvider: (() => string | null) | null = null;
  /** v5.0.0: optional callback returning per-profile templates/history paths.
   *  Returns `{templates, history}` paths OR `null` to fall back to constructor paths.
   *  Path changes trigger automatic close+reopen of stores. */
  private pathResolver: (() => { templates: string; history: string } | null) | null = null;
  /** v5.0.0: track current resolved paths to detect changes. */
  private currentTemplatesPath: string | null = null;
  private currentHistoryPath: string | null = null;
  /** v5.0.0: cipher keys reused when reopening stores at new paths. */
  private templatesCipherKey?: string;
  private historyCipherKey?: string;
  private historyTtlDays?: number;
  private historyMaxRows?: number;
  /** v2.20: rotation old keys (set at construction, consumed by KeyRotator). */
  private _templatesCipherKeyOld?: string;
  private _historyCipherKeyOld?: string;

  constructor(opts: QueryAnalyzerOptions) {
    this.enabled = opts.enabled;
    this.templates = new TemplateStore(opts.templatesDbPath, {
      cipherKey: opts.templatesCipherKey,
    });
    this.history = new HistoryStore(opts.historyDbPath, {
      ttlDays: opts.historyTtlDays,
      maxRows: opts.historyMaxRows,
      cipherKey: opts.historyCipherKey,
    });
    this.currentTemplatesPath = opts.templatesDbPath;
    this.currentHistoryPath = opts.historyDbPath;
    // v5.0.0: stash options so we can reopen stores at new paths
    this.templatesCipherKey = opts.templatesCipherKey;
    this.historyCipherKey = opts.historyCipherKey;
    this.historyTtlDays = opts.historyTtlDays;
    this.historyMaxRows = opts.historyMaxRows;
    // v2.20: cipherKeyOld is exposed via {{getCipherKeyOld}} accessor pattern
    // (currently used only by KeyRotator, not by init — see Task 3).
    this._templatesCipherKeyOld = opts.templatesCipherKeyOld;
    this._historyCipherKeyOld = opts.historyCipherKeyOld;
  }

  /**
   * v5.0.0: register a callback returning per-profile templates/history DB paths.
   * When called, the function should return `{templates, history}` paths (typically
   * `getProfileDbPath(activeProfile, 'templates')` + 'history').
   * Return `null` to fall back to constructor-time default paths.
   *
   * The QueryAnalyzer auto-detects path changes (active profile switched) and
   * closes/reopens stores at the new paths. Templates written to profile A
   * stay in `<A>/templates.db`; switching to profile B writes to `<B>/templates.db`.
   */
  setProfilePathResolver(fn: (() => { templates: string; history: string } | null) | null): void {
    this.pathResolver = fn;
  }

  /** v2.20: rotation metadata accessor (consumed by KeyRotator). */
  getRotationOldKeys(): { templates?: string; history?: string } {
    return {
      templates: this._templatesCipherKeyOld,
      history: this._historyCipherKeyOld,
    };
  }

  isEnabled(): boolean { return this.enabled; }

  /**
   * v2.19: register a callback returning the currently active profile name,
   * or `null` when no profile is active (legacy single-DB mode). Whatever
   * the callback returns at recordQuery time is persisted as `profile_name`.
   * Pass `null` to clear.
   */
  setProfileProvider(fn: (() => string | null) | null): void {
    this.profileProvider = fn;
  }

  attachAdapter(adapter: BaseAdapter, dbType: string): void {
    this.explainer = new Explainer(adapter, dbType);
  }

  async explain(sql: string, params?: unknown[]): Promise<ExplainResult> {
    if (!this.enabled || !this.explainer) {
      return { db: '', sql, plan: [], raw: '', format: 'text', duration_ms: 0 };
    }
    return this.explainer.explain(sql, params);
  }

  lint(sql: string): LintResult {
    if (!this.enabled) return { sql, issues: [], hasErrors: false, hasWarnings: false };
    return lintSql(sql);
  }

  /**
   * v5.0.0: ensure stores are bound to the paths returned by the active
   * pathResolver. If paths changed since last call → close + reopen stores
   * at the new paths (SQLite requires exclusive connection per file).
   */
  private async ensureStoresAtActivePath(): Promise<void> {
    if (!this.pathResolver) return;
    const resolved = this.pathResolver();
    if (!resolved) return;
    const { templates: tPath, history: hPath } = resolved;
    if (tPath === this.currentTemplatesPath && hPath === this.currentHistoryPath) return;
    // Path changed — close old, open new
    await this.close();
    this.templates = new TemplateStore(tPath, { cipherKey: this.templatesCipherKey });
    this.history = new HistoryStore(hPath, {
      ttlDays: this.historyTtlDays,
      maxRows: this.historyMaxRows,
      cipherKey: this.historyCipherKey,
    });
    this.currentTemplatesPath = tPath;
    this.currentHistoryPath = hPath;
  }

  async recordQuery(input: QueryHistoryInput): Promise<void> {
    if (!this.enabled) return;
    await this.ensureStoresAtActivePath();
    // v2.19: inject profile_name from registered provider (if any).
    // Callers can still pass their own profile_name to override.
    const profile_name = input.profile_name !== undefined
      ? input.profile_name
      : (this.profileProvider ? this.profileProvider() : null);
    try {
      await this.history.record({ ...input, profile_name: profile_name ?? null });
    } catch (err) {
      console.error('[queryAnalyzer] recordQuery failed:', err);
    }
  }

  async getHistory(
    filter?: HistoryFilter,
  ): Promise<QueryHistoryEntry[] | ProfileHistoryAggregate[]> {
    if (!this.enabled) return [];
    // v5.0.1 Bug N15: 跟其他方法(recordQuery/saveTemplate 等)一致,在读 history 前
    // 调一次 ensureStoresAtActivePath,让 HistoryStore 跟当前 active profile 切换。
    // 否则切到 test-mysql 后再 get_history 仍读到 test-pg 的 entries。
    await this.ensureStoresAtActivePath();
    return this.history.query(filter ?? {});
  }

  async saveTemplate(input: TemplateInput): Promise<Template> {
    if (!this.enabled) throw new Error('queryAnalyzer disabled');
    await this.ensureStoresAtActivePath();
    return this.templates.save(input, 'mcp');
  }

  async listTemplates(filter?: { tag?: string }): Promise<Template[]> {
    if (!this.enabled) return [];
    await this.ensureStoresAtActivePath();
    return this.templates.list(filter);
  }

  async getTemplate(id: string): Promise<Template | null> {
    if (!this.enabled) return null;
    await this.ensureStoresAtActivePath();
    return this.templates.get(id);
  }

  async deleteTemplate(id: string): Promise<boolean> {
    if (!this.enabled) return false;
    await this.ensureStoresAtActivePath();
    return this.templates.delete(id);
  }

  async executeTemplate(id: string, params: Record<string, unknown>, adapter: DbAdapter): Promise<QueryResult> {
    if (!this.enabled) throw new Error('queryAnalyzer disabled');
    await this.ensureStoresAtActivePath();
    const tpl = await this.templates.get(id);
    if (!tpl) throw new Error(`template not found: ${id}`);
    const sql = substituteParams(tpl.sql, params, tpl.parameters);
    const result = await adapter.executeQuery(sql);
    await this.templates.incrementUseCount(id);
    return result;
  }

  async close(): Promise<void> {
    await this.templates.close();
    await this.history.close();
  }
}
