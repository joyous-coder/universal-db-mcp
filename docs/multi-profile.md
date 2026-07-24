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