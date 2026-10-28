-- Units per room type: how many rooms of this type can be sold for a night that has no
-- availability row of its own. Additive only; existing room types get one unit, which is
-- what they already sold.

ALTER TABLE public.stays_room_type
  ADD COLUMN IF NOT EXISTS units integer NOT NULL DEFAULT 1
    CHECK (units >= 1);

COMMENT ON COLUMN public.stays_room_type.units IS
  'Rooms of this type open for sale each night (the allotment of a night with no availability row).';
