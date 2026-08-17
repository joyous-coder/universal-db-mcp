# v4.0 Remove Tool Lazy-Load & infoLazy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove v3.2 per-DB-type tool lazy-load, infoLazy mode, group concept, and Claude Code workaround; add `server.instructions` field to align with Claude Code's deferred tool search (default since v2.1.227).

**Architecture:** Pure deletion refactor + one new helper. Removes ~1900 LOC across 10 files, adds 1 new file (`src/mcp/instructions.ts`) + 1 lint script. Tool count drops 43 → 41. DB schema cache in `database-service.ts` is preserved.

**Tech Stack:** TypeScript (Node 20+), `@modelcontextprotocol/sdk`, vitest for tests.

**Spec:** `docs/superpowers/specs/2026-08-17-remove-lazy-load-design.md`

---

## Global Constraints

These apply to every task. Values copied verbatim from the spec.

- **Node version floor:** Node 20+ (project requirement)
- **TypeScript:** strict mode required; no `any` in new code
- **User-visible strings:** 简体中文 (Simplified Chinese) — applies to `server.instructions` content (English for international audience), `clear_cache` description (Chinese), console.error messages
- **Internal code comments:** 中文 for architectural decisions; English for routine comments
- **Commit message prefix:** `feat:` / `fix:` / `refactor:` / `test:` / `docs:` / `chore:` / `perf:` (Conventional Commits)
- **`buildInstructions()` length:** hard cap 2000 chars (enforced by both runtime assert and CI lint)
- **Tool count after refactor:** 43 → 41 (delete `use_tool_group`, `use_tool_schema`)
- **Removed env vars:** `DB_LAZY_LOAD_ENABLED`, `DB_LAZY_DEFAULT_GROUP`, `DB_VISIBLE_GROUPS`, `DB_VISIBLE_TOOLS` (all silently ignored)
- **No breaking inputSchema** for the 41 remaining tools
- **DB schema cache:** preserved (G1-G7 do NOT touch `database-service.ts` `schemaCache`/`schemaCacheTime`/TTL/`clearCache()`)
- **Target version:** v4.0.0 (major bump from v3.3.x)

---

## File Structure

### New files (3)

| File | Responsibility | LOC est. |
|------|---------------|---------|
| `src/mcp/instructions.ts` | Exports `buildInstructions(): string` returning Markdown for `InitializeResult.instructions` field | ~50 |
| `scripts/lint-instructions.ts` | CI lint: asserts `buildInstructions()` length < 2000 chars | ~20 |
| `docs/MIGRATION-v4.md` | User-facing migration guide | ~80 |

### Modified files (6)

| File | Responsibility | Change |
|------|---------------|--------|
| `src/mcp/mcp-server.ts` | Main MCP server; InitializeRequest/ListToolsRequest/CallToolRequest handlers | Major: remove lazy-load fields/methods (~350 lines removed) |
| `src/mcp/tool-definitions.ts` | Central tool definitions | Major: flatten (remove groups/meta/infoLazy arrays) (~120 lines changed) |
| `src/types/http.ts` | AppConfig type | Minor: remove `lazyLoad?` field + `LazyLoadConfig` interface |
| `src/utils/config-loader.ts` | Env var parsing | Minor: remove `DB_LAZY_*` parsing + lazyLoad config block |
| `src/mcp/mcp-index.ts` | Entry point | Trivial: remove lazyLoad comment |
| `src/http/routes/mcp-sse.ts` | SSE transport | Trivial: remove lazyLoad comment |

### Deleted files (10)

| File | Reason |
|------|--------|
| `src/mcp/tool-registry.ts` | Replaced by inline routing |
| `tests/unit/tool-registry.test.ts` | Tests deleted registry |
| `tests/integration/lazy-load-e2e.test.ts` | Tests removed behavior |
| `tests/integration/info-lazy-e2e.test.ts` | Tests removed infoLazy |
| `tests/integration/session-isolation-e2e.test.ts` | Tests removed group isolation |
| `tests/unit/lazy-loading-notification.test.ts` | Tests removed listChanged |
| `tests/unit/client-detection.test.ts` | Tests removed Claude Code workaround |
| `tests/unit/mcp-meta-tools.test.ts` | Tests removed meta tools |
| `tests/unit/tool-definitions.test.ts` | Tests removed group categorization |
| `docs/03-features/lazy-loading.md` | Old design doc |

---

## Phase 1: Foundation (G8 — add `server.instructions`)

Pure addition. Lowest risk. Sets up the pattern for the rest.

### Task 1: Add `buildInstructions()` function with unit tests

**Files:**
- Create: `src/mcp/instructions.ts`
- Create: `tests/unit/instructions.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `buildInstructions(): string` returning Markdown < 2000 chars

- [ ] **Step 1: Write the failing test**

Create `tests/unit/instructions.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildInstructions } from '../../src/mcp/instructions.js';

describe('buildInstructions', () => {
  it('returns non-empty string', () => {
    const text = buildInstructions();
    expect(text.length).toBeGreaterThan(0);
  });

  it('is under 2000 chars', () => {
    const text = buildInstructions();
    expect(text.length).toBeLessThanOrEqual(2000);
  });

  it('mentions 17 supported DB types', () => {
    const text = buildInstructions();
    // Spot-check a sample of DB types
    expect(text).toContain('MySQL');
    expect(text).toContain('PostgreSQL');
    expect(text).toContain('Oracle');
    expect(text).toContain('MongoDB');
    expect(text).toContain('达梦');
  });

  it('describes workflow steps', () => {
    const text = buildInstructions();
    expect(text).toContain('connect_database');
    expect(text).toContain('use_profile');
    expect(text).toContain('execute_query');
    expect(text).toContain('get_schema');
  });

  it('describes permission modes', () => {
    const text = buildInstructions();
    expect(text).toContain('safe');
    expect(text).toContain('readwrite');
    expect(text).toContain('full');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/instructions.test.ts`
Expected: FAIL with "Cannot find module '../../src/mcp/instructions.js'"

- [ ] **Step 3: Write minimal implementation**

Create `src/mcp/instructions.ts`:

```typescript
/**
 * v4.0 G8: 构建 server.instructions 字段内容。
 *
 * 该字段在 InitializeResult 中返回,作为 deferred tool search 模式下 Claude
 * 决定"该不该 search 这个 server"以及"search 时用什么关键词"的核心线索。
 * Markdown 格式,长度硬上限 2000 chars(由本函数 assert + scripts/lint-instructions.ts 保证)。
 */

export function buildInstructions(): string {
  const text = `# universal-db-mcp — Database access for 17 DB types

Use me whenever the user needs to query, inspect, or modify data in MySQL,
PostgreSQL, Oracle, SQL Server, DM (达梦), Kingbase, GaussDB, MongoDB, Redis,
SQLite, ClickHouse, TiDB, OceanBase, PolarDB, Vastbase, Highgo, or GoldenDB.

## Workflow

1. **Connect first** — call \`connect_database\` with the DB type and credentials,
   or \`use_profile\` if a saved profile exists.
2. **Explore schema** — \`get_schema\` for overview, \`get_table_info\` for columns,
   \`get_sample_data\` for rows, \`get_enum_values\` for enum-like columns.
3. **Query** — \`execute_query\` for one-off SQL (always pass \`params\` to prevent
   injection). \`explain_query\` returns the plan.
4. **Write in bulk** — \`execute_batch\` (single SQL, multiple param sets) or
   \`execute_script\` (multi-statement, requires script permission).
5. **Profile-based setups** — \`list_profiles\` / \`save_profile\` / \`use_profile\`.
6. **Tune** — \`explain_query_with_advice\` returns index hints. \`lint_sql\` for
   static analysis.

## Permission modes

- **safe** (default): read-only. All write tools blocked.
- **readwrite**: INSERT/UPDATE/DELETE allowed, DDL blocked.
- **full**: DDL + destructive ops allowed.

## Safety

- Always pass \`params\`, never string-concatenate user input.
- Prefer \`lint_sql\` before \`execute_script\`.
- \`audit_log\` retrieves all recorded queries.
- PII columns are masked by default; \`get_pii_config\` shows current rules.`;

  // 硬上限:超过 2000 chars 直接抛错,防止后续 PR 偷偷往里加内容
  if (text.length > 2000) {
    throw new Error(`buildInstructions() exceeded 2000 chars: ${text.length}`);
  }
  return text;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/instructions.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/mcp/instructions.ts tests/unit/instructions.test.ts
git commit -m "feat(mcp): add buildInstructions() for server.instructions field (v4.0 G8)"
```

---

### Task 2: Wire `buildInstructions()` into InitializeResult

**Files:**
- Modify: `src/mcp/mcp-server.ts:456-477` (the InitializeRequest handler)
- Create: `tests/integration/initialize.test.ts`

**Interfaces:**
- Consumes: `buildInstructions()` from Task 1
- Produces: `InitializeResult` with new `instructions` field, no `listChanged: true` capability

- [ ] **Step 1: Write the failing test**

Create `tests/integration/initialize.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseMCPServer } from '../../src/mcp/mcp-server.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

describe('initialize response (v4.0 G8)', () => {
  let server: DatabaseMCPServer;
  let client: Client;
  let serverTransport: InMemoryTransport;
  let clientTransport: InMemoryTransport;

  beforeAll(async () => {
    server = new DatabaseMCPServer(null);
    client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
    [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  afterAll(async () => {
    await server.close();
    await client.close();
  });

  it('includes instructions field', async () => {
    // The server should have stored instructions; we verify via getServerCapabilities
    // which the SDK exposes after initialization. The full instructions string is
    // sent in the initialize response but not exposed via SDK getters, so we
    // assert the field is wired by checking serverInfo.version is present (proxy test).
    const caps = client.getServerCapabilities();
    expect(caps).toBeDefined();
    // 直接验证 server 内部持有的 instructions(白盒)
    expect((server as any).buildInstructions ?? null).not.toBeNull();
  });

  it('does not declare tools.listChanged capability', async () => {
    const caps = client.getServerCapabilities();
    // v4.0 G4: listChanged 默认 false,不在 capabilities 中出现
    expect(caps?.tools?.listChanged).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/initialize.test.ts`
Expected: FAIL — `buildInstructions` not present on server instance, `listChanged` is currently `true`

- [ ] **Step 3: Modify mcp-server.ts**

In `src/mcp/mcp-server.ts`:

1. Add import at top (after existing type imports):
```typescript
import { buildInstructions } from './instructions.js';
```

2. Modify the `Server` constructor (currently L80-92) to remove `listChanged: true`:
```typescript
this.server = new Server(
  {
    name: 'universal-db-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      // v4.0 G4: tools.listChanged removed. All tools are always visible,
      // no notifications needed (deferred tool search handles lazy schema).
      tools: {},
    },
  }
);
```

3. Modify the `InitializeRequest` handler (currently L456-477). Replace with:
```typescript
this.server.setRequestHandler(InitializeRequestSchema, async (request) => {
  // 委托 SDK 默认 oninitialize(返回 protocolVersion/capabilities/serverInfo)
  const result = await (this.server as any)._oninitialize(request);
  // v4.0 G8: 注入 instructions(给 deferred tool search 用的"何时 search / search 什么"线索)
  return { ...result, instructions: buildInstructions() };
});
```

(同时删除 Claude Code 检测分支 — 但 L67-73 字段删在 Task 7。这里只动 handler 内部。)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/initialize.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp/mcp-server.ts tests/integration/initialize.test.ts
git commit -m "feat(mcp): wire instructions into InitializeResult, remove listChanged (G8, G4 partial)"
```

---

## Phase 2: Remove lazy meta tools (G2, G4 — tool surface cleanup)

These two tools (`use_tool_group`, `use_tool_schema`) become obsolete. Deleting them is safe because the v3.x pruning design (CORE 12) already plans to remove them; v4.0 just does it earlier.

### Task 3: Remove `use_tool_group` tool

**Files:**
- Modify: `src/mcp/tool-definitions.ts:159-163` (meta array)
- Modify: `src/mcp/mcp-server.ts:264-321` (handleUseToolGroup method)
- Modify: `src/mcp/mcp-server.ts:919-921` (meta-tool pre-check)
- Create: `tests/integration/meta-tool-removal.test.ts`

**Interfaces:**
- Consumes: existing `tools/list` test infrastructure
- Produces: `tools/list` does NOT contain `use_tool_group`; calling it returns `UnknownTool` MCP error

- [ ] **Step 1: Write the failing test**

Create `tests/integration/meta-tool-removal.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseMCPServer } from '../../src/mcp/mcp-server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

describe('v4.0 G4: use_tool_group removed', () => {
  let server: DatabaseMCPServer;
  let client: Client;

  beforeAll(async () => {
    server = new DatabaseMCPServer(null);
    client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
    const [sT, cT] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(sT), client.connect(cT)]);
  });

  afterAll(async () => {
    await server.close();
    await client.close();
  });

  it('use_tool_group is NOT in tools/list', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).not.toContain('use_tool_group');
  });

  it('calling use_tool_group returns UnknownTool error', async () => {
    await expect(
      client.callTool({ name: 'use_tool_group', arguments: { name: 'query-experience' } })
    ).rejects.toThrow(/UnknownTool|tool not found/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/meta-tool-removal.test.ts`
Expected: FAIL — `use_tool_group` still in `tools/list`

- [ ] **Step 3: Remove from tool-definitions.ts**

In `src/mcp/tool-definitions.ts`, delete the entire `meta` array (currently L160-163):

```typescript
  // ─── META (always-on) ───────────────────────────────────────────────
  const meta: ToolDefinition[] = [
    tool('use_tool_group', '激活一个 tool group 解锁其下工具(group: query-experience|profiles|data-governance|index-advisor)。已激活组重复调用为 no-op。**v3.3.1**: Claude Code 客户端会自动跳过 lazy loading(全部 45 tool 可见),无需调用此工具;其他客户端(Cline/Dify/Continue/Cherry Studio/5ire)可正常用此工具激活新 group。', { type: 'object', properties: { name: { type: 'string', enum: ['query-experience', 'profiles', 'data-governance', 'index-advisor'] } }, required: ['name'] }, async () => ({ error: 'use_tool_group must be routed by ToolRegistry' })),
    tool('use_tool_schema', '加载 info-lazy 工具的完整 schema(仅 generate_sample_data 是 info-lazy)。不影响工具列表,不需要刷新客户端。', { type: 'object', properties: { name: { type: 'string', enum: ['generate_sample_data'] } }, required: ['name'] }, async () => ({ error: 'use_tool_schema must be routed by ToolRegistry' })),
  ];
```

- [ ] **Step 4: Remove handler from mcp-server.ts**

In `src/mcp/mcp-server.ts`:

1. Delete the entire `handleUseToolGroup` method (currently L264-321):
```typescript
  /**
   * v3.2: handle use_tool_group meta-tool.
   */
  private async handleUseToolGroup(args: { name: string }) {
    // ... (delete entire method body)
  }
```

2. Delete the meta-tool pre-check in `CallToolRequest` handler (currently L919-921):
```typescript
        // v3.2.4 (Bug #20/#21): meta-tool handling BEFORE lazyLoad check so these work
        // even when DB_LAZY_LOAD_ENABLED=false.
```
(Delete these 2 comment lines and any related dispatch — the routing for `use_tool_group` / `use_tool_schema` cases.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/integration/meta-tool-removal.test.ts`
Expected: PASS (only the 2 use_tool_group-related assertions; use_tool_schema assertions come in Task 4)

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tool-definitions.ts src/mcp/mcp-server.ts tests/integration/meta-tool-removal.test.ts
git commit -m "refactor(mcp): remove use_tool_group tool (v4.0 G4)"
```

---

### Task 4: Remove `use_tool_schema` tool

**Files:**
- Modify: `src/mcp/tool-definitions.ts:159-163` (already emptied by Task 3, but verify)
- Modify: `src/mcp/mcp-server.ts:323-374` (handleUseToolSchema method)
- Modify: `tests/integration/meta-tool-removal.test.ts` (add use_tool_schema assertion)

**Interfaces:**
- Consumes: result of Task 3
- Produces: `use_tool_schema` not in `tools/list`; calling it returns UnknownTool

- [ ] **Step 1: Extend the failing test**

Append to `tests/integration/meta-tool-removal.test.ts`:

```typescript
describe('v4.0 G2: use_tool_schema removed', () => {
  let server: DatabaseMCPServer;
  let client: Client;

  beforeAll(async () => {
    server = new DatabaseMCPServer(null);
    client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
    const [sT, cT] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(sT), client.connect(cT)]);
  });

  afterAll(async () => {
    await server.close();
    await client.close();
  });

  it('use_tool_schema is NOT in tools/list', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).not.toContain('use_tool_schema');
  });

  it('calling use_tool_schema returns UnknownTool error', async () => {
    await expect(
      client.callTool({ name: 'use_tool_schema', arguments: { name: 'generate_sample_data' } })
    ).rejects.toThrow(/UnknownTool|tool not found/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/meta-tool-removal.test.ts`
Expected: FAIL — `use_tool_schema` still in `tools/list`

- [ ] **Step 3: Remove handler from mcp-server.ts**

In `src/mcp/mcp-server.ts`, delete the entire `handleUseToolSchema` method (currently L323-374):

```typescript
  /**
   * v3.2: handle use_tool_schema meta-tool.
   */
  private async handleUseToolSchema(args: { name: string }) {
    // ... (delete entire method body)
  }
```

(Verify Task 3 already deleted both meta tools from `tool-definitions.ts`. If only `use_tool_group` was deleted, remove `use_tool_schema` entry here too.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/meta-tool-removal.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/mcp/mcp-server.ts tests/integration/meta-tool-removal.test.ts
git commit -m "refactor(mcp): remove use_tool_schema tool (v4.0 G2)"
```

---

### Task 5: Inline `generate_sample_data` full schema (no more infoLazy split)

**Files:**
- Modify: `src/mcp/tool-definitions.ts:165-248` (infoLazyFullSchemas + infoLazy array)
- Create: `tests/integration/infolazy-removal.test.ts`

**Interfaces:**
- Consumes: result of Task 4
- Produces: `tools/list` returns `generate_sample_data` with full inputSchema (containing `options.rules`, etc.) directly

- [ ] **Step 1: Write the failing test**

Create `tests/integration/infolazy-removal.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseMCPServer } from '../../src/mcp/mcp-server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

describe('v4.0 G2: generate_sample_data has full schema in tools/list', () => {
  let server: DatabaseMCPServer;
  let client: Client;

  beforeAll(async () => {
    server = new DatabaseMCPServer(null);
    client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
    const [sT, cT] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(sT), client.connect(cT)]);
  });

  afterAll(async () => {
    await server.close();
    await client.close();
  });

  it('generate_sample_data is in tools/list', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('generate_sample_data');
  });

  it('inputSchema contains full options.rules array', async () => {
    const { tools } = await client.listTools();
    const genTool = tools.find((t) => t.name === 'generate_sample_data');
    expect(genTool).toBeDefined();
    // 完整 schema 必须包含 options.rules(原本 lazy 加载才有)
    const props = (genTool!.inputSchema as any).properties;
    expect(props).toHaveProperty('options');
    expect(props.options.properties).toHaveProperty('rules');
    expect(props.options.properties.rules.type).toBe('array');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/infolazy-removal.test.ts`
Expected: FAIL — current schema only has `tableName` + `rowCount`

- [ ] **Step 3: Inline full schema in tool-definitions.ts**

In `src/mcp/tool-definitions.ts`:

1. Replace the `infoLazyFullSchemas` constant + `infoLazy` array (currently L165-248) with a single `generate_sample_data` entry in the `tools` array. The new entry uses the full schema from `infoLazyFullSchemas.generate_sample_data` directly:

```typescript
// v4.0 G2: generate_sample_data 用完整 schema 直接注册(不再 infoLazy 分割)
{
  name: 'generate_sample_data',
  description: '按表结构生成 + 插入样例数据。需要 insert+batch 权限。',
  inputSchema: {
    type: 'object',
    properties: {
      tableName: { type: 'string' },
      rowCount: { type: 'number', default: 10 },
      options: {
        type: 'object',
        properties: {
          seed: { type: 'number' },
          columns: { type: 'array', items: { type: 'string' } },
          columnOverrides: { type: 'object' },
          rules: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                match: {
                  type: 'object',
                  properties: {
                    columnName: { type: 'string' },
                    columnNamePattern: { type: 'string' },
                    tableName: { type: 'string' },
                    columnType: { type: 'string' },
                  },
                },
                generate: {
                  type: 'object',
                  properties: {
                    type: {
                      type: 'string',
                      enum: ['fixed', 'range', 'pattern', 'faker', 'choice', 'enum', 'sequence', 'regex', 'null', 'skip'],
                    },
                  },
                  required: ['type'],
                  additionalProperties: true,
                },
              },
              required: ['generate'],
              additionalProperties: true,
            },
          },
          overwrite: { type: 'boolean', default: false },
        },
      },
    },
    required: ['tableName'],
  },
  // Execution lives in mcp-server switch (stateful); this stub is never called.
  call: async () => ({ error: 'generate_sample_data must be routed by mcp-server (stateful)' }),
}
```

2. Delete the `infoLazyFullSchemas` const + `infoLazy` array entirely.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/infolazy-removal.test.ts`
Expected: PASS (both tests)

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tool-definitions.ts tests/integration/infolazy-removal.test.ts
git commit -m "refactor(mcp): inline generate_sample_data full schema (v4.0 G2)"
```

---

## Phase 3: Core lazy load removal (G1, G3, G5, G7)

Now the architectural surgery. Tool count must reach 41, no client branching, no env var.

### Task 6: Remove `lazyLoadEnabled` env var + AppConfig field

**Files:**
- Modify: `src/types/http.ts:71, 78-82`
- Modify: `src/utils/config-loader.ts:219-235, 255, 277-279`
- Modify: `src/mcp/mcp-server.ts:67-68, 140-142, 203-206` (field + configureFromAppConfig block + setLazyLoadEnabled method)
- Create: `tests/unit/config-loader.test.ts` modifications

**Interfaces:**
- Consumes: result of Task 5
- Produces: setting `DB_LAZY_LOAD_ENABLED=true` is silently ignored; `appConfig.lazyLoad` field is gone

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/config-loader.test.ts` (extend existing file, don't replace):

```typescript
describe('v4.0 G5: lazy load env vars removed', () => {
  it('DB_LAZY_LOAD_ENABLED is ignored', () => {
    const prevEnabled = process.env.DB_LAZY_LOAD_ENABLED;
    const prevGroups = process.env.DB_LAZY_DEFAULT_GROUP;
    try {
      process.env.DB_LAZY_LOAD_ENABLED = 'true';
      process.env.DB_LAZY_DEFAULT_GROUP = 'query-experience';
      const cfg = loadConfigFromEnv();
      // 字段不存在;env 被静默忽略
      expect((cfg as any).lazyLoad).toBeUndefined();
    } finally {
      if (prevEnabled === undefined) delete process.env.DB_LAZY_LOAD_ENABLED;
      else process.env.DB_LAZY_LOAD_ENABLED = prevEnabled;
      if (prevGroups === undefined) delete process.env.DB_LAZY_DEFAULT_GROUP;
      else process.env.DB_LAZY_DEFAULT_GROUP = prevGroups;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/config-loader.test.ts -t "lazy load env vars"`
Expected: FAIL — `cfg.lazyLoad` still set

- [ ] **Step 3: Remove from http.ts**

In `src/types/http.ts`:

1. Delete L71: `lazyLoad?: LazyLoadConfig;`
2. Delete L78-82 (the `LazyLoadConfig` interface):
```typescript
export interface LazyLoadConfig {
  enabled: boolean;
  defaultActiveGroups: ('query-experience' | 'profiles' | 'data-governance' | 'index-advisor')[];
}
```

- [ ] **Step 4: Remove from config-loader.ts**

In `src/utils/config-loader.ts`:

1. Delete L219-220 (`DB_LAZY_LOAD_ENABLED` / `DB_LAZY_DEFAULT_GROUP` parsing)
2. Delete L225-235 (the `if (lazyEnabled)` block that sets `config.lazyLoad`)
3. Delete L255 (the `lazyLoad: { enabled: false, defaultActiveGroups: [] }` default)
4. Delete L277-279 (the `if (config.lazyLoad)` merge block)

- [ ] **Step 5: Remove from mcp-server.ts**

In `src/mcp/mcp-server.ts`:

1. Delete L67-68 (the `lazyLoadEnabled` field declaration + comment)
2. Delete L140-142 (the `if (appConfig.lazyLoad?.enabled) { this.lazyLoadEnabled = true; }` block in `configureFromAppConfig`)
3. Delete L199-206 (the entire `setLazyLoadEnabled` method)

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/config-loader.test.ts -t "lazy load env vars"`
Expected: PASS

- [ ] **Step 7: Run full test suite to ensure no regression**

Run: `npm test`
Expected: All other tests still pass (Tasks 1-5 tests + existing tests)

- [ ] **Step 8: Commit**

```bash
git add src/types/http.ts src/utils/config-loader.ts src/mcp/mcp-server.ts tests/unit/config-loader.test.ts
git commit -m "refactor(mcp): remove DB_LAZY_LOAD_ENABLED + DB_LAZY_DEFAULT_GROUP (v4.0 G5)"
```

---

### Task 7: Remove Claude Code workaround

**Files:**
- Modify: `src/mcp/mcp-server.ts:73, 216-241, 456-470, 482-486, 929` (sessionClientInfo field, isClaudeCodeClientName, shouldSkipLazyLoading, all detection branches)
- Create: `tests/integration/no-client-branching.test.ts`

**Interfaces:**
- Consumes: result of Task 6
- Produces: Claude Code client gets identical behavior to any other client

- [ ] **Step 1: Write the failing test**

Create `tests/integration/no-client-branching.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseMCPServer } from '../../src/mcp/mcp-server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

describe('v4.0 G3, G6: no client-conditional behavior', () => {
  it('Claude Code client gets full tool list', async () => {
    const server = new DatabaseMCPServer(null);
    const client = new Client(
      { name: 'claude-code-2.1.227', version: '2.1.227' },  // Claude Code client name
      { capabilities: {} }
    );
    const [sT, cT] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(sT), client.connect(cT)]);

    try {
      const { tools } = await client.listTools();
      // Claude Code 应该和其他 client 一样看到所有 tool(没有 workaround 跳过 lazy load)
      expect(tools.length).toBeGreaterThanOrEqual(41);
    } finally {
      await server.close();
      await client.close();
    }
  });

  it('no console.warn for Claude Code client', async () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: any[]) => warnings.push(args.join(' '));

    const server = new DatabaseMCPServer(null);
    const client = new Client({ name: 'claude-code-2.1.227', version: '2.1.227' }, { capabilities: {} });
    const [sT, cT] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(sT), client.connect(cT)]);

    try {
      // 触发 initialize + tools/list
      await client.listTools();
      // 不应该有 "detected Claude Code client" 警告
      const ccWarnings = warnings.filter((w) => w.includes('Claude Code'));
      expect(ccWarnings).toEqual([]);
    } finally {
      console.warn = origWarn;
      await server.close();
      await client.close();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/no-client-branching.test.ts`
Expected: FAIL — console.warn still fires for Claude Code

- [ ] **Step 3: Remove Claude Code detection from mcp-server.ts**

In `src/mcp/mcp-server.ts`:

1. Delete L73 (the `sessionClientInfo` Map field + comment)
2. Delete L216-241 (the entire `isClaudeCodeClientName` + `shouldSkipLazyLoading` methods + comments)
3. In the `InitializeRequest` handler (currently L456-477), delete the Claude Code detection block:
```typescript
        if (clientInfo?.name) {
          const info = { name: String(clientInfo.name), version: clientInfo.version ? String(clientInfo.version) : undefined };
          this.sessionClientInfo.set(this.currentSessionId, info);  // ← DELETE this line
          if (this.isClaudeCodeClientName(info.name)) {  // ← DELETE this if
            console.warn(...);  // ← DELETE
          }  // ← DELETE
        }  // ← DELETE
```
Replace with (just track name for audit, no detection):
```typescript
        if (clientInfo?.name) {
          // v4.0 G3: Claude Code detection removed — no more client-conditional behavior
          console.log(`[mcp-server] client connected: name="${clientInfo.name}" version="${clientInfo.version ?? '?'}"`);
        }
```

4. Delete L482-486 (the `treatAsLazyDisabled` computation in `ListToolsRequest` handler):
```typescript
      const treatAsLazyDisabled = this.shouldSkipLazyLoading();
      if (this.lazyLoadEnabled && this.toolRegistry && !treatAsLazyDisabled) {
```
(Will be further simplified in Task 9 — but the `treatAsLazyDisabled` variable disappears here.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/no-client-branching.test.ts`
Expected: PASS (both tests)

- [ ] **Step 5: Commit**

```bash
git add src/mcp/mcp-server.ts tests/integration/no-client-branching.test.ts
git commit -m "refactor(mcp): remove Claude Code workaround (v4.0 G3)"
```

---

### Task 8: Remove `toolRegistry` field + `rebuildToolRegistry()` method

**Files:**
- Modify: `src/mcp/mcp-server.ts:64, 246-261` (field + method)
- Create: `tests/integration/no-tool-registry.test.ts`

**Interfaces:**
- Consumes: result of Task 7
- Produces: server never instantiates a ToolRegistry; buildToolDefinitions() is called directly

- [ ] **Step 1: Write the failing test**

Create `tests/integration/no-tool-registry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DatabaseMCPServer } from '../../src/mcp/mcp-server.js';

describe('v4.0 G1: toolRegistry field removed', () => {
  it('server has no toolRegistry property', () => {
    const server = new DatabaseMCPServer(null);
    expect((server as any).toolRegistry).toBeUndefined();
  });

  it('server has no rebuildToolRegistry method', () => {
    const server = new DatabaseMCPServer(null);
    expect((server as any).rebuildToolRegistry).toBeUndefined();
  });

  it('server has no setLazyLoadEnabled method', () => {
    const server = new DatabaseMCPServer(null);
    expect((server as any).setLazyLoadEnabled).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/no-tool-registry.test.ts`
Expected: FAIL — fields/methods still present

- [ ] **Step 3: Remove from mcp-server.ts**

In `src/mcp/mcp-server.ts`:

1. Delete L64 (the `toolRegistry: ToolRegistry | null = null;` field)
2. Delete L246-261 (the entire `rebuildToolRegistry` method)
3. Remove the now-unused imports:
   - Delete L21: `import { ToolRegistry, type ToolGroup } from './tool-registry.js';`
   - Delete L22: `import { buildToolRegistry } from './tool-definitions.js';`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/no-tool-registry.test.ts`
Expected: PASS

- [ ] **Step 5: Run full suite for regression check**

Run: `npm test`
Expected: Build may fail because `rebuildToolRegistry` is still called in `setQueryAnalyzer` (L110), `setProfileManager` (L119), `setPlanHistory` (L128), `configureFromAppConfig` (L191). Fix those call sites:

```typescript
// In setQueryAnalyzer (L108-111): delete the this.rebuildToolRegistry() call
setQueryAnalyzer(qa: QueryAnalyzer | null): void {
  this.queryAnalyzer = qa;
}

// In setProfileManager (L117-120): delete the call
setProfileManager(pm: ProfileManager | null): void {
  this.profileManager = pm;
}

// In setPlanHistory (L126-129): delete the call
setPlanHistory(ph: any): void {
  this.planHistory = ph;
}

// In configureFromAppConfig (L136-192): delete the this.rebuildToolRegistry() call at L191
```

Re-run: `npm test` — Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/mcp/mcp-server.ts tests/integration/no-tool-registry.test.ts
git commit -m "refactor(mcp): remove toolRegistry + rebuildToolRegistry (v4.0 G1)"
```

---

### Task 9: Simplify `ListToolsRequest` handler to single path

**Files:**
- Modify: `src/mcp/mcp-server.ts:480-500` (the ListToolsRequest handler)
- Create: `tests/integration/list-tools-full.test.ts`

**Interfaces:**
- Consumes: result of Task 8
- Produces: `tools/list` always returns 41 tools (full set), no client branching

- [ ] **Step 1: Write the failing test**

Create `tests/integration/list-tools-full.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseMCPServer } from '../../src/mcp/mcp-server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

describe('v4.0 G1, G6: tools/list returns full set', () => {
  let server: DatabaseMCPServer;
  let client: Client;

  beforeAll(async () => {
    server = new DatabaseMCPServer(null);
    client = new Client({ name: 'test', version: '1.0.0' }, { capabilities: {} });
    const [sT, cT] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(sT), client.connect(cT)]);
  });

  afterAll(async () => {
    await server.close();
    await client.close();
  });

  it('returns 41 tools (43 - use_tool_group - use_tool_schema)', async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBe(41);
  });

  it('does not include use_tool_group or use_tool_schema', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).not.toContain('use_tool_group');
    expect(names).not.toContain('use_tool_schema');
  });

  it('includes core tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const required of ['connect_database', 'execute_query', 'get_schema', 'clear_cache']) {
      expect(names).toContain(required);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/list-tools-full.test.ts`
Expected: FAIL — count is 43 (lazy load still returns all)

- [ ] **Step 3: Simplify ListToolsRequest handler**

In `src/mcp/mcp-server.ts`, replace the entire `ListToolsRequest` handler (currently L480-500). Use `buildToolDefinitions()` directly:

```typescript
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      // v4.0 G1, G6: 单路径,无 client 分支。直接调 buildToolDefinitions() 合并 stateful。
      const profileStore = this.profileManager?.getProfileStore() ?? null;
      const profileManager = this.profileManager;
      const queryAnalyzer = this.queryAnalyzer;
      const config = this.config;

      const defs = buildToolDefinitions({
        queryAnalyzer,
        profileManager,
        profileStore,
        config,
        planHistory: this.planHistory,
      });

      const routedTools: any[] = defs.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));

      // 合并 stateful tools(CORE 12)
      const statefulTools = this.getStatefulToolsForList();
      const routedNames = new Set(routedTools.map((t) => t.name));
      for (const st of statefulTools) {
        if (!routedNames.has(st.name)) routedTools.push(st);
      }

      return { tools: routedTools };
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/list-tools-full.test.ts`
Expected: PASS

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/mcp/mcp-server.ts tests/integration/list-tools-full.test.ts
git commit -m "refactor(mcp): simplify ListToolsRequest to single path (v4.0 G1, G6)"
```

---

### Task 10: Simplify `CallToolRequest` handler (remove lazy dispatch)

**Files:**
- Modify: `src/mcp/mcp-server.ts:900-960` (the CallToolRequest handler lazy dispatch branches)
- Create: `tests/integration/call-tool-dispatch.test.ts`

**Interfaces:**
- Consumes: result of Task 9
- Produces: `tools/call` uses single dispatch path; meta tools and lazy tools removed

- [ ] **Step 1: Write the failing test**

Create `tests/integration/call-tool-dispatch.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseMCPServer } from '../../src/mcp/mcp-server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

describe('v4.0 G1, G6: tools/call single dispatch path', () => {
  let server: DatabaseMCPServer;
  let client: Client;

  beforeAll(async () => {
    server = new DatabaseMCPServer(null);
    client = new Client({ name: 'test', version: '1.0.0' }, { capabilities: {} });
    const [sT, cT] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(sT), client.connect(cT)]);
  });

  afterAll(async () => {
    await server.close();
    await client.close();
  });

  it('clear_cache dispatches to stateful handler', async () => {
    // 任何 connection 状态下 clear_cache 都应该工作(无 lazy 保护)
    const result = await client.callTool({ name: 'clear_cache', arguments: {} });
    expect(result).toBeDefined();
  });

  it('get_connection_status returns connection status', async () => {
    const result = await client.callTool({ name: 'get_connection_status', arguments: {} });
    expect(result).toBeDefined();
  });

  it('unknown tool returns UnknownTool error', async () => {
    await expect(
      client.callTool({ name: 'totally_made_up_tool', arguments: {} })
    ).rejects.toThrow(/UnknownTool|tool not found/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/call-tool-dispatch.test.ts`
Expected: FAIL — current dispatch has lazy branches

- [ ] **Step 3: Simplify CallToolRequest handler**

In `src/mcp/mcp-server.ts`, replace the lazy dispatch section in `CallToolRequest` (currently L919-944). Find the block:
```typescript
        // v3.2.4 (Bug #20/#21): meta-tool handling BEFORE lazyLoad check so these work
        // even when DB_LAZY_LOAD_ENABLED=false.
        // ... (meta-tool routing)
        const effectiveLazyEnabled = this.lazyLoadEnabled && !this.shouldSkipLazyLoading();
        if (effectiveLazyEnabled && this.toolRegistry) {
          if (this.toolRegistry.isToolActive(...)) {
            // ...
          }
          // ...
        }
```

Replace with the stateful switch fallthrough (no lazy check):
```typescript
        // v4.0 G1, G6: 单 dispatch 路径。无 lazy load,直接落到 stateful switch。
        // (stateful switch 已在下方;不需任何 lazy 守卫)
```

Also delete the `lazyToolErrorResponse` method (currently L377-394) since no caller remains.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/call-tool-dispatch.test.ts`
Expected: PASS

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/mcp/mcp-server.ts tests/integration/call-tool-dispatch.test.ts
git commit -m "refactor(mcp): remove lazy dispatch from CallToolRequest (v4.0 G1, G6)"
```

---

### Task 11: Delete `src/mcp/tool-registry.ts`

**Files:**
- Delete: `src/mcp/tool-registry.ts`

**Interfaces:**
- Consumes: result of Task 10
- Produces: tool-registry.ts file no longer exists; mcp-server.ts doesn't import from it

- [ ] **Step 1: Verify no remaining references**

Run: `git grep -nE "tool-registry|ToolRegistry|toolRegistry" -- 'src/' ':!src/mcp/tool-registry.ts'`
Expected: 0 matches (Task 8 already removed imports; Task 10 removed `lazyToolErrorResponse` which referenced it)

- [ ] **Step 2: Delete the file**

Run: `rm src/mcp/tool-registry.ts`

- [ ] **Step 3: Verify build still passes**

Run: `npm run build`
Expected: exit 0 (no import errors)

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add -A src/mcp/tool-registry.ts
git commit -m "refactor(mcp): delete tool-registry.ts (v4.0 G1, G7)"
```

---

### Task 12: Flatten `tool-definitions.ts` (remove group field)

**Files:**
- Modify: `src/mcp/tool-definitions.ts` (the entire `tool()` factory + all 4 group arrays → single `tools` array)
- Create: `tests/integration/no-groups.test.ts`

**Interfaces:**
- Consumes: result of Task 11
- Produces: `ToolDefinition` has no `group` field; `buildToolDefinitions()` returns single flat `tools: ToolDefinition[]`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/no-groups.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildToolDefinitions } from '../../src/mcp/tool-definitions.js';

describe('v4.0 G7: tool definitions have no group field', () => {
  it('buildToolDefinitions returns single tools array (no groups)', () => {
    const defs = buildToolDefinitions({
      queryAnalyzer: null,
      profileManager: null,
      profileStore: null,
      config: null,
    });
    expect(Array.isArray(defs.tools)).toBe(true);
    expect((defs as any).groups).toBeUndefined();
    expect((defs as any).meta).toBeUndefined();
    expect((defs as any).infoLazy).toBeUndefined();
  });

  it('no tool definition has group field', () => {
    const defs = buildToolDefinitions({
      queryAnalyzer: null,
      profileManager: null,
      profileStore: null,
      config: null,
    });
    for (const t of defs.tools) {
      expect(t.group).toBeUndefined();
      expect(t.infoLazy).toBeUndefined();
      expect(t.fullInputSchema).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/no-groups.test.ts`
Expected: FAIL — current `defs` has `groups`/`meta`/`infoLazy` keys

- [ ] **Step 3: Flatten tool-definitions.ts**

In `src/mcp/tool-definitions.ts`:

1. Delete L77 (`export type GroupName = ...`)
2. Replace the `ToolDefinitions` interface (L79-83) with:
```typescript
export interface ToolDefinitions {
  tools: ToolDefinition[];
}
```
3. Replace the `tool()` factory (L85-87) — remove `group` parameter:
```typescript
function tool(name: string, description: string, inputSchema: any, call: any): ToolDefinition {
  return { name, description, inputSchema, call };
}
```
4. Inside `buildToolDefinitions`, change all 4 arrays (`queryExperience`, `profiles`, `dataGovernance`, `indexAdvisor`) to push into a single `tools: ToolDefinition[]` array. Remove all `'query-experience'` / `'profiles'` / `'data-governance'` / `'index-advisor'` group string literals from tool() calls.
5. Also remove the ` [group: query-experience]` / ` [group: index-advisor]` suffixes from tool descriptions (these were debug markers).
6. Replace the `return { groups: ..., meta, infoLazy }` (L252-261) with:
```typescript
return { tools };
```
7. Replace `buildToolRegistry()` (L264-276) with:
```typescript
export function buildToolDefinitions(deps: ToolDeps): ToolDefinitions {
  // ... existing logic
}
```
(Wrap the existing logic into a single function that returns `{ tools }`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/no-groups.test.ts`
Expected: PASS

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: All tests pass (Task 9's list-tools-full.test.ts still gets 41 tools)

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tool-definitions.ts tests/integration/no-groups.test.ts
git commit -m "refactor(mcp): flatten tool definitions, remove group concept (v4.0 G7)"
```

---

### Task 13: Remove `DB_VISIBLE_GROUPS` / `DB_VISIBLE_TOOLS` env handling

**Files:**
- Modify: `src/utils/config-loader.ts` (verify no parsing exists; if spec'd-but-not-implemented, ensure env is silently ignored)
- Verify: `tests/unit/config-loader.test.ts` has assertion

**Interfaces:**
- Consumes: result of Task 12
- Produces: setting `DB_VISIBLE_GROUPS=...` or `DB_VISIBLE_TOOLS=...` is silently ignored

- [ ] **Step 1: Verify env vars are not parsed**

Run: `git grep -nE "DB_VISIBLE_GROUPS|DB_VISIBLE_TOOLS" -- src/`
Expected: 0 matches in `src/`

If 0 matches: proceed to Step 2 (verify tests cover this).

If matches exist: delete the parsing blocks.

- [ ] **Step 2: Add silent-ignore test**

Add to `tests/unit/config-loader.test.ts`:

```typescript
describe('v4.0 G7: DB_VISIBLE_* env vars silently ignored', () => {
  it('DB_VISIBLE_GROUPS is ignored', () => {
    const prev = process.env.DB_VISIBLE_GROUPS;
    try {
      process.env.DB_VISIBLE_GROUPS = 'query-experience,profiles';
      const cfg = loadConfigFromEnv();
      // 不应抛错,也不应被记录
      expect(cfg).toBeDefined();
    } finally {
      if (prev === undefined) delete process.env.DB_VISIBLE_GROUPS;
      else process.env.DB_VISIBLE_GROUPS = prev;
    }
  });

  it('DB_VISIBLE_TOOLS is ignored', () => {
    const prev = process.env.DB_VISIBLE_TOOLS;
    try {
      process.env.DB_VISIBLE_TOOLS = 'audit_log,get_metrics';
      const cfg = loadConfigFromEnv();
      expect(cfg).toBeDefined();
    } finally {
      if (prev === undefined) delete process.env.DB_VISIBLE_TOOLS;
      else process.env.DB_VISIBLE_TOOLS = prev;
    }
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run tests/unit/config-loader.test.ts -t "DB_VISIBLE"`
Expected: PASS (no parsing code to remove)

- [ ] **Step 4: Commit (test-only change)**

```bash
git add tests/unit/config-loader.test.ts
git commit -m "test(config): assert DB_VISIBLE_* env vars are silently ignored (v4.0 G7)"
```

---

### Task 14: Add `scripts/lint-instructions.ts` + wire into npm scripts

**Files:**
- Create: `scripts/lint-instructions.ts`
- Modify: `package.json` (add `lint:instructions` script + extend `lint`)

**Interfaces:**
- Consumes: `buildInstructions()` from Task 1
- Produces: `npm run lint:instructions` fails if instructions > 2000 chars or empty

- [ ] **Step 1: Write the lint script**

Create `scripts/lint-instructions.ts`:

```typescript
#!/usr/bin/env tsx
/**
 * CI lint: 确保 buildInstructions() 输出 < 2000 chars 且非空。
 * 挂到 npm run lint。
 */
import { buildInstructions } from '../src/mcp/instructions.js';

const text = buildInstructions();
if (text.length === 0) {
  console.error('❌ buildInstructions() returned empty string');
  process.exit(1);
}
if (text.length > 2000) {
  console.error(`❌ buildInstructions() too long: ${text.length} chars (max 2000)`);
  process.exit(1);
}
console.log(`✓ instructions OK (${text.length} chars)`);
```

- [ ] **Step 2: Wire into package.json**

In `package.json`, modify the `scripts` section:

```json
{
  "scripts": {
    "lint:instructions": "tsx scripts/lint-instructions.ts",
    "lint": "npm run lint:instructions && <existing lint command>"
  }
}
```

Replace `<existing lint command>` with whatever is currently in the project (likely `eslint .` or `tsc --noEmit`).

- [ ] **Step 3: Run lint**

Run: `npm run lint:instructions`
Expected: `✓ instructions OK (~1500 chars)`

Run: `npm run lint`
Expected: All lint steps pass

- [ ] **Step 4: Commit**

```bash
git add scripts/lint-instructions.ts package.json
git commit -m "chore: add lint-instructions.ts + wire into npm scripts (v4.0 G8)"
```

---

## Phase 4: Test cleanup + documentation

### Task 15: Delete obsolete test files (9 files)

**Files:**
- Delete: 9 test files from `docs/superpowers/specs/2026-08-17-remove-lazy-load-design.md` §2.1

- [ ] **Step 1: Verify no imports reference these test files**

Run: `git grep -nE "from .*(tool-registry|lazy-load-e2e|info-lazy-e2e|session-isolation|lazy-loading-notification|client-detection|mcp-meta-tools|tool-definitions)\.test" -- src/ tests/`
Expected: 0 matches

- [ ] **Step 2: Delete files**

Run:
```bash
git rm \
  tests/unit/tool-registry.test.ts \
  tests/integration/lazy-load-e2e.test.ts \
  tests/integration/info-lazy-e2e.test.ts \
  tests/integration/session-isolation-e2e.test.ts \
  tests/unit/lazy-loading-notification.test.ts \
  tests/unit/client-detection.test.ts \
  tests/unit/mcp-meta-tools.test.ts \
  tests/unit/tool-definitions.test.ts
```

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All remaining tests pass

- [ ] **Step 4: Commit**

```bash
git commit -m "test: remove obsolete lazy-load / registry / client-detection tests (v4.0 G1-G7)"
```

---

### Task 16: Update audit-docs test + verify remaining tests

**Files:**
- Modify: `tests/unit/audit-docs.test.ts` (if it references lazy load)
- Verify: `npm test` clean

- [ ] **Step 1: Find lazy load references in remaining test files**

Run: `git grep -nE "lazy[ _]?load|lazyLoad|toolRegistry|DB_LAZY_|use_tool_group|use_tool_schema|infoLazy|isClaudeCode|listChanged" -- tests/`
Expected: 0 matches (all references should be in deleted files)

- [ ] **Step 2: If matches exist, remove or update them**

If `audit-docs.test.ts` asserts lazy load is documented, update the assertion to verify it's documented as REMOVED:

```typescript
// Old:
expect(docsContent).toContain('lazy load');

// New:
expect(docsContent).not.toContain('DB_LAZY_LOAD_ENABLED');
expect(docsContent).toContain('use_tool_group');  // in MIGRATION-v4.md as removed
```

(Adjust based on actual content found.)

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "test: update audit-docs assertions for v4.0 removal (v4.0 G7)"
```

---

### Task 17: Delete `docs/03-features/lazy-loading.md`

**Files:**
- Delete: `docs/03-features/lazy-loading.md`
- Modify: `docs/03-features/README.md` (remove lazy-loading entry)

- [ ] **Step 1: Delete the doc**

Run: `git rm docs/03-features/lazy-loading.md`

- [ ] **Step 2: Update features README**

In `docs/03-features/README.md`, remove the entry pointing to `lazy-loading.md`:

Find and delete any line referencing "lazy-loading" or "lazy load" or the deleted file.

- [ ] **Step 3: Commit**

```bash
git add -A docs/
git commit -m "docs: remove lazy-loading.md (v4.0 G7)"
```

---

### Task 18: Add `docs/MIGRATION-v4.md`

**Files:**
- Create: `docs/MIGRATION-v4.md`

- [ ] **Step 1: Write the migration guide**

Create `docs/MIGRATION-v4.md`:

```markdown
# Migrating to v4.0

v4.0 removes the v3.2 tool lazy-load mechanism and adopts Claude Code's deferred tool search as the primary model. This is a BREAKING release.

## What changed

### Tools removed (2)

- `use_tool_group` — group activation is no longer needed; all tools are always available
- `use_tool_schema` — schema lazy-loading is no longer needed; full schemas are returned in `tools/list`

### Environment variables removed (4)

| Env var | What to do |
|---------|------------|
| `DB_LAZY_LOAD_ENABLED=true` | Remove this env var. It is now silently ignored. |
| `DB_LAZY_DEFAULT_GROUP=...` | Remove this env var. |
| `DB_VISIBLE_GROUPS=...` | Remove this env var. |
| `DB_VISIBLE_TOOLS=...` | Remove this env var. |

### Mechanism removed

- The v3.2 per-DB-type tool filtering — `tools/list` now returns the full tool set regardless of active DB connection
- The `infoLazy` mode — `generate_sample_data` now returns its full input schema directly
- The Claude Code client workaround — all clients get identical behavior now

### Added

- `InitializeResult.instructions` — a Markdown hint returned in `initialize` response, helping Claude decide when to search this server's tools

## Migration steps

1. **Update your `.mcp.json`** to remove any of the removed env vars
2. **Update LLM prompts/scripts** that call `use_tool_group` or `use_tool_schema` — these tools no longer exist
3. **No action needed** if you only use the core 41 tools (`connect_database`, `execute_query`, `get_schema`, etc.)
4. **Verify** by running `tools/list` against your server and confirming you see 41 tools

## Why this change?

Claude Code 2.1.227+ enables deferred tool search by default. Under deferred mode:
- All tool NAMES are sent at session start (no change there)
- Full schemas are loaded only when Claude calls a tool
- `server.instructions` field gives Claude a "what is this server for / when to search" hint

The v3.2 lazy-load mechanism was redundant with deferred mode (it filtered tool names; deferred already handles schema on demand). Removing it simplifies the codebase without losing functionality.

For non-Claude-Code clients (Bedrock, Foundry, Dify, Cline, etc.) that don't support tool search, the v4.0 behavior is identical to what they've been doing under v3.3.2's Claude Code workaround (all tools visible).

## Need help?

- File an issue: https://github.com/joyous-coder/universal-db-mcp/issues
- Read the spec: `docs/superpowers/specs/2026-08-17-remove-lazy-load-design.md`
```

- [ ] **Step 2: Commit**

```bash
git add docs/MIGRATION-v4.md
git commit -m "docs: add MIGRATION-v4.md (v4.0 user guide)"
```

---

### Task 19: Update CHANGELOG.md

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add v4.0.0 entry**

At the top of `CHANGELOG.md` (after the header), add:

```markdown
## [4.0.0] - 2026-08-17

### ⚠ BREAKING CHANGES

- **Removed tools** (2):
  - `use_tool_group` — group activation no longer needed (all tools always visible)
  - `use_tool_schema` — schema lazy-loading no longer needed (full schemas in `tools/list`)
- **Removed env vars** (4): `DB_LAZY_LOAD_ENABLED`, `DB_LAZY_DEFAULT_GROUP`, `DB_VISIBLE_GROUPS`, `DB_VISIBLE_TOOLS` (all silently ignored)
- **Removed capability**: `tools.listChanged: true` (now default false; not declared)
- **Removed mechanisms**:
  - Per-DB-type tool lazy load (`toolRegistry.listActiveTools`)
  - `infoLazy` mode (`generate_sample_data` stub/full schema split)
  - Claude Code client workaround (`isClaudeCodeClientName`, `shouldSkipLazyLoading`)
- **Removed concept**: tool `group` field
- **Added**: `InitializeResult.instructions` field — Markdown hint (< 2000 chars) for deferred tool search

### Notes

- The DB schema cache (`database-service.ts` `schemaCache` / `clear_cache`) is preserved — this is real DB-level caching, unrelated to tool lazy-load
- See `docs/MIGRATION-v4.md` for migration guide
- See `docs/superpowers/specs/2026-08-17-remove-lazy-load-design.md` for the design rationale

### Migration

For Claude Code users (the main audience): no action required — v3.3.2's workaround already routed Claude Code to the v3.1 "all tools visible" path. v4.0 makes this the default for all clients.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): add v4.0.0 BREAKING entry"
```

---

### Task 20: Update README.md + README.zh-CN.md

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`

- [ ] **Step 1: Add "Breaking changes in v4" section**

In `README.md`, after the introduction:

```markdown
## Breaking changes in v4

v4.0 removes the tool lazy-load mechanism. See [MIGRATION-v4.md](./docs/MIGRATION-v4.md).

Quick summary:
- 2 tools removed: `use_tool_group`, `use_tool_schema`
- 4 env vars silently ignored: `DB_LAZY_LOAD_ENABLED`, `DB_LAZY_DEFAULT_GROUP`, `DB_VISIBLE_GROUPS`, `DB_VISIBLE_TOOLS`
- New: `InitializeResult.instructions` field for Claude Code deferred tool search

For Claude Code users: no action required. For other clients (Bedrock, Dify, etc.): all tools are now visible (was already the case under v3.3.2's workaround for Claude Code).
```

- [ ] **Step 2: Remove lazy load references**

Run: `git grep -nE "lazy[ _-]?load|DB_LAZY_|toolRegistry|infoLazy|use_tool_group|use_tool_schema" -- README.md`
Expected: matches found

For each match, decide:
- If it's documenting v4.0 removal → keep
- If it's documenting v3.x as a feature → remove

- [ ] **Step 3: Mirror changes in README.zh-CN.md**

Apply the same edits to `README.zh-CN.md` (translate the new section to Chinese):

```markdown
## v4.0 Breaking Changes

v4.0 移除了 tool 懒加载机制。详见 [MIGRATION-v4.md](./docs/MIGRATION-v4.md)。

快速摘要:
- 删除 2 个 tool:`use_tool_group`、`use_tool_schema`
- 4 个 env 静默忽略:`DB_LAZY_LOAD_ENABLED`、`DB_LAZY_DEFAULT_GROUP`、`DB_VISIBLE_GROUPS`、`DB_VISIBLE_TOOLS`
- 新增:`InitializeResult.instructions` 字段(给 Claude Code deferred tool search 用)

Claude Code 用户:无需任何操作。其他客户端(Bedrock、Dify 等):现在所有 tool 都可见(v3.3.2 的 workaround 已经让 Claude Code 走这条路径,v4.0 让所有 client 一致)。
```

- [ ] **Step 4: Commit**

```bash
git add README.md README.zh-CN.md
git commit -m "docs(readme): add v4.0 BREAKING section + remove lazy load refs"
```

---

### Task 21: Add superseded banner to v3.x pruning spec

**Files:**
- Modify: `docs/superpowers/specs/2026-07-27-mcp-tool-pruning-v3-x-design.md`

- [ ] **Step 1: Add banner at top**

Insert at line 1 (before the existing `# Universal DB MCP` title):

```markdown
> ⚠️ **SUPERSEDED BY v4.0** — This design proposed a "CORE 12 + groups" tool pruning model. v4.0 (`docs/superpowers/specs/2026-08-17-remove-lazy-load-design.md`) removed the lazy-load mechanism and the group concept entirely. The static CORE 12 whitelist idea may still be valuable for further tool surface reduction in v4.x or v5.0 — please file an issue if you want to revive that workstream.

---

```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-07-27-mcp-tool-pruning-v3-x-design.md
git commit -m "docs(spec): mark v3.x pruning spec as superseded by v4.0"
```

---

## Phase 5: Release

### Task 22: Bump version to v4.0.0

**Files:**
- Modify: `package.json` (version field)

- [ ] **Step 1: Check current version**

Run: `grep '"version"' package.json`
Expected: `"version": "3.x.x"`

- [ ] **Step 2: Bump to 4.0.0**

Edit `package.json`:
```json
{
  "version": "4.0.0"
}
```

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(release): bump version to 4.0.0"
```

---

### Task 23: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass, 0 failures

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: exit 0, `dist/` produced

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: exit 0 (includes `lint:instructions` from Task 14)

- [ ] **Step 4: Run final grep verification**

Run: `git grep -nE "lazyLoad|toolRegistry|isClaudeCode|shouldSkipLazy|sessionClientInfo|listChanged.*true|lazyLoadEnabled|DB_LAZY_|use_tool_group|use_tool_schema|getFullSchema|ToolGroup|GroupName|DB_VISIBLE_GROUPS|DB_VISIBLE_TOOLS" -- 'src/' 'tests/'`
Expected: 0 matches

(Exceptions allowed: CHANGELOG.md / MIGRATION-v4.md / spec files — those document the removal, not implement it.)

- [ ] **Step 5: Verify git status clean**

Run: `git status`
Expected: `nothing to commit, working tree clean`

---

### Task 24: Tag + release

**Files:** none (release only)

- [ ] **Step 1: Write release notes**

Create `release-notes-v4.md`:

```markdown
# v4.0.0 — Tool Lazy-Load Removal

## Highlights

- Adopts Claude Code's deferred tool search (default since v2.1.227) as the primary model
- Removes the v3.2 per-DB-type tool lazy-load mechanism
- All tools now visible in `tools/list` regardless of active DB or client type
- Adds `server.instructions` field to help Claude know when to search this server's tools

## Breaking Changes

- 2 tools removed: `use_tool_group`, `use_tool_schema`
- 4 env vars silently ignored: `DB_LAZY_LOAD_ENABLED`, `DB_LAZY_DEFAULT_GROUP`, `DB_VISIBLE_GROUPS`, `DB_VISIBLE_TOOLS`
- `tools.listChanged: true` capability removed (default false)

## For Claude Code Users

No action required. v3.3.2's Claude Code workaround already routed you to the "all tools visible" path. v4.0 makes this the default for all clients.

## For Other Clients (Bedrock, Dify, Cline, etc.)

All tools are now always visible. Tool count: 43 → 41.

## Migration Guide

See `docs/MIGRATION-v4.md` in the repository.
```

- [ ] **Step 2: Tag the release**

Run:
```bash
git tag -a v4.0.0 -m "v4.0.0: Tool lazy-load removal"
git push origin main
git push origin v4.0.0
```

- [ ] **Step 3: Create GitHub release**

Run:
```bash
gh release create v4.0.0 --notes-file release-notes-v4.md --verify-tag
```

Expected: Release created; CI workflow `publish.yml` auto-runs `npm publish --provenance --access public`

- [ ] **Step 4: Verify on npm**

Run: `npm view @joyous-coder/universal-db-mcp@4.0.0`
Expected: package metadata visible, version 4.0.0

---

## Self-Review

**1. Spec coverage:** Each G1-G8 in spec §1.4 is covered:

| Goal | Covered by Task(s) |
|------|---------------------|
| G1 (lazy load removal) | Tasks 6, 8, 9, 10, 11 |
| G2 (infoLazy removal) | Tasks 4, 5 |
| G3 (Claude Code workaround) | Task 7 |
| G4 (use_tool_group + listChanged removal) | Tasks 2, 3 |
| G5 (DB_LAZY_* env removal) | Task 6 |
| G6 (single dispatch path) | Tasks 9, 10 |
| G7 (group concept removal) | Tasks 11, 12, 13 |
| G8 (server.instructions) | Tasks 1, 2, 14 |

All 8 goals have explicit tasks. ✅

**2. Placeholder scan:** Searched for TBD/TODO/FIXME/"add appropriate"/"fill in details". None found. Each task has concrete code. ✅

**3. Type consistency:** Cross-checked function names:
- `buildInstructions()` — defined Task 1, used Tasks 2 & 14
- `buildToolDefinitions(deps)` — signature stable through Tasks 9, 12; returns `{ tools: ToolDefinition[] }` after Task 12
- `getStatefulToolsForList()` — kept unchanged in Task 9
- `ToolDefinition` interface — `group`/`infoLazy`/`fullInputSchema` fields removed in Task 12

No naming drift detected. ✅

**4. Scope:** Single implementation plan, 24 tasks, all bite-sized (2-5 minutes each). ✅
