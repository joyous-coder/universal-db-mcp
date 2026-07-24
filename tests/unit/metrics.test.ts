import { describe, it, expect } from 'vitest';
import { Counter } from '../../src/utils/metrics-counter.js';
import { Histogram } from '../../src/utils/metrics-histogram.js';
import { Gauge } from '../../src/utils/metrics-gauge.js';
import { RingBuffer } from '../../src/utils/metrics-ringbuffer.js';

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

describe('Gauge', () => {
  it('invokes collect callback to get current value', () => {
    let v = 10;
    const g = new Gauge('temp', 'Temp', () => [{ labels: {}, value: v }]);
    expect(g.collect()[0].value).toBe(10);
    v = 20;
    expect(g.collect()[0].value).toBe(20);
  });
});

describe('RingBuffer', () => {
  it('pushes up to capacity then overwrites oldest', () => {
    const rb = new RingBuffer<number>(3);
    rb.push(1); rb.push(2); rb.push(3);
    expect(rb.toArray()).toEqual([3, 2, 1]);
    rb.push(4);
    expect(rb.toArray()).toEqual([4, 3, 2]);
  });

  it('handles capacity 0 by silently dropping', () => {
    const rb = new RingBuffer<number>(0);
    rb.push(1);
    expect(rb.size).toBe(0);
    expect(rb.toArray()).toEqual([]);
  });

  it('clear() empties buffer', () => {
    const rb = new RingBuffer<number>(3);
    rb.push(1); rb.push(2);
    rb.clear();
    expect(rb.size).toBe(0);
  });
});
