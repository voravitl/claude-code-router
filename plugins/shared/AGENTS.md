<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-04-22 | Updated: 2026-04-22 -->

# shared

## Purpose
Shared utility modules used by multiple local plugins. Currently contains the token estimator that provides consistent Thai/English token counting across both the orchestrator-router and smart-optimizer.

**Important**: This is a **local heuristic estimator**, not the upstream tokenizer. The upstream core (`packages/core/src/tokenizer/`) uses proper tiktoken (cl100k_base encoding) via `tiktoken-tokenizer.ts`, `huggingface-tokenizer.ts`, and `api-tokenizer.ts`. This local version is faster but approximate — designed for routing decisions, not billing.

## Key Files

| File | Description |
|------|-------------|
| `token-estimator.js` | Language-aware token estimation — classifies characters (Thai/English/other) and estimates tokens using heuristic: `thai*0.8 + english*0.25 + other*1.0` |

## For AI Agents

### Working In This Directory
- Exported functions: `classifyChars(text)` returns `{ thai, english, other }`, `estimateTokens(text)` returns number
- This module is imported by both `orchestrator-router.js` and `smart-optimizer.transformer.js`
- Token estimation is approximate — designed for routing decisions, not precise billing
- Thai characters (U+0E00–U+0E7F) are estimated at ~0.8 tokens per char due to tokenization overhead
- For precise token counting, the upstream `calculateTokenCount()` in `packages/core/src/utils/router.ts` uses tiktoken cl100k_base encoding

### Testing Requirements
- Tests are in `../__tests__/token-estimator.test.js`
- Verify after changes: `node --test ../__tests__/token-estimator.test.js`

### Common Patterns
- CommonJS exports: `module.exports = { classifyChars, estimateTokens }`
- Imported via: `const { classifyChars, estimateTokens } = require('./shared/token-estimator')`

## Dependencies

### External
- None — pure JavaScript, no dependencies

<!-- MANUAL: Custom shared utility notes can be added below -->