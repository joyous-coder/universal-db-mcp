/**
 * Template Resolver Tests
 * Tests placeholders and cross-column references.
 */

import { describe, it, expect } from 'vitest';
import { resolveTemplate } from '../../src/utils/template-resolver.js';

describe('resolveTemplate - built-in placeholders', () => {
  it('resolves {year}', () => {
    const result = resolveTemplate('PRJ-{year}', {}, 1, 0, new Date('2026-07-23'));
    expect(result).toBe('PRJ-2026');
  });

  it('resolves {month} padded to 2 digits', () => {
    const result = resolveTemplate('{month}', {}, 1, 0, new Date('2026-07-23'));
    expect(result).toBe('07');
  });

  it('resolves {day} padded to 2 digits', () => {
    const result = resolveTemplate('{day}', {}, 1, 0, new Date('2026-07-23'));
    expect(result).toBe('23');
  });

  it('resolves {date} as YYYYMMDD', () => {
    const result = resolveTemplate('{date}', {}, 1, 0, new Date('2026-07-23'));
    expect(result).toBe('20260723');
  });

  it('resolves {sequence:Nd} with zero padding', () => {
    const result = resolveTemplate('NO-{sequence:05d}', {}, 42, 0);
    expect(result).toBe('NO-00042');
  });

  it('resolves {sequence} without padding', () => {
    const result = resolveTemplate('NO-{sequence}', {}, 42, 0);
    expect(result).toBe('NO-42');
  });

  it('resolves {uuid} to a UUID-like string', () => {
    const result = resolveTemplate('{uuid}', {}, 1, 0);
    expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('resolves {rowIndex}', () => {
    const result = resolveTemplate('row-{rowIndex}', {}, 1, 7);
    expect(result).toBe('row-7');
  });

  it('preserves unresolved placeholders', () => {
    const result = resolveTemplate('hello {nonexistent}', {}, 1, 0);
    expect(result).toBe('hello {nonexistent}');
  });
});

describe('resolveTemplate - cross-column references', () => {
  it('resolves {name} from rowContext', () => {
    const result = resolveTemplate('{name}@example.com', { name: '张三' }, 1, 0);
    expect(result).toBe('张三@example.com');
  });

  it('applies .lower modifier', () => {
    const result = resolveTemplate('{name.lower}@example.com', { name: 'ZhangSan' }, 1, 0);
    expect(result).toBe('zhangsan@example.com');
  });

  it('applies .upper modifier', () => {
    const result = resolveTemplate('{name.upper}', { name: 'foo' }, 1, 0);
    expect(result).toBe('FOO');
  });

  it('applies .first modifier', () => {
    const result = resolveTemplate('{name.first}', { name: '张三丰' }, 1, 0);
    expect(result).toBe('张');
  });

  it('applies .last modifier', () => {
    const result = resolveTemplate('{name.last}', { name: '张三丰' }, 1, 0);
    expect(result).toBe('丰');
  });

  it('applies .pinyin modifier', () => {
    const result = resolveTemplate('{name.pinyin}', { name: '张三' }, 1, 0);
    expect(result).toBe('zhangsan');
  });

  it('applies .pinyin.first modifier', () => {
    const result = resolveTemplate('{name.pinyin.first}', { name: '张三丰' }, 1, 0);
    expect(result).toBe('zsf');
  });

  it('applies .N (substring) modifier', () => {
    const result = resolveTemplate('{name.3}', { name: 'hello world' }, 1, 0);
    expect(result).toBe('hel');
  });

  it('chains modifiers', () => {
    // Sequential application: .pinyin → 'zhangsan', .first → 'z', .lower → 'z'
    const result = resolveTemplate('{name.pinyin.first.lower}', { name: '张三' }, 1, 0);
    expect(result).toBe('z');
  });
});