# CCR + Hermes Gap Analysis (2026-04-22)

## Architecture Comparison

| Layer | Hermes | CCR |
|-------|--------|-----|
| Auth | CredentialPool (rotation, TTL, exhaustion tracking) | execSync gcloud per request, no cache |
| Transcript | bilateral orphan repair, role alternation fix | truncate blind, ignores tool_use pairs |
| Retry | jittered decorrelated backoff + rate guard | no retry (response-optimizer only tags isRetryable) |
| Caching | prompt_caching system_and_3 strategy | no cache_control injection |
| Model policy | adaptive reasoning_effort per task | forces reasoning_effort=none on all models |

## Bug Findings (from Codex round 2)

### Critical
- **Bug D**: CCR uses `find()` for first user msg but router uses last user msg — multi-turn misrouting
- **Bug E**: Gemini auth branch checks `providerName === 'gemini'` but config defines `gemini-oauth` — branch never fires

### High
- **Bug F**: Preflight cache warmer has no timeout/auth/breaker, `_inflightLLM` never cleared on hang
- **Bug G**: truncateHistory() preserves first user msg but doesn't count its tokens in budget
- **Bug H**: Per-request credential resolution (execSync gcloud) is slow and ignores Hermes credential pool
- **Bug I**: CCR and Hermes don't share model/reasoning/fallback policy (reasoning_effort conflict)
- **Bug J**: Response optimizer error enhancement is mostly no-op on parsed objects

### Medium
- **Bug K**: priorityOrder defined in config but never used in routing logic
- **Bug L**: long-context routing uses only latest user text, not total request size
- **Bug M**: CCR transcript truncation breaks tool-call pairs (Hermes has to repair downstream)
- **Bug N**: Prompt injection / cache poisoning surface (unescaped XML tags, 32-bit FNV-1a collision)
- **Bug O**: Secrets overexposure (.env → process.env, content preview logging)

## DX Gaps (from Gemini advisor)
1. No "Diff Inspector" — can't see what CCR actually did to the prompt
2. No `hermes doctor` health check command
3. Split-brain config — must update keys in two places
4. No shadow routing for quality comparison
5. No priority queue — background agents can lag interactive CLI
6. No stop-signal propagation — Ctrl+C doesn't stop provider token generation

## Port Priority

### P0 — Fix Now (correctness bugs)
1. Fix first vs last user msg inconsistency
2. Fix gemini-oauth auth branch

### P1 — Easy Ports (1-2 files, <100 lines each)
1. cache_control injection (from Hermes prompt_caching.py)
2. tool-pair orphan sanitization (from Hermes anthropic_adapter.py:1114)
3. Retry-After backoff (from Hermes retry_utils.py)

### P2 — Medium Ports (need config + logic)
4. Credential caching with TTL
5. Rate limit guard / circuit breaker
6. Anti-loop detection

### P3 — Hard Ports (architectural)
7. Credential pool (per-request → pooled)
8. Adaptive reasoning_effort
9. Context-length-aware routing