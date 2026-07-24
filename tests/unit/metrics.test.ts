import { describe, it, expect, beforeEach } from 'vitest';
import { Counter } from '../../src/utils/metrics-counter.js';
import { Histogram } from '../../src/utils/metrics-histogram.js';
import { Gauge } from '../../src/utils/metrics-gauge.js';
import { RingBuffer } from '../../src/utils/metrics-ringbuffer.js';
import { MetricsRegistry } from '../../src/utils/metrics.js';

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

describe('MetricsRegistry', () => {
  let reg: MetricsRegistry;
  beforeEach(() => { reg = new MetricsRegistry(); });

  it('returns same Counter instance for same name (re-use)', () => {
    const a = reg.counter('x', 'X');
    const b = reg.counter('x', 'X');
    expect(a).toBe(b);
  });

  it('emits Prometheus text format', () => {
    const c = reg.counter('hits_total', 'Total hits');
    c.inc({ route: '/a' });
    c.inc({ route: '/b' }, 2);
    const out = reg.format();
    expect(out).toMatch(/^# HELP hits_total Total hits$/m);
    expect(out).toMatch(/^# TYPE hits_total counter$/m);
    expect(out).toMatch(/^hits_total\{route="\/a"\} 1$/m);
    expect(out).toMatch(/^hits_total\{route="\/b"\} 2$/m);
  });

  it('emits Histogram in Prometheus format with _bucket/_count/_sum', () => {
    const h = reg.histogram('lat', 'Latency', [0.1, 1]);
    h.observe({ op: 'q' }, 0.05);
    h.observe({ op: 'q' }, 0.5);
    const out = reg.format();
    expect(out).toMatch(/lat_bucket\{op="q",le="0\.1"\} 1/);
    expect(out).toMatch(/lat_bucket\{op="q",le="1"\} 2/);
    expect(out).toMatch(/lat_bucket\{op="q",le="\+Inf"\} 2/);
    expect(out).toMatch(/lat_count\{op="q"\} 2/);
    expect(out).toMatch(/lat_sum\{op="q"\} 0\.55/);
  });

  it('toJSON() returns shape suitable for MCP tool', () => {
    const c = reg.counter('hits_total', 'Total hits');
    c.inc({ route: '/a' });
    const json = reg.toJSON();
    expect(json.counters).toBeInstanceOf(Array);
    const h = json.counters.find(x => x.name === 'hits_total');
    expect(h).toBeDefined();
    expect(h!.series).toContainEqual({ labels: { route: '/a' }, value: 1 });
  });

  it('isEnabled() returns true by default', () => {
    expect(reg.isEnabled()).toBe(true);
  });

  it('isEnabled() = false makes inc/observe no-op', () => {
    reg.setEnabled(false);
    const c = reg.counter('x', 'X');
    c.inc({ y: '1' });
    expect(c.get({ y: '1' })).toBe(0);
    expect(reg.format()).toBe('');
  });

  it('LRU-limits a single counter to 1000 label sets', () => {
    const c = reg.counter('x', 'X');
    for (let i = 0; i < 1500; i++) c.inc({ i: String(i) });
    let total = 0;
    for (let k = 0; k < 1500; k++) total += c.get({ i: String(k) }) > 0 ? 1 : 0;
    expect(total).toBe(1000);
  });
});
