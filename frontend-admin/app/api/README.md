# Shared Contest APIs

These APIs provide unified access to contest data for **Admin Portal**, **Mobile App**, and **Frontend Web**.

## Base URL
- **Admin/Web**: `http://localhost:3001/api`
- **Mobile (Production)**: `https://yourdomain.com/api`

## API Endpoints

### 1. **GET /contests** - List all contests
```bash
curl http://localhost:3001/api/contests
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "1",
      "name": "Open Mic Q3",
      "description": "Quarter 3 Open Mic competition",
      "status": "active",
      "startDate": "2024-07-01",
      "endDate": "2024-09-30",
      "participantCount": 3,
      "totalVotes": 87
    }
  ],
  "count": 2
}
```

---

### 2. **GET /contestants** - List contestants
**Query Parameters:**
- `competitionId` (optional) - Filter by competition
- `id` (optional) - Get specific contestant

```bash
# Get all contestants
curl http://localhost:3001/api/contestants

# Get contestants in a competition
curl http://localhost:3001/api/contestants?competitionId=1

# Get specific contestant
curl http://localhost:3001/api/contestants?id=2
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "1",
      "name": "Chioma Okonkwo",
      "email": "chioma@example.com",
      "phone": "+234 805 678 9012",
      "gender": "Female",
      "competition": "Open Mic Q3",
      "competitionId": "1",
      "status": "qualified",
      "registrationDate": "2024-07-15",
      "contestantNumber": "OM-Q3-0041",
      "bio": "Award-winning poet...",
      "score": 87,
      "totalVotes": 15,
      "adminVotes": 15,
      "freeVotes": 0,
      "paidVotes": 0
    }
  ],
  "count": 1
}
```

---

### 3. **GET /voting/contestant/[id]** - Get contestant votes
```bash
curl http://localhost:3001/api/voting/contestant/1
```

**Response:**
```json
{
  "adminVotes": 15,
  "auditLog": [
    {
      "id": "uuid",
      "contestant_id": "1",
      "vote_amount": 15,
      "admin_name": "Admin",
      "created_at": "2024-08-11T17:50:36.000Z"
    }
  ],
  "voteStats": {
    "free_votes": 0,
    "paid_votes": 0,
    "admin_votes": 15,
    "total_votes": 15
  }
}
```

---

### 4. **POST /voting/contestant/[id]** - Add votes for contestant
```bash
curl -X POST http://localhost:3001/api/voting/contestant/1 \
  -H "Content-Type: application/json" \
  -d '{
    "voteCount": 10,
    "adminName": "Admin",
    "adminId": "system",
    "competitionId": "Open Mic Q3"
  }'
```

**Response:**
```json
{
  "success": true,
  "totalVotes": 25,
  "timestamp": "2024-08-11T17:51:46.000Z"
}
```

---

### 5. **GET /voting/stats** - Get vote statistics
**Query Parameters:**
- `contestantId` (optional) - Filter by contestant
- `competitionId` (optional) - Filter by competition

```bash
# Get all vote stats
curl http://localhost:3001/api/voting/stats

# Get stats for specific contestant
curl http://localhost:3001/api/voting/stats?contestantId=1

# Get stats for competition
curl http://localhost:3001/api/voting/stats?competitionId=1
```

---

### 6. **GET /leaderboard** - Get contest leaderboard
**Query Parameters:**
- `competitionId` (optional) - Filter by competition
- `limit` (optional) - Number of results (default: 100)

```bash
# Get global leaderboard
curl http://localhost:3001/api/leaderboard

# Get top 10 for competition
curl http://localhost:3001/api/leaderboard?competitionId=1&limit=10
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "rank": 1,
      "contestantId": "2",
      "name": "Tunde Adeyemi",
      "competition": "Open Mic Q3",
      "totalVotes": 36,
      "adminVotes": 36,
      "status": "pending"
    },
    {
      "rank": 2,
      "contestantId": "3",
      "name": "Amara Ejiro",
      "competition": "Reality TV",
      "totalVotes": 25,
      "adminVotes": 25,
      "status": "qualified"
    }
  ],
  "count": 2,
  "total": 4
}
```

---

## Integration Guide

### Mobile App (React Native)
```javascript
// Fetch contestants
const response = await fetch('http://localhost:3001/api/contestants?competitionId=1');
const { data } = await response.json();

// Get leaderboard
const leaderboard = await fetch('http://localhost:3001/api/leaderboard?limit=10');
const { data: rankings } = await leaderboard.json();
```

### Frontend Web (Next.js)
```typescript
// Fetch from frontend route
const response = await fetch('/api/contestants?competitionId=1');
const { data } = await response.json();
```

### Admin Portal
All APIs are available at `/api/` prefix.

---

## Data Synchronization

All platforms use the same API endpoints, ensuring:
- ✅ **Unified data** - Single source of truth
- ✅ **Real-time updates** - All platforms see same votes
- ✅ **Consistent rankings** - Leaderboard synced across platforms
- ✅ **Audit trail** - All votes tracked in database

---

## Error Handling

All endpoints return standard error format:
```json
{
  "error": "Description of error"
}
```

**HTTP Status Codes:**
- `200` - Success
- `400` - Bad request
- `404` - Not found
- `500` - Server error
