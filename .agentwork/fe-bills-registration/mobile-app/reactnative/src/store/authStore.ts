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
  login: (email: string, password: string) => Promise<void>;
  register: (payload: { fullName: string; email: string; phone: string; password: string }) => Promise<{ needsOtp: boolean; email: string }>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
  setPendingVerifyEmail: (email: string | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  initialized:        false,
  user:               null,
  pendingVerifyEmail: null,

  setUser: (user) => set({ user }),
  setPendingVerifyEmail: (email) => set({ pendingVerifyEmail: email }),

  init: async () => {
    try {
      const supabase = createSupabaseClient();
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

  login: async (email, password) => {
    // Supabase persists the session automatically via the SecureStore adapter.
    const result = await authApi.login({ email, password });
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
