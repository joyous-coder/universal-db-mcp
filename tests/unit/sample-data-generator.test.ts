import { describe, expect, it } from 'vitest';
import { SampleDataGenerator } from '../../src/utils/sample-data-generator.js';
import type { ColumnInfo } from '../../src/types/adapter.js';

const column = (name: string, type = 'varchar'): ColumnInfo => ({
  name,
  type,
  nullable: false,
});

describe('SampleDataGenerator', () => {
  it('uses column overrides before inline rules', () => {
    const generator = new SampleDataGenerator({ seed: 42 });

    const value = generator.generateValue(column('status'), {
      overrides: { status: 'forced' },
      rule: { generate: { type: 'fixed', value: 'rule-value' } },
    });

    expect(value).toBe('forced');
  });

  it('generates deterministic values for a fixed seed', () => {
    const first = new SampleDataGenerator({ seed: 42 });
    const second = new SampleDataGenerator({ seed: 42 });

    expect(first.generateValue(column('email'))).toBe(second.generateValue(column('email')));
  });

  it('resolves pattern rules with sequence, row index, and prior columns', () => {
    const generator = new SampleDataGenerator({ seed: 42 });
    const rule = { generate: { type: 'pattern', template: '{name.pinyin}-{sequence:03d}-{rowIndex}' } };

    expect(generator.generateValue(column('code'), { rule, rowContext: { name: '张三' } }, 4))
      .toBe('zhangsan-001-4');
  });

  it('increments sequence rules by row', () => {
    const generator = new SampleDataGenerator({ seed: 42 });
    const rule = { generate: { type: 'sequence', start: 10, step: 5 } };

    expect(generator.generateValue(column('code'), { rule }, 0)).toBe(10);
    expect(generator.generateValue(column('code'), { rule }, 1)).toBe(15);
  });

  it('returns a number for id columns without an explicit rule', () => {
    // v3.2.8 Bug #48 fix: 之前返回 undefined 让 DB auto-fill,但 DM/Oracle 没有公开的
    // IDENTITY 检测,普通 INT PRIMARY KEY 不带 IDENTITY,期待用户提供 int 值。
    const generator = new SampleDataGenerator({ seed: 42 });

    const idVal = generator.generateValue(column('id', 'integer'));
    expect(typeof idVal).toBe('number');
    expect(idVal).toBeGreaterThan(0);

    const custIdVal = generator.generateValue(column('customer_id', 'integer'));
    expect(typeof custIdVal).toBe('number');
    expect(custIdVal).toBeGreaterThan(0);
  });

  // v5.0.1 Bug N14: status 列默认值超过 VARCHAR(20)
  it('status column returns short enum-like value (≤20 chars)', () => {
    const generator = new SampleDataGenerator({ seed: 42 });
    for (let i = 0; i < 10; i++) {
      const v = generator.generateValue(column('status', 'varchar(20)'));
      expect(typeof v).toBe('string');
      expect((v as string).length).toBeLessThanOrEqual(20);
    }
  });

  // v5.0.1 Bug N14: VARCHAR(N) 字符串截断
  it('truncates string values to varchar(N) maxLen', () => {
    const generator = new SampleDataGenerator({ seed: 42 });
    // 没匹配任何 heuristic 的列 + VARCHAR(20) → 走 fallbackByType 返回 lorem sentence
    // (超过 20 字符) → 应被截断到 20
    const v = generator.generateValue(column('description', 'varchar(20)'));
    expect(typeof v).toBe('string');
    expect((v as string).length).toBeLessThanOrEqual(20);
  });

  // v5.0.1 Bug N14: VARCHAR(100) 不截断
  it('does not truncate when length is within varchar(N)', () => {
    const generator = new SampleDataGenerator({ seed: 42 });
    const v = generator.generateValue(column('description', 'varchar(100)'));
    expect(typeof v).toBe('string');
    // 任何 lorem sentence 都应小于 100
    expect((v as string).length).toBeLessThanOrEqual(100);
  });

  // v5.0.1 Bug N14: TEXT/无长度类型不截断
  it('does not truncate for text/unlimited types', () => {
    const generator = new SampleDataGenerator({ seed: 42 });
    const v = generator.generateValue(column('body', 'text'));
    expect(typeof v).toBe('string');
    // text 不应被截断
    expect((v as string).length).toBeGreaterThan(0);
  });

  // v5.0.1 Bug N14: numeric 列不被截断(虽然 type 含括号长度)
  it('does not truncate numeric columns (only strings)', () => {
    const generator = new SampleDataGenerator({ seed: 42 });
    const v = generator.generateValue(column('amount', 'decimal(10,2)'));
    expect(typeof v).toBe('number');
  });
});
