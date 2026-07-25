# v3.2.7 — MongoDB e2e-driven 2 critical bug fixes

## What's in this release

Continuation of v3.2.7 backlog — Redis + MongoDB e2e testing found 2 critical bugs. Both verified working in live Claude Code session.

## Fixes

### Bug #26 — MongoDB `execute_query` multi-arg parse failure

**Repro**:
```js
execute_query({sql: 'db.users.insertOne({name: "alice", age: 30})'})  // ✅ works
execute_query({sql: 'db.users.updateOne({name: "alice"}, {$set: {age: 31}})'})
// ❌ "无效的查询参数格式"
```

**Root cause**: Initial v3.2.6 fix handled single-arg correctly (regex + JSON.parse + JS-literal normalize). But multi-arg calls like `updateOne(filter, update)` failed because:
- Greedy regex `(.*)` captured across commas: `a}, b` as one chunk
- JSON.parse failed on non-JSON content
- Normalize couldn't fix because there were multiple top-level literals

**Fix** (`src/adapters/mongodb.ts:165-220`):
- Split args on top-level commas (tracking brace/bracket depth + inside-string state)
- Parse each part independently (JSON first, then JS-literal normalize)
- Distribute multi-args by operation type:
  - `update/updateOne/updateMany` → (filter, update, options?)
  - `find/findOne/distinct/count/countDocuments` → (query, options?)
  - `aggregate` → pipeline
  - `insert/insertOne` → doc
- Better error message with JSON example

**Verify** (live Claude Code session): 5-step lifecycle:
```js
insertOne({name:'verify26v2', age:30})   → insertedId returned
updateOne({name:'verify26v2'}, {$set:{age:31}})  → matchedCount:1, modifiedCount:1
find({name:'verify26v2'})   → age:31 verified
deleteOne({name:'verify26v2'})  → deletedCount:1
```

### Bug #27 — MongoDB `use_profile` authentication failed

**Repro**:
```js
save_profile({name:'m', type:'mongodb', config:{host, port, user, password, database}})
// saved without authSource
use_profile({name:'m'})  // ❌ "Authentication failed"
```

**Root cause**: MongoDB SCRAM auth requires `authSource` (default 'admin' for MONGO_INITDB_ROOT_USERNAME user). Save handler didn't inject default.

**Fix** (`src/mcp/tools/profile-tools.ts:16-26`): `buildSaveProfileHandler` now auto-injects `authSource: 'admin'` for mongodb config when missing.

**Verify**: Saved profile shows `"authSource": "admin"` in config; `use_profile` connects successfully.

## Coverage Update

| DB | Status |
|---|---|
| sqlite | 43/43 ✅ (v3.2.4) |
| redis | 35 ✅ + 7 INFRA + 1 ⚠️ (v3.2.7) |
| mongodb | 26 ✅ + 4 INFRA + ⚠️→✅ (Bug #26 fixed) (v3.2.7) |
| postgres / mysql / clickhouse / dm | Backlog v3.2.8 |

## Tests

- `npm test`: 533/533 ✅
- Live e2e: Bug #26 + #27 verified in current Claude Code session

## Upgrade

```bash
npm install -g @joyous-coder/universal-db-mcp@latest
# Backwards-compatible with v3.2.6
```