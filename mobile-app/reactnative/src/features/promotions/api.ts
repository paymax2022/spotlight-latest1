import axios, { AxiosInstance } from 'axios';
import { getDevUrl } from '@/lib/devUrl';
import type { PromotionalBanner } from './types';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:8091';
const PROMOTIONS_BASE = '/api/v1/promotions';

class PromotionsAPIClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: getDevUrl(API_BASE_URL),
      timeout: 30000,
    });
  }

  /**
   * Fetch active promotional banners for a given module (health, restaurant, etc.)
   * Results are cached and sorted by priority.
   */
  async getBannersByModule(module: string): Promise<PromotionalBanner[]> {
    try {
      const response = await this.client.get<{ banners: PromotionalBanner[] }>(
        `${PROMOTIONS_BASE}/banners?module=${encodeURIComponent(module)}`
      );
      return response.data?.banners ?? [];
    } catch (error) {
      console.error(`Failed to fetch banners for module "${module}":`, error);
      return [];
    }
  }

  /**
   * Get the highest-priority (featured) banner for a module.
   */
  async getFeaturedBanner(module: string): Promise<PromotionalBanner | null> {
    const banners = await this.getBannersByModule(module);
    return banners.length > 0 ? banners[0] : null;
  }
}

export const promotionsAPI = new PromotionsAPIClient();
