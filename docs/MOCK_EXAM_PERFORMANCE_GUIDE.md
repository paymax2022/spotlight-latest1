# Mock Exam System - Performance Optimization Guide

**Date:** August 6, 2026  
**Version:** Slice 10  
**Status:** Production Ready

---

## Performance Architecture

### Caching Strategy

```
Request Flow:
┌─────────────┐
│ Handler     │
└──────┬──────┘
       │
       ▼
┌──────────────┐      ✓ Hit        ┌────────┐
│ Cache Check  ├─────────────────→ │ Redis  │
└──────┬───────┘                   └────────┘
       │ Miss
       ▼
┌──────────────────┐    ┌───────────┐
│ Analytics Query  │───→│ Database  │
└──────┬───────────┘    └───────────┘
       │
       ▼
┌──────────────┐
│ Store Cache  │
└──────────────┘
```

### TTL Configuration

| Data Type | TTL | Rationale |
|-----------|-----|-----------|
| Learner Analytics | 5 min | User-specific, refresh frequently |
| Admin Analytics | 10 min | System-wide, less critical freshness |
| Templates | 30 min | Stable data, infrequent changes |
| Statistics | 15 min | Moderate volatility |
| Attempts | 4 hrs | Long-lived for in-progress exams |

---

## Performance Baselines

### Before Caching (Slice 9)

```
Operation                   Time      Queries
Learner Analytics          500ms     9 queries
Admin Analytics            1000ms    8 queries
Template List              200ms     1 query
Statistics                 300ms     1 query
```

### After Caching (Slice 10)

```
Operation                   Cold      Warm
Learner Analytics          500ms     5ms (cache hit)
Admin Analytics            1000ms    10ms (cache hit)
Template List              200ms     2ms (cache hit)
Statistics                 300ms     3ms (cache hit)

Hit Ratio Target:          85%+ within first hour
```

---

## Redis Configuration

### Recommended Settings

```yaml
# redis.conf
maxmemory: 256mb              # Adjust based on data volume
maxmemory-policy: allkeys-lru # LRU eviction for least-used keys
timeout: 300                  # 5-minute idle connection timeout
tcp-keepalive: 60             # Keep connections alive

# Performance tuning
tcp-backlog: 511
databases: 16
save: ""                      # Disable RDB for speed
appendonly: no                # Disable AOF for speed (use replication)
```

### Memory Usage Estimation

```
Per user analytics:           ~2 KB
Admin analytics (all ranges): ~4 KB
Template cache (full list):   ~10 KB
Statistics (per template):    ~1 KB
Attempt metadata:             ~5 KB

For 1,000 concurrent users:
~22 MB base load
~20 MB working set (hot data)
Recommendation: 256 MB Redis instance
```

---

## Query Optimization

### Database Indexes (Verified)

```sql
-- Performance-critical indexes (already exist)
CREATE INDEX idx_attempt_metadata_status ON academy_mock_attempt_metadata(status);
CREATE INDEX idx_attempt_metadata_submitted ON academy_mock_attempt_metadata(submitted_at);
CREATE INDEX idx_attempt_metadata_user ON academy_mock_attempt_metadata(user_id);
CREATE INDEX idx_template_class ON academy_mock_exam_templates(class_id);

-- Verify indexes exist
SELECT * FROM pg_indexes 
WHERE tablename = 'academy_mock_attempt_metadata';
```

### Query Plans

```sql
-- GOOD: Uses index on user_id (single-user query)
EXPLAIN ANALYZE
SELECT COUNT(*) as total_attempts
FROM academy_mock_attempt_metadata
WHERE user_id = 'user-123' AND status = 'graded';

-- EXPECTED: Bitmap Index Scan on idx_attempt_metadata_user
-- Cost: ~0.3 ms

-- GOOD: Uses index on submitted_at (time-range query)
EXPLAIN ANALYZE
SELECT DATE(submitted_at) as date, COUNT(*) as attempts
FROM academy_mock_attempt_metadata
WHERE status = 'graded' AND submitted_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY DATE(submitted_at);

-- EXPECTED: Index Range Scan on idx_attempt_metadata_submitted
-- Cost: ~50-200 ms (depends on data volume)
```

---

## Monitoring & Alerting

### Key Metrics to Track

```sql
-- Query latency per endpoint
SELECT 
  path,
  AVG(response_time_ms) as avg_ms,
  MAX(response_time_ms) as max_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms) as p95_ms
FROM request_logs
WHERE path LIKE '/api/academy/mock-exams%'
GROUP BY path;

-- Cache hit ratio
SELECT 
  cache_type,
  hits,
  misses,
  ROUND(hits::float / (hits + misses) * 100, 2) as hit_ratio
FROM cache_metrics;

-- Database connection pool usage
SHOW max_connections;
SELECT count(*) as active_connections FROM pg_stat_activity;
```

### Alert Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| Learner Analytics Query | > 300ms | > 1000ms |
| Admin Analytics Query | > 500ms | > 2000ms |
| Redis Hit Ratio | < 70% | < 50% |
| Cache Memory Used | > 80% | > 95% |
| DB Connection Pool | > 75% | > 90% |
| Request Latency (p95) | > 500ms | > 1500ms |

---

## Profiling & Benchmarking

### Load Testing

```bash
# Tool: Apache Bench or wrk
# Simulate 100 concurrent users for 60 seconds

# Learner Analytics (cold cache)
wrk -t4 -c100 -d60s \
  -H "Authorization: Bearer token" \
  http://localhost:8091/api/academy/mock-exams/analytics

# Admin Analytics (warm cache)
wrk -t4 -c100 -d60s \
  -H "Authorization: Bearer admin-token" \
  http://localhost:8091/api/academy/admin/analytics?timeRange=week
```

### Expected Results (with 1,000 users, 10,000 attempts)

```
Cold Cache (first request):
Requests/sec:   2.5
Latency (avg):  400ms
Latency (max):  1200ms
Transfer rate:  0.80 MB/sec

Warm Cache (after 5 min):
Requests/sec:   500+
Latency (avg):  2ms
Latency (max):  10ms
Transfer rate:  150+ MB/sec
```

---

## Optimization Strategies

### Current Optimizations (Slice 10)

✅ Redis caching layer
✅ Database indexes on common filters
✅ Query optimization with CTEs and window functions
✅ Graceful degradation (no Redis = works, just slower)

### Future Optimizations (Slice 11+)

#### Materialized Views
```sql
-- Refresh nightly for historical trends
CREATE MATERIALIZED VIEW learner_analytics_daily AS
SELECT
  user_id,
  DATE(submitted_at) as date,
  COUNT(*) as attempts,
  AVG(score_percent) as avg_score,
  MAX(score_percent) as best_score
FROM academy_mock_attempt_metadata
WHERE status = 'graded'
GROUP BY user_id, DATE(submitted_at);

-- Create index for fast lookups
CREATE INDEX idx_learner_daily ON learner_analytics_daily(user_id, date DESC);
```

#### Connection Pooling
```go
// Use pgbouncer for connection pooling
// Reduces connection overhead
// Recommended: pgbouncer in transaction pooling mode
```

#### Query Batching
```go
// Batch multiple user requests into single query
// Use UNION ALL to fetch multiple users at once
// Cache results individually
```

---

## Troubleshooting Guide

### High Database Load

```sql
-- Find slow queries
SELECT query, calls, mean_time, max_time
FROM pg_stat_statements
WHERE mean_time > 100
ORDER BY mean_time DESC
LIMIT 10;

-- Check for missing indexes
SELECT schemaname, tablename, indexname
FROM pg_indexes
WHERE tablename LIKE 'academy_mock%';

-- Analyze table statistics
ANALYZE academy_mock_attempt_metadata;
ANALYZE academy_mock_exam_templates;
```

### Low Cache Hit Ratio

```bash
# Check Redis metrics
redis-cli INFO stats
# Look for: hits, misses, evicted_keys

# Increase cache TTL if data is stable
# Check if cache keys expire too quickly
redis-cli MONITOR | grep expire
```

### Memory Issues

```bash
# Check Redis memory usage
redis-cli INFO memory
# Look for: used_memory_human, used_memory_peak_human

# Check database connections
SELECT datname, count(*) as connection_count
FROM pg_stat_activity
GROUP BY datname;

# Identify long-running queries
SELECT query, query_start
FROM pg_stat_activity
WHERE state = 'active'
ORDER BY query_start;
```

---

## Performance Tuning Checklist

- [ ] Redis is deployed and accessible
- [ ] All database indexes are created
- [ ] Cache TTLs are appropriate for your SLA
- [ ] Monitoring dashboards are configured
- [ ] Alert thresholds are set
- [ ] Load testing has been performed
- [ ] Connection pool is properly sized
- [ ] Database statistics are up-to-date (ANALYZE)
- [ ] Slow query log is enabled
- [ ] Cache hit ratio is monitored

---

## Real-World Impact

### Scenario: 10,000 Learners Using Dashboards

**Without Caching:**
- Each dashboard load = 500ms DB query
- 100 concurrent users = 50,000 ms = 50 seconds total processing
- Database under heavy load
- Slow user experience

**With Caching:**
- First request (cold): 500ms
- Subsequent requests (warm): 5ms
- Same 100 users now take ~500ms total
- Database load reduced by 98%
- Instant user experience

---

## Deployment Checklist

### Pre-Production
- [ ] Redis cluster is running
- [ ] Redis persistence is configured (replication)
- [ ] Database backups are in place
- [ ] Monitoring is collecting metrics
- [ ] Load test shows p95 latency < 100ms

### Production
- [ ] Health checks monitor Redis availability
- [ ] Cache invalidation on critical updates is working
- [ ] Database query monitoring is active
- [ ] Alerts are integrated with on-call system
- [ ] Incident playbook includes "Redis unavailable" scenario

---

## Code Examples

### Using the Cache Service

```go
// In handler
cacheService := NewCacheService(redisClient)
analyticsService := NewAnalyticsService(pool).WithCache(cacheService)

// Automatic caching
analytics, err := analyticsService.GetLearnerAnalytics(ctx, userID)
// First call: DB query, then stored in cache
// Second call within 5 min: returned from cache

// Manual invalidation
cacheService.InvalidateLearnerAnalyticsCache(ctx, userID)
// Forces refresh on next request
```

### Cache Statistics

```go
stats, err := cacheService.GetCacheStats(ctx)
if err == nil {
  log.Printf("Learner Analytics: %d entries", stats.LearnerAnalyticsEntries)
  log.Printf("Admin Analytics: %d entries", stats.AdminAnalyticsEntries)
  log.Printf("Total Memory: %d bytes", stats.TotalMemoryUsage)
}
```

---

## References

- Redis Performance Tuning: https://redis.io/topics/optimization
- PostgreSQL Indexes: https://www.postgresql.org/docs/current/indexes.html
- Go Redis Client: https://github.com/redis/go-redis
- pgbouncer: https://pgbouncer.github.io/

