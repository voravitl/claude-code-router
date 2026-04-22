# CCR Upstream Transformer Reuse Map

From AGENTS.md analysis: CCR upstream (`@musistudio/llms` packages/core) already has built-in transformers that handle some of our planned features. We should REUSE these instead of building from scratch.

## Upstream Transformers Available

| Upstream Transformer | What It Does | Our Feature | Strategy |
|---|---|---|---|
| `tooluse.transformer.ts` | Tool use formatting | P3.5-A Tool Mode | Extend or config this, not build new |
| `forcereasoning.transformer.ts` | Force reasoning mode | P3.5-C Reasoning | Reuse + add format translation |
| `reasoning.transformer.ts` | Reasoning/thinking passthrough | P3.5-C Reasoning | Reuse, add provider-specific format mapping |
| `enhancetool.transformer.ts` | Enhanced tool descriptions | P3.5-B Progressive Disclosure | Extend with --help pattern |
| `maxtoken.transformer.ts` | Token limit enforcement | P1-1 cache_control | Check if handles cache_control already |
| `cleancache.transformer.ts` | Cache cleanup | P1-1 cache_control | May overlap with our cache_control injection |
| `deepseek.transformer.ts` | DeepSeek reasoning chain | P3.5-C Reasoning | Reuse for reasoning_content format |
| `openrouter.transformer.ts` | OpenRouter response normalization | P1-1 | Already handles `cache_control` for OpenRouter |
| `anthropic.transformer.ts` | Anthropic API format adaptation | P1-1, P1-2 | Check if handles cache_control + tool pairs |
| `gemini.transformer.ts` | Gemini format conversion | P0 Bug E | May already fix gemini-oauth header issue |

## Key Insight

Before implementing ANY feature, check if upstream already handles it:
1. Read the relevant upstream transformer in `packages/core/src/transformer/`
2. If it exists → configure/extend it in config.json
3. If it doesn't exist → build as local plugin in `plugins/`
4. If it partially exists → extend upstream via local plugin

## What We Still Need to Build (not covered by upstream)

- **P0 bugs**: smart-optimizer.js, auth-forwarder.js — local code, must fix locally
- **P1-1 cache_control**: Need to check if anthropic.transformer.ts or cleancache already does this
- **P1-2 tool-pair orphan**: Need to check if anthropic.transformer.ts handles this
- **P1-3 Retry-After**: No upstream retry logic exists
- **P2 all**: No upstream credential caching, circuit breaker, or anti-loop
- **P3 Semantic Distillation**: No upstream compression — must build
- **P3.5-A Tool Mode**: tooluse.transformer.ts exists but may not have ExitTool pattern
- **P3.5-B Progressive Disclosure**: enhancetool.transformer.ts may be extendable
- **P3.5-C Reasoning**: reasoning.transformer.ts + deepseek.transformer.ts may cover most cases

## Next Step: Audit Upstream

Before implementing, read each upstream transformer to confirm what's already handled.