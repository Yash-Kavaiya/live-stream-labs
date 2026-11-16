# OmniCast media worker for Render (see render.yaml): the encoder and one relay per platform.

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
RUN npm run build --workspace @studio/media-worker && npm prune --omit=dev

FROM node:22-slim
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
