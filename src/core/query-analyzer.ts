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
    // v2.20: cipherKeyOld is exposed via {{getCipherKeyOld}} accessor pattern
    // (currently used only by KeyRotator, not by init — see Task 3).
    this._templatesCipherKeyOld = opts.templatesCipherKeyOld;
    this._historyCipherKeyOld = opts.historyCipherKeyOld;
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

  async recordQuery(input: QueryHistoryInput): Promise<void> {
    if (!this.enabled) return;
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
    return this.history.query(filter ?? {});
  }

  async saveTemplate(input: TemplateInput): Promise<Template> {
    if (!this.enabled) throw new Error('queryAnalyzer disabled');
    return this.templates.save(input, 'mcp');
  }

  async listTemplates(filter?: { tag?: string }): Promise<Template[]> {
    if (!this.enabled) return [];
    return this.templates.list(filter);
  }

  async getTemplate(id: string): Promise<Template | null> {
    if (!this.enabled) return null;
    return this.templates.get(id);
  }

  async deleteTemplate(id: string): Promise<boolean> {
    if (!this.enabled) return false;
    return this.templates.delete(id);
  }

  async executeTemplate(id: string, params: Record<string, unknown>, adapter: DbAdapter): Promise<QueryResult> {
    if (!this.enabled) throw new Error('queryAnalyzer disabled');
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
