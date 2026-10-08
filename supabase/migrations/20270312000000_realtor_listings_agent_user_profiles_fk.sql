-- Fix realtor listing search's broken agent embed.
--
-- WHY
-- mobile-app/reactnative/src/features/realtor/api/realtor.mapper.ts's
-- LISTING_SELECT embeds the listing agent as
-- `agent:user_profiles!agent_id(id, full_name, avatar_url, phone)` — a
-- PostgREST relationship hint. realtor_listings.agent_id only has an FK to
-- auth.users(id) (see 20260620000000_realtor_property_graph.sql), never to
-- public.user_profiles, so PostgREST's schema cache has no relationship to
-- resolve and every real (non-mock) call to searchListings()/getListing()
-- throws PGRST200 ("Could not find a relationship between 'realtor_listings'
-- and 'user_profiles'"), surfacing to the user as "Search failed. Please try
-- again." This was always broken; REALTOR_USE_MOCK defaulting true (and
-- realtor_listings being empty until now) just meant nothing had exercised
-- the real path until Property Management fixture data was seeded.
--
-- FIX: add a second FK, from realtor_listings.agent_id to
-- public.user_profiles(id). This is safe to add — user_profiles.id always
-- mirrors auth.users.id 1:1 (via the on_auth_user_created trigger, see
-- 20260401004207_create_user_profiles.sql), and a column may carry more than
-- one FK. Verified zero existing realtor_listings rows have an agent_id with
-- no matching user_profiles row before authoring this.
--
-- Additive only: ADD CONSTRAINT, no DROP/RENAME/type narrowing. The existing
-- FK to auth.users(id) is left untouched.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'realtor_listings_agent_id_user_profiles_fkey'
  ) THEN
    ALTER TABLE public.realtor_listings
      ADD CONSTRAINT realtor_listings_agent_id_user_profiles_fkey
      FOREIGN KEY (agent_id) REFERENCES public.user_profiles(id);
  END IF;
END $$;
