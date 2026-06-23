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
 * Validates all critical environment variables on application startup.
 * Should be called in a high-level entry point (e.g., layout.tsx or a server initialization script).
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
    const message =
      `Critical environment variables missing: ${missing.join(', ')}. ` +
      `Please check your .env file against .env.example`;
    const isProd = process.env.NODE_ENV === 'production';

    if (isProd) {
      throw new Error(message);
    }

    console.warn(`⚠️ ${message}`);
    return;
  }

  console.log('✅ Environment variables validated successfully');
}
