/**
 * Error → HTTP status code mapping.
 * Used by the Fastify error handler to set response status before sending body.
 */

export interface MappedError {
  status: number;
  code: string;
}

export function mapErrorToStatus(error: Error | unknown): MappedError {
  const msg = error instanceof Error ? error.message : String(error);

  if (/timed?\s*out|timeout/i.test(msg)) {
    return { status: 504, code: 'TIMEOUT' };
  }
  if (/api\s*key|unauthori[sz]ed/i.test(msg)) {
    return { status: 401, code: 'UNAUTHORIZED' };
  }
  if (/permission|not allowed|需要.*权限|拒绝/i.test(msg)) {
    return { status: 403, code: 'FORBIDDEN' };
  }
  if (/not\s*(in\s*allowlist|found|configured)|does not exist|未配置|未.*在.*白名单/i.test(msg)) {
    return { status: 404, code: 'NOT_FOUND' };
  }

  return { status: 500, code: 'INTERNAL_ERROR' };
}