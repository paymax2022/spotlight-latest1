import axios from 'axios';
import { router } from 'expo-router';

import { deleteSecureItem, getSecureItem } from '@/lib/storage/secureStorage';
import { normalizeApiError } from '@/utils/errorMapper';

const baseURL = process.env.EXPO_PUBLIC_API_BASE_URL;

export const api = axios.create({
  baseURL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  }
});

api.interceptors.request.use(async (config) => {
  const token = await getSecureItem('access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const normalized = normalizeApiError(error);
    if (normalized.status === 401) {
      await deleteSecureItem('access_token');
      await deleteSecureItem('refresh_token');
      router.replace('/login' as never);
    }
    return Promise.reject(normalized);
  }
);
