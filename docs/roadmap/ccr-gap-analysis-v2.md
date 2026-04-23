# CCR + Hermes Gap Analysis v2 — Post-Implementation Review

> Generated: 2026-04-22 | Status: All 12 implementation steps completed, CCG review findings pending

## Implementation Status

| Step | Feature | Status | CCG Review Verdict |
|------|---------|--------|-------------------|
| 0 | Audit upstream | DONE | — |
| 1 | Bug fixes (user msg, gemini auth) | DONE | — |
| 2a | Cache control injection | DONE | REDESIGN: stable prefixes, 4-breakpoint limit, multi-turn auto-caching |
| 2b | Tool-pair sanitization | DONE | REDESIGN: boundary-aware truncation, not post-repair |
| 2c | Retry backoff | DONE | — (response-optimizer tags but doesn't execute retries) |
| 3 | Tool output pruning | DONE | — |
| 4 | Reasoning normalizer | DONE | SKIP: upstream handles it (reasoning.ts + deepseek.ts + forcereasoning.ts) |
| 5 | Tool mode (ExitTool) | DONE | MODIFY: reuse upstream tooluse.ts, only enable for capable models |
| 6 | LLM summarization | DONE | — |
| 7a | Credential caching | DONE | FIX: key by provider+source ✅, invalidate from response ✅, verify no token logging |
| 7b | Circuit breaker | DONE | FIX: add per-scope counters, Retry-After support, probe lock race condition |
| 7c | Anti-loop detection | NOT DONE | Missing from implementation |
| 8 | Progressive tool disclosure | DONE | RETHINK: semantic gating or higher threshold (30+ tools) |

## Unimplemented Features (from original plan)

| Feature | Priority | Notes |
|---------|----------|-------|
| Step 7c: Anti-loop detection | P2 | 3+ identical tool calls → inject circuit-breaker message |
| Step 9: Iterative summary + focus | P3 | 2nd+ compaction updates previous summary; `/compact <topic>` support |
| Step 10a: Diff Inspector | P4 | Before/after prompt comparison |
| Step 10b: `ccr doctor` health check | P4 | Connectivity, auth, config validation |
| Step 10c: Unified provider config | P4 | Merge CCR config + Hermes provider configs |
| Model routing migration | P1 | Comma → slash format with backward compat |

## Known Bugs (from gap analysis)

| Bug | Severity | Status | Description |
|-----|----------|--------|-------------|
| F | HIGH | OPEN | Preflight cache warmer has no timeout/auth/breaker, `_inflightLLM` never cleared on hang |
| G | HIGH | OPEN | `truncateHistory()` preserves first user msg but doesn't count its tokens in budget |
| I | MEDIUM | OPEN | CCR and Hermes don't share model/reasoning/fallback policy (reasoning_effort conflict) |
| J | MEDIUM | OPEN | Response optimizer error enhancement is mostly no-op on parsed objects |
| K | LOW | OPEN | `priorityOrder` defined in config but never used in routing logic |
| L | MEDIUM | OPEN | Long-context routing uses only latest user text, not total request size |
| N | MEDIUM | OPEN | Prompt injection surface (unescaped XML tags, FNV-1a collision) |
| O | MEDIUM | OPEN | Secrets overexposure (.env → process.env, content preview logging) |

## DX Gaps (not yet addressed)

1. **No Diff Inspector** — can't see what CCR actually did to the prompt
2. **No `ccr doctor`** — no health check for connectivity, auth, config
3. **Split-brain config** — must update keys in CCR config.json AND Hermes separately
4. **No shadow routing** — can't compare routing quality against baseline
5. **No priority queue** — background agents can lag interactive CLI
6. **No stop-signal propagation** — Ctrl+C doesn't stop provider token generation

## CCG Review Fixes Needed

### 2a. Cache Control — Redesign Needed
Current: Marks every eligible message with `cache_control: {type: "ephemeral"}` up to maxBreakpoints.
Issues:
- Doesn't prioritize stable prefixes (system msg, first user/assistant exchange)
- Doesn't handle Anthropic's top-level automatic caching for multi-turn
- Should place breakpoints strategically, not just on "last eligible block"

Fix: Redesign to place breakpoints on stable message prefixes:
1. Always mark last block of system message (if present)
2. Mark first user message
3. Mark first assistant response
4. Mark second user message (4th breakpoint)
5. Respect Anthropic's 4-breakpoint limit

### 2b. Tool-Pair Sanitization — Redesign Needed
Current: Post-repair approach — truncate first, then fix orphans.
Issues:
- The Anthropic invariant is NOT "role alternation"
- Correct invariant: "assistant tool_use → immediate user message with all tool_result blocks first"
- Should do boundary-aware truncation (keep/drop complete tool rounds)

Fix: Change from "truncate then repair" to "boundary-aware truncation that preserves complete tool rounds, with post-repair as fallback"

### 4. Reasoning Normalizer — Should Disable
Current: Full implementation that detects and converts between `<thinking>`, `reasoning`, `<reasoning_content>`, and `reasoning_content` formats.
Issues: Upstream `reasoning.transformer.ts` + `deepseek.transformer.ts` + `forcereasoning.transformer.ts` already handle this.
Action: Set `enabled: false` by default, only activate for providers NOT covered by upstream.

### 5. Tool Mode — Partial Fix Needed
Current: Sets `tool_choice: "required"` (string, correct ✅), injects ExitTool, handles mixed calls ✅.
Issues:
- Should check if the provider supports forced tool use before enabling
- Should reuse upstream `tooluse.transformer.ts` patterns
- Skip for array-form system prompts (already partially handled)

### 7b. Circuit Breaker — Enhancements Needed
Current: Per-provider circuit state with open/half-open/closed states.
Issues:
- No per-scope counters (should track per model+provider, not just provider)
- Doesn't honor Retry-After header when opening circuit
- Race condition: concurrent requests can slip through during half-open transition

### 8. Progressive Tool Disclosure — Rethink Strategy
Current: Count-based threshold (default 5), collapses descriptions to 1-line overview.
Issues:
- Count-based threshold is risky — LLMs need full descriptions to choose correctly
- "Page fault" problem: model calls ToolDetails just to decide, doubling turns
- Default threshold of 5 is WAY too low
Fix: Either implement semantic gating (filter by relevance to prompt) or raise threshold to 30+.

## Hermes Features Still Missing from CCR

| Feature | Hermes Implementation | CCR Status |
|---------|----------------------|------------|
| Credential Pool | CredentialPool with rotation, TTL, exhaustion tracking | Only single-provider cache, no rotation |
| Bilateral Orphan Repair | Full role alternation fix + tool pair repair | Partial (forward/backward orphan) |
| Adaptive Reasoning | Per-task reasoning_effort (low/medium/high) | Forces `reasoning_effort=none` on all |
| Prompt Caching | `system_and_3` strategy, cache_control injection | Basic cache_control (needs redesign) |
| Semantic Distillation | 5-phase pipeline with iterative compaction | Basic distillation (needs iterative summary) |
| Shadow Routing | Quality comparison routing | Not implemented |
| Priority Queue | Background vs interactive prioritization | Not implemented |
| Stop Signal | Cancel propagation to providers | Not implemented |