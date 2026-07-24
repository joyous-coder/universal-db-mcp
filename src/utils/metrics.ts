import { Counter, type Labels } from './metrics-counter.js';
import { Histogram, DEFAULT_BUCKETS } from './metrics-histogram.js';
import { Gauge, type GaugeSeries } from './metrics-gauge.js';
import { RingBuffer } from './metrics-ringbuffer.js';

function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function formatLabels(labels: Labels): string {
  // Sort keys alphabetically, but always put 'le' last (Prometheus convention
  // for histogram bucket labels).
  const keys = Object.keys(labels).sort((a, b) => {
    if (a === 'le') return 1;
    if (b === 'le') return -1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  if (keys.length === 0) return '';
  return '{' + keys.map(k => `${k}="${escapeLabelValue(labels[k])}"`).join(',') + '}';
}

export class MetricsRegistry {
  private counters = new Map<string, Counter>();
  private histograms = new Map<string, Histogram>();
  private gauges = new Map<string, Gauge>();
  private rings = new Map<string, RingBuffer<unknown>>();
  private enabled = true;

  counter(name: string, help: string): Counter {
    let c = this.counters.get(name);
    if (!c) {
      c = new Counter(name, help, () => this.enabled);
      this.counters.set(name, c);
    }
    return c;
  }

  histogram(name: string, help: string, buckets: number[] = DEFAULT_BUCKETS): Histogram {
    let h = this.histograms.get(name);
    if (!h) {
      h = new Histogram(name, help, buckets, () => this.enabled);
      this.histograms.set(name, h);
    }
    return h;
  }

  gauge(name: string, help: string, collect: () => GaugeSeries[]): Gauge {
    let g = this.gauges.get(name);
    if (!g) {
      g = new Gauge(name, help, collect);
      this.gauges.set(name, g);
    }
    return g;
  }

  ringBuffer<T>(name: string, capacity: number): RingBuffer<T> {
    let r = this.rings.get(name);
    if (!r) {
      r = new RingBuffer<T>(capacity);
      this.rings.set(name, r as RingBuffer<unknown>);
    }
    return r as unknown as RingBuffer<T>;
  }

  setEnabled(v: boolean): void { this.enabled = v; }
  isEnabled(): boolean { return this.enabled; }

  reset(): void {
    this.counters.clear();
    this.histograms.clear();
    this.gauges.clear();
    this.rings.clear();
  }

  format(): string {
    if (!this.enabled) return '';
    const lines: string[] = [];
    for (const c of this.counters.values()) {
      lines.push(`# HELP ${c.name} ${c.help}`);
      lines.push(`# TYPE ${c.name} counter`);
      for (const { labels, value } of c.series()) {
        lines.push(`${c.name}${formatLabels(labels)} ${value}`);
      }
    }
    for (const h of this.histograms.values()) {
      lines.push(`# HELP ${h.name} ${h.help}`);
      lines.push(`# TYPE ${h.name} histogram`);
      // Use snapshot() to access the internal series for each label set we know about
      const series = (h as unknown as { series: Map<string, { labels: Labels; count: number; sum: number; counts: number[] }> }).series;
      for (const { labels, count, sum, counts } of series.values()) {
        for (let i = 0; i < h.buckets.length; i++) {
          const bl = { ...labels, le: String(h.buckets[i]) };
          lines.push(`${h.name}_bucket${formatLabels(bl)} ${counts[i]}`);
        }
        lines.push(`${h.name}_bucket${formatLabels({ ...labels, le: '+Inf' })} ${counts[h.buckets.length]}`);
        lines.push(`${h.name}_count${formatLabels(labels)} ${count}`);
        lines.push(`${h.name}_sum${formatLabels(labels)} ${sum}`);
      }
    }
    for (const g of this.gauges.values()) {
      lines.push(`# HELP ${g.name} ${g.help}`);
      lines.push(`# TYPE ${g.name} gauge`);
      for (const s of g.collect()) {
        lines.push(`${g.name}${formatLabels(s.labels)} ${s.value}`);
      }
    }
    return lines.join('\n') + (lines.length ? '\n' : '');
  }

  toJSON(): {
    counters: Array<{ name: string; help: string; series: Array<{ labels: Labels; value: number }> }>;
    histograms: Array<{ name: string; help: string; series: Array<{ labels: Labels; count: number; sum: number; cumulativeCounts: number[] }> }>;
    gauges: Array<{ name: string; help: string; series: Array<{ labels: Labels; value: number }> }>;
    rings: Array<{ name: string; size: number; capacity: number; items: unknown[] }>;
  } {
    const counters: Array<{ name: string; help: string; series: Array<{ labels: Labels; value: number }> }> = [];
    for (const c of this.counters.values()) {
      counters.push({ name: c.name, help: c.help, series: c.series() });
    }
    const histograms: Array<{ name: string; help: string; series: Array<{ labels: Labels; count: number; sum: number; cumulativeCounts: number[] }> }> = [];
    for (const h of this.histograms.values()) {
      const series = (h as unknown as { series: Map<string, { labels: Labels; count: number; sum: number; counts: number[] }> }).series;
      const out: Array<{ labels: Labels; count: number; sum: number; cumulativeCounts: number[] }> = [];
      for (const { labels, count, sum, counts } of series.values()) {
        out.push({ labels, count, sum, cumulativeCounts: counts.slice() });
      }
      histograms.push({ name: h.name, help: h.help, series: out });
    }
    const gauges: Array<{ name: string; help: string; series: Array<{ labels: Labels; value: number }> }> = [];
    for (const g of this.gauges.values()) gauges.push({ name: g.name, help: g.help, series: g.collect() });
    const rings: Array<{ name: string; size: number; capacity: number; items: unknown[] }> = [];
    for (const [name, r] of this.rings) rings.push({ name, size: r.size, capacity: r.capacity, items: r.toArray().slice() });
    return { counters, histograms, gauges, rings };
  }
}

export const metrics = new MetricsRegistry();
