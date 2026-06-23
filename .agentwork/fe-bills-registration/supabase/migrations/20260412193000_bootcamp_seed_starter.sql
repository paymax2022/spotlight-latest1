-- Seed starter records for Music Bootcamping public experience

DO $$
DECLARE
  v_edition_id UUID;
  v_mentor_id UUID;
BEGIN
  INSERT INTO public.bootcamp_editions (
    title,
    slug,
    summary,
    status,
    location_name,
    is_residential,
    start_at,
    end_at,
    application_deadline,
    seat_limit,
    seats_filled,
    is_published,
    hero_title,
    hero_subtitle,
    highlights,
    benefits,
    faq,
    includes_items,
    requirements,
    outcomes
  )
  VALUES (
    'Music Bootcamp April 2026',
    'music-bootcamp-apr-2026',
    'A 3-day residential artist development and production intensive at Timeless Studio for emerging artists ready to level up their sound.',
    'open_for_applications',
    'Timeless Studio',
    true,
    '2026-04-25T09:00:00Z',
    '2026-04-27T20:00:00Z',
    '2026-04-22T23:59:59Z',
    40,
    0,
    true,
    'Create. Record. Collaborate. Grow.',
    'From raw talent to ready record in 3 focused residential days.',
    '["Affordable premium recording access","Mentor-led production sessions","Industry-ready finishing workflow"]'::jsonb,
    '["Studio recording support","Mixing and mastering support","Artist collaboration opportunities","Mentor feedback sessions","Post-bootcamp visibility support"]'::jsonb,
    '[{"question":"Who should apply?","answer":"Emerging and growth-stage artists with commitment to improve their sound and process."},{"question":"Is this program residential?","answer":"Yes. Participants stay onsite for the full 3-day creative cycle."}]'::jsonb,
    '["Residential access","Recording and production sessions","Mentor feedback","Final playback review"]'::jsonb,
    '["Complete profile details","Submit at least one sample link","Accept terms and originality declaration"]'::jsonb,
    '["Near-complete or complete song output","Clear artist development feedback","Showcase and next-step opportunities"]'::jsonb
  )
  ON CONFLICT (slug) DO UPDATE
  SET
    summary = EXCLUDED.summary,
    status = EXCLUDED.status,
    location_name = EXCLUDED.location_name,
    is_residential = EXCLUDED.is_residential,
    start_at = EXCLUDED.start_at,
    end_at = EXCLUDED.end_at,
    application_deadline = EXCLUDED.application_deadline,
    seat_limit = EXCLUDED.seat_limit,
    is_published = EXCLUDED.is_published,
    hero_title = EXCLUDED.hero_title,
    hero_subtitle = EXCLUDED.hero_subtitle,
    highlights = EXCLUDED.highlights,
    benefits = EXCLUDED.benefits,
    faq = EXCLUDED.faq,
    includes_items = EXCLUDED.includes_items,
    requirements = EXCLUDED.requirements,
    outcomes = EXCLUDED.outcomes,
    updated_at = CURRENT_TIMESTAMP
  RETURNING id INTO v_edition_id;

  INSERT INTO public.bootcamp_packages (
    edition_id,
    name,
    slug,
    description,
    price_ngn,
    seat_limit,
    seats_taken,
    benefits,
    is_active,
    sort_order
  )
  VALUES
    (
      v_edition_id,
      'Standard Access',
      'standard-access',
      'Core residential access with production support and mentor sessions.',
      120000,
      30,
      0,
      '["Residential bootcamp access","Studio recording sessions","Mentor feedback"]'::jsonb,
      true,
      1
    ),
    (
      v_edition_id,
      'VIP Mentorship',
      'vip-mentorship',
      'Enhanced access with additional mentor review and post-camp strategy call.',
      220000,
      10,
      0,
      '["Everything in Standard","Priority mentor review","Post-bootcamp strategy session"]'::jsonb,
      true,
      2
    )
  ON CONFLICT (edition_id, slug) DO UPDATE
  SET
    description = EXCLUDED.description,
    price_ngn = EXCLUDED.price_ngn,
    seat_limit = EXCLUDED.seat_limit,
    benefits = EXCLUDED.benefits,
    is_active = EXCLUDED.is_active,
    sort_order = EXCLUDED.sort_order,
    updated_at = CURRENT_TIMESTAMP;

  INSERT INTO public.bootcamp_mentors (
    full_name,
    specialty,
    short_bio,
    avatar_url,
    credibility_text,
    role_title,
    social_links,
    is_active
  )
  VALUES (
    'DJ Harmony',
    'Music Producer',
    'Award-winning producer with experience developing breakout artists across Afrobeats and contemporary fusion.',
    '',
    '10+ years in commercial music production and artist development.',
    'Lead Producer Mentor',
    '{"instagram":"https://instagram.com/spotlight","youtube":"https://youtube.com"}'::jsonb,
    true
  )
  ON CONFLICT DO NOTHING;

  SELECT id
  INTO v_mentor_id
  FROM public.bootcamp_mentors
  WHERE full_name = 'DJ Harmony'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_mentor_id IS NOT NULL THEN
    INSERT INTO public.bootcamp_edition_mentors (edition_id, mentor_id, role_title, sort_order)
    VALUES (v_edition_id, v_mentor_id, 'Lead Producer Mentor', 1)
    ON CONFLICT (edition_id, mentor_id) DO UPDATE
    SET role_title = EXCLUDED.role_title,
        sort_order = EXCLUDED.sort_order;
  END IF;

  DELETE FROM public.bootcamp_schedule_items
  WHERE edition_id = v_edition_id;

  INSERT INTO public.bootcamp_schedule_items (
    edition_id,
    day_number,
    session_title,
    session_description,
    venue_label,
    mentor_id,
    sort_order
  )
  VALUES
    (
      v_edition_id,
      1,
      'Creative Discovery and Songwriting',
      'Arrival, orientation, profiling, songwriting labs, and early mentor alignment.',
      'Timeless Studio',
      v_mentor_id,
      1
    ),
    (
      v_edition_id,
      2,
      'Collaboration and Recording',
      'Pairing sessions, arrangement refinement, and guided recording blocks.',
      'Timeless Studio',
      v_mentor_id,
      1
    ),
    (
      v_edition_id,
      3,
      'Finishing and Commercial Positioning',
      'Final edits, mix/master review, playback, and release-readiness direction.',
      'Timeless Studio',
      v_mentor_id,
      1
    );

  INSERT INTO public.bootcamp_testimonials (
    edition_id,
    author_name,
    author_role,
    quote_text,
    avatar_url,
    rating,
    is_published
  )
  VALUES (
    v_edition_id,
    'Amina K.',
    'Participant',
    'This bootcamp helped me move from rough demo ideas to a song I am proud to pitch.',
    '',
    5,
    true
  )
  ON CONFLICT DO NOTHING;
END $$;
