#!/bin/sh
# Test certificates shaped like Caddy's internal authority (root -> intermediate -> leaf
# for 127.0.0.1, no subject), plus an unrelated root. Only the certificates and the
# leaf's key are kept: run again to make new ones.
set -eu
cd "$(dirname "$0")"
tmp=$(mktemp -d)
ec() { openssl ecparam -name prime256v1 -genkey -noout -out "$1"; }
ec "$tmp/root.key"; ec "$tmp/other.key"; ec "$tmp/inter.key"; ec leaf.key
openssl req -x509 -new -key "$tmp/root.key" -subj "/CN=Notionix Test Root" -days 36500 \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" -out root.crt
openssl req -x509 -new -key "$tmp/other.key" -subj "/CN=Notionix Test Root" -days 36500 \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" -out other-root.crt
openssl req -new -key "$tmp/inter.key" -subj "/CN=Notionix Test Intermediate" -out "$tmp/inter.csr"
printf 'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n' > "$tmp/inter.ext"
openssl x509 -req -in "$tmp/inter.csr" -CA root.crt -CAkey "$tmp/root.key" -CAcreateserial \
  -days 36500 -extfile "$tmp/inter.ext" -out intermediate.crt
openssl req -new -key leaf.key -subj "/" -out "$tmp/leaf.csr"
printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1,DNS:localhost\n' > "$tmp/leaf.ext"
openssl x509 -req -in "$tmp/leaf.csr" -CA intermediate.crt -CAkey "$tmp/inter.key" -CAcreateserial \
  -days 36500 -extfile "$tmp/leaf.ext" -out leaf.crt
rm -rf "$tmp" ./*.srl
