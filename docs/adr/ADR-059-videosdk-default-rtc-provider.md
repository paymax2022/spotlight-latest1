# ADR-059: Default RTC provider is VideoSDK, not Agora

## Status
Accepted

## Context
`backend/internal/integrations/rtc` already implements a provider-agnostic
`Issuer` with two token builders: `BuildAgoraRTCToken` (Agora AccessToken2,
hand-rolled stdlib implementation) and `BuildVideoSDKToken` (VideoSDK.live
HS256 JWT). Both are wired end-to-end, and the mobile doctor-consult UI
already has an Agora-unavailable fallback path (`switchProvider` to
`'videosdk'`) — provider is a plain string the client never hardcodes.

Three call sites hardcoded `rtc.ProviderAgora` as the *default* provider used
when a caller doesn't specify one:
- `doctor.Service.StartCallSession` / `IssueCallToken`
  (`backend/internal/doctor/service_ops.go`)
- `doctor.Service.SwitchCallProvider`'s own default
  (`backend/internal/doctor/service_clinical_tail.go`)
- Academy live-class token issuance (`backend/internal/app/academy_rails.go`),
  gated by `Issuer.Enabled(rtc.ProviderAgora)` in `academy_routes.go`

## Decision
Flip the hardcoded default from `rtc.ProviderAgora` to `rtc.ProviderVideoSDK`
in all four locations. Agora support is **not removed** — `agora.go` and its
test suite (`agora_test.go`, including the AccessToken2 known-answer
certification) stay in place as the fallback provider the mobile app can
still request explicitly via `switchProvider`.

No new feature flag: this changes which existing, already-configured
provider is picked when the caller omits one — it does not introduce new
capability or a new module.

## Consequences
- Any caller that omits `provider` (both doctor call sessions and academy
  live classes) now gets a VideoSDK token instead of an Agora token,
  provided `VIDEOSDK_API_KEY`/`VIDEOSDK_SECRET` are configured — same
  fail-closed `ErrRTCNotConfigured` behavior as before if they aren't.
- The academy live-class rail is now registered when VideoSDK credentials
  are present (`Issuer.Enabled(rtc.ProviderVideoSDK)`), not Agora
  credentials — an environment with only `AGORA_*` set and no
  `VIDEOSDK_*` would now leave academy live classes unregistered where they
  previously worked. Deployments must ensure `VIDEOSDK_API_KEY`/
  `VIDEOSDK_SECRET` are set wherever `AGORA_APP_ID`/`AGORA_APP_CERTIFICATE`
  were relied on before.
- Explicit `provider: 'agora'` requests (e.g. the mobile fallback flow
  switching back) are unaffected — Agora remains a fully supported,
  independently tested provider.

## Alternatives considered
- **Remove Agora entirely**: rejected — the mobile app's Agora-unavailable
  fallback UX depends on Agora still being a working, callable provider, and
  removing it is a larger change (mobile UI, API contract enum, config)
  outside this task's scope.
- **Add a config-driven default-provider setting** instead of hardcoding
  VideoSDK: rejected as unnecessary complexity — no existing per-env
  variance requirement, and the two hardcoded-default call sites are already
  trivial to change again if that changes.
