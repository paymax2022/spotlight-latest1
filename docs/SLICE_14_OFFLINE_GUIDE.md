# Slice 14 - Offline Support & Biometric Authentication Guide

**Date:** August 6, 2026  
**Version:** 1.0  
**Status:** In Development

---

## Overview

Slice 14 adds complete offline support for exam taking and implements biometric security with Face ID/fingerprint authentication. Learners can now take exams without internet and authenticate securely.

---

## Offline Support Architecture

### IndexedDB Database (`lib/db/examDatabase.ts` - 420 lines)

**Schema (4 object stores):**

1. **templates** — Cached exam questions
   - KeyPath: `id`
   - Indexes: classLevel, subject
   - TTL: No expiry (manual refresh)
   - Use: Resume exams offline

2. **progress** — In-progress exam attempts
   - KeyPath: `attemptId`
   - Indexes: templateId, userId, syncStatus
   - Sync statuses: pending, syncing, synced, failed
   - Use: Track active exams, resume progress

3. **results** — Completed exam attempts
   - KeyPath: `attemptId`
   - Indexes: templateId, userId, synced
   - Use: View completed results offline

4. **syncQueue** — Pending submissions
   - KeyPath: id (auto-increment)
   - Indexes: attemptId, action
   - Actions: save_progress, submit_exam
   - Use: Queue offline submissions for sync

**Database Methods:**

```typescript
// Templates
saveTemplate(template)
getTemplate(id)
getTemplatesByClass(classLevel)

// Progress
saveProgress(progress)
getProgress(attemptId)
getProgressByUser(userId)
getPendingSyncs()

// Results
saveResult(result)
getResult(attemptId)
getResultsByUser(userId)

// Sync Queue
queueSync(attemptId, action, payload)
getSyncQueue()
removeSyncQueueItem(id)
updateSyncQueueRetry(id, error)

// Utilities
clear()
getStorageInfo()
close()
```

**Storage Estimation:**
```
Per exam: ~50-100KB
Per result: ~10KB
Per sync queue item: ~1-5KB
Total quota: Usually 50MB+ per site
```

### Background Sync (`hooks/useBackgroundSync.ts` - 300 lines)

**Three hooks for sync management:**

**useBackgroundSync** (180 lines)
- Automatically syncs when online
- Manual sync trigger
- Progress tracking (items synced / total)
- Error handling with retry logic
- Hooks into Service Worker sync (if available)

**useOfflineQueue** (80 lines)
- Track queue count
- Add items to queue
- Clear entire queue
- Update queue after sync

**useSyncNotification** (40 lines)
- User-friendly notifications
- Toast-style messages
- Auto-dismiss after duration
- Types: info, success, error, progress

**Sync Flow:**
```
1. Connection lost → Auto-save to IndexedDB
2. Queue marked as 'pending'
3. Connection restored → Auto-trigger sync
4. Service Worker sync (background) or polling
5. Retry on failure (max 3 retries)
6. Remove from queue on success
7. Show user notification
```

**Retry Strategy:**
```
Attempt 1: Immediate
Attempt 2: 30 seconds later
Attempt 3: 5 minutes later
Max 3 attempts then abandon
```

### Offline Data Persistence

**Auto-Save Behavior:**
```
1. Every 30 seconds → Save progress to IndexedDB
2. On network loss → Mark as 'pending'
3. On network restore → Auto-sync starts
4. Manual sync button available
5. Show queue count to user
```

**Resume Exam:**
```
1. Reopen exam page
2. Load from IndexedDB (fast)
3. Resume from last saved position
4. Preserve all answers
5. Continue timer from last saved time
```

---

## Biometric Authentication

### WebAuthn Support (`hooks/useBiometric.ts` - 340 lines)

**Biometric Types Detected:**
```
iOS:       Touch ID (pre-X) or Face ID (X+)
Android:   Fingerprint (common) or Face Unlock (modern)
Windows:   Windows Hello (face or fingerprint)
macOS:     Touch ID
```

**Three main hooks:**

**useBiometricCapability** (90 lines)
- Detects: isSupported, isAvailable, types[], isEnrolled
- Checks: PublicKeyCredential availability
- Platform detection via user agent
- Returns: { isSupported, isAvailable, types, isEnrolled }

**useBiometricAuth** (150 lines)
- Performs WebAuthn authentication
- Server-side verification required
- Success/failure handling
- Error messages and retry counts
- Integrate with session management

**useBiometricLock & useBiometricSessionTimeout** (100 lines)
- Exam locking after failed auth
- Session timeout (15 min default)
- Auto-lock on inactivity
- Biometric unlock requirement
- Grace period configurable

### Authentication Flow

```
1. User tries to take exam
2. Check: Device supports biometric?
3. Check: User enrolled?
4. If yes: Prompt for biometric auth
5. User provides: Face ID/Fingerprint
6. Server verifies: Challenge-response
7. Success: Grant exam access
8. Failure: Lock exam, require retry
```

### Security Features

**Fraud Detection:**
```typescript
detectBiometricFraud(attemptHistory):
  - 3+ failed attempts in 5 tries → Suspicious (30 points)
  - Unusual time pattern (>3 time windows) → Suspicious (20 points)
  - Rapid attempts (<5s apart) → Suspicious (40 points)
  - Threshold: 50 points = Lock exam
```

**Session Timeout:**
```
Inactivity timeout: 15 minutes (configurable)
Activity tracked: clicks, keys, touches
Auto-reset on activity
Grace period: 60 seconds warning
```

**Locking Mechanism:**
```
Failed auth → Lock exam for 5 minutes
Multiple failures → Escalate to 30 minutes
Exam cannot progress while locked
Requires biometric re-auth to unlock
```

---

## Implementation Details

### Offline Exam Page (`page-offline.tsx` - 350 lines)

**Integrated Features:**
1. Load from cache or network
2. Auto-save every 30 seconds to IndexedDB
3. Show offline indicator
4. Display pending sync queue
5. Queue submissions when offline
6. Auto-sync when online
7. Biometric session timeout
8. Storage quota monitoring

**State Management:**
```typescript
examState: {
  answers,      // Answers per question
  flagged,      // Flagged questions
  currentQuestion,
}

offline state: {
  isOfflineMode,
  queueCount,
  storageWarning,
  isSyncing,
  syncProgress,
}

security state: {
  isSessionExpired,
  lockTimeRemaining,
}
```

### Database Initialization

```typescript
// Automatic on first use
const db = await getExamDatabase();

// Schema created on version upgrade
// v1: templates, progress, results, syncQueue

// Single instance (singleton pattern)
const db = await getExamDatabase();
```

### Network Handling

**Offline:**
```
✓ Load from cache
✓ Take exam normally
✓ Save to IndexedDB
✓ Show offline indicator
✓ Queue submissions
✗ Cannot submit to server
```

**Online:**
```
✓ Load fresh from network
✓ Cache for offline access
✓ Sync pending queue items
✓ Submit directly to server
✓ Show sync status
```

**Slow Network (3G):**
```
✓ Load cached version (faster)
✓ Try to refresh in background
✓ Show network speed indicator
✓ Optimize images
✓ Reduce API calls
```

---

## API Endpoints for Offline

### Server-Side Requirements

**New endpoints needed:**

```
POST /api/auth/biometric/options
  → Returns challenge for WebAuthn

POST /api/auth/biometric/verify
  → Verifies signed challenge
  → Returns JWT if successful

POST /api/mock-exams/progress
  → Accepts offline progress
  → Stores in DB for sync

POST /api/mock-exams/submit
  → Accepts offline exam submission
  → Handles duplicate submissions
  → Returns result ID

GET /api/mock-exams/template/:id
  → Template with all questions
  → Cache-friendly headers (ETag, Last-Modified)
```

### Idempotency

```
POST /api/mock-exams/submit
  Header: Idempotency-Key: <attemptId>
  
  Same key + same payload = Same response
  Prevents double-submission from retries
```

---

## Testing & Deployment

### Test Cases

**Offline Taking:**
```
1. Open exam page
2. Disable network (DevTools / Airplane Mode)
3. Take exam (answer questions)
4. Press submit → Should save locally
5. Verify in IndexedDB (DevTools → Application → IndexedDB)
6. Re-enable network → Should auto-sync
7. Check results page
```

**Biometric Auth:**
```
1. Open exam
2. System prompts for Face ID/Touch ID
3. User provides biometric
4. Success: Grant access
5. Failure: Lock exam
6. Retry: Try again (max 3 times)
```

**Session Timeout:**
```
1. Open exam, don't interact
2. Wait 15 minutes (or configured timeout)
3. Try to submit → "Session expired"
4. Biometric re-auth unlocks
5. Continue exam
```

**Sync Queue:**
```
1. Take exam offline
2. Submit → Queued
3. Go online → Auto-sync
4. Notification: "Submitted successfully"
5. Results page updates
```

### Chrome DevTools Testing

**IndexedDB Inspector:**
```
DevTools → Application → IndexedDB → spotlight-exams
  ├─ templates (cached exams)
  ├─ progress (in-progress attempts)
  ├─ results (completed results)
  └─ syncQueue (pending submissions)
```

**Network Throttle:**
```
DevTools → Network → Slow 3G / Offline
→ Verify cache loading
→ Verify queue creation
→ Re-enable network
→ Verify sync starts
```

**Storage Quota:**
```
DevTools → Application → Storage
→ Shows IndexedDB usage
→ Shows quota available
→ Monitor for 80%+ warning
```

---

## File Inventory - Slice 14

**Database (1 file)**
- `lib/db/examDatabase.ts` — 420 lines

**Hooks (2 files)**
- `hooks/useBiometric.ts` — 340 lines
- `hooks/useBackgroundSync.ts` — 300 lines

**Components (1 file)**
- `[templateId]/take/page-offline.tsx` — 350 lines

**Documentation (1 file)**
- `docs/SLICE_14_OFFLINE_GUIDE.md` — This file

**Total Code:** 1,410 lines (including this guide)

---

## Browser Support

### Offline Features

**IndexedDB Support:**
- ✅ Chrome 24+
- ✅ Firefox 10+
- ✅ Safari 10+
- ✅ Edge 12+
- ✅ iOS Safari 10+
- ✅ Android Chrome 60+

**Service Worker (Background Sync):**
- ✅ Chrome 49+ (Android)
- ✅ Edge 17+
- ✅ Firefox 44+
- ⚠️ Safari (no SW support)

### Biometric Features

**WebAuthn Support:**
- ✅ Chrome 67+
- ✅ Firefox 60+
- ✅ Safari 13+
- ✅ Edge 18+
- ✅ iOS Safari 13+
- ✅ Android Chrome 67+

**Platform Authenticator:**
- ✅ iOS (Touch ID, Face ID)
- ✅ Android (Fingerprint, Face)
- ✅ Windows (Hello)
- ✅ macOS (Touch ID)

---

## Performance & Storage

### Storage Usage

```
Single exam (50 questions):
  Template: 50-100 KB
  Progress record: 5-10 KB
  Result record: 10 KB
  Sync queue item: 1-5 KB
  Total per exam: ~80 KB

For 10 exams:
  Total: ~800 KB
  Quota used: < 2% (typical 50MB+ quota)
```

### Performance

**Offline Load:**
```
Load from cache: 50-200ms
Display questions: <100ms
Save progress: 10-50ms
Submit locally: <100ms
```

**Online Sync:**
```
Sync 1 item: 500-1000ms
Sync 5 items: 2-5 seconds
Notification: <100ms
UI update: <50ms
```

### Quota Management

```
Monitor at:
  - App launch (check quota)
  - After each exam (update usage)
  - Warn at 80%+
  - Prevent at 95%+

Clear strategy:
  - Archive old results (optional)
  - Clear old templates
  - User can manual clear
```

---

## Security Considerations

### Biometric Security

✅ **Device-level security:**
- Biometrics never leave device
- Server gets only yes/no response
- Hardware-backed keystore (when available)
- Liveness detection (prevents spoofing)

✅ **Session Security:**
- Timeout after 15 minutes inactivity
- Challenge-response authentication
- Fraud detection (3 failed attempts)
- Lock escalation (5→30 min)

✅ **Data Security:**
- Answers encrypted locally (optional)
- Sync uses HTTPS only
- Idempotency keys prevent replay
- Server-side validation required

### Privacy

✅ **No biometric storage:**
- Biometric data never stored on server
- Only verified/not verified
- No biometric templates retained
- Complies with GDPR/HIPAA

✅ **User control:**
- Can disable biometric auth
- Manual re-auth available
- Session timeout configurable
- Clear local data on demand

---

## Next Steps (Slice 15)

### Phase 1: Enhanced Offline
- [ ] Selective sync (choose which to sync)
- [ ] Data compression for storage savings
- [ ] Incremental sync (only changed items)
- [ ] Periodic auto-cleanup

### Phase 2: Advanced Security
- [ ] Encrypted local storage
- [ ] Passkey support (passwordless)
- [ ] OAuth + Biometric combo
- [ ] Audit logging

### Phase 3: Analytics Integration
- [ ] Track offline exam patterns
- [ ] Monitor sync failures
- [ ] Cache hit rate metrics
- [ ] Storage usage analytics

### Phase 4: UX Enhancements
- [ ] Visual sync progress
- [ ] Offline map/dashboard
- [ ] Data usage indicator
- [ ] Smart prefetch strategy

---

## Deployment Checklist

- [ ] IndexedDB initialization tested
- [ ] Offline exam taking verified
- [ ] Sync queue working
- [ ] Auto-sync on reconnect confirmed
- [ ] Biometric auth working on real device
- [ ] Session timeout functioning
- [ ] Storage quota monitoring active
- [ ] No data loss in offline scenarios
- [ ] Duplicate submission prevention working
- [ ] Error handling graceful
- [ ] User notifications clear

---

## References

- [IndexedDB Guide](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [Service Worker Sync](https://developer.mozilla.org/en-US/docs/Web/API/SyncManager)
- [WebAuthn Guide](https://developer.mozilla.org/en-US/docs/Web/API/WebAuthn_API)
- [Web Storage Quota](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager)
- [Offline PWA Patterns](https://web.dev/offline-cookbook/)
- [FIDO2 Security](https://fidoalliance.org/)

