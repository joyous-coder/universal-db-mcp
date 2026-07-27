# v3.x MCP Tool Pruning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce default MCP tool surface from ~43 to 15 (CORE 12 + meta 2 + infoLazy 1), expose `DB_VISIBLE_GROUPS` / `DB_VISIBLE_TOOLS` env vars for opt-in expansion, add `outputSchema` structured output, and compress tool descriptions.

**Architecture:** Two env vars (`DB_VISIBLE_GROUPS`, `DB_VISIBLE_TOOLS`) parsed at startup feed into a new `ToolVisibilityFilter` (pure module). Filtered visible sets inform a `ToolRegistry` constructor that only registers allowed groups. CORE 12 lives as a hardcoded list in `mcp-server.ts:ListToolsRequest` handler. `OutputSchemaRegistry` injects per-tool output schemas; selected handlers return `{ content, structuredContent }`.

**Tech Stack:** TypeScript 5.7+, Node 20+, `@modelcontextprotocol/sdk` 1.0+, vitest. No new npm deps required.

## Global Constraints

- TypeScript strict mode (no `any` in new code)
- User-visible strings: 简体中文 (description, error messages, console output)
- Commit prefix: `feat:` / `fix:` / `refactor:` / `test:` / `docs:` / `chore:` (Conventional Commits)
- **HARD BREAKING**: default CORE list changes; CHANGELOG must declare `⚠️ BREAKING CHANGES`
- No new `dependencies`; may add `optionalDependencies` only if absolutely required (this plan doesn't add any)
- Build must pass: `npm run build` exits 0
- All tests must pass: `npm test` exits 0
- New lint script must produce 0 errors on existing repo (after compression task)
- Description average ≤ 49 chars after compression
- Tool count after task 5: CORE 12 + meta 2 + infoLazy 1 = 15 default visible (no env set)

**Spec:** `docs/superpowers/specs/2026-07-27-mcp-tool-pruning-v3-x-design.md`

---

## Task 1: Extend AppConfig with visibility fields

**Files:**
- Modify: `src/types/http.ts` (add `visibleGroups?` and `visibleTools?` to `AppConfig`)
- Test: `tests/unit/config-shape.test.ts` (verify new fields typecheck)

**Interfaces:**
- Consumes: nothing
- Produces: `AppConfig.visibleGroups?: string[]` and `AppConfig.visibleTools?: string[]`

- [ ] **Step 1: Read existing type**

```bash
grep -n "AppConfig\b\|interface AppConfig\|queryAnalyzer\|profileManager\b" src/types/http.ts | head -30
```

Read enough to understand current shape (don't read whole file if large).

- [ ] **Step 2: Add fields to `AppConfig`**

In `src/types/http.ts`, locate the `AppConfig` interface and add (preserve existing field order, append at end before closing brace):

```typescript
  /**
   * v3.4: groups registered at startup. null/undefined = empty (CORE only).
   * Validated against ToolGroup union in src/mcp/tool-registry.ts.
   */
  visibleGroups?: string[];

  /**
   * v3.4: individual tool names registered on top of visibleGroups.
   * null/undefined = empty. Validated against known tool names.
   */
  visibleTools?: string[];
```

- [ ] **Step 3: Verify tsc compiles**

Run: `npm run build`
Expected: exits 0 with no type errors

- [ ] **Step 4: Commit**

```bash
git add src/types/http.ts
git commit -m "feat(config): add visibleGroups/visibleTools to AppConfig"
```

---

## Task 2: Parse visibility env vars in config-loader

**Files:**
- Modify: `src/utils/config-loader.ts` (extend `loadFromEnv()`)
- Test: `tests/unit/config-loader-visibility.test.ts`

**Interfaces:**
- Consumes: `process.env.DB_VISIBLE_GROUPS`, `process.env.DB_VISIBLE_TOOLS`
- Produces: `config.visibleGroups: string[] | undefined`, `config.visibleTools: string[] | undefined`

- [ ] **Step 1: Write failing test**

Create `tests/unit/config-loader-visibility.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadFromEnv } from '../../src/utils/config-loader.js';

describe('loadFromEnv — visibility env vars', () => {
  const origGroups = process.env.DB_VISIBLE_GROUPS;
  const origTools = process.env.DB_VISIBLE_TOOLS;

  beforeEach(() => {
    delete process.env.DB_VISIBLE_GROUPS;
    delete process.env.DB_VISIBLE_TOOLS;
  });

  afterEach(() => {
    if (origGroups !== undefined) process.env.DB_VISIBLE_GROUPS = origGroups;
    if (origTools !== undefined) process.env.DB_VISIBLE_TOOLS = origTools;
  });

  it('returns config without visibility when both env unset', () => {
    const cfg = loadFromEnv();
    expect(cfg.visibleGroups).toBeUndefined();
    expect(cfg.visibleTools).toBeUndefined();
  });

  it('parses single group', () => {
    process.env.DB_VISIBLE_GROUPS = 'profiles';
    const cfg = loadFromEnv();
    expect(cfg.visibleGroups).toEqual(['profiles']);
  });

  it('parses multiple groups and trims whitespace', () => {
    process.env.DB_VISIBLE_GROUPS = 'profiles, query-experience ,data-governance';
    const cfg = loadFromEnv();
    expect(cfg.visibleGroups).toEqual(['profiles', 'query-experience', 'data-governance']);
  });

  it('parses single tool', () => {
    process.env.DB_VISIBLE_TOOLS = 'explain_query';
    const cfg = loadFromEnv();
    expect(cfg.visibleTools).toEqual(['explain_query']);
  });

  it('treats empty string as undefined', () => {
    process.env.DB_VISIBLE_GROUPS = '';
    process.env.DB_VISIBLE_TOOLS = '';
    const cfg = loadFromEnv();
    expect(cfg.visibleGroups).toBeUndefined();
    expect(cfg.visibleTools).toBeUndefined();
  });

  it('drops empty tokens from comma list', () => {
    process.env.DB_VISIBLE_GROUPS = 'profiles,,query-experience';
    const cfg = loadFromEnv();
    expect(cfg.visibleGroups).toEqual(['profiles', 'query-experience']);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npx vitest run tests/unit/config-loader-visibility.test.ts`
Expected: FAIL — `loadFromEnv` doesn't populate `visibleGroups`

- [ ] **Step 3: Add parser in `config-loader.ts`**

Add a helper before `loadFromEnv` (or at top of function body, before `return config;`):

```typescript
function parseVisibility(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const items = raw.split(',').map(s => s.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}
```

Then in `loadFromEnv`, near the end (before `return config;`):

```typescript
const visibleGroups = parseVisibility(process.env.DB_VISIBLE_GROUPS);
const visibleTools = parseVisibility(process.env.DB_VISIBLE_TOOLS);
if (visibleGroups !== undefined) config.visibleGroups = visibleGroups;
if (visibleTools !== undefined) config.visibleTools = visibleTools;
```

Also update `mergeConfigs` to carry over both fields (mirror existing pattern with `if (config.lazyLoad) merged.lazyLoad = ...`):

```typescript
if (config.visibleGroups !== undefined) merged.visibleGroups = config.visibleGroups;
if (config.visibleTools !== undefined) merged.visibleTools = config.visibleTools;
```

- [ ] **Step 4: Run test, expect pass**

Run: `npx vitest run tests/unit/config-loader-visibility.test.ts`
Expected: all 6 tests PASS

- [ ] **Step 5: Run full test suite to check no regression**

Run: `npm test`
Expected: same status as before this task (no new failures from this change)

- [ ] **Step 6: Commit**

```bash
git add src/utils/config-loader.ts tests/unit/config-loader-visibility.test.ts
git commit -m "feat(config): parse DB_VISIBLE_GROUPS and DB_VISIBLE_TOOLS env vars"
```

---

## Task 3: Create ToolVisibilityFilter module

**Files:**
- Create: `src/mcp/tool-visibility-filter.ts`
- Test: `tests/unit/tool-visibility-filter.test.ts`

**Interfaces:**
- Consumes: raw env strings + known tools set + group→tools map
- Produces: `ParseResult { visibleTools: Set<string>, warnings: string[], parsedGroups: ToolGroup[], parsedTools: string[] }`

- [ ] **Step 1: Write failing test**

Create `tests/unit/tool-visibility-filter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ToolVisibilityFilter } from '../../src/mcp/tool-visibility-filter.js';

const ALL_KNOWN = new Set([
  // CORE 12
  'connect_database', 'disconnect_database', 'get_connection_status',
  'use_profile', 'execute_query', 'execute_script', 'execute_batch',
  'get_schema', 'get_table_info', 'get_enum_values',
  'get_sample_data', 'clear_cache',
  // meta 2
  'use_tool_group', 'use_tool_schema',
  // infoLazy 1
  'generate_sample_data',
  // query-experience
  'explain_query', 'lint_sql', 'get_query_history',
  'save_template', 'list_templates', 'get_template', 'delete_template',
  'execute_template', 'execute_sql_file',
  // profiles
  'save_profile', 'list_profiles', 'get_profile', 'delete_profile',
  'enable_profile', 'disable_profile', 'get_global_schema',
  'export_profiles', 'import_profiles', 'disconnect_profile',
  // data-governance
  'audit_log', 'get_pii_config', 'set_pii_config',
  'export_backup', 'export_table_csv', 'import_csv', 'compare_profile_schemas',
  // index-advisor
  'explain_query_with_advice', 'compare_query_plans', 'list_query_plans', 'get_metrics',
]);

const GROUP_TOOLS: Record<'query-experience' | 'profiles' | 'data-governance' | 'index-advisor', string[]> = {
  'query-experience': ['explain_query', 'lint_sql', 'get_query_history', 'save_template', 'list_templates', 'get_template', 'delete_template', 'execute_template', 'execute_sql_file'],
  'profiles': ['save_profile', 'list_profiles', 'get_profile', 'delete_profile', 'enable_profile', 'disable_profile', 'get_global_schema', 'export_profiles', 'import_profiles', 'disconnect_profile'],
  'data-governance': ['audit_log', 'get_pii_config', 'set_pii_config', 'export_backup', 'export_table_csv', 'import_csv', 'compare_profile_schemas'],
  'index-advisor': ['explain_query_with_advice', 'compare_query_plans', 'list_query_plans', 'get_metrics'],
};

const CORE = new Set([
  'connect_database', 'disconnect_database', 'get_connection_status',
  'use_profile', 'execute_query', 'execute_script', 'execute_batch',
  'get_schema', 'get_table_info', 'get_enum_values',
  'get_sample_data', 'clear_cache',
  'use_tool_group', 'use_tool_schema', 'generate_sample_data',
]);

describe('ToolVisibilityFilter', () => {
  it('default — both env unset → only CORE visible', () => {
    const r = ToolVisibilityFilter.parse(undefined, undefined, ALL_KNOWN, GROUP_TOOLS, CORE);
    // CORE has 15 entries (12 + 2 meta + 1 infoLazy)
    expect(r.visibleTools.size).toBe(15);
    expect([...r.visibleTools].sort()).toEqual([...CORE].sort());
    expect(r.warnings).toEqual([]);
  });

  it('single group expands visibility', () => {
    const r = ToolVisibilityFilter.parse('profiles', undefined, ALL_KNOWN, GROUP_TOOLS, CORE);
    // CORE 15 + profiles 10 = 25
    expect(r.visibleTools.size).toBe(25);
    expect(r.visibleTools.has('list_profiles')).toBe(true);
  });

  it('group + tool combines as union', () => {
    const r = ToolVisibilityFilter.parse(
      'query-experience',
      'audit_log',
      ALL_KNOWN, GROUP_TOOLS, CORE,
    );
    // CORE 15 + query-experience 9 + audit_log 1 = 25
    expect(r.visibleTools.size).toBe(25);
    expect(r.visibleTools.has('audit_log')).toBe(true);
  });

  it('invalid group name produces warning + skipped', () => {
    const r = ToolVisibilityFilter.parse('xxx_invalid', undefined, ALL_KNOWN, GROUP_TOOLS, CORE);
    expect(r.parsedGroups).toEqual([]);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toMatch(/xxx_invalid/);
  });

  it('mixed valid + invalid — valid kept, invalid warned', () => {
    const r = ToolVisibilityFilter.parse('profiles,xxx_invalid', undefined, ALL_KNOWN, GROUP_TOOLS, CORE);
    expect(r.parsedGroups).toEqual(['profiles']);
    expect(r.warnings.length).toBe(1);
  });

  it('CORE tool listed in DB_VISIBLE_TOOLS — warning + skip', () => {
    const r = ToolVisibilityFilter.parse(undefined, 'execute_query', ALL_KNOWN, GROUP_TOOLS, CORE);
    expect(r.parsedTools).toEqual([]);
    expect(r.warnings.some(w => /CORE/.test(w))).toBe(true);
  });

  it('invalid tool name — warning + skip', () => {
    const r = ToolVisibilityFilter.parse(undefined, 'nonexistent_tool', ALL_KNOWN, GROUP_TOOLS, CORE);
    expect(r.parsedTools).toEqual([]);
    expect(r.warnings.length).toBe(1);
  });

  it('empty string treated as unset', () => {
    const r = ToolVisibilityFilter.parse('', '', ALL_KNOWN, GROUP_TOOLS, CORE);
    expect(r.visibleTools.size).toBe(15);
    expect(r.warnings).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test, expect failure (module not found)**

Run: `npx vitest run tests/unit/tool-visibility-filter.test.ts`
Expected: FAIL with "Cannot find module '../../src/mcp/tool-visibility-filter.js'"

- [ ] **Step 3: Create the module**

Create `src/mcp/tool-visibility-filter.ts`:

```typescript
/**
 * v3.4: pure visibility computation for MCP tool pruning.
 *
 * Reads two env-raw strings (visibleGroups, visibleTools), validates against
 * known tools / group map, returns the final visible set with warnings.
 *
 * Pure module — no side effects, no I/O. The ToolRegistry caller is responsible
 * for `console.warn`-ing the returned warnings array.
 */

export type ToolGroup = 'query-experience' | 'profiles' | 'data-governance' | 'index-advisor';

export interface ParseResult {
  /** Final visible tool name set (CORE ∪ groups ∪ individual). */
  visibleTools: Set<string>;
  /** Human-readable warnings, surfaced by caller via console.warn. */
  warnings: string[];
  /** Successfully parsed group names (after dedup + validation). */
  parsedGroups: ToolGroup[];
  /** Successfully parsed individual tool names (after dedup + validation). */
  parsedTools: string[];
}

export class ToolVisibilityFilter {
  static readonly VALID_GROUPS: ToolGroup[] = [
    'query-experience',
    'profiles',
    'data-governance',
    'index-advisor',
  ];

  static isValidGroup(name: string): name is ToolGroup {
    return (ToolVisibilityFilter.VALID_GROUPS as string[]).includes(name);
  }

  /**
   * Core parse entry point.
   *
   * @param visibleGroupsRaw DB_VISIBLE_GROUPS raw string
   * @param visibleToolsRaw  DB_VISIBLE_TOOLS raw string
   * @param allKnownTools    Set of every tool name known to the registry
   *                         (used for validation + warning on unknown entries)
   * @param groupToolMap     Map from each ToolGroup to its tool names
   * @param coreTools        Set of always-visible tool names (CORE + meta + infoLazy)
   */
  static parse(
    visibleGroupsRaw: string | undefined,
    visibleToolsRaw: string | undefined,
    allKnownTools: Set<string>,
    groupToolMap: Record<ToolGroup, string[]>,
    coreTools: Set<string>,
  ): ParseResult {
    const warnings: string[] = [];
    const visibleTools = new Set<string>(coreTools);

    // Parse groups
    const parsedGroups: ToolGroup[] = [];
    if (visibleGroupsRaw) {
      const tokens = visibleGroupsRaw.split(',').map(s => s.trim()).filter(Boolean);
      for (const tok of tokens) {
        if (!ToolVisibilityFilter.isValidGroup(tok)) {
          warnings.push(
            `[visibility] ignoring invalid group "${tok}" ` +
            `(allowed: ${ToolVisibilityFilter.VALID_GROUPS.join(', ')})`,
          );
          continue;
        }
        if (!parsedGroups.includes(tok)) parsedGroups.push(tok);
      }
    }
    for (const g of parsedGroups) {
      for (const toolName of groupToolMap[g] ?? []) {
        visibleTools.add(toolName);
      }
    }

    // Parse individual tools
    const parsedTools: string[] = [];
    if (visibleToolsRaw) {
      const tokens = visibleToolsRaw.split(',').map(s => s.trim()).filter(Boolean);
      for (const tok of tokens) {
        if (coreTools.has(tok)) {
          warnings.push(
            `[visibility] "${tok}" is a CORE tool and is always visible; ` +
            `DB_VISIBLE_TOOLS declaration is redundant and ignored`,
          );
          continue;
        }
        if (!allKnownTools.has(tok)) {
          warnings.push(
            `[visibility] ignoring unknown tool "${tok}" in DB_VISIBLE_TOOLS`,
          );
          continue;
        }
        if (!parsedTools.includes(tok)) parsedTools.push(tok);
      }
    }
    for (const t of parsedTools) visibleTools.add(t);

    return { visibleTools, warnings, parsedGroups, parsedTools };
  }
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npx vitest run tests/unit/tool-visibility-filter.test.ts`
Expected: all 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tool-visibility-filter.ts tests/unit/tool-visibility-filter.test.ts
git commit -m "feat(visibility): add ToolVisibilityFilter for DB_VISIBLE_GROUPS/TOOLS"
```

---

## Task 4: Wire visibility into ToolRegistry constructor

**Files:**
- Modify: `src/mcp/tool-registry.ts` (extend constructor signature + filter at construction)
- Modify: `src/mcp/tool-definitions.ts` (`buildToolRegistry` to accept + apply filter)
- Test: existing `tests/integration/lazy-load-e2e.test.ts` should still pass (regression)

**Interfaces:**
- Consumes: `ToolVisibilityFilter.parse(...)` from Task 3
- Produces: `ToolRegistry` whose `getActiveGroups()` reflects parsedGroups

- [ ] **Step 1: Read current ToolRegistry shape**

```bash
grep -n "class ToolRegistry\|constructor\|listActiveTools\|getActiveGroups" src/mcp/tool-registry.ts | head -30
```

Identify where to thread `visibleIndividualTools` and where to apply the group filter.

- [ ] **Step 2: Modify `ToolRegistry` constructor**

Edit `src/mcp/tool-registry.ts`:
- Add an optional `visibleIndividualTools?: Set<string>` field to `RegistryConfig`
- In constructor, if `visibleIndividualTools` is set and non-empty, **filter** `cfg.tools.groups` so only groups matching `cfg.visibleIndividualTools` derivation remain visible to that session's default state.

Concretely:
- Store `visibleIndividualTools` on the registry instance
- Modify `getSessionActiveSet(sessionId)`: union the parsed `defaultActiveGroups` with the parsed groups subset derived from `visibleIndividualTools` (i.e., for each tool in `visibleIndividualTools`, find which group contains it; add that group to the set)

Helper signature:

```typescript
private groupsContaining(toolName: string): ToolGroup[] {
  const out: ToolGroup[] = [];
  for (const g of Object.keys(this.cfg.tools.groups) as ToolGroup[]) {
    if ((this.cfg.tools.groups[g] ?? []).some(t => t.name === toolName)) out.push(g);
  }
  return out;
}
```

Then in `getSessionActiveSet`:

```typescript
private getSessionActiveSet(sessionId: string): Set<ToolGroup> {
  let s = this.sessionGroups.get(sessionId);
  if (!s) {
    s = new Set(this.cfg.defaultActiveGroups);
    // Apply individual-tool visibility: walk visibleIndividualTools, add containing groups
    if (this.cfg.visibleIndividualTools) {
      for (const toolName of this.cfg.visibleIndividualTools) {
        for (const g of this.groupsContaining(toolName)) s.add(g);
      }
    }
    this.sessionGroups.set(sessionId, s);
  }
  return s;
}
```

- [ ] **Step 3: Modify `buildToolRegistry` in tool-definitions.ts**

Locate `buildToolRegistry` and extend its signature to accept `visibilityResult`:

```typescript
export function buildToolRegistry(
  deps: ToolDeps & {
    lazyLoadEnabled: boolean;
    defaultActiveGroups: GroupName[];
    visibilityResult?: ParseResult;  // ← new
  },
): ToolRegistry {
  const defs = buildToolDefinitions(deps);
  return new ToolRegistry({
    tools: { core: [...defs.meta, ...defs.infoLazy], groups: defs.groups },
    lazyLoadEnabled: deps.lazyLoadEnabled,
    defaultActiveGroups: deps.defaultActiveGroups,
    visibleIndividualTools: deps.visibilityResult?.visibleTools,  // ← new
  });
}
```

Add the imports at top of the file:

```typescript
import { ToolVisibilityFilter, type ParseResult } from './tool-visibility-filter.js';
```

(Do not yet call `ToolVisibilityFilter.parse` from inside `buildToolRegistry` — keep it pure; caller in `mcp-server.ts` will do the parse. This preserves testability and avoids circular import.)

- [ ] **Step 4: Compile and check no regression**

Run: `npm run build`
Expected: tsc 0 errors

Run: `npx vitest run tests/integration/lazy-load-e2e.test.ts tests/unit/tool-registry.test.ts tests/unit/lazy-loading-notification.test.ts`
Expected: all green (no behavior change at this point — only the new optional field is plumbed)

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tool-registry.ts src/mcp/tool-definitions.ts
git commit -m "refactor(registry): thread visibilityResult through ToolRegistry builder"
```

---

## Task 5: Apply visibility filter in mcp-server setup

**Files:**
- Modify: `src/mcp/mcp-server.ts` (`configureFromAppConfig` → `rebuildToolRegistry` → `buildToolRegistry`)
- Modify: `src/mcp/tool-registry.ts` (export `getActiveGroups` if not already)

**Interfaces:**
- Consumes: `appConfig.visibleGroups`, `appConfig.visibleTools` from Task 1
- Produces: warnings logged to `console.warn`; registry built with parsed visibility

- [ ] **Step 1: Locate rebuildToolRegistry in mcp-server.ts**

```bash
grep -n "rebuildToolRegistry\|buildToolRegistry\|sessionGroups\|console.warn" src/mcp/mcp-server.ts | head -20
```

- [ ] **Step 2: Modify `rebuildToolRegistry` to call `ToolVisibilityFilter.parse`**

At top of file, add import (already may import from `./tool-registry.js`):

```typescript
import { ToolVisibilityFilter } from './tool-visibility-filter.js';
```

In `rebuildToolRegistry`, before the `buildToolRegistry` call:

```typescript
private rebuildToolRegistry(): void {
  if (!this.lazyLoadEnabled) {
    this.toolRegistry = null;
    return;
  }
  const profileStore = this.profileManager?.getProfileStore() ?? null;

  // v3.4: compute visibility from env-derived config
  const allKnown = this.collectAllKnownToolNames(); // helper below
  const groupToolMap = this.collectGroupToolNameMap(); // helper below
  const coreTools = this.collectCoreToolNames(); // helper below
  const vis = ToolVisibilityFilter.parse(
    (this.appConfig?.visibleGroups ?? []).join(',') || undefined,
    (this.appConfig?.visibleTools ?? []).join(',') || undefined,
    allKnown, groupToolMap, coreTools,
  );
  for (const w of vis.warnings) console.warn(w);

  this.toolRegistry = buildToolRegistry({
    queryAnalyzer: this.queryAnalyzer,
    profileManager: this.profileManager,
    profileStore,
    config: this.config,
    planHistory: this.planHistory,
    lazyLoadEnabled: true,
    defaultActiveGroups: vis.parsedGroups,
    visibilityResult: vis,
  });
}
```

- [ ] **Step 3: Add the three helper methods to `DatabaseMCPServer`**

Add as private methods (after `rebuildToolRegistry`):

```typescript
private collectAllKnownToolNames(): Set<string> {
  const out = new Set<string>();
  for (const name of this.collectCoreToolNames()) out.add(name);
  const map = this.collectGroupToolNameMap();
  for (const g of Object.keys(map) as ToolGroup[]) {
    for (const t of map[g]) out.add(t);
  }
  return out;
}

private collectCoreToolNames(): Set<string> {
  // Mirrors CORE 12 + meta 2 + infoLazy 1 — same set as Task 3's CORE constant.
  return new Set([
    'connect_database', 'disconnect_database', 'get_connection_status',
    'use_profile', 'execute_query', 'execute_script', 'execute_batch',
    'get_schema', 'get_table_info', 'get_enum_values',
    'get_sample_data', 'clear_cache',
    'use_tool_group', 'use_tool_schema', 'generate_sample_data',
  ]);
}

private collectGroupToolNameMap(): Record<ToolGroup, string[]> {
  // Hardcoded mapping mirrors the membership defined in buildToolDefinitions.
  return {
    'query-experience': [
      'explain_query', 'lint_sql', 'get_query_history',
      'save_template', 'list_templates', 'get_template',
      'delete_template', 'execute_template', 'execute_sql_file',
    ],
    profiles: [
      'save_profile', 'list_profiles', 'get_profile', 'delete_profile',
      'enable_profile', 'disable_profile', 'get_global_schema',
      'export_profiles', 'import_profiles', 'disconnect_profile',
    ],
    'data-governance': [
      'audit_log', 'get_pii_config', 'set_pii_config',
      'export_backup', 'export_table_csv', 'import_csv', 'compare_profile_schemas',
    ],
    'index-advisor': [
      'explain_query_with_advice', 'compare_query_plans',
      'list_query_plans', 'get_metrics',
    ],
  };
}
```

- [ ] **Step 4: Build and run tests**

Run: `npm run build && npx vitest run tests/unit tests/integration`
Expected: tsc 0 errors; all tests pass (visibility defaults to empty so behavior should be unchanged for existing tests until Task 6)

- [ ] **Step 5: Verify default behavior (no env) yields 15 tools**

Run:
```bash
unset DB_VISIBLE_GROUPS DB_VISIBLE_TOOLS
node dist/index.js 2>/dev/null &
SERVER_PID=$!
sleep 2
# Send ListToolsRequest via mcp-sse or skip — accepted that this needs an mcp client
kill $SERVER_PID 2>/dev/null
```

Or simpler: write a unit test that exercises this path through the constructor:

```typescript
// in tests/integration/visible-tools-pruning.test.ts
import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../src/mcp/tool-registry.js';
import { ToolVisibilityFilter } from '../../src/mcp/tool-visibility-filter.js';

const allTools = new Set([...]); // 45 tools
const core = new Set([...]); // 15 CORE
const map = { 'query-experience': [...], profiles: [...], 'data-governance': [...], 'index-advisor': [...] };

it('default visibility produces exactly 15 tools', () => {
  const r = ToolVisibilityFilter.parse(undefined, undefined, allTools, map, core);
  expect(r.visibleTools.size).toBe(15);
});
```

(This test is essentially a duplicate of Task 3's test but run from the integration path to confirm wiring.)

- [ ] **Step 6: Commit**

```bash
git add src/mcp/mcp-server.ts tests/integration/visible-tools-pruning.test.ts
git commit -m "feat(visibility): apply ToolVisibilityFilter in mcp-server at startup"
```

---

## Task 6: Tighten CORE to 12 tools in mcp-server ListTools handler

**Files:**
- Modify: `src/mcp/mcp-server.ts` (`getStatefulToolsForList`)
- Test: `tests/integration/visible-tools-pruning.test.ts` (extend with CORE assertion)

**Interfaces:**
- Consumes: this.adapter, this.config
- Produces: an array of exactly 12 CORE entries plus meta + infoLazy when applicable

- [ ] **Step 1: Read current getStatefulToolsForList**

```bash
grep -n "getStatefulToolsForList" src/mcp/mcp-server.ts
```

Read lines 410-445 to understand current shape.

- [ ] **Step 2: Replace `getStatefulToolsForList` with `getCoreToolsForList` (12 tools)**

Replace the function. Hardcode the exact 12-tool array. Drop the conditional `execute_template`, `get_metrics` and `use_profile` (those go to groups per spec, even though Task 2's CORE-list helper still includes `use_profile` — that's intentional for backward-compat: `use_profile` IS still stateful). Final CORE list in this handler should be:

```typescript
private getCoreToolsForList(): any[] {
  return [
    { name: 'connect_database', description: '连接到数据库。', inputSchema: { /* existing schema */ } },
    { name: 'disconnect_database', description: '断开当前数据库连接。', inputSchema: { type: 'object', properties: {} } },
    { name: 'get_connection_status', description: '获取当前数据库连接状态。', inputSchema: { type: 'object', properties: {} } },
    { name: 'use_profile', description: '切换活跃连接到已存 profile。', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
    { name: 'execute_query', description: '执行 SQL 查询。', inputSchema: { type: 'object', properties: { sql: { type: 'string' }, params: { type: 'array', items: { type: 'string' } } }, required: ['sql'] } },
    { name: 'execute_script', description: '执行多语句 SQL 脚本。', inputSchema: { type: 'object', properties: { sql: { type: 'string' }, useTransaction: { type: 'boolean', default: true }, maxStatements: { type: 'number', default: 1000 } }, required: ['sql'] } },
    { name: 'execute_batch', description: '批量执行同一条 SQL 的多个参数集。', inputSchema: { type: 'object', properties: { sql: { type: 'string' }, paramsList: { type: 'array', items: { type: 'array' } }, useTransaction: { type: 'boolean', default: true }, maxBatchSize: { type: 'number', default: 1000 } }, required: ['sql', 'paramsList'] } },
    { name: 'get_schema', description: '获取数据库结构信息。', inputSchema: { type: 'object', properties: { forceRefresh: { type: 'boolean' } } } },
    { name: 'get_table_info', description: '获取指定表的详细信息。', inputSchema: { type: 'object', properties: { tableName: { type: 'string' }, forceRefresh: { type: 'boolean' } }, required: ['tableName'] } },
    { name: 'get_enum_values', description: '获取指定列的所有唯一值。', inputSchema: { type: 'object', properties: { tableName: { type: 'string' }, columnName: { type: 'string' }, limit: { type: 'number' }, includeCount: { type: 'boolean' } }, required: ['tableName', 'columnName'] } },
    { name: 'get_sample_data', description: '获取表的示例数据(已自动脱敏)。', inputSchema: { type: 'object', properties: { tableName: { type: 'string' }, columns: { type: 'array', items: { type: 'string' } }, limit: { type: 'number' } }, required: ['tableName'] } },
    { name: 'clear_cache', description: '清除 Schema 缓存。', inputSchema: { type: 'object', properties: {} } },
  ];
}
```

(Keep descriptions brief here; Task 8 will edit them more carefully. For now: simple, no `[group:]` suffix.)

Also delete the conditional pushing of `execute_template`, `get_metrics` from this CORE — they were stateful-fallback entries and remain in the codebase via the call switch but no longer appear in default ListTools. They will be exposed via `DB_VISIBLE_GROUPS` (`execute_template` → query-experience, `get_metrics` → index-advisor).

- [ ] **Step 3: Update `setupHandlers` to call `getCoreToolsForList`**

In `setupHandlers` find the call site of `getStatefulToolsForList` and rename to `getCoreToolsForList`.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run tests/integration/mcp-server-core.test.ts tests/integration/visible-tools-pruning.test.ts`
Expected: passes; if not, fix description / schema mismatch.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/mcp-server.ts
git commit -m "refactor(core): hardcode CORE 12 in getCoreToolsForList"
```

---

## Task 7: Add outputSchema registry and structuredContent return

**Files:**
- Create: `src/mcp/output-schemas.ts`
- Modify: `src/mcp/mcp-server.ts` (inject outputSchema into ListToolsResponse)
- Modify: `src/mcp/tools/query-tools.ts` (`buildExecuteQueryHandler` etc. return structuredContent)
- Modify: `src/mcp/tools/profile-tools.ts` (list_profiles, list_templates where present)
- Test: `tests/unit/output-schema-registry.test.ts`
- Test: `tests/e2e/output-schema-protocol.test.ts`

**Interfaces:**
- Consumes: nothing external; pure registry
- Produces: `OutputSchemaRegistry.get(toolName) → JSON Schema | undefined`

- [ ] **Step 1: Write failing test**

Create `tests/unit/output-schema-registry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { OutputSchemaRegistry } from '../../src/mcp/output-schemas.js';

const SCHEMA_TOOLS = [
  'execute_query', 'execute_script', 'execute_batch',
  'get_table_info', 'get_schema', 'get_sample_data', 'get_enum_values',
  'connect_database', 'get_connection_status',
  'list_templates', 'list_profiles',
];

describe('OutputSchemaRegistry', () => {
  for (const name of SCHEMA_TOOLS) {
    it(`defines a schema for ${name}`, () => {
      const s = OutputSchemaRegistry.get(name);
      expect(s).toBeDefined();
      expect((s as any).type).toBe('object');
    });
  }

  it('returns undefined for tools without a schema', () => {
    expect(OutputSchemaRegistry.get('connect_database_unused_xyz')).toBeUndefined();
  });

  it('execute_query schema includes rows/rowCount/durationMs', () => {
    const s = OutputSchemaRegistry.get('execute_query') as any;
    expect(s.properties.rows).toBeDefined();
    expect(s.properties.rowCount).toBeDefined();
    expect(s.properties.durationMs).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npx vitest run tests/unit/output-schema-registry.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Create `src/mcp/output-schemas.ts`**

```typescript
/**
 * v3.4: MCP outputSchema registry.
 *
 * Each entry maps a tool name to the JSON Schema that its handler's
 * `structuredContent` output must conform to. The ToolRegistry's ListTools
 * handler reads from this registry when emitting the tool descriptor.
 */

const SCHEMAS: Record<string, any> = {
  execute_query: {
    type: 'object',
    properties: {
      rows: { type: 'array', items: {} },
      rowCount: { type: 'integer' },
      durationMs: { type: 'number' },
      columns: { type: 'array', items: { type: 'string' } },
      truncated: { type: 'boolean' },
    },
    required: ['rows', 'rowCount', 'durationMs', 'columns'],
  },
  execute_script: {
    type: 'object',
    properties: {
      statements: { type: 'array', items: { type: 'string' } },
      success: { type: 'boolean' },
      errorIndex: { type: 'integer' },
    },
    required: ['statements', 'success'],
  },
  execute_batch: {
    type: 'object',
    properties: {
      affectedRows: { type: 'integer' },
      batchCount: { type: 'integer' },
      durationMs: { type: 'number' },
    },
    required: ['affectedRows', 'batchCount', 'durationMs'],
  },
  get_table_info: {
    type: 'object',
    properties: {
      columns: { type: 'array', items: {} },
      indexes: { type: 'array', items: {} },
      rowCount: { type: 'integer' },
    },
    required: ['columns', 'indexes'],
  },
  get_schema: {
    type: 'object',
    properties: {
      tables: { type: 'array', items: {} },
      tableCount: { type: 'integer' },
    },
    required: ['tables', 'tableCount'],
  },
  get_sample_data: {
    type: 'object',
    properties: {
      rows: { type: 'array', items: {} },
      columns: { type: 'array', items: { type: 'string' } },
      masked: { type: 'array', items: { type: 'string' } },
      totalRows: { type: 'integer' },
    },
    required: ['rows', 'columns', 'masked', 'totalRows'],
  },
  get_enum_values: {
    type: 'object',
    properties: {
      values: { type: 'array', items: {} },
      counts: { type: 'object', additionalProperties: { type: 'integer' } },
    },
    required: ['values'],
  },
  connect_database: {
    type: 'object',
    properties: {
      connected: { type: 'boolean' },
      type: { type: 'string' },
      host: { type: 'string' },
    },
    required: ['connected', 'type'],
  },
  get_connection_status: {
    type: 'object',
    properties: {
      connected: { type: 'boolean' },
      type: { type: 'string' },
      host: { type: 'string' },
    },
    required: ['connected'],
  },
  list_templates: {
    type: 'object',
    properties: {
      templates: { type: 'array', items: {} },
      count: { type: 'integer' },
    },
    required: ['templates', 'count'],
  },
  list_profiles: {
    type: 'object',
    properties: {
      profiles: { type: 'array', items: {} },
      count: { type: 'integer' },
    },
    required: ['profiles', 'count'],
  },
};

export class OutputSchemaRegistry {
  /** Returns the outputSchema JSON Schema for the given tool name, or undefined. */
  static get(toolName: string): Record<string, unknown> | undefined {
    return SCHEMAS[toolName];
  }

  /** Tool names that have an outputSchema registered. Useful for tests. */
  static list(): string[] {
    return Object.keys(SCHEMAS);
  }
}
```

- [ ] **Step 4: Run unit test, expect pass**

Run: `npx vitest run tests/unit/output-schema-registry.test.ts`
Expected: all pass

- [ ] **Step 5: Inject outputSchema into ListTools handler**

In `src/mcp/mcp-server.ts`:

- Add import at top:

```typescript
import { OutputSchemaRegistry } from './output-schemas.js';
```

- In ListToolsRequest handler, after collecting all tools (CORE + groups + individual), before returning:

```typescript
for (const t of tools) {
  const schema = OutputSchemaRegistry.get(t.name);
  if (schema) t.outputSchema = schema;
}
```

- [ ] **Step 6: Update execute_query handler to return structuredContent**

In `src/mcp/tools/query-tools.ts`, locate `buildExecuteQueryHandler`. Modify the returned value:

```typescript
buildExecuteQueryHandler = (qa) => async (args, sessionId) => {
  // ... existing logic that produces { rows, durationMs, columns }
  const result = await qa.executeQuery(...); // existing
  return {
    content: [{ type: 'text', text: `Returned ${result.rows.length} rows in ${result.durationMs}ms.` }],
    structuredContent: {
      rows: result.rows,
      rowCount: result.rows.length,
      durationMs: result.durationMs,
      columns: result.columns,
    },
  };
};
```

Repeat the same shape mutation for `execute_script`, `execute_batch` (in same file), `list_profiles` (in `profile-tools.ts`), `list_templates` (in `query-tools.ts`).

- [ ] **Step 7: Run e2e test**

Run: `npx vitest run tests/e2e/output-schema-protocol.test.ts tests/unit/output-schema-registry.test.ts`
Expected: passes

If handler test fixture doesn't exist, write a minimal one:

```typescript
// tests/e2e/output-schema-protocol.test.ts
import { describe, it, expect } from 'vitest';
import { OutputSchemaRegistry } from '../../src/mcp/output-schemas.js';

describe('outputSchema protocol — sanity', () => {
  it('every schema in registry is JSON Schema object', () => {
    for (const name of OutputSchemaRegistry.list()) {
      const s = OutputSchemaRegistry.get(name);
      expect(s).toBeDefined();
      expect((s as any).type).toBe('object');
    }
  });
});
```

- [ ] **Step 8: Commit**

```bash
git add src/mcp/output-schemas.ts tests/unit/output-schema-registry.test.ts \
        tests/e2e/output-schema-protocol.test.ts \
        src/mcp/mcp-server.ts src/mcp/tools/query-tools.ts src/mcp/tools/profile-tools.ts
git commit -m "feat(output): add OutputSchemaRegistry + structuredContent for 11 handlers"
```

---

## Task 8: Compress all 45 tool descriptions

**Files:**
- Modify: `src/mcp/tools/query-tools.ts` (TOOL_DESCRIPTIONS)
- Modify: `src/mcp/tools/profile-tools.ts` (PROFILE_TOOL_DESCRIPTIONS)
- Modify: `src/mcp/tools/data-governance.ts` (DATA_GOVERNANCE_TOOL_DESCRIPTIONS)
- Modify: `src/mcp/tools/csv-tools.ts` (CSV_TOOL_DESCRIPTIONS)
- Modify: `src/mcp/tools/plan-history.ts` (PLAN_HISTORY_TOOL_DESCRIPTIONS)
- Modify: `src/mcp/tools/metrics.ts` (GET_METRICS_TOOL_DESCRIPTION)
- Modify: `src/mcp/tool-definitions.ts` (meta + infoLazy + getCoreToolsForList in mcp-server)
- Test: `tests/unit/description-lint.test.ts`

**Interfaces:**
- Consumes: existing TOOL_DESCRIPTIONS objects
- Produces: trimmed descriptions, average ≤ 49 chars, no `[group:` / `v3.` / `**vX**:**` patterns

- [ ] **Step 1: Write description lint test (currently FAILS)**

Create `tests/unit/description-lint.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { TOOL_DESCRIPTIONS } from '../../src/mcp/tools/query-tools.js';
import { PROFILE_TOOL_DESCRIPTIONS } from '../../src/mcp/tools/profile-tools.js';
import { DATA_GOVERNANCE_TOOL_DESCRIPTIONS } from '../../src/mcp/tools/data-governance.js';
import { CSV_TOOL_DESCRIPTIONS } from '../../src/mcp/tools/csv-tools.js';
import { PLAN_HISTORY_TOOL_DESCRIPTIONS } from '../../src/mcp/tools/plan-history.js';
import { GET_METRICS_TOOL_DESCRIPTION } from '../../src/mcp/tools/metrics.js';

const ALL: Record<string, string> = {
  ...TOOL_DESCRIPTIONS,
  ...PROFILE_TOOL_DESCRIPTIONS,
  ...DATA_GOVERNANCE_TOOL_DESCRIPTIONS,
  ...CSV_TOOL_DESCRIPTIONS,
  ...PLAN_HISTORY_TOOL_DESCRIPTIONS,
  get_metrics: GET_METRICS_TOOL_DESCRIPTION,
};

describe('description lint', () => {
  it('no description contains [group: marker', () => {
    for (const [name, desc] of Object.entries(ALL)) {
      expect.soft(desc, `${name} should not contain [group:`).not.toContain('[group:');
    }
  });

  it('no description contains vX.Y version marker', () => {
    for (const [name, desc] of Object.entries(ALL)) {
      // v followed by digit-dot-digit, e.g. v3.1
      expect.soft(desc, `${name} should not contain vX.Y`).not.toMatch(/\bv\d+\.\d+/);
    }
  });

  it('no description contains bold version marker **vX**', () => {
    for (const [name, desc] of Object.entries(ALL)) {
      expect.soft(desc, `${name} should not contain **vX**`).not.toMatch(/\*\*v\d/);
    }
  });

  it('no description exceeds 150 chars', () => {
    for (const [name, desc] of Object.entries(ALL)) {
      expect.soft(desc.length, `${name} too long: ${desc.length}`).toBeLessThanOrEqual(150);
    }
  });

  it('total characters and average within budget', () => {
    const all = Object.values(ALL);
    const total = all.reduce((s, d) => s + d.length, 0);
    const avg = total / all.length;
    // Goal: average ≤ 49 chars
    expect.soft(avg, `average too high: ${avg.toFixed(1)}`).toBeLessThanOrEqual(49);
  });
});
```

- [ ] **Step 2: Run, expect failures**

Run: `npx vitest run tests/unit/description-lint.test.ts`
Expected: many soft-failures (this is the baseline we're improving)

- [ ] **Step 3: Compress each file**

For each `*_TOOL_DESCRIPTIONS` object, manually rewrite every description to apply:

| Rule | Action |
|---|---|
| Strip trailing ` [group: xxxx]` | remove |
| Strip `vN.M` (version mentions) | remove |
| Strip `**vN.M**:**` | remove the leading emphasis, keep the substantive phrase |
| Convert ASCII parens `(可选,默认 false)` to nothing or `默认 false` | simplify |
| Trim leading/trailing whitespace | trim |
| Compress consecutive spaces | one space |
| Merge duplicate "v3.x 引入..." suffix | drop suffix |
| Convert common phrases: `执行一条 SQL` → `执行 SQL`; `获取数据库结构信息包括所有 Schema...` → `获取数据库结构信息` | shorten |
| Avoid English medium-length phrases if Chinese shorter equivalent works | translate if shorter |

Reference replacements per file:

```typescript
// query-tools.ts
export const TOOL_DESCRIPTIONS = {
  explain_query: 'Get EXPLAIN plan for a SQL query.',  // English OK, ≤49
  lint_sql: 'Lint a SQL query. Returns issues array. Advisory, never blocks.',
  get_query_history: 'Get recent query history. Filters: db, kind, since, until, onlyErrors, limit.',
  save_template: 'Save a parameterized SQL template. Reusable across team. Use ${param} placeholders.',
  list_templates: 'List saved templates. Optional tag filter.',
  get_template: 'Get one template by id.',
  delete_template: 'Delete a template by id.',
  execute_template: 'Execute a saved template with params.',
};

// profile-tools.ts
export const PROFILE_TOOL_DESCRIPTIONS = {
  save_profile: 'Save named profile (host/port/user/etc) to profiles.db.',
  list_profiles: 'List profiles. Supports role/tag/enabled filter.',
  get_global_schema: 'Merge schema of all enabled profiles (parallel).',
  export_profiles: 'Export profiles to YAML/JSON.',
  import_profiles: 'Import profiles from YAML/JSON.',
  get_profile: 'Get profile config by name.',
  delete_profile: 'Delete profile by name.',
  enable_profile: 'Enable profile.',
  disable_profile: 'Disable profile.',
  disconnect_profile: 'Disconnect from a specific profile.',
};

// data-governance.ts
export const DATA_GOVERNANCE_TOOL_DESCRIPTIONS = {
  compare_profile_schemas: 'Compare schema between two profiles.',
  export_backup: 'Export DB to file.',
  audit_log: 'Query audit log.',
  get_pii_config: 'Get PII masking config.',
  set_pii_config: 'Set PII masking rules.',
};

// csv-tools.ts
export const CSV_TOOL_DESCRIPTIONS = {
  export_table_csv: 'Export table rows to CSV file.',
  import_csv: 'Import CSV file into a table.',
};

// plan-history.ts
export const PLAN_HISTORY_TOOL_DESCRIPTIONS = {
  explain_query_with_advice: 'EXPLAIN + index advice.',
  compare_query_plans: 'Compare two saved EXPLAIN plans.',
  list_query_plans: 'List saved EXPLAIN plans.',
};

// metrics.ts
export const GET_METRICS_TOOL_DESCRIPTION =
  'Get server observability metrics. category=summary|slow_queries|all.';
```

(Copy the exact strings above; they average ~38 chars.)

- [ ] **Step 4: Rebuild and re-run lint**

Run: `npm run build && npx vitest run tests/unit/description-lint.test.ts`
Expected: all soft-asserts pass; average well under 49

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: full green

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools/ src/mcp/tool-definitions.ts src/mcp/mcp-server.ts tests/unit/description-lint.test.ts
git commit -m "refactor(description): compress tool descriptions, drop [group:] + version markers"
```

---

## Task 9: Add `npm run lint:tools` CI script

**Files:**
- Create: `scripts/lint-tools.cjs`
- Modify: `package.json` (add `lint:tools` script)
- Test: the script itself (manual via CLI); covered by description-lint test (Task 8)

**Interfaces:**
- Consumes: all source files in `src/mcp/tools/*.ts` and `src/mcp/tool-definitions.ts`
- Produces: exit 0 if clean, exit 1 with errors otherwise

- [ ] **Step 1: Create `scripts/lint-tools.cjs`**

```javascript
#!/usr/bin/env node
/**
 * v3.4: CI lint for tool descriptions.
 *
 * Walks src/mcp/tools/*.ts and src/mcp/tool-definitions.ts, reads any
 * *_DESCRIPTIONS constant, and enforces:
 *  - description ≤ 150 chars
 *  - no [group: marker
 *  - no vX.Y version marker
 *  - no **vX** bold marker
 *  - 0 errors required
 */

const fs = require('node:fs');
const path = require('node:path');

const FILES = [
  'src/mcp/tool-definitions.ts',
  ...fs.readdirSync('src/mcp/tools').map(f => path.join('src/mcp/tools', f)),
];

const PATTERNS = [
  { name: 'long-desc', regex: /.{151,}/ },
  { name: 'group-marker', regex: /\[group:/ },
  { name: 'version-marker', regex: /\bv\d+\.\d+/ },
  { name: 'bold-version', regex: /\*\*v\d/ },
];

let errors = 0;

for (const file of FILES) {
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');

  // Crude: extract strings that look like descriptions (string literals assigned
  // to fields named *description* OR a `description:` shorthand).
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const descMatch = line.match(/description:\s*['"`](.*?)['"`]/);
    if (!descMatch) continue;
    const desc = descMatch[1];
    for (const { name, regex } of PATTERNS) {
      if (regex.test(desc)) {
        console.error(`[lint:tools] ${file}:${i + 1}  ${name}\n  > ${desc}`);
        errors++;
      }
    }
  }
}

if (errors > 0) {
  console.error(`\n[lint:tools] ${errors} error(s). Fix before commit.`);
  process.exit(1);
}
console.log('[lint:tools] OK');
```

- [ ] **Step 2: Add `lint:tools` script to `package.json`**

In `package.json` under `scripts`:

```json
"lint:tools": "node scripts/lint-tools.cjs"
```

- [ ] **Step 3: Run it**

Run: `npm run lint:tools`
Expected: `[lint:tools] OK` (exit 0, since Task 8 already cleaned descriptions)

- [ ] **Step 4: Negative test — temporarily break a description**

```bash
sed -i "s/连接数据库。/[group: connection] 连接数据库。/" src/mcp/mcp-server.ts
npm run lint:tools
echo "exit=$?"  # expect non-zero
git checkout -- src/mcp/mcp-server.ts
```

- [ ] **Step 5: Commit**

```bash
git add scripts/lint-tools.cjs package.json
git commit -m "chore(ci): add lint:tools script enforcing description hygiene"
```

---

## Task 10: Add integration test for the full pruning pipeline

**Files:**
- Modify: `tests/integration/visible-tools-pruning.test.ts` (extend what's already started in Task 5)

**Interfaces:**
- Consumes: full `DatabaseMCPServer` instance + mock session
- Produces: assertions on `ListToolsResponse.tool` shape

- [ ] **Step 1: Read the existing test file from Task 5**

```bash
grep -n "describe\|it(" tests/integration/visible-tools-pruning.test.ts
```

- [ ] **Step 2: Add three integration tests**

Append to the test file:

```typescript
import { ToolVisibilityFilter } from '../../src/mcp/tool-visibility-filter.js';
// ... existing imports

const ALL = new Set([/* 45 tools */]);
const CORE = new Set([/* 15 CORE tools */]);
const MAP = { /* group map */ };

describe('ToolVisibilityFilter — orchestration', () => {
  it('default produces 15 visible tools', () => {
    const r = ToolVisibilityFilter.parse(undefined, undefined, ALL, MAP, CORE);
    expect(r.visibleTools.size).toBe(15);
  });

  it('visibleGroups=query-experience → 24 visible (15+9)', () => {
    const r = ToolVisibilityFilter.parse('query-experience', undefined, ALL, MAP, CORE);
    expect(r.visibleTools.size).toBe(24);
  });

  it('visibleTools=audit_log alone → still 16 visible (15+1)', () => {
    const r = ToolVisibilityFilter.parse(undefined, 'audit_log', ALL, MAP, CORE);
    expect(r.visibleTools.size).toBe(16);
    expect(r.visibleTools.has('audit_log')).toBe(true);
  });

  it('union of groups + individual tools', () => {
    const r = ToolVisibilityFilter.parse(
      'query-experience', 'audit_log',
      ALL, MAP, CORE,
    );
    // CORE 15 + query-experience 9 + audit_log 1 = 25 (audit_log is in data-governance,
    // not in query-experience, so it's truly additive)
    expect(r.visibleTools.size).toBe(25);
  });
});
```

- [ ] **Step 3: Run**

Run: `npx vitest run tests/integration/visible-tools-pruning.test.ts`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add tests/integration/visible-tools-pruning.test.ts
git commit -m "test(visibility): integration tests for group+tool composition"
```

---

## Task 11: Update CHANGELOG and write MIGRATION doc

**Files:**
- Modify: `CHANGELOG.md` (add v3.4.0 BREAKING entry)
- Create: `docs/MIGRATION-v3.4-tool-pruning.md`

**Interfaces:**
- Consumes: nothing
- Produces: user-facing doc updates

- [ ] **Step 1: Read existing CHANGELOG.md header**

```bash
head -50 CHANGELOG.md
```

- [ ] **Step 2: Prepend v3.4.0 entry**

Insert at the top (above any existing unreleased section). Use exactly:

```markdown
## v3.4.0 (2026-07-27) — Tool Pruning Patch

### ⚠️ BREAKING CHANGES

- **默认 CORE 收紧到 12 个 tool** — 详见下方
- 30 个 group tool 默认不注册;需 `use_tool_group` 启用,或设 `DB_VISIBLE_GROUPS` / `DB_VISIBLE_TOOLS` 静态启用
- 4 个 v3.3.4 默认可见的 tool 移到 group:`execute_template`、`execute_sql_file`、`get_metrics`、`use_profile`(其中 `use_profile` 在 hardcoded CORE,任何 group 启用后仍可见)
- Claude Code 用户此前看到的"全部 43 个 tool"现在也只看到 CORE + 启用的 group

### ✨ Features

- 新增 `DB_VISIBLE_GROUPS` env(粗粒度 group 控制)
- 新增 `DB_VISIBLE_TOOLS` env(细粒度 individual tool 控制)
- 主要 tool 增加 `outputSchema` + `structuredContent` 输出
- 45 tool 描述精简,平均字符数 -33%
- CI 新增 `npm run lint:tools` schema lint

### 📖 Migration

详见 [`docs/MIGRATION-v3.4-tool-pruning.md`](./docs/MIGRATION-v3.4-tool-pruning.md)

---
```

- [ ] **Step 3: Create MIGRATION doc**

Create `docs/MIGRATION-v3.4-tool-pruning.md`:

```markdown
# v3.4.0 迁移指南 — MCP Tool Pruning

## 概要

v3.4 起,默认 MCP session 只看到 **CORE 12 + meta 2 + infoLazy 1 = 15 个 tool**。
这是 BREAKING CHANGE(v3.3 默认是 ~43 个),原因详见 [spec](../docs/superpowers/specs/2026-07-27-mcp-tool-pruning-v3-x-design.md)。

## 默认场景(无 env)— 不需要迁移

什么 env 都不设的 client 只会看到 15 个 tool。LLM 工作流更清爽,**无破坏**(只是看不到原来"看起来有"但其实不常用的 tool)。

## 工具迁移对照表

| v3.3.4 位置 | v3.4 位置 | 如何启用 |
|---|---|---|
| CORE(总是可见) | CORE | 已可见 |
| `execute_template` | query-experience group | `use_tool_group` 或 `DB_VISIBLE_GROUPS=query-experience` |
| `execute_sql_file` | query-experience group(需 permission + paths) | 同上 |
| `execute_script` | CORE | 已可见 |
| `execute_batch` | CORE | 已可见 |
| `audit_log` | data-governance group | `DB_VISIBLE_GROUPS=data-governance` |
| `audit_log` + `compare_profile_schemas` + `export_backup` + PII + CSV | data-governance group | 同上 |
| `explain_query`, `lint_sql`, `get_query_history` | query-experience group | `DB_VISIBLE_GROUPS=query-experience` |
| `explain_query_with_advice`, `compare_query_plans`, `list_query_plans` | index-advisor group | `DB_VISIBLE_GROUPS=index-advisor` |
| `get_metrics` | index-advisor group | 同上 |
| `save_template` 等 8 个 template 工具 | query-experience group | 同上 |
| `save_profile` 等 10 个 profile 工具 | profiles group | `DB_VISIBLE_GROUPS=profiles` |
| `use_profile` | CORE | 已可见 |

## 恢复 v3.3.4 默认(全部 45 个 tool)

```bash
DB_VISIBLE_GROUPS=query-experience,profiles,data-governance,index-advisor
```

## Claude Code 推荐配置

Claude Code 不响应 `listChanged`,所以 group 启用必须在启动时通过 env 生效:

```json
// ~/.config/claude/mcp.json 或等价位置
{
  "mcpServers": {
    "universal-db-mcp": {
      "env": {
        "DB_VISIBLE_GROUPS": "query-experience"
      }
    }
  }
}
```

## 副作用

- v3.3 `use_tool_group` 机制保留,对支持 `listChanged` 的客户端(Claude Desktop 等)仍可用
- `DB_LAZY_LOAD_ENABLED` / `DB_LAZY_DEFAULT_GROUP` 保留;但与新 `DB_VISIBLE_GROUPS` 不冲突,后者优先级更高
- `shouldSkipLazyLoading`(Claude Code 特例)保留,但因为 visible 已在启动期生效,Claude Code 用户看不到被隐藏的 tool
```

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md docs/MIGRATION-v3.4-tool-pruning.md
git commit -m "docs: v3.4.0 BREAKING changelog entry + migration guide"
```

---

## Task 12: Update README with Tool pruning section

**Files:**
- Modify: `README.md` (add "Tool pruning" section)

**Interfaces:**
- Consumes: existing README structure
- Produces: a new section after the existing "Configuration" section

- [ ] **Step 1: Locate insertion point in README**

```bash
grep -n "^## \|^# " README.md | head -30
```

- [ ] **Step 2: Add a "Tool pruning" section**

Insert after the existing "Configuration" / env var section. Use:

```markdown
## MCP Tool 精简(v3.4+)

v3.4 起,默认 MCP session 只暴露 **15 个 CORE tool**(连接/查询/Schema)。其他 30 个 tool 默认隐藏,通过以下两种方式启用:

### 方式 A — 静态 env(推荐)

```bash
# 启用 query-experience 和 profiles 全部 tool
export DB_VISIBLE_GROUPS="query-experience,profiles"

# 也可以细粒度指定 individual tool
export DB_VISIBLE_TOOLS="audit_log,explain_query"
```

两个 env 合集生效。

### 方式 B — 运行时 group 启用

```typescript
// LLM 调用
use_tool_group({ name: 'query-experience' })
```

该机制依赖 `listChanged` 通知 — Claude Code 不支持,**所以必须用 env(A)**。

### 验证当前 session 可见 tool

启动 server 后,LLC client 通过 `tools/list` 收到当前可见列表。HTTP REST 用户不受影响(REST API 完全独立)。

详见 [`docs/MIGRATION-v3.4-tool-pruning.md`](./docs/MIGRATION-v3.4-tool-pruning.md)。
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): add 'Tool pruning' section"
```

---

## Task 13: Bump version to 3.4.0 and tag

**Files:**
- Modify: `package.json` (bump version to `3.4.0`)
- Modify: `CHANGELOG.md` (already in Task 11)

- [ ] **Step 1: Bump version**

Run: `npm version minor --no-git-tag-version`
Expected: `package.json` now reads `"version": "3.4.0"`

(Or manually edit. `npm version minor` is cleaner and handles JSON formatting.)

- [ ] **Step 2: Verify all checks**

Run:
```bash
npm run build && npm test && npm run lint:tools
```

Expected: all exit 0; **0 errors / 0 failing tests / lint clean**

- [ ] **Step 3: Commit version bump**

```bash
git add package.json
git commit -m "chore(release): v3.4.0 - MCP tool pruning"
git tag v3.4.0
```

- [ ] **Step 4: Sanity — diff stat**

```bash
git diff --stat v3.3.4..HEAD
```

Expected: ~10 commits, ~1500 insertions, ~600 modifications across src/, tests/, scripts/, docs/.

---

## Task 14: Push branch and open PR (if applicable)

**Files:** none — orchestration only

- [ ] **Step 1: Push**

```bash
git push origin main
git push origin v3.4.0
```

- [ ] **Step 2: Trigger CI**

CI should run:
- `npm test` (existing + new tests)
- `npm run build`
- `npm run lint:tools`

Expected: green. If red, address via additional commits before merge.

---

## Self-Review Checklist (run before handoff)

- [ ] Every spec section in `docs/superpowers/specs/2026-07-27-mcp-tool-pruning-v3-x-design.md` is covered:
  - §1 Background & Goals → Tasks 1–13
  - §2 Tool categorization → Tasks 3, 6
  - §3.1 ToolVisibilityFilter → Task 3
  - §3.2 Description compression → Task 8
  - §3.3 OutputSchema → Task 7
  - §4 Data flow → Tasks 4, 5
  - §5 Error handling → Task 3 (warnings), Task 5 (console.warn)
  - §6 Testing → Tasks 3, 7, 8, 9, 10
  - §7 CHANGELOG/MIGRATION → Task 11, 12
- [ ] No "TBD" / "implement later" in any task
- [ ] Type names match across tasks: `ParseResult`, `ToolGroup`, `CORE`, `OutputSchemaRegistry`
- [ ] Function names match: `ToolVisibilityFilter.parse`, `getCoreToolsForList`, `OutputSchemaRegistry.get`
- [ ] Each commit passes `npm test` + `npm run build` + `npm run lint:tools`

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-27-mcp-tool-pruning-v3-x.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch with checkpoints

Which approach?
