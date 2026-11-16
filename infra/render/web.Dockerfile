# OmniCast web for Render (see render.yaml): the built app, and the proxy that puts the API, the
# uploaded assets and the stream ingest on the same public origin. Listens on $PORT.

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
RUN npm run build --workspace @studio/web

FROM caddy:2-alpine
COPY infra/Caddyfile.cloudrun /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
EXPOSE 10000
