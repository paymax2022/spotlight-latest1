package transport

import (
	"context"
	"log"
	"regexp"
	"strings"
	"time"
)

// Receiver drop-off PIN by SMS (FEATURE_PARCEL_RECEIVER_PIN_SMS).
//
// The courier must collect the drop-off PIN from the receiver, but only the
// sender can read it (ParcelDetail). Once the parcel is picked up, the receiver
// (parcels.receiver_phone) is texted the PIN, so a delivery never stalls at the
// door waiting on the sender to relay it.
//
//   - At most once per parcel: the send is CLAIMED (receiver_pin_notice NULL →
//     'sending') before the provider is called, so retries and concurrent
//     callers never text twice. A crash mid-send leaves 'sending' and nothing is
//     re-sent: one missed SMS beats a duplicate PIN text.
//   - Best-effort: it runs after the pickup has committed, off the request,
//     and a failure only records 'failed'. The sender still has the PIN.
//   - The PIN and the full phone number are never logged or audited; the PIN
//     is read from parcels.dropoff_pin at send time and stored nowhere new.

// ReceiverSMSSender delivers one plain-text SMS (integrations.TermiiClient).
type ReceiverSMSSender interface {
	SendSMS(ctx context.Context, to, body string) error
}

// WithReceiverPinSMS turns the receiver PIN text on. nil (the default, and what
// the wiring passes when the flag is off or SMS is not configured) = off.
func (s *Service) WithReceiverPinSMS(sender ReceiverSMSSender) *Service {
	s.receiverSMS = sender
	return s
}

const receiverPinSendTimeout = 20 * time.Second

// receiverPhoneRe: optional + then 7–15 digits, after stripping spaces, dashes
// and brackets (the connect onboarding rule; Termii takes +234… and 08…).
var receiverPhoneRe = regexp.MustCompile(`^\+?\d{7,15}$`)

// normaliseReceiverPhone returns the number to text, or "" if it is not one.
func normaliseReceiverPhone(raw string) string {
	p := strings.NewReplacer(" ", "", "-", "", "(", "", ")", "").Replace(strings.TrimSpace(raw))
	if !receiverPhoneRe.MatchString(p) {
		return ""
	}
	return p
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

// notifyReceiverAfterPickup texts the receiver off the request path: the pickup
// has already committed, and a slow provider must not hold the courier's call.
func (s *Service) notifyReceiverAfterPickup(ctx context.Context, parcelID string) {
	if s.receiverSMS == nil {
		return
	}
	go s.notifyReceiverDropoffPin(context.WithoutCancel(ctx), parcelID)
}

// notifyReceiverDropoffPin claims the parcel's one receiver notice and sends it.
// Safe to call any number of times, concurrently: only the claim winner sends.
func (s *Service) notifyReceiverDropoffPin(ctx context.Context, parcelID string) {
	if s.receiverSMS == nil {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, receiverPinSendTimeout)
	defer cancel()

	var senderID, phone, pin string
	err := s.db.QueryRow(ctx, `
		UPDATE parcels SET receiver_pin_notice='sending'
		WHERE id=$1 AND receiver_pin_notice IS NULL
		  AND status IN ('picked_up','in_transit') AND dropoff_pin IS NOT NULL
		RETURNING sender_id::text, receiver_phone, dropoff_pin`, parcelID).Scan(&senderID, &phone, &pin)
	if err != nil {
		return // already claimed (sent / failed / in flight), not in transit, or no row
	}

	to := normaliseReceiverPhone(phone)
	if to == "" {
		s.finishReceiverNotice(ctx, parcelID, senderID, false, "invalid_phone")
		log.Printf("[transport] parcel %s: receiver PIN SMS not sent: receiver phone is not a phone number", parcelID)
		return
	}
	if sendErr := s.receiverSMS.SendSMS(ctx, to, receiverPinMessage(pin)); sendErr != nil {
		s.finishReceiverNotice(ctx, parcelID, senderID, false, "provider_error")
		// The provider's error text, never the body we sent (it holds the PIN).
		log.Printf("[transport] parcel %s: receiver PIN SMS to %s failed: %v", parcelID, maskReceiverPhone(to), sendErr)
		return
	}
	s.finishReceiverNotice(ctx, parcelID, senderID, true, "")
}

// finishReceiverNotice records the outcome of a claimed send and audits it
// (channel and outcome only — no PIN, no phone). The audit actor is the sender:
// the text goes out on their behalf.
func (s *Service) finishReceiverNotice(ctx context.Context, parcelID, senderID string, sent bool, reason string) {
	// Detached: the send's own deadline may be what just expired.
	wctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	var err error
	if sent {
		_, err = s.db.Exec(wctx,
			`UPDATE parcels SET receiver_pin_notice='sent', receiver_notified_at=NOW() WHERE id=$1 AND receiver_pin_notice='sending'`, parcelID)
	} else {
		_, err = s.db.Exec(wctx,
			`UPDATE parcels SET receiver_pin_notice='failed' WHERE id=$1 AND receiver_pin_notice='sending'`, parcelID)
	}
	if err != nil {
		log.Printf("[transport] parcel %s: recording the receiver PIN SMS outcome failed: %v", parcelID, err)
	}
	action, meta := "parcel.receiver_pin_sent", map[string]any{"channel": "sms"}
	if !sent {
		action, meta["reason"] = "parcel.receiver_pin_failed", reason
	}
	s.recordModeEvent(wctx, senderID, action, "parcel", parcelID, "", "", meta)
}
