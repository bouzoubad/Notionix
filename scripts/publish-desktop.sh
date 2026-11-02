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
zip="dist/notionix-$version-universal-mac.zip"
rm -f "$file" "$zip" dist/latest-mac.yml
npm run build:mac
test -f "$file" && test -f "$zip" && test -f dist/latest-mac.yml
ssh "$host" "mkdir -p '$repo/server/downloads'"
# The feed last: an app never sees a version whose zip is not there yet.
scp "$file" "$zip" "$host:$repo/server/downloads/"
scp dist/latest-mac.yml "$host:$repo/server/downloads/"
# Only the latest is kept (disk space).
ssh "$host" "cd '$repo/server/downloads' && ls notionix-* | grep -vx -e 'notionix-$version-universal.dmg' -e 'notionix-$version-universal-mac.zip' | xargs rm -f"
echo "Publié : $(basename "$file") et la mise à jour automatique sur $host"
