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
