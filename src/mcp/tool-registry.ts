/**
 * MCP tool registry with lazy-loading by group (v3.2)
 *
 * Holds all 43 tool definitions; per-session state tracks which groups are
 * active. stdio uses sessionId='stdio-default'; SSE/Streamable HTTP use MCP
 * SDK sessionId. HTTP REST API is unaffected (does not go through here).
 */

export type ToolGroup = 'query-experience' | 'profiles' | 'data-governance' | 'index-advisor';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** null/undefined = core (always-on); otherwise = group id */
  group?: ToolGroup | null;
  /** if true, inputSchema is the light version; full schema via getFullSchema() */
  infoLazy?: boolean;
  /** full schema (for infoLazy tools) — null if not infoLazy */
  fullInputSchema?: Record<string, unknown>;
  /** handler dispatcher */
  call: (args: any, sessionId?: string) => Promise<any>;
}

export interface GroupedTools {
  core: ToolDefinition[];
  groups: Partial<Record<ToolGroup, ToolDefinition[]>>;
}

export interface RegistryConfig {
  tools: GroupedTools;
  /** DB_LAZY_LOAD_ENABLED. false = listActiveTools returns ALL tools regardless of session. */
  lazyLoadEnabled: boolean;
  /** DB_LAZY_DEFAULT_GROUP — pre-activate at construction */
  defaultActiveGroups: ToolGroup[];
}

export interface ActivateResult {
  alreadyActive: boolean;
  activeGroups: ToolGroup[];
  newlyAvailable: Array<{ name: string; description: string }>;
}

export class ToolRegistry {
  private sessionGroups = new Map<string, Set<ToolGroup>>();

  constructor(private cfg: RegistryConfig) {
    // Each session that calls listActiveTools inherits defaultActiveGroups lazily.
  }

  listActiveTools(sessionId: string): ToolDefinition[] {
    const allCore = this.cfg.tools.core;
    if (!this.cfg.lazyLoadEnabled) {
      const all = [...allCore];
      for (const g of Object.keys(this.cfg.tools.groups) as ToolGroup[]) {
        all.push(...(this.cfg.tools.groups[g] ?? []));
      }
      return all;
    }
    const active = this.getSessionActiveSet(sessionId);
    const out = [...allCore];
    for (const g of active) {
      out.push(...(this.cfg.tools.groups[g] ?? []));
    }
    return out;
  }

  activateGroup(sessionId: string, group: ToolGroup): ActivateResult {
    const active = this.getSessionActiveSet(sessionId);
    const alreadyActive = active.has(group);
    if (!alreadyActive) active.add(group);
    const tools = this.cfg.tools.groups[group] ?? [];
    return {
      alreadyActive,
      activeGroups: Array.from(active),
      newlyAvailable: alreadyActive ? [] : tools.map(t => ({ name: t.name, description: t.description })),
    };
  }

  getFullSchema(toolName: string): Record<string, unknown> | null {
    for (const t of this.cfg.tools.core) {
      if (t.name === toolName && t.infoLazy) return t.fullInputSchema ?? null;
    }
    for (const g of Object.keys(this.cfg.tools.groups) as ToolGroup[]) {
      for (const t of this.cfg.tools.groups[g] ?? []) {
        if (t.name === toolName && t.infoLazy) return t.fullInputSchema ?? null;
      }
    }
    return null;
  }

  isToolActive(sessionId: string, name: string): boolean {
    // infoLazy tools are stateful — execution lives in mcp-server switch.
    // They should NOT be routed through this.callTool (stub returns error).
    // Returning false makes mcp-server fall through to the switch.
    if (this.cfg.tools.core.some(t => t.name === name && t.infoLazy)) return false;
    // Core (non-infoLazy) tools always active
    if (this.cfg.tools.core.some(t => t.name === name)) return true;
    if (!this.cfg.lazyLoadEnabled) return true;
    const active = this.getSessionActiveSet(sessionId);
    for (const g of active) {
      if ((this.cfg.tools.groups[g] ?? []).some(t => t.name === name)) return true;
    }
    return false;
  }

  getActiveGroups(sessionId: string): ToolGroup[] {
    return Array.from(this.getSessionActiveSet(sessionId));
  }

  findToolByName(name: string): ToolDefinition | undefined {
    return this.findTool(name);
  }

  async callTool(name: string, args: any, sessionId?: string): Promise<any> {
    const t = this.findTool(name);
    if (!t) throw new Error(`tool not found: ${name}`);
    return t.call(args, sessionId);
  }

  validateArgs(toolName: string, args: any): { ok: boolean; hint?: string; error?: string } {
    const t = this.findTool(toolName);
    if (!t) return { ok: false, error: `tool ${toolName} not found` };
    const schema = t.fullInputSchema ?? t.inputSchema;
    const required = (schema as any).required as string[] | undefined;
    if (!required) return { ok: true };
    const missing = required.filter(k => args?.[k] === undefined);
    if (missing.length > 0) {
      return {
        ok: false,
        error: `missing required: ${missing.join(', ')}`,
        hint: t.infoLazy
          ? `call use_tool_schema({ name: "${toolName}" }) to load full schema`
          : undefined,
      };
    }
    return { ok: true };
  }

  private getSessionActiveSet(sessionId: string): Set<ToolGroup> {
    let s = this.sessionGroups.get(sessionId);
    if (!s) {
      s = new Set(this.cfg.defaultActiveGroups);
      this.sessionGroups.set(sessionId, s);
    }
    return s;
  }

  private findTool(name: string): ToolDefinition | undefined {
    const core = this.cfg.tools.core.find(t => t.name === name);
    if (core) return core;
    for (const g of Object.keys(this.cfg.tools.groups) as ToolGroup[]) {
      const t = (this.cfg.tools.groups[g] ?? []).find(x => x.name === name);
      if (t) return t;
    }
    return undefined;
  }
}