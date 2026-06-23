import { AxiosError } from 'axios';

export type NormalizedApiError = Error & {
  status?: number;
  code?: string;
};

export function normalizeApiError(error: unknown): NormalizedApiError {
  if ((error as AxiosError)?.isAxiosError) {
    const axiosError = error as AxiosError<{ message?: string; error?: string; code?: string }>;
    const responseMessage = axiosError.response?.data?.message || axiosError.response?.data?.error;
    const message =
      responseMessage ||
      (axiosError.code === 'ECONNABORTED'
        ? 'Request timed out. Please try again.'
        : axiosError.message || 'Service temporarily unavailable. Please try again.');
    const normalized = new Error(message) as NormalizedApiError;
    normalized.status = axiosError.response?.status;
    normalized.code = axiosError.response?.data?.code || axiosError.code;
    return normalized;
  }

  if (error instanceof Error) return error as NormalizedApiError;
  return new Error('Service temporarily unavailable. Please try again.') as NormalizedApiError;
}

export function getFriendlyErrorMessage(error: unknown, fallback = 'Service temporarily unavailable. Please try again.') {
  const normalized = normalizeApiError(error);
  if (normalized.status === 401) return 'Your session has expired. Please log in again.';
  if (normalized.status && normalized.status >= 500) return fallback;
  return normalized.message || fallback;
}
