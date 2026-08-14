# Production image for Railway. The standalone Next.js output removes the
# complete build dependency tree from the runtime image and keeps Node pinned
# to the project's CI major version.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# The build is intentionally serialized in next.config.mjs; this is a build
# limit only and is not inherited by the small runtime container.
ENV NODE_OPTIONS=--max-old-space-size=3072
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Keep V8 below the 1 GB service allocation while allowing more than its
# conservative default heap, which caused the Next server to restart.
ENV NODE_OPTIONS=--max-old-space-size=768
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
