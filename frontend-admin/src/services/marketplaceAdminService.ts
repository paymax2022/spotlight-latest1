/**
 * Marketplace Admin Service
 *
 * Connects the admin dashboard to the real-time marketplace backend.
 * Handles:
 * - Real-time metrics retrieval
 * - Activity feed streaming
 * - Audit log viewing
 * - Listing management (view, approve, flag)
 */

import type { AuditLog } from '@/types/marketplaceAdmin';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8091/api/v1';

interface Metrics {
  total_active_listings: number;
  listings_created_today: number;
  total_gmv_kobo: number;
  unique_sellers_today: number;
  unique_buyers_today: number;
  messages_sent_today: number;
  offers_made_today: number;
  recent_activity_count: number;
}

interface ActivityEvent {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  actor_id: string;
  display_text: string;
  listing_title?: string;
  listing_price_kobo?: number;
  actor_name: string;
  severity: 'info' | 'warning' | 'error';
  created_at: string;
}

interface Listing {
  id: string;
  user_id: string;
  title: string;
  description: string;
  category: string;
  price_kobo: number;
  currency: string;
  status: string;
  condition?: string;
  location_text?: string;
  image_urls: string[];
  created_at: string;
  updated_at: string;
  published_at?: string;
  deleted_at?: string;
}

class MarketplaceAdminService {
  private token: string | null = null;

  constructor() {
    this.loadToken();
  }

  private loadToken() {
    // Load from localStorage or auth context
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('auth_token');
      if (stored) {
        this.token = stored;
      }
    }
  }

  private getHeaders() {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    return headers;
  }

  /**
   * Get real-time metrics for the marketplace
   */
  async getMetrics(): Promise<Metrics> {
    const response = await fetch(
      `${API_BASE_URL}/admin/marketplace/metrics`,
      {
        method: 'GET',
        headers: this.getHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch metrics: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get live activity feed
   */
  async getActivityFeed(): Promise<ActivityEvent[]> {
    const response = await fetch(
      `${API_BASE_URL}/admin/marketplace/activity-feed`,
      {
        method: 'GET',
        headers: this.getHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch activity feed: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get audit logs for a specific listing
   */
  async getAuditTrail(listingId: string, limit: number = 100): Promise<AuditLog[]> {
    const response = await fetch(
      `${API_BASE_URL}/marketplace/listings/${listingId}/audit?limit=${limit}`,
      {
        method: 'GET',
        headers: this.getHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch audit trail: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get all audit logs (admin only)
   */
  async getAllAuditLogs(limit: number = 500): Promise<AuditLog[]> {
    const response = await fetch(
      `${API_BASE_URL}/admin/marketplace/audit-logs?limit=${limit}`,
      {
        method: 'GET',
        headers: this.getHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch audit logs: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get all listings (admin view)
   */
  async getAllListings(page: number = 1, pageSize: number = 50): Promise<{
    listings: Listing[];
    total: number;
    page: number;
  }> {
    const response = await fetch(
      `${API_BASE_URL}/admin/marketplace/listings?page=${page}&page_size=${pageSize}`,
      {
        method: 'GET',
        headers: this.getHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch listings: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get a single listing
   */
  async getListing(listingId: string): Promise<Listing> {
    const response = await fetch(
      `${API_BASE_URL}/marketplace/listings/${listingId}`,
      {
        method: 'GET',
        headers: this.getHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch listing: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Subscribe to real-time marketplace updates via WebSocket
   */
  subscribe(onMessage: (event: ActivityEvent) => void, onError?: (error: Error) => void) {
    const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//localhost:8091/ws/marketplace/updates`;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('Connected to marketplace real-time updates');
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

    ws.onclose = () => {
      console.log('Disconnected from marketplace real-time updates');
    };

    // Return unsubscribe function
    return () => {
      ws.close();
    };
  }

  /**
   * Subscribe to Server-Sent Events (alternative to WebSocket)
   */
  subscribeSSE(onMessage: (event: ActivityEvent) => void, onError?: (error: Error) => void) {
    const eventSource = new EventSource(
      `${API_BASE_URL}/admin/marketplace/events`,
      {
        // @ts-ignore - credentials option not in TypeScript types
        withCredentials: true,
      }
    );

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch (err) {
        console.error('Failed to parse SSE message:', err);
      }
    };

    eventSource.onerror = (error) => {
      console.error('SSE error:', error);
      eventSource.close();
      if (onError) {
        onError(new Error('SSE connection failed'));
      }
    };

    // Return unsubscribe function
    return () => {
      eventSource.close();
    };
  }
}

// Export singleton instance
export const marketplaceAdminService = new MarketplaceAdminService();

// Export hook for React components
export function useMarketplaceAdminService() {
  return marketplaceAdminService;
}
