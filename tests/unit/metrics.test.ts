import { describe, it, expect } from 'vitest';
import { Counter } from '../../src/utils/metrics-counter.js';

describe('Counter', () => {
  it('starts at 0 for unseen label set', () => {
    const c = new Counter('hits', 'Total hits');
    expect(c.get({ route: '/a' })).toBe(0);
  });

  it('increments by 1 by default', () => {
    const c = new Counter('hits', 'Total hits');
    c.inc({ route: '/a' });
    expect(c.get({ route: '/a' })).toBe(1);
  });

  it('increments by n when provided', () => {
    const c = new Counter('hits', 'Total hits');
    c.inc({ route: '/a' }, 5);
    c.inc({ route: '/a' }, 2);
    expect(c.get({ route: '/a' })).toBe(7);
  });

  it('treats different label values as distinct series', () => {
    const c = new Counter('hits', 'Total hits');
    c.inc({ route: '/a' });
    c.inc({ route: '/b' }, 3);
    expect(c.get({ route: '/a' })).toBe(1);
    expect(c.get({ route: '/b' })).toBe(3);
  });
});
