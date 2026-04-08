#!/usr/bin/env bash
# Vérifs rapides avant push / Vercel
set -euo pipefail
cd "$(dirname "$0")/.."
node --check server.js
echo "✓ server.js OK — lance ensuite : git add -A && git commit -m \"…\" && git push origin main"
