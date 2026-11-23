# Corali external watchdog — tiny image, no dependencies, runs as a non-root user.
FROM node:22-alpine
WORKDIR /app
COPY watchdog.mjs ./
USER node
CMD ["node", "watchdog.mjs"]
