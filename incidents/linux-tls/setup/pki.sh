#!/bin/bash
# Выпуск сертификатов стенда относительно текущей даты: корневой и промежуточный CA компании, старый
# сертификат витрины (истёк вчера) и новые сертификаты витрины и API (продлены ночью на 90 дней).
# Ключи CA после выпуска уничтожаются: выпустить себе сертификат «в обход» нельзя.
set -euo pipefail
OUT=$1
PKI=$(mktemp -d)
cd "$PKI"
mkdir newcerts && touch index.txt && echo 1000 > serial
cat > ca.cnf <<'CNF'
[ ca ]
default_ca = CA_default
[ CA_default ]
dir = .
database = ./index.txt
new_certs_dir = ./newcerts
serial = ./serial
default_md = sha256
policy = policy_any
unique_subject = no
copy_extensions = none
email_in_dn = no
[ policy_any ]
commonName = supplied
organizationName = optional
CNF
ts() { date -u -d "$1" +%y%m%d%H%M%SZ; }
leaf() { # имя файла, CN, SAN, начало, конец, ключ
  printf '[v3]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=%s\n' "$3" > "$1.ext"
  openssl req -new -key "$6" -subj "/O=Shop Example/CN=$2" -out "$1.csr" 2>/dev/null
  openssl ca -config ca.cnf -batch -notext -cert int.pem -keyfile int.key -startdate "$4" -enddate "$5" \
    -extfile "$1.ext" -extensions v3 -in "$1.csr" -out "$1.pem" 2>/dev/null
}
openssl req -x509 -newkey rsa:2048 -nodes -keyout root.key -out root.pem -days 3650 -subj "/O=Shop Example/CN=Shop Example Root CA" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -keyout int.key -out int.csr -subj "/O=Shop Example/CN=Shop Example Issuing CA 1" 2>/dev/null
printf 'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n' > int.ext
openssl x509 -req -in int.csr -CA root.pem -CAkey root.key -CAcreateserial -out int.pem -days 1825 -extfile int.ext 2>/dev/null
for k in shop-old shop-new api-new; do openssl genrsa -out "$k.key" 2048 2>/dev/null; done
leaf shop-old shop.example.test "DNS:shop.example.test,DNS:www.shop.example.test" "$(ts '-91 days')" "$(ts '-1 day')" shop-old.key
leaf shop-new shop.example.test "DNS:shop.example.test,DNS:www.shop.example.test" "$(ts '-6 hours')" "$(ts '+90 days')" shop-new.key
leaf api-new api.shop.example.test "DNS:api.shop.example.test" "$(ts '-6 hours')" "$(ts '+90 days')" api-new.key
install -d -m 755 "$OUT/ca" "$OUT/old" "$OUT/shop.example.test" "$OUT/api.shop.example.test"
install -m 644 root.pem "$OUT/ca/root.pem"
# старый сертификат был в порядке (с промежуточным CA), просто истёк
cat shop-old.pem int.pem > "$OUT/old/shop.crt" && chmod 644 "$OUT/old/shop.crt" && install -m 600 shop-old.key "$OUT/old/shop.key"
for name in shop api; do
  dir="$OUT/$([ $name = shop ] && echo shop.example.test || echo api.shop.example.test)"
  install -m 644 "$name-new.pem" "$dir/cert.pem"
  install -m 644 int.pem "$dir/chain.pem"
  cat "$name-new.pem" int.pem > "$dir/fullchain.pem" && chmod 644 "$dir/fullchain.pem"
  install -m 600 "$name-new.key" "$dir/privkey.pem"
done
date -u -d '+90 days' '+%Y-%m-%d' > "$OUT/renewed-until"
cd / && shred -u "$PKI"/*.key 2>/dev/null || true
rm -rf "$PKI"
