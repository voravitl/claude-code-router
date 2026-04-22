<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-04-22 | Updated: 2026-04-22 -->

# plugins

## Purpose
Custom plugin modules for CCR that extend the built-in transformer pipeline. These are **local additions** that sit alongside the upstream core transformers (anthropic, gemini, deepseek, etc. in `packages/core/src/transformer/`). The local plugins handle prompt optimization, auth forwarding, response fixing, and intelligent model routing — all configured via `config.json`.

**Relationship to Upstream**:
- Upstream transformers (`packages/core/src/transformer/`) are built-in and loaded by `TransformerService`
- Local plugins here are loaded via `config.json` transformers array or `CUSTOM_ROUTER_PATH`
- Both follow the same interface: `transformRequestIn(reqBody, provider, context)` and `transformResponseOut(response, context)`

## Key Files

| File | Description |
|------|-------------|
| `orchestrator-router.js` | Config-driven model router — classifies task type (code/debug/plan/etc.) via regex and routes to appropriate model tier. Loaded via `CUSTOM_ROUTER_PATH` in config |
| `smart-optimizer.transformer.js` | Two-tier prompt optimizer: LLM pre-flight (qwen3.5:cloud) classifies+optimizes, regex fallback if LLM fails/timeout. FNV-1a hash caching for both paths |
| `auth-forwarder.transformer.js` | Multi-provider auth handler — Anthropic key from env/.env file, Gemini via gcloud OAuth/ADC, Ollama from config. Overrides `Authorization` header per provider |
| `response-optimizer.transformer.js` | Response post-processor — fixes empty content from reasoning models (merges `reasoning` field into `content`), optional metadata/error enhancement |
| `token-estimator.js` | **Legacy** — shared Thai/English token counter. Upstream uses tiktoken (cl100k_base) in `packages/core/src/tokenizer/`. This local version uses heuristic formula: `thai*0.8 + english*0.25 + other*1.0` |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `__tests__/` | Unit and integration tests (see `__tests__/AGENTS.md`) |
| `shared/` | Shared utilities — token-estimator (see `shared/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- Transformer classes must export `name` property and `transformRequestIn`/`transformResponseOut` methods
- The orchestrator-router is a **function** (not a class) — called as `router(req, config)`
- All routing thresholds come from `config.json` Router section — never hardcode model names
- Regex patterns in `orchestrator-router.js` and `smart-optimizer.transformer.js` support Thai and English keywords
- `smart-optimizer` has FNV-1a hash caching for both regex and LLM results (5s timeout for LLM)
- `effortOverride` in config forces `reasoning_effort=none` for specific models (saves tokens on models that don't benefit from reasoning)
- Auth forwarder loads `.env` once at module load time (not per-request)
- `response-optimizer` has a "fast path" — passthrough when no features are enabled

### Upstream Transformer Reference (for context)
Built-in transformers in `packages/core/src/transformer/`:
- `anthropic.transformer.ts` — Anthropic API format adaptation
- `gemini.transformer.ts` — Google Gemini format conversion
- `deepseek.transformer.ts` — DeepSeek reasoning chain handling
- `openrouter.transformer.ts` — OpenRouter response normalization
- `groq.transformer.ts` — Groq-specific adaptations
- `maxtoken.transformer.ts` — Token limit enforcement
- `maxcompletiontokens.transformer.ts` — Completion token limits
- `tooluse.transformer.ts` — Tool use formatting
- `reasoning.transformer.ts` — Reasoning/thinking chain passthrough
- `forcereasoning.transformer.ts` — Force reasoning mode
- `enhancetool.transformer.ts` — Enhanced tool descriptions
- `sampling.transformer.ts` — Sampling parameter adjustment
- `cleancache.transformer.ts` — Cache cleanup
- `streamoptions.transformer.ts` — Stream option handling
- `customparams.transformer.ts` — Custom parameter injection
- `openai.transformer.ts` — OpenAI format adaptation
- `openai.responses.transformer.ts` — OpenAI responses format
- `vercel.transformer.ts` — Vercel AI SDK format
- `cerebras.transformer.ts` — Cerebras format
- `vertex-claude.transformer.ts` — Vertex AI Claude format
- `vertex-gemini.transformer.ts` — Vertex AI Gemini format

### Testing Requirements
- Run: `node --test __tests__/` from the `plugins/` directory
- Tests use Node.js built-in test runner (`node:test` + `node:assert`)
- Router tests read real `config.json` for validation
- Integration test covers the full transformer pipeline

### Common Patterns
- Transformer options merged with defaults via spread: `{ ...defaults, ...options }`
- Auth forwarder reads `.env` at module load, sets `process.env` if not already set
- Token estimation uses language-aware heuristic (not tiktoken) in local plugins
- Smart optimizer pre-flight uses `qwen3.5:cloud` model with 5s timeout, falls back to regex

## Dependencies

### Internal
- `../config.json` — provider configs, router thresholds, transformer options
- `../.env` — API keys (read by auth-forwarder at module load)
- `shared/token-estimator.js` — shared token counting utility

### External
- Node.js `child_process` — auth-forwarder uses `execSync` for `gcloud` auth
- Node.js `fs` — auth-forwarder reads `.env` file
- Upstream `@musistudio/llms` core package loads these as custom plugins

<!-- MANUAL: Custom plugin notes can be added below -->