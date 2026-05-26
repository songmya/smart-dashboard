FROM node:22-alpine

RUN apk add --no-cache smartmontools tzdata

WORKDIR /app
COPY package.json ./
COPY server.js collector.js entrypoint.sh config.example.json ./
COPY public ./public

RUN chmod +x /app/collector.js /app/server.js /app/entrypoint.sh

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATA_DIR=/data \
    CONFIG_FILE=/config/config.json \
    CSV_FILE=/data/disk-health-history.csv \
    CHECK_COMMAND="node /app/collector.js" \
    DASHBOARD_TITLE="SMART 硬盘健康监控" \
    RUN_ON_START=false

VOLUME ["/data", "/config"]
EXPOSE 8787

ENTRYPOINT ["/app/entrypoint.sh"]
