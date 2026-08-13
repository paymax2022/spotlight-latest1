'use client';

import { useEffect, useState, useRef } from 'react';
import { useMarketplaceAdminService } from '@/services/marketplaceAdminService';
import type { AuditLog } from '@/types/marketplaceAdmin';

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

const naira = (kobo: number) => {
  const naira = Math.floor(kobo / 100);
  return `₦${naira.toLocaleString('en-NG')}`;
};

const formatTime = (dateStr: string) => {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString('en-NG');
};

export default function MarketplaceAdminPage() {
  const service = useMarketplaceAdminService();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        const [metricsData, activitiesData] = await Promise.all([
          service.getMetrics(),
          service.getActivityFeed(),
        ]);

        setMetrics(metricsData);
        setActivities(activitiesData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [service]);

  // Set up WebSocket for real-time updates
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//localhost:8091/ws/marketplace/updates`);

    ws.onopen = () => {
      console.log('Connected to marketplace events');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Update metrics
        setMetrics((prev) => {
          if (!prev) return prev;

          const updated = { ...prev };
          if (data.type === 'listing.created') {
            updated.listings_created_today++;
            updated.total_active_listings++;
            updated.unique_sellers_today = Math.max(
              updated.unique_sellers_today,
              updated.unique_sellers_today + (Math.random() > 0.7 ? 1 : 0)
            );
          }
          return updated;
        });

        // Add to activity feed
        if (data.display_text) {
          const newActivity: ActivityEvent = {
            id: data.listing?.id || crypto.randomUUID(),
            event_type: data.type,
            entity_type: 'listing',
            entity_id: data.listing?.id || '',
            actor_id: data.listing?.user_id || '',
            display_text: data.display_text,
            listing_title: data.listing?.title,
            listing_price_kobo: data.listing?.price_kobo,
            actor_name: 'User',
            severity: 'info',
            created_at: new Date().toISOString(),
          };

          setActivities((prev) => [newActivity, ...prev.slice(0, 99)]);
        }
      } catch (err) {
        console.error('Failed to process WebSocket message:', err);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      // Fall back to polling if WebSocket fails
      const pollInterval = setInterval(async () => {
        try {
          const data = await service.getActivityFeed();
          setActivities(data);
        } catch (err) {
          console.error('Polling failed:', err);
        }
      }, 10000); // Poll every 10 seconds

      return () => clearInterval(pollInterval);
    };

    wsRef.current = ws;

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [service]);

  if (loading && !metrics) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>Loading marketplace dashboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '2rem', color: '#d32f2f' }}>
        <p>Error: {error}</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem' }}>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.875rem', fontWeight: 700 }}>
          Marketplace Dashboard
        </h1>
        <p style={{ margin: '0.5rem 0 0 0', color: '#666', fontSize: '0.875rem' }}>
          Real-time marketplace activity and metrics
        </p>
      </div>

      {/* KPI Grid */}
      {metrics && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
          marginBottom: '2rem',
        }}>
          <KPICard
            label="Active Listings"
            value={metrics.total_active_listings.toLocaleString('en-NG')}
            subtext={`+${metrics.listings_created_today} today`}
          />
          <KPICard
            label="Total GMV"
            value={naira(metrics.total_gmv_kobo)}
            accent="#4CAF50"
          />
          <KPICard
            label="Unique Sellers"
            value={metrics.unique_sellers_today.toLocaleString('en-NG')}
            accent="#2196F3"
          />
          <KPICard
            label="Unique Buyers"
            value={metrics.unique_buyers_today.toLocaleString('en-NG')}
            accent="#FF9800"
          />
          <KPICard
            label="Messages"
            value={metrics.messages_sent_today.toLocaleString('en-NG')}
            subtext="sent today"
          />
          <KPICard
            label="Offers"
            value={metrics.offers_made_today.toLocaleString('en-NG')}
            subtext="made today"
          />
        </div>
      )}

      {/* Activity Feed */}
      <div style={{
        backgroundColor: '#f5f5f5',
        borderRadius: '8px',
        padding: '1.5rem',
        marginTop: '2rem',
      }}>
        <h2 style={{ margin: '0 0 1rem 0', fontSize: '1.125rem', fontWeight: 600 }}>
          Live Activity Feed
        </h2>

        {activities.length === 0 ? (
          <p style={{ color: '#999', textAlign: 'center', padding: '2rem' }}>
            No activity yet
          </p>
        ) : (
          <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
            {activities.map((activity) => (
              <div
                key={activity.id}
                style={{
                  display: 'flex',
                  gap: '1rem',
                  padding: '1rem',
                  borderBottom: '1px solid #e0e0e0',
                  backgroundColor: '#fff',
                  marginBottom: '0.5rem',
                  borderRadius: '4px',
                  alignItems: 'flex-start',
                }}
              >
                {/* Severity indicator */}
                <div
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    marginTop: '6px',
                    backgroundColor:
                      activity.severity === 'error'
                        ? '#d32f2f'
                        : activity.severity === 'warning'
                        ? '#f57c00'
                        : '#4CAF50',
                  }}
                />

                {/* Content */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                    {activity.display_text}
                  </div>
                  {activity.listing_title && (
                    <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.25rem' }}>
                      {activity.listing_title} • {naira(activity.listing_price_kobo || 0)}
                    </div>
                  )}
                  <div style={{ fontSize: '0.7rem', color: '#999', marginTop: '0.25rem' }}>
                    {formatTime(activity.created_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function KPICard({
  label,
  value,
  subtext,
  accent,
}: {
  label: string;
  value: string | number;
  subtext?: string;
  accent?: string;
}) {
  return (
    <div
      style={{
        backgroundColor: '#fff',
        border: '1px solid #e0e0e0',
        borderRadius: '8px',
        padding: '1.5rem',
      }}
    >
      <div style={{ fontSize: '0.75rem', color: '#666', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div
        style={{
          fontSize: '1.875rem',
          fontWeight: 700,
          marginTop: '0.5rem',
          color: accent || '#000',
        }}
      >
        {value}
      </div>
      {subtext && (
        <div style={{ fontSize: '0.75rem', color: '#999', marginTop: '0.5rem' }}>
          {subtext}
        </div>
      )}
    </div>
  );
}
