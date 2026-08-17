# CSV 导入/导出功能设计 (universal-db-mcp)

**Date**: 2026-07-26
**Status**: Brainstorming 阶段 — 待用户确认
**Author**: AI (Brainstorming session with wangyubin)

## Context

universal-db-mcp 当前有 `execute_query` / `execute_batch` / `export_backup`(SQL 全表 dump)等工具,但**没有 CSV 专项导入导出**。Claude Desktop 用户拿到 SQL dump 后需要再用别的工具转 CSV;反向用 Excel/CSV 维护数据也无法直接灌进 DB。

本设计新增两个 MCP tools,把 MCP 工具集对齐到"既能 SQL 也能 CSV"的完整数据迁移能力。

## Goals

- **可移植**:CSV 格式遵循 RFC 4180,Excel / Pandas / awk / shell 都能消费
- **安全**:沿用现有 `DB_ALLOWED_FILE_PATHS` 路径白名单 + `write` 权限模型
- **可扩展**:17 种 DB 都走 BaseAdapter executeQuery / executeBatch 统一接口,新 DB 自动支持
- **大表友好**:分页 export + 批量 import,内存可控

## Non-Goals

- 不支持 Excel .xlsx (CSV only)
- 不支持 ETL/transform(纯搬运)
- 不支持触发器/trigger 注入
- 不支持 PostgreSQL `COPY`/SQLite `.import` 等 DB 原生 bulk insert(走统一 executeBatch 路径)

## Tool Signatures

```ts
tool('export_table_csv',
  '导出单表到 CSV 文件。支持 WHERE / ORDER BY / LIMIT / OFFSET。',
  {
    type: 'object',
    properties: {
      profileName: { type: 'string' },
      table:       { type: 'string', description: 'schema.table 或 table' },
      columns:     { type: 'array', items: { type: 'string' } },
      where:       { type: 'string', description: '可选 WHERE 子句(不含 WHERE 关键字)' },
      orderBy:     { type: 'string', description: '可选 ORDER BY 子句(不含 ORDER BY 关键字)' },
      limit:       { type: 'integer', default: 0, description: '0 = 不限' },
      offset:      { type: 'integer', default: 0 },
      outputPath:  { type: 'string' },
      batchSize:   { type: 'integer', default: 5000 },
    },
    required: ['profileName', 'table', 'outputPath'],
  },
  buildExportTableCsvHandler(pm) as any,
  'data-governance');

tool('import_csv',
  '从 CSV 文件导入数据到已存在的表(APPEND 模式)。',
  {
    type: 'object',
    properties: {
      profileName: { type: 'string' },
      table:       { type: 'string' },
      filePath:    { type: 'string' },
      columns:     { type: 'array', items: { type: 'string' },
                     description: 'CSV→table 列映射,默认按 CSV header 自动匹配' },
      dryRun:      { type: 'boolean', default: false },
      batchSize:   { type: 'integer', default: 1000 },
      hasHeader:   { type: 'boolean', default: true },
      nullStrings: { type: 'array', items: { type: 'string' }, default: ['', 'NULL', '\\N'] },
    },
    required: ['profileName', 'table', 'filePath'],
  },
  buildImportCsvHandler(pm) as any,
  'data-governance');
```

## Architecture

```
┌────────────────────────────────────────────────┐
│ MCP tool layer (src/mcp/tool-definitions.ts)   │
│  export_table_csv / import_csv                  │
└──────────────────┬─────────────────────────────┘
                   ↓ buildHandler(pm)
┌────────────────────────────────────────────────┐
│ src/mcp/tools/csv-tools.ts                      │
│  buildExportTableCsvHandler / buildImportCsvH.  │
└──────────────────┬─────────────────────────────┘
                   ↓ calls
┌────────────────────────────────────────────────┐
│ src/core/csv-writer.ts (CsvWriter class)        │
│ src/core/csv-reader.ts (CsvReader class)        │
│  - 流式 readline / split / type conversion      │
│  - 走 adapter.executeQuery 分页 / executeBatch │
└──────────────────┬─────────────────────────────┘
                   ↓
┌────────────────────────────────────────────────┐
│ BaseAdapter (已有)                              │
│  executeQuery (读分页) / executeBatch (写批)     │
│  - CH/DM 已有 override 适配 (Bug #44 #53 #54)   │
└────────────────────────────────────────────────┘
```

## CSV Serialization (RFC 4180 + 用户确认配置)

- **Encoding**: UTF-8 (无 BOM)
- **Separator**: `,`
- **Quote**: `"`
- **Escape**: `""` (双引号转义)
- **Line ending**: `\r\n`
- **NULL 表示**: 用户可配 `nullStrings`,默认 `['', 'NULL', '\\N']`

### 类型转换 (writer)

| DB 类型             | CSV 输出             |
| ------------------- | -------------------- |
| Date / DateTime     | `2025-07-26T08:43:00`|
| BigInt / UInt64     | 字符串(避免精度丢失) |
| Decimal / Numeric   | 字符串保留精度       |
| Boolean / Bit       | `true` / `false`     |
| Buffer / Binary     | hex `0xABCD...`      |
| JSON / JSONB        | `{"k":1}` (原始)     |
| `null` / `undefined`| 空字符串             |

### 类型转换 (reader)

| CSV 值                | DB 值                       |
| --------------------- | --------------------------- |
| 空字符串 / nullString | `NULL`                      |
| 数字                   | 直接按列类型 coerce          |
| `true` / `false`       | Boolean 类型 → 1 / 0 或 bool |
| 其他                   | 字符串,DB 自己 coerce       |

## Security

### 路径白名单 (与 `execute_sql_file` 一致)

`outputPath` / `filePath` 必须落在 `DB_ALLOWED_FILE_PATHS` 列出的目录(任一)。路径解析用现有 `src/utils/path-guard.ts` 的 `resolveAndValidatePath`。

### 权限模型

沿用 `write` 权限,需 `connect_database` 时 `permissionMode: 'readwrite'` 或 `'full'`。

### 表/列白名单

`table` 必须通过 `validateIdentifier` (只允许 `[a-zA-Z0-9_.]`),不允许多语句拼接。
`columns` 同理。

### WHERE / ORDER BY 白名单

`where` / `orderBy` 参数是**字符串 SQL 片段**,会被原样拼到 SELECT 模板中。这是已知风险面,**设计为只对 trusted 调用方开放**,文档明示 "trusted path; CSV 数据导出到自己的机器,避免 untrusted 客户端"。

未来可加 `parameterizedWhere: Record<string, value>` 用 named params (CH/Bug #51 修复后已支持),但本设计只暴露字符串形式。

## Data Flow

### Export

```
1. resolveAndValidatePath(outputPath, DB_ALLOWED_FILE_PATHS) → safePath
2. profileManager.loadProfile(profileName) → live (含 adapter)
3. validateIdentifier(table) → {schema, name}
4. parseColumns(columns) → string[]  (若空,读 getTableInfo 列名)
5. SELECT col1, col2, ... FROM schema.name
     [WHERE <where>] [ORDER BY <orderBy>] [LIMIT <limit> OFFSET <offset>]
   ↑ batchSize (默认 5000) 一页,offset += batchSize 翻页
   ↑ 终止条件: rows.length < batchSize 或 limit 触顶
6. rows → CSV 字符串 (quote + escape + join + \r\n)
7. fs.appendFileStream(safePath, csvString, 'utf8')
8. 返回 { profileName, table, outputPath, totalRows, bytesWritten,
         durationMs, batchSize }
```

### Import

```
1. resolveAndValidatePath(filePath, DB_ALLOWED_FILE_PATHS) → safePath
2. profileManager.loadProfile(profileName) → live
3. validateIdentifier(table)
4. getTableInfo(table) → 校验表存在, 取 columns + dataType
5. parse CSV header (hasHeader=true):
     - 校验 header 列名 ⊆ table.columns
     - columns 显式覆盖 → 强制 CSV 列序
6. fs.createReadStream(safePath, { encoding: 'utf8', highWaterMark: 1MB })
   解析器: csv-parse (npm 依赖) 或手写 RFC 4180 解析器
7. 累积 batchSize 行 → adapter.executeBatch(
     `INSERT INTO schema.name (col1, col2) VALUES ({col1:Type}, {col2:Type})`,
     [{col1: v1, col2: v2}, ...]   // Bug #54 已修复对象数组
   )
8. dryRun=true 时只 parse + validate,不真写,返回 preview { totalRows, sampleRows }
9. 全部完成后返回 { profileName, table, totalRows, batches, durationMs, errors? }
```

## Error Handling

| 错误                       | 抛出方式                       |
| -------------------------- | ------------------------------ |
| 路径不在白名单             | `Error('path_not_allowed')`    |
| profile 不存在 / disabled  | `Error('profile_not_found')`   |
| table 名非法               | `Error('invalid_identifier')`  |
| 表不存在                   | `Error('table_not_found')`     |
| CSV 列 ⊄ table 列          | `Error('column_mismatch')`     |
| WHERE/ORDER BY 包含 `;`    | `Error('injection_blocked')`   |
| CSV parse 错误             | `Error('csv_parse_error: line=N')` |
| executeBatch 单行失败      | 累加 errors 数组,继续下一批    |
| 文件 IO 失败               | 透传 `Error('fs: ...')`         |

## Testing

### Unit

- `tests/unit/csv-writer.test.ts`: mock adapter
  - 基本 SELECT 拼装正确
  - WHERE/ORDER BY/LIMIT 正确拼到模板
  - 类型转换 (Date → ISO, BigInt → string)
  - 转义:含逗号/双引号/换行的字段正确 quote
  - 分页 offset 累加正确
- `tests/unit/csv-reader.test.ts`: mock adapter
  - hasHeader=true 时 header 解析 + 列匹配校验
  - columns 显式覆盖时 CSV 列序强制
  - nullStrings 正确识别为 NULL
  - batchSize 切批正确
  - dryRun=true 不调 executeBatch

### E2E (tmp-e2e/csv-e2e.cjs)

- **SQLite**: export users → drop → import → 校验行数与内容
- **ClickHouse**: 同上,验证 Bug #53/#54 fix 兼容
- **DM (生产)**: 试跑一次,若 `EXAMPLE_DB` 不可达则 skip

## Files Changed

| File                                            | Action | LOC   |
| ----------------------------------------------- | ------ | ----- |
| `src/core/csv-writer.ts`                       | new    | +180  |
| `src/core/csv-reader.ts`                       | new    | +150  |
| `src/mcp/tools/csv-tools.ts`                   | new    | +60   |
| `src/mcp/tool-definitions.ts`                  | edit   | +25   |
| `src/mcp/tool-definitions.ts` (CSV descriptions) | edit   | +4    |
| `tests/unit/csv-writer.test.ts`                | new    | +120  |
| `tests/unit/csv-reader.test.ts`                | new    | +100  |
| `tmp-e2e/csv-e2e.cjs`                          | new    | +150  |
| `docs/09-reference/e2e-stdio-report.md`        | edit   | +2 row per DB × 11 |

总计: ~790 行新代码,新 4 个 file,改 2 个 file。

## Rollout

1. PR #1: `src/core/csv-{writer,reader}.ts` + unit tests (无 MCP 注册)
2. PR #2: `src/mcp/tools/csv-tools.ts` + `tool-definitions.ts` 注册
3. PR #3: `tmp-e2e/csv-e2e.cjs` 真实 DB 验证
4. CHANGELOG.md v3.3.0 (新功能 → minor bump)

## Open Questions (resolved during brainstorm)

1. **CSV 写到哪**: 文件路径 (user confirmed)
2. **路径白名单**: 复用 `DB_ALLOWED_FILE_PATHS` (user confirmed)
3. **表结构**: 必须已存在 (user confirmed)
4. **导出参数**: WHERE + columns + limit/offset + 类型转换 (user confirmed 4)
5. **导入行为**: APPEND (user confirmed)
6. **CSV 格式**: UTF-8 无 BOM (user confirmed)
7. **大表策略**: 逐行事务包装 (user confirmed)

## References

- `src/core/backup-writer.ts` (SQL dump,类似的路径/权限模型)
- `src/core/explainer.ts` (DatabaseService 解析模板, LIKE 模式参考)
- `src/mcp/tools/profile-tools.ts` (handler 写法模板)
- `src/mcp/tools/data-governance.ts` (data-governance 组已有 export_backup handler)
- `src/utils/path-guard.ts` (`resolveAndValidatePath`)
- `BaseAdapter.executeQuery` / `executeBatch` (CH Bug #44 #53 #54 修复后已可适配所有 DB)