#!/usr/bin/env bash
# Generates a localhost TLS cert/key for `mastodon_mock serve --ssl-*`.
# Idempotent: skips generation if both files already exist.
#
# Prefers mkcert (https://github.com/FiloSottile/mkcert) when available: it issues
# a cert signed by a local CA that mkcert installs into the OS/browser trust stores,
# so Electron-based clients (Whalebird, Fedistar) accept it without warnings — plain
# openssl self-signed certs are routinely rejected outright by those clients even
# when a browser allows clicking through. Falls back to openssl otherwise.
#
# An optional second argument adds an extra hostname to the cert's SAN list (e.g.
# "mock.local") — useful for clients that reject bare IPs/localhost outright, or that
# strip non-standard ports from a typed domain. Map that hostname to 127.0.0.1 in your
# hosts file separately; this script only issues the cert, it doesn't touch DNS/hosts.

set -eu

CERT_DIR="${1:-.dev_certs}"
EXTRA_DOMAIN="${2:-}"
KEY_FILE="$CERT_DIR/localhost-key.pem"
CERT_FILE="$CERT_DIR/localhost-cert.pem"

if [ -f "$KEY_FILE" ] && [ -f "$CERT_FILE" ]; then
    if [ -z "$EXTRA_DOMAIN" ] || openssl x509 -in "$CERT_FILE" -noout -text 2>/dev/null | grep -q "DNS:$EXTRA_DOMAIN\b"; then
        echo "Dev cert already exists and covers what was requested: $KEY_FILE, $CERT_FILE"
        exit 0
    fi
    echo "Existing cert doesn't cover $EXTRA_DOMAIN — regenerating."
fi

mkdir -p "$CERT_DIR"

if command -v mkcert > /dev/null 2>&1; then
    mkcert -install
    mkcert -key-file "$KEY_FILE" -cert-file "$CERT_FILE" localhost 127.0.0.1 ::1 ${EXTRA_DOMAIN:+"$EXTRA_DOMAIN"}
    echo "Generated $KEY_FILE and $CERT_FILE (mkcert, locally trusted)"
else
    echo "mkcert not found; falling back to an openssl self-signed cert."
    echo "Electron clients (Whalebird, Fedistar) may refuse a self-signed cert outright."
    echo "Install mkcert for a locally-trusted cert: https://github.com/FiloSottile/mkcert"

    SAN="DNS:localhost,IP:127.0.0.1,IP:::1"
    if [ -n "$EXTRA_DOMAIN" ]; then
        SAN="$SAN,DNS:$EXTRA_DOMAIN"
    fi

    # MSYS_NO_PATHCONV avoids Git Bash on Windows mangling the leading "/" in -subj
    # into a filesystem path (e.g. "/CN=localhost" -> "C:/Program Files/Git/CN=localhost").
    MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 \
        -keyout "$KEY_FILE" \
        -out "$CERT_FILE" \
        -days 365 -nodes \
        -subj "/CN=localhost" \
        -addext "subjectAltName=$SAN"

    echo "Generated $KEY_FILE and $CERT_FILE (openssl, self-signed)"
fi
