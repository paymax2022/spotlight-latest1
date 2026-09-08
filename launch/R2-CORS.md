# R2 bucket CORS — required for browser uploads

## The symptom

Uploading an organisation logo fails in the browser with:

    PUT https://<account>.r2.cloudflarestorage.com/<bucket>/association/logo/… net::ERR_FAILED

`ERR_FAILED` with **no HTTP status** is the tell. The request never left the
browser: it was blocked at the CORS preflight, so there is no response to show a
status for. The presigned URL itself is fine.

## Why it is not visible from the terminal

`curl` does not send a preflight, so a `curl -X PUT` against the same URL
succeeds while the browser fails. Verifying an upload path with curl alone
cannot catch this — replay the preflight instead:

    curl -i -X OPTIONS "https://<account>.r2.cloudflarestorage.com/<bucket>/probe.png" \
      -H "Origin: http://localhost:8083" \
      -H "Access-Control-Request-Method: PUT" \
      -H "Access-Control-Request-Headers: content-type"

Before the policy is applied this returns `403` with **no**
`Access-Control-Allow-Origin` header. After, it returns `200` and echoes the
origin back.

## Applying it

Cloudflare dashboard → R2 → the bucket → **Settings** → **CORS Policy** → paste
`r2-cors.json`.

It cannot be applied with the R2 S3 access key used by the app: that key is
object-scoped and gets `AccessDenied` on `GetBucketCors`/`PutBucketCors`. It
needs the dashboard, or a Cloudflare API token with R2 edit permission.

## About the contents

- `AllowedHeaders: ["content-type"]` — the presigner binds Content-Type into the
  signature (`X-Amz-SignedHeaders=content-type;host`), so the browser sends it
  and the preflight asks for it. Omitting it breaks the preflight even with the
  origin allowed.
- `GET`/`HEAD` are included because the app also fetches stored objects with
  signed URLs; those are cross-origin browser reads and need CORS too.
- Origins are listed explicitly rather than `*`. Presigned URLs carry their own
  authorisation, so `*` would technically work — but this bucket holds user
  uploads, and an explicit list means a stray origin cannot read them.
- **Add your staging and production web origins before deploying.** They are not
  in this file because they are not configured anywhere in the repo yet.
