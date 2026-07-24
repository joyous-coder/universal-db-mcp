# Tool Lazy-Loading (v3.2)

## Why

In v3.1, 26 MCP tool definitions (description + schema) were loaded into every Claude Desktop session — ~1,750 tokens even when most tools weren't used.

v3.2 splits tools into:
- **12-14 core** (always-on; conditional on permission for `execute_script` / `execute_sql_file` / `execute_batch`)
- **28 lazy** (4 groups: query-experience / profiles / data-governance / index-advisor)
- **1 info-lazy** (generate_sample_data)

Default session now uses ~700 tokens (60% reduction).

> **Backward compat**: lazy-loading is **opt-in** via `DB_LAZY_LOAD_ENABLED=true`. Default behavior (v3.1) is unchanged — all 26+ tools always listed.

## Groups

| Group | Tools | Purpose |
|---|---|---|
| `query-experience` (9) | explain_query, lint_sql, get_query_history, save/list/get/delete/execute_template, get_metrics | SQL analysis + templates + metrics |
| `profiles` (11) | save, list, use, global_schema, export, import, get, delete, enable, disable, disconnect | Multi-profile management + lifecycle |
| `data-governance` (5) | compare_profile_schemas, export_backup, audit_log, get_pii_config, set_pii_config | Schema diff + backup + audit + PII |
| `index-advisor` (3) | explain_query_with_advice, compare_query_plans, list_query_plans | Plan advice + diff + history |

## Meta-tools

### `use_tool_group({ name: <group> })`

Activates a group. Returns:

```json
{
  "alreadyActive": false,
  "activeGroups": ["data-governance"],
  "newlyAvailable": [
    { "name": "compare_profile_schemas", "description": "..." },
    { "name": "export_backup", "description": "..." },
    ...
  ]
}
```

### `use_tool_schema({ name: "generate_sample_data" })`

Returns the full JSON Schema (with examples) for info-lazy tools. Currently only `generate_sample_data`.

## Error format

When LLM calls a lazy tool without activation:

```json
{
  "error": "tool not available in current session",
  "tool": "compare_profile_schemas",
  "group": "data-governance",
  "hint": "call use_tool_group({ name: \"data-governance\" }) first",
  "activeGroups": ["profiles"]
}
```

When LLM calls `generate_sample_data` with missing fields:

```json
{
  "error": "missing required: tableName",
  "hint": "call use_tool_schema({ name: \"generate_sample_data\" }) to load full schema"
}
```

## Env vars

| Var | Default | Effect |
|---|---|---|
| `DB_LAZY_LOAD_ENABLED` | `false` | `true` = activate lazy-loading. `false` = v3.1 behavior (all tools always listed) |
| `DB_LAZY_DEFAULT_GROUP` | empty | Comma-separated groups to pre-activate at session start (e.g. `query-experience,profiles`) |

## Transport mode

| Mode | Behavior |
|---|---|
| **stdio** | ✅ Uses lazy-loading when enabled. `sessionId='stdio-default'` |
| **MCP SSE** (`/sse`) | ✅ Uses lazy-loading when enabled. `sessionId` = MCP transport session id |
| **Streamable HTTP** (`/mcp`) | ✅ Uses lazy-loading when enabled. `sessionId` = MCP SDK session id |
| **REST API** (`/api/...`) | ❌ Not affected. Same as v3.1 |

Per-session state is isolated — different sessions in the same server process have independent active groups.

## State lifecycle

- Active groups are **in-memory only** (not persisted)
- Each new MCP session starts with default groups (`DB_LAZY_DEFAULT_GROUP` if set, else empty)
- LLM must re-activate groups per session (one round-trip cost)