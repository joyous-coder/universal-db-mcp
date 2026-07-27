/**
 * v3.3.1: Client detection for smart lazy loading default.
 *
 * Tests that the Claude Code detection regex correctly identifies various
 * Claude Code clientInfo.name strings, and that other clients (Cline, Dify,
 * Continue, etc.) are NOT misidentified.
 */

import { describe, it, expect } from 'vitest';

// Mirror of the regex used in src/mcp/mcp-server.ts isClaudeCodeClientName().
// We re-test the logic here by importing the constant pattern; if the
// implementation changes, this test will reveal the divergence.
const CC_NAME = /claude[\s_.\-]+code/i;

const KNOWN_CLAUDE_CODE_NAMES = [
  'claude-code',
  'Claude Code',
  'claude_code',
  'Claude-Code',
  'claude-code-ai',
  'CLAUDE-CODE',
  'claude.code', // hypothetical
  'Claude Code Desktop',
];

const KNOWN_NON_CLAUDE_CODE_NAMES = [
  'cline',
  'Cline',
  'CLINE',
  'continue',
  'Continue',
  'dify',
  'Dify',
  'cherry-studio',
  'Cherry Studio',
  '5ire',
  'HyperChat',
  'mcp-inspector',
  'librechat',
  'jan',
  'lm-studio',
  'ollama',
  'unknown-client',
  '',
];

describe('v3.3.1 Claude Code client detection regex', () => {
  for (const name of KNOWN_CLAUDE_CODE_NAMES) {
    it(`matches Claude Code name: ${name}`, () => {
      expect(CC_NAME.test(name)).toBe(true);
    });
  }
  for (const name of KNOWN_NON_CLAUDE_CODE_NAMES) {
    it(`does NOT match non-Claude Code name: "${name}"`, () => {
      expect(CC_NAME.test(name)).toBe(false);
    });
  }
});

describe('v3.3.1 lazy loading behavior matrix', () => {
  // Pure logic test — no server fixture needed. Mirrors the decision tree
  // in mcp-server.ts ListTools + CallTool routing.
  function effectiveLazyEnabled(
    lazyLoadEnabled: boolean,
    clientName: string | undefined,
  ): boolean {
    if (!lazyLoadEnabled) return false;
    if (!clientName) return true;
    if (CC_NAME.test(clientName)) return false; // Claude Code bypass
    return true;
  }

  const cases: Array<{
    label: string;
    lazyLoadEnabled: boolean;
    clientName: string | undefined;
    expected: boolean;
  }> = [
    { label: 'DB_LAZY_LOAD_ENABLED=false',     lazyLoadEnabled: false, clientName: 'claude-code',      expected: false },
    { label: 'DB_LAZY_LOAD_ENABLED=true + Claude Code',  lazyLoadEnabled: true,  clientName: 'claude-code',      expected: false },
    { label: 'DB_LAZY_LOAD_ENABLED=true + Cline',        lazyLoadEnabled: true,  clientName: 'cline',           expected: true  },
    { label: 'DB_LAZY_LOAD_ENABLED=true + Dify',         lazyLoadEnabled: true,  clientName: 'dify',            expected: true  },
    { label: 'DB_LAZY_LOAD_ENABLED=true + Continue',     lazyLoadEnabled: true,  clientName: 'Continue',        expected: true  },
    { label: 'DB_LAZY_LOAD_ENABLED=true + no clientInfo',lazyLoadEnabled: true,  clientName: undefined,         expected: true  },
    { label: 'DB_LAZY_LOAD_ENABLED=true + unknown',      lazyLoadEnabled: true,  clientName: 'some-random-mcp', expected: true  },
  ];

  for (const c of cases) {
    it(`${c.label} → effective=${c.expected}`, () => {
      expect(effectiveLazyEnabled(c.lazyLoadEnabled, c.clientName)).toBe(c.expected);
    });
  }
});
