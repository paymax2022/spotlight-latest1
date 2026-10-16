-- Restaurant storefront banner.
--
-- restaurants already has logo_url, and the backend accepts a logo on update, but no
-- screen could set one and there was no banner at all. banner_url holds the wide
-- storefront image, in the same two shapes logo_url holds:
--   * an http(s) link, or
--   * an object key minted by POST /restaurant/:id/images/presign
--     (restaurant/<id>/store/banner/<rand>.<ext>) that the backend signs into a
--     short-lived GET URL on read (the bucket is private).
--
-- Additive only: one nullable column, no default, no rewrite of existing rows.
-- Reads load it in a separate query and tolerate its absence, so the application can
-- be deployed before this migration without breaking any store read.

BEGIN;

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS banner_url text;

COMMENT ON COLUMN public.restaurants.banner_url IS
  'Storefront banner: an http(s) link or a store-image object key (restaurant/<id>/store/banner/...). Resolved to a signed URL on read.';

COMMIT;
