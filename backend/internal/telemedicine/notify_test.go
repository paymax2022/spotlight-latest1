package telemedicine

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

type recNotifier struct {
	mu   sync.Mutex
	got  []notice
	done chan struct{}
	want int
	err  error
}

func (r *recNotifier) NotifyUser(_ context.Context, userID, event, title, body string, data map[string]any) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.got = append(r.got, notice{userID: userID, event: event, title: title, body: body, data: data})
	if len(r.got) == r.want {
		close(r.done)
	}
	return r.err
}

func TestBookedNotices_PatientAndDoctor(t *testing.T) {
	at := time.Date(2026, 11, 2, 9, 0, 0, 0, time.UTC)
	a := &Appointment{ID: "a1", PatientID: "p1", DoctorName: "Dr Ada", ConsultationType: "video", ScheduledAt: at}
	ns := bookedNotices(a, "du1")
	if len(ns) != 2 || ns[0].userID != "p1" || ns[1].userID != "du1" {
		t.Fatalf("recipients = %+v", ns)
	}
	if !strings.Contains(ns[0].body, "Dr Ada") || !strings.Contains(ns[0].body, "10:00 AM WAT") {
		t.Errorf("patient body = %q", ns[0].body)
	}
	if strings.Contains(ns[1].body, "p1") {
		t.Error("doctor notice must not carry the patient id")
	}
	if ns[0].data["appointment_id"] != "a1" || ns[0].event != NotifyEventBooked {
		t.Errorf("data/event = %v %s", ns[0].data, ns[0].event)
	}
	if got := bookedNotices(a, ""); len(got) != 1 {
		t.Errorf("unresolved doctor user should notify the patient only, got %d", len(got))
	}
}

func TestCancelledNotices_MentionRefund(t *testing.T) {
	ns := cancelledNotices("a1", "p1", "du1", "Dr Ada", time.Now())
	if len(ns) != 2 || ns[0].event != NotifyEventCancelled || !strings.Contains(ns[0].body, "refunded") {
		t.Fatalf("notices = %+v", ns)
	}
}

func TestDispatch_SendsAllAndSurvivesErrors(t *testing.T) {
	r := &recNotifier{done: make(chan struct{}), want: 2, err: errors.New("queue down")}
	s := (&Service{}).WithNotifier(r)
	ctx, cancel := context.WithCancel(context.Background())
	s.dispatch(ctx, []notice{{userID: "a"}, {userID: "b"}})
	cancel() // request ends immediately; delivery must still happen
	select {
	case <-r.done:
	case <-time.After(5 * time.Second):
		t.Fatal("dispatch did not deliver both notices")
	}
	(&Service{}).dispatch(context.Background(), []notice{{userID: "x"}}) // nil notifier: no-op, no panic
}
