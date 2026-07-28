// ── Referral money/format helpers — kobo (minor units). Never float math. ────
export function formatNaira(kobo: number | null | undefined, opts?: { decimals?: boolean }): string {
  if (kobo == null) return '—';
  const value = kobo / 100;
  const fractionDigits = opts?.decimals ? 2 : 0;
  return (
    '₦' +
    value.toLocaleString('en-NG', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    })
  );
}

export function formatRate(rate: number | null | undefined): string {
  if (rate == null) return '—';
  return `${Math.round(rate * 100)}%`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function tierLabel(tier: string): string {
  const map: Record<string, string> = {
    STARTER: 'Starter',
    GROWTH: 'Growth',
    PRO: 'Pro',
    ELITE: 'Elite',
  };
  return map[tier] ?? tier;
}

export function shareMessage(code: string, link: string): string {
  return (
    `Join me on Spotlight — Nigeria's super app for payments, events, shopping and more. ` +
    `Use my code ${code} when you sign up: ${link}`
  );
}
