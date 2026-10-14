package cryptosvc

import (
	"context"
	"reflect"
	"strings"
	"sync"
	"time"
)

// memFees is an in-memory FeeStore with the same contract as PGFeeStore: versions only go up, a
// write must name the version it read, a repeated idempotency key replays (same payload) or
// conflicts (different payload), and nothing is ever updated or removed.
type memFees struct {
	mu       sync.Mutex
	rows     []VersionedFees
	keys     map[string]FeeScheduleInput
	keyVer   map[string]int64
	failRead error
	now      time.Time
}

func newMemFees() *memFees {
	return &memFees{keys: map[string]FeeScheduleInput{}, keyVer: map[string]int64{}, now: time.Date(2026, 10, 14, 9, 0, 0, 0, time.UTC)}
}

func (m *memFees) Current(context.Context) (VersionedFees, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.failRead != nil {
		return VersionedFees{}, m.failRead
	}
	if len(m.rows) == 0 {
		return VersionedFees{Version: 0, Schedule: DefaultFeeSchedule(), Reason: "code default"}, nil
	}
	return m.rows[len(m.rows)-1], nil
}

func (m *memFees) History(_ context.Context, limit int) ([]VersionedFees, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []VersionedFees{}
	for i := len(m.rows) - 1; i >= 0 && len(out) < limit; i-- {
		out = append(out, m.rows[i])
	}
	return out, nil
}

func sameInput(a, b FeeScheduleInput) bool {
	a.ExpectedVersion, b.ExpectedVersion = 0, 0
	return reflect.DeepEqual(a.normalised(), b.normalised())
}

func (m *memFees) Append(_ context.Context, in FeeScheduleInput) (VersionedFees, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if prev, ok := m.keys[in.IdempotencyKey]; ok {
		if !sameInput(prev, in) {
			return VersionedFees{}, false, ErrFeeIdempotencyConflict
		}
		return m.rows[m.keyVer[in.IdempotencyKey]-1], false, nil
	}
	cur := int64(len(m.rows))
	if in.ExpectedVersion != cur {
		return VersionedFees{}, false, ErrFeeVersionConflict
	}
	sch, err := in.Schedule()
	if err != nil {
		return VersionedFees{}, false, err
	}
	row := VersionedFees{Version: cur + 1, Schedule: sch, Reason: strings.TrimSpace(in.Reason), CreatedBy: in.Actor, CreatedAt: m.now}
	m.rows = append(m.rows, row)
	m.keys[in.IdempotencyKey] = in
	m.keyVer[in.IdempotencyKey] = row.Version
	return row, true, nil
}
