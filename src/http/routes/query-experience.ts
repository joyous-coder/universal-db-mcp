/**
 * HTTP query-experience routes (v2.17)
 *
 * 8 endpoints: /api/lint, /api/explain, /api/query-history,
 *              /api/templates (GET/POST), /api/templates/:id (GET/DELETE),
 *              /api/templates/:id/execute (POST)
 */

import type { FastifyInstance } from 'fastify';
import type { QueryAnalyzer } from '../../core/query-analyzer.js';

export async function setupQueryExperienceRoutes(fastify: FastifyInstance, qa: QueryAnalyzer): Promise<void> {
  fastify.post('/api/lint', async (request) => {
    const { sql } = request.body as { sql: string };
    return { success: true, data: qa.lint(sql) };
  });

  fastify.post('/api/explain', async (request) => {
    const { sql, params } = request.body as { sql: string; params?: unknown[] };
    return { success: true, data: await qa.explain(sql, params) };
  });

  fastify.get('/api/query-history', async (request) => {
    const q = request.query as Record<string, string>;
    const limit = q.limit ? Number(q.limit) : 50;
    const onlyErrors = q.onlyErrors === 'true';
    // v2.19: build filter preserving groupBy + 3-state profileName
    const filter: Record<string, unknown> = { ...q, limit, onlyErrors };
    if (q.profileName !== undefined) {
      filter.profileName = q.profileName === 'null' ? null : q.profileName;
    }
    if (q.groupBy !== undefined) filter.groupBy = q.groupBy;
    return { success: true, data: { entries: await qa.getHistory(filter as any) } };
  });

  fastify.post('/api/templates', async (request) => {
    return { success: true, data: await qa.saveTemplate(request.body as any) };
  });

  fastify.get('/api/templates', async (request) => {
    const q = request.query as { tag?: string; profileName?: string };
    const filter: Record<string, unknown> = {};
    if (q.tag) filter.tag = q.tag;
    if (q.profileName !== undefined) {
      filter.profileName = q.profileName === 'null' ? null : q.profileName;
    }
    return { success: true, data: { templates: await qa.listTemplates(filter as any) } };
  });

  fastify.get<{ Params: { id: string } }>('/api/templates/:id', async (request) => {
    return { success: true, data: { template: await qa.getTemplate(request.params.id) } };
  });

  fastify.delete<{ Params: { id: string } }>('/api/templates/:id', async (request) => {
    return { success: true, data: { deleted: await qa.deleteTemplate(request.params.id) } };
  });

  fastify.post<{ Params: { id: string } }>('/api/templates/:id/execute', async (request, reply) => {
    const { sessionId, params } = request.body as { sessionId: string; params: Record<string, unknown> };
    if (!sessionId) { reply.code(400); return { success: false, error: { code: 'MISSING_SESSION', message: 'sessionId required' } }; }
    const conn = (fastify as any).connectionManager;
    if (!conn) { reply.code(500); return { success: false, error: { code: 'NO_CONNECTION_MANAGER', message: 'connectionManager not available' } }; }
    const adapter = conn.getAdapter?.(sessionId);
    if (!adapter) { reply.code(404); return { success: false, error: { code: 'SESSION_NOT_FOUND', message: `session ${sessionId} not found` } }; }
    return { success: true, data: await qa.executeTemplate(request.params.id, params, adapter) };
  });
}
