# CCR Implementation Roadmap (v3 — Final)

All features from: Codex bugs, Gemini DX gaps, Hermes portability, semantic distillation, model routing, CCR blog learnings, upstream audit.

## Design Principles
1. **Auto-map from config** — zero manual aliasing for models in Providers
2. **Config-driven** — all features via config.json, not hardcoded
3. **`provider/model:tag` format** — industry standard (OpenRouter, LiteLLM)
4. **Auto + override** — smart defaults, manual override when needed
5. **2 mode choices** — hybrid (prune+summarize) or truncate (delete), no pointless 3rd
6. **Audit upstream first** — check `@musistudio/llms` built-in transformers before building new

---

## Step 0: Audit Upstream Transformers (30 min)

Before implementing ANY feature, read the upstream source to confirm what's already handled.

| Our Feature | Upstream File | May Already Exist? | What to Do |
|---|---|---|---|
| Tool Mode (P3.5-A) | `tooluse.ts`, `forcereasoning.ts` | Yes | Check ExitTool pattern |
| Reasoning Translation (P3.5-C) | `reasoning.ts`, `deepseek.ts` | Yes | Check format mapping |
| Progressive Disclosure (P3.5-B) | `enhancetool.ts` | Maybe | Check --help pattern |
| cache_control (P1-1) | `cleancache.ts`, `openrouter.ts`, `anthropic.ts` | Maybe | Check Anthropic cache |
| tool-pair orphan (P1-2) | `anthropic.ts` | Maybe | Check bilateral repair |
| Gemini header (P0-E) | `gemini.ts` | Maybe | Check OAuth header fix |
| Retry (P1-3) | — | No | Build ourselves |
| Distillation (P3) | — | No | Build ourselves |
| Credential cache (P2-4) | — | No | Build ourselves |
| Circuit breaker (P2-5) | — | No | Build ourselves |
| Anti-loop (P2-6) | — | No | Build ourselves |

**Result**: May save ~50% time if upstream already handles some features.

---

## P0 — Critical Bugs (10 min)

| # | Bug | File | Fix | Impact |
|---|-----|------|-----|--------|
| D | first vs last user msg | smart-optimizer.js:404 | `filter() + [length-1]` | Every multi-turn |
| E | gemini-oauth branch + header | auth-forwarder.js:59,65 | `gemini-oauth` + `x-goog-api-key` | Gemini completely broken |

---

## P1 — Easy Ports (90 min)

| # | Feature | From | What | Impact |
|---|---------|------|------|--------|
| 1 | cache_control injection | Hermes prompt_caching.py | `cache_control: {type: "ephemeral"}` on system + 3 turns | 30-50% token savings |
| 2 | tool-pair orphan fix | Hermes anthropic_adapter.py | bilateral repair after truncation | prevent API rejects |
| 3 | Retry-After backoff | Hermes retry_utils.py | jittered decorrelated, maxRetries:3 | handle 429/503 |

---

## P2 — Medium Ports (180 min)

| # | Feature | From | What |
|---|---------|------|------|
| 4 | Credential caching + TTL | Hermes credential_pool | cache gcloud token 58min, skip execSync |
| 5 | Rate limit circuit breaker | Hermes rate_limit_tracker | track 429/503, 3 failures → 30s cooldown |
| 6 | Anti-loop detection | Hermes context_compressor | 3+ identical tool calls → inject breaker |

---

## P3 — Semantic Distillation (300 min)

### Config
```jsonc
"distillation": {
  "summarizer": "auto",              // "auto" | "provider/model:tag"
  "mode": "hybrid",                  // "hybrid" | "truncate"
  "summaryRatio": 0.20,
  "summaryMinTokens": 2000,
  "summaryMaxTokens": 12000,
  "tailTokenBudget": 20000,
  "enableIterativeSummary": true,
  "enableToolPruning": true,
  "enableRedaction": true,
  "summaryCooldownSeconds": 60,
  "fallbackOnFailure": "truncate"
}
```

### Levels
| Level | What | LLM? | Difficulty |
|-------|------|------|-----------|
| L1 | Tool output pruning (1-line summaries) | No | Easy |
| L2 | LLM summarization (structured handoff doc) | auto/qwen3.5:cloud | Medium |
| L3 | Iterative update + focus topic + redaction | auto/qwen3.5:cloud | Hard |

### Auto summarizer selection
```
1. "auto" → try preflight model (qwen3.5:cloud)
2. preflight fails → try cheapest model from Providers
3. all fail → fallbackOnFailure ("truncate")
```

---

## P3.5 — Blog Learnings (180 min)

| # | Feature | Problem | Solution | Difficulty |
|---|---------|---------|----------|------------|
| A | **Tool Mode** | proxy models forget tools | `tool_choice: "required"` + ExitTool | Medium |
| B | **Progressive Tool Disclosure** | MCP injects all tools → prompt explosion | CLI `--help` pattern, load on demand | Medium |
| C | **Reasoning Format Translation** | providers emit reasoning differently | normalize `<thinking>`/`reasoning`/`<reasoning_content>` | Easy |

### Tool Mode config
```jsonc
"toolMode": {
  "enabled": true,
  "models": ["devstral*", "glm*", "kimi*"],
  "exitToolName": "ExitTool"
}
```

### Progressive Disclosure config
```jsonc
"progressiveToolDisclosure": {
  "enabled": true,
  "strategy": "auto",    // "overview" | "full" | "auto"
  "threshold": 10        // >10 tools → overview mode
}
```

### Reasoning Normalization config
```jsonc
"reasoningNormalization": {
  "enabled": true,
  "outputFormat": "thinking",
  "providerFormats": {
    "ollama": "reasoning_content",
    "gemini-oauth": "thinking",
    "anthropic": "thinking"
  }
}
```

---

## Model Routing System

### Format: `provider/model:tag`
- `ollama/glm-5.1:cloud` → explicit provider + model
- `anthropic/claude-opus-4.7` → native Anthropic API
- `glm-5.1:cloud` → model only, auto-find provider

### Resolution order
```
1. modelAliases match?          → use alias
2. "provider/model" format?     → find provider directly
3. "model" only (no provider)?  → scan Providers
4. "auto" / not found?          → content analysis routing
```

### modelAliases (override only — auto-mapped from Providers)
```jsonc
"modelAliases": {
  "anthropic/claude-opus-4.7":   "ollama/glm-5.1:cloud",
  "anthropic/claude-sonnet-4.6": "ollama/devstral-2:123b-cloud",
  "anthropic/claude-haiku-4.5":  "ollama/qwen3.5:cloud"
}
```

---

## P4 — DX / Observability (180 min)

| # | Feature | What |
|---|---------|------|
| 7 | Diff Inspector | [Original] vs [Optimized] prompt comparison |
| 8 | `ccr doctor` | health check: Ollama, Gemini OAuth TTL, gateway.pid |
| 9 | Unified provider config | merge CCR + Hermes into single source of truth |

---

## Final Implementation Order

```
Step 0: Audit upstream transformers              (30 min)
Step 1: P0 bug fixes (D, E)                     (10 min)
Step 2: P1 features (cache, tool-pair, retry)    (90 min)
Step 3: P3-L1 tool pruning                       (60 min)
Step 4: P3.5-C reasoning normalization           (30 min)
Step 5: P3.5-A tool mode                          (60 min)
Step 6: P3-L2 LLM summarization                   (120 min)
Step 7: P2 medium ports (cred, circuit, loop)     (180 min)
Step 8: P3.5-B progressive disclosure              (90 min)
Step 9: P3-L3 iterative summary                    (120 min)
Step 10: P4 DX/observability                       (180 min)
```

**Total estimate: ~14 hours** (may reduce if upstream already has some features)