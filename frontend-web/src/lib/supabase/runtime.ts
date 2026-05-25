export function hasUsableSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!url || !anon) return false;
  if (url.includes('placeholder') || anon.includes('placeholder')) return false;

  // For admin operations we expect a real service key as well.
  if (!serviceRole || serviceRole.includes('placeholder')) return false;

  return true;
}

export function hasUsableSupabaseReadConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  if (!url || !anon) return false;
  if (url.includes('placeholder') || anon.includes('placeholder')) return false;

  return true;
}
