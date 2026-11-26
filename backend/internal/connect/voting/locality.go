package connectvoting

// The village tier of the state -> local government -> village cascade.
//
// WHY AN ENDPOINT RATHER THAN BUNDLED DATA. public.villages is curated and
// changes when an admin adds the next quarter. Shipping the list inside the app
// would mean a phone build per edit, and EAS is not configured on this project.
// One read route serves both clients: the mobile app calls it directly, and the
// web wizard reaches the same path through the existing catch-all proxy
// (frontend-web/app/api/v1/[...path]/route.ts -> Go /api/v1/*).
//
// THE EMPTY LIST IS THE CONTRACT. Only Onitsha North has rows, because only
// Onitsha North was named by a human (see 20272000000000_locality_villages.sql,
// which says so in its header). Every other LGA answers zero rows with
// mode=free_text and the picker turns into a text input. Inventing village names
// for 773 LGAs would put fabricated geography on a field the platform treats as
// real, so the honest "nobody has curated this yet" is what a caller gets.

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// Modes the picker branches on.
const (
	VillageModeCurated  = "curated"
	VillageModeFreeText = "free_text"
)

// maxLocalityLen bounds a locality name on read. The values are admin-entered
// text, CHECK-bound to more than one character on write by 20272000000000; this
// is the matching read-side limit so a stray blob cannot become a cache key.
const maxLocalityLen = 80

// Village is one curated quarter. The picker only needs the name — that string is
// what lands on contestants.village, so it is returned exactly as curated.
type Village struct {
	Name string `json:"name"`
}

// VillageList is the response body.
type VillageList struct {
	State    string    `json:"state"`
	LGA      string    `json:"lga"`
	Mode     string    `json:"mode"`
	Villages []Village `json:"villages"`
}

// newVillageList decides the mode. Centralised so the service and any future
// caller agree on what an empty list means.
func newVillageList(state, lga string, villages []Village) *VillageList {
	if villages == nil {
		// Serialise as [] not null: the picker maps over it.
		villages = []Village{}
	}
	mode := VillageModeCurated
	if len(villages) == 0 {
		mode = VillageModeFreeText
	}
	return &VillageList{State: state, LGA: lga, Mode: mode, Villages: villages}
}

// villagesArgError is a caller mistake about WHICH locality they wanted. Field
// names the input so the response can point at the right select instead of
// returning a generic "invalid request".
type villagesArgError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

func (e *villagesArgError) Error() string { return e.Message }

// villagesQueryArgs validates and normalises the two query params. They are bound
// as parameters, never concatenated, so the length cap protects the response
// shape rather than the database.
func villagesQueryArgs(state, lga string) (string, string, *villagesArgError) {
	wantState, bad := normalizeLocality("state", state)
	if bad != nil {
		return "", "", bad
	}
	wantLGA, bad := normalizeLocality("lga", lga)
	if bad != nil {
		return "", "", bad
	}
	return wantState, wantLGA, nil
}

// normalizeLocality checks one locality parameter: required, trimmed, capped.
func normalizeLocality(name, value string) (string, *villagesArgError) {
	v := strings.TrimSpace(value)
	if v == "" {
		return "", &villagesArgError{
			Field:   name,
			Message: fmt.Sprintf("%s is required — the village list is scoped to one local government in one state", name),
		}
	}
	if len(v) > maxLocalityLen {
		return "", &villagesArgError{
			Field:   name,
			Message: fmt.Sprintf("%s is too long (max %d characters)", name, maxLocalityLen),
		}
	}
	return v, nil
}

// ListVillages returns the curated, active villages for one LGA, alphabetically.
// No rows is not an error: that is an LGA nobody has curated yet.
func (r *Repository) ListVillages(ctx context.Context, state, lga string) ([]Village, error) {
	rows, err := r.db.Query(ctx, `
		SELECT name FROM villages
		WHERE state = $1 AND lga = $2 AND is_active
		ORDER BY name ASC`, state, lga)
	if err != nil {
		return nil, fmt.Errorf("voting: list villages: %w", err)
	}
	defer rows.Close()

	out := []Village{}
	for rows.Next() {
		var v Village
		if err := rows.Scan(&v.Name); err != nil {
			return nil, fmt.Errorf("voting: scan village: %w", err)
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// Villages is the service read: validate the locality, then wrap the rows with
// the mode the picker needs.
func (s *Service) Villages(ctx context.Context, state, lga string) (*VillageList, error) {
	wantState, wantLGA, bad := villagesQueryArgs(state, lga)
	if bad != nil {
		return nil, bad
	}
	villages, err := s.repo.ListVillages(ctx, wantState, wantLGA)
	if err != nil {
		return nil, err
	}
	return newVillageList(wantState, wantLGA, villages), nil
}

// ListVillages — GET /api/v1/connect/villages?state=&lga= (member).
//
// A bad locality is a 400 that names the field, and it is answered before any
// query runs. A database failure is a 500 with no internal text echoed, matching
// how the rest of this package reports storage errors.
func (h *Handler) ListVillages(c *gin.Context) {
	list, err := h.svc.Villages(c.Request.Context(), c.Query("state"), c.Query("lga"))
	if err != nil {
		var bad *villagesArgError
		if errors.As(err, &bad) {
			c.JSON(http.StatusBadRequest, gin.H{"error": bad.Message, "field": bad.Field})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "village list unavailable"})
		return
	}
	c.JSON(http.StatusOK, list)
}
