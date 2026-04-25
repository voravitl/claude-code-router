#!/usr/bin/env bash
set -euo pipefail

echo "Testing CCR health..."
curl -fsS http://127.0.0.1:3456/health

echo
echo "Testing CCR UI endpoint..."
curl -fsS -I http://127.0.0.1:3456/ui/ | head

echo
echo "Testing Ollama from CCR container, if Ollama is enabled on host..."
docker exec claude-code-router sh -lc 'curl -fsS http://host.docker.internal:11434/api/tags >/dev/null && echo "Ollama reachable" || echo "Ollama not reachable or not running"'
