<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-04-22 | Updated: 2026-04-22 -->

# __tests__

## Purpose
Unit and integration tests for the local CCR plugin system. Uses Node.js built-in test runner (`node:test` + `node:assert`). Tests validate custom transformer behavior, routing logic, auth forwarding, and the full request pipeline.

**Note**: Upstream source uses a different test framework — these are local tests for local plugins only.

## Key Files

| File | Description |
|------|-------------|
| `orchestrator-router.test.js` | Tests model routing: haiku→background, image detection, task type classification, long context fallback, config-driven thresholds |
| `smart-optimizer.test.js` | Tests prompt optimization: constructor defaults, passthrough behavior, LLM/regex classification, FNV-1a caching, token stats |
| `response-optimizer.test.js` | Tests response processing: empty content fix for reasoning models (deepseek-v3.x), error enhancement, metadata injection |
| `auth-forwarder.test.js` | Tests multi-provider auth: Anthropic key resolution (env/config), Gemini OAuth/ADC, Ollama passthrough |
| `token-estimator.test.js` | Tests Thai/English token counting: character classification (U+0E00–U+0E7F), token estimation formula accuracy |
| `config.test.js` | Tests config validation: required fields, provider structure, router settings |
| `integration.test.js` | End-to-end pipeline test: request flows through all transformers and router |

## For AI Agents

### Working In This Directory
- Run all tests: `node --test .` from this directory, or `node --test __tests__/` from `plugins/`
- Run single file: `node --test orchestrator-router.test.js`
- Tests import modules with relative paths (`../orchestrator-router.js`)
- Router tests read real `config.json` from `/Users/voravit.l/.claude-code-router/config.json`
- Test helpers: `makeReq(model, messages)` creates mock request objects, `makeOptimizer()` creates transformer instances with defaults

### Testing Requirements
- Every new transformer method should have corresponding test coverage
- Integration tests cover the full pipeline — add new ones when adding transformers
- Mock providers in tests; never call real APIs
- When adding tests for upstream-mirrored functionality, document differences from upstream behavior

### Common Patterns
- `node:test` `describe`/`it` blocks for organization
- `node:assert` for assertions (`strictEqual`, `deepStrictEqual`, `ok`)
- Mock request objects: `{ body: { model, messages }, log: { info: () => {} } }`
- Mock context objects for transformers

<!-- MANUAL: Custom test notes can be added below -->