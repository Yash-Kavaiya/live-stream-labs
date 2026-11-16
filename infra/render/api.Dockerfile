# OmniCast API for Render (see render.yaml). Render cannot choose a stage of infra/Dockerfile,
# so each service has a file of its own with the same build stage.
# Runs as root: Render mounts the persistent disk at /data owned by root.

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
RUN npm run build --workspace @studio/api && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/drizzle apps/api/drizzle
COPY --from=build /app/apps/api/package.json apps/api/
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["node", "dist/index.js"]
