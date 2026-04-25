#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
docker compose down
docker compose up -d
docker logs --tail=100 claude-code-router
