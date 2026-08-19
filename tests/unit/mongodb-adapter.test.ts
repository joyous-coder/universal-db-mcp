/**
 * MongoDB adapter parser tests (v5.0.1)
 *
 * Bug N17: db.collection.insertMany([{...}, {...}]) shell-format
 * was parsed to query=parsed[0] (only first doc), making insertMany
 * insert just one row or error with "需要文档数组".
 *
 * Bug N18: covered in tests/unit/sql-template.test.ts (json param type)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MongoDBAdapter } from '../../src/adapters/mongodb.js';

describe('MongoDBAdapter parseQuery (Bug N17 insertMany)', () => {
  let adapter: MongoDBAdapter;

  beforeEach(async () => {
    adapter = new MongoDBAdapter({
      host: '127.0.0.1',
      port: 27017,
      database: 'test',
    });
    await adapter.connect().catch(() => {
      // 连接失败也不要紧 — parseQuery 是 private 但可在 connect 后调用
      // 测试聚焦 parseQuery 行为,不走真实 MongoDB
    });
  });

  it('parses db.collection.insertMany([{...}, {...}]) shell-format with full array', () => {
    // v5.0.1 N17 修复: insertMany 应该用整个数组而不是 parsed[0]
    const parsed = (adapter as any).parseQuery(
      'db.users.insertMany([{name:"a",age:1},{name:"b",age:2}])',
    );
    expect(parsed.collection).toBe('users');
    // operation 字段保留原始大小写(executeOperation 内部会 toLowerCase 后匹配 case 'insertmany')
    expect(parsed.operation.toLowerCase()).toBe('insertmany');
    expect(Array.isArray(parsed.query)).toBe(true);
    expect(parsed.query).toHaveLength(2);
    expect(parsed.query[0]).toEqual({ name: 'a', age: 1 });
    expect(parsed.query[1]).toEqual({ name: 'b', age: 2 });
  });

  it('parses db.collection.insert([{...}, {...}]) with full array', () => {
    const parsed = (adapter as any).parseQuery(
      'db.users.insert([{name:"a"},{name:"b"}])',
    );
    expect(parsed.operation.toLowerCase()).toBe('insert');
    expect(parsed.query).toHaveLength(2);
  });

  it('parses db.collection.find({...}) with first arg as query', () => {
    const parsed = (adapter as any).parseQuery('db.users.find({status:"active"})');
    expect(parsed.operation.toLowerCase()).toBe('find');
    expect(parsed.query).toEqual({ status: 'active' });
  });

  it('parses db.collection.findOne({...})', () => {
    const parsed = (adapter as any).parseQuery('db.users.findOne({name:"alice"})');
    expect(parsed.operation.toLowerCase()).toBe('findone');
    expect(parsed.query).toEqual({ name: 'alice' });
  });

  it('parses db.collection.updateOne(filter, update) with 2 args', () => {
    const parsed = (adapter as any).parseQuery(
      'db.users.updateOne({name:"a"},{$set:{age:30}})',
    );
    expect(parsed.operation.toLowerCase()).toBe('updateone');
    expect(parsed.query).toEqual({ name: 'a' });
    expect(parsed.update).toEqual({ $set: { age: 30 } });
  });

  it('parses db.collection.deleteOne({...})', () => {
    const parsed = (adapter as any).parseQuery('db.users.deleteOne({name:"a"})');
    expect(parsed.operation.toLowerCase()).toBe('deleteone');
    expect(parsed.query).toEqual({ name: 'a' });
  });

  it('parses JSON format with operation insertMany and array query', () => {
    const parsed = (adapter as any).parseQuery(
      JSON.stringify({
        collection: 'users',
        operation: 'insertMany',
        query: [{ name: 'a' }, { name: 'b' }],
      }),
    );
    expect(parsed.operation.toLowerCase()).toBe('insertmany');
    expect(parsed.query).toHaveLength(2);
  });
});