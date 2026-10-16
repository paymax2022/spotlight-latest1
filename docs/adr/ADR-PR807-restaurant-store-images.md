# ADR-PR807: Restaurant store logo and banner uploads

- Status: accepted
- Date: 2026-10-16

## Context
A restaurant owner could not set a store logo or banner. `restaurants.logo_url` existed and
the update endpoint accepted it, but no screen set it, there was no banner column, and the
object bucket is private with no public domain. The same constraint already shaped KYB
documents (`restaurant_kyb_documents.file_url`) and association logos.

## Decision
Follow the KYB pattern rather than add a public domain:
- The owner asks `POST /restaurant/:id/images/presign` for an upload URL. The server picks
  the object key (`restaurant/<id>/store/<kind>/<rand><ext>`) and binds the Content-Type into
  the signature. Only PNG, JPG and WEBP are allowed; SVG is not, because it can carry script
  and these images are rendered to customers.
- The client PUTs the file straight to storage and saves the returned KEY as `logo_url` or
  `banner_url` (new nullable column) through the normal store update.
- The update accepts only an http(s) link or a key under THIS restaurant and THAT kind, so an
  outlet cannot point at another's object, a banner cannot be saved as a logo, and a device
  `file://` URI (visible only on the owner's phone) cannot be stored.
- Every read that returns a store turns a stored key into a 60-minute signed GET URL. Only keys
  this feature mints (`restaurant/.../store/...`) are signed; any other existing value passes
  through unchanged, so no current image stops rendering. A key that cannot be signed is
  omitted rather than returned, so an internal storage path never reaches a client.

## Why not a public bucket domain
It would make stored values plain URLs and remove the signing step, but it needs a public-bucket
setup on Cloudflare (an owner decision), and every uploaded image becomes world-readable. The
signed-URL route needs no new infrastructure and matches how KYB documents and association logos
already work.

## Consequences
- A signed URL lasts about an hour. A screen or cached list kept longer shows the placeholder
  until reloaded. If that proves a problem, the fix is a public domain, which changes only the
  resolver in `store_images.go`.
- `banner_url` is loaded in one extra batched query instead of editing the six store SELECT
  lists, and a failure there is logged and ignored, so the application can deploy before the
  migration without breaking any store read.
- `CreateRestaurant` still accepts any `logo_url` string. A key cannot exist before the
  restaurant does, so this is left for a follow-up that restricts creation to links.
- Uploads cannot bind a size into the presigned PUT; the client checks size as a courtesy and
  the real limits are the storage provider's.
