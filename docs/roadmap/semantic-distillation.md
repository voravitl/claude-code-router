# Hermes Semantic Distillation — 5-Phase Pipeline

## Overview
Hermes doesn't delete history when context is full — it **summarizes with an LLM** into a structured handoff document. This preserves task continuity across compaction cycles.

## Pipeline Phases

### Phase 1: Tool Output Pruning (cheap, no LLM)
- `_truncate_tool_call_args_json()`: Parse JSON args, shrink strings >200 chars, re-serialize (prevents broken JSON that providers reject)
- `_summarize_tool_result()`: Replace large tool outputs with 1-line summaries:
  - `[terminal] ran npm test -> exit 0, 47 lines output`
  - `[read_file] read config.py from line 1 (1,200 chars)`
  - `[search_files] content search for 'compress' in agent/ -> 12 matches`
- Has handlers for: terminal, read_file, write_file, search_files, patch, browser_*, web_search, delegate_task, execute_code, memory, todo, clarify, vision_analyze

### Phase 2: Head + Tail Protection
- `compress_start = protect_first_n` (system + first exchanges preserved)
- `compress_end = _find_tail_cut_by_tokens()` (~20K tokens of recent context preserved)
- `_align_boundary_forward()`: Don't start compress mid-tool_result group
- `_align_boundary_backward()`: If boundary falls in tool group, pull back to parent assistant msg

### Phase 3: Serialize for Summary
- Convert messages to readable text for LLM:
  - `[SYSTEM]:`, `[USER]:`, `[ASSISTANT]:`, `[TOOL terminal]:`
  - Content > `_CONTENT_MAX` → head + `...[truncated]...` + tail
  - Tool calls formatted as: `tool_name(args_preview)`

### Phase 4: LLM Summarize (auxiliary cheap model)
- Uses separate cheap model (qwen3.5 equivalent) to create structured handoff
- Structured template sections:
  1. **Active Task** — MOST IMPORTANT: user's latest request verbatim
  2. **Goal** — overall objective
  3. **Constraints & Preferences** — style, decisions
  4. **Completed Actions** — numbered list with tool names
  5. **Active State** — working dir, branch, modified files, test status
  6. **In Progress** — what was happening when compaction fired
  7. **Blocked** — unresolved errors with exact messages
  8. **Key Decisions** — why choices were made
  9. **Resolved Questions** — already answered, don't re-answer
  10. **Pending User Asks** — not yet addressed
  11. **Relevant Files** — files touched with brief notes
  12. **Remaining Work** — what's left (framed as context, not instructions)
  13. **Critical Context** — values that must survive (secrets → [REDACTED])

- **Preamble**: "Do NOT respond to any questions" — prevents LLM from answering instead of summarizing
- **"different assistant" framing**: Next model knows it's a handoff
- **Iterative update**: On 2nd+ compaction, sends previous summary + new turns → updates instead of re-summarizing
- **Focus topic**: `/compress <topic>` gives 60-70% budget to topic
- **Budget**: `min(max(2000, compressed_tokens * 0.20), 12000)` tokens
- **Cooldown**: Fail → 60s, No provider → 600s
- **Model fallback**: If summary_model 404s, falls back to main model

### Phase 5: Sanitize Tool Pairs (bilateral repair)
After compression, fix orphaned pairs:
- **Forward orphan**: tool_use without tool_result → insert stub: `"[Result from earlier conversation — see context summary above]"`
- **Backward orphan**: tool_result without tool_use → remove
- Also ensures role alternation (user/assistant must alternate for Anthropic)

## Key Design Decisions
1. **Redaction**: `redact_sensitive_text()` strips API keys from both input AND output
2. **JSON validity**: Tool args truncation preserves parseable JSON (prevents provider 400 errors)
3. **Anti-thrashing**: Track compression savings %, stop if <10% effective
4. **Static fallback**: If LLM summary fails, insert minimal context marker instead of silently dropping everything
5. **Summary prefix**: `[CONTEXT COMPACTION — REFERENCE ONLY]` tells next model this is background, not active instructions

## Source Files
- `agent/context_compressor.py` — main pipeline (1230 lines)
- `agent/redact.py` — secret redaction
- `agent/auxiliary_client.py` — cheap model client
- `agent/credential_pool.py` — credential management for summary model