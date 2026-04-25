# Local Router Runbook

## 1. Initial setup

```bash
cd local-router
cp .env.example .env
nano .env
chmod +x scripts/*.sh
```

Fill at least one provider key in `.env`.

## 2. Start CCR

```bash
./scripts/start.sh
```

Check:

```bash
docker ps
curl http://127.0.0.1:3456/health
```

Open UI:

```text
http://127.0.0.1:3456/ui/
```

## 3. Run Claude Code through CCR

```bash
source .env
ANTHROPIC_BASE_URL=http://127.0.0.1:3456 \
ANTHROPIC_AUTH_TOKEN="$CCR_APIKEY" \
API_TIMEOUT_MS=${API_TIMEOUT_MS:-600000} \
claude
```

## 4. Switch model manually

```text
/model zai,glm-5-turbo
/model zai,glm-5.1
/model gemini,gemini-2.5-pro
/model ollama,qwen2.5-coder:latest
```

## 5. Restart after config changes

```bash
./scripts/restart.sh
```

## 6. View logs

```bash
./scripts/logs.sh
```

## 7. Stop

```bash
./scripts/stop.sh
```
