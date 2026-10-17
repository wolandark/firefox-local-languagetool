#!/usr/bin/env bash

set -euo pipefail

DOWNLOADS="$HOME/Downloads"
SERVER_JAR="$(find "$DOWNLOADS" -maxdepth 2 -type f \
  -path "$DOWNLOADS/LanguageTool-*/languagetool-server.jar" -print \
  | sort -V | tail -n 1)"

if [[ -z "$SERVER_JAR" || ! -f "$SERVER_JAR" ]]; then
  echo "Could not find languagetool-server.jar under $DOWNLOADS/LanguageTool-*." >&2
  exit 1
fi

echo "Starting LanguageTool from $SERVER_JAR on http://127.0.0.1:8081"
exec java -cp "$SERVER_JAR" org.languagetool.server.HTTPServer --port 8081
