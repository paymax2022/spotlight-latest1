# Marketplace & Voting Live Features

## Overview

This document describes the complete implementation of three live features across the Marketplace and Voting modules:

1. **Marketplace Saved Items** - ✅ Full DB-backed wishlist
2. **Marketplace Saved Searches** - ✅ Full DB-backed saved searches  
3. **Marketplace Notifications** - ✅ NEW: Real notifications feed (distinct from preferences)
4. **Voting Support Tickets** - ✅ NEW: Help/support system for voting module

---

## 1. Marketplace Saved Items (Wishlist)

**Status**: ✅ Fully Implemented & Live

### Endpoints

**POST** `/api/v1/marketplace/listings/:id/save`
- Save a listing to user's wishlist
- Returns: `SavedItem` object
- Status: `201 Created`

**DELETE** `/api/v1/marketplace/listings/:id/save`
- Remove a listing from wishlist
- Returns: `{ok: true}`
- Status: `200 OK`

**GET** `/api/v1/marketplace/saved-items`
- List user's saved items (newest first)
- Query params: `limit`, `offset`
- Returns: Array of `SavedItem` objects
- Status: `200 OK`

### Database
- Table: `mkt_saved_items`
- Fields: `id`, `user_id`, `listing_id`, `saved_price_kobo`, `created_at`
- Unique constraint: `(user_id, listing_id)` - one save per listing

### Features
- Price change tracking (saves the price at time of save)
- Newest-first ordering
- Pagination support

---

## 2. Marketplace Saved Searches

**Status**: ✅ Fully Implemented & Live

### Endpoints

**POST** `/api/v1/marketplace/saved-searches`
- Create a saved search
- Body: `{query, filters, alertEnabled}`
- Returns: `SavedSearch` object
- Status: `201 Created`

**GET** `/api/v1/marketplace/saved-searches`
- List user's saved searches
- Returns: Array of `SavedSearch` objects
- Status: `200 OK`

**DELETE** `/api/v1/marketplace/saved-searches/:id`
- Delete a saved search
- Returns: `{ok: true}`
- Status: `200 OK`

**PATCH** `/api/v1/marketplace/saved-searches/:id`
- Toggle alert for a saved search
- Body: `{alertEnabled: boolean}`
- Returns: Updated `SavedSearch`
- Status: `200 OK`

### Database
- Table: `mkt_saved_searches`
- Fields: `id`, `user_id`, `market_id`, `query`, `filters`, `alert_enabled`, `last_notified_at`, `created_at`

### Features
- Query + advanced filters persistence
- Optional alert notifications when new matches found
- Last notification tracking for alert deduplication

---

## 3. Marketplace Notifications Feed

**Status**: ✅ NEW - Fully Implemented & Live

**Note**: This is distinct from notification *preferences* (`/notification-prefs`). Preferences control *which* notifications a user wants; this feed shows the *actual* notifications sent.

### Endpoints

**GET** `/api/v1/marketplace/notifications`
- Get user's notification feed
- Query params: `limit` (default 20, max 100), `offset` (default 0)
- Returns: Array of `Notification` objects, newest first
- Status: `200 OK`

**GET** `/api/v1/marketplace/notifications/unread-count`
- Get count of unread notifications
- Returns: `{unread_count: number}`
- Status: `200 OK`

**PATCH** `/api/v1/marketplace/notifications/:id`
- Mark a notification as read
- Returns: Updated `Notification` object
- Status: `200 OK`

**PATCH** `/api/v1/marketplace/notifications/mark-all-read`
- Mark all notifications as read
- Returns: `{ok: true}`
- Status: `200 OK`

**DELETE** `/api/v1/marketplace/notifications/:id`
- Dismiss/delete a notification
- Returns: `{ok: true}`
- Status: `200 OK`

### Database
- Table: `mkt_notifications`
- Fields: `id`, `user_id`, `market_id`, `type`, `title`, `body`, `data` (JSONB), `related_id`, `is_read`, `read_at`, `created_at`

### Notification Types

| Type | Trigger | Example |
|------|---------|---------|
| `new_offer` | Buyer made offer | "New offer on your listing" |
| `offer_accepted` | Seller accepted your offer | "Your offer was accepted" |
| `offer_declined` | Seller declined your offer | "Your offer was declined" |
| `offer_countered` | Seller countered your offer | "You got a counter-offer" |
| `price_dropped` | Price changed on saved item | "Price dropped on saved item" |
| `listing_ending_soon` | Saved listing expiring in 7 days | "Your saved listing expires soon" |
| `low_stock` | Saved item stock low | "Low stock on saved item" |
| `boost_expiring` | Your boost ending soon | "Your boost is expiring" |
| `boost_ended` | Your boost ended | "Your boost has ended" |
| `message_new` | New message in thread | "You have a new message" |
| `deal_marked_met` | Buyer marked deal met | "Deal marked as complete" |
| `review_requested` | Review window opening | "Time to leave a review" |
| `support_reply` | Response to support ticket | "Support team replied" |

### Sample Notification Object
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "user_id": "user-123",
  "type": "new_offer",
  "title": "New offer on your listing",
  "body": "Someone made an offer for ₦25,000",
  "data": {
    "listing_id": "listing-456",
    "offer_id": "offer-789",
    "offer_price_kobo": 2500000
  },
  "related_id": "offer-789",
  "is_read": false,
  "read_at": null,
  "created_at": "2026-09-13T10:30:00Z"
}
```

### Internal Methods

**Create Notification** (used by internal services)
```go
func (s *Service) CreateNotification(ctx, userID, type, title, body, relatedID, data)
```

**Broadcast to Multiple Users** (for alerts like price drops)
```go
func (s *Service) BroadcastNotification(ctx, userIDs, type, title, body, relatedID, data)
```

---

## 4. Voting Support Tickets System

**Status**: ✅ NEW - Fully Implemented & Live

### Endpoints

**POST** `/api/v1/connect/support/tickets`
- Create a new support ticket
- Body:
  ```json
  {
    "category": "voting_problem",
    "subject": "Can't vote in contest",
    "description": "Getting error when trying to vote",
    "priority": "high",
    "contest_id": "contest-123",
    "source": "web"
  }
  ```
- Returns: `SupportTicket` object
- Status: `201 Created`

**GET** `/api/v1/connect/support/tickets`
- List user's support tickets
- Query params: `status` (optional filter), `limit` (1-100), `offset`
- Returns: Array of `SupportTicket` objects
- Status: `200 OK`

**GET** `/api/v1/connect/support/tickets/:id`
- Get ticket detail
- Returns: Single `SupportTicket` object
- Status: `200 OK`

**PATCH** `/api/v1/connect/support/tickets/:id`
- Update ticket (limited fields for users)
- Body:
  ```json
  {
    "status": "waiting",
    "priority": "urgent",
    "description": "Updated description"
  }
  ```
- Returns: Updated `SupportTicket`
- Status: `200 OK`

**POST** `/api/v1/connect/support/tickets/:id/messages`
- Add message to ticket
- Body:
  ```json
  {
    "message": "Additional info about the issue",
    "attachments": ["https://example.com/screenshot.png"]
  }
  ```
- Returns: `TicketMessage` object
- Status: `201 Created`

**GET** `/api/v1/connect/support/tickets/:id/messages`
- Get all messages in a ticket (oldest first)
- Returns: Array of `TicketMessage` objects
- Status: `200 OK`

### Database

**Table: `voting_support_tickets`**
- Fields: `id`, `user_id`, `contest_id`, `category`, `status`, `subject`, `description`, `priority`, `source`, `assigned_to`, `resolution_notes`, `created_at`, `updated_at`, `resolved_at`

**Table: `voting_ticket_messages`**
- Fields: `id`, `ticket_id`, `author_id`, `is_internal`, `message`, `attachments`, `created_at`

### Support Ticket Categories

- `account_issue` - Account/login problems
- `voting_problem` - Can't vote, voting not working
- `contest_question` - Question about contest/rules
- `billing_issue` - Payment/billing related
- `bug_report` - Found a bug
- `feature_request` - Feature/improvement suggestion
- `other` - Miscellaneous

### Support Ticket Status

- `open` - Newly created, awaiting review
- `in_progress` - Support agent actively working
- `waiting` - Waiting for user response
- `resolved` - Issue resolved
- `closed` - Ticket closed

### Support Ticket Priority

- `low` - Can wait
- `normal` - Standard priority
- `high` - Important
- `urgent` - Critical/blocking issue

### Sample Ticket Object
```json
{
  "id": "ticket-123",
  "user_id": "user-456",
  "contest_id": "contest-789",
  "category": "voting_problem",
  "status": "in_progress",
  "subject": "Can't vote in contest",
  "description": "Getting error when trying to vote. Error says 'Invalid vote'",
  "priority": "high",
  "source": "mobile",
  "assigned_to": "support-agent-001",
  "resolution_notes": null,
  "created_at": "2026-09-13T09:00:00Z",
  "updated_at": "2026-09-13T10:30:00Z",
  "resolved_at": null
}
```

---

## Database Migrations

**Migration File**: `supabase/migrations/20260913000000_marketplace_notifications_and_voting_support.sql`

Includes:
- `mkt_notification_type` enum
- `mkt_notifications` table + indexes
- `voting_ticket_status` enum
- `voting_ticket_category` enum
- `voting_support_tickets` table + indexes
- `voting_ticket_messages` table + indexes

---

## Integration Guide

### For Frontend/Mobile Apps

1. **Marketplace Notifications**
   - Poll `/api/v1/marketplace/notifications` periodically
   - Show unread count from `/api/v1/marketplace/notifications/unread-count`
   - Mark as read when user views notification
   - Dismiss button calls DELETE endpoint

2. **Marketplace Saved Items**
   - "Save" button calls POST `/listings/:id/save`
   - "Wishlist" page fetches from GET `/saved-items`
   - Price change badges compare current vs `saved_price_kobo`

3. **Marketplace Saved Searches**
   - "Save search" dialog captures filters + query
   - Toggle alert notifications with PATCH endpoint
   - List saved searches on "Discover" or "Home" screen

4. **Voting Support Tickets**
   - "Help" or "Support" button opens ticket creation
   - Show status badge ("open", "in progress", "resolved")
   - Add messages to open/in-progress tickets
   - Resolved tickets show resolution notes

### For Backend Services

#### Auto-Generate Notifications

After creating an offer:
```go
s.CreateNotification(ctx, sellerID, "new_offer", "New offer on your listing", 
  fmt.Sprintf("Someone made an offer for ₦%d", offerPriceKobo),
  offerID, map[string]interface{}{
    "listing_id": listingID,
    "offer_id": offerID,
    "offer_price_kobo": offerPriceKobo,
  })
```

After price change on a listing:
```go
// Find all users who saved this listing
savedByUserIDs := ... // query mkt_saved_items
s.BroadcastNotification(ctx, savedByUserIDs, "price_dropped",
  "Price dropped on saved item", 
  fmt.Sprintf("Price down to ₦%d from ₦%d", newPrice, oldPrice),
  listingID, map[string]interface{}{
    "listing_id": listingID,
    "new_price_kobo": newPrice,
    "old_price_kobo": oldPrice,
  })
```

---

## Testing

### Test the Endpoints

```bash
# Create a saved item
curl -X POST http://localhost:8000/api/v1/marketplace/listings/550e8400/save \
  -H "Authorization: Bearer TOKEN"

# List saved items
curl http://localhost:8000/api/v1/marketplace/saved-items \
  -H "Authorization: Bearer TOKEN"

# Get notifications
curl http://localhost:8000/api/v1/marketplace/notifications?limit=20 \
  -H "Authorization: Bearer TOKEN"

# Create support ticket
curl -X POST http://localhost:8000/api/v1/connect/support/tickets \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"category": "voting_problem", "subject": "Can'"'"'t vote", ...}'
```

---

## Status Summary

| Feature | Live | DB-Backed | Admin Support |
|---------|------|-----------|---------------|
| Saved Items | ✅ | ✅ | - |
| Saved Searches | ✅ | ✅ | - |
| Notifications Feed | ✅ | ✅ | Partial (admin can view, message) |
| Voting Support | ✅ | ✅ | ✅ (Full CRUD) |

All features are **fully operational** with **real database persistence** and **live APIs**.
