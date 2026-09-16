# 🔗 Real-Time Marketplace + Admin Integration

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                  Mobile Marketplace                      │
│            (localhost:8083/marketplace)                  │
│                                                          │
│  • Browse listings (CRUD Read)                           │
│  • Create/Edit listings (CRUD Create/Update)            │
│  • Message sellers (Real-time)                          │
│  • Track orders (Real-time)                             │
└──────────────────┬──────────────────────────────────────┘
                   │
                   │ WebSocket + REST API
                   ↓
┌─────────────────────────────────────────────────────────┐
│              Backend (Go) - :8091                        │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐│
│  │ Marketplace Service                                  ││
│  │ • ListMarketplaceItems()                             ││
│  │ • CreateListing()                                    ││
│  │ • UpdateListing()                                    ││
│  │ • DeleteListing()                                    ││
│  └─────────────────────────────────────────────────────┘│
│                                                          │
│  ┌─────────────────────────────────────────────────────┐│
│  │ Audit Log Service (NEW)                              ││
│  │ • LogMarketplaceAction()                             ││
│  │ • GetAuditTrail()                                    ││
│  │ • SubscribeToUpdates() [WebSocket]                   ││
│  └─────────────────────────────────────────────────────┘│
│                                                          │
│  ┌─────────────────────────────────────────────────────┐│
│  │ Real-time Engine                                     ││
│  │ • Publish events to admin                            ││
│  │ • Broadcast market changes                           ││
│  │ • Track live metrics                                 ││
│  └─────────────────────────────────────────────────────┘│
│                                                          │
│  ┌─────────────────────────────────────────────────────┐│
│  │ PostgreSQL Database                                  ││
│  │ • marketplace_listings                               ││
│  │ • marketplace_audit_logs                             ││
│  │ • marketplace_metrics                                ││
│  └─────────────────────────────────────────────────────┘│
└──────────────────┬──────────────────────────────────────┘
                   │
                   │ WebSocket + REST API + SSE
                   ↓
┌─────────────────────────────────────────────────────────┐
│            Admin Dashboard (localhost:3001/admin/mobility)
│                                                          │
│  • View all listings (Real-time)                        │
│  • Approve/Reject listings                              │
│  • View audit trail                                     │
│  • Live metrics dashboard                               │
│  • Activity log (real-time)                             │
└─────────────────────────────────────────────────────────┘
```

---

## 1. Database Schema (PostgreSQL)

### marketplace_listings
```sql
CREATE TABLE marketplace_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(50) NOT NULL,
  price_kobo BIGINT NOT NULL, -- All amounts in kobo
  currency VARCHAR(3) DEFAULT 'NGN',
  status VARCHAR(50) DEFAULT 'DRAFT', -- DRAFT, PUBLISHED, SOLD, REMOVED
  condition VARCHAR(50), -- NEW, LIKE_NEW, GOOD, FAIR, POOR
  location_lat DECIMAL(10, 8),
  location_lng DECIMAL(11, 8),
  location_text VARCHAR(255),
  image_urls TEXT[], -- JSON array of image URLs
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  published_at TIMESTAMP,
  deleted_at TIMESTAMP
);

CREATE INDEX idx_listings_user_id ON marketplace_listings(user_id);
CREATE INDEX idx_listings_status ON marketplace_listings(status);
CREATE INDEX idx_listings_created_at ON marketplace_listings(created_at DESC);
```

### marketplace_audit_logs
```sql
CREATE TABLE marketplace_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES marketplace_listings(id),
  actor_id UUID NOT NULL REFERENCES auth.users(id),
  action VARCHAR(50) NOT NULL, -- CREATE, UPDATE, DELETE, PUBLISH, SOLD
  entity_type VARCHAR(50) NOT NULL DEFAULT 'listing',
  
  -- What changed
  changes JSONB, -- {old: {...}, new: {...}}
  
  -- Context
  ip_address INET,
  user_agent TEXT,
  request_id VARCHAR(36),
  
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_listing ON marketplace_audit_logs(listing_id);
CREATE INDEX idx_audit_actor ON marketplace_audit_logs(actor_id);
CREATE INDEX idx_audit_created ON marketplace_audit_logs(created_at DESC);
```

### marketplace_metrics
```sql
CREATE TABLE marketplace_metrics (
  id BIGSERIAL PRIMARY KEY,
  period_start TIMESTAMP NOT NULL,
  period_end TIMESTAMP NOT NULL,
  
  -- Counters
  total_listings BIGINT,
  active_listings BIGINT,
  new_listings BIGINT,
  sold_listings BIGINT,
  
  -- Money metrics (kobo)
  total_gmv_kobo BIGINT,
  avg_price_kobo BIGINT,
  
  -- User metrics
  unique_sellers BIGINT,
  unique_buyers BIGINT,
  
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_metrics_period ON marketplace_metrics(period_start DESC);
```

---

## 2. Backend API Endpoints

### REST API

#### Listings
```
GET    /api/v1/marketplace/listings          # List all (paginated, filtered)
GET    /api/v1/marketplace/listings/:id      # Get single listing
POST   /api/v1/marketplace/listings          # Create listing (auth required)
PUT    /api/v1/marketplace/listings/:id      # Update listing (auth required)
DELETE /api/v1/marketplace/listings/:id      # Delete listing (soft delete)

GET    /api/v1/marketplace/listings/:id/audit # Get audit trail for listing
```

#### Admin
```
GET    /api/v1/admin/marketplace/listings    # All listings (admin only)
GET    /api/v1/admin/marketplace/metrics     # Real-time metrics
GET    /api/v1/admin/marketplace/audit-logs  # All audit logs
GET    /api/v1/admin/marketplace/activity    # Live activity stream
```

### WebSocket / Server-Sent Events

```
WS     /ws/marketplace/updates               # Real-time listing updates
SSE    /api/v1/admin/marketplace/events      # Admin real-time events
```

---

## 3. Go Backend Implementation

### Service Layer

```go
// marketplace/service.go
type MarketplaceService struct {
  db *pgxpool.Pool
  redis *redis.Client
  realtime *realtime.Engine
  audit *AuditLogger
}

// CRUD Operations
func (s *MarketplaceService) CreateListing(ctx context.Context, input CreateListingInput, userID string) (*Listing, error)
func (s *MarketplaceService) ListListings(ctx context.Context, filter ListFilter) ([]*Listing, error)
func (s *MarketplaceService) GetListing(ctx context.Context, id string) (*Listing, error)
func (s *MarketplaceService) UpdateListing(ctx context.Context, id string, input UpdateListingInput) (*Listing, error)
func (s *MarketplaceService) DeleteListing(ctx context.Context, id string) error

// Audit & Analytics
func (s *MarketplaceService) GetAuditTrail(ctx context.Context, listingID string) ([]*AuditLog, error)
func (s *MarketplaceService) GetMetrics(ctx context.Context, period Period) (*Metrics, error)
```

### Audit Logger

```go
// marketplace/audit.go
type AuditLogger struct {
  db *pgxpool.Pool
}

func (a *AuditLogger) LogAction(ctx context.Context, log *AuditLogEntry) error {
  // 1. Validate input
  // 2. Insert into database (transactional)
  // 3. Publish to WebSocket subscribers
  // 4. Update metrics
}
```

### Real-time Engine

```go
// realtime/engine.go
type Engine struct {
  subscribers map[string][]chan Event
  mu sync.RWMutex
}

func (e *Engine) Subscribe(ctx context.Context, channel string) <-chan Event
func (e *Engine) Publish(channel string, event Event) error
func (e *Engine) BroadcastListingUpdate(listing *Listing, action string)
```

---

## 4. Mobile Integration (React Native)

### API Service

```typescript
// src/features/marketplace/api/marketplace.api.ts
export class MarketplaceApi {
  async createListing(input: CreateListingInput): Promise<Listing>
  async updateListing(id: string, input: UpdateListingInput): Promise<Listing>
  async deleteListing(id: string): Promise<void>
  async getAuditTrail(listingId: string): Promise<AuditLog[]>
}
```

### Real-time Hook

```typescript
// src/features/marketplace/hooks/useMarketplaceUpdates.ts
export function useMarketplaceUpdates() {
  // Subscribes to WebSocket
  // Updates local state on events
  // Syncs with admin dashboard
}
```

---

## 5. Admin Dashboard Integration

### Real-time Components

```typescript
// frontend-admin/app/admin/marketplace/page.tsx
export default function MarketplaceAdminPage() {
  // Display:
  // 1. Live listing feed
  // 2. Activity log (real-time)
  // 3. Metrics dashboard (updating live)
  // 4. User actions
}
```

### Activity Component

```typescript
// Real-time activity log
- Listing created (user, title, price)
- Listing updated (what changed)
- Listing published (when)
- Messages sent
- Offers made
- Orders placed
```

---

## 6. Implementation Checklist

### Phase 1: Database & Backend (THIS PHASE)
- [ ] Create audit log table
- [ ] Create metrics table
- [ ] Implement AuditLogger service
- [ ] Implement MarketplaceService CRUD
- [ ] Add audit logging to all CRUD operations
- [ ] Implement WebSocket endpoint for real-time updates
- [ ] Create REST endpoints for admin

### Phase 2: Real-time Infrastructure
- [ ] Set up real-time engine (publish/subscribe)
- [ ] Connect WebSocket to real-time engine
- [ ] Add Server-Sent Events for admin
- [ ] Test subscription model

### Phase 3: Mobile Integration
- [ ] Create marketplace API service
- [ ] Wire CRUD operations to backend
- [ ] Add real-time hooks
- [ ] Test mobile ↔ backend connectivity

### Phase 4: Admin Dashboard
- [ ] Create marketplace admin page
- [ ] Implement activity log component
- [ ] Add metrics dashboard
- [ ] Connect real-time events

### Phase 5: Testing & Polish
- [ ] End-to-end testing
- [ ] Performance testing
- [ ] Error handling
- [ ] UI/UX polish

---

## 7. Example Flow: Create Listing

```
1. User (mobile) fills listing form
   - Title, price, images, category, condition
   
2. Mobile validates input (client-side)
   
3. Mobile calls: POST /api/v1/marketplace/listings
   {
     "title": "iPhone 14 Pro",
     "price_kobo": 80000000,
     "category": "electronics",
     "condition": "like_new",
     "description": "Mint condition",
     "location": {...}
   }
   
4. Backend receives request
   - Validates input (server-side)
   - Starts transaction
   - Creates listing record (status=DRAFT)
   - Logs action: {action: CREATE, changes: {...}}
   - Publishes event: {type: LISTING_CREATED, listing: {...}}
   - Commits transaction
   - Returns response with listing ID
   
5. Mobile receives response
   - Updates local state
   - Navigates to success screen
   
6. Admin (if subscribed) receives event
   - Real-time notification: "New listing from John"
   - Live activity log updates
   - Metrics refresh
   
7. Admin can:
   - View listing details
   - See full audit trail
   - Approve/flag for review
   - Contact seller
```

---

## 8. Real-time Data Flow

```
Mobile App                          Backend                         Admin Dashboard
    │                                  │                                  │
    │─── Create Listing ──────────────→│                                  │
    │                                  │                                  │
    │                     ┌───────────────────────────┐                   │
    │                     │ Transaction:             │                   │
    │                     │ 1. Create listing         │                   │
    │                     │ 2. Log action             │                   │
    │                     │ 3. Publish event          │                   │
    │                     │ 4. Update metrics         │                   │
    │                     └───────────────────────────┘                   │
    │                                  │                                  │
    │  ←────── Response ───────────────│                                  │
    │                                  │                                  │
    │                                  │────── WebSocket Event ──────────→│
    │                                  │ (listing_created)                │
    │                                  │                                  │
    │                                  │────── Metrics Update ───────────→│
    │                                  │ (new_listings + 1)               │
    │                                  │                                  │
    │                                  │────── Activity Log ─────────────→│
    │                                  │ (user, action, listing)          │
    │                                  │                                  │
    │                  Admin Dashboard Updates in Real-Time               │
```

---

## 9. Security & Authorization

```
CREATE (mobile user can create own listing)
  ✅ Authenticated user
  ✅ Listing owner = current user
  ✗ Cannot bypass KYC verification

UPDATE (mobile user can only edit own draft listings)
  ✅ Authenticated user
  ✅ Listing owner = current user
  ✅ Listing status = DRAFT or PUBLISHED
  ✗ Cannot edit sold listings

DELETE (mobile user can soft-delete own listings)
  ✅ Authenticated user
  ✅ Listing owner = current user
  ✗ Cannot delete once sold

ADMIN endpoints (admin only)
  ✅ Has admin role
  ✅ Audit logs are read-only
  ✗ Cannot modify user listings
  ✓ Can flag/review
```

---

## 10. Monitoring & Logging

### Structured Logs
```json
{
  "timestamp": "2026-08-08T15:30:45Z",
  "level": "INFO",
  "component": "marketplace",
  "action": "CREATE_LISTING",
  "user_id": "user123",
  "listing_id": "listing456",
  "price_kobo": 80000000,
  "duration_ms": 234,
  "status": "success"
}
```

### Metrics Tracked
- Listings created/updated/deleted per hour
- Average listing price
- Category breakdown
- Response times
- Error rates
- Real-time user count
- Active listings count

---

**Status: READY FOR IMPLEMENTATION** ✅

Next steps:
1. Create database migrations
2. Implement backend services
3. Wire mobile CRUD operations
4. Build admin dashboard
5. Test end-to-end
