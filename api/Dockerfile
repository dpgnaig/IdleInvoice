# Build đa tầng: web (Vite) -> api (tsc) -> runtime gọn.
# Context build là thư mục gốc repo (xem docker-compose.yml).

# ---------- 1. Web ----------
FROM node:22-bookworm-slim AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---------- 2. API ----------
FROM node:22-bookworm-slim AS api-build
# argon2 / better-sqlite3 có prebuild cho linux glibc; giữ toolchain để dự phòng.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY api/package.json api/package-lock.json ./
RUN npm ci
COPY api/ ./
RUN npm run build && npm prune --omit=dev

# ---------- 3. Runtime ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    SERVE_WEB=true \
    PORT=3000 \
    DATABASE_PATH=/data/app.db \
    UPLOAD_DIR=/app/uploads
WORKDIR /app
COPY --from=api-build /app/node_modules ./node_modules
COPY --from=api-build /app/dist ./dist
COPY --from=api-build /app/package.json ./package.json
COPY --from=web-build /web/dist ./public
RUN mkdir -p /data /app/uploads && chown -R node:node /data /app/uploads
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
