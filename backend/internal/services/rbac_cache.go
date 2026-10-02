package services

import (
	"sync"
	"time"

	"spotlight/backend/internal/domain"
)

// NewCachedRBACService wraps an RBACService with a short-TTL in-memory cache on
// the three per-request hot reads (status, roles, global permissions) that
// RequireAuthContext issues for every authenticated call. Each is otherwise a
// Supabase REST round trip — under load PostgREST/Kong saturates and requests
// fail 503 ("account status check unavailable") even though auth and Postgres
// are fine; measured at 200 VU sustained on 2026-10-02 (ADR-PR395 follow-up).
//
// Trade-off — this is opt-in for a reason: a suspend/lock/role change made
// through another path takes up to ttl to take effect. Operators pick the
// staleness window via AUTH_IDENTITY_CACHE_TTL_SECONDS; 0 leaves lookups live
// (default, no behavior change). Mutations through this service invalidate the
// entry immediately. Errors are never cached.
func NewCachedRBACService(inner RBACService, ttl time.Duration) RBACService {
	return &cachedRBAC{
		inner:  inner,
		ttl:    ttl,
		status: map[string]rbacTimed[string]{},
		roles:  map[string]rbacTimed[[]string]{},
		perms:  map[string]rbacTimed[[]string]{},
	}
}

type rbacTimed[T any] struct {
	val       T
	fetchedAt time.Time
}

type cachedRBAC struct {
	RBACService // delegates every method not overridden below

	inner RBACService
	ttl   time.Duration
	mu    sync.Mutex
	// Keyed by userID, except perms which is userID|scopeType|scopeID.
	status map[string]rbacTimed[string]
	roles  map[string]rbacTimed[[]string]
	perms  map[string]rbacTimed[[]string]
}

// rbacCacheMaxEntries bounds each map so a flood of distinct user IDs cannot
// grow memory unboundedly (same DoS class as the limiter-store caps).
const rbacCacheMaxEntries = 10000

func fresh[T any](e rbacTimed[T], ttl time.Duration) bool {
	return !e.fetchedAt.IsZero() && time.Since(e.fetchedAt) <= ttl
}

func (c *cachedRBAC) GetUserStatus(userID string) (string, error) {
	c.mu.Lock()
	if e, ok := c.status[userID]; ok && fresh(e, c.ttl) {
		c.mu.Unlock()
		return e.val, nil
	}
	c.mu.Unlock()
	v, err := c.inner.GetUserStatus(userID)
	if err != nil {
		return "", err // never cache errors — an upstream outage must not pin
	}
	c.mu.Lock()
	if len(c.status) >= rbacCacheMaxEntries {
		c.status = map[string]rbacTimed[string]{}
	}
	c.status[userID] = rbacTimed[string]{val: v, fetchedAt: time.Now()}
	c.mu.Unlock()
	return v, nil
}

func (c *cachedRBAC) GetUserRoles(userID string) ([]string, error) {
	c.mu.Lock()
	if e, ok := c.roles[userID]; ok && fresh(e, c.ttl) {
		c.mu.Unlock()
		return e.val, nil
	}
	c.mu.Unlock()
	v, err := c.inner.GetUserRoles(userID)
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	if len(c.roles) >= rbacCacheMaxEntries {
		c.roles = map[string]rbacTimed[[]string]{}
	}
	c.roles[userID] = rbacTimed[[]string]{val: v, fetchedAt: time.Now()}
	c.mu.Unlock()
	return v, nil
}

func (c *cachedRBAC) GetUserPermissions(userID, scopeType, scopeID string) ([]string, error) {
	key := userID + "|" + scopeType + "|" + scopeID
	c.mu.Lock()
	if e, ok := c.perms[key]; ok && fresh(e, c.ttl) {
		c.mu.Unlock()
		return e.val, nil
	}
	c.mu.Unlock()
	v, err := c.inner.GetUserPermissions(userID, scopeType, scopeID)
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	if len(c.perms) >= rbacCacheMaxEntries {
		c.perms = map[string]rbacTimed[[]string]{}
	}
	c.perms[key] = rbacTimed[[]string]{val: v, fetchedAt: time.Now()}
	c.mu.Unlock()
	return v, nil
}

// Mutations invalidate the target user's cached identity so a suspend/lock/
// role change issued through this service cannot ride out the TTL.
func (c *cachedRBAC) invalidate(userID string) {
	c.mu.Lock()
	delete(c.status, userID)
	delete(c.roles, userID)
	for k := range c.perms {
		if len(k) > len(userID) && k[:len(userID)] == userID && k[len(userID)] == '|' {
			delete(c.perms, k)
		}
	}
	c.mu.Unlock()
}

func (c *cachedRBAC) SuspendUser(userID string) error {
	err := c.inner.SuspendUser(userID)
	c.invalidate(userID)
	return err
}

func (c *cachedRBAC) UnsuspendUser(userID string) error {
	err := c.inner.UnsuspendUser(userID)
	c.invalidate(userID)
	return err
}

func (c *cachedRBAC) LockUser(userID string) error {
	err := c.inner.LockUser(userID)
	c.invalidate(userID)
	return err
}

func (c *cachedRBAC) UnlockUser(userID string) error {
	err := c.inner.UnlockUser(userID)
	c.invalidate(userID)
	return err
}

func (c *cachedRBAC) AssignRoleToUser(userID, roleID, scopeType, scopeID, assignedBy string) error {
	err := c.inner.AssignRoleToUser(userID, roleID, scopeType, scopeID, assignedBy)
	c.invalidate(userID)
	return err
}

func (c *cachedRBAC) RemoveRoleFromUser(actorUserID, userID, roleID string) error {
	err := c.inner.RemoveRoleFromUser(actorUserID, userID, roleID)
	c.invalidate(userID)
	return err
}

func (c *cachedRBAC) UpdateAdminUser(userID string, patch map[string]any) (domain.AdminUser, error) {
	u, err := c.inner.UpdateAdminUser(userID, patch)
	c.invalidate(userID)
	return u, err
}

var _ RBACService = (*cachedRBAC)(nil)
