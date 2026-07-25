# Multi-Profile (v2.18 + v2.19)

v2.18 adds multi-database management: multiple named profiles, runtime switching, read/write routing, and global schema view.

v2.19 adds two complementary capabilities:

1. **Profile encryption** — `profiles.db` can be transparently encrypted with SQLCipher via the optional `better-sqlite3-multiple-ciphers` package and the `DB_PROFILE_ENCRYPTION_KEY` env var.
2. **Cross-profile templates & history** — templates and history can be tagged with a profile name, so callers can filter to global, per-profile, or aggregate per profile.

## Concepts

- **Profile** — A named database connection definition (host/port/user/etc.) stored in `profiles.db`. Roles: `primary` (writes) / `replica` (reads) / `analytics` (read-heavy).
- **LiveProfile** — A profile that is currently connected (Live in the ProfileManager's `liveProfiles` Map).
- **Use profile** — Switch the active connection; subsequent MCP tools use that profile.

## 4 capabilities

### 1. Save / list / delete profile

`POST /api/profiles` (or MCP `save_profile`):
```json
{ "name": "prod-mysql", "description": "Production MySQL", "type": "mysql", "config": { "host": "db.prod.example.com", "port": 3306, "user": "app", "password": "..." }, "role": "primary", "tags": ["prod"] }
```

### 2. Switch active profile

`use_profile` (MCP) or `POST /api/profiles/:name/connect` (HTTP). Loads the profile's adapter if not already live.

### 3. Read/write routing

- `kind='write'` queries → always primary.
- `kind='read'` queries against a `replica` or `analytics` profile → round-robin across live profiles of the same role.

`routeQuery(profileName, sql, 'read'|'write', params)` is the underlying API.

### 4. Global schema view

`GET /api/global-schema` (or MCP `get_global_schema`). Returns all enabled profiles' schemas in parallel, merged by profile name. Useful for LLMs to know which database has what.

## Configuration

| Env | Default | Effect |
|---|---|---|
| `DB_MULTI_DB_ENABLED` | `true` | Disable all multi-DB (revert to v2.14 single-DB) |
| `DB_PROFILES_DB_PATH` | `${cwd}/.db-mcp/profiles.db` | Profile storage |
| `DB_PROFILES_MAX` | `50` | Hard cap; LRU unload oldest live on overflow |
| `DB_DEFAULT_PROFILE_ROLE` | `primary` | Default role for new saves |
| `DB_READ_ROUTING` | `round-robin` | `round-robin` / `random` / `least-loaded` |

## Backward compatibility

- `connect_database` (no `profileName`) → v2.14 path, unchanged.
- HTTP `POST /api/connect` (no `profileName`) → v2.14 path.
- v2.16 metrics + v2.17 query analyzer → unchanged.

## Security

- `profiles.db` is encrypted at rest when `DB_PROFILE_ENCRYPTION_KEY` is set (v2.19+), otherwise stored as plaintext (legacy behavior).
- Without encryption, **add `profiles.db` to `.gitignore`** to keep credentials out of VCS.

## Zero dependencies

Reuses v2.16 multi-backend SQLite. The optional `better-sqlite3-multiple-ciphers` dep (~5 MB) is only needed when you want profile encryption; it's listed in `optionalDependencies`.

---

## v2.19 additions

### Profile encryption (SQLCipher)

Set the env var `DB_PROFILE_ENCRYPTION_KEY` to a secret (≥ 32 chars recommended) to encrypt `profiles.db` end-to-end:

```bash
export DB_PROFILE_ENCRYPTION_KEY="my-strong-passphrase-at-least-32-chars"
```

Behavior:

- **Key set + `better-sqlite3-multiple-ciphers` installed**: profiles.db opened via SQLCipher (`PRAGMA cipher='sqlcipher'` + `PRAGMA key=...`).
- **Key set + dep missing**: startup fails loudly with `better-sqlite3-multiple-ciphers not installed`. Clear error, no silent fallback.
- **Wrong key**: clear error `failed to decrypt profiles.db — check DB_PROFILE_ENCRYPTION_KEY`. No silent fallback to a blank DB.
- **Key empty/missing**: legacy plaintext behavior (v2.18 compatible) with a single startup warning.

To install the optional dep:

```bash
npm install better-sqlite3-multiple-ciphers
```

### Cross-profile templates

Templates now have an optional `profile_name` column (added via `ALTER TABLE` idempotent migration; null = backward-compatible global).

**Save**:

```json
{ "tool": "save_template", "args": { "name": "list-orders", "sql": "SELECT * FROM orders WHERE id=${id}", "parameters": [...], "profile_name": "prod-mysql" } }
```

**List filter**:

| Filter | Behavior |
|--------|----------|
| omitted | All templates (global + every profile) — backward-compatible |
| `profileName: null` | Only global templates (`profile_name IS NULL`) |
| `profileName: "prod-mysql"` | Only templates bound to that profile |

Both MCP tool and HTTP endpoint accept the same shape.

### Cross-profile history

`get_query_history` (MCP) and `GET /api/query-history` (HTTP) gain:

- `profileName: string | null` — same 3-state semantics as templates.
- `groupBy: 'profile'` — return per-profile aggregate:

```json
{
  "entries": [
    { "profileName": "prod-mysql", "count": 142, "errors": 3, "avg_ms": 12.5 },
    { "profileName": "staging",    "count":  89, "errors": 1, "avg_ms":  8.2 }
  ]
}
```

`QueryAnalyzer.recordQuery` automatically tags rows with the active profile via `DatabaseService.setActiveProfileProvider(...)`. `ProfileManager.routeQuery` tags rows with the routed profile name directly.

### Configuration (v2.19)

| Env var | Default | Effect |
|---------|---------|--------|
| `DB_PROFILE_ENCRYPTION_KEY` | (empty) | SQLCipher key for `profiles.db`. Empty → plaintext (v2.18 compat). |
| `DB_TEMPLATES_DB_KEY` | (empty) | Reserved for future SQLCipher encryption of `templates.db`. No effect in v2.19. |
| `DB_HISTORY_DB_KEY` | (empty) | Reserved for future SQLCipher encryption of `history.db`. No effect in v2.19. |

Backward compatibility: v2.14 → v2.18 callers see no behavioral change unless they opt into cipher via env.

---

## v2.20 additions

Profile Hardening: extends SQLCipher coverage to all 3 stores, adds profile
YAML/JSON import/export, cipher key rotation, and history FTS5 full-text search.

### SQLCipher for `templates.db` and `history.db`

v2.19 listed `DB_TEMPLATES_DB_KEY` and `DB_HISTORY_DB_KEY` as **placeholders**.
v2.20 actually wires them through:

```bash
export DB_TEMPLATES_DB_KEY="my-templates-passphrase"
export DB_HISTORY_DB_KEY="my-history-passphrase"
```

Without the env vars, the stores fall back to plaintext (v2.17-v2.19 behavior).
The cipher flag is exposed via `<Store>.encrypted` (boolean) for diagnostics.

### Profile YAML / JSON import/export

```bash
# Export to YAML (passwords redacted by default)
universal-db-mcp export-profiles > profiles.yaml

# Include actual passwords (avoid committing the file!)
universal-db-mcp export-profiles --include-secrets > profiles.yaml

# JSON round-trip (machine-friendly)
universal-db-mcp export-profiles --format json > profiles.json

# Import (merge by default; replace to wipe existing)
universal-db-mcp import-profiles < profiles.yaml
universal-db-mcp import-profiles --mode replace < profiles.yaml
```

Format version: `1` (in YAML as `version: 1` first line). Importers reject:
- Unknown `type` values (e.g. typos, deprecated adapters).
- Invalid `role` (must be primary/replica/analytics).
- Non-object `config`.

Re-importing a previously-redacted file requires the operator to provide
missing passwords separately (e.g. `--password name=prod password=...`).

### Cipher key rotation

Three env-var pairs let you rotate keys without downtime:

| Old | New |
|---|---|
| `DB_PROFILE_ENCRYPTION_KEY_OLD` | `DB_PROFILE_ENCRYPTION_KEY` |
| `DB_TEMPLATES_DB_KEY_OLD` | `DB_TEMPLATES_DB_KEY` |
| `DB_HISTORY_DB_KEY_OLD` | `DB_HISTORY_DB_KEY` |

Procedure:

1. Start the server once with both old + new keys set. The server migrates
   the DB atomically (temp file + rename), then warns the operator to unset
   the `_OLD` env var.
2. Subsequent startups use the new key only.

If the old key is wrong, startup fails loudly (`failed to decrypt X.db —
check _OLD key`); the original DB is never touched.

Programmatic rotation: `profileStore.rotateKey(newKey)` /
`templateStore.rotateKey(newKey)` / `historyStore.rotateKey(newKey)`.

### History FTS5 full-text search

`get_query_history` (MCP) and `/api/query-history` (HTTP) accept a new `q`
parameter with SQLite FTS5 query syntax:

- Simple: `orders`, `SELECT`, `users`
- Phrase: `"FROM orders"`
- Boolean: `orders NOT invoices`, `orders OR returns`
- Prefix: `orders*`

Combined with the existing filters (`db`, `kind`, `since`, `until`,
`profileName`, `onlyErrors`, `limit`).

The FTS5 virtual table (`history_fts`) is created automatically on first
init() of any pre-existing or new history.db — no migration step required.

### Configuration (v2.20)

| Env var | Default | Effect |
|---------|---------|--------|
| `DB_PROFILE_ENCRYPTION_KEY` | (empty) | profiles.db cipher (v2.19 active) |
| `DB_PROFILE_ENCRYPTION_KEY_OLD` | (empty) | profiles.db rotation old key (v2.20) |
| `DB_TEMPLATES_DB_KEY` | (empty) | templates.db cipher (v2.20 — was v2.19 placeholder) |
| `DB_TEMPLATES_DB_KEY_OLD` | (empty) | templates.db rotation old key |
| `DB_HISTORY_DB_KEY` | (empty) | history.db cipher (v2.20 — was v2.19 placeholder) |
| `DB_HISTORY_DB_KEY_OLD` | (empty) | history.db rotation old key |

Backward compatibility: v2.14 → v2.19 callers see no behavior change unless
the new env vars are set; the FTS5 migration is also automatic and
transparent.

See `docs/deferred-items.md` for the deferred-items ledger covering
v2.16-v2.20.