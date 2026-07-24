/**
 * Query Routes
 * Query execution endpoints
 */

import type { FastifyInstance } from 'fastify';
import type { QueryRequest, ExecuteRequest, ApiResponse, HttpQueryResult } from '../../types/http.js';
import type { QueryResult } from '../../types/adapter.js';
import { ConnectionManager } from '../../core/connection-manager.js';

export async function setupQueryRoutes(
  fastify: FastifyInstance,
  connectionManager: ConnectionManager
): Promise<void> {
  /**
   * POST /api/query
   * Execute a query (read operations)
   */
  fastify.post<{
    Body: QueryRequest;
    Reply: ApiResponse<HttpQueryResult>;
  }>('/api/query', {
    schema: {
      body: {
        type: 'object',
        required: ['sessionId', 'query'],
        properties: {
          sessionId: { type: 'string' },
          query: { type: 'string' },
          params: { type: 'array' },
        },
      },
    },
  }, async (request) => {
    const { sessionId, query, params } = request.body;

    // Get database service
    const service = connectionManager.getService(sessionId);

    // Execute query
    const result = await service.executeQuery(query, params);

    // Convert rows to JSON string for Coze compatibility
    const httpResult: HttpQueryResult = {
      rows: JSON.stringify(result.rows),
      affectedRows: result.affectedRows,
      executionTime: result.executionTime,
      metadata: result.metadata,
    };

    return {
      success: true,
      data: httpResult,
      metadata: {
        executionTime: result.executionTime,
        timestamp: new Date().toISOString(),
        requestId: request.id,
      },
    };
  });

  /**
   * POST /api/execute
   * Execute a write operation (INSERT, UPDATE, DELETE, etc.)
   */
  fastify.post<{
    Body: ExecuteRequest;
    Reply: ApiResponse<QueryResult>;
  }>('/api/execute', {
    schema: {
      body: {
        type: 'object',
        required: ['sessionId', 'query'],
        properties: {
          sessionId: { type: 'string' },
          query: { type: 'string' },
          params: { type: 'array' },
        },
      },
    },
  }, async (request) => {
    const { sessionId, query, params } = request.body;

    // Get database service
    const service = connectionManager.getService(sessionId);

    // Execute query (validation happens in service)
    const result = await service.executeQuery(query, params);

    return {
      success: true,
      data: result,
      metadata: {
        executionTime: result.executionTime,
        timestamp: new Date().toISOString(),
        requestId: request.id,
      },
    };
  });
}
