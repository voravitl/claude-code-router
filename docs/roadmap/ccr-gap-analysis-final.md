# CCR Gap Analysis Final — CCG Synthesis

> Synthesized from: Codex review (gpt-5.4), Gemini review, previous CCG review, code audit
> Date: 2026-04-22

## Cross-Review Agreement (Codex + Gemini Both Agree)

| Finding | Codex | Gemini | Consensus |
|---------|-------|--------|-----------|
| Cache control needs stable-prefix strategy | "Replace full scan with stable candidate selector" | N/A (not reviewed) | HIGH PRIORITY |
| Tool-pair needs boundary-aware truncation | "Segment history into atomic units, never split a tool round" | N/A (not reviewed) | HIGH PRIORITY |
| Circuit breaker needs per-scope keying | "Key by provider+model, honor Retry-After, atomic probe lock" | N/A (not reviewed) | MEDIUM PRIORITY |
| Progressive disclosure threshold too low | "Raise to 30, keep param names/types, don't erase schema" | "Skeleton Disclosure: keep param names/types, strip descriptions" | AGREED: raise threshold + skeleton mode |
| Bug G: truncateHistory doesn't count preserved msg tokens | "Find first user msg, add tokens to budget immediately" | N/A | HIGH PRIORITY |
| Bug F: preflight warmer can hang forever | "Route through auth, add hard cleanup timer, use Map not Set" | N/A | HIGH PRIORITY |
| Reasoning normalizer should be disabled | N/A (not reviewed) | "Set enabled:false, add ⌀ tag for DeepSeek R1" | MEDIUM PRIORITY |
| reasoning_effort should respect existing values | N/A (not reviewed) | "Only set if undefined; keep Hermes values" | MEDIUM PRIORITY |
| Security: XML injection in prompts | N/A | "escapeXml() for user content before wrapping" | MEDIUM PRIORITY |
| Security: FNV-1a collisions | N/A | "Replace with SHA-256 truncated to 64-bit" | LOW PRIORITY |
| Security: .env in process.env | N/A | "Load into private Map, not global env" | LOW PRIORITY |
| Security: content preview logging | N/A | "Mask secrets in contentPreview" | LOW PRIORITY |
| Model routing: comma→slash migration | N/A | "Dual-format regex parser, deprecate comma over 2 versions" | MEDIUM PRIORITY |
| Iterative summary: detect existing summaries | "Find existing summary marker, send only new turns" | "Filter _distilled messages, anchor to last known-good state" | AGREED |
| Anti-loop detection needed | "Canonicalize args, last 3 matching → inject breaker" | N/A | MEDIUM PRIORITY |

## Codex-Specific Insights (Unique)

1. **Cache control**: Anthropic now has top-level `request.cache_control` for automatic multi-turn caching. The current code never sets this. Should add `mode: "auto" | "explicit" | "hybrid"` and in multi-turn Anthropic requests, default to `request.cache_control ??= { type: "ephemeral" }`.

2. **Tool-pair**: For Anthropic, the correct output structure is one synthetic `user` message containing all `tool_result` blocks as content array items, NOT raw `role: "tool"` stubs. Current code inserts `role: "tool"` which is OpenAI format, not Anthropic.

3. **Bug G bonus finding**: `otherMessages[0]` is "first non-system message" not "first user message" — could preserve an assistant message instead.

4. **Bug F**: Preflight warmer bypasses auth entirely (only sends `Content-Type`), so cloud preflight models that require auth (like qwen3.5:cloud) will fail silently forever.

## Gemini-Specific Insights (Unique)

1. **Skeleton Disclosure**: Instead of removing parameters entirely, keep parameter names and types but strip descriptions. This saves ~70% tokens while preserving enough structure for the model to attempt calls.

2. **Iterative summary drift safeguard**: Filter out `msg._distilled === true` messages before passing to summarizer. Send `[Oldest Context] + [Current Summary] + [New Raw Messages]` to anchor to last known-good state.

3. **DX priority**: `ccr doctor` is higher priority than Diff Inspector because it catches config/connectivity issues early.

## Final Fix Priority Order

### Immediate (Correctness/Security bugs)
1. **F3**: Bug G — truncateHistory token budget (3 lines)
2. **F4**: Bug F — preflight warmer hang (add hard cleanup timer)
3. **F7**: Respect existing reasoning_effort (1-line check)
4. **F10**: XML escaping in prompts (5-line helper)
5. **F6**: Disable reasoning normalizer by default (1 config change)

### Short-term (Feature redesigns)
6. **F1**: Cache control — stable-prefix strategy
7. **F2**: Tool-pair — boundary-aware truncation
8. **F5**: Circuit breaker — per-scope + Retry-After + probe lock
9. **F8**: Progressive disclosure — skeleton mode + raise threshold to 30
10. **F9**: Anti-loop detection

### Medium-term (New features)
11. **F14**: Model routing migration (comma→slash)
12. **F15**: Iterative summary with drift safeguard
13. **F16**: ccr doctor health check

### Low-priority (Hardening)
14. **F11**: SHA-256 hash (replace FNV-1a)
15. **F12**: Content preview sanitization
16. **F13**: .env isolation

## Recommended Team Structure for Fixes

| Team | Tasks | Agent Type | Model |
|------|-------|------------|-------|
| fix-crew-1 | F3, F4, F7, F10, F6 (immediate bugs) | executor | sonnet |
| fix-crew-2 | F1, F2 (cache + truncation redesign) | executor | opus |
| fix-crew-3 | F5, F8, F9 (circuit breaker + disclosure + anti-loop) | executor | sonnet |