/**
 * Marketplace API Client
 *
 * Handles all marketplace CRUD operations:
 * - Create listings (with image upload)
 * - Update listings
 * - Delete listings
 * - Browse listings (search, filter)
 * - Real-time listing updates
 * - Audit trail viewing
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import * as SecureStore from 'expo-secure-store';

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:8091/api/v1';

export interface Listing {
  id: string;
  user_id: string;
  title: string;
  description: string;
  category: string;
  price_kobo: number;
  currency: string;
  status: 'DRAFT' | 'PUBLISHED' | 'SOLD' | 'REMOVED';
  condition?: string;
  location_lat?: number;
  location_lng?: number;
  location_text?: string;
  image_urls: string[];
  created_at: string;
  updated_at: string;
  published_at?: string;
  deleted_at?: string;
}

export interface CreateListingInput {
  title: string;
  description: string;
  category: string;
  price_kobo: number;
  condition?: string;
  location_lat?: number;
  location_lng?: number;
  location_text?: string;
  image_urls?: string[];
}

export interface UpdateListingInput {
  title?: string;
  description?: string;
  category?: string;
  price_kobo?: number;
  condition?: string;
  location_lat?: number;
  location_lng?: number;
  location_text?: string;
  image_urls?: string[];
}

export interface AuditLog {
  id: string;
  entity_type: string;
  entity_id: string;
  actor_id: string;
  action: string;
  changes?: Record<string, unknown>;
  created_at: string;
}

class MarketplaceAPIClient {
  private client: AxiosInstance;
  private token: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
    });

    // Add request interceptor to attach token
    this.client.interceptors.request.use(async (config) => {
      const token = await this.getToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response?.status === 401) {
          // Token expired, redirect to login
          console.error('Unauthorized: Token expired');
          // TODO: Dispatch logout action
        }
        throw error;
      }
    );
  }

  private async getToken(): Promise<string | null> {
    if (this.token) return this.token;

    try {
      this.token = await SecureStore.getItemAsync('auth_token');
      return this.token;
    } catch (error) {
      console.error('Failed to retrieve token:', error);
      return null;
    }
  }

  /**
   * Create a new marketplace listing
   */
  async createListing(input: CreateListingInput): Promise<Listing> {
    try {
      const response = await this.client.post<Listing>(
        '/marketplace/listings',
        input
      );
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Update an existing listing
   */
  async updateListing(
    listingId: string,
    input: UpdateListingInput
  ): Promise<Listing> {
    try {
      const response = await this.client.put<Listing>(
        `/marketplace/listings/${listingId}`,
        input
      );
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Delete a listing (soft delete)
   */
  async deleteListing(listingId: string): Promise<void> {
    try {
      await this.client.delete(`/marketplace/listings/${listingId}`);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get a single listing
   */
  async getListing(listingId: string): Promise<Listing> {
    try {
      const response = await this.client.get<Listing>(
        `/marketplace/listings/${listingId}`
      );
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * List all active marketplace listings (with pagination & filters)
   */
  async listListings(options?: {
    category?: string;
    minPrice?: number;
    maxPrice?: number;
    condition?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    listings: Listing[];
    total: number;
    page: number;
  }> {
    try {
      const params = new URLSearchParams();
      if (options?.category) params.append('category', options.category);
      if (options?.minPrice) params.append('min_price', String(options.minPrice));
      if (options?.maxPrice) params.append('max_price', String(options.maxPrice));
      if (options?.condition) params.append('condition', options.condition);
      if (options?.page) params.append('page', String(options.page));
      if (options?.pageSize) params.append('page_size', String(options.pageSize));

      const response = await this.client.get('/marketplace/listings', { params });
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get audit trail for a listing
   */
  async getAuditTrail(
    listingId: string,
    limit: number = 50
  ): Promise<AuditLog[]> {
    try {
      const response = await this.client.get<AuditLog[]>(
        `/marketplace/listings/${listingId}/audit`,
        {
          params: { limit },
        }
      );
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Subscribe to real-time listing updates via WebSocket
   */
  subscribeToUpdates(
    onMessage: (event: { type: string; listing: Listing }) => void,
    onError?: (error: Error) => void
  ): () => void {
    const protocol =
      typeof window !== 'undefined' && window.location.protocol === 'https:'
        ? 'wss:'
        : 'ws:';
    const wsUrl = `${protocol}//localhost:8091/ws/marketplace/updates`;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('Connected to marketplace updates');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      if (onError) {
        onError(new Error('WebSocket connection failed'));
      }
    };

    return () => {
      ws.close();
    };
  }

  /**
   * Handle API errors consistently
   */
  private handleError(error: unknown): Error {
    if (axios.isAxiosError(error)) {
      const message =
        error.response?.data?.error ||
        error.response?.statusText ||
        error.message;
      return new Error(`Marketplace API error: ${message}`);
    }
    return error instanceof Error ? error : new Error('Unknown error');
  }
}

// Export singleton instance
export const marketplaceAPI = new MarketplaceAPIClient();
