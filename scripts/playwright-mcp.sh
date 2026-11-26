#!/bin/sh
# Playwright MCP: a browser for design reviews (screenshots, accessibility snapshots).
# Pinned release, checked on 2026-11-26: published by Microsoft with registry signatures and
# build provenance from microsoft/playwright-mcp, no install scripts, npm audit clean.
# Before raising the version, check the same things again.
#
# Locked down: stdio only (no port is opened), an in-memory browser profile (no saved logins),
# file access limited to this repository (the server's default), and tools that a web page
# registers through WebMCP are ignored, so a site can't hand the agent new tools.
set -eu
flags="--headless --isolated --no-webmcp"
# Cloud sessions ship their own Chromium here.
if [ -x /opt/pw-browsers/chromium ]; then flags="$flags --executable-path /opt/pw-browsers/chromium"; fi
# Chromium can't sandbox itself when run as root (cloud containers); everywhere else it stays on.
if [ "$(id -u)" = 0 ]; then flags="$flags --no-sandbox"; fi
# shellcheck disable=SC2086
exec npx -y @playwright/mcp@0.0.85 $flags
