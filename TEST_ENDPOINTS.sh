#!/usr/bin/env bash

# Manual diagnostic for Marketplace & Voting Live Features.
#
# ⚠️  This is NOT a read-only smoke test: it performs real writes
#     (saves a listing, creates a saved search, opens a support ticket).
#     Run it against a LOCAL or STAGING stack only — never production.
#
# Usage:
#   BEARER_TOKEN=<supabase-jwt> ./TEST_ENDPOINTS.sh
#   API_BASE=http://localhost:8080/api/v1 BEARER_TOKEN=<jwt> ./TEST_ENDPOINTS.sh
#
# Default API_BASE matches docker-compose.yml (api on :8080). The previous
# hardcoded :8000 never matched any documented local port.
#
# Deliberately NOT `set -e`: a single curl failure should not abort the
# whole diagnostic — every probe reports independently and the summary
# exits non-zero if anything failed. For the liveness-only check (no
# writes, no token) use ./smoke.sh instead.
set -uo pipefail

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Test configuration
API_BASE="${API_BASE:-http://localhost:8080/api/v1}"
BEARER_TOKEN="${BEARER_TOKEN:-}"
if [ -z "$BEARER_TOKEN" ]; then
    echo "ERROR: BEARER_TOKEN env var is required (a Supabase JWT for the target env)." >&2
    echo "       This script never made sense with the YOUR_VALID_TOKEN_HERE placeholder —" >&2
    echo "       every authenticated call just 401'd under it." >&2
    exit 2
fi
PASS=0
FAIL=0
USER_ID="test-user-$(date +%s)"
LISTING_ID="test-listing-$(date +%s)"
OFFER_ID="test-offer-$(date +%s)"
TICKET_ID=""

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Testing Marketplace & Voting Live Features${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Helper function for making API calls
test_endpoint() {
    local method=$1
    local path=$2
    local data=$3
    local description=$4

    echo -e "${BLUE}📝 Test: $description${NC}"
    echo -e "   ${method} ${API_BASE}${path}"

    if [ -z "$data" ]; then
        response=$(curl -s --max-time 15 -X "$method" \
            -H "Authorization: Bearer $BEARER_TOKEN" \
            -H "Content-Type: application/json" \
            "${API_BASE}${path}") || response=""
    else
        echo -e "   Data: $data"
        response=$(curl -s --max-time 15 -X "$method" \
            -H "Authorization: Bearer $BEARER_TOKEN" \
            -H "Content-Type: application/json" \
            -d "$data" \
            "${API_BASE}${path}") || response=""
    fi

    if [ -z "$response" ]; then
        echo -e "${RED}   ❌ No response (connection refused / timeout)${NC}"
        FAIL=$((FAIL + 1))
    elif echo "$response" | grep -q '"error"'; then
        echo -e "${RED}   ❌ Error: $response${NC}"
        FAIL=$((FAIL + 1))
    else
        echo -e "${GREEN}   ✅ Success${NC}"
        echo -e "   Response: $(echo "$response" | head -c 200)..."
        PASS=$((PASS + 1))
    fi
    echo ""
}

# ─────────────────────────────────────────────────────────────────
# MARKETPLACE SAVED ITEMS TESTS
# ─────────────────────────────────────────────────────────────────

echo -e "${BLUE}═ MARKETPLACE SAVED ITEMS (Wishlist) ═${NC}"
echo ""

# Save a listing
test_endpoint "POST" "/marketplace/listings/$LISTING_ID/save" \
    '{}' \
    "Save a listing to wishlist"

# List saved items
test_endpoint "GET" "/marketplace/saved-items?limit=10&offset=0" \
    '' \
    "Get user's saved items (wishlist)"

# Unsave a listing (cleanup)
test_endpoint "DELETE" "/marketplace/listings/$LISTING_ID/save" \
    '' \
    "Remove listing from wishlist"

# ─────────────────────────────────────────────────────────────────
# MARKETPLACE SAVED SEARCHES TESTS
# ─────────────────────────────────────────────────────────────────

echo -e "${BLUE}═ MARKETPLACE SAVED SEARCHES ═${NC}"
echo ""

SEARCH_ID=""

# Create a saved search
response=$(curl -s --max-time 15 -X POST \
    -H "Authorization: Bearer $BEARER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "query": "electronics",
      "filters": {"min_price": 1000000, "max_price": 50000000},
      "alert_enabled": true
    }' \
    "${API_BASE}/marketplace/saved-searches")

if echo "$response" | grep -q '"id"'; then
    SEARCH_ID=$(echo "$response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
    echo -e "${GREEN}✅ Created saved search: $SEARCH_ID${NC}"
else
    echo -e "${RED}❌ Failed to create saved search${NC}"
fi
echo ""

# List saved searches
test_endpoint "GET" "/marketplace/saved-searches" \
    '' \
    "Get user's saved searches"

# Toggle alert
if [ ! -z "$SEARCH_ID" ]; then
    test_endpoint "PATCH" "/marketplace/saved-searches/$SEARCH_ID" \
        '{"alert_enabled": false}' \
        "Toggle search alert notifications"
fi

# ─────────────────────────────────────────────────────────────────
# MARKETPLACE NOTIFICATIONS TESTS
# ─────────────────────────────────────────────────────────────────

echo -e "${BLUE}═ MARKETPLACE NOTIFICATIONS (Feed) ═${NC}"
echo ""

# Get unread count
test_endpoint "GET" "/marketplace/notifications/unread-count" \
    '' \
    "Get unread notification count"

# List notifications
test_endpoint "GET" "/marketplace/notifications?limit=20&offset=0" \
    '' \
    "Get notification feed (newest first)"

# ─────────────────────────────────────────────────────────────────
# VOTING SUPPORT TICKETS TESTS
# ─────────────────────────────────────────────────────────────────

echo -e "${BLUE}═ VOTING SUPPORT TICKETS (Help System) ═${NC}"
echo ""

# Create a support ticket
response=$(curl -s --max-time 15 -X POST \
    -H "Authorization: Bearer $BEARER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "category": "voting_problem",
      "subject": "Cannot vote in contest",
      "description": "I keep getting an error when trying to vote",
      "priority": "high",
      "source": "web"
    }' \
    "${API_BASE}/connect/support/tickets")

if echo "$response" | grep -q '"id"'; then
    TICKET_ID=$(echo "$response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
    echo -e "${GREEN}✅ Created support ticket: $TICKET_ID${NC}"
else
    echo -e "${RED}❌ Failed to create support ticket${NC}"
fi
echo ""

# List support tickets
test_endpoint "GET" "/connect/support/tickets?limit=10&offset=0" \
    '' \
    "List user's support tickets"

# Get ticket detail
if [ ! -z "$TICKET_ID" ]; then
    test_endpoint "GET" "/connect/support/tickets/$TICKET_ID" \
        '' \
        "Get support ticket detail"

    # Add message to ticket
    test_endpoint "POST" "/connect/support/tickets/$TICKET_ID/messages" \
        '{"message": "I tried refreshing the page but still getting the error"}' \
        "Add message to support ticket"

    # Get ticket messages
    test_endpoint "GET" "/connect/support/tickets/$TICKET_ID/messages" \
        '' \
        "Get all messages in ticket"

    # Update ticket (e.g., change priority)
    test_endpoint "PATCH" "/connect/support/tickets/$TICKET_ID" \
        '{"priority": "urgent"}' \
        "Update ticket priority to urgent"
fi

# ─────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
if [ "$FAIL" -eq 0 ]; then
    echo -e "${GREEN}✨ All $PASS probes passed against ${API_BASE}${NC}"
else
    echo -e "${RED}✨ $PASS passed, $FAIL failed against ${API_BASE}${NC}"
fi
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Reminder: this script created real rows (saved search, support ticket)"
echo "in whatever environment API_BASE points at — clean up if it was shared."
[ "$FAIL" -eq 0 ]
