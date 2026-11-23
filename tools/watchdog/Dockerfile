# Corali external watchdog — tiny image, no dependencies. It starts as root only to give the mounted volume (/data,
# root-owned when new) to the «node» user, then runs as «node» (su-exec, no shell left as root).
FROM node:22-alpine
RUN apk add --no-cache su-exec
WORKDIR /app
COPY watchdog.mjs ./
CMD ["sh", "-c", "mkdir -p /data && chown node:node /data && exec su-exec node node watchdog.mjs"]
