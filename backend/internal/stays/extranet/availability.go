package extranet

import (
	"context"
	"fmt"
	"time"
)

// Host availability calendar. One row per room type and night in
// stays_availability_day: allotment is the rooms to sell, sold is what bookings
// have taken (maintained at book time), stop_sell closes a night to new bookings.
// Hosts set allotment and stop_sell here; sold is never written by a host.

const maxAvailabilityWindowDays = 366

// dateLayout is the wire format for availability dates (YYYY-MM-DD).
const dateLayout = "2006-01-02"

// AvailabilityDay is one night of one room type.
type AvailabilityDay struct {
	RoomTypeID string `json:"room_type_id"`
	Date       string `json:"date"`
	Allotment  int    `json:"allotment"`
	Sold       int    `json:"sold"`
	StopSell   bool   `json:"stop_sell"`
}

// SetAvailabilityInput is one update across a window of nights.
type SetAvailabilityInput struct {
	From      time.Time
	To        time.Time
	Allotment int
	StopSell  bool
}

// validateAvailabilityWindow checks a window before anything is written.
func validateAvailabilityWindow(from, to time.Time) error {
	if to.Before(from) {
		return fmt.Errorf("%w: 'to' is before 'from'", ErrValidation)
	}
	nights := int(to.Sub(from).Hours()/24) + 1
	if nights > maxAvailabilityWindowDays {
		return fmt.Errorf("%w: at most %d nights per update", ErrValidation, maxAvailabilityWindowDays)
	}
	return nil
}

// ListAvailability returns every night in [from, to] for the property's room types.
func (s *Service) ListAvailability(ctx context.Context, userID, propertyID string, from, to time.Time) ([]AvailabilityDay, error) {
	if err := s.guard(ctx, userID, propertyID); err != nil {
		return nil, err
	}
	if err := validateAvailabilityWindow(from, to); err != nil {
		return nil, err
	}
	return s.repo.ListAvailability(ctx, propertyID, from, to)
}

// SetAvailability sets allotment and stop-sell for each night of one room type in
// the window. It returns how many nights were written.
func (s *Service) SetAvailability(ctx context.Context, userID, propertyID, roomTypeID string, in SetAvailabilityInput) (int, error) {
	if err := s.guard(ctx, userID, propertyID); err != nil {
		return 0, err
	}
	if in.Allotment < 0 {
		return 0, fmt.Errorf("%w: allotment cannot be negative", ErrValidation)
	}
	if err := validateAvailabilityWindow(in.From, in.To); err != nil {
		return 0, err
	}
	return s.repo.SetAvailability(ctx, propertyID, roomTypeID, in)
}

// ListAvailability reads the calendar for every room type of the property.
func (r *Repository) ListAvailability(ctx context.Context, propertyID string, from, to time.Time) ([]AvailabilityDay, error) {
	rows, err := r.db.Query(ctx, `
		SELECT ad.room_type_id::text, to_char(ad.date, 'YYYY-MM-DD'), ad.allotment, ad.sold, ad.stop_sell
		FROM public.stays_availability_day ad
		JOIN public.stays_room_type rt ON rt.id = ad.room_type_id
		WHERE rt.property_id = $1 AND ad.date BETWEEN $2::date AND $3::date
		ORDER BY ad.date, rt.name`,
		propertyID, from.Format(dateLayout), to.Format(dateLayout))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AvailabilityDay{}
	for rows.Next() {
		var d AvailabilityDay
		if err := rows.Scan(&d.RoomTypeID, &d.Date, &d.Allotment, &d.Sold, &d.StopSell); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// SetAvailability upserts the window for one room type that belongs to the
// property. It refuses a new allotment below what is already sold on any night.
func (r *Repository) SetAvailability(ctx context.Context, propertyID, roomTypeID string, in SetAvailabilityInput) (int, error) {
	var owned bool
	if err := r.db.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM public.stays_room_type WHERE id = $1 AND property_id = $2)`,
		roomTypeID, propertyID).Scan(&owned); err != nil {
		return 0, err
	}
	if !owned {
		return 0, ErrNotFound
	}

	from, to := in.From.Format(dateLayout), in.To.Format(dateLayout)
	var clash int
	if err := r.db.QueryRow(ctx, `
		SELECT count(*) FROM public.stays_availability_day
		WHERE room_type_id = $1 AND date BETWEEN $2::date AND $3::date AND sold > $4`,
		roomTypeID, from, to, in.Allotment).Scan(&clash); err != nil {
		return 0, err
	}
	if clash > 0 {
		return 0, fmt.Errorf("%w: %d night(s) already have more bookings than this allotment", ErrValidation, clash)
	}

	tag, err := r.db.Exec(ctx, `
		INSERT INTO public.stays_availability_day (room_type_id, date, allotment, sold, stop_sell)
		SELECT $1, d::date, $4, 0, $5
		FROM generate_series($2::date, $3::date, interval '1 day') AS d
		ON CONFLICT (room_type_id, date) DO UPDATE
		SET allotment = EXCLUDED.allotment, stop_sell = EXCLUDED.stop_sell, updated_at = now()`,
		roomTypeID, from, to, in.Allotment, in.StopSell)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}
