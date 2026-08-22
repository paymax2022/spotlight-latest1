# Multi-stage build for the Next.js admin dashboard. Deploy target: Railway.
FROM node:20-alpine AS builder
WORKDIR /app

# Railway injects service variables into Docker builds only when declared as
# build arguments. These are needed while Next evaluates server route modules
# during `next build`; Railway still injects the runtime values separately.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
# Sent as the x-admin-api-key header by the admin console. NEXT_PUBLIC_* is
# inlined at BUILD time, so without this ARG the bundle ships an empty string and
# the console sends no key at all - and RequireAdmin FAILS OPEN when the backend
# key is empty, so the combination silently leaves admin endpoints ungated.
#
# NOTE: being NEXT_PUBLIC_ this value reaches every browser that loads the admin
# app, so it is not a secret in any meaningful sense. Declaring the ARG restores
# the gate that was intended; moving the call server-side is the real fix and is
# tracked separately.
ARG NEXT_PUBLIC_ADMIN_API_KEY
ARG SUPABASE_SERVICE_ROLE_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
ENV NEXT_PUBLIC_ADMIN_API_KEY=${NEXT_PUBLIC_ADMIN_API_KEY}
ENV SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}

# Install dependencies from the lockfile first so this layer caches across
# source-only changes.
COPY package*.json ./
RUN npm ci

COPY . .

# This app has no public/ directory today. `COPY --from=builder /app/public`
# in the runtime stage fails the image build outright when the path is absent,
# so guarantee it exists rather than depending on the repo layout.
RUN mkdir -p public

# next.config.mjs sets experimental.cpus=1, so static generation of the 488
# prerendered pages runs in a single V8 heap instead of one per CPU. Cap that
# heap so the build cannot exhaust the builder. Measured peak RSS: 2.02 GiB
# uncapped, 1.42 GiB at 1024. Lower this to 1024 if the Railway builder OOMs.
ENV NODE_OPTIONS=--max-old-space-size=2048
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
# Local default only -- Railway injects PORT at runtime and overrides this.
ENV PORT=3001

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
# `next start` reads next.config.mjs at runtime; without it the server silently
# falls back to Next defaults.
COPY --from=builder /app/next.config.mjs ./

EXPOSE 8080

# Bind whatever port Railway assigns. The package.json `start` script hardcodes
# `-p 3001`, which would ignore $PORT and leave the service unreachable.
CMD ["sh", "-c", "node_modules/.bin/next start -p ${PORT:-3001} -H 0.0.0.0"]
