/**
 * Metrics Route
 * GET /metrics — Prometheus exposition format (v2.16)
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { metrics } from '../../utils/metrics.js';

export interface MetricsRouteOptions {
  enabled: boolean;
  ipAllowList: string[];
}

function ipMatches(clientIp: string, cidrOrIp: string): boolean {
  if (!cidrOrIp.includes('/')) return clientIp === cidrOrIp;
  const [base, bitsStr] = cidrOrIp.split('/');
  const bits = Number(bitsStr);
  if (!Number.isFinite(bits) || bits < 0 || bits > 32) return false;
  const mask = (~((1 << (32 - bits)) - 1)) >>> 0;
  const ipNum = clientIp.split('.').reduce((acc, oct) => (acc * 256) + Number(oct), 0) >>> 0;
  const baseNum = base.split('.').reduce((acc, oct) => (acc * 256) + Number(oct), 0) >>> 0;
  return (ipNum & mask) === (baseNum & mask);
}

export async function setupMetricsRoute(
  fastify: FastifyInstance,
  options: MetricsRouteOptions
): Promise<void> {
  fastify.get('/metrics', async (request: FastifyRequest, reply) => {
    if (!options.enabled) {
      reply.type('text/plain; version=0.0.4; charset=utf-8');
      return '';
    }
    if (options.ipAllowList.length > 0) {
      const ip = request.ip;
      const allowed = options.ipAllowList.some(rule => ipMatches(ip, rule));
      if (!allowed) {
        reply.code(403).send('forbidden');
        return;
      }
    }
    reply.type('text/plain; version=0.0.4; charset=utf-8');
    return metrics.format();
  });
}
