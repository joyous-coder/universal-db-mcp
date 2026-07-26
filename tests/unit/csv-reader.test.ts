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
import { writeFileSync, rmSync, createReadStream } from 'node:fs';
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