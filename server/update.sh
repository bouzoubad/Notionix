#!/bin/sh
# Deploys the latest version from GitHub: data (volume) and accounts are kept.
# Usage, from the repository root on the server: sh server/update.sh
set -eu
cd "$(dirname "$0")/.."
git pull --ff-only
docker compose -f server/docker-compose.yml up -d --build
docker image prune -f >/dev/null
sleep 3
curl -fsS http://127.0.0.1:8080/api/health && echo
