#!/bin/sh
# Runs test/integration.ts inside a fresh, isolated VS Code instance.
set -e
cd "$(dirname "$0")/.."
CODE="${VSCODE_BIN:-/Applications/Visual Studio Code.app/Contents/MacOS/Code}"
TMP="$(mktemp -d)"
mkdir -p "$TMP/workspace"
npm run build --silent
npx esbuild test/integration.ts --bundle --platform=node --format=cjs --target=node20 --external:vscode --outfile=dist-test/integration.js --log-level=warning
"$CODE" --user-data-dir="$TMP/user" --extensions-dir="$TMP/extensions" \
  --disable-workspace-trust --skip-welcome --skip-release-notes \
  --extensionDevelopmentPath="$PWD" --extensionTestsPath="$PWD/dist-test/integration.js" \
  "$TMP/workspace"
