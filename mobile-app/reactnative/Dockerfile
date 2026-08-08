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
COPY --from=builder /app/dist ./public

EXPOSE 8083

# Start server
CMD ["serve", "-s", "public", "-l", "8083"]
