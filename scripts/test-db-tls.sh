#!/bin/sh
set -eu
task_tls_dir=$(mktemp -d)
task_tls_port=${TEST_DB_TLS_PORT:-55433}
cleanup() {
  pg_ctl -D "$task_tls_dir/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$task_tls_dir"
}
trap cleanup EXIT INT TERM
mkdir "$task_tls_dir/socket"
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$task_tls_dir/server.key" -out "$task_tls_dir/server.crt" -days 1 -subj /CN=localhost -addext subjectAltName=DNS:localhost >/dev/null 2>&1
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$task_tls_dir/wrong.key" -out "$task_tls_dir/wrong.crt" -days 1 -subj /CN=wrong.invalid >/dev/null 2>&1
chmod 600 "$task_tls_dir/server.key"
printf '%s\n' synthetic-tls-only > "$task_tls_dir/password"
initdb -D "$task_tls_dir/data" -U phase1_tls --auth-local=trust --auth-host=scram-sha-256 --pwfile="$task_tls_dir/password" >/dev/null
printf "\nssl=on\nssl_cert_file='%s/server.crt'\nssl_key_file='%s/server.key'\n" "$task_tls_dir" "$task_tls_dir" >> "$task_tls_dir/data/postgresql.conf"
pg_ctl -D "$task_tls_dir/data" -l "$task_tls_dir/postgres.log" -o "-k $task_tls_dir/socket -h 127.0.0.1 -p $task_tls_port" -w start >/dev/null
createdb -h "$task_tls_dir/socket" -p "$task_tls_port" -U phase1_tls tls_test
TEST_DB_TLS_CA="$task_tls_dir/server.crt" TEST_DB_TLS_WRONG_CA="$task_tls_dir/wrong.crt" TEST_DB_TLS_PORT="$task_tls_port" node scripts/run-local-tests.cjs --test backend/tests/tls/database.test.js
