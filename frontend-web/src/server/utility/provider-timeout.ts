export class UtilityProviderTimeoutError extends Error {
  timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Utility provider timed out after ${timeoutMs}ms.`);
    this.name = 'UtilityProviderTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export function getUtilityProviderTimeoutMs(config: Record<string, unknown> | null | undefined) {
  const configured = config?.timeout_ms;
  if (typeof configured === 'number' && Number.isInteger(configured) && configured >= 1_000) {
    return Math.min(configured, 120_000);
  }

  const envValue = Number(process.env.UTILITY_PROVIDER_TIMEOUT_MS || 15_000);
  if (Number.isInteger(envValue) && envValue >= 1_000) return Math.min(envValue, 120_000);

  return 15_000;
}

export async function withUtilityProviderTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new UtilityProviderTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
