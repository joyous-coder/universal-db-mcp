/**
 * HTTP profile routes (v2.18)
 *
 * 9 endpoints: list / save / get / delete / enable / disable / connect / disconnect / global-schema
 */

import type { FastifyInstance } from 'fastify';
import type { ProfileManager } from '../../core/profile-manager.js';
import { buildGlobalSchemaView } from '../../core/global-schema-view.js';
import type { ProfileStore } from '../../core/profile-store.js';

export async function setupProfileRoutes(fastify: FastifyInstance, pm: ProfileManager, store?: ProfileStore): Promise<void> {
  fastify.get('/api/profiles', async (request) => {
    const q = request.query as any;
    const filter: { role?: string; tag?: string; enabled?: boolean } = {};
    if (q.role) filter.role = String(q.role);
    if (q.tag) filter.tag = String(q.tag);
    if (q.enabled !== undefined) filter.enabled = q.enabled === 'true';
    return { success: true, data: { profiles: await pm.listProfiles(filter) } };
  });

  fastify.post('/api/profiles', async (request) => {
    const body = request.body as any;
    return { success: true, data: await pm.saveProfile(body) };
  });

  fastify.get<{ Params: { name: string } }>('/api/profiles/:name', async (request, reply) => {
    const p = await pm.getProfile(request.params.name);
    if (!p) { reply.code(404); return { success: false, error: { code: 'NOT_FOUND', message: `profile ${request.params.name} not found` } }; }
    return { success: true, data: { profile: p } };
  });

  fastify.delete<{ Params: { name: string } }>('/api/profiles/:name', async (request) => {
    return { success: true, data: { deleted: await pm.deleteProfile(request.params.name) } };
  });

  fastify.post<{ Params: { name: string } }>('/api/profiles/:name/enable', async (request, reply) => {
    const p = await pm.getProfile(request.params.name);
    if (!p) { reply.code(404); return { success: false, error: { code: 'NOT_FOUND', message: 'not found' } }; }
    if (store) await store.setEnabled(request.params.name, true);
    return { success: true, data: { enabled: true } };
  });

  fastify.post<{ Params: { name: string } }>('/api/profiles/:name/disable', async (request, reply) => {
    const p = await pm.getProfile(request.params.name);
    if (!p) { reply.code(404); return { success: false, error: { code: 'NOT_FOUND', message: 'not found' } }; }
    await pm.unloadProfile(request.params.name);
    if (store) await store.setEnabled(request.params.name, false);
    return { success: true, data: { enabled: false } };
  });

  fastify.post<{ Params: { name: string } }>('/api/profiles/:name/connect', async (request, reply) => {
    try {
      const live = await pm.loadProfile(request.params.name);
      return { success: true, data: { name: live.profile.name, type: live.profile.type, role: live.profile.role } };
    } catch (err) {
      reply.code(400);
      return { success: false, error: { code: 'CONNECT_FAILED', message: err instanceof Error ? err.message : String(err) } };
    }
  });

  fastify.post<{ Params: { name: string } }>('/api/profiles/:name/disconnect', async (request) => {
    await pm.unloadProfile(request.params.name);
    return { success: true, data: { disconnected: true } };
  });

  fastify.get('/api/global-schema', async () => {
    return { success: true, data: await buildGlobalSchemaView(pm) };
  });
}