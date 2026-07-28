package estate

import "context"

// notifications.go — Block 43 estate notification taxonomy + Block 37 push delivery.
//
// Each estate event emits a notification that is (a) persisted to estate_notifications
// for the in-app feed and (b) enqueued for push via the platform notifications queue
// (the Notifier adapter resolves the recipient's device push tokens). Delivery is
// fire-and-forget: a notification failure never fails the underlying operation
// (mirrors the project's email policy).

// The 18 estate notification types (Block 43).
const (
	NotifVisitorArrived           = "visitor_arrived"
	NotifVisitorDenied            = "visitor_denied"
	NotifVisitorOverstayed        = "visitor_overstayed"
	NotifPaymentDue               = "payment_due"
	NotifPaymentOverdue           = "payment_overdue"
	NotifRestrictionApplied       = "restriction_applied"
	NotifRestrictionLifted        = "restriction_lifted"
	NotifMeetingReminder          = "meeting_reminder"
	NotifTaskAssigned             = "task_assigned"
	NotifTaskOverdue              = "task_overdue"
	NotifRepairUpdate             = "repair_update"
	NotifVendorAssigned           = "vendor_assigned"
	NotifElectionReminder         = "election_reminder"
	NotifElectionResult           = "election_result"
	NotifAnnouncement             = "announcement"
	NotifEmergencyAlert           = "emergency_alert"
	NotifFacilityBookingConfirmed = "facility_booking_confirmed"
	NotifAdminApprovalRequired    = "admin_approval_required"
)

// EstateNotificationTypes is the full taxonomy (used for validation/tests).
var EstateNotificationTypes = []string{
	NotifVisitorArrived, NotifVisitorDenied, NotifVisitorOverstayed,
	NotifPaymentDue, NotifPaymentOverdue, NotifRestrictionApplied, NotifRestrictionLifted,
	NotifMeetingReminder, NotifTaskAssigned, NotifTaskOverdue, NotifRepairUpdate,
	NotifVendorAssigned, NotifElectionReminder, NotifElectionResult, NotifAnnouncement,
	NotifEmergencyAlert, NotifFacilityBookingConfirmed, NotifAdminApprovalRequired,
}

// EstateNotification is the payload handed to the Notifier for push delivery.
type EstateNotification struct {
	EstateID string
	UserID   string
	Type     string
	Title    string
	Body     string
	DeepLink string
	Data     map[string]any
}

// Notifier dispatches an estate notification for push delivery. Kept as a narrow
// interface so the estate package stays decoupled from the platform notifications
// queue; the wiring layer adapts it (resolving device push tokens and enqueuing).
type Notifier interface {
	Notify(ctx context.Context, n EstateNotification) error
}

// NotifierFunc adapts a plain function to the Notifier interface.
type NotifierFunc func(ctx context.Context, n EstateNotification) error

func (f NotifierFunc) Notify(ctx context.Context, n EstateNotification) error { return f(ctx, n) }

// WithNotifier wires the push notifier. When unset, notifications are still
// persisted to the in-app feed; only push delivery is skipped.
func (s *Service) WithNotifier(n Notifier) *Service {
	s.notifier = n
	return s
}

// notifCategory maps a notification type to the estate_notifications.category
// CHECK domain (general|payment|meeting|election|security|maintenance|facility|
// announcement|system). Pure (no DB) for unit testing.
func notifCategory(notifType string) string {
	switch notifType {
	case NotifPaymentDue, NotifPaymentOverdue, NotifRestrictionApplied, NotifRestrictionLifted:
		return "payment"
	case NotifMeetingReminder:
		return "meeting"
	case NotifElectionReminder, NotifElectionResult:
		return "election"
	case NotifVisitorArrived, NotifVisitorDenied, NotifVisitorOverstayed, NotifEmergencyAlert:
		return "security"
	case NotifRepairUpdate, NotifVendorAssigned:
		return "maintenance"
	case NotifFacilityBookingConfirmed:
		return "facility"
	case NotifAnnouncement:
		return "announcement"
	case NotifAdminApprovalRequired:
		return "system"
	default: // task_assigned, task_overdue, and any future type
		return "general"
	}
}

// notifDeepLink returns the mobile route a notification should open. Pure.
func notifDeepLink(notifType string) string {
	switch notifCategory(notifType) {
	case "payment":
		return "/dues"
	case "meeting":
		return "/meetings"
	case "election":
		return "/election"
	case "security":
		return "/emergencies"
	case "maintenance":
		return "/repairs"
	case "facility":
		return "/facilities"
	case "announcement":
		return "/announcements"
	default:
		return "/estate-notifications"
	}
}

// notify persists one in-app notification and enqueues a push to the recipient.
// Fire-and-forget: errors are swallowed so a notification failure never breaks
// the calling operation.
func (s *Service) notify(ctx context.Context, estateID, userID, notifType, title, body string, data map[string]any) {
	if userID == "" {
		return
	}
	deepLink := notifDeepLink(notifType)
	_, _ = s.db.Exec(ctx,
		`INSERT INTO estate_notifications (id, estate_id, user_id, category, title, body, deep_link)
		 VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6)`,
		estateID, userID, notifCategory(notifType), title, body, deepLink)
	if s.notifier != nil {
		_ = s.notifier.Notify(ctx, EstateNotification{
			EstateID: estateID, UserID: userID, Type: notifType,
			Title: title, Body: body, DeepLink: deepLink, Data: data,
		})
	}
}

// notifyMembers fans a notification out to estate members. When roles is empty
// every member is targeted; otherwise only members with one of the given roles
// (e.g. estate_admin, estate_security). Fire-and-forget.
func (s *Service) notifyMembers(ctx context.Context, estateID, notifType, title, body string, data map[string]any, roles ...string) {
	q := `SELECT user_id FROM estate_residents WHERE estate_id=$1`
	args := []any{estateID}
	if len(roles) > 0 {
		q += ` AND role = ANY($2)`
		args = append(args, roles)
	}
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return
	}
	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	for _, id := range ids {
		s.notify(ctx, estateID, id, notifType, title, body, data)
	}
}
