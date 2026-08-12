-- Supabase-compat prelude for running supabase/migrations on a plain
-- PostGIS/PostgreSQL service container (CI). Provides the surface Supabase
-- supplies at runtime: extensions, the auth schema + helpers, the storage
-- schema, and the API roles. Idempotent — safe to run repeatedly.
-- NOT for real Supabase databases (it would shadow the managed auth helpers).

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

-- ── auth schema (Supabase-managed in production) ────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;

-- Mirrors GoTrue's auth.users closely enough for migrations that seed users
-- or read metadata. ALTER lines upgrade a previously-created shim table.
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS instance_id uuid,
  ADD COLUMN IF NOT EXISTS aud varchar(255),
  ADD COLUMN IF NOT EXISTS role varchar(255),
  ADD COLUMN IF NOT EXISTS email varchar(255),
  ADD COLUMN IF NOT EXISTS encrypted_password varchar(255),
  ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS invited_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmation_token varchar(255),
  ADD COLUMN IF NOT EXISTS confirmation_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS recovery_token varchar(255),
  ADD COLUMN IF NOT EXISTS recovery_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_change_token_new varchar(255),
  ADD COLUMN IF NOT EXISTS email_change varchar(255),
  ADD COLUMN IF NOT EXISTS email_change_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS raw_app_meta_data jsonb,
  ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb,
  ADD COLUMN IF NOT EXISTS is_super_admin boolean,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS phone_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS phone_change text DEFAULT '',
  ADD COLUMN IF NOT EXISTS phone_change_token varchar(255) DEFAULT '',
  ADD COLUMN IF NOT EXISTS phone_change_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_change_token_current varchar(255) DEFAULT '',
  ADD COLUMN IF NOT EXISTS email_change_confirm_status smallint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS banned_until timestamptz,
  ADD COLUMN IF NOT EXISTS reauthentication_token varchar(255) DEFAULT '',
  ADD COLUMN IF NOT EXISTS reauthentication_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_sso_user boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_anonymous boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='auth' AND table_name='users' AND column_name='confirmed_at') THEN
    ALTER TABLE auth.users ADD COLUMN confirmed_at timestamptz
      GENERATED ALWAYS AS (LEAST(email_confirmed_at, phone_confirmed_at)) STORED;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated')
$$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

-- ── extensions schema (Supabase installs pgcrypto there; here it's in public)
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE OR REPLACE FUNCTION extensions.crypt(text, text) RETURNS text
LANGUAGE sql AS $$ SELECT public.crypt($1, $2) $$;
CREATE OR REPLACE FUNCTION extensions.gen_salt(text) RETURNS text
LANGUAGE sql AS $$ SELECT public.gen_salt($1) $$;
CREATE OR REPLACE FUNCTION extensions.gen_salt(text, integer) RETURNS text
LANGUAGE sql AS $$ SELECT public.gen_salt($1, $2) $$;

-- ── API roles (Supabase-managed in production) ──────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
  -- Some migrations GRANT to "postgres" by name (the superuser on real
  -- Supabase); the CI container's superuser is $POSTGRES_USER instead.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    CREATE ROLE postgres NOLOGIN;
  END IF;
END $$;

-- ── storage schema (Supabase Storage in production) ─────────────────────────
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id                 text PRIMARY KEY,
  name               text NOT NULL,
  public             boolean NOT NULL DEFAULT false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id        text REFERENCES storage.buckets(id),
  name             text,
  owner            uuid,
  metadata         jsonb,
  path_tokens      text[] GENERATED ALWAYS AS (string_to_array(name, '/')) STORED,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  last_accessed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$$;

GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
