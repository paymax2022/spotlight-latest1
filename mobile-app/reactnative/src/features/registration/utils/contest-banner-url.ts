export function resolveContestBannerUrl(
  url: string | null | undefined,
  apiBaseUrl: string | undefined,
): string | null {
  const value = url?.trim();
  if (!value) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return value;
  if (!apiBaseUrl) throw new Error('API base URL is required to resolve the contest banner URL.');
  return new URL(value, apiBaseUrl).toString();
}
