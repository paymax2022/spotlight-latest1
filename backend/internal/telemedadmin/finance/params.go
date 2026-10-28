package finance

import (
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

var errBadParam = errors.New("invalid query parameter")

const (
	defaultLimit = 25
	maxLimit     = 200
)

var payoutStatuses = map[string]bool{
	"pending": true, "processing": true, "paid": true, "failed": true, "reversed": true,
}

type page struct {
	Limit  int
	Offset int
}

func parsePage(limitRaw, offsetRaw string) (page, error) {
	p := page{Limit: defaultLimit}
	if limitRaw != "" {
		n, err := strconv.Atoi(limitRaw)
		if err != nil || n < 1 || n > maxLimit {
			return page{}, errBadParam
		}
		p.Limit = n
	}
	if offsetRaw != "" {
		n, err := strconv.Atoi(offsetRaw)
		if err != nil || n < 0 {
			return page{}, errBadParam
		}
		p.Offset = n
	}
	return p, nil
}

// parseBound accepts RFC 3339 or YYYY-MM-DD. Empty means "no bound" (nil).
func parseBound(raw string) (*time.Time, error) {
	if raw == "" {
		return nil, nil
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return &t, nil
	}
	t, err := time.Parse("2006-01-02", raw)
	if err != nil {
		return nil, errBadParam
	}
	return &t, nil
}

type window struct{ From, To *time.Time }

func parseWindow(fromRaw, toRaw string) (window, error) {
	f, err := parseBound(fromRaw)
	if err != nil {
		return window{}, err
	}
	t, err := parseBound(toRaw)
	if err != nil {
		return window{}, err
	}
	if f != nil && t != nil && !t.After(*f) {
		return window{}, errBadParam
	}
	return window{From: f, To: t}, nil
}

func parseUUIDParam(raw string) (*string, error) {
	if raw == "" {
		return nil, nil
	}
	if _, err := uuid.Parse(raw); err != nil {
		return nil, errBadParam
	}
	return &raw, nil
}

func parsePayoutStatus(raw string) (*string, error) {
	if raw == "" {
		return nil, nil
	}
	s := strings.ToLower(raw)
	if !payoutStatuses[s] {
		return nil, errBadParam
	}
	return &s, nil
}

// parseFreeStatus is for tables whose status is free text (disputes, invoices):
// it is bound as a parameter, never concatenated, but is still length/charset limited.
func parseFreeStatus(raw string) (*string, error) {
	if raw == "" {
		return nil, nil
	}
	s := strings.ToLower(raw)
	if len(s) > 32 {
		return nil, errBadParam
	}
	for _, r := range s {
		if (r < 'a' || r > 'z') && r != '_' {
			return nil, errBadParam
		}
	}
	return &s, nil
}
