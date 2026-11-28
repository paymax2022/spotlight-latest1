

const cache = new Map<string, string>();

const publicEnvMap: Record<string, string | undefined> = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY:
    process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || process.env.PAYSTACK_PUBLIC_KEY,
};

export function getRequiredEnv(name: string): string {
  const cached = cache.get(name);
  if (cached) {
    return cached;
  }

  const value =
    typeof window !== 'undefined' && name in publicEnvMap ? publicEnvMap[name] : process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  cache.set(name, value);
  return value;
}

export function getOptionalEnv(name: string, fallback?: string): string | undefined {
  const value =
    typeof window !== 'undefined' && name in publicEnvMap ? publicEnvMap[name] : process.env[name];
  return value || fallback;
}

/**
 * Logs (never throws) a loud warning for missing critical environment
 * variables on application startup. Wired into instrumentation.ts's
 * register(), which runs once per server boot.
 *
 * Deliberately never throws: a missing var here degrades ONE feature
 * (e.g. Paystack-funded payments fail closed per-request — see
 * src/server/voting/payment/paystack.ts / src/server/wallet/service.ts's
 * own getSecretKey() checks), but crashing the whole process on boot over
 * one missing var would take down every OTHER feature too — a much wider
 * blast radius than the gap this is meant to surface. Found 2026-09-25:
 * PAYSTACK_SECRET_KEY was unset on Railway staging and nothing logged it —
 * this function already listed it as required but was never called from
 * anywhere, so the gap was silent until a real purchase attempt 500'd.
 */
export function validateEnv() {
  const requiredVars = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY',
    'PAYSTACK_SECRET_KEY',
    'MAILGUN_API_KEY',
    'MAILGUN_DOMAIN',
    'EMAIL_FROM',
    'NEXT_PUBLIC_SITE_URL',
  ];

  const missing = requiredVars.filter((v) => !getOptionalEnv(v));

  if (missing.length > 0) {
    console.error(
      `⚠️ Critical environment variables missing: ${missing.join(', ')}. ` +
        `The features that depend on them will fail closed at request time. ` +
        `Check this deployment's environment against .env.example / .env.production.example.`,
    );
    return;
  }

  console.log('✅ Environment variables validated successfully');
}

export const allowedRemoteImageHostnames = [
  'images.unsplash.com',
  'images.pexels.com',
  'images.pixabay.com',
  'img.rocket.new',
  // Cloudinary delivery host for moderated/background-removed contestant
  // photo cutouts (G-IMG pipeline, see src/lib/media/cloudinary.ts). Without
  // this, imageCompositor's fetchImageBuffer refuses to fetch Cloudinary URLs.
  'res.cloudinary.com',
] as const;

/**
 * Buckets whose *public* objects this app's own Storage may serve to the
 * compositing readers. `contest-templates` is the bucket
 * `supabase/migrations/20260405700000_contest_image_templates.sql` creates public
 * and that `app/api/admin/voting/contest-templates/route.ts:227` writes a row's
 * `template_url` from. A private bucket is deliberately absent: reaching it is a
 * storage-API call with a service key, not a URL the renderer should fetch.
 */
export const TEMPLATE_STORAGE_BUCKETS = ['contest-templates'] as const;

/** The one Storage path shape that serves a public object anonymously. */
export const PUBLIC_OBJECT_PATH_PREFIX = '/storage/v1/object/public/';

/**
 * The origin this app's own Supabase client would use — protocol + host + port.
 *
 * Read from `NEXT_PUBLIC_SUPABASE_URL`, the only Supabase URL the repo consumes
 * (`src/lib/supabase/server.ts:16`, `runtime.ts:2`), and read from the server's
 * environment rather than from a request or a database row. That provenance is
 * what makes an exact comparison below safe: the trusted origin is something the
 * deployment decides, never something a stored template can change. Dev resolves
 * to `http://127.0.0.1:54321`; production to `https://<project>.supabase.co` from
 * the same variable that already has to be set for the app to start at all.
 */
export function configuredSupabaseOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.host ? url.origin : null;
  } catch {
    return null;
  }
}

/** Exact-origin equality against `configuredSupabaseOrigin()` — never a suffix or host match. */
export function isConfiguredSupabaseOrigin(value: string): boolean {
  const trusted = configuredSupabaseOrigin();
  if (!trusted) return false;
  try {
    return new URL(value).origin === trusted;
  } catch {
    return false;
  }
}

/** True for `/storage/v1/object/public/<allowlisted bucket>/<non-empty key>`. */
function isPublicTemplateObject(pathname: string): boolean {
  if (!pathname.startsWith(PUBLIC_OBJECT_PATH_PREFIX)) return false;
  const rest = pathname.slice(PUBLIC_OBJECT_PATH_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1) return false;
  const bucket = rest.slice(0, slash);
  return (TEMPLATE_STORAGE_BUCKETS as readonly string[]).includes(bucket);
}

export function isAllowedRemoteImageUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  // Credentials would make `origin` the trusted host while the request carries
  // a basic-auth token for it, so they end the check before either branch runs.
  if (parsed.username || parsed.password) return false;
  if (
    parsed.protocol === 'https:' &&
    allowedRemoteImageHostnames.includes(
      parsed.hostname as (typeof allowedRemoteImageHostnames)[number]
    )
  ) {
    return true;
  }
  // Our own bucket: same origin byte-for-byte (so a port, a scheme or a
  // look-alike host fails), and a public template object. Both compositing
  // readers call this one function, which is the only reason they cannot
  // disagree about what a template URL may be.
  return parsed.origin === configuredSupabaseOrigin() && isPublicTemplateObject(parsed.pathname);
}
