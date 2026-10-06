# One build stage, three runtime targets:
#   docker build -f infra/Dockerfile --target api    -t studio-api .
#   docker build -f infra/Dockerfile --target worker -t studio-worker .
#   docker build -f infra/Dockerfile --target web    -t studio-web .

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/media-worker/package.json apps/media-worker/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/drizzle apps/api/drizzle
COPY --from=build /app/apps/api/package.json apps/api/
WORKDIR /app/apps/api
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]

FROM node:22-slim AS worker
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/media-worker/dist apps/media-worker/dist
COPY --from=build /app/apps/media-worker/package.json apps/media-worker/
WORKDIR /app/apps/media-worker
USER node
EXPOSE 4100
CMD ["node", "dist/index.js"]

# Static web app plus the reverse proxy that puts API, assets and ingest on one origin.
FROM caddy:2-alpine AS web
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
EXPOSE 80 443

# The web app for Cloud Run: plain HTTP on $PORT, proxying to the other two services by URL.
FROM caddy:2-alpine AS web-cloudrun
COPY infra/Caddyfile.cloudrun /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
EXPOSE 8080
