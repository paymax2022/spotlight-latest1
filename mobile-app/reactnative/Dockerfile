# Multi-stage build for Expo web export
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run web -- --output-dir dist

FROM node:20-alpine AS runtime
WORKDIR /app
RUN npm install -g serve
COPY --from=builder /app/dist ./public

EXPOSE 8083
CMD ["serve", "-s", "public", "-l", "8083"]
