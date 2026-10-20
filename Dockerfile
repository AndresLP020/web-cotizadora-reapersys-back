# syntax=docker/dockerfile:1
# API de ReaperSys (NestJS). Construir desde la RAÍZ del monorepo:
#   docker build -f backend/Dockerfile -t reapersys-api .
ARG NODE_IMAGE=node:24.22.0-alpine

# ---------------------------------------------------------------- dependencias + build
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace @reapersys/backend --include-workspace-root --no-audit --no-fund
COPY backend/ backend/
RUN npm run build --workspace @reapersys/backend

# ---------------------------------------------------------------- dependencias de producción
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace @reapersys/backend --omit=dev --no-audit --no-fund && npm cache clean --force

# ---------------------------------------------------------------- imagen final
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=4000
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/backend/package.json ./backend/package.json
COPY --from=build --chown=node:node /app/backend/dist ./backend/dist
WORKDIR /app/backend
# Sin privilegios de root.
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
