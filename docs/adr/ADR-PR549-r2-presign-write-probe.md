# ADR-PR549 — R2 presign: verify the bucket can be written before issuing upload URLs

**Date:** 2026-10-08
**Status:** Accepted
**Scope:** `backend/internal/platform/r2/{presign.go,probe.go,probe_test.go}`,
`backend/internal/association/{presign.go,presign_test.go}`, `backend/internal/app/finance_routes.go`.

## Context

Creating an organisation failed with "That image couldn't be uploaded. Try again…". Staging logs showed the
presign endpoint returning 200 (after the `R2_*` variables were added) while the Android client's PUT to R2
failed. `Presigner.Configured()` only checks that the variables are non-empty, so a wrong `R2_BUCKET`, a
read-only API token, a mangled endpoint or a bad secret all produce a perfectly valid-looking signed URL. The app
can only map the later PUT failure to a generic retry, which can never succeed. `config.go` already documents this
trap for the old default bucket name.

## Decision

1. **Probe by doing the real thing.** `Presigner.Probe` PUTs a two-byte object (`_healthcheck/probe.txt`) through a
   presigned URL — the same signing path, content-type binding and endpoint a client uses — and classifies R2's
   error code (`NoSuchBucket`, `SignatureDoesNotMatch`/`InvalidAccessKeyId`, `AccessDenied`, unreachable, other).
   A GET or HEAD probe was rejected: it passes for a read-only token, which is one of the failures to catch.
2. **Cache it.** `Healthy` probes at most once per 10 min while healthy and once per 30 s while failing, so a burst of
   requests costs one write and a corrected variable is picked up quickly without a redeploy.
3. **Opt-in.** `EnableHealthCheck` must be called; `Healthy` is otherwise a no-op, so other modules and every
   existing test keep their behaviour. Only the association logo endpoint opts in for now.
4. **Fail closed with the response the app already understands.** On failure the endpoint returns 503
   "logo uploads are not configured" (the shipped app maps 503 to "paste a logo URL instead"), so no app release is
   needed. The precise cause is logged, never returned (bucket names and R2 error codes stay server-side).
5. **Normalise pasted config in `r2.New`** (whitespace, a bucket path or trailing slash on the endpoint, slashes on
   the bucket) — values that pass `Configured()` yet break the signature.

## Consequences

- One tiny, idempotent object lives in the bucket at `_healthcheck/probe.txt`.
- A misconfigured R2 now produces a clear log line and the correct in-app fallback instead of a retry loop; fixing the
  variable restores uploads within the failure TTL.
- Other R2 consumers (estate, insurance, transport, doctor, stays, property roles) share the failure mode and can
  adopt `EnableHealthCheck` one line at a time; not done here to keep this change reviewable.
- The probe adds one outbound request per 10 min per process, and the first presign after a restart waits for it
  (≤5 s timeout).
