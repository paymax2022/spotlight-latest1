import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deleteSecureItem, getSecureItem, setSecureItem } from '@/lib/secureStorage';
import { getDevUrl } from '@/lib/devUrl';

const supabaseUrl = getDevUrl(process.env.EXPO_PUBLIC_SUPABASE_URL || '');
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

let client: SupabaseClient | null = null;

function hasSupabaseConfig() {
  return Boolean(
    supabaseUrl &&
      supabaseAnonKey &&
      !supabaseUrl.includes('placeholder') &&
      !supabaseAnonKey.includes('placeholder'),
  );
}

export function getSupabaseConfigStatus() {
  return {
    hasConfig: hasSupabaseConfig(),
    url: supabaseUrl,
  };
}

export function createSupabaseClient() {
  if (!hasSupabaseConfig()) {
    throw new Error('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  }

  if (!client) {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: false,
        persistSession: true,
        storage: {
          getItem: getSecureItem,
          setItem: setSecureItem,
          removeItem: deleteSecureItem,
        },
      },
    });
  }

  return client;
}
