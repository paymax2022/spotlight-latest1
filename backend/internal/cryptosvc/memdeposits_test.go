package cryptosvc

import (
	"context"
	"sort"
	"strings"
	"sync"

	"spotlight/backend/internal/cryptoprov"
)

// memDeposits is the in-memory DepositStore. It reads provider accounts from the swap
// memStore so a test's ensureAccount is visible to it.
type memDeposits struct {
	mu    sync.Mutex
	swaps *memStore
	addrs map[string]cryptoprov.DepositAddress
	deps  map[string]DepositRecord
}

func newMemDeposits(s *memStore) *memDeposits {
	return &memDeposits{swaps: s, addrs: map[string]cryptoprov.DepositAddress{}, deps: map[string]DepositRecord{}}
}

func (m *memDeposits) UserByProviderAccount(_ context.Context, provider, acct string) (string, bool, error) {
	m.swaps.mu.Lock()
	defer m.swaps.mu.Unlock()
	for k, v := range m.swaps.accounts {
		if v == acct {
			if u, p, ok := cutKey(k); ok && p == provider {
				return u, true, nil
			}
		}
	}
	return "", false, nil
}

func (m *memDeposits) SavedDepositAddress(_ context.Context, userID, provider, currency, network string) (cryptoprov.DepositAddress, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	a, ok := m.addrs[userID+"|"+provider+"|"+currency+"|"+network]
	return a, ok, nil
}

func (m *memDeposits) SaveDepositAddress(_ context.Context, userID, provider string, a cryptoprov.DepositAddress) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := userID + "|" + provider + "|" + a.Currency + "|" + a.Network
	if _, ok := m.addrs[k]; !ok {
		m.addrs[k] = a
	}
	return nil
}

func (m *memDeposits) UpsertDeposit(_ context.Context, d DepositRecord) (bool, cryptoprov.DepositStatus, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := d.Provider + "|" + d.ProviderDepositID
	prev, ok := m.deps[k]
	if !ok {
		m.deps[k] = d
		return true, d.Status, nil
	}
	advances := depositAdvances(prev.Status, d.Status)
	if !advances && prev.Confirmations >= d.Confirmations {
		return false, "", nil
	}
	if advances {
		prev.Status = d.Status
	}
	if d.Confirmations > prev.Confirmations {
		prev.Confirmations = d.Confirmations
	}
	m.deps[k] = prev
	return true, prev.Status, nil
}

func (m *memDeposits) ListDeposits(_ context.Context, userID string, limit int) ([]DepositRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []DepositRecord{}
	for _, d := range m.deps {
		if d.UserID == userID {
			out = append(out, d)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ProviderDepositID > out[j].ProviderDepositID })
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func cutKey(k string) (user, provider string, ok bool) { return strings.Cut(k, "|") }
