FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY backend/ ./
RUN mkdir -p /app/.data && chown -R node:node /app

USER node
EXPOSE 5000

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:5000/health').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]

