#!/usr/bin/env bash
# Run Chess Coach on THIS computer and get a private https URL you can open from any device, anywhere.
# Needs one of: cloudflared (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
#               or tailscale (private to your devices: `tailscale serve --bg 3000`).
# The URL is protected by a password (generated once, stored in .share-password).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d node_modules ] || npm install
if [ -z "${APP_PASSWORD:-}" ]; then
  [ -f .share-password ] || (umask 077; head -c 18 /dev/urandom | base64 | tr -d '/+=' > .share-password)
  APP_PASSWORD="$(cat .share-password)"
fi
export APP_PASSWORD PORT="${PORT:-3000}" HOST=127.0.0.1
export ALLOWED_USERS="${ALLOWED_USERS:-becominglegendary}" DEFAULT_USER="${DEFAULT_USER:-becominglegendary}"
node server.js & SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1
echo
echo "  Password for the site: $APP_PASSWORD   (any username)"
echo
if command -v tailscale >/dev/null && [ "${USE_TAILSCALE:-}" = 1 ]; then
  tailscale serve --bg "$PORT"; tailscale serve status; wait $SERVER
elif command -v cloudflared >/dev/null; then
  cloudflared tunnel --url "http://127.0.0.1:$PORT"
else
  echo "Install cloudflared (or tailscale) to get a public URL. The app is running locally at http://127.0.0.1:$PORT"; wait $SERVER
fi
