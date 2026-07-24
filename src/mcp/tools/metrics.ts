/**
 * MCP get_metrics tool (v2.16)
 *
 * Returns observability metrics as JSON. Categories:
 * - summary: counters + histograms + gauges
 * - slow_queries: recent slow queries (ring buffered)
 * - all: everything (counters + histograms + gauges + rings)
 */

import { metrics } from '../../utils/metrics.js';

export interface GetMetricsConfig {
  enabled: boolean;
}

export const GET_METRICS_TOOL_DESCRIPTION = 'Get server observability metrics. category=summary|slow_queries|all. Returns JSON.';

export type MetricsCategory = 'summary' | 'slow_queries' | 'all';

export interface MetricsResponse {
  counters?: Array<{ name: string; help: string; series: Array<{ labels: Record<string, string>; value: number }> }>;
  histograms?: Array<{ name: string; help: string; series: Array<{ labels: Record<string, string>; count: number; sum: number; cumulativeCounts: number[] }> }>;
  gauges?: Array<{ name: string; help: string; series: Array<{ labels: Record<string, string>; value: number }> }>;
  slow_queries?: Array<{ ts: string; db: string; kind: string; seconds: number; sql: string; error: string | null }>;
  rings?: Array<{ name: string; size: number; capacity: number; items: unknown[] }>;
}

export function buildGetMetricsHandler(cfg: GetMetricsConfig) {
  return async (args: { category?: MetricsCategory }): Promise<MetricsResponse> => {
    if (!cfg.enabled) {
      throw new Error('metrics disabled (set DB_METRICS_ENABLED=true)');
    }
    const snap = metrics.toJSON();
    const cat: MetricsCategory = args?.category ?? 'summary';

    if (cat === 'slow_queries') {
      const ring = snap.rings.find(r => r.name === 'db_slow_queries');
      return { slow_queries: (ring?.items as MetricsResponse['slow_queries']) ?? [] };
    }
    if (cat === 'summary') {
      return {
        counters: snap.counters.map(c => ({ name: c.name, help: c.help, series: c.series })),
        histograms: snap.histograms.map(h => ({ name: h.name, help: h.help, series: h.series })),
        gauges: snap.gauges.map(g => ({ name: g.name, help: g.help, series: g.series })),
      };
    }
    return {
      counters: snap.counters,
      histograms: snap.histograms,
      gauges: snap.gauges,
      rings: snap.rings,
    };
  };
}
