#!/bin/sh
set -eu

mkdir -p "${DATA_DIR:-/data}" "${CONFIG_DIR:-/config}"

if [ ! -f "${CONFIG_FILE:-/config/config.json}" ]; then
  cp /app/config.example.json "${CONFIG_FILE:-/config/config.json}"
fi

if [ "${RUN_ON_START:-false}" = "true" ] || [ "${RUN_ON_START:-false}" = "1" ]; then
  node /app/collector.js || true
fi

if [ -n "${CRON_SCHEDULE:-}" ]; then
  echo "${CRON_SCHEDULE} node /app/collector.js >> /data/collector.log 2>&1" > /etc/crontabs/root
  crond -b -l 8
fi

exec node /app/server.js
