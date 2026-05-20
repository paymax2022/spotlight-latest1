import axios from 'axios';

import { getSecureItem } from '@/lib/storage/secureStorage';

export const apiClient = axios.create({
  baseURL: 'https://api.paymax.example',
  timeout: 15000
});

apiClient.interceptors.request.use(async (config) => {
  const token = await getSecureItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
