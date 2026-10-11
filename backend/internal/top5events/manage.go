package top5events

// editDecision says which classes of event fields an organiser may edit.
type editDecision struct {
	AllowSoft     bool
	AllowHardTime bool
	Reason        string
}

const (
	reasonHardTimeLocked = "date, time and venue are locked because tickets have been sold"
	reasonNotEditable    = "event cannot be edited in its current state"
)

// editability applies the tiered-lock rules and denies by default.
//
// Soft fields are editable ONLY in DRAFT, SUBMITTED, APPROVED, LIVE and PAUSED.
// Every other state (CLOSED, CANCELLED, SUSPENDED, and any unknown or empty
// value) blocks all edits. SUSPENDED is an admin hold: organisers must not edit
// while it applies. Within the editable set, hard-time fields additionally need
// either no ticket sold or a DRAFT event.
func editability(state EventState, anyTicketSold bool) editDecision {
	switch state {
	case EventDraft, EventSubmitted, EventApproved, EventLive, EventPaused:
	case EventSuspended:
		return editDecision{Reason: "event suspended"}
	default:
		return editDecision{Reason: reasonNotEditable}
	}
	d := editDecision{AllowSoft: true}
	if !anyTicketSold || state == EventDraft {
		d.AllowHardTime = true
	} else {
		d.Reason = reasonHardTimeLocked
	}
	return d
}
