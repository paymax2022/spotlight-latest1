# Production image for Railway. The standalone Next.js output removes the
# complete build dependency tree from the runtime image and keeps Node pinned
# to the project's CI major version.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
# next.config.mjs reads GO_BACKEND_URL in rewrites(), which Next evaluates at
# BUILD time and bakes into the routes manifest. A Docker build does NOT inherit
# the environment, so without this ARG the variable is undefined during `npm run
# build` and the fallback rewrite is compiled as http://localhost:8080 - an
# address where nothing listens inside this container. Every /api/v1/* and
# /api/finance/* path with no Next route of its own then HANGS.
#
# That is not hypothetical: it was live on staging. Setting GO_BACKEND_URL to the
# private address AND to the public one both hung identically, because the value
# never reached the build either way. Route handlers kept working throughout,
# since they read process.env at runtime - which is what made it look like a
# networking problem rather than a build one.
#
# Railway passes service variables as build args, but only for names the
# Dockerfile declares.
ARG GO_BACKEND_URL
ENV GO_BACKEND_URL=$GO_BACKEND_URL
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
EXPOSE 8080
CMD ["node", "server.js"]
