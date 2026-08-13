# Contest Module API Integration Guide

## Overview
The Admin Portal provides unified APIs for contest and voting data that can be consumed by:
- 📱 **Mobile App** (React Native/Expo)
- 🌐 **Frontend Web** (Next.js)
- 🛡️ **Admin Portal** (Next.js)

All platforms sync data in real-time through these APIs.

---

## Quick Start

### API Base URLs
```
Admin/Web Dev:   http://localhost:3001/api
Admin/Web Prod:  https://yourdomain.com/api
Mobile Dev:      http://localhost:3001/api (via tunnel/proxy)
Mobile Prod:     https://yourdomain.com/api
```

### Available Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/contests` | GET | List all contests |
| `/contestants` | GET | List contestants (filter by competition) |
| `/voting/contestant/:id` | GET | Get votes for contestant |
| `/voting/contestant/:id` | POST | Add votes for contestant |
| `/voting/stats` | GET | Vote statistics |
| `/leaderboard` | GET | Leaderboard rankings |

---

## Mobile App Integration (React Native)

### 1. Install Dependencies
```bash
cd mobile-app/reactnative
npm install axios
```

### 2. Create API Service
```typescript
// mobile-app/reactnative/src/services/contestApi.ts
import axios from 'axios';
import { Contest, Contestant, LeaderboardEntry } from './types';

const API_BASE_URL = 'http://localhost:3001/api'; // Dev
// const API_BASE_URL = 'https://yourdomain.com/api'; // Prod

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

export const contestApi = {
  // Get all contests
  getContests: async (): Promise<Contest[]> => {
    const { data } = await api.get('/contests');
    return data.data;
  },

  // Get contestants for a competition
  getContestants: async (competitionId?: string): Promise<Contestant[]> => {
    const params = competitionId ? { competitionId } : {};
    const { data } = await api.get('/contestants', { params });
    return data.data;
  },

  // Get specific contestant
  getContestant: async (id: string): Promise<Contestant> => {
    const { data } = await api.get('/contestants', { params: { id } });
    return data.data[0];
  },

  // Get leaderboard
  getLeaderboard: async (competitionId?: string, limit = 20): Promise<LeaderboardEntry[]> => {
    const params = { limit };
    if (competitionId) params.competitionId = competitionId;
    const { data } = await api.get('/leaderboard', { params });
    return data.data;
  },

  // Get contestant votes
  getContestantVotes: async (contestantId: string) => {
    const { data } = await api.get(`/voting/contestant/${contestantId}`);
    return data;
  },
};
```

### 3. Use in Components
```typescript
// mobile-app/reactnative/src/screens/ContestantsScreen.tsx
import { useEffect, useState } from 'react';
import { contestApi } from '../services/contestApi';
import { Contestant } from '../services/types';

export function ContestantsScreen() {
  const [contestants, setContestants] = useState<Contestant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadContestants() {
      try {
        const data = await contestApi.getContestants('1'); // Competition ID 1
        setContestants(data);
      } catch (error) {
        console.error('Failed to load contestants:', error);
      } finally {
        setLoading(false);
      }
    }

    loadContestants();
  }, []);

  if (loading) return <Text>Loading...</Text>;

  return (
    <ScrollView>
      {contestants.map(contestant => (
        <ContestantCard key={contestant.id} contestant={contestant} />
      ))}
    </ScrollView>
  );
}
```

### 4. Leaderboard in Mobile
```typescript
// mobile-app/reactnative/src/screens/LeaderboardScreen.tsx
import { useEffect, useState } from 'react';
import { contestApi } from '../services/contestApi';

export function LeaderboardScreen() {
  const [leaderboard, setLeaderboard] = useState([]);

  useEffect(() => {
    contestApi.getLeaderboard('1', 10).then(setLeaderboard);
  }, []);

  return (
    <FlatList
      data={leaderboard}
      keyExtractor={item => item.contestantId}
      renderItem={({ item, index }) => (
        <View style={styles.row}>
          <Text style={styles.rank}>#{item.rank}</Text>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.votes}>{item.totalVotes} votes</Text>
        </View>
      )}
    />
  );
}
```

---

## Frontend Web Integration (Next.js)

### 1. Create API Client
```typescript
// frontend-web/src/lib/api/contest.ts
export const contestApi = {
  getContests: async () => {
    const res = await fetch('http://localhost:3001/api/contests');
    return res.json();
  },

  getContestants: async (competitionId?: string) => {
    const query = competitionId ? `?competitionId=${competitionId}` : '';
    const res = await fetch(`http://localhost:3001/api/contestants${query}`);
    return res.json();
  },

  getLeaderboard: async (competitionId?: string, limit = 20) => {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (competitionId) params.append('competitionId', competitionId);
    const res = await fetch(`http://localhost:3001/api/leaderboard?${params}`);
    return res.json();
  },
};
```

### 2. Use in Page Component
```typescript
// frontend-web/src/app/contests/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { contestApi } from '@/lib/api/contest';

export default function ContestsPage() {
  const [contestants, setContestants] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const { data } = await contestApi.getContestants('1');
        setContestants(data);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div>
      <h1>Contestants</h1>
      {contestants.map(c => (
        <div key={c.id}>
          <h3>{c.name}</h3>
          <p>Votes: {c.totalVotes}</p>
        </div>
      ))}
    </div>
  );
}
```

### 3. Leaderboard Component
```typescript
// frontend-web/src/components/Leaderboard.tsx
'use client';

import { useEffect, useState } from 'react';
import { contestApi } from '@/lib/api/contest';

export default function Leaderboard({ competitionId }: { competitionId: string }) {
  const [leaderboard, setLeaderboard] = useState([]);

  useEffect(() => {
    contestApi.getLeaderboard(competitionId, 10).then(res => {
      setLeaderboard(res.data);
    });
  }, [competitionId]);

  return (
    <table className="w-full">
      <thead>
        <tr>
          <th>Rank</th>
          <th>Name</th>
          <th>Votes</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {leaderboard.map(entry => (
          <tr key={entry.contestantId}>
            <td>#{entry.rank}</td>
            <td>{entry.name}</td>
            <td>{entry.totalVotes}</td>
            <td>{entry.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

---

## Admin Portal

The Admin Portal provides full CRUD operations through the UI.

### Current Features
- ✅ View all contestants
- ✅ Vote for contestants (unlimited admin votes)
- ✅ View voting leaderboard
- ✅ Vote audit log
- ✅ Vote statistics

### Access URLs
- Participants: `http://localhost:3001/admin/competitions/participants`
- Contestant Voting: `http://localhost:3001/admin/voting/contestant/[id]`

---

## Data Synchronization

### Real-Time Sync Strategy
1. **Polling** - Mobile/Web polls `/leaderboard` every 30 seconds
2. **WebSocket** (future) - Live updates when votes added
3. **Push Notifications** (future) - Notify when contestant ranks change

### Example Polling Implementation
```typescript
// Mobile app with polling
useEffect(() => {
  const interval = setInterval(async () => {
    const { data } = await contestApi.getLeaderboard('1', 10);
    setLeaderboard(data);
  }, 30000); // 30 seconds

  return () => clearInterval(interval);
}, []);
```

---

## Environment Variables

### .env.local (Dev)
```
NEXT_PUBLIC_API_URL=http://localhost:3001/api
SUPABASE_SERVICE_ROLE_KEY=...
```

### .env.production (Production)
```
NEXT_PUBLIC_API_URL=https://yourdomain.com/api
SUPABASE_SERVICE_ROLE_KEY=...
```

---

## Testing APIs

### Using cURL
```bash
# Get contests
curl http://localhost:3001/api/contests

# Get contestants for competition 1
curl "http://localhost:3001/api/contestants?competitionId=1"

# Get leaderboard
curl "http://localhost:3001/api/leaderboard?limit=10"

# Get contestant votes
curl http://localhost:3001/api/voting/contestant/1
```

### Using Postman
1. Import API collection from `/frontend-admin/app/api/README.md`
2. Set base URL to `http://localhost:3001/api`
3. Test endpoints

---

## Deployment Checklist

- [ ] Update `NEXT_PUBLIC_API_URL` in mobile app
- [ ] Update `NEXT_PUBLIC_API_URL` in frontend-web
- [ ] Configure CORS if needed
- [ ] Enable rate limiting on production APIs
- [ ] Set up API monitoring/logging
- [ ] Test all endpoints in production
- [ ] Verify data sync across platforms

---

## Support

For API documentation, see `/frontend-admin/app/api/README.md`

For shared types, see `/frontend-admin/app/api/types.ts`
