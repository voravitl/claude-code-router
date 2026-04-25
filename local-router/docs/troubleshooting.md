# Local Router Troubleshooting

## Claude Code still uses Anthropic directly

Check your shell variables:

```bash
echo $ANTHROPIC_BASE_URL
echo $ANTHROPIC_AUTH_TOKEN
```

Expected:

```text
http://127.0.0.1:3456
<your CCR_APIKEY value>
```

Start Claude Code from the same shell where these variables are set.

---

## CCR container starts but config is not loaded

Check mounted paths:

```bash
docker exec -it claude-code-router sh
ls -la /app/.claude-code-router
ls -la /root/.claude-code-router
cat /root/.claude-code-router/config.json
exit
```

If config is missing, verify you started Docker Compose from `local-router/`.

---

## API key / unauthorized error

Check:

- `.env` exists in `local-router/`
- Provider key is filled
- Provider billing or subscription plan is active
- Model name in `config/config.json` is correct
- Endpoint URL is correct

Never commit real keys.

---

## Ollama is not reachable from CCR container

Check host Ollama:

```bash
curl http://127.0.0.1:11434/api/tags
```

Check from container:

```bash
docker exec claude-code-router sh -lc 'curl -fsS http://host.docker.internal:11434/api/tags'
```

If Linux fails, verify `docker-compose.yml` contains:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

---

## `/model` does not work

Check:

- CCR is running
- Claude Code launched with `ANTHROPIC_BASE_URL=http://127.0.0.1:3456`
- Provider name and model name exactly match `config/config.json`
- CCR was restarted after config changes

Restart:

```bash
./scripts/restart.sh
```

---

## Limit or 429 from a provider

This setup does not depend on automatic retry after a provider returns a limit error.

Use manual fallback inside Claude Code:

```text
/model gemini,gemini-2.5-pro
/model ollama,qwen2.5-coder:latest
/model zai,glm-5-turbo
```

If automatic retry after provider errors is required, add LiteLLM or a dedicated retry layer later.
