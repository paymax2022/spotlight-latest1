# Agora AccessToken2 — Validation Report

Scope: validate `backend/internal/integrations/rtc/agora.go` (the AccessToken2 "007"
RTC token builder) before enabling live Agora. Constraint: the authoring sandbox has
**no Go toolchain and no network**, so the official `github.com/AgoraIO/Tools`
builder could not be fetched/run here. Validation was done against the **documented
AccessToken2 spec** the official builder implements, plus a runnable self-decoding test.

## Bug found and fixed (would have caused Agora to reject every token)

The signing key derivation in `agoraSign` was wrong on two counts:

| Step | Spec (AccessToken2 `getSign`) | Old code | Fixed |
|------|-------------------------------|----------|-------|
| 1 | `val = HMAC-SHA256(key=LE(issueTs), msg=appCert)` | `HMAC(key=appCert, msg=LE(issueTs))` — key/msg **swapped** | ✅ corrected |
| 2 | `signKey = HMAC-SHA256(key=LE(salt), msg=val)` | **missing** (salt step omitted) | ✅ added |
| 3 | `signature = HMAC-SHA256(key=signKey, msg=message)` | `HMAC(key=step1, msg=message)` | ✅ corrected |

The packing/field-order/little-endian widths/length-prefixes/zlib/base64/`007`
prefix were already correct and were left unchanged.

## What is now verified (runnable in CI)

`agora_test.go`:
- **TestAgoraTokenRoundTrip** — builds a token with fixed inputs, strips `007`,
  base64-decodes, zlib-inflates, and unpacks **every field** (signature, appID,
  issueTs, expire, salt, service count, RTC service type, 4 privileges, channel,
  uid), asserting each equals the input. It then **independently re-derives the
  signature from the spec formula** (a separate implementation, not a call to
  `agoraSign`) and asserts equality — so a regression in the production signing
  path fails the test.
- **TestAgoraTokenDeterministic** — identical inputs → identical token.
- **TestAgoraMissingCreds** — empty appID/cert → `ErrAgoraMissingCreds`, never a
  fabricated token (the disabled-fallback contract).

CI runs these via `doctor-ci.yml` (vet + test now include `./internal/integrations/...`).

## What still requires the official builder / live check (the last 5%)

The round-trip test proves the wire format is internally consistent and that the
signing matches the spec **as written**. It does NOT, by itself, certify
byte-for-byte equivalence with Agora's servers (both the builder and the test share
the same spec interpretation).

To CERTIFY before turning on live Agora, do ONE of:
1. **Known-answer vector (preferred, offline):** run the official
   `github.com/AgoraIO/Tools` RtcTokenBuilder2 with the EXACT fixed inputs in
   `agora_test.go` (testAppID/testAppCert/testChannel/testUID, issueTs=1700000000,
   expire=3600, salt=1, privileges = join + publish audio/video/data), paste its
   output into `TestAgoraKnownAnswer.wantToken`, and unskip — it asserts our builder
   is byte-identical to Agora's.
2. **Live join test:** issue a token via `POST /api/v1/doctor/calls/:appointmentId/token`
   with real `AGORA_APP_ID`/`AGORA_APP_CERTIFICATE` set and confirm a client can join
   the channel.

Until then, **VideoSDK (`videosdk.go`, standard HS256 JWT) is the high-confidence
provider** — set `VIDEOSDK_API_KEY`/`VIDEOSDK_SECRET` and select provider `videosdk`.

## Status

- Signing bug: FIXED (matches documented AccessToken2 getSign).
- Format + signing-spec: covered by runnable round-trip test in CI.
- Byte-for-byte certification: PENDING the known-answer vector or a live join (slot ready in `TestAgoraKnownAnswer`).
