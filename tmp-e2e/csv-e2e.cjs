/**
 * CSV 导入/导出 e2e 测试 (v3.3)
 *
 * 用 sqlite (universal-db-mcp 已支持,无需外部 DB)。
 * 流程:
 *   1. 创建测试表 + 3 行数据(含逗号/双引号/NULL)
 *   2. exportTableCsv → CSV 文件
 *   3. 校验 CSV 内容 (header + 3 行,逗号/双引号正确 quote)
 *   4. drop table + create new table
 *   5. importCsv → 新表 (executeBatch 流式入库)
 *   6. verify roundtrip 行数与值
 */
const { createAdapter } = require('D:/Links/Tools/universal-db-mcp/dist/utils/adapter-factory.js');
const { exportTableCsv } = require('D:/Links/Tools/universal-db-mcp/dist/core/csv-writer.js');
const { importCsv } = require('D:/Links/Tools/universal-db-mcp/dist/core/csv-reader.js');
const { writeFileSync, readFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');

(async () => {
  const dbPath = path.resolve('D:/tmp/csv-e2e-' + Date.now() + '.db').replace(/\\/g, '/');
  console.log('dbPath:', JSON.stringify(dbPath));
  const cfg = { type: 'sqlite', filePath: dbPath, allowWrite: true };
  const a = createAdapter(cfg);
  await a.connect();

  // 1. setup
  await a.executeQuery('CREATE TABLE csv_users (id INTEGER, name TEXT, note TEXT)');
  await a.executeQuery(`INSERT INTO csv_users VALUES
    (1, 'Alice', 'plain'),
    (2, 'Bob', 'a,b'),
    (3, 'Charlie', 'has"quote')`);

  // 2. EXPORT
  const tmp = path.join(os.tmpdir(), 'csv-e2e-' + Date.now() + '.csv');
  const exportRes = await exportTableCsv({
    adapter: a,
    table: 'csv_users',
    columns: ['id', 'name', 'note'],
    outputPath: tmp,
    batchSize: 10,
  });
  console.log('EXPORT:', JSON.stringify(exportRes));
  if (exportRes.totalRows !== 3) throw new Error('expected 3 rows, got ' + exportRes.totalRows);

  // 3. 验证 CSV 内容
  const csv = readFileSync(tmp, 'utf8');
  if (!csv.startsWith('id,name,note\r\n')) throw new Error('header mismatch: ' + csv.slice(0, 50));
  if (!csv.includes('"a,b"')) throw new Error('comma not quoted: ' + csv);
  if (!csv.includes('"has""quote"')) throw new Error('quote not escaped: ' + csv);
  console.log('CSV head:');
  console.log(csv.split('\r\n').slice(0, 5).join('\n'));

  // 4. create new table
  await a.executeQuery('DROP TABLE csv_users');
  await a.executeQuery('CREATE TABLE csv_users (id INTEGER, name TEXT, note TEXT)');

  // 5. IMPORT
  const ti = await a.getTableInfo('csv_users');
  console.log('getTableInfo:', JSON.stringify(ti).substring(0, 300));
  console.log('adapter.config.type:', a.config && a.config.type);
  // 拦截 executeBatch 看真实 SQL
  const origEB = a.executeBatch.bind(a);
  a.executeBatch = async (sql, params, opts) => {
    console.log('executeBatch SQL:', sql);
    console.log('  params[0]:', JSON.stringify(params[0]));
    return origEB(sql, params, opts);
  };
  const importRes = await importCsv({
    adapter: a,
    table: 'csv_users',
    filePath: tmp,
    batchSize: 100,
  });
  console.log('IMPORT:', JSON.stringify(importRes));
  if (importRes.totalRows !== 3) throw new Error('expected 3 rows imported, got ' + importRes.totalRows);

  // 6. verify
  const verify = await a.executeQuery('SELECT id, name, note FROM csv_users ORDER BY id');
  console.log('VERIFY:', JSON.stringify(verify.rows));
  if (verify.rows.length !== 3) throw new Error('roundtrip row count mismatch');
  if (verify.rows[1].note !== 'a,b') throw new Error('roundtrip comma quote lost');
  if (verify.rows[2].note !== 'has"quote') throw new Error('roundtrip escape lost');

  // 7. dryRun
  await a.executeQuery('DROP TABLE csv_users');
  await a.executeQuery('CREATE TABLE csv_users (id INTEGER, name TEXT, note TEXT)');
  const dryRes = await importCsv({
    adapter: a,
    table: 'csv_users',
    filePath: tmp,
    batchSize: 100,
    dryRun: true,
  });
  console.log('DRYRUN:', JSON.stringify(dryRes));
  if (dryRes.totalRows !== 3) throw new Error('dryRun totalRows mismatch');
  if (!Array.isArray(dryRes.sample) || dryRes.sample.length === 0) throw new Error('dryRun sample empty');
  const emptyCheck = await a.executeQuery('SELECT count(*) AS n FROM csv_users');
  if (emptyCheck.rows[0].n !== 0) throw new Error('dryRun wrote data!');

  // cleanup
  await a.executeQuery('DROP TABLE csv_users');
  await a.disconnect();
  rmSync(tmp);
  rmSync(dbPath);
  console.log('E2E PASS');
})().catch((e) => { console.log('E2E FAIL:', e.message); console.log(e.stack); process.exit(1); });