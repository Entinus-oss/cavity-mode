#!/bin/bash
# Builds two single-file pages from src/:
#   index.html    - standalone page (open directly or host anywhere, e.g. GitHub Pages)
#   artifact.html - same content without the document skeleton, for publishing as a claude.ai artifact
set -e
cd "$(dirname "$0")"
{ cat src/head.html; echo '<script>'; cat src/physics.js; echo '</script>'; echo '<script>'; cat src/app.js; echo '</script>'; } > artifact.html
{ echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'; sed '/claude:viewport-fit-sides/d' artifact.html | sed 's|</style>|</style></head><body>|'; echo '</body></html>'; } > index.html
wc -c index.html artifact.html
