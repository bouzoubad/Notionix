#!/bin/sh
# Builds the Mac app (Apple Silicon + Intel) and puts it on the team's server,
# which offers it at /download/mac (link in the Keeper records and « Mon compte »).
# Usage, from the repository root on a Mac: sh scripts/publish-desktop.sh [ssh-host] [repo-on-host]
# Defaults: Gamma, notionix (the server's clone, in the home folder).
set -eu
cd "$(dirname "$0")/.."
host=${1:-Gamma}
repo=${2:-notionix}
version=$(node -p "require('./package.json').version")
file="dist/notionix-$version-universal.dmg"
rm -f "$file"
npm run build:mac
test -f "$file"
ssh "$host" "mkdir -p '$repo/server/downloads'"
scp "$file" "$host:$repo/server/downloads/"
# Only the latest is kept (disk space).
ssh "$host" "cd '$repo/server/downloads' && ls notionix-*.dmg | grep -vx 'notionix-$version-universal.dmg' | xargs rm -f"
echo "Publié : $(basename "$file") sur $host"
