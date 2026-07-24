/**
 * SQL file execution route
 * HTTP equivalent of the MCP `execute_sql_file` tool.
 * Requires:
 *   - DB_ALLOWED_FILE_PATHS configured server-side
 *   - 'script' permission on the session
 */
import type { FastifyInstance } from 'fastify';
import type { SqlFileRequest, ApiResponse } from '../../types/http.js';
import type { QueryResult } from '../../types/adapter.js';
import { ConnectionManager } from '../../core/connection-manager.js';

export async function setupSqlFileRoutes(
  fastify: FastifyInstance,
  connectionManager: ConnectionManager
): Promise<void> {
  fastify.post<{
    Body: SqlFileRequest;
    Reply: ApiResponse<QueryResult>;
  }>('/api/execute-sql-file', {
    schema: {
      body: {
        type: 'object',
        required: ['sessionId', 'filePath'],
        properties: {
          sessionId: { type: 'string' },
          filePath: { type: 'string' },
          useTransaction: { type: 'boolean', default: true },
        },
      },
    },
  }, async (request) => {
    const { sessionId, filePath, useTransaction } = request.body;
    const service = connectionManager.getService(sessionId);
    const result = await service.executeSqlFile({ filePath, useTransaction });
    return {
      success: true,
      data: result,
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: request.id,
      },
    };
  });
}