package transport

// The parcel fields the apps need on top of the raw row: places with their
// coordinates, the assigned courier as the sender sees them, the courier's
// expected and actual pay, and the courier's own history. See
// contracts/transport.openapi.yaml (ParcelDetail, ParcelRequest, CourierParcel).

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/internal/finance/settlement"
)

func parcelPlace(address string, lat, lng *float64) map[string]any {
	return map[string]any{"address": address, "lat": lat, "lng": lng}
}

// maskPhone keeps only the last four digits: the sender can recognise the
// courier's number but never reads it (contact goes through the app).
func maskPhone(phone string) string {
	digits := make([]rune, 0, len(phone))
	for _, r := range phone {
		if r >= '0' && r <= '9' {
			digits = append(digits, r)
		}
	}
	if len(digits) < 4 {
		return ""
	}
	return "••••" + string(digits[len(digits)-4:])
}

// parcelCourierView is the assigned courier as the sender sees them, or nil.
func (s *Service) parcelCourierView(ctx context.Context, courierID *string) map[string]any {
	if courierID == nil {
		return nil
	}
	var name string
	var photo, vehicleType, plate, phone *string
	var rating *float64
	if err := s.db.QueryRow(ctx,
		`SELECT name, photo_url, vehicle_type, vehicle_reg, phone, rating FROM drivers WHERE id=$1`, *courierID,
	).Scan(&name, &photo, &vehicleType, &plate, &phone, &rating); err != nil {
		return nil
	}
	vehicle := ""
	if vehicleType != nil && *vehicleType != "" {
		vehicle = displayVehicleType(*vehicleType)
	}
	if plate != nil && *plate != "" {
		if vehicle != "" {
			vehicle += " • "
		}
		vehicle += *plate
	}
	out := map[string]any{
		"id": *courierID, "name": name, "photoUrl": photo, "rating": 0.0,
		"vehicleType": vehicleType, "plateNumber": plate, "vehicle": vehicle, "phoneMasked": nil,
	}
	if rating != nil {
		out["rating"] = *rating
	}
	if phone != nil {
		if m := maskPhone(*phone); m != "" {
			out["phoneMasked"] = m
		}
	}
	return out
}

func displayVehicleType(t string) string {
	if t == "" {
		return ""
	}
	return strings.ToUpper(t[:1]) + t[1:]
}

// courierNetKobo is what this courier would be paid for a fare: the split the
// settlement will actually use (their commission tier through ComputeLegs, the
// same function that moves the money), not a hardcoded share.
func (s *Service) courierNetKobo(ctx context.Context, courierID string, fareKobo int64) int64 {
	var tier string
	_ = s.db.QueryRow(ctx, `SELECT commission_tier FROM drivers WHERE id=$1`, courierID).Scan(&tier)
	comm, err := s.commissionForTier(ctx, tier)
	if err != nil {
		return 0
	}
	legs, err := settlement.ComputeLegs(fareKobo, settlementSplit("courier", comm, 0))
	if err != nil {
		return 0
	}
	return legs.ProviderKobo
}

// parcelDeliveredAt is when the parcel reached 'delivered' (its audit event).
func (s *Service) parcelDeliveredAt(ctx context.Context, parcelID string) *time.Time {
	var at time.Time
	if err := s.db.QueryRow(ctx, `
		SELECT created_at FROM transport_audit_log
		WHERE entity_type='parcel' AND entity_id=$1 AND action='parcel.delivered'
		ORDER BY created_at LIMIT 1`, parcelID).Scan(&at); err != nil {
		return nil
	}
	return &at
}

// CourierParcels returns the courier's own parcels, newest first, with what
// each actually paid them (the settled provider leg).
func (s *Service) CourierParcels(ctx context.Context, driverUserID string) (map[string]any, error) {
	courierID, err := s.driverGate(ctx, driverUserID)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `
		SELECT p.id, p.status, p.pickup_address, p.pickup_lat, p.pickup_lng,
		       p.dropoff_address, p.dropoff_lat, p.dropoff_lng, p.category, p.size, p.speed,
		       p.fare_kobo, p.created_at,
		       CASE WHEN st.status='settled' THEN COALESCE(st.provider_kobo,0) ELSE 0 END,
		       (SELECT a.created_at FROM transport_audit_log a
		         WHERE a.entity_type='parcel' AND a.entity_id=p.id::text AND a.action='parcel.delivered'
		         ORDER BY a.created_at LIMIT 1)
		FROM parcels p LEFT JOIN settlements st ON st.id = p.settlement_id
		WHERE p.courier_id=$1
		ORDER BY p.created_at DESC LIMIT 100`, courierID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	parcels := []map[string]any{}
	var delivered, earned int64
	for rows.Next() {
		var id, status, pickup, dropoff, category, size, speed string
		var pLat, pLng, dLat, dLng *float64
		var fare, paid int64
		var createdAt time.Time
		var deliveredAt *time.Time
		if err := rows.Scan(&id, &status, &pickup, &pLat, &pLng, &dropoff, &dLat, &dLng,
			&category, &size, &speed, &fare, &createdAt, &paid, &deliveredAt); err != nil {
			return nil, err
		}
		if status == "delivered" {
			delivered++
			earned += paid
		}
		parcels = append(parcels, map[string]any{
			"id": id, "status": status,
			"pickup": parcelPlace(pickup, pLat, pLng), "dropoff": parcelPlace(dropoff, dLat, dLng),
			"category": category, "size": size, "speed": speed,
			"fareKobo": fare, "earnedKobo": paid, "createdAt": createdAt, "deliveredAt": deliveredAt,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return map[string]any{
		"parcels": parcels,
		"totals":  map[string]any{"delivered": delivered, "earnedKobo": earned},
	}, nil
}

// CourierParcels: GET /driver/parcels — the courier's own history and earnings.
func (h *Handler) CourierParcels(c *gin.Context) {
	out, err := h.svc.CourierParcels(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}
