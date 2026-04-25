# Local Router Validation Checklist

## Docker runtime

- [ ] `docker compose up -d` completes from `local-router/`
- [ ] `docker ps` shows `claude-code-router`
- [ ] `curl http://127.0.0.1:3456/health` returns success
- [ ] `http://127.0.0.1:3456/ui/` opens in browser
- [ ] `docker logs claude-code-router` has no config parse error

## Secrets and config

- [ ] `.env` exists locally
- [ ] `.env` is not committed
- [ ] `CCR_APIKEY` is changed from default
- [ ] Provider API keys are present only in `.env` or host secret storage
- [ ] `config/config.json` has no real secrets

## Claude Code integration

- [ ] Start Claude Code with `ANTHROPIC_BASE_URL=http://127.0.0.1:3456`
- [ ] Start Claude Code with `ANTHROPIC_AUTH_TOKEN` equal to `CCR_APIKEY`
- [ ] `/model zai/glm-5-turbo` is accepted if Z.AI key is configured
- [ ] `/model gemini/gemini-2.5-pro` is accepted if Gemini key is configured
- [ ] `/model ollama/qwen2.5-coder:latest` is accepted if Ollama is running

## Provider validation

- [ ] Z.AI request succeeds
- [ ] Gemini request succeeds
- [ ] Ollama request succeeds from host
- [ ] Ollama request succeeds from CCR container via `host.docker.internal`
- [ ] Optional OpenRouter request succeeds if key is configured

## Fallback behavior

- [ ] Manual `/model` fallback works
- [ ] Team agrees this setup does not claim automatic 429 retry
- [ ] If automatic retry is required, create a separate LiteLLM/custom proxy task

## Safety

- [ ] CCR port is bound to `127.0.0.1`
- [ ] Docker Compose does not expose `3456` publicly
- [ ] Logs do not print full API keys
- [ ] No real secrets are present in git history
