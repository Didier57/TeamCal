FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci --no-audit --no-fund

FROM base AS build
COPY . .
RUN npm run build

FROM base AS prod-deps
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    DATABASE_PATH=/app/data/teamcal.sqlite
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/index.js"]
