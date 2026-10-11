package top5events

// editDecision says which classes of event fields an organiser may edit.
type editDecision struct {
	AllowSoft     bool
	AllowHardTime bool
	Reason        string
}

// editability applies the tiered-lock rules: soft fields are editable in any
// non-terminal state; hard-time fields additionally need either no ticket sold
// or a DRAFT event. CLOSED and CANCELLED block everything.
func editability(state EventState, anyTicketSold bool) editDecision {
	switch state {
	case EventClosed, EventCancelled:
		return editDecision{Reason: "event is " + string(state) + " and can no longer be edited"}
	}
	d := editDecision{AllowSoft: true}
	if !anyTicketSold || state == EventDraft {
		d.AllowHardTime = true
	} else {
		d.Reason = "date, time and venue are locked because tickets have been sold"
	}
	return d
}
