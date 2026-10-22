# ADR-PR857: Text the parcel receiver their drop-off PIN

**Status:** Accepted · **Date:** 2026-10-22 · **Area:** transport / parcel · **Flag:** `FEATURE_PARCEL_RECEIVER_PIN_SMS` (default off; needs `TERMII_API_KEY`)

## Context
A parcel delivery completes only when the courier enters the drop-off PIN. The courier gets it from the receiver at the door. But only the sender can read the PIN, in the parcel detail. Nothing sends it to the receiver, so every delivery depends on the sender relaying it. The customer + rider end-to-end review recorded this as the last open gap.

## Decision
1. **When.** Once the courier marks the parcel picked up (`MarkParcelPickedUp`), the receiver (`parcels.receiver_phone`) gets one SMS with the drop-off PIN. Pickup is the earliest point at which the delivery is actually coming. Texting at booking would hand the PIN to the receiver days before it means anything.
2. **Channel.** The existing `integrations.TermiiClient.SendSMS`, called directly. The notifications queue would put the PIN in a Redis job payload. No new provider.
3. **At most once.** The send is *claimed* before the provider is called: `receiver_pin_notice` goes from NULL to `sending`, then to `sent` or `failed`. Retries and concurrent callers never text twice. A crash mid-send leaves `sending` and nothing is re-sent; one missed SMS is better than a duplicate PIN text. A failed send is not retried either.
4. **Best-effort.** The send runs in the background after the pickup has committed, with a bounded timeout. A failure only records `failed` and never fails or delays the courier's call. The sender still has the PIN.
5. **Secrecy.**
   - The PIN is read from `parcels.dropoff_pin` at send time and stored nowhere new.
   - It never appears in logs or the audit trail. Those record only the channel and the outcome, and logs show the phone masked.
   - The message names no sender and no address.
6. **Not an SMS relay.** `parcels` is writable over PostgREST by its sender, so a self-dealing courier could insert a row by hand. To prevent that, only a **paid** booking (`settlement_id` set) whose PIN is exactly **4 digits** (the only shape `generatePin` makes) is ever texted. Without these checks, a forged row could make Paymax text arbitrary content to any number for free. A provider error is logged only after the PIN and the phone are redacted from it, and the background goroutine recovers from panics so a crash there cannot take the API down.
7. **Number format.** Termii takes international digits with no `+` (`2348031234567`). A Nigerian local number (`0` plus 10 digits) gets the `234` prefix.
8. **Visibility.** The sender's parcel detail gains `receiverNotifiedAt`. Null means no SMS went out, so the app should tell the sender to pass the PIN on themselves. The courier never sees it.

## Consequences
- Cost: at most one SMS per picked-up parcel.
- A receiver number that is not a phone number is recorded as `failed` (reason `invalid_phone`) and not sent.
- There is no automatic resend. A sender-triggered "resend PIN" would be a later, separate feature, with its own rate limit.
- Additive migration `20271072000000` (two nullable columns plus a CHECK).
- A pre-existing hole sits outside this change. Over PostgREST, the assigned courier can read `parcels.dropoff_pin` (column grants plus RLS `parcels_own`). Texting the receiver adds no protection until that is closed, and it is tracked separately.
