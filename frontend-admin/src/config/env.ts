export const env = {
  apiBaseUrl: process.env.NEXT_PUBLIC_ADMIN_API_BASE_URL || 'http://localhost:8080/api/v1',
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  legacyAdminBaseUrl: process.env.NEXT_PUBLIC_LEGACY_ADMIN_BASE_URL || 'http://localhost:4028',
};

export const hasSupabaseConfig = Boolean(env.supabaseUrl && env.supabaseAnonKey);
