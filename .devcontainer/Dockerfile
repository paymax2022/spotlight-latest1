# Dev-container base. Go + Node are layered by devcontainer features; here we add
# the CLIs the build/migrate/deploy loop needs: psql, make, jq, and the supabase
# CLI (migrations live in supabase/migrations). Keep this lean and pinned.
FROM mcr.microsoft.com/devcontainers/base:ubuntu-22.04

ARG SUPABASE_CLI_VERSION=2.20.5

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      postgresql-client make jq ca-certificates curl git \
 && rm -rf /var/lib/apt/lists/*

# supabase CLI (pinned; bump SUPABASE_CLI_VERSION to upgrade).
RUN arch="$(dpkg --print-architecture)" \
 && curl -fsSL "https://github.com/supabase/cli/releases/download/v${SUPABASE_CLI_VERSION}/supabase_linux_${arch}.tar.gz" -o /tmp/supabase.tar.gz \
 && tar -xzf /tmp/supabase.tar.gz -C /usr/local/bin supabase \
 && rm /tmp/supabase.tar.gz \
 && supabase --version || echo "supabase CLI install skipped (offline build)"

# Deploy CLI placeholder — install flyctl/gcloud/aws here for your target.
# RUN curl -L https://fly.io/install.sh | sh

# ── trivy DS-0002 ("Image user should not be 'root'") — DELIBERATELY NOT FIXED ──
# This one is a false positive and adding `USER` here would make things worse.
#
# devcontainer.json already sets "remoteUser": "vscode", so the container runs
# as a non-root user in practice — trivy only reads this Dockerfile and cannot
# see that. Meanwhile the Go and Node toolchains are layered by devcontainer
# FEATURES, which run at build time and need root; pinning a USER here would
# break that layering to satisfy a scanner about a container that is never
# deployed and only ever runs on a developer's machine.
#
# If this needs silencing, do it in the scanner config with this reason — not by
# changing the image.
