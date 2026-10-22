package transport

// LIVE-DB tests: the free channel for the receiver's drop-off PIN
// (FEATURE_PARCEL_RECEIVER_PIN_NOTIFY). Skipped unless TEST_DATABASE_URL is set.
// Pins:
//  1. A receiver_email given at booking is emailed the PIN after pickup.
//  2. The receiver's "own" Paymax account is NEVER a channel: user_profiles
//     phone/phone_verified are self-writable, so a courier's second account
//     claiming the receiver's number as verified must get nothing (security
//     review C1, ADR-PR860).
//  3. A malformed receiver_email is refused at booking (400) before any money moves.
//  4. The PIN, the address and the phone never reach the logs.

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math/rand/v2"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"spotlight/backend/internal/testsupport"
)

type fakeReceiverEmail struct {
	mu   sync.Mutex
	sent []struct{ to, subject, text string }
	err  error
}

func (f *fakeReceiverEmail) SendEmail(_ context.Context, to, subject, text string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = append(f.sent, struct{ to, subject, text string }{to, subject, text})
	return f.err
}

func (f *fakeReceiverEmail) to() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []string
	for _, s := range f.sent {
		out = append(out, s.to)
	}
	return out
}

func (f *fakeReceiverEmail) texts() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []string
	for _, s := range f.sent {
		out = append(out, s.text)
	}
	return out
}

// uniqueReceiverPhone keeps account-matching tests from seeing each other's rows.
func uniqueReceiverPhone() string {
	return fmt.Sprintf("+23480%08d", rand.IntN(100_000_000))
}

// seedReceiverAccount creates a Paymax account whose profile phone is phone.
func seedReceiverAccount(t *testing.T, f *prepaidParcelFixture, phone string, verified bool, pushToken string) (userID, email string) {
	t.Helper()
	ctx := context.Background()
	userID = uuid.NewString()
	email = "receiver-" + userID[:8] + "@pinchannels.test"
	if _, err := f.pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2)`, userID, email); err != nil {
		t.Fatalf("seed receiver user: %v", err)
	}
	testsupport.CleanupUser(t, f.pool, userID)
	if _, err := f.pool.Exec(ctx, `
		INSERT INTO public.user_profiles (id, phone, phone_verified) VALUES ($1,$2,$3)
		ON CONFLICT (id) DO UPDATE SET phone=EXCLUDED.phone, phone_verified=EXCLUDED.phone_verified`, userID, phone, verified); err != nil {
		t.Fatalf("seed receiver profile: %v", err)
	}
	if pushToken != "" {
		if _, err := f.pool.Exec(ctx, `INSERT INTO public.device_push_tokens (user_id, token, platform) VALUES ($1,$2,'android')`, userID, pushToken); err != nil {
			t.Fatalf("seed push token: %v", err)
		}
	}
	return userID, email
}

func notifiedVia(t *testing.T, f *prepaidParcelFixture, id string) []string {
	t.Helper()
	var via []string
	if err := f.pool.QueryRow(context.Background(), `SELECT COALESCE(receiver_notified_via, '{}') FROM parcels WHERE id=$1`, id).Scan(&via); err != nil {
		t.Fatal(err)
	}
	return via
}

// pickedUpParcelTo is pickedUpParcel for a chosen receiver phone and email.
func pickedUpParcelTo(t *testing.T, f *prepaidParcelFixture, phone, email string) (parcelRow, string, string) {
	t.Helper()
	ctx := context.Background()
	req := parcelReq()
	req.ReceiverPhone = phone
	req.ReceiverEmail = email
	p, _ := f.book(t, req)
	rider := seedParcelRider(t, ctx, f.pool, "PIN Channels Rider")
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

func TestLiveDB_ReceiverPinNotify_EmailsTheReceiverEmailGivenAtBooking(t *testing.T) {
	f := newPrepaidParcelFixture(t, true)
	mail := &fakeReceiverEmail{}
	f.svc.WithReceiverPinNotify(mail)

	p, pin, rider := pickedUpParcelTo(t, f, uniqueReceiverPhone(), "Ada.Receiver@Example.com")
	if state, at := noticeState(t, f, p.ID); state != "sent" || at == nil {
		t.Fatalf("notice state %q at=%v, want sent", state, at)
	}
	if to := mail.to(); len(to) != 1 || to[0] != "ada.receiver@example.com" {
		t.Fatalf("emails went to %v, want exactly the receiver email (normalised)", to)
	}
	if !strings.Contains(mail.texts()[0], pin) {
		t.Fatal("the receiver email must carry the drop-off PIN")
	}
	if via := notifiedVia(t, f, p.ID); len(via) != 1 || via[0] != "email" {
		t.Fatalf("notified via %v, want [email]", via)
	}
	asSender, _ := f.svc.ParcelDetail(context.Background(), p.ID, f.sender)
	if asSender["receiverEmail"] != "ada.receiver@example.com" || asSender["receiverNotifiedAt"] == nil {
		t.Fatalf("sender detail: receiverEmail=%v receiverNotifiedAt=%v", asSender["receiverEmail"], asSender["receiverNotifiedAt"])
	}
	asCourier, _ := f.svc.ParcelDetail(context.Background(), p.ID, rider)
	if _, has := asCourier["receiverEmail"]; has {
		t.Fatal("the receiver email is sender-only")
	}
}

// Regression for security review C1: anyone can mark their own profile phone
// "verified", so a second account claiming the receiver's number (with a push
// token) must never be sent the PIN — no push, no email to it.
func TestLiveDB_ReceiverPinNotify_NeverSendsToAnAccountClaimingTheReceiverPhone(t *testing.T) {
	f := newPrepaidParcelFixture(t, true)
	mail := &fakeReceiverEmail{}
	f.svc.WithReceiverPinNotify(mail)
	phone := uniqueReceiverPhone()
	_, claimerEmail := seedReceiverAccount(t, f, phone, true, "ExponentPushToken[claimer]")

	p, _, _ := pickedUpParcelTo(t, f, phone, "") // no receiver_email given
	state, at := noticeState(t, f, p.ID)
	if state != "failed" || at != nil {
		t.Fatalf("state=%q at=%v, want failed (no channel): the claimed account is not a channel", state, at)
	}
	for _, to := range mail.to() {
		if to == claimerEmail {
			t.Fatal("the PIN was emailed to an account that merely claims the receiver's phone")
		}
	}
	if len(mail.to()) != 0 {
		t.Fatalf("emails sent: %v, want none", mail.to())
	}
}

func TestLiveDB_ReceiverPinNotify_MalformedReceiverEmailRefusedAtBooking(t *testing.T) {
	f := newPrepaidParcelFixture(t, true)
	before := f.wallet(t)
	req := parcelReq()
	req.ReceiverEmail = "not-an-email"
	_, err := f.svc.BookParcel(context.Background(), f.sender, req, "bad-email-"+uuid.NewString())
	var ce *CodedError
	if !errors.As(err, &ce) || ce.Status != http.StatusBadRequest {
		t.Fatalf("want 400 for a malformed receiver_email, got %v", err)
	}
	if f.wallet(t) != before {
		t.Fatal("a refused booking moved the wallet")
	}
}

func TestLiveDB_ReceiverPinNotify_NeverLogsThePinOrAddresses(t *testing.T) {
	buf := &lockedBuffer{}
	log.SetOutput(buf)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })

	f := newPrepaidParcelFixture(t, true)
	mail := &fakeReceiverEmail{err: errors.New("resend returned 422: echo")}
	f.svc.WithReceiverPinNotify(mail)
	phone := uniqueReceiverPhone()
	p, pin, _ := pickedUpParcelTo(t, f, phone, "leak-check@example.com")
	noticeState(t, f, p.ID)
	time.Sleep(50 * time.Millisecond)
	out := buf.String()
	for _, secret := range []string{pin, "leak-check@example.com", phone, phone[1:]} {
		if strings.Contains(out, secret) {
			t.Fatalf("logs carry %q:\n%s", secret, out)
		}
	}
}

func TestReceiverEmailNormalisation(t *testing.T) {
	for in, want := range map[string]string{
		" Ada@Example.COM ":      "ada@example.com",
		"a.b+tag@sub.example.ng": "a.b+tag@sub.example.ng",
		"":                       "",
		"no-at-sign":             "",
		"two@@example.com":       "",
		"spaces in@example.com":  "",
		"x@y":                    "",
		"x<v@evil.com>":          "",
		"Ada <ada@example.com>":  "",
		"a;b@c.d":                "",
	} {
		if got := normaliseReceiverEmail(in); got != want {
			t.Errorf("normaliseReceiverEmail(%q) = %q, want %q", in, got, want)
		}
	}
}
