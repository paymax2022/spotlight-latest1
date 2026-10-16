package healthvet

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

// Hours validation and slot computation, without a database.

func win(day, start, end, typ string, enabled bool) HoursWindow {
	return HoursWindow{Day: day, Start: start, End: end, Type: typ, Enabled: enabled}
}

func TestValidateHours_AcceptsAWellFormedWeek(t *testing.T) {
	rows, err := validateHours([]HoursWindow{
		win("Mon", "09:00", "17:00", "clinic", true),
		win("Mon", "17:00", "18:00", "tele", true), // back-to-back is fine
		win("Thu", "22:00", "24:00", "home", true), // runs to midnight
		win("Fri", "09:00", "13:00", "tele", false),
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(rows) != 4 || rows[2].end != 1440 || rows[2].dbType != "HOME" {
		t.Fatalf("rows = %+v", rows)
	}
}

func TestValidateHours_RefusesWithOwnerFacingMessages(t *testing.T) {
	cases := map[string]struct {
		in   []HoursWindow
		want string
	}{
		"unknown day":          {[]HoursWindow{win("Funday", "09:00", "10:00", "tele", true)}, "Choose a day of the week"},
		"unknown type":         {[]HoursWindow{win("Mon", "09:00", "10:00", "video", true)}, "Each window needs a visit type"},
		"bad start":            {[]HoursWindow{win("Mon", "9am", "10:00", "tele", true)}, "Times must be HH:MM"},
		"24:00 as a start":     {[]HoursWindow{win("Mon", "24:00", "24:30", "tele", true)}, "Times must be HH:MM"},
		"end not after start":  {[]HoursWindow{win("Mon", "10:00", "10:00", "tele", true)}, "must end after it starts"},
		"shorter than a slot":  {[]HoursWindow{win("Mon", "10:00", "10:15", "tele", true)}, "at least 30 minutes"},
		"overlapping same day": {[]HoursWindow{win("Mon", "09:00", "12:00", "clinic", true), win("Mon", "11:00", "13:00", "tele", true)}, "overlap"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := validateHours(c.in)
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("err = %v, want containing %q", err, c.want)
			}
		})
	}
}

// Overlap is judged on enabled windows only: a switched-off window may overlap.
func TestValidateHours_DisabledWindowMayOverlap(t *testing.T) {
	_, err := validateHours([]HoursWindow{
		win("Mon", "09:00", "12:00", "clinic", true),
		win("Mon", "11:00", "13:00", "tele", false),
	})
	if err != nil {
		t.Fatalf("a disabled window must not count as overlap: %v", err)
	}
}

// Friday 16 October 2026, Lagos (UTC+1).
var friLagos = time.Date(2026, 10, 16, 0, 0, 0, 0, petLocal)

func at(h, m int) time.Time { return time.Date(2026, 10, 16, h, m, 0, 0, petLocal) }

func oneFridayWindow(t *testing.T, start, end, typ string) []hoursRow {
	t.Helper()
	rows, err := validateHours([]HoursWindow{win("Fri", start, end, typ, true)})
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func TestComputeSlots_HalfHourGridWithinTheWindow(t *testing.T) {
	now := at(12, 0).AddDate(0, 0, -1) // Thursday noon, so Friday is entirely ahead
	days := ComputeSlots("p1", oneFridayWindow(t, "09:00", "11:00", "tele"), nil, now, 2, petLocal)
	if len(days) != 1 || days[0].Date != "2026-10-16" {
		t.Fatalf("days = %+v", days)
	}
	slots := days[0].Slots
	if len(slots) != 4 {
		t.Fatalf("want 4 slots (09:00,09:30,10:00,10:30), got %d", len(slots))
	}
	if slots[0].Label != "09:00" || slots[3].Label != "10:30" {
		t.Fatalf("labels %s .. %s", slots[0].Label, slots[3].Label)
	}
	if slots[0].Start != "2026-10-16T08:00:00Z" {
		t.Fatalf("start must be UTC RFC3339 of the Lagos time: %s", slots[0].Start)
	}
	if slots[0].Type != "tele" || !slots[0].Available {
		t.Fatalf("slot = %+v", slots[0])
	}
}

func TestComputeSlots_PastStartsAreNotOffered(t *testing.T) {
	days := ComputeSlots("p1", oneFridayWindow(t, "09:00", "11:00", "tele"), nil, at(9, 45), 1, petLocal)
	if len(days) != 1 || len(days[0].Slots) != 2 || days[0].Slots[0].Label != "10:00" {
		t.Fatalf("at 09:45 only 10:00 and 10:30 remain: %+v", days)
	}
}

func TestComputeSlots_BusyTimeRemovesOverlappingSlots(t *testing.T) {
	busy := []busyInterval{{start: at(10, 0), end: at(10, 30)}} // one booking
	days := ComputeSlots("p1", oneFridayWindow(t, "09:00", "11:00", "tele"), busy, at(0, 0), 1, petLocal)
	got := []string{}
	for _, s := range days[0].Slots {
		got = append(got, s.Label)
	}
	if strings.Join(got, ",") != "09:00,09:30,10:30" {
		t.Fatalf("slots after the 10:00 booking = %v", got)
	}
}

func TestComputeSlots_WindowToMidnightAndDisabledWindowsIgnored(t *testing.T) {
	rows, err := validateHours([]HoursWindow{
		win("Fri", "22:00", "24:00", "home", true),
		win("Fri", "08:00", "09:00", "clinic", false),
	})
	if err != nil {
		t.Fatal(err)
	}
	days := ComputeSlots("p1", rows, nil, at(0, 0), 1, petLocal)
	if len(days) != 1 || len(days[0].Slots) != 4 || days[0].Slots[3].Label != "23:30" {
		t.Fatalf("22:00-24:00 must give four slots ending 23:30, disabled 08:00 window ignored: %+v", days)
	}
}

func TestComputeSlots_DaysWithoutSlotsAreOmittedAndCapped(t *testing.T) {
	// A 14-day span from a Thursday holds two Fridays; the other days are omitted.
	days := ComputeSlots("p1", oneFridayWindow(t, "09:00", "10:00", "tele"), nil, at(0, 0).AddDate(0, 0, -1), 14, petLocal)
	if len(days) != 2 {
		t.Fatalf("two Fridays in the span: got %d days", len(days))
	}
	for _, d := range days {
		if !strings.HasPrefix(d.Label, "Fri") {
			t.Fatalf("only Fridays have hours, got %q", d.Label)
		}
	}
	// Asking for more than the maximum is capped, and asking for none returns none.
	if got := ComputeSlots("p1", nil, nil, at(0, 0), 999, petLocal); len(got) != 0 {
		t.Fatalf("no hours → no days, got %d", len(got))
	}
	if got := ComputeSlots("p1", nil, nil, at(0, 0), 0, petLocal); got == nil || len(got) != 0 {
		t.Fatalf("zero days must be an empty, non-nil list")
	}
}

func TestClockStringRoundTrip(t *testing.T) {
	if clockString(0) != "00:00" || clockString(570) != "09:30" || clockString(1440) != "24:00" {
		t.Fatalf("%s %s %s", clockString(0), clockString(570), clockString(1440))
	}
}

// Guards that run before any service call: a nil-dependency Service would panic if
// a bad request got through.
func TestAvailabilityGuards(t *testing.T) {
	r, h := uuidGuardRouter()
	r.GET("/vets/:id/availability", h.VetAvailability)
	r.PUT("/provider/availability", h.SaveProviderAvailability)

	if w := doReq(t, r, http.MethodGet, "/vets/not-a-uuid/availability", "", ""); w.Code != http.StatusBadRequest {
		t.Fatalf("malformed vet id: %d", w.Code)
	}
	body := `{"blocks":[{"day":"Mon","start":"9am","end":"10:00","type":"tele","enabled":true}]}`
	w := doReq(t, r, http.MethodPut, "/provider/availability", body, "")
	if w.Code != http.StatusUnprocessableEntity || !strings.Contains(w.Body.String(), "Times must be HH:MM") {
		t.Fatalf("bad hours: %d %s", w.Code, w.Body.String())
	}
}
