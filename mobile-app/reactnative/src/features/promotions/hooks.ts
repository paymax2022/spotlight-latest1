import { useQuery } from '@tanstack/react-query';
import { promotionsAPI } from './api';

const PROMOTIONS_KEY = 'promotions';

/**
 * Fetch all active promotional banners for a module.
 * Cached for 5 minutes.
 */
export function useModuleBanners(module: string) {
  return useQuery({
    queryKey: [PROMOTIONS_KEY, 'banners', module],
    queryFn: () => promotionsAPI.getBannersByModule(module),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
    enabled: !!module,
  });
}

/**
 * Get the featured (highest-priority) banner for a module.
 */
export function useFeaturedBanner(module: string) {
  return useQuery({
    queryKey: [PROMOTIONS_KEY, 'featured', module],
    queryFn: () => promotionsAPI.getFeaturedBanner(module),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
    enabled: !!module,
  });
}
