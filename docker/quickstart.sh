#!/bin/sh
# Starts an AIKI node from the prebuilt Docker Hub image.
#
#   curl -fsSL https://raw.githubusercontent.com/opnwiki/aiki/main/docker/quickstart.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/opnwiki/aiki/main/docker/quickstart.sh | sh -s -- https://wiki.example.org
#
# Creates ./aiki with compose.yaml and a .env holding fresh random secrets,
# then runs `docker compose up -d`. An existing .env is never overwritten.
set -eu

SITE_URL="${1:-${SITE_URL:-http://localhost:3000}}"
DIR="${AIKI_DIR:-aiki}"
REF="${AIKI_REF:-main}"
RAW="https://raw.githubusercontent.com/opnwiki/aiki/$REF"

command -v docker >/dev/null 2>&1 || { echo "Docker is required: https://docs.docker.com/get-docker/" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required." >&2; exit 1; }

secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32
  else od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

mkdir -p "$DIR"
cd "$DIR"

curl -fsSL "$RAW/compose.registry.yaml" -o compose.yaml

if [ -f .env ]; then
  echo "Keeping the existing $DIR/.env."
else
  host=$(printf '%s' "$SITE_URL" | sed -e 's#^[a-z]*://##' -e 's#[/:].*$##')
  password=$(secret)
  curl -fsSL "$RAW/.env.example" | awk -v password="$password" -v rate="$(secret)" -v read="$(secret)" \
    -v site="$SITE_URL" -v host="$host" '
    /^POSTGRES_PASSWORD=/ { print "POSTGRES_PASSWORD=" password; next }
    /^DATABASE_URL=/ { print "DATABASE_URL=postgres://aiki:" password "@localhost:5432/aiki"; next }
    /^RATE_LIMIT_SECRET=/ { print "RATE_LIMIT_SECRET=" rate; next }
    /^READ_HMAC_SECRET=/ { print "READ_HMAC_SECRET=" read; next }
    /^SITE_URL=/ { print "SITE_URL=" site; next }
    /^NODE_DOMAIN=/ { print "NODE_DOMAIN=" host; next }
    /^AIKI_TRUSTED_PROXIES=/ { print "AIKI_TRUSTED_PROXIES=172.16.0.0/12"; next }
    { print }' > .env
  chmod 600 .env
  echo "Created $DIR/.env with fresh random secrets. Keep it private."
fi

docker compose pull
docker compose up -d

echo
echo "AIKI is starting on http://127.0.0.1:${AIKI_HOST_PORT:-3000} (check: docker compose ps)."
echo "Open it and register: the first account becomes the node owner."
echo "For a public domain, put a TLS reverse proxy in front: https://github.com/opnwiki/aiki/blob/main/docs/self-hosting.md"
