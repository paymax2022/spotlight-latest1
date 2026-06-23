import { create } from 'zustand';

import * as authApi from '@/api/auth.api';
import { deleteSecureItem, getSecureItem, setSecureItem } from '@/lib/storage/secureStorage';
import { User } from '@/types/auth';

type AuthState = {
  initialized: boolean;
  user: User | null;
  init: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: { fullName: string; email: string; phone?: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
};

async function persistTokens(accessToken?: string, refreshToken?: string) {
  if (accessToken) await setSecureItem('access_token', accessToken);
  if (refreshToken) await setSecureItem('refresh_token', refreshToken);
}

export const useAuthStore = create<AuthState>((set) => ({
  initialized: false,
  user: null,
  setUser: (user) => set({ user }),
  init: async () => {
    const token = await getSecureItem('access_token');
    if (!token) {
      set({ initialized: true, user: null });
      return;
    }

    try {
      const user = await authApi.getMe();
      set({ initialized: true, user });
    } catch {
      await deleteSecureItem('access_token');
      await deleteSecureItem('refresh_token');
      set({ initialized: true, user: null });
    }
  },
  login: async (email, password) => {
    const result = await authApi.login({ email, password });
    await persistTokens(result.tokens.accessToken, result.tokens.refreshToken);
    set({ user: result.user });
  },
  register: async (payload) => {
    const result = await authApi.register(payload);
    await persistTokens(result.tokens.accessToken, result.tokens.refreshToken);
    set({ user: result.user });
  },
  logout: async () => {
    try {
      await authApi.logout();
    } catch {
      // Local logout must still complete if the backend session is already gone.
    }
    await deleteSecureItem('access_token');
    await deleteSecureItem('refresh_token');
    set({ user: null });
  }
}));
