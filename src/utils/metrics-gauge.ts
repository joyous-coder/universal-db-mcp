import type { Labels } from './metrics-counter.js';

export interface GaugeSeries {
  labels: Labels;
  value: number;
}

export class Gauge {
  constructor(
    public readonly name: string,
    public readonly help: string,
    public readonly collect: () => GaugeSeries[],
  ) {}
}
