# CCR Blog Learnings — Additional Features

From: musistudio/claude-code-router blog posts (2026-04-22)

## Feature: Tool Mode (tool_choice: "required" + ExitTool)

**Problem**: Non-Anthropic models (DeepSeek, GLM, devstral) forget to use tools after long conversations — start responding in plain text instead.

**Solution from CCR author**: Tool Mode transformer
1. Inject system prompt: "Tool mode active, you must proactively use tools"
2. Set `tool_choice: "required"` to force at least 1 tool call
3. Add `ExitTool` function — the ONLY valid way to exit tool mode
4. On response: if model calls ExitTool → extract content, remove tool_calls
5. Only works with models that support `tool_choice` parameter

**Config for CCR**:
```jsonc
"toolMode": {
  "enabled": true,
  "providers": ["ollama"],           // apply to these providers only
  "models": ["devstral*", "glm*", "kimi*"],  // apply to these models
  "exitToolName": "ExitTool",
  "systemPrompt": "Tool mode is active. The user expects you to proactively execute the most suitable tool. If no tool is appropriate, call ExitTool to exit."
}
```

**Impact**: Fixes tool usage degradation in long sessions for proxy models.

---

## Feature: Progressive Tool Disclosure (CLI-style)

**Problem**: MCP tools inject ALL tool descriptions into system prompt → context explosion. 50+ tool schemas = thousands of tokens burned before conversation even starts.

**Solution**: CLI `--help` pattern — only show tool overview, load details on demand.

**How it works**:
```
Step 1: Agent sees only tool names + 1-line descriptions (like npm --help)
Step 2: When agent picks a tool, it calls tool --help first
Step 3: Agent gets full parameter details
Step 4: Agent calls the actual tool with correct params
```

**Config for CCR**:
```jsonc
"progressiveToolDisclosure": {
  "enabled": true,
  "strategy": "overview",     // "overview" | "full" | "auto"
  // overview = only inject tool names + 1-line descriptions
  // full = current behavior (inject everything)
  // auto = use overview for >10 tools, full for <=10
  "threshold": 10             // switch to overview when more than N tools
}
```

**Impact**: Reduces system prompt by 50-80% when many tools are registered.

---

## Feature: Provider-specific Reasoning Format Translation

**Problem**: Different providers emit reasoning in different formats:
- Anthropic: `<thinking>` tags in content
- OpenAI: `reasoning` field in response
- GLM/DeepSeek: `<reasoning_content>` tag
- Ollama models: varies per model

**Solution**: Response transformer that normalizes reasoning output format.

**Config for CCR**:
```jsonc
"reasoningNormalization": {
  "enabled": true,
  "outputFormat": "thinking",  // "thinking" | "reasoning" | "reasoning_content" | "none"
  // Convert all provider reasoning to this format
  "providerFormats": {
    "ollama": "reasoning_content",   // GLM/DeepSeek via ollama use this
    "gemini-oauth": "thinking",
    "anthropic": "thinking"
  }
}
```

**Impact**: Consistent reasoning handling regardless of provider — CCR can extract/log/distill reasoning content uniformly.