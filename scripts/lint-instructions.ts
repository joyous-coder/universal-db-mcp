#!/usr/bin/env tsx
/**
 * CI lint: 确保 buildInstructions() 输出 < 2000 chars 且非空。
 * 挂到 npm run lint。
 */
import { buildInstructions } from '../src/mcp/instructions.js';

const text = buildInstructions();
if (text.length === 0) {
  console.error('❌ buildInstructions() returned empty string');
  process.exit(1);
}
if (text.length > 2000) {
  console.error(`❌ buildInstructions() too long: ${text.length} chars (max 2000)`);
  process.exit(1);
}
console.log(`✓ instructions OK (${text.length} chars)`);