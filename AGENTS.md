<!-- Generated: 2026-04-22 | Updated: 2026-04-22 -->

# claude-code-router

## Purpose
Local runtime configuration directory for **Claude Code Router (CCR)** — a proxy that intercepts Claude Code LLM API requests and applies intelligent model routing, prompt optimization, and multi-provider auth. The upstream source is a monorepo at `github.com/musistudio/claude-code-router` with 4 packages (`cli`, `core`, `server`, `shared`, `ui`). This directory holds the deployed config, custom plugins, and logs.

**Upstream Monorepo Architecture** (`github.com/musistudio/claude-code-router`):
- **`packages/cli`** (`@musistudio/claude-code-router`): CLI tool providing `ccr` command (start/stop/restart/status/model/preset/code/ui)
- **`packages/core`** (`@musistudio/llms`): Core library — Fastify server, transformer pipeline, tokenizer, router, plugin system, SSE streaming
- **`packages/server`** (`@CCR/server`): Docker/PM2 deployment wrapper with auth middleware and agent system
- **`packages/shared`** (`@CCR/shared`): Shared constants, preset management (export/install/marketplace/merge)
- **`packages/ui`** (`@CCR/ui`): React + Vite web UI for config management (providers, transformers, model selector, statusline)

**Core Request Flow** (in upstream `packages/core`):
1. CLI starts Fastify server → loads config → registers API routes
2. Request arrives → auth middleware → provider resolution → transformer chain (`transformRequestIn`)
3. Router determines target model (default/haiku/think/longContext/image/codeReview)
4. Request sent to provider API → response received
5. Response transformed (`transformResponseOut`) → returned to Claude Code

## Key Files

| File | Description |
|------|-------------|
| `config.json` | Main runtime config: Providers, Router, transformers, API_TIMEOUT_MS, LOG settings |
| `config.ollama-only.example.json` | Example config for Ollama-only setup |
| `config.optimized.example.json` | Example config with all optimizers enabled |
| `.env` | API keys (ANTHROPIC_KEY, GEMINI_API_KEY) — **never commit** |
| `PLUGINS-README.md` | Plugin system documentation (Thai language) |
| `.claude-code-router.pid` | PID file for running router process |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `plugins/` | Custom transformers and router logic (see `plugins/AGENTS.md`) |
| `logs/` | Rotating server logs `ccr-*.log` (see `logs/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- Edit `config.json` to change provider lists, routing thresholds, or transformer options
- Restart router with `ccr restart` after config changes
- Config supports env var interpolation: `$VAR_NAME` or `${VAR_NAME}` syntax for secrets
- The `.env` file contains secrets; always reference via `process.env` or `$VAR` syntax in config
- Never hardcode model names — they live in `config.json` Router section
- `CUSTOM_ROUTER_PATH` in config overrides built-in routing with a custom JS function
- `APIKEY` in config enables auth; if unset, server binds to `127.0.0.1` only

### Config.json Structure (key fields)
- `Providers[]`: Array of provider configs (name, api_base_url, api_key, models[], transformer)
- `Router`: Model routing rules (default, think, code, background, image, longContext, haikuModels[], priorityOrder[])
- `transformers[]`: Custom transformer plugins (path, options)
- `LOG`, `LOG_LEVEL`, `API_TIMEOUT_MS`, `STATUS_LINE`, `PROXY_URL`: Operational settings
- `APIKEY`: Optional auth key for the server
- `HOST`: Server bind address (forced to 127.0.0.1 if no APIKEY)

### Testing Requirements
- Run tests via `node --test plugins/__tests__/` from this directory
- Tests use Node.js built-in test runner (`node:test` + `node:assert`)
- Tests read `config.json` directly for router config validation

### Common Patterns
- Config-driven: all thresholds, model lists, and priorities come from `config.json`
- Transformer pipeline: requests pass through `transformRequestIn` → router → `transformResponseOut`
- Thai/English bilingual: prompts and classification patterns support both languages
- Built-in transformers (upstream): anthropic, gemini, deepseek, openrouter, groq, maxtoken, tooluse, reasoning, etc.
- Custom transformers (local): smart-optimizer, auth-forwarder, response-optimizer

## Dependencies

### Internal
- `plugins/` — all local transformer and router logic
- `.env` — API keys loaded at startup by auth-forwarder

### External (upstream npm packages)
- `@musistudio/claude-code-router` (CLI) → `ccr` command
- `@musistudio/llms` (core) → Fastify server, transformer pipeline, tiktoken tokenizer
- `@CCR/server` → Docker/PM2 deployment
- `@CCR/shared` → Preset management, constants
- `@CCR/ui` → React web management UI
- Ollama API (cloud models via localhost:11434)
- Google Gemini API (OAuth + API key)
- Anthropic API (API key auth)

<!-- MANUAL: Custom project notes can be added below -->