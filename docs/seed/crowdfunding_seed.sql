-- Crowdfunding demo seed (optional). Requires at least one auth.users row.
-- Picks the first user as the demo creator. Safe to run repeatedly (idempotent-ish via WHERE NOT EXISTS).
-- All money in kobo.

DO $$
DECLARE creator UUID;
BEGIN
  SELECT id INTO creator FROM auth.users ORDER BY created_at ASC LIMIT 1;
  IF creator IS NULL THEN
    RAISE NOTICE 'No auth.users found — create a user first.';
    RETURN;
  END IF;

  -- Active, featured medical campaign
  INSERT INTO campaigns (creator_id, title, summary, story, type, category, goal_kobo, currency,
                         location, refund_policy, disbursement_model, cover_url, status, review_status,
                         deadline, verified, featured, trending, urgent, contributor_count, submitted_at)
  SELECT creator,
         'Help Baby Zara Get Open-Heart Surgery',
         'Zara was born with a congenital heart defect needing surgery within 8 weeks.',
         'Zara is 14 months old and full of life...',
         'DONATION', 'medical', 1850000000, 'NGN',
         'Lagos, Nigeria', 'Refundable before any milestone is released.', 'MILESTONE',
         'https://images.unsplash.com/photo-1576765608535-5f04d1e3f289?w=800&q=80',
         'active', 'ACTIVE', NOW() + INTERVAL '50 days', TRUE, TRUE, TRUE, TRUE, 0, NOW()
  WHERE NOT EXISTS (SELECT 1 FROM campaigns WHERE title = 'Help Baby Zara Get Open-Heart Surgery');

  -- Pending-review education campaign (shows in the admin queue)
  INSERT INTO campaigns (creator_id, title, summary, story, type, category, goal_kobo, currency,
                         location, refund_policy, disbursement_model, status, review_status,
                         deadline, submitted_at, risk_level, risk_score)
  SELECT creator,
         'Annual Coding Bootcamp Scholarships',
         '20 scholarships for young developers in Enugu.',
         'We run a free coding bootcamp each year...',
         'COMMUNITY', 'education', 150000000, 'NGN',
         'Enugu, Nigeria', 'Refundable before disbursement.', 'FLEXIBLE',
         'draft', 'PENDING_REVIEW', NOW() + INTERVAL '60 days', NOW(), 'LOW', 24
  WHERE NOT EXISTS (SELECT 1 FROM campaigns WHERE title = 'Annual Coding Bootcamp Scholarships');
END $$;
