/**
 * CSV Reader 单元测试 (v3.3)
 *
 * 覆盖:
 *  - parseCsvLine: RFC 4180 解析,逗号/双引号/换行符 escape, NULL 字符串识别
 *  - streamCsvRows: 流式 readline 迭代,跨 chunk 边界
 *  - importCsv: executeBatch 流式入库, dryRun 跳过, 列匹配校验
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { parseCsvLine, streamCsvRows, importCsv } from '../../src/core/csv-reader.js';
import { Readable } from 'node:stream';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('CsvReader.parseCsvLine', () => {
  it('parses simple line', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });
  it('parses quoted field with comma', () => {
    expect(parseCsvLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd']);
  });
  it('parses escaped double quote', () => {
    expect(parseCsvLine('a,"b""c",d')).toEqual(['a', 'b"c', 'd']);
  });
  it('returns null for nullStrings', () => {
    expect(parseCsvLine('a,NULL,b')).toEqual(['a', null, 'b']);
    expect(parseCsvLine('a,,b')).toEqual(['a', null, 'b']);
    expect(parseCsvLine('a,\\N,b')).toEqual(['a', null, 'b']);
  });
  it('handles CRLF and LF line endings', () => {
    expect(parseCsvLine('a,b\r\n')).toEqual(['a', 'b']);
    expect(parseCsvLine('a,b\n')).toEqual(['a', 'b']);
  });
});

async function collect(aiter: AsyncIterableIterator<Record<string, string | null>>) {
  const out: Array<Record<string, string | null>> = [];
  for await (const row of aiter) out.push(row);
  return out;
}

describe('CsvReader.streamCsvRows', () => {
  it('parses header + rows from stream', async () => {
    const csv = 'id,name,note\r\n1,Alice,hello\r\n2,Bob,"a,b"\r\n3,,NULL\r\n';
    const stream = Readable.from([csv]);
    const rows = await collect(streamCsvRows(stream));
    expect(rows).toEqual([
      { id: '1', name: 'Alice', note: 'hello' },
      { id: '2', name: 'Bob', note: 'a,b' },
      { id: '3', name: null, note: null },
    ]);
  });

  it('handles multi-line CRLF chunked stream', async () => {
    const chunks = ['id,name\r\n1,A\r\n2,B\r', '\n3,C\r\n4,D\r\n'];
    const stream = Readable.from(chunks);
    const rows = await collect(streamCsvRows(stream));
    expect(rows.length).toBe(4);
    expect(rows[3]).toEqual({ id: '4', name: 'D' });
  });

  it('skips trailing empty line without throwing', async () => {
    const csv = 'id,name\r\n1,A\r\n2,B\r\n';
    const stream = Readable.from([csv]);
    const rows = await collect(streamCsvRows(stream));
    expect(rows).toEqual([{ id: '1', name: 'A' }, { id: '2', name: 'B' }]);
  });
});

class StubAdapter {
  executed: Array<{ sql: string; paramsList: unknown[][] }> = [];
  async executeBatch(sql: string, paramsList: unknown[][], _options?: any) {
    this.executed.push({ sql, paramsList });
    return { affectedRowsPerStatement: paramsList.map(() => 1), totalAffectedRows: paramsList.length };
  }
  async executeQuery(_sql: string) { return { rows: [], executionTime: 0 }; }
  async getTableInfo(_name: string) {
    return { name: 'users', schema: null, columns: [
      { name: 'id', type: 'UInt32', nullable: false },
      { name: 'name', type: 'String', nullable: true },
    ]};
  }
}

describe('CsvReader.importCsv', () => {
  const tmp = path.join(tmpdir(), 'import-test.csv');
  beforeEach(() => { writeFileSync(tmp, 'id,name\r\n1,Alice\r\n2,Bob\r\n3,,NULL\r\n'); });
  afterEach(() => { try { rmSync(tmp); } catch {} });

  it('imports with batchSize=2 (2 batches)', async () => {
    const a = new StubAdapter() as any;
    const r = await importCsv({
      adapter: a, table: 'users', filePath: tmp, batchSize: 2,
    });
    expect(r.totalRows).toBe(3);
    expect(r.batches).toBe(2);
    expect(a.executed[0].paramsList.length).toBe(2);
    expect(a.executed[1].paramsList.length).toBe(1);
    // Bug #54 已修:对象数组 [{c1:v1,c2:v2}]
    expect(a.executed[0].paramsList[0]).toEqual({ id: '1', name: 'Alice' });
    expect(a.executed[0].paramsList[1]).toEqual({ id: '2', name: 'Bob' });
  });

  it('dryRun=true does not call executeBatch', async () => {
    const a = new StubAdapter() as any;
    const r = await importCsv({
      adapter: a, table: 'users', filePath: tmp, dryRun: true,
    });
    expect(r.totalRows).toBe(3);
    expect(r.batches).toBe(0);
    expect(a.executed.length).toBe(0);
    expect(r.sample).toBeDefined();
    expect(r.sample.length).toBeGreaterThan(0);
  });

  it('throws column_mismatch when CSV has unknown column', async () => {
    writeFileSync(tmp, 'id,name,unknown_col\r\n1,Alice,x\r\n');
    const a = new StubAdapter() as any;
    await expect(importCsv({
      adapter: a, table: 'users', filePath: tmp,
    })).rejects.toThrow(/column_mismatch/);
  });
});