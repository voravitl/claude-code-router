# CCR Implementation Plan — Detailed Steps

> Companion to `implementation-roadmap.md` — this file contains step-by-step instructions with specific code, files, and verification criteria.

---

## Current State Notes

- **Bug D** (first vs last user msg): Already fixed in `smart-optimizer.transformer.js:410-412` — uses `filter() + [length-1]`. However, the integration test at `__tests__/integration.test.js:45` still uses `find()` — should be updated for consistency.
- **Bug E** (gemini-oauth): Already fixed in `auth-forwarder.transformer.js:59` with `providerName === 'gemini' || providerName === 'gemini-oauth'` and OAuth/API key header handling at lines 65-67.
- **Config format**: Router uses comma format (`ollama,devstral-2:123b-cloud`) — needs migration to slash format (`ollama/devstral-2:123b-cloud`).
- **Response optimizer**: Has `RETRYABLE_TYPES` but no actual retry logic — only tags errors.

---

## Step 0: Audit Upstream Transformers (30 min)

### Goal
Read each upstream transformer to confirm what's already handled before building duplicate features.

### Files to Read
```
packages/core/src/transformer/tooluse.transformer.ts
packages/core/src/transformer/forcereasoning.transformer.ts
packages/core/src/transformer/reasoning.transformer.ts
packages/core/src/transformer/enhancetool.transformer.ts
packages/core/src/transformer/cleancache.transformer.ts
packages/core/src/transformer/anthropic.transformer.ts
packages/core/src/transformer/gemini.transformer.ts
packages/core/src/transformer/deepseek.transformer.ts
packages/core/src/transformer/openrouter.transformer.ts
```

### What to Check
| Feature | Upstream File | Check For |
|---------|--------------|-----------|
| Tool Mode | `tooluse.ts` | ExitTool pattern, `tool_choice: "required"` |
| Reasoning | `reasoning.ts`, `deepseek.ts` | Format translation between `<thinking>`, `reasoning`, `reasoning_content` |
| Progressive Disclosure | `enhancetool.ts` | `--help` pattern or tool description summarization |
| cache_control | `cleancache.ts`, `anthropic.ts` | `cache_control: {type: "ephemeral"}` injection |
| tool-pair orphan | `anthropic.ts` | Bilateral repair (forward stub + backward remove) |
| Gemini OAuth | `gemini.ts` | `ya29.` token vs `x-goog-api-key` header handling |

### Output
Write findings to `docs/roadmap/upstream-audit-results.md`:
- What upstream already handles → skip building
- What upstream partially handles → extend via local plugin
- What upstream doesn't handle → build from scratch

### Verification
- [ ] All 9 upstream files read and documented
- [ ] Audit results written to markdown
- [ ] Feature list updated: mark which features can skip implementation

---

## Step 1: P0 Bug Fixes (10 min)

### 1a. Fix integration test user message selection

**File**: `plugins/__tests__/integration.test.js:45`

**Current** (buggy for multi-user-message tests):
```js
const userContent = result.optimizedBody.messages.find(m => m.role === 'user');
```

**Fix**:
```js
const userMessages = result.optimizedBody.messages.filter(m => m.role === 'user');
const userContent = userMessages[userMessages.length - 1];
```

### 1b. Verify Bug E fix is complete

**File**: `plugins/auth-forwarder.transformer.js:59-67`

Already fixed. Verify:
- `providerName === 'gemini' || providerName === 'gemini-oauth'` ✓
- OAuth token (`ya29.`) uses `Authorization: Bearer` header ✓
- API key uses `x-goog-api-key` header ✓

Add a test case for both paths in `__tests__/auth-forwarder.test.js`.

### Verification
- [ ] `node --test __tests__/` passes
- [ ] New auth-forwarder test case for `gemini-oauth` with OAuth token
- [ ] New auth-forwarder test case for `gemini-oauth` with API key

---

## Step 2: P1 Features — cache_control, tool-pair, retry (90 min)

### 2a. Feature 1: cache_control injection

**New file**: `plugins/cache-control.transformer.js`

**What it does**:
- Inject `cache_control: {type: "ephemeral"}` on:
  1. Last content block of system message
  2. Last content block of first 3 user/assistant turns
- Only for Anthropic provider (has `anthropic-version` header)
- Skip if `cache_control` already present (idempotent)

**Config** (add to `config.json` transformers):
```jsonc
{
  "path": "/Users/voravit.l/.claude-code-router/plugins/cache-control.transformer.js",
  "options": {
    "enabled": true,
    "providerMatch": "anthropic",  // only inject for Anthropic
    "maxTurns": 3                  // first N turns to mark
  }
}
```

**Implementation skeleton**:
```js
module.exports = class CacheControlTransformer {
  constructor(options = {}) {
    this.name = "cache-control";
    this.options = { enabled: true, providerMatch: "anthropic", maxTurns: 3, ...options };
  }

  async transformRequestIn(request, provider, context) {
    if (!this.options.enabled) return request;
    // Only apply for matching provider
    if (!provider?.toLowerCase().includes(this.options.providerMatch)) return request;

    const messages = request.messages;
    if (!messages) return request;

    let turnCount = 0;
    for (const msg of messages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        if (turnCount < this.options.maxTurns && Array.isArray(msg.content)) {
          const lastBlock = msg.content[msg.content.length - 1];
          if (lastBlock && typeof lastBlock === 'object' && !lastBlock.cache_control) {
            lastBlock.cache_control = { type: "ephemeral" };
          }
        }
        turnCount++;
      }
      if (msg.role === 'system' && Array.isArray(msg.content)) {
        const lastBlock = msg.content[msg.content.length - 1];
        if (lastBlock && typeof lastBlock === 'object' && !lastBlock.cache_control) {
          lastBlock.cache_control = { type: "ephemeral" };
        }
      }
    }
    return request;
  }

  async transformResponseOut(response, context) { return response; }
};
```

**Expected impact**: 30-50% token cost reduction on multi-turn Anthropic conversations.

### 2b. Feature 2: tool-pair orphan sanitization

**File**: `plugins/smart-optimizer.transformer.js` (add after truncateHistory)

**What it does**:
1. Build Set of surviving `tool_call` IDs from assistant messages
2. Build Set of `tool_result` IDs from user messages
3. **Forward orphan** (tool_use without result) → insert stub tool_result: `"[Result from earlier conversation — see context summary]"`
4. **Backward orphan** (tool_result without tool_use) → remove the tool_result
5. Ensure role alternation (user/assistant must alternate for Anthropic)

**Add method to SmartOptimizerTransformer**:
```js
_sanitizeToolPairs(messages) {
  const toolCallIds = new Set();
  const toolResultIds = new Set();

  // Collect all tool_call IDs
  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        toolCallIds.add(tc.id);
      }
    }
  }

  // Collect all tool_result IDs
  for (const msg of messages) {
    if (msg.role === 'tool' && msg.tool_call_id) {
      toolResultIds.add(msg.tool_call_id);
    }
  }

  const result = [];
  for (const msg of messages) {
    // Backward orphan: tool_result without matching tool_call
    if (msg.role === 'tool' && msg.tool_call_id && !toolCallIds.has(msg.tool_call_id)) {
      continue; // skip
    }
    result.push(msg);
  }

  // Forward orphan: tool_call without matching tool_result
  const resultToolResultIds = new Set();
  for (const msg of result) {
    if (msg.role === 'tool' && msg.tool_call_id) {
      resultToolResultIds.add(msg.tool_call_id);
    }
  }

  const final = [];
  for (const msg of result) {
    final.push(msg);
    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (!resultToolResultIds.has(tc.id)) {
          // Insert stub tool_result after this assistant message
          final.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: '[Result from earlier conversation — see context summary above]'
          });
        }
      }
    }
  }

  return final;
}
```

Call `messages = this._sanitizeToolPairs(messages)` after `truncateHistory()`.

### 2c. Feature 3: Retry-After backoff

**File**: `plugins/response-optimizer.transformer.js` (add retry logic)

**What it does**:
- On 429/503: read `Retry-After` header if present
- Backoff: base=1s, cap=60s, jittered decorrelated
- Retry up to `maxRetries: 3`
- Store original request body for replay

**Config** (add to response-optimizer options):
```jsonc
{
  "enableRetry": true,
  "maxRetries": 3,
  "baseDelayMs": 1000,
  "maxDelayMs": 60000
}
```

**Implementation**: Add retry wrapper in `transformResponseOut` that:
1. Checks response status for 429/503
2. Calculates backoff delay with jitter
3. Replays the original request after delay
4. Gives up after maxRetries

### Verification
- [ ] `node --test __tests__/` passes
- [ ] cache_control test: verify `cache_control: {type: "ephemeral"}` injected on Anthropic
- [ ] cache_control test: verify NOT injected on non-Anthropic providers
- [ ] tool-pair test: forward orphan gets stub result
- [ ] tool-pair test: backward orphan is removed
- [ ] retry test: 429 response retried with backoff
- [ ] retry test: max retries exhausted → error returned

---

## Step 3: P3-L1 Tool Output Pruning (60 min)

### Goal
Replace old tool outputs with 1-line summaries before truncation.

**File**: `plugins/smart-optimizer.transformer.js` (add method)

**What it does**:
- Before `truncateHistory()`, scan messages for old tool results
- Replace large tool results with 1-line summaries based on tool name:
  - `[terminal] ran <cmd> -> exit <code>, <N> lines output`
  - `[read_file] read <filename> from line <N> (<size> chars)`
  - `[search_files] content search for '<query>' in <path> -> <N> matches`
  - `[write_file] wrote <filename> (<size> chars)`
  - `[patch] applied to <filename>`
  - Default: `[<tool>] (<N> chars)`

**Config** (add to smart-optimizer options):
```jsonc
"enableToolPruning": true,
"toolPruningMaxAge": 5,  // prune tool results older than N turns
"toolPruningHandlers": {
  "terminal": true,
  "read_file": true,
  "write_file": true,
  "search_files": true,
  "patch": true
}
```

### Verification
- [ ] Large terminal outputs replaced with 1-line summary
- [ ] Old read_file results summarized
- [ ] Recent tool results (within threshold) preserved unchanged
- [ ] Unknown tool names get default summary format

---

## Step 4: P3.5-C Reasoning Normalization (30 min)

### Goal
Normalize reasoning output format across providers.

**New file**: `plugins/reasoning-normalizer.transformer.js`

**What it does**:
- In `transformResponseOut`: convert provider-specific reasoning format to target format
- Formats recognized:
  - `<thinking>` tags in content → extract
  - `reasoning` field in response → extract
  - `<reasoning_content>` tags → extract
  - `reasoning_content` field → extract

**Config**:
```jsonc
{
  "path": "/Users/voravit.l/.claude-code-router/plugins/reasoning-normalizer.transformer.js",
  "options": {
    "enabled": true,
    "outputFormat": "thinking",
    "providerFormats": {
      "ollama": "reasoning_content",
      "gemini-oauth": "thinking",
      "anthropic": "thinking"
    }
  }
}
```

### Verification
- [ ] Ollama `reasoning_content` field → extracted and normalized
- [ ] DeepSeek `<reasoning_content>` tags → extracted and normalized
- [ ] Anthropic `<thinking>` tags → preserved
- [ ] Provider not in config → passthrough

---

## Step 5: P3.5-A Tool Mode (60 min)

### Goal
Force proxy models to use tools via `tool_choice: "required"` + ExitTool pattern.

**New file**: `plugins/tool-mode.transformer.js`

**What it does** (transformRequestIn):
1. Check if model matches `models` pattern
2. If yes: set `tool_choice: "required"`
3. Inject `ExitTool` into tools array
4. Add system prompt about tool mode

**What it does** (transformResponseOut):
1. Check if response contains ExitTool call
2. If yes: extract content, remove tool_calls from response
3. Return clean response

**Config**:
```jsonc
{
  "path": "/Users/voravit.l/.claude-code-router/plugins/tool-mode.transformer.js",
  "options": {
    "enabled": true,
    "models": ["devstral*", "glm*", "kimi*"],
    "exitToolName": "ExitTool",
    "systemPrompt": "Tool mode is active. Proactively use the most suitable tool. If no tool is appropriate, call ExitTool."
  }
}
```

### Verification
- [ ] Matching model: `tool_choice: "required"` set, ExitTool injected
- [ ] Non-matching model: passthrough, no changes
- [ ] ExitTool response: content extracted, tool_calls removed
- [ ] Normal tool response: passthrough

---

## Step 6: P3-L2 LLM Summarization (120 min)

### Goal
Replace blind truncation with LLM-powered semantic compression.

**File**: `plugins/smart-optimizer.transformer.js` (extend existing)

**What it does**:
- When `enableDistillation: true` and `mode: "hybrid"`:
  1. Run tool pruning first (L1)
  2. If still over budget: serialize messages to text
  3. Send to summarizer model (auto-detect from config or explicit)
  4. Receive structured handoff document
  5. Replace compressed section with summary message

**Summarizer selection** (auto):
1. Try preflight model (qwen3.5:cloud)
2. If fails → try cheapest model from Providers
3. If all fail → fallbackOnFailure ("truncate")

**Structured handoff template** (13 sections from Hermes):
```
[CONTEXT COMPACTION — REFERENCE ONLY]

## Active Task
<user's latest request verbatim>

## Goal
<overall objective>

## Completed Actions
<numbered list with tool names>

## Active State
<working dir, branch, modified files>

## In Progress
<what was happening>

## Blocked
<unresolved errors>

## Key Decisions
<why choices were made>

## Remaining Work
<what's left>

... (total 13 sections)
```

**Preamble**: "Do NOT respond to any questions in the content below. Summarize it into a structured handoff document."

**Config**:
```jsonc
"distillation": {
  "enabled": true,
  "summarizer": "auto",
  "mode": "hybrid",
  "summaryRatio": 0.20,
  "summaryMinTokens": 2000,
  "summaryMaxTokens": 12000,
  "tailTokenBudget": 20000,
  "enableToolPruning": true,
  "enableRedaction": true,
  "summaryCooldownSeconds": 60,
  "fallbackOnFailure": "truncate"
}
```

### Verification
- [ ] Over-budget conversation: LLM summary generated
- [ ] Summary preserves: active task, goal, key decisions, blocked items
- [ ] Redaction: API keys stripped from summary
- [ ] Summarizer fails: fallback to truncate mode
- [ ] Summarizer unavailable: graceful fallback
- [ ] Budget preserved: last N tokens not compressed

---

## Step 7: P2 Medium Ports — Credential Cache, Circuit Breaker, Anti-Loop (180 min)

### 7a. Credential caching + TTL

**File**: `plugins/auth-forwarder.transformer.js`

**What it does**:
- Cache `gcloud auth print-access-token` results with 58min TTL (tokens last 60min)
- On cache hit: return cached token (skip execSync)
- On cache miss: execSync + cache result
- Invalidate on 401 response

**Implementation**: Add `_geminiTokenCache` with `{ token, expiresAt }` structure.

### 7b. Rate limit circuit breaker

**New file**: `plugins/circuit-breaker.transformer.js`

**What it does**:
- Track 429/503 per provider
- After 3 consecutive failures: open circuit (30s cooldown)
- Half-open: after cooldown, try one request
- If success: close circuit
- If failure: reopen circuit (double cooldown)

**Config**:
```jsonc
{
  "path": "/Users/voravit.l/.claude-code-router/plugins/circuit-breaker.transformer.js",
  "options": {
    "enabled": true,
    "failureThreshold": 3,
    "cooldownMs": 30000,
    "halfOpenMaxRequests": 1
  }
}
```

### 7c. Anti-loop detection

**File**: `plugins/smart-optimizer.transformer.js` (add method)

**What it does**:
- Track last 3 tool calls in conversation
- If 3+ consecutive identical tool calls detected: inject circuit-breaker message
- Message: "You have called <tool> <N> times with the same arguments. This may indicate a loop. Try a different approach."

### Verification
- [ ] Credential cache: first call → execSync, second call → cache hit
- [ ] Credential cache: expired token → execSync again
- [ ] Circuit breaker: 3 failures → circuit opens, requests fail fast
- [ ] Circuit breaker: cooldown → half-open, success → circuit closes
- [ ] Anti-loop: 3 identical tool calls → breaker message injected

---

## Step 8: P3.5-B Progressive Tool Disclosure (90 min)

### Goal
CLI `--help` pattern for tool descriptions — only inject overview, load details on demand.

**New file**: `plugins/progressive-tool-disclosure.transformer.js`

**What it does** (transformRequestIn):
1. Count tools in request
2. If > threshold: replace full descriptions with 1-line overview
3. Add a `ToolDetails` tool that returns full description when called

**Config**:
```jsonc
{
  "path": "/Users/voravit.l/.claude-code-router/plugins/progressive-tool-disclosure.transformer.js",
  "options": {
    "enabled": true,
    "strategy": "auto",
    "threshold": 10
  }
}
```

### Verification
- [ ] >10 tools: descriptions truncated to 1-line overview
- [ ] <=10 tools: full descriptions preserved
- [ ] ToolDetails tool injected when active
- [ ] ToolDetails returns correct full description

---

## Step 9: P3-L3 Iterative Summary + Focus (120 min)

### Goal
On 2nd+ compaction: update previous summary instead of re-summarizing from scratch. Support `/compact <topic>` for guided compression.

**File**: `plugins/smart-optimizer.transformer.js` (extend distillation)

**What it does**:
- Track previous summary in message history (look for `[CONTEXT COMPACTION — REFERENCE ONLY]` prefix)
- On 2nd+ compaction: send previous summary + new turns to summarizer
- Summarizer updates the summary instead of creating new one
- Support focus topic: give 60-70% budget to specified topic

**Config additions**:
```jsonc
"enableIterativeSummary": true,
"focusTopicBudgetRatio": 0.65  // 65% budget for focus topic
```

### Verification
- [ ] 2nd compaction: previous summary found and updated
- [ ] Focus topic: specified topic gets 65% of summary budget
- [ ] Redaction: API keys still stripped from iterative summary
- [ ] No previous summary: creates new (same as L2)

---

## Step 10: P4 DX / Observability (180 min)

### 10a. Diff Inspector

**New file**: `plugins/diff-inspector.js` (CLI tool or HTTP endpoint)

**What it does**:
- Shows `[Original Prompt]` vs `[CCR Optimized Prompt]` side by side
- Highlights: added tags, removed content, reordered sections
- Token count comparison

### 10b. `ccr doctor` health check

**New file**: `bin/ccr-doctor.js`

**What it checks**:
1. Ollama connectivity: `curl -s http://localhost:11434/api/tags`
2. Gemini OAuth: `gcloud auth print-access-token` TTL check
3. Gateway PID: check `.claude-code-router.pid` file
4. Config validity: validate `config.json` schema
5. Model availability: test each provider's models are reachable

### 10c. Unified provider config

**What it does**:
- Merge CCR `config.json` Providers + Hermes provider configs
- Single source of truth for auth, models, routing

### Verification
- [ ] Diff Inspector: shows before/after prompt comparison
- [ ] `ccr doctor`: all 5 checks pass on healthy system
- [ ] `ccr doctor`: reports specific failures when unhealthy
- [ ] Config merge: no duplicate providers

---

## Model Routing System Migration

### Current format (comma):
```json
"default": "ollama,devstral-2:123b-cloud"
```

### Target format (slash — industry standard):
```json
"default": "ollama/devstral-2:123b-cloud"
```

### Migration steps:
1. Add `resolveModel(spec, providers, aliases)` function to orchestrator-router.js
2. Update config.json Router entries to use slash format
3. Update fallback entries to use slash format
4. Update all tests
5. Support backward compatibility: accept both formats during transition

### Resolution logic:
```
1. modelAliases[spec]?           → use alias value
2. spec contains "/"?            → split provider/model, find provider
3. spec is model only?           → scan Providers for matching model
4. not found?                    → content analysis routing (current behavior)
```

### Verification
- [ ] `ollama/glm-5.1:cloud` → resolves to ollama provider, model glm-5.1:cloud
- [ ] `glm-5.1:cloud` → scans providers, finds ollama, resolves correctly
- [ ] `anthropic/claude-opus-4.7` → uses alias to redirect to ollama/glm-5.1:cloud
- [ ] Backward compatibility: `ollama,glm-5.1:cloud` still works