

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
 * The deployment's own Supabase origin — protocol + host + port of
 * NEXT_PUBLIC_SUPABASE_URL, the same value every Supabase client here is built
 * from (src/lib/supabase/server.ts). Contest template rows are written with
 * `storage.from('contest-templates').getPublicUrl(objectKey)`, so the host of a
 * stored `template_url` is exactly this origin by construction:
 * `http://127.0.0.1:54321` on the local stack, `https://<project>.supabase.co`
 * in production. Null when unset or unparseable, so a deployment with no usable
 * Supabase config trusts nothing extra. Read per call rather than cached — this
 * is consulted from the fetch gate, and the module already caches env reads.
 */
export function configuredSupabaseOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export function isAllowedRemoteImageUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    // Credentials in the URL are never a match, even when the origin is.
    if (parsed.username || parsed.password) return false;
    if (
      allowedRemoteImageHostnames.includes(
        parsed.hostname as (typeof allowedRemoteImageHostnames)[number]
      )
    ) {
      return parsed.protocol === 'https:';
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    // Exact-origin equality, not a host or prefix test: another port, another
    // scheme, or a host that merely ends in the configured one stays refused.
    const configured = configuredSupabaseOrigin();
    return configured !== null && parsed.origin === configured;
  } catch {
    return false;
  }
}
