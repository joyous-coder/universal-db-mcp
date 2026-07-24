/**
 * HTTP Server Setup
 * Fastify server configuration with middleware and routes
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { AppConfig } from '../types/http.js';
import { ConnectionManager } from '../core/connection-manager.js';
import { authMiddleware, setupErrorHandler } from './middleware/index.js';
import { setupRoutes } from './routes/index.js';
import { setupMetricsRoute } from './routes/metrics.js';
import { setupQueryExperienceRoutes } from './routes/query-experience.js';
import { QueryAnalyzer } from '../core/query-analyzer.js';

/**
 * Create and configure HTTP server
 */
export async function createHttpServer(config: AppConfig) {
  // Create Fastify instance
  const fastify = Fastify({
    logger: {
      level: config.http?.logging.level || 'info',
      transport: config.http?.logging.pretty
        ? {
            target: 'pino-pretty',
            options: {
              translateTime: 'HH:MM:ss Z',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
    },
    requestIdHeader: 'x-request-id',
    trustProxy: true,
  });

  // Setup CORS
  await fastify.register(cors, {
    origin: config.http?.cors.origins || '*',
    credentials: config.http?.cors.credentials || false,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID'],
  });

  // Setup rate limiting
  await fastify.register(rateLimit, {
    max: config.http?.rateLimit.max || 100,
    timeWindow: config.http?.rateLimit.window || '1m',
    keyGenerator: (request) => {
      // Use API key if available, otherwise use IP
      return (request as any).apiKey || request.ip;
    },
    errorResponseBuilder: (request) => ({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests, please try again later',
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: request.id,
      },
    }),
  });

  // Setup authentication middleware
  fastify.addHook('onRequest', async (request, reply) => {
    await authMiddleware(request, reply, config);
  });

  // Create connection manager
  const connectionManager = new ConnectionManager(
    config.http?.session.timeout || 3600000,
    config.http?.session.cleanupInterval || 300000
  );

  // Store connection manager in fastify instance for access in routes
  fastify.decorate('connectionManager', connectionManager);

  // Setup routes
  await setupRoutes(fastify, connectionManager);

  // v2.16: /metrics route (Prometheus exposition)
  await setupMetricsRoute(fastify, {
    enabled: config.metrics?.enabled ?? true,
    ipAllowList: config.metrics?.ipAllowList ?? [],
  });

  // v2.17: query analyzer + 8 HTTP endpoints
  const queryAnalyzer = new QueryAnalyzer({
    enabled: config.queryAnalyzer?.enabled ?? true,
    templatesDbPath: config.queryAnalyzer?.templatesDbPath ?? `${process.cwd()}/.db-mcp/templates.db`,
    historyDbPath: config.queryAnalyzer?.historyDbPath ?? `${process.cwd()}/.db-mcp/history.db`,
    historyTtlDays: config.queryAnalyzer?.historyTtlDays ?? 30,
    historyMaxRows: config.queryAnalyzer?.historyMaxRows ?? 10000,
    explainTimeoutMs: config.queryAnalyzer?.explainTimeoutMs ?? 10000,
  });
  fastify.decorate('queryAnalyzer', queryAnalyzer);
  await setupQueryExperienceRoutes(fastify, queryAnalyzer);

  // Setup error handler
  setupErrorHandler(fastify);

  // Graceful shutdown handler
  fastify.addHook('onClose', async () => {
    await connectionManager.disconnectAll();
  });

  return fastify;
}
