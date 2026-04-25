# Local Claude Code Router Runtime

ชุดนี้เอาไว้รัน Claude Code Router (CCR) ผ่าน Docker บนเครื่องตัวเอง เพื่อให้ Claude Code route ไปหลาย provider ได้ โดยใช้ API key หรือ local endpoint ที่ตั้งค่าไว้อย่างชัดเจน

## Architecture

```text
Claude Code on host
  -> http://127.0.0.1:3456
  -> CCR Docker container
  -> Z.AI / Gemini API / Ollama / OpenRouter / Anthropic API
```

## Files

```text
local-router/
├── docker-compose.yml
├── .env.example
├── config/
│   ├── config.json
│   └── custom-router.js
└── scripts/
    ├── start.sh
    ├── stop.sh
    ├── restart.sh
    ├── logs.sh
    └── test-health.sh
```

## Quick Start

```bash
cd local-router
cp .env.example .env
nano .env
chmod +x scripts/*.sh
./scripts/start.sh
```

Open UI:

```text
http://127.0.0.1:3456/ui/
```

## Run Claude Code through CCR

```bash
cd local-router
source .env
ANTHROPIC_BASE_URL=http://127.0.0.1:3456 \
ANTHROPIC_AUTH_TOKEN="$CCR_APIKEY" \
API_TIMEOUT_MS=${API_TIMEOUT_MS:-600000} \
claude
```

Optional alias:

```bash
alias claude-ccr='cd /path/to/claude-code-router/local-router && source .env && ANTHROPIC_BASE_URL=http://127.0.0.1:3456 ANTHROPIC_AUTH_TOKEN="$CCR_APIKEY" API_TIMEOUT_MS=${API_TIMEOUT_MS:-600000} claude'
```

## Model switching inside Claude Code

```text
/model zai/glm-5-turbo
/model zai/glm-5.1
/model gemini/gemini-2.5-pro
/model ollama/qwen2.5-coder:latest
/model openrouter/google/gemini-2.5-pro
```

## Ollama

Run Ollama on host:

```bash
ollama serve
ollama pull qwen2.5-coder:latest
```

CCR container reaches host Ollama through:

```text
http://host.docker.internal:11434
```

On Linux, `docker-compose.yml` includes:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

## Important Limitations

- This setup uses explicit API keys or local endpoints only.
- This setup does not guarantee automatic retry to another provider after 429/limit errors.
- Use `/model` for manual fallback first.
- If real automatic 429 fallback is required, add LiteLLM or a dedicated retry proxy later.

## Safety

- Port is bound to `127.0.0.1` only.
- `.env` is ignored by git.
- Do not commit real API keys.
