package transport

// LIVE-DB tests: the receiver is sent the drop-off PIN by SMS once the parcel is
// picked up (FEATURE_PARCEL_RECEIVER_PIN_SMS). Skipped unless TEST_DATABASE_URL
// is set. Pins:
//  1. Pickup sends ONE SMS, to the receiver, carrying the drop-off PIN; the
//     sender sees receiverNotifiedAt, the courier never does.
//  2. At most once per parcel, however often (or concurrently) it is retried.
//  3. Best-effort: a failed send never fails the pickup and is not retried;
//     receiverNotifiedAt stays null.
//  4. Off (no sender wired) sends nothing.
//  5. The PIN is never written to logs or the audit trail.

import (
	"bytes"
	"context"
	"errors"
	"log"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeReceiverSMS struct {
	mu   sync.Mutex
	sent []struct{ to, body string }
	err  error
}

func (f *fakeReceiverSMS) SendSMS(_ context.Context, to, body string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = append(f.sent, struct{ to, body string }{to, body})
	return f.err
}

func (f *fakeReceiverSMS) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.sent)
}

// pickedUpParcel books a parcel and drives it through accept → pickup PIN →
// picked up, returning the parcel, its drop-off PIN and the courier's user id.
func pickedUpParcel(t *testing.T, f *prepaidParcelFixture) (parcelRow, string, string) {
	t.Helper()
	ctx := context.Background()
	p, _ := f.book(t, parcelReq())
	rider := seedParcelRider(t, ctx, f.pool, "Receiver PIN Rider")
	if _, err := f.svc.AcceptParcel(ctx, p.ID, rider); err != nil {
		t.Fatalf("accept: %v", err)
	}
	p = f.parcel(t, p.ID)
	if err := f.svc.VerifyParcelPickupPin(ctx, p.ID, rider, *p.PickupPin); err != nil {
		t.Fatalf("pickup pin: %v", err)
	}
	if err := f.svc.MarkParcelPickedUp(ctx, p.ID, rider, "https://r2.test/pickup.jpg"); err != nil {
		t.Fatalf("picked up: %v", err)
	}
	return p, *p.DropoffPin, rider
}

// noticeState waits (up to 10s) for the asynchronous send to reach sent or
// failed, then returns the state ("" = never claimed).
func noticeState(t *testing.T, f *prepaidParcelFixture, id string) (state string, notifiedAt *time.Time) {
	t.Helper()
	return noticeStateWithin(t, f, id, 10*time.Second)
}

func noticeStateWithin(t *testing.T, f *prepaidParcelFixture, id string, wait time.Duration) (state string, notifiedAt *time.Time) {
	t.Helper()
	deadline := time.Now().Add(wait)
	for {
		var st *string
		if err := f.pool.QueryRow(context.Background(),
			`SELECT receiver_pin_notice, receiver_notified_at FROM parcels WHERE id=$1`, id).Scan(&st, &notifiedAt); err != nil {
			t.Fatalf("read notice state: %v", err)
		}
		if st != nil {
			state = *st
		}
		if state == "sent" || state == "failed" || time.Now().After(deadline) {
			return state, notifiedAt
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func TestLiveDB_ReceiverPin_PickupTextsTheReceiverTheDropoffPinOnce(t *testing.T) {
	f := newPrepaidParcelFixture(t, true)
	sms := &fakeReceiverSMS{}
	f.svc.WithReceiverPinSMS(sms)

	p, dropoffPin, rider := pickedUpParcel(t, f)
	state, at := noticeState(t, f, p.ID)
	if state != "sent" || at == nil {
		t.Fatalf("notice state %q at=%v, want sent with a timestamp", state, at)
	}
	if sms.count() != 1 {
		t.Fatalf("%d SMS sent, want 1", sms.count())
	}
	if sms.sent[0].to != "+2348000000000" {
		t.Fatalf("SMS went to %q, want the receiver's phone", sms.sent[0].to)
	}
	if !strings.Contains(sms.sent[0].body, dropoffPin) {
		t.Fatalf("SMS body %q does not carry the drop-off PIN", sms.sent[0].body)
	}
	if strings.Contains(sms.sent[0].body, *p.PickupPin) && *p.PickupPin != dropoffPin {
		t.Fatal("the SMS must never carry the PICKUP PIN")
	}

	ctx := context.Background()
	asSender, err := f.svc.ParcelDetail(ctx, p.ID, f.sender)
	if err != nil {
		t.Fatal(err)
	}
	if asSender["receiverNotifiedAt"] == nil {
		t.Fatal("the sender must see when the receiver was notified")
	}
	asCourier, err := f.svc.ParcelDetail(ctx, p.ID, rider)
	if err != nil {
		t.Fatal(err)
	}
	if _, has := asCourier["receiverNotifiedAt"]; has {
		t.Fatal("receiverNotifiedAt is sender-only")
	}
}

func TestLiveDB_ReceiverPin_RetriesNeverSendTwice(t *testing.T) {
	f := newPrepaidParcelFixture(t, true)
	sms := &fakeReceiverSMS{}
	f.svc.WithReceiverPinSMS(sms)
	p, _, _ := pickedUpParcel(t, f)
	noticeState(t, f, p.ID)

	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			f.svc.notifyReceiverDropoffPin(context.Background(), p.ID)
		}()
	}
	wg.Wait()
	if sms.count() != 1 {
		t.Fatalf("%d SMS sent across retries, want exactly 1", sms.count())
	}
}

func TestLiveDB_ReceiverPin_FailedSendNeverBlocksPickupAndIsNotRetried(t *testing.T) {
	f := newPrepaidParcelFixture(t, true)
	sms := &fakeReceiverSMS{err: errors.New("termii: provider returned 500")}
	f.svc.WithReceiverPinSMS(sms)

	p, _, _ := pickedUpParcel(t, f) // fails the test if pickup failed
	if got := f.parcel(t, p.ID); got.Status != "in_transit" {
		t.Fatalf("parcel %s, want in_transit despite the SMS failure", got.Status)
	}
	state, at := noticeState(t, f, p.ID)
	if state != "failed" || at != nil {
		t.Fatalf("notice state %q at=%v, want failed with no timestamp", state, at)
	}
	f.svc.notifyReceiverDropoffPin(context.Background(), p.ID)
	if sms.count() != 1 {
		t.Fatalf("%d attempts, want 1 (a failed send is not retried, so it can never double up)", sms.count())
	}
	if d, _ := f.svc.ParcelDetail(context.Background(), p.ID, f.sender); d["receiverNotifiedAt"] != nil {
		t.Fatal("receiverNotifiedAt must stay null after a failed send")
	}
}

func TestLiveDB_ReceiverPin_OffSendsNothing(t *testing.T) {
	f := newPrepaidParcelFixture(t, true) // no WithReceiverPinSMS
	p, _, _ := pickedUpParcel(t, f)
	if state, at := noticeStateWithin(t, f, p.ID, 500*time.Millisecond); state != "" || at != nil {
		t.Fatalf("notice state %q at=%v with the feature off, want untouched", state, at)
	}
}

func TestLiveDB_ReceiverPin_NeverLogsOrAuditsThePin(t *testing.T) {
	var buf bytes.Buffer
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })

	f := newPrepaidParcelFixture(t, true)
	sms := &fakeReceiverSMS{err: errors.New("termii: provider returned 400")}
	f.svc.WithReceiverPinSMS(sms)
	p, dropoffPin, _ := pickedUpParcel(t, f)
	noticeState(t, f, p.ID)

	if strings.Contains(buf.String(), dropoffPin) || strings.Contains(buf.String(), "+2348000000000") {
		t.Fatalf("logs carry the PIN or the full receiver phone:\n%s", buf.String())
	}
	var leaked int
	if err := f.pool.QueryRow(context.Background(), `
		SELECT count(*) FROM transport_audit_log
		WHERE entity_id::text=$1 AND action LIKE 'parcel.receiver%'
		  AND (new_value::text LIKE '%' || $2 || '%' OR new_value::text LIKE '%2348000000000%')`, p.ID, dropoffPin).Scan(&leaked); err != nil {
		t.Fatal(err)
	}
	if leaked != 0 {
		t.Fatal("the receiver-notice audit rows carry the PIN or the full phone")
	}
}

func TestReceiverPhoneNormalisation(t *testing.T) {
	for in, want := range map[string]string{
		"+234 803-123 4567": "+2348031234567",
		"08031234567":       "08031234567",
		"(0803) 123 4567":   "08031234567",
		"":                  "",
		"call me":           "",
		"+23480":            "",
	} {
		if got := normaliseReceiverPhone(in); got != want {
			t.Errorf("normaliseReceiverPhone(%q) = %q, want %q", in, got, want)
		}
	}
}
