import type { Labels } from './metrics-counter.js';

export const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export interface HistogramSnapshot {
  count: number;
  sum: number;
  cumulativeCounts: number[];
  buckets: number[];
}

export class Histogram {
  private series = new Map<string, { count: number; sum: number; counts: number[] }>();

  constructor(
    public readonly name: string,
    public readonly help: string,
    public readonly buckets: number[] = DEFAULT_BUCKETS,
  ) {}

  observe(labels: Labels, value: number): void {
    const k = Object.keys(labels).sort().map(x => `${x}=${labels[x]}`).join('|');
    let s = this.series.get(k);
    if (!s) {
      s = { count: 0, sum: 0, counts: new Array(this.buckets.length + 1).fill(0) };
      this.series.set(k, s);
    }
    s.count += 1;
    s.sum += value;
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) s.counts[i] += 1;
    }
    s.counts[this.buckets.length] += 1;
  }

  snapshot(labels: Labels): HistogramSnapshot {
    const k = Object.keys(labels).sort().map(x => `${x}=${labels[x]}`).join('|');
    const s = this.series.get(k);
    if (!s) {
      return { count: 0, sum: 0, cumulativeCounts: new Array(this.buckets.length + 1).fill(0), buckets: this.buckets };
    }
    return { count: s.count, sum: s.sum, cumulativeCounts: s.counts.slice(), buckets: this.buckets };
  }
}
