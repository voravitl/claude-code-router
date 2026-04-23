# Upstream Audit Results

## Feature Coverage Matrix
| Feature | Upstream Coverage | What to Do |
|---|---|---|
| Tool Mode | **High**: `tooluse.transformer.ts` implements a full `ExitTool` pattern and proactively forces tool mode using system reminders. | Leverage existing `ExitTool` pattern; focus on progressive disclosure/help in `enhancetool`. |
| Reasoning Normalization | **High**: `reasoning.transformer.ts`, `forcereasoning.transformer.ts`, and `deepseek.transformer.ts` already handle `reasoning_content` to `thinking` mapping and forcing reasoning prompts. | Skip redundant reasoning normalizer; ensure interoperability with the existing `thinking` format. |
| Cache Control | **High**: `cleancache.transformer.ts` strips `cache_control`, and `openrouter.transformer.ts` handles it for specific models. | Use existing logic; new `cache-control` transformer should focus on *injection* rather than cleaning. |
| Tool Parameter Parsing | **Medium**: `enhancetool.transformer.ts` handles `parseToolArguments` for streaming and non-streaming tool calls. | Scope `enhancetool` further to include the `--help` pattern as requested. |
| Provider Headers | **High**: `gemini.transformer.ts` already handles `x-goog-api-key` and `Authorization` logic. `anthropic.transformer.ts` handles `x-api-key`. | No changes needed for base provider authentication headers. |

## Per-Transformer Findings
### tooluse.transformer.ts
- **Functionality**: Injects a `<system-reminder>` about tool mode.
- **Exit Pattern**: Adds an `ExitTool` function to the request.
- **Response Handling**: Intercepts `ExitTool` calls and converts them into assistant content, effectively "exiting" the tool loop at the router level.

### forcereasoning.transformer.ts
- **Functionality**: Prepends a strict reasoning prompt to the last user message.
- **Format**: Wraps reasoning content in `<reasoning_content>` tags and ensures the assistant follows this format.
- **Response**: Extracts reasoning from the tags into a `thinking` block in the unified response.

### reasoning.transformer.ts
- **Functionality**: Handles the unified `thinking` property (budget tokens, etc.) for models that natively support it (like Anthropic/Gemini).
- **Mapping**: Maps `reasoning_content` (OpenAI-like) to `thinking` in the unified output.

### enhancetool.transformer.ts
- **Functionality**: Primarily focuses on parsing and accumulating tool arguments in streaming mode to ensure valid JSON.
- **Missing**: Currently lacks the `--help` or progressive disclosure patterns mentioned in the roadmap.

### cleancache.transformer.ts
- **Functionality**: Explicitly deletes `cache_control` from message content items to prevent passing them to providers that don't support them.

### anthropic.transformer.ts
- **Auth**: Handles switching between `Bearer` and `x-api-key`.
- **Content Mapping**: Handles `thinking` blocks and `cache_control` mapping from/to Anthropic's native format.

### gemini.transformer.ts
- **Auth**: Specifically sets `x-goog-api-key` and removes `Authorization` header to satisfy Gemini's specific requirements.
- **Endpoint**: Handles the model-specific URL structure.

### deepseek.transformer.ts
- **Functionality**: Normalizes `reasoning_content` to the `thinking` format in streams.
- **Constraints**: Enforces a max token limit of 8192 for DeepSeek.

### openrouter.transformer.ts
- **Functionality**: Manages `cache_control` specifically for Claude models on OpenRouter while stripping it for others.
- **Image URL**: Handles base64 data URI formatting for Claude models.

## Recommendations
- **Reasoning**: We can skip Step 4 (`reasoning-normalizer`) as `reasoning.transformer.ts` and `forcereasoning.transformer.ts` already cover the requirements.
- **Tool Mode**: Step 5 (`tool-mode`) should focus on *extending* the existing `tooluse` logic rather than starting from scratch, or simply ensuring our new features play nice with `ExitTool`.
- **Cache Control**: Step 2a (`cache-control`) should focus on *intelligent injection* (e.g., at the last user message or large tool results) rather than just cleaning, as cleaning is handled by `cleancache`.
- **Progressive Disclosure**: This should be implemented as an addition to `enhancetool.transformer.ts`.
