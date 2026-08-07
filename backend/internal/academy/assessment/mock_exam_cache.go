package assessment

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// CacheService provides Redis-backed caching for analytics
type CacheService struct {
	redis *redis.Client
}

func NewCacheService(rc *redis.Client) *CacheService {
	if rc == nil {
		// Return a no-op cache service if Redis is unavailable
		return &CacheService{redis: nil}
	}
	return &CacheService{redis: rc}
}

// Cache TTLs
const (
	LearnerAnalyticsTTL = 5 * time.Minute   // Refresh every 5 minutes
	AdminAnalyticsTTL   = 10 * time.Minute  // Less frequent updates for admin
	TemplateCacheTTL    = 30 * time.Minute  // Stable data
	StatisticsCacheTTL  = 15 * time.Minute  // Moderate refresh
)

// ─── Learner Analytics Cache ───────────────────────────────────────

// GetLearnerAnalyticsFromCache attempts to retrieve cached analytics
func (c *CacheService) GetLearnerAnalyticsFromCache(ctx context.Context, userID string) (*LearnerAnalytics, error) {
	if c.redis == nil {
		return nil, redis.Nil // Signal cache miss
	}

	key := fmt.Sprintf("learner:analytics:%s", userID)
	val, err := c.redis.Get(ctx, key).Result()
	if err != nil {
		return nil, err // Cache miss or error
	}

	var analytics LearnerAnalytics
	if err := json.Unmarshal([]byte(val), &analytics); err != nil {
		return nil, err
	}

	return &analytics, nil
}

// SetLearnerAnalyticsCache stores learner analytics in Redis
func (c *CacheService) SetLearnerAnalyticsCache(ctx context.Context, userID string, analytics *LearnerAnalytics) error {
	if c.redis == nil {
		return nil // No-op if Redis unavailable
	}

	key := fmt.Sprintf("learner:analytics:%s", userID)
	data, err := json.Marshal(analytics)
	if err != nil {
		return err
	}

	return c.redis.Set(ctx, key, data, LearnerAnalyticsTTL).Err()
}

// InvalidateLearnerAnalyticsCache clears cached analytics for a user
func (c *CacheService) InvalidateLearnerAnalyticsCache(ctx context.Context, userID string) error {
	if c.redis == nil {
		return nil
	}

	key := fmt.Sprintf("learner:analytics:%s", userID)
	return c.redis.Del(ctx, key).Err()
}

// ─── Admin Analytics Cache ────────────────────────────────────────

// GetAdminAnalyticsFromCache retrieves cached admin analytics
func (c *CacheService) GetAdminAnalyticsFromCache(ctx context.Context, timeRange string) (*AdminAnalytics, error) {
	if c.redis == nil {
		return nil, redis.Nil
	}

	key := fmt.Sprintf("admin:analytics:%s", timeRange)
	val, err := c.redis.Get(ctx, key).Result()
	if err != nil {
		return nil, err
	}

	var analytics AdminAnalytics
	if err := json.Unmarshal([]byte(val), &analytics); err != nil {
		return nil, err
	}

	return &analytics, nil
}

// SetAdminAnalyticsCache stores admin analytics in Redis
func (c *CacheService) SetAdminAnalyticsCache(ctx context.Context, timeRange string, analytics *AdminAnalytics) error {
	if c.redis == nil {
		return nil
	}

	key := fmt.Sprintf("admin:analytics:%s", timeRange)
	data, err := json.Marshal(analytics)
	if err != nil {
		return err
	}

	return c.redis.Set(ctx, key, data, AdminAnalyticsTTL).Err()
}

// InvalidateAdminAnalyticsCache clears admin analytics cache
func (c *CacheService) InvalidateAdminAnalyticsCache(ctx context.Context) error {
	if c.redis == nil {
		return nil
	}

	// Invalidate all time ranges
	timeRanges := []string{"week", "month", "quarter", "year"}
	for _, tr := range timeRanges {
		key := fmt.Sprintf("admin:analytics:%s", tr)
		c.redis.Del(ctx, key)
	}

	return nil
}

// ─── Template Cache ───────────────────────────────────────────────

// GetTemplatesFromCache retrieves cached template list
func (c *CacheService) GetTemplatesFromCache(ctx context.Context, classID, examType string) ([]MockExamTemplate, error) {
	if c.redis == nil {
		return nil, redis.Nil
	}

	key := fmt.Sprintf("templates:%s:%s", classID, examType)
	val, err := c.redis.Get(ctx, key).Result()
	if err != nil {
		return nil, err
	}

	var templates []MockExamTemplate
	if err := json.Unmarshal([]byte(val), &templates); err != nil {
		return nil, err
	}

	return templates, nil
}

// SetTemplatesCache stores template list in Redis
func (c *CacheService) SetTemplatesCache(ctx context.Context, classID, examType string, templates []MockExamTemplate) error {
	if c.redis == nil {
		return nil
	}

	key := fmt.Sprintf("templates:%s:%s", classID, examType)
	data, err := json.Marshal(templates)
	if err != nil {
		return err
	}

	return c.redis.Set(ctx, key, data, TemplateCacheTTL).Err()
}

// InvalidateTemplatesCache clears template cache
func (c *CacheService) InvalidateTemplatesCache(ctx context.Context) error {
	if c.redis == nil {
		return nil
	}

	// Use pattern delete for all template keys
	keys, err := c.redis.Keys(ctx, "templates:*").Result()
	if err != nil {
		return err
	}

	if len(keys) > 0 {
		return c.redis.Del(ctx, keys...).Err()
	}

	return nil
}

// ─── Statistics Cache ─────────────────────────────────────────────

// GetStatisticsFromCache retrieves cached template statistics
func (c *CacheService) GetStatisticsFromCache(ctx context.Context, templateID string) (interface{}, error) {
	if c.redis == nil {
		return nil, redis.Nil
	}

	key := fmt.Sprintf("stats:%s", templateID)
	val, err := c.redis.Get(ctx, key).Result()
	if err != nil {
		return nil, err
	}

	var stats interface{}
	if err := json.Unmarshal([]byte(val), &stats); err != nil {
		return nil, err
	}

	return stats, nil
}

// SetStatisticsCache stores statistics in Redis
func (c *CacheService) SetStatisticsCache(ctx context.Context, templateID string, stats interface{}) error {
	if c.redis == nil {
		return nil
	}

	key := fmt.Sprintf("stats:%s", templateID)
	data, err := json.Marshal(stats)
	if err != nil {
		return err
	}

	return c.redis.Set(ctx, key, data, StatisticsCacheTTL).Err()
}

// InvalidateStatisticsCache clears statistics for a template
func (c *CacheService) InvalidateStatisticsCache(ctx context.Context, templateID string) error {
	if c.redis == nil {
		return nil
	}

	key := fmt.Sprintf("stats:%s", templateID)
	return c.redis.Del(ctx, key).Err()
}

// ─── Attempt Cache ────────────────────────────────────────────────

// GetAttemptFromCache retrieves cached attempt details
func (c *CacheService) GetAttemptFromCache(ctx context.Context, attemptID string) (*MockExamAttempt, error) {
	if c.redis == nil {
		return nil, redis.Nil
	}

	key := fmt.Sprintf("attempt:%s", attemptID)
	val, err := c.redis.Get(ctx, key).Result()
	if err != nil {
		return nil, err
	}

	var attempt MockExamAttempt
	if err := json.Unmarshal([]byte(val), &attempt); err != nil {
		return nil, err
	}

	return &attempt, nil
}

// SetAttemptCache stores attempt in Redis (short-lived cache for in-progress attempts)
func (c *CacheService) SetAttemptCache(ctx context.Context, attemptID string, attempt *MockExamAttempt) error {
	if c.redis == nil {
		return nil
	}

	key := fmt.Sprintf("attempt:%s", attemptID)
	data, err := json.Marshal(attempt)
	if err != nil {
		return err
	}

	// Cache in-progress attempts for 4 hours max
	return c.redis.Set(ctx, key, data, 4*time.Hour).Err()
}

// InvalidateAttemptCache clears attempt cache (e.g., when submitted)
func (c *CacheService) InvalidateAttemptCache(ctx context.Context, attemptID string) error {
	if c.redis == nil {
		return nil
	}

	key := fmt.Sprintf("attempt:%s", attemptID)
	return c.redis.Del(ctx, key).Err()
}

// ─── Cache Invalidation Patterns ──────────────────────────────────

// InvalidateAllCaches clears all mock exam caches (used after bulk operations)
func (c *CacheService) InvalidateAllCaches(ctx context.Context) error {
	if c.redis == nil {
		return nil
	}

	patterns := []string{
		"learner:analytics:*",
		"admin:analytics:*",
		"templates:*",
		"stats:*",
		"attempt:*",
	}

	for _, pattern := range patterns {
		keys, err := c.redis.Keys(ctx, pattern).Result()
		if err != nil {
			continue
		}

		if len(keys) > 0 {
			c.redis.Del(ctx, keys...)
		}
	}

	return nil
}

// InvalidateUserCaches clears all caches for a specific user
func (c *CacheService) InvalidateUserCaches(ctx context.Context, userID string) error {
	if c.redis == nil {
		return nil
	}

	patterns := []string{
		fmt.Sprintf("learner:analytics:%s", userID),
		fmt.Sprintf("attempt:%s*", userID),
	}

	for _, pattern := range patterns {
		keys, err := c.redis.Keys(ctx, pattern).Result()
		if err != nil {
			continue
		}

		if len(keys) > 0 {
			c.redis.Del(ctx, keys...)
		}
	}

	return nil
}

// CacheStats returns cache statistics (for monitoring)
type CacheStats struct {
	LearnerAnalyticsEntries int
	AdminAnalyticsEntries   int
	TemplateEntries         int
	StatisticsEntries       int
	AttemptEntries          int
	TotalMemoryUsage        int64
}

// GetCacheStats returns current cache statistics
func (c *CacheService) GetCacheStats(ctx context.Context) (*CacheStats, error) {
	if c.redis == nil {
		return &CacheStats{}, nil
	}

	stats := &CacheStats{}

	// Count entries by pattern
	patterns := map[string]*int{
		"learner:analytics:*": &stats.LearnerAnalyticsEntries,
		"admin:analytics:*":   &stats.AdminAnalyticsEntries,
		"templates:*":         &stats.TemplateEntries,
		"stats:*":             &stats.StatisticsEntries,
		"attempt:*":           &stats.AttemptEntries,
	}

	for pattern, count := range patterns {
		keys, err := c.redis.Keys(ctx, pattern).Result()
		if err == nil {
			*count = len(keys)
		}
	}

	// Get memory usage
	info := c.redis.Info(ctx, "memory")
	if info.Val() != "" {
		// Parse memory stats from Redis INFO
		// In production, use proper parsing
		stats.TotalMemoryUsage = 0
	}

	return stats, nil
}
