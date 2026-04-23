# CCR Fix Plan v2 — Post-CCG Review

> Synthesized from: Codex review, Gemini review, CCG review findings, code audit
> Generated: 2026-04-22

## Priority Matrix

| # | Fix | Severity | File | Effort |
|---|-----|----------|------|--------|
| F1 | Cache Control redesign | HIGH | cache-control.transformer.js | Medium |
| F2 | Tool-Pair: boundary-aware truncation | HIGH | smart-optimizer.transformer.js | Medium |
| F3 | Bug G: truncateHistory token budget | HIGH | smart-optimizer.transformer.js:510 | Small |
| F4 | Bug F: preflight warmer hang | HIGH | smart-optimizer.transformer.js:174-224 | Small |
| F5 | Circuit breaker per-scope + Retry-After | MEDIUM | circuit-breaker.transformer.js | Medium |
| F6 | Reasoning normalizer disable + DeepSeek ⌀ | MEDIUM | reasoning-normalizer.transformer.js | Small |
| F7 | Reasoning_effort: respect existing values | MEDIUM | smart-optimizer.transformer.js:714-723 | Small |
| F8 | Progressive disclosure: skeleton mode | MEDIUM | progressive-tool-disclosure.transformer.js | Medium |
| F9 | Anti-loop detection | MEDIUM | smart-optimizer.transformer.js | Medium |
| F10 | Security: XML escaping in prompts | MEDIUM | smart-optimizer.transformer.js | Small |
| F11 | Security: SHA-256 hash (replace FNV-1a) | LOW | smart-optimizer.transformer.js | Small |
| F12 | Security: content preview sanitization | LOW | orchestrator-router.js:127 | Small |
| F13 | Security: .env isolation | LOW | auth-forwarder.transformer.js | Small |
| F14 | Model routing comma→slash | MEDIUM | orchestrator-router.js | Small |
| F15 | Iterative summary (Step 9) | LOW | smart-optimizer.transformer.js | Medium |
| F16 | ccr doctor health check (Step 10b) | LOW | NEW FILE | Medium |

---

## F1: Cache Control Redesign

**Problem**: Current code marks "last eligible block" per message. Should mark stable prefixes strategically.

**Fix**: Replace iteration logic with strategic breakpoint placement:

```js
async transformRequestIn(request, provider, context) {
  if (!this.options.enabled) return request;
  const providerName = (typeof provider === 'string' ? provider : provider?.name || '').toLowerCase();
  if (!providerName.includes(this.options.providerMatch)) return request;

  const messages = request.messages;
  if (!messages || !Array.isArray(messages)) return request;

  let breakpointsPlaced = 0;
  const max = this.options.maxBreakpoints;

  // Strategy: mark stable prefixes in priority order
  const priorities = [];

  for (let i = 0; i < messages.length && breakpointsPlaced < max; i++) {
    const msg = messages[i];

    // Wrap string content into array blocks
    if (typeof msg.content === 'string') {
      msg.content = [{ type: 'text', text: msg.content }];
    }
    if (!Array.isArray(msg.content)) continue;

    const eligible = this._findLastEligibleBlock(msg.content);
    if (!eligible || !this._meetsMinTokenThreshold(eligible)) continue;

    // Priority: system → first user → first assistant → second user
    const isPriority = (
      (msg.role === 'system') ||
      (msg.role === 'user' && priorities.filter(p => p === 'user').length < 2) ||
      (msg.role === 'assistant' && priorities.filter(p => p === 'assistant').length < 1)
    );

    if (isPriority) {
      eligible.cache_control = { type: "ephemeral" };
      breakpointsPlaced++;
      priorities.push(msg.role);
    }
  }

  return request;
}
```

## F2: Tool-Pair Boundary-Aware Truncation

**Problem**: Current approach truncates then repairs. Should preserve complete tool rounds during truncation.

**Fix**: Replace `truncateHistory` logic to identify tool round boundaries:

```js
_identifyToolRounds(messages) {
  // A tool round = [assistant(tool_calls), user(tool_results for ALL those calls)]
  const rounds = [];
  let currentRound = null;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      // Start a new tool round
      currentRound = { assistantIdx: i, toolCallIds: msg.tool_calls.map(tc => tc.id), resultIdxs: [] };
      rounds.push(currentRound);
    } else if (msg.role === 'user' && currentRound && Array.isArray(msg.content)) {
      // Check if this user message contains tool_results for the current round
      const toolResults = msg.content.filter(b => b?.type === 'tool_result');
      if (toolResults.length > 0) {
        currentRound.resultIdxs.push(i);
        // Round is complete if all tool_call IDs have results
        const resultIds = new Set(toolResults.map(b => b.tool_use_id));
        const allCovered = currentRound.toolCallIds.every(id => resultIds.has(id));
        if (allCovered) currentRound = null; // round complete
      }
    }
  }
  return rounds;
}

truncateHistoryBound aware(messages, maxTokens) {
  // 1. Separate system messages
  // 2. Identify tool rounds
  // 3. Drop complete tool rounds from the top (oldest first)
  // 4. Keep recent messages intact
  // 5. Fall back to _sanitizeToolPairs for any remaining orphans
}
```

## F3: Bug G — truncateHistory First User Msg Token Budget

**Problem**: `truncateHistory()` adds first user message to `preserved` but doesn't add its tokens to `totalTokens`.

**Current code** (smart-optimizer.js:510-513):
```js
const preserved = [...systemMessages];
// Keep first user message (often contains code context)
if (otherMessages.length > 0) {
  preserved.push(otherMessages[0]);  // BUG: tokens not counted!
  otherMessages.shift();
}
```

**Fix**:
```js
const preserved = [...systemMessages];
if (otherMessages.length > 0) {
  const firstMsg = otherMessages.shift();
  preserved.push(firstMsg);
  totalTokens += this.estimateTokens(this.extractContent(firstMsg));  // Count tokens!
}
```

## F4: Bug F — Preflight Warmer Hang

**Problem**: `_warmLLMCache` has `_inflightLLM` set but never clears entries when the fetch hangs/times out silently.

**Current code** (smart-optimizer.js:174-224): The `.finally()` block clears `_inflightLLM`, BUT if the `fetch` itself hangs without triggering `AbortController`, the entry stays.

**Fix**: Add a hard timeout cleanup:
```js
_warmLLMCache(content, hash) {
  if (this._inflightLLM?.has(hash)) return;
  if (!this._inflightLLM) this._inflightLLM = new Set();
  this._inflightLLM.add(hash);

  // Hard timeout: clear inflight after 2x llmTimeoutMs regardless
  const hardTimeout = setTimeout(() => {
    this._inflightLLM.delete(hash);
  }, this.options.llmTimeoutMs * 2);

  // ... existing fetch logic ...
  .finally(() => {
    clearTimeout(timeoutId);
    clearTimeout(hardTimeout);  // Clear hard timeout too
    this._inflightLLM.delete(hash);
  });
}
```

## F5: Circuit Breaker Enhancements

**Problems**: (a) No per-scope counters, (b) No Retry-After support, (c) Half-open race condition.

**Fixes**:

(a) Key circuits by `provider:model` not just `provider`:
```js
_getScopeKey(providerName, modelName) {
  return `${providerName || ''}:${modelName || ''}`;
}
```

(b) Honor Retry-After when opening circuit:
```js
async transformResponseOut(response, context) {
  // ...
  if (status === 429 || status === 503) {
    circuit.failures++;
    if (circuit.failures >= this.options.failureThreshold) {
      circuit.state = 'open';
      // Honor Retry-After header
      const retryAfter = this._parseRetryAfter(response.headers || context?.responseHeaders);
      circuit.openedAt = Date.now();
      if (retryAfter && retryAfter > this.options.cooldownMs) {
        circuit.openedAt = Date.now() - this.options.cooldownMs + retryAfter;
      }
    }
  }
}
```

(c) Add probe lock for half-open:
```js
if (state === 'half-open') {
  const circuit = this._getCircuit(providerName);
  if (circuit.probeInProgress) {
    throw new Error(`Circuit breaker: probe already in progress for ${providerName}`);
  }
  circuit.probeInProgress = true;
  // Clear probeInProgress in transformResponseOut on success/failure
}
```

## F6: Reasoning Normalizer — Disable + DeepSeek ⌀

**Action**: Set `enabled: false` by default. Add DeepSeek R1 `⌀` tag support for when users enable it:

```js
_detectInputFormat(response, providerName) {
  // ... existing detection ...
  if (typeof choice.content === "string") {
    if (choice.content.includes("<thinking>")) return "thinking";
    if (choice.content.includes("⌀")) return "think_tag";  // DeepSeek R1
    if (choice.content.includes("<reasoning_content>")) return "reasoning_content";
  }
  return null;
}
```

## F7: Respect Existing reasoning_effort

**Problem**: Smart-optimizer forces `reasoning_effort=none` on all models, overriding Hermes' adaptive reasoning.

**Fix**: Change to respect existing values:
```js
// Only set default if not already specified by upstream (Hermes)
if (typeof request.reasoning_effort === 'undefined') {
  const effortOverride = this.options?.effortOverride || {};
  const modelBase = (request.model || '').split('|')[0].split(':')[0].toLowerCase();
  if (effortOverride[modelBase]) {
    request.reasoning_effort = effortOverride[modelBase];
  } else {
    request.reasoning_effort = 'none';
  }
}
// If reasoning_effort is already set (by Hermes), keep it as-is
```

Note: Current code already has this check (`if (typeof request.reasoning_effort === 'undefined')`), but Hermes may not be setting `reasoning_effort` before the transformer runs. Need to verify execution order.

## F8: Progressive Disclosure — Skeleton Mode

**Problem**: Current implementation strips parameters entirely, forcing ToolDetails calls.

**Fix**: "Skeleton Disclosure" — keep parameter names/types, strip descriptions:
```js
request.tools = request.tools.map(t => ({
  ...t,
  function: {
    ...t.function,
    description: t.function.description.split('\n')[0].substring(0, 120),
    // Keep parameter structure but strip descriptions
    parameters: this._stripParamDescriptions(t.function.parameters),
  }
}));

_stripParamDescriptions(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const result = { ...schema };
  delete result.description;  // Remove top-level description
  if (result.properties) {
    result.properties = Object.fromEntries(
      Object.entries(result.properties).map(([key, val]) => [
        key, { type: val.type, enum: val.enum }  // Keep name+type+enum only
      ])
    );
  }
  return result;
}
```

Also raise default threshold from 5 to 30.

## F9: Anti-Loop Detection

**New method** in smart-optimizer.transformer.js:
```js
_detectLoop(messages) {
  // Find last 3 assistant tool calls
  const recentToolCalls = [];
  for (let i = messages.length - 1; i >= 0 && recentToolCalls.length < 3; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        recentToolCalls.unshift({
          name: tc.function?.name,
          args: tc.function?.arguments,
        });
      }
    }
  }

  if (recentToolCalls.length >= 3) {
    const allSame = recentToolCalls.every(tc =>
      tc.name === recentToolCalls[0].name &&
      tc.args === recentToolCalls[0].args
    );
    if (allSame) {
      // Inject circuit-breaker message
      messages.push({
        role: 'user',
        content: `[CCR Loop Detection] You have called ${recentToolCalls[0].name} ${recentToolCalls.length} times with the same arguments. This may indicate a loop. Try a different approach or tool.`,
      });
      return true;
    }
  }
  return false;
}
```

## F10: XML Escaping in Prompts

**Problem**: User content is directly interpolated into XML-style tags without escaping.

**Fix**: Add escape helper:
```js
_escapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```

Use in `structurePrompt()` and `_distillHistory()` serialization.

## F11: SHA-256 Hash (Replace FNV-1a)

**Fix**:
```js
const crypto = require('crypto');
function stableHash(text) {
  return crypto.createHash('sha256').update(text).digest('hex').substring(0, 16);
}
```

## F12: Content Preview Sanitization

**Fix** in orchestrator-router.js:
```js
// Sanitize preview: mask potential secrets
const safePreview = userContent
  .substring(0, 100)
  .replace(/(?:sk-|key-|ya29\.|Bearer\s+)\S+/g, '[REDACTED]');
req.log?.info({ ...contentPreview: safePreview... });
```

## F13: .env Isolation

**Fix**: Load .env into private map instead of process.env:
```js
this._envVars = new Map();
// ... load .env into this._envVars ...
// Access: this._envVars.get('ANTHROPIC_KEY') instead of process.env.ANTHROPIC_KEY
```

## F14: Model Routing Migration

**Fix** in orchestrator-router.js — add dual-format parser:
```js
function parseModelSpec(spec) {
  // Try slash format first (target): "ollama/glm-5.1:cloud"
  const slashParts = spec.match(/^([^/]+)\/(.+)$/);
  if (slashParts) return { provider: slashParts[1], model: slashParts[2] };

  // Fallback to comma format (legacy): "ollama,glm-5.1:cloud"
  const commaParts = spec.match(/^[^,]+,(.+)$/);
  if (commaParts) {
    const provider = spec.split(',')[0];
    return { provider, model: commaParts[1] };
  }

  return { provider: null, model: spec };
}
```

## F15: Iterative Summary

**Fix** in `_distillHistory`:
```js
async _distillHistory(messages, targetTokens) {
  // ... existing setup ...

  // Check for existing summary (iterative mode)
  const existingSummaryIdx = toDistill.findIndex(m =>
    this.extractContent(m).includes('[CONTEXT COMPACTION — REFERENCE ONLY]') ||
    this.extractContent(m).includes('<ccr-context-summary>')
  );

  if (existingSummaryIdx >= 0) {
    // Iterative: send previous summary + new messages only
    const previousSummary = toDistill[existingSummaryIdx];
    const newMessages = toDistill.slice(existingSummaryIdx + 1);
    const serialized = `[PREVIOUS SUMMARY]\n${this.extractContent(previousSummary)}\n\n[NEW MESSAGES]\n${newMessages.map(m => `[${m.role.toUpperCase()}]: ${this.extractContent(m)}`).join('\n\n')}`;
  }
  // ... rest of distillation ...
}
```

Safeguard: Filter out `_distilled` messages from summarizer input to prevent drift.