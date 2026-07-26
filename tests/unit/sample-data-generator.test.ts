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
});
