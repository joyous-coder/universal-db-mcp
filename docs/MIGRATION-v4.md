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
- `server.instructions` field is enforced via CI lint (< 2000 chars hard cap)

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