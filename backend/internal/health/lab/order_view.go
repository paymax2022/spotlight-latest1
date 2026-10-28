package healthlab

import (
	"context"
	"time"
)

// decorateOrders attaches display facts the app needs to render an order: the
// lab's name, the sample barcode once collected, the home-collection address and
// time the patient chose, and who is assigned. One query for the whole batch.
// Best-effort and read-only: a failure leaves the base order untouched rather
// than failing the read.
func (s *Service) decorateOrders(ctx context.Context, orders []*Order) {
	if len(orders) == 0 {
		return
	}
	ids := make([]string, 0, len(orders))
	byID := make(map[string]*Order, len(orders))
	for _, o := range orders {
		ids = append(ids, o.ID)
		byID[o.ID] = o
	}
	rows, err := s.db.Query(ctx, `
		SELECT o.id::text, p.display_name, sm.barcode_ref, o.collection_address, o.scheduled_for,
		       o.assigned_phlebotomist_id::text, o.home_fee_kobo,
		       COALESCE(NULLIF(btrim(up.full_name),''), NULLIF(btrim(up.display_name),''), '')
		FROM lab_orders o
		JOIN health_providers p ON p.id = o.lab_provider_id
		LEFT JOIN lab_samples sm ON sm.order_id = o.id
		LEFT JOIN user_profiles up ON up.id = o.assigned_phlebotomist_id
		WHERE o.id = ANY($1::uuid[])`, ids)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id, lab, addr, phlebName string
		var homeFee int64
		var o *Order
		var barcode, phleb *string
		var sched *time.Time
		if err := rows.Scan(&id, &lab, &barcode, &addr, &sched, &phleb, &homeFee, &phlebName); err != nil {
			return
		}
		if o = byID[id]; o == nil {
			continue
		}
		o.LabName, o.SampleBarcode, o.CollectionAddress, o.HomeFeeKobo = lab, barcode, addr, homeFee
		o.ScheduledFor, o.AssignedPhlebotomist = sched, phleb
		if phleb != nil {
			o.AssignedPhlebotomistName = shortAuthor(phlebName)
		}
	}
}
