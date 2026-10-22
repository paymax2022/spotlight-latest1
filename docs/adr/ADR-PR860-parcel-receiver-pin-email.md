# ADR-PR860: Email the parcel receiver their drop-off PIN

**Status:** Accepted · **Date:** 2026-10-22 · **Area:** transport / parcel · **Flag:** `FEATURE_PARCEL_RECEIVER_PIN_NOTIFY` (default off; needs `RESEND_API_KEY`) · **Builds on:** ADR-PR857 (SMS), ADR-PR858 (PostgREST lockdown)

## Context
ADR-PR857 texts the receiver their drop-off PIN after pickup, but SMS costs money per message. The product owner asked for free channels instead: email and in-app.
- **In-app.** The backend has no shared in-app inbox, so the only free in-app channel is push to a Paymax account. A receiver is just a name and a phone number. Reaching their account would mean matching `receiver_phone` to a profile with `user_profiles.phone_verified = true`.
- **That flag can't be trusted.** The security review (C1) showed that every signed-in user can write their own `phone` and `phone_verified` over PostgREST, and nothing on the server ever sets the flag.
- **The attack.** A courier's second account could claim the receiver's number as "verified", register a push token, and collect the drop-off PIN. That defeats the PIN and releases the escrow without the receiver.

## Decision
1. **Email the address the sender gave at booking.** Booking (wallet and card initiate) accepts an optional `receiver_email`.
   - It is parsed strictly with `net/mail`: exactly one bare address, no display name or angle brackets, a dotted domain, at most 254 characters. It is stored lower-cased.
   - A malformed address is refused with 400 before any money moves.
   - After pickup the PIN is emailed there with a fixed template.
   - Only the sender sets this field, and `parcels` is not writable over PostgREST (ADR-PR858).
2. **No account channel.** A Paymax account whose profile phone matches `receiver_phone` is never sent the PIN, by push or by email, until phone ownership is proven on the server. A regression test pins this.
3. **A synchronous provider.** `integrations.ResendClient` sends directly, so the PIN never sits in the asynq/Redis queue. Its errors carry only the provider status and short error name.
4. **One notice.** Email and SMS both run inside the single at-most-once claim from ADR-PR857, and only for paid parcels whose PIN has the server's 4-digit shape.
   - Each channel has its own 15s timeout inside a 40s bound, so a slow email can't starve the SMS.
   - The notice is `sent` if any channel accepted it. `receiver_notified_via` records which channels did, sorted.
   - Otherwise it is `failed`, and the sender is told to pass the PIN on.
5. **Secrecy and visibility.**
   - No PIN, address or phone is written to logs or the audit trail; audit rows record channel names or the failure reason.
   - `receiverEmail` and `receiverNotifiedVia` are returned to the sender only.

## Consequences
- **Booking form.** The receiver is reached for free only when the sender supplies their email. The booking form needs a "receiver email (optional)" field; that is a separate change in the app.
- **Push later.** Push to the receiver's account can come back once phones are verified on the server. That means revoking client writes on `user_profiles.phone`/`phone_verified`, and setting the flag only from a real OTP flow. The same self-set flag also weakens the KYC ownership gate (`kycAccountPhoneSource.VerifiedPhone`), so the two belong in one fix.
- **Card checkout.** On the card rail, `receiver_email` is part of the request frozen in `transport_paystack_intents.request_json`. That table is backend-only, with RLS on and no client grants.
- **Migration.** Additive migration `20271074000000`: `receiver_email` and `receiver_notified_via`, each with a CHECK.
