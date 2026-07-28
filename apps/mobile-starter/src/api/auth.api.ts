import { api } from '@/api/client';
import { mapUserFromApi } from '@/api/mappers/auth.mapper';
import { AuthTokens, User } from '@/types/auth';

type AuthResult = {
  user: User;
  tokens: AuthTokens;
  message?: string;
};

type ApiRecord = Record<string, unknown>;

function asRecord(value: unknown): ApiRecord {
  return typeof value === 'object' && value !== null ? (value as ApiRecord) : {};
}

function mapAuthResponse(response: unknown): AuthResult {
  const responseRecord = asRecord(response);
  const data = asRecord(responseRecord.data ?? response);
  return {
    user: mapUserFromApi(data.user),
    tokens: {
      accessToken: String(data.accessToken ?? data.access_token ?? ''),
      refreshToken: data.refreshToken || data.refresh_token ? String(data.refreshToken ?? data.refresh_token) : undefined
    },
    message: responseRecord.message ? String(responseRecord.message) : undefined
  };
}

export async function login(payload: { email: string; password: string }) {
  const response = await api.post('/api/auth/login', payload);
  return mapAuthResponse(response.data);
}

export async function register(payload: { fullName: string; email: string; phone?: string; password: string }) {
  const response = await api.post('/api/auth/register', payload);
  return mapAuthResponse(response.data);
}

export async function verifyOtp(payload: { email: string; otp: string }) {
  // Backend: GET /api/auth/verify-email?token=<token>
  // The OTP is passed as the verification token in the query string.
  const response = await api.get('/api/auth/verify-email', { params: { token: payload.otp } });
  return response.data;
}

export async function resendOtp(payload: { email: string }) {
  const response = await api.post('/api/auth/resend-verification-link', payload);
  return response.data;
}

export async function forgotPassword(payload: { email: string }) {
  const response = await api.post('/api/auth/request-password-reset', payload);
  return response.data;
}

export async function resetPassword(payload: { token: string; password: string }) {
  // Backend expects {token, newPassword} in the request body.
  const response = await api.post('/api/auth/reset-password', {
    token: payload.token,
    newPassword: payload.password,
  });
  return response.data;
}

export async function getMe() {
  const response = await api.get('/api/auth/me');
  return mapUserFromApi(response.data?.data ?? response.data);
}

export async function logout() {
  const response = await api.post('/api/auth/logout');
  return response.data;
}
