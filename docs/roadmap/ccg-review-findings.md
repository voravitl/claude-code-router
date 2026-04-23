# CCG Review Findings — Must-Fix Items

> Synthesized from Codex and Gemini reviews, plus upstream audit results.

## Critical Changes to Implementation Plan

### 1. SKIP: Reasoning Normalizer (Step 4)
**Reason**: Upstream `reasoning.transformer.ts` + `deepseek.transformer.ts` + `forcereasoning.transformer.ts` already handle reasoning format translation. No need to build a new transformer.

**Action**: Remove `reasoning-normalizer.transformer.js` from plan. Configure existing upstream transformers instead.

### 2. MODIFY: Tool Mode (Step 5)
**Change**: Reuse upstream `tooluse.transformer.ts` instead of building from scratch.

**Issues found**:
- `tool_choice` should be string `"required"`, not object `{ type: "required" }`
- Skip array-form system prompts (not just string)
- Reject mixed ExitTool + real tool-call responses (don't normalize)
- Only enable for models that actually support forced tool use

### 3. REDESIGN: Cache Control (Step 2a)
**Issues found**:
- Anthropic now recommends top-level automatic caching for multi-turn
- Only allows up to 4 explicit breakpoints
- Must handle: string content, empty text blocks, thinking blocks
- Should place breakpoints on stable prefixes, not changing content
- Minimum token thresholds must be respected

**Action**: Redesign cache_control to:
1. Check for stable prefixes (system message, first user/assistant exchange)
2. Respect Anthropic's 4-breakpoint limit
3. Handle string content by wrapping in array
4. Skip thinking blocks (cannot be marked)

### 4. REDESIGN: Tool-Pair Orphan (Step 2b)
**Issues found**:
- Anthropic's invariant is NOT "role alternation"
- Correct invariant: "assistant tool_use → immediate user message with all tool_result blocks first"
- Should do boundary-aware truncation that keeps/drops complete tool rounds
- Post-repair should be fallback only

**Action**: Change approach from "truncate then repair" to "boundary-aware truncation that preserves complete tool rounds, with post-repair as fallback"

### 5. FIX: Circuit Breaker (Step 7b)
**Issues found**:
- Missing half-open admission control (probe lock/semaphore)
- Needs per-scope counters (not just per-provider)
- Should honor Retry-After when opening circuit
- Concurrent requests can slip through during half-open

**Action**: Add probe lock, per-scope counters, and Retry-After support.

### 6. FIX: Credential Caching (Step 7a)
**Issues found**:
- Single global cache entry can mix identities
- "Invalidate on 401" not implementable in auth hook (no response context)
- Should key by provider + credential source
- Never cache refresh tokens
- Don't log token values

**Action**: Redesign cache to be keyed by provider + auth source, invalidate from response hook not auth hook.

### 7. RETHINK: Progressive Tool Disclosure (Step 8)
**Issues found**:
- Count-based threshold is risky — LLMs need full descriptions to choose correctly
- "Page fault" problem: model may call ToolDetails just to decide, doubling turns
- Recommend: Semantic gating (show relevant tools based on user prompt)

**Action**: Consider semantic filtering instead of count-based threshold. Or keep threshold but set it higher (e.g., 30+ tools).

### 8. CONSIDER: DeepSeek `<think>` tag
**Addition**: Reasoning normalizer should also handle `<think>` tag used by DeepSeek R1. But since we're skipping the normalizer (upstream handles it), ensure upstream transformers cover this format.

## Production Risk Assessment (from Gemini)

| Feature | Risk Level | Concern |
|---------|-----------|---------|
| LLM Summarization | HIGH | Latency 3-10s, drift risk in iterative mode |
| Progressive Disclosure | HIGH | Models may not find correct tools |
| Tool Mode | MEDIUM | Weaker models may loop without ExitTool |
| Retry Backoff | MEDIUM | Requests can appear "stuck" for 60s |