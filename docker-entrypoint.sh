#!/bin/sh
set -eu

DB_PATH="${DATABASE_PATH:-/app/data/teamcal.sqlite}"
DATA_DIR="$(dirname "$DB_PATH")"

mkdir -p "$DATA_DIR"
chown -R node:node "$DATA_DIR"

exec gosu node "$@"
