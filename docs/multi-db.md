# Multi-DB (v2.18)

v2.18 adds multi-database management: multiple named profiles, runtime switching, read/write routing, and global schema view.

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

- `profiles.db` contains plaintext passwords. **Add it to `.gitignore`.**
- Profile encryption (SQLCipher) is planned for v2.19.

## Zero dependencies

Reuses v2.16 multi-backend SQLite. No new npm packages.