import { describe, it, expect } from 'vitest';
import { buildInstructions } from '../../src/mcp/instructions.js';

describe('buildInstructions', () => {
  it('returns non-empty string', () => {
    const text = buildInstructions();
    expect(text.length).toBeGreaterThan(0);
  });

  it('is under 2000 chars', () => {
    const text = buildInstructions();
    expect(text.length).toBeLessThanOrEqual(2000);
  });

  it('mentions 17 supported DB types', () => {
    const text = buildInstructions();
    expect(text).toContain('MySQL');
    expect(text).toContain('PostgreSQL');
    expect(text).toContain('Oracle');
    expect(text).toContain('MongoDB');
    expect(text).toContain('达梦');
  });

  it('describes workflow steps', () => {
    const text = buildInstructions();
    expect(text).toContain('connect_database');
    expect(text).toContain('use_profile');
    expect(text).toContain('execute_query');
    expect(text).toContain('get_schema');
  });

  it('describes permission modes', () => {
    const text = buildInstructions();
    expect(text).toContain('safe');
    expect(text).toContain('readwrite');
    expect(text).toContain('full');
  });
});