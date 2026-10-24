// Recent Billers for the Bills hub: the user's own successful utility purchases, each with
// the logo of the provider they bought from. See recentBillers.ts for the rules.
//
// Logos: <ProviderLogo> already resolves a bundled logo for known providers by NAME, so any
// provider it recognises needs nothing more. For every other provider the billing API's
// per-category logo list (the same one the purchase screens use) is looked up here and the
// image passed through; with neither, ProviderLogo falls back to a branded initials badge.

import { useMemo } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import { getTransactions } from '@/api/transactions.api';
import { getProviderLogos, resolveProviderImage } from '@/api/billing.api';
import { deriveRecentBillers, logoCategory, type RecentBiller } from './recentBillers';

export const RECENT_BILLERS_KEY = ['bills', 'recent-billers'];

export interface RecentBillerRow extends RecentBiller {
  /** Provider logo URL from the billing API, when it has one for this provider. */
  logoUri?: string;
}

export function useRecentBillers(limit = 5) {
  const purchases = useQuery({
    queryKey: [...RECENT_BILLERS_KEY, limit],
    // Newest 50 successful purchases is plenty to find `limit` distinct providers/numbers.
    queryFn: () => getTransactions({ status: 'SUCCESSFUL', limit: 50 }),
    // Always refetch when the hub opens: a purchase made a moment ago (on the airtime or
    // electricity screen) must show up here when the user comes back, not a minute later.
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const billers = useMemo(() => deriveRecentBillers(purchases.data?.items ?? [], limit), [purchases.data, limit]);

  // One logo list per category that actually appears (not all five).
  const categories = useMemo(
    () => Array.from(new Set(billers.map((b) => logoCategory(b.serviceType)))),
    [billers],
  );
  const logoQueries = useQueries({
    queries: categories.map((c) => ({
      queryKey: ['provider-logos', c],
      queryFn: () => getProviderLogos(c),
      staleTime: 60 * 60_000,
    })),
  });

  const rows: RecentBillerRow[] = useMemo(() => {
    const byCategory = new Map(categories.map((c, i) => [c, logoQueries[i]?.data ?? []] as const));
    return billers.map((b) => ({
      ...b,
      logoUri: b.providerName
        ? resolveProviderImage(byCategory.get(logoCategory(b.serviceType)) ?? [], '', b.providerName)
        : undefined,
    }));
  }, [billers, categories, logoQueries]);

  return { rows, isLoading: purchases.isLoading, isError: purchases.isError, refetch: purchases.refetch };
}
