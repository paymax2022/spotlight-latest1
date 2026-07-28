import { AxiosError } from 'axios';

export interface NormalizedError {
  message: string;
  status?: number;
  code?: string;
}

const FRIENDLY: Record<string, string> = {
  NETWORK_ERROR:        'No internet connection. Please check your network and try again.',
  TIMEOUT:              'Request timed out. Please try again.',
  PROVIDER_TIMEOUT:     'Provider timed out. Please try again or check transaction status.',
  UNAUTHORIZED:         'Your session has expired. Please sign in again.',
  INSUFFICIENT_BALANCE: 'Insufficient wallet balance for this transaction.',
  METER_NOT_FOUND:      'Unable to validate meter number. Please check the number and try again.',
  CARD_NOT_FOUND:       'Smart card number not found. Please check and try again.',
  SERVICE_UNAVAILABLE:  'Service temporarily unavailable. Please try again later.',
  TRANSACTION_FAILED:   'Transaction failed. Your wallet was not charged.',
  REFUND_PROCESSED:     'Transaction failed. Your wallet has been refunded.',
};

export function normalizeApiError(error: unknown): NormalizedError {
  if (error instanceof AxiosError) {
    if (!error.response) {
      return { message: FRIENDLY.NETWORK_ERROR, code: 'NETWORK_ERROR' };
    }
    const status = error.response.status;
    const data   = error.response.data as Record<string, unknown>;
    const code   = typeof data?.code === 'string' ? data.code : undefined;
    const serverMessage =
      typeof data?.message === 'string'
        ? data.message
        : typeof data?.error === 'string'
          ? data.error
          : undefined;

    if (status === 401) return { message: FRIENDLY.UNAUTHORIZED, status, code: 'UNAUTHORIZED' };
    if (code && FRIENDLY[code]) return { message: FRIENDLY[code], status, code };
    if (serverMessage) return { message: serverMessage, status, code };
    return { message: 'Something went wrong. Please try again.', status };
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const err = error as NormalizedError;
    if (err.code && FRIENDLY[err.code]) return { ...err, message: FRIENDLY[err.code] };
    if (typeof err.message === 'string') {
      if (/status code 504|timeout|timed out/i.test(err.message)) {
        return { ...err, message: FRIENDLY.PROVIDER_TIMEOUT, code: err.code ?? 'PROVIDER_TIMEOUT', status: err.status ?? 504 };
      }
      return err;
    }
  }
  if (error instanceof Error) {
    if (/status code 504|timeout|timed out/i.test(error.message)) {
      return { message: FRIENDLY.PROVIDER_TIMEOUT, code: 'PROVIDER_TIMEOUT', status: 504 };
    }
    return { message: error.message };
  }
  return { message: 'An unexpected error occurred.' };
}

export function getErrorMessage(error: unknown): string {
  return normalizeApiError(error).message;
}
