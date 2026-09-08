import { create } from 'zustand';
import * as authApi from '@/api/auth.api';
import { createSupabaseClient } from '@/lib/supabase';
import { deleteSecureItem } from '@/lib/secureStorage';
import { User } from '@/types/auth';

interface AuthState {
  initialized: boolean;
  user: User | null;
  pendingVerifyEmail: string | null;
  init: () => Promise<void>;
  /** identifier is an email OR a phone number — resolved server-side. */
  login: (identifier: string, password: string) => Promise<void>;
  register: (payload: { fullName: string; email: string; phone: string; password: string }) => Promise<{ needsOtp: boolean; email: string }>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
  setPendingVerifyEmail: (email: string | null) => void;
}

// Bind the Supabase auth-lifecycle listener exactly once per app process.
let authListenerBound = false;

export const useAuthStore = create<AuthState>((set, get) => ({
  initialized:        false,
  user:               null,
  pendingVerifyEmail: null,

  setUser: (user) => set({ user }),
  setPendingVerifyEmail: (email) => set({ pendingVerifyEmail: email }),

  init: async () => {
    try {
      const supabase = createSupabaseClient();

      // Keep the store in sync with the Supabase session for its whole lifecycle.
      // Crucially, when the session EXPIRES (the refresh token can no longer be
      // renewed) Supabase emits SIGNED_OUT — we clear `user`, and the root
      // AuthGate then redirects to login, forcing a fresh sign-in. This also
      // covers the 401 interceptor (its awaited signOut() emits SIGNED_OUT) and
      // any explicit logout, so there is a single source of truth for auth state.
      if (!authListenerBound) {
        authListenerBound = true;
        supabase.auth.onAuthStateChange((event, session) => {
          if (event === 'SIGNED_OUT' || !session) {
            set({ user: null });
            return;
          }
          if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
            // A live session with no cached user (e.g. re-login) → hydrate it.
            if (!get().user) {
              authApi.getMe().then((user) => set({ user })).catch(() => set({ user: null }));
            }
          }
        });
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        set({ initialized: true, user: null });
        return;
      }
      const user = await authApi.getMe();
      set({ initialized: true, user });
    } catch {
      set({ initialized: true, user: null });
    }
  },

  login: async (identifier, password) => {
    // Supabase persists the session automatically via the SecureStore adapter; the
    // backend proxy hands us a real session, which authApi.login adopts.
    const result = await authApi.login({ identifier, password });
    set({ user: result.user });
  },

  register: async (payload) => {
    const result = await authApi.register(payload);
    if (result.tokens.accessToken) {
      set({ user: result.user });
      return { needsOtp: false, email: payload.email };
    }
    set({ pendingVerifyEmail: payload.email });
    return { needsOtp: true, email: payload.email };
  },

  logout: async () => {
    try { await authApi.logout(); } catch { /* still clear local state */ }
    // Clean up any legacy manually-stored tokens.
    await deleteSecureItem('access_token');
    await deleteSecureItem('refresh_token');
    set({ user: null, pendingVerifyEmail: null });
  },
}));
