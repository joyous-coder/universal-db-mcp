/**
 * Health and Info Routes
 * System health check and service information endpoints
 */

import type { FastifyInstance } from 'fastify';
import type { HealthResponse, InfoResponse, ApiResponse } from '../../types/http.js';
import { metrics } from '../../utils/metrics.js';

export async function setupHealthRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/health
   * Health check endpoint
   */
  fastify.get<{ Reply: ApiResponse<HealthResponse> }>('/api/health', async (request) => {
    // v2.16: gather observability snapshot for /api/health extension
    const json = metrics.toJSON();
    const queryCounter = json.counters.find(c => c.name === 'db_query_total');
    const errorCounter = json.counters.find(c => c.name === 'db_query_errors_total');
    const queriesTotal = queryCounter?.series.reduce((sum, x) => sum + x.value, 0) ?? 0;
    const errorsTotal = errorCounter?.series.reduce((sum, x) => sum + x.value, 0) ?? 0;
    const activeDb = queryCounter?.series[0]?.labels?.db;

    return {
      success: true,
      data: {
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        uptime_seconds: Math.floor(process.uptime()),
        active_db: activeDb,
        queries_total: queriesTotal,
        errors_total: errorsTotal,
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: request.id,
      },
    };
  });

  /**
   * GET /api/info
   * Service information endpoint
   */
  fastify.get<{ Reply: ApiResponse<InfoResponse> }>('/api/info', async (request) => {
    return {
      success: true,
      data: {
        name: 'universal-db-mcp',
        version: '1.0.0',
        mode: 'http',
        supportedDatabases: [
          'mysql',
          'postgres',
          'redis',
          'oracle',
          'dm',
          'sqlserver',
          'mongodb',
          'sqlite',
          'kingbase',
          'gaussdb',
          'oceanbase',
          'tidb',
          'clickhouse',
          'polardb',
          'vastbase',
          'highgo',
          'goldendb',
        ],
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: request.id,
      },
    };
  });
}
