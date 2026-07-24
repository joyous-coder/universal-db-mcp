import { describe, it, expect } from 'vitest';
import { Counter } from '../../src/utils/metrics-counter.js';
import { Histogram } from '../../src/utils/metrics-histogram.js';

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

describe('Histogram', () => {
  it('records observation into correct bucket (cumulative)', () => {
    const h = new Histogram('lat', 'Latency');
    h.observe({ op: 'q' }, 0.003);
    h.observe({ op: 'q' }, 0.02);
    h.observe({ op: 'q' }, 1.5);
    const snap = h.snapshot({ op: 'q' });
    expect(snap.count).toBe(3);
    expect(snap.sum).toBeCloseTo(1.523, 3);
    expect(snap.cumulativeCounts[0]).toBe(1);   // le=0.005
    expect(snap.cumulativeCounts[1]).toBe(1);   // le=0.01
    expect(snap.cumulativeCounts[2]).toBe(2);   // le=0.025
    expect(snap.cumulativeCounts[snap.cumulativeCounts.length - 1]).toBe(3); // +Inf
  });

  it('uses default buckets when none provided', () => {
    const h = new Histogram('lat', 'Latency');
    const snap = h.snapshot({ op: 'q' });
    expect(snap.cumulativeCounts.length).toBe(12);
  });

  it('accepts custom buckets', () => {
    const h = new Histogram('lat', 'Latency', [0.1, 0.5, 1]);
    const snap = h.snapshot({ op: 'q' });
    expect(snap.cumulativeCounts.length).toBe(4);
  });
});
