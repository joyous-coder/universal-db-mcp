# v3.2.6 — v3.2.5-patch1: minor fixes from e2e regression

## What's in this release

Two minor issues found during e2e regression testing of v3.2.5. Both verified working in live Claude Code session before release.

## Fixes

### Bug #25 — `generate_sample_data` SQL bind failure

**Repro**: On fresh `:memory:` SQLite:
```js
execute_query({sql: "CREATE TABLE foo(id INTEGER, name TEXT)"})
clear_cache()
generate_sample_data({tableName: "foo", rowCount: 3})
// ❌ "Provided value cannot be bound to SQLite parameter 1"
```

**Root cause**: `id` column is auto-increment, generator returns `undefined` from `matchHeuristic` (line 119: `if (name === 'id' || /_id$/i.test(name)) return undefined;`). `node:sqlite`'s `stmt.run()` rejects binding `undefined` to `?` placeholders.

**Fix** (`src/core/database-service.ts:388-397`):
```typescript
const value = generator.generateValue(...);
row.push(value === undefined ? null : value);  // ← was value
```

SQLite treats NULL as new auto-increment, so semantics preserved.

**Verify**: `insertedRows: 3` ✅ on fresh connection.

### Minor #1 — `execute_template` accepts name OR id

**Repro**: User naturally passes name, gets "template not found":
```js
save_template({name: "foo", sql: "SELECT 42 AS answer"})
// Returns id: "tICv-WcO"
execute_template({id: "foo", params: {}})  // ❌ "template not found: foo"
```

**Fix** (`src/mcp/tools/query-tools.ts:76-95`):
```typescript
let templateId = args.id;
if (!templateId && args.name) {
  const all: any[] = await (qa as any).templates?.list?.() ?? [];
  const match = all.find((t: any) => t.name === args.name);
  if (match) templateId = match.id;
}
```

**Verify**: `execute_template({name: "verify_minor1", params: {}})` → `{answer: 100}` ✅

## Coverage

- **All 16 bugs fixed across v3.2.3 → v3.2.6** (Bug #1-#8 + #11-#22 + #25)
- **0 bugs open**
- **Sqlite 41/43 tools verified** in lazy=true mode (Bug #8 fix verified — `use_tool_group` returns `alreadyActive:true` immediately)
- **533/533 unit tests pass**

## Upgrade

```bash
npm install -g @joyous-coder/universal-db-mcp@latest
# Backwards-compatible with v3.2.5
```