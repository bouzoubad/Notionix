#!/bin/sh
# Deploys the latest version from GitHub: data (volume) and accounts are kept.
# Usage, from the repository root on the server: sh server/update.sh
set -eu
cd "$(dirname "$0")/.."
git pull --ff-only
docker compose -f server/docker-compose.yml up -d --build
docker image prune -f >/dev/null
# The server needs a few seconds to start.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:8080/api/health; then echo; exit 0; fi
  sleep 2
done
echo "Notionix ne répond pas : docker compose -f server/docker-compose.yml logs --tail 30" >&2
exit 1
