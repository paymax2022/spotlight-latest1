# Multi-stage build for Expo web export
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build web export
COPY . .
RUN npm run web -- --output-dir dist

# Runtime stage - serve static files
FROM node:20-alpine
WORKDIR /app

ENV PORT=8083

# Install serve to serve static files
RUN npm install -g serve

# Copy built static files
COPY --from=builder --chown=node:node /app/dist ./public

# Run as the built-in non-root `node` user (trivy DS-0002). `serve` is installed
# globally into /usr/local/bin (world-executable) and only reads ./public, so the
# switch needs nothing else. Port 8083 is unprivileged.
USER node
EXPOSE 8083
# Static SPA server — any request under / resolves, so this needs nothing
# app-specific. wget is BusyBox-provided on node:alpine, no extra package.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8083/ || exit 1

# Start server
CMD ["serve", "-s", "public", "-l", "8083"]
