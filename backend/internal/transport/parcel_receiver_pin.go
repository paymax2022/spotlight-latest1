package transport

import (
	"context"
	"log"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Receiver drop-off PIN after pickup (ADR-PR857 SMS; ADR-PR<n> email + push).
//
// The courier must collect the drop-off PIN from the receiver, but only the
// sender can read it (ParcelDetail). Once the parcel is picked up, the receiver
// is told the PIN, so a delivery never stalls at the door waiting on the sender
// to relay it. Channels, each optional and independently wired:
//   - email to parcels.receiver_email, given by the sender at booking   (free)
//   - push + email to the receiver's Paymax account — only when
//     receiver_phone matches exactly ONE account with a VERIFIED phone that is
//     neither the courier's nor the sender's (an unverified match would let
//     anyone register the receiver's number and collect their PIN)    (free)
//     FEATURE_PARCEL_RECEIVER_PIN_NOTIFY covers both of the above.
//   - SMS to receiver_phone (FEATURE_PARCEL_RECEIVER_PIN_SMS; paid)
// The notice counts as sent when at least one channel accepted it;
// receiver_notified_via records which.
//
//   - At most once per parcel: the send is CLAIMED (receiver_pin_notice NULL →
//     'sending') before the provider is called, so retries and concurrent
//     callers never text twice. A crash mid-send leaves 'sending' and nothing is
//     re-sent: one missed SMS beats a duplicate PIN text.
//   - Best-effort: it runs after the pickup has committed, off the request,
//     and a failure only records 'failed'. The sender still has the PIN.
//   - The PIN and the full phone number are never logged or audited; the PIN
//     is read from parcels.dropoff_pin at send time and stored nowhere new.
//   - Only a PAID booking (it has a fare settlement) with a server-shaped PIN
//     (exactly 4 digits) is texted. parcels is writable over PostgREST by its
//     sender, so without both checks a self-dealing courier could insert a row
//     whose "PIN" is arbitrary text and have Paymax SMS it to any number.
//   - A process killed between the claim and the send leaves 'sending': that
//     receiver is never texted (at most once), and the sender sees
//     receiverNotifiedAt = null.

// ReceiverSMSSender delivers one plain-text SMS (integrations.TermiiClient).
type ReceiverSMSSender interface {
	SendSMS(ctx context.Context, to, body string) error
}

// ReceiverEmailSender sends one plain-text email (integrations.ResendClient).
type ReceiverEmailSender interface {
	SendEmail(ctx context.Context, to, subject, text string) error
}

// ReceiverPushSender pushes one notification to a user's devices
// (integrations.ExpoPushClient).
type ReceiverPushSender interface {
	SendPush(ctx context.Context, tokens []string, title, body string) error
}

// WithReceiverPinSMS turns the receiver PIN text on. nil (the default, and what
// the wiring passes when the flag is off or SMS is not configured) = off.
func (s *Service) WithReceiverPinSMS(sender ReceiverSMSSender) *Service {
	s.receiverSMS = sender
	return s
}

// WithReceiverPinNotify turns the free channels on: email (to receiver_email
// and to a matched account) and push (to a matched account). Either may be nil.
func (s *Service) WithReceiverPinNotify(email ReceiverEmailSender, push ReceiverPushSender) *Service {
	s.receiverEmail, s.receiverPush = email, push
	return s
}

func (s *Service) receiverNoticeOn() bool {
	return s.receiverSMS != nil || s.receiverEmail != nil || s.receiverPush != nil
}

// receiverEmailRe is deliberately plain: one @, no spaces, a dotted domain.
var receiverEmailRe = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

// normaliseReceiverEmail returns the address lower-cased and trimmed, or "" if
// it is not one (or is longer than the 254 an address may be).
func normaliseReceiverEmail(raw string) string {
	e := strings.ToLower(strings.TrimSpace(raw))
	if len(e) > 254 || !receiverEmailRe.MatchString(e) {
		return ""
	}
	return e
}

// receiverNationalNumber is the last 10 digits — how user_profiles.phone is
// matched everywhere (services.NormalizePhone, user_profiles_phone_nsn_idx).
func receiverNationalNumber(phone string) string {
	d := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, phone)
	if len(d) < 10 {
		return ""
	}
	return d[len(d)-10:]
}

const receiverPinSendTimeout = 20 * time.Second

// receiverPhoneRe: optional + then 7–15 digits, after stripping spaces, dashes
// and brackets (the connect onboarding rule).
var receiverPhoneRe = regexp.MustCompile(`^\+?\d{7,15}$`)

// dropoffPinRe is the only PIN shape the server generates (generatePin).
var dropoffPinRe = regexp.MustCompile(`^\d{4}$`)

// normaliseReceiverPhone returns the number in Termii's international format
// (digits only, country code first: 2348031234567), or "" if it is not a phone
// number. A Nigerian local number (0 + 10 digits) gets the 234 prefix.
func normaliseReceiverPhone(raw string) string {
	p := strings.NewReplacer(" ", "", "-", "", "(", "", ")", "").Replace(strings.TrimSpace(raw))
	if !receiverPhoneRe.MatchString(p) {
		return ""
	}
	p = strings.TrimPrefix(p, "+")
	if len(p) == 11 && strings.HasPrefix(p, "0") {
		p = "234" + p[1:]
	}
	return p
}

// redact removes the PIN and the phone from a provider error before it is
// logged: a provider (or a proxy in front of it) may echo the request body.
func redact(msg string, secrets ...string) string {
	for _, sec := range secrets {
		if sec != "" {
			msg = strings.ReplaceAll(msg, sec, "[redacted]")
		}
	}
	return msg
}

// maskReceiverPhone keeps a log line useful without the full number.
func maskReceiverPhone(p string) string {
	if len(p) <= 4 {
		return "****"
	}
	return strings.Repeat("*", len(p)-4) + p[len(p)-4:]
}

func receiverPinMessage(pin string) string {
	return "Paymax: a parcel is on its way to you. When the courier hands it over, give them this delivery PIN: " +
		pin + ". Do not share it before you have the parcel."
}

const receiverPinEmailSubject = "Your Paymax delivery PIN"

func receiverPinEmail(pin string) string {
	return "A parcel is on its way to you through Paymax.\n\n" +
		"When the courier hands it over, give them this delivery PIN: " + pin + "\n\n" +
		"Do not share the PIN before you have the parcel. If you are not expecting a parcel, you can ignore this email."
}

// notifyReceiverAfterPickup tells the receiver off the request path: the pickup
// has already committed, and a slow provider must not hold the courier's call.
func (s *Service) notifyReceiverAfterPickup(ctx context.Context, parcelID string) {
	if !s.receiverNoticeOn() {
		return
	}
	go func() {
		// A panic here would take the whole process down (Gin's recovery only
		// covers request goroutines). Log the parcel only — never the value.
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[transport] parcel %s: receiver PIN notice panicked; not sent", parcelID)
			}
		}()
		s.notifyReceiverDropoffPin(context.WithoutCancel(ctx), parcelID)
	}()
}

// receiverAccount is the receiver's own Paymax account, when there is exactly one.
type receiverAccount struct {
	userID, email string
	pushTokens    []string
}

// findReceiverAccount resolves receiver_phone to ONE account with a verified
// phone, excluding the courier and the sender. Ambiguous or unverified → none.
func (s *Service) findReceiverAccount(ctx context.Context, phone, courierUserID, senderID string) *receiverAccount {
	nsn := receiverNationalNumber(phone)
	if nsn == "" {
		return nil
	}
	rows, err := s.db.Query(ctx, `
		SELECT up.id::text, COALESCE(au.email, '')
		FROM public.user_profiles up LEFT JOIN auth.users au ON au.id = up.id
		WHERE up.phone_verified IS TRUE
		  AND right(regexp_replace(COALESCE(up.phone,''), '\D', '', 'g'), 10) = $1
		LIMIT 2`, nsn)
	if err != nil {
		return nil
	}
	var found []receiverAccount
	for rows.Next() {
		var a receiverAccount
		if rows.Scan(&a.userID, &a.email) == nil {
			found = append(found, a)
		}
	}
	rows.Close()
	if len(found) != 1 || found[0].userID == courierUserID || found[0].userID == senderID {
		return nil
	}
	a := found[0]
	trows, err := s.db.Query(ctx, `SELECT token FROM public.device_push_tokens WHERE user_id=$1::uuid ORDER BY updated_at DESC LIMIT 10`, a.userID)
	if err == nil {
		for trows.Next() {
			var tok string
			if trows.Scan(&tok) == nil && tok != "" {
				a.pushTokens = append(a.pushTokens, tok)
			}
		}
		trows.Close()
	}
	return &a
}

// notifyReceiverDropoffPin claims the parcel's one receiver notice and sends it
// through every channel that can reach the receiver. Safe to call any number of
// times, concurrently: only the claim winner sends.
func (s *Service) notifyReceiverDropoffPin(ctx context.Context, parcelID string) {
	if !s.receiverNoticeOn() {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, receiverPinSendTimeout)
	defer cancel()

	var senderID, phone, pin, courierUserID string
	var receiverEmail *string
	err := s.db.QueryRow(ctx, `
		UPDATE parcels SET receiver_pin_notice='sending'
		WHERE id=$1 AND receiver_pin_notice IS NULL
		  AND status IN ('picked_up','in_transit') AND dropoff_pin IS NOT NULL
		  AND settlement_id IS NOT NULL
		RETURNING sender_id::text, receiver_phone, receiver_email, dropoff_pin,
		          COALESCE((SELECT d.user_id::text FROM drivers d WHERE d.id = parcels.courier_id), '')`,
		parcelID).Scan(&senderID, &phone, &receiverEmail, &pin, &courierUserID)
	if err != nil {
		return // already claimed (sent / failed / in flight), not in transit, or no row
	}

	// Each failure is logged BEFORE it is recorded, so a recorded outcome
	// always has its log line.
	if !dropoffPinRe.MatchString(pin) {
		log.Printf("[transport] parcel %s: receiver PIN notice not sent: the stored PIN is not a server-generated PIN", parcelID)
		s.finishReceiverNotice(ctx, parcelID, senderID, nil, "invalid_pin")
		return
	}

	var via []string
	add := func(ch string) {
		for _, v := range via {
			if v == ch {
				return
			}
		}
		via = append(via, ch)
	}
	emailed := map[string]bool{}
	sendEmail := func(to, who string) {
		if s.receiverEmail == nil || to == "" || emailed[to] {
			return
		}
		emailed[to] = true
		if err := s.receiverEmail.SendEmail(ctx, to, receiverPinEmailSubject, receiverPinEmail(pin)); err != nil {
			log.Printf("[transport] parcel %s: receiver PIN email (%s) failed: %s", parcelID, who, redact(err.Error(), pin, to))
			return
		}
		add("email")
	}

	// 1. The address the sender gave at booking.
	if receiverEmail != nil {
		sendEmail(normaliseReceiverEmail(*receiverEmail), "booking address")
	}
	// 2. The receiver's own verified account: push to their devices, email them.
	if s.receiverEmail != nil || s.receiverPush != nil {
		if acct := s.findReceiverAccount(ctx, phone, courierUserID, senderID); acct != nil {
			if s.receiverPush != nil && len(acct.pushTokens) > 0 {
				if err := s.receiverPush.SendPush(ctx, acct.pushTokens, "Your parcel is on its way", receiverPinMessage(pin)); err != nil {
					log.Printf("[transport] parcel %s: receiver PIN push failed: %s", parcelID, redact(err.Error(), append([]string{pin}, acct.pushTokens...)...))
				} else {
					add("push")
				}
			}
			sendEmail(normaliseReceiverEmail(acct.email), "account address")
		}
	}
	// 3. SMS (paid; its own flag).
	if s.receiverSMS != nil {
		if to := normaliseReceiverPhone(phone); to == "" {
			log.Printf("[transport] parcel %s: receiver PIN SMS not sent: receiver phone is not a phone number", parcelID)
		} else if err := s.receiverSMS.SendSMS(ctx, to, receiverPinMessage(pin)); err != nil {
			// The provider's error text, never the body we sent (it holds the PIN).
			log.Printf("[transport] parcel %s: receiver PIN SMS to %s failed: %s", parcelID, maskReceiverPhone(to),
				redact(err.Error(), pin, to, strings.TrimSpace(phone)))
		} else {
			add("sms")
		}
	}

	if len(via) == 0 {
		log.Printf("[transport] parcel %s: receiver PIN notice: no channel reached the receiver — the sender must pass the PIN on", parcelID)
		s.finishReceiverNotice(ctx, parcelID, senderID, nil, "no_channel_reached")
		return
	}
	s.finishReceiverNotice(ctx, parcelID, senderID, via, "")
}

// finishReceiverNotice records the outcome of a claimed send and audits it
// (channels and outcome only — no PIN, no phone, no address). The audit actor
// is the sender: the notice goes out on their behalf. via == nil = failed.
func (s *Service) finishReceiverNotice(ctx context.Context, parcelID, senderID string, via []string, reason string) {
	// Detached: the send's own deadline may be what just expired.
	wctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	sent := len(via) > 0
	sort.Strings(via) // stable record, whatever order the channels answered in
	var err error
	if sent {
		_, err = s.db.Exec(wctx,
			`UPDATE parcels SET receiver_pin_notice='sent', receiver_notified_at=NOW(), receiver_notified_via=$2
			 WHERE id=$1 AND receiver_pin_notice='sending'`, parcelID, via)
	} else {
		_, err = s.db.Exec(wctx,
			`UPDATE parcels SET receiver_pin_notice='failed' WHERE id=$1 AND receiver_pin_notice='sending'`, parcelID)
	}
	if err != nil {
		log.Printf("[transport] parcel %s: recording the receiver PIN notice outcome failed: %v", parcelID, err)
	}
	action, meta := "parcel.receiver_pin_sent", map[string]any{"channels": via}
	if !sent {
		action, meta = "parcel.receiver_pin_failed", map[string]any{"reason": reason}
	}
	s.recordModeEvent(wctx, senderID, action, "parcel", parcelID, "", "", meta)
}
