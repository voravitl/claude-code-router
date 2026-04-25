#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "ERROR: .env not found. Copy .env.example to .env and fill provider keys first."
  exit 1
fi

docker compose up -d

echo "CCR started."
echo "Health:"
curl -fsS http://127.0.0.1:3456/health || true

echo
echo "Web UI: http://127.0.0.1:3456/ui/"
echo "Run Claude Code through CCR with:"
echo "  source .env && ANTHROPIC_BASE_URL=http://127.0.0.1:3456 ANTHROPIC_AUTH_TOKEN=\"$CCR_APIKEY\" API_TIMEOUT_MS=${API_TIMEOUT_MS:-600000} claude"
