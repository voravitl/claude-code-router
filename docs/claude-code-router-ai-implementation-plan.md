# Implementation Plan: Claude Code Router + Docker + Multi-Provider Fallback

> เป้าหมายของเอกสารนี้: ใช้เป็นแผนให้ AI / Claude Code / Codex / OMC ทำงานต่อได้ทันที  
> โฟกัส: ลดปัญหา Anthropic limit โดยใช้ Claude Code Router (CCR) เป็น local router ผ่าน Docker  
> หลักการสำคัญ: ใช้ API key / local endpoint ที่ถูกต้อง ไม่ดึง OAuth/subscription token จาก CLI login มาปนแบบไม่เสถียร

---

## 1. Decision Summary

### เลือกทำ

```text
Claude Code บนเครื่อง user
  ↓
Claude Code Router (Docker, local only)
  ↓
Providers:
  - Z.AI / GLM = default / coding / think
  - Gemini API = long context / web search
  - Ollama = local fallback / background
  - OpenRouter / Anthropic API = optional
  - Codex CLI/MCP = worker แยก ไม่ใส่ใน CCR core
```

### ไม่เลือกทำ

```text
ไม่ดึง token จาก:
- Claude subscription login
- ChatGPT/Codex subscription login
- Gemini CLI login

มาแปลงเป็น API router หลัก
```

เหตุผล:
- เสี่ยงพังง่าย
- ไม่ใช่ flow หลักของ provider
- debug ยาก
- อาจชนเงื่อนไขการใช้งานของแต่ละ provider
- ไม่ตอบโจทย์ production/local stable setup

---

## 2. What Must Be True Before Starting

### Required

- Docker ใช้งานได้
- Docker Compose ใช้งานได้
- Claude Code ติดตั้งแล้ว
- Node/npm มีอยู่ ถ้าจะใช้ `ccr` CLI ฝั่ง host
- มีอย่างน้อย 1 provider ที่ใช้งานได้:
  - Ollama local หรือ
  - Z.AI API key หรือ
  - Gemini API key หรือ
  - OpenRouter API key

### Optional

- Codex CLI login ด้วย ChatGPT account
- OMC ใช้ต่อได้ แต่ไม่ให้ OMC ไปแก้ CCR config อัตโนมัติ
- LiteLLM ใช้ภายหลัง ถ้าต้องการ auto fallback หลังเจอ 429 แบบจริงจัง

---

## 3. Non-Goals

เอกสารนี้ไม่ทำสิ่งต่อไปนี้:

1. ไม่สร้างระบบ auto failover หลัง provider ตอบ 429 แบบสมบูรณ์ใน Phase แรก
2. ไม่ดึง OAuth token จาก Claude/Codex/Gemini CLI
3. ไม่ฝัง secret ลง git
4. ไม่เปิด CCR port ออก public network
5. ไม่ให้หลาย orchestrator คุมพร้อมกันแบบมั่ว เช่น OMC full + Ruflo full + CCR auto-hook ทั้งหมดพร้อมกัน

---

## 4. Architecture

```text
┌─────────────────────┐
│ Claude Code          │
│ run on host machine  │
└──────────┬──────────┘
           │ ANTHROPIC_BASE_URL=http://127.0.0.1:3456
           │ ANTHROPIC_AUTH_TOKEN=<local CCR key>
           ▼
┌────────────────────────────┐
│ Claude Code Router Docker   │
│ Port: 127.0.0.1:3456        │
│ Config: ~/.claude-code-router│
└───────┬─────────┬──────────┘
        │         │
        │         ├── Z.AI GLM API
        │         ├── Gemini API
        │         ├── Ollama on host
        │         └── OpenRouter / Anthropic API optional
        │
        └── Web UI: http://127.0.0.1:3456/ui/
```

---

## 5. Repository Layout To Create

ถ้าจะเก็บแผนนี้ไว้ใน Git repo ให้สร้างโครงประมาณนี้:

```text
ai-router/
├── README.md
├── docker-compose.yml
├── .env.example
├── .gitignore
├── config/
│   ├── config.json
│   └── custom-router.js
├── docs/
│   ├── runbook.md
│   ├── troubleshooting.md
│   └── validation-checklist.md
└── scripts/
    ├── start.sh
    ├── stop.sh
    ├── restart.sh
    ├── logs.sh
    └── test-health.sh
```

---

## 6. Files To Implement

## 6.1 `.gitignore`

```gitignore
.env
*.local
.DS_Store
logs/
*.log
secrets/
```

---

## 6.2 `.env.example`

```bash
# Local auth key for Claude Code -> CCR
CCR_APIKEY=change-me-local-router-secret

# Provider keys
ZAI_API_KEY=
GEMINI_API_KEY=
OPENROUTER_API_KEY=
ANTHROPIC_API_KEY=

# Optional
LOG_LEVEL=debug
```

> ห้าม commit `.env` จริง

---

## 6.3 `docker-compose.yml`

```yaml
services:
  claude-code-router:
    image: musistudio/claude-code-router:latest
    container_name: claude-code-router
    ports:
      - "127.0.0.1:3456:3456"
    volumes:
      # Mount both paths because CCR docs and Docker runtime paths can differ.
      # This reduces config/log path mismatch risk.
      - ./config:/app/.claude-code-router
      - ./config:/root/.claude-code-router
    environment:
      - HOST=0.0.0.0
      - PORT=3456
      - APIKEY=${CCR_APIKEY}
      - LOG=true
      - LOG_LEVEL=${LOG_LEVEL:-debug}
      - ZAI_API_KEY=${ZAI_API_KEY}
      - GEMINI_API_KEY=${GEMINI_API_KEY}
      - OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    extra_hosts:
      - "host.docker.internal:host-gateway"
    restart: unless-stopped
```

### Notes

- ใช้ `127.0.0.1:3456:3456` เพื่อไม่เปิดออก public network
- ใช้ `host.docker.internal` เพื่อให้ container เรียก Ollama ที่รันบน host ได้
- บน Linux ต้องมี `extra_hosts: host-gateway`
- บน macOS/Windows ใช้ `host.docker.internal` ได้ตามปกติ

---

## 6.4 `config/config.json`

เริ่มจาก config ที่ใช้งานได้จริงแบบไม่ซับซ้อน:

```json
{
  "HOST": "0.0.0.0",
  "PORT": 3456,
  "APIKEY": "$CCR_APIKEY",
  "LOG": true,
  "LOG_LEVEL": "debug",
  "API_TIMEOUT_MS": 600000,
  "Providers": [
    {
      "name": "zai",
      "api_base_url": "https://api.z.ai/api/anthropic",
      "api_key": "$ZAI_API_KEY",
      "models": ["glm-5.1", "glm-5-turbo", "glm-4.5-air"],
      "transformer": {
        "use": ["Anthropic"]
      }
    },
    {
      "name": "gemini",
      "api_base_url": "https://generativelanguage.googleapis.com/v1beta/models/",
      "api_key": "$GEMINI_API_KEY",
      "models": ["gemini-2.5-flash", "gemini-2.5-pro"],
      "transformer": {
        "use": ["gemini"]
      }
    },
    {
      "name": "ollama",
      "api_base_url": "http://host.docker.internal:11434/v1/chat/completions",
      "api_key": "ollama",
      "models": ["qwen2.5-coder:latest", "deepseek-coder:latest"]
    },
    {
      "name": "openrouter",
      "api_base_url": "https://openrouter.ai/api/v1/chat/completions",
      "api_key": "$OPENROUTER_API_KEY",
      "models": [
        "anthropic/claude-sonnet-4",
        "google/gemini-2.5-pro",
        "qwen/qwen3-coder"
      ],
      "transformer": {
        "use": ["openrouter"]
      }
    }
  ],
  "Router": {
    "default": "zai,glm-5-turbo",
    "think": "zai,glm-5.1",
    "background": "ollama,qwen2.5-coder:latest",
    "longContext": "gemini,gemini-2.5-pro",
    "longContextThreshold": 60000,
    "webSearch": "gemini,gemini-2.5-flash"
  },
  "CUSTOM_ROUTER_PATH": "/root/.claude-code-router/custom-router.js"
}
```

### Provider priority

1. `zai,glm-5-turbo` = default coding
2. `zai,glm-5.1` = think / plan / complex refactor
3. `ollama,qwen2.5-coder:latest` = background / cheap local
4. `gemini,gemini-2.5-pro` = long context
5. `openrouter,...` = optional fallback ถ้ามี credit

---

## 6.5 `config/custom-router.js`

```javascript
/**
 * Custom router for Claude Code Router.
 *
 * Goal:
 * - Route review/security tasks to stronger model
 * - Route background/summarize tasks to local model
 * - Route very long prompts to Gemini
 * - Otherwise use default Router config
 *
 * Important:
 * This router selects model BEFORE sending the request.
 * It is not an automatic retry/fallback after provider returns 429.
 */

module.exports = async function router(req, config) {
  const messages = req?.body?.messages || [];
  const text = JSON.stringify(messages).toLowerCase();

  // Long context hint
  if (text.length > 60000) {
    return "gemini,gemini-2.5-pro";
  }

  // Security / review tasks
  if (
    text.includes("security") ||
    text.includes("vulnerability") ||
    text.includes("review current git diff") ||
    text.includes("code review") ||
    text.includes("audit")
  ) {
    return "zai,glm-5.1";
  }

  // Background / cheap tasks
  if (
    text.includes("summarize") ||
    text.includes("summary") ||
    text.includes("format") ||
    text.includes("rename") ||
    text.includes("simple edit")
  ) {
    return "ollama,qwen2.5-coder:latest";
  }

  // Let normal Router config decide
  return null;
};
```

---

## 6.6 `scripts/start.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

docker compose up -d

echo "CCR started."
echo "Health:"
curl -fsS http://127.0.0.1:3456/health || true

echo
echo "Web UI:"
echo "http://127.0.0.1:3456/ui/"
```

---

## 6.7 `scripts/stop.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

docker compose down
echo "CCR stopped."
```

---

## 6.8 `scripts/restart.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

docker compose down
docker compose up -d
docker logs --tail=100 claude-code-router
```

---

## 6.9 `scripts/logs.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

docker logs -f claude-code-router
```

---

## 6.10 `scripts/test-health.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "Testing CCR health..."
curl -fsS http://127.0.0.1:3456/health
echo
echo "Testing UI endpoint..."
curl -fsS -I http://127.0.0.1:3456/ui/ | head
```

---

## 7. Host Setup Commands

### 7.1 Create project

```bash
mkdir -p ai-router/config ai-router/scripts ai-router/docs
cd ai-router
```

### 7.2 Create `.env`

```bash
cp .env.example .env
nano .env
```

Fill:

```bash
CCR_APIKEY=your-local-secret
ZAI_API_KEY=your-zai-key
GEMINI_API_KEY=your-gemini-key
OPENROUTER_API_KEY=
ANTHROPIC_API_KEY=
LOG_LEVEL=debug
```

### 7.3 Make scripts executable

```bash
chmod +x scripts/*.sh
```

### 7.4 Start

```bash
./scripts/start.sh
```

---

## 8. Claude Code Usage

### Temporary shell session

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:3456"
export ANTHROPIC_AUTH_TOKEN="your-local-secret"
export API_TIMEOUT_MS=600000
claude
```

### Alias

```bash
alias claude-ccr='ANTHROPIC_BASE_URL=http://127.0.0.1:3456 ANTHROPIC_AUTH_TOKEN=your-local-secret API_TIMEOUT_MS=600000 claude'
```

Usage:

```bash
claude-ccr
```

### Dynamic model switch inside Claude Code

```text
/model zai,glm-5-turbo
/model zai,glm-5.1
/model gemini,gemini-2.5-pro
/model ollama,qwen2.5-coder:latest
/model openrouter,google/gemini-2.5-pro
```

---

## 9. Ollama Setup

### Host install/check

```bash
ollama serve
ollama pull qwen2.5-coder:latest
ollama list
```

### Test from host

```bash
curl http://127.0.0.1:11434/api/tags
```

### Test from CCR container

```bash
docker exec -it claude-code-router sh
curl http://host.docker.internal:11434/api/tags
exit
```

If this fails on Linux, ensure compose has:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

---

## 10. Codex Integration Plan

Codex should not be inside CCR core at first.

### Install

```bash
npm i -g @openai/codex
codex login
```

Choose ChatGPT login if using subscription.

### Use as CLI worker

```bash
codex exec --cd . "review current git diff and write findings to codex-review.md"
```

### Optional MCP

```bash
claude mcp add --transport stdio --scope user codex -- codex mcp-server
```

### Rule

Use Codex for:

- code review
- diff analysis
- refactor suggestion
- test generation
- security check

Do not use Codex as primary CCR provider unless a stable API/proxy path is implemented later.

---

## 11. Manual Fallback Runbook

### Scenario: Z.AI limit / unstable

Inside Claude Code:

```text
/model gemini,gemini-2.5-pro
```

or:

```text
/model ollama,qwen2.5-coder:latest
```

### Scenario: Gemini quota issue

```text
/model zai,glm-5-turbo
```

### Scenario: Need local only

```text
/model ollama,qwen2.5-coder:latest
```

### Scenario: Need very strong review

```text
/model zai,glm-5.1
```

or use Codex CLI:

```bash
codex exec --cd . "review current git diff for bugs and security issues"
```

---

## 12. Why Not Claim Auto Fallback 100%

CCR supports routing and model switching, but this plan does not depend on CCR automatically retrying another provider after a 429.

### Confirmed supported pattern

```text
Request comes in
↓
Router selects model/provider
↓
CCR sends to selected provider
```

### Not assumed in Phase 1

```text
Provider A returns 429
↓
CCR automatically retries Provider B
↓
Then Provider C
```

If true auto fallback is required, implement Phase 2 with LiteLLM or a custom retry proxy.

---

## 13. Phase 2: Optional LiteLLM Auto Fallback

Only implement this if manual `/model` fallback is not enough.

### Target architecture

```text
Claude Code
  ↓
CCR
  ↓
LiteLLM fallback group
  ↓
Z.AI / Gemini / OpenRouter / Ollama
```

or replace CCR:

```text
Claude Code
  ↓
LiteLLM Anthropic-compatible endpoint
  ↓
fallback rules
```

### Acceptance criteria

- If primary returns 429/5xx, retry secondary
- Logs show provider switch
- No duplicate destructive tool calls
- Max retry count enforced
- Timeout enforced

---

## 14. Validation Checklist

### Docker

- [ ] `docker ps` shows `claude-code-router`
- [ ] `curl http://127.0.0.1:3456/health` works
- [ ] `http://127.0.0.1:3456/ui/` opens
- [ ] `docker logs claude-code-router` has no config parse error

### Config

- [ ] `.env` exists and is not committed
- [ ] `config/config.json` exists
- [ ] `custom-router.js` exists
- [ ] API keys use env variables, not hardcoded secrets

### Claude Code

- [ ] `claude-ccr` opens Claude Code
- [ ] `/model zai,glm-5-turbo` accepted
- [ ] `/model gemini,gemini-2.5-pro` accepted
- [ ] `/model ollama,qwen2.5-coder:latest` accepted

### Providers

- [ ] Z.AI responds
- [ ] Gemini responds
- [ ] Ollama responds from host
- [ ] Ollama responds from CCR container via `host.docker.internal`

### Safety

- [ ] Port is bound to `127.0.0.1`
- [ ] APIKEY set
- [ ] Secrets not in git
- [ ] Logs do not expose full API keys

---

## 15. Troubleshooting

### Problem: Claude Code still uses Anthropic directly

Check:

```bash
echo $ANTHROPIC_BASE_URL
echo $ANTHROPIC_AUTH_TOKEN
```

Expected:

```bash
http://127.0.0.1:3456
your-local-secret
```

### Problem: CCR container starts but config not loaded

Check mounted paths:

```bash
docker exec -it claude-code-router sh
ls -la /app/.claude-code-router
ls -la /root/.claude-code-router
cat /root/.claude-code-router/config.json
```

### Problem: Ollama fails from Docker

Check:

```bash
docker exec -it claude-code-router sh
curl http://host.docker.internal:11434/api/tags
```

On Linux, add:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

### Problem: Provider says unauthorized

Check:
- `.env` value
- API key scope
- billing/plan active
- model name correct
- provider endpoint correct

### Problem: `/model` not working

Check:
- CCR is running
- Claude Code launched with CCR env
- model exists in `config.json`
- provider name matches exactly

---

## 16. AI Implementation Prompt

Copy this prompt into Claude Code / Codex / OMC:

```text
You are implementing a local Claude Code Router setup.

Goal:
Create a Docker-based CCR project that lets Claude Code route requests to Z.AI, Gemini API, and Ollama, with Codex kept separate as CLI/MCP worker.

Constraints:
- Do not hardcode secrets.
- Do not commit .env.
- Bind CCR only to 127.0.0.1.
- Use Docker Compose.
- Mount config to both /app/.claude-code-router and /root/.claude-code-router.
- Use host.docker.internal for Ollama from Docker.
- Do not implement OAuth token scraping.
- Do not claim automatic 429 fallback unless explicitly implemented and tested.
- Provide scripts for start/stop/restart/logs/health.
- Provide validation checklist and troubleshooting docs.

Files to create:
- README.md
- docker-compose.yml
- .env.example
- .gitignore
- config/config.json
- config/custom-router.js
- scripts/start.sh
- scripts/stop.sh
- scripts/restart.sh
- scripts/logs.sh
- scripts/test-health.sh
- docs/runbook.md
- docs/troubleshooting.md
- docs/validation-checklist.md

Implementation steps:
1. Create project structure.
2. Add Docker Compose for musistudio/claude-code-router:latest.
3. Add config with providers: zai, gemini, ollama, openrouter optional.
4. Add custom router.
5. Add scripts.
6. Add docs.
7. Run docker compose up -d.
8. Validate /health and /ui/.
9. Validate Claude Code with ANTHROPIC_BASE_URL=http://127.0.0.1:3456.
10. Validate manual /model switching.

Acceptance criteria:
- CCR starts in Docker.
- Health endpoint works.
- Web UI works.
- Claude Code can use CCR via ANTHROPIC_BASE_URL.
- Manual model switching works.
- Ollama works from Docker container.
- No secrets committed.
```

---

## 17. Final Recommendation

Start simple:

```text
Phase 1:
CCR Docker + Z.AI + Ollama

Phase 2:
Add Gemini API

Phase 3:
Add Codex CLI/MCP as worker

Phase 4:
If manual fallback is painful, add LiteLLM/custom retry proxy
```

Do not start with too many moving parts.

The first stable target is:

```text
Claude Code → CCR Docker → Z.AI default
Claude Code → CCR Docker → Ollama fallback via /model
```

Only after that is stable, add Gemini and Codex.
