# Manual Supabase Table Setup

**Issue:** The `supabase db push` command is blocked by errors in existing migrations.

**Solution:** Create the registrations table manually via Supabase Dashboard.

## Steps

### 1. Open Supabase Dashboard
```
https://app.supabase.com
```

### 2. Select the "spotlight" Project
- Click on the project in the projects list
- Or navigate to: https://app.supabase.com/project/ptczqwfokydsdafpscex

### 3. Go to SQL Editor
- In the left sidebar, click **SQL Editor**
- Click **New Query**

### 4. Copy & Paste the Migration SQL

Copy the entire content below and paste into the SQL Editor:

```sql
-- Create registrations table for contest registration system
CREATE TABLE IF NOT EXISTS public.registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  contest_slug TEXT NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft', 'submitted', 'awaiting_payment', 'under_review',
      'more_information_requested', 'shortlisted', 'callback_invited',
      'approved', 'rejected', 'waitlisted', 'disqualified',
      'audition_scheduled', 'selected_for_bootcamp',
      'selected_for_public_voting', 'eliminated', 'winner', 'withdrawn'
    )),
  form_data JSONB DEFAULT '{}',
  current_step TEXT DEFAULT 'contest_selection',
  completion_percent INTEGER DEFAULT 0 CHECK (completion_percent >= 0 AND completion_percent <= 100),
  role TEXT NOT NULL DEFAULT 'public_user' CHECK (role IN ('public_user', 'invited_applicant', 'staff')),
  fraud_flags JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  withdrawn_at TIMESTAMPTZ,
  CONSTRAINT reference_format CHECK (reference ~ '^[A-Z0-9]+-[0-9]+-[A-Z0-9]+$')
);

-- Create status_events table for audit trail
CREATE TABLE IF NOT EXISTS public.registration_status_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  note TEXT,
  actor_role TEXT NOT NULL DEFAULT 'public_user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_registrations_user_id ON public.registrations(user_id);
CREATE INDEX idx_registrations_contest_slug ON public.registrations(contest_slug);
CREATE INDEX idx_registrations_status ON public.registrations(status);
CREATE INDEX idx_registrations_created_at ON public.registrations(created_at DESC);
CREATE INDEX idx_registrations_reference ON public.registrations(reference);
CREATE INDEX idx_status_events_registration_id ON public.registration_status_events(registration_id);
CREATE INDEX idx_status_events_created_at ON public.registration_status_events(created_at DESC);

-- Enable RLS
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_status_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own registrations"
  ON public.registrations FOR SELECT
  USING (auth.uid() = user_id OR current_user_id IS NULL);

CREATE POLICY "Users can create registrations"
  ON public.registrations FOR INSERT
  WITH CHECK (auth.uid() = user_id OR current_user_id IS NULL);

CREATE POLICY "Users can update their own registrations"
  ON public.registrations FOR UPDATE
  USING (auth.uid() = user_id OR current_user_id IS NULL)
  WITH CHECK (auth.uid() = user_id OR current_user_id IS NULL);

CREATE POLICY "Users can view status events for their registrations"
  ON public.registration_status_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.registrations
      WHERE registrations.id = registration_status_events.registration_id
      AND (registrations.user_id = auth.uid() OR current_user_id IS NULL)
    )
  );

-- Comments
COMMENT ON TABLE public.registrations IS 'Contest registration drafts and submissions.';
COMMENT ON TABLE public.registration_status_events IS 'Audit trail of registration status changes.';
COMMENT ON COLUMN public.registrations.form_data IS 'JSON blob storing form answers keyed by field.key.';
COMMENT ON COLUMN public.registrations.fraud_flags IS 'Array of fraud check results.';
```

### 5. Execute the Query
- Click the **Run** button (or press `Ctrl+Enter`)
- Wait for the query to complete

### 6. Verify Success
You should see:
- ✅ "Query executed successfully"
- Two tables created: `registrations` and `registration_status_events`
- Seven indexes created
- Four RLS policies created

## Next Steps

Once the table is created:

1. **Reload Admin Dashboard**
   ```
   http://localhost:3001/admin/competitions/participants
   ```
   - Should now show "Loading participants..." then list any existing registrations
   - Or show "No participants yet" if this is the first run

2. **Test End-to-End**
   ```
   1. Mobile app: http://localhost:8083
   2. Sign up / Log in
   3. Navigate to registration
   4. Submit form
   5. Check admin dashboard - should appear!
   ```

## Troubleshooting

**Table Already Exists?**
```sql
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'registrations'
);
```
- If result is `true`, the table already exists ✅
- If result is `false`, run the create statement again

**RLS Policies Error?**
If you get "Policy already exists", comment out those lines and re-run:
```sql
-- CREATE POLICY "Users can view their own registrations" ...
-- (the other policy creation lines)
```

**Permission Error?**
You need to be logged in as the Supabase project owner. If getting permission errors:
1. Make sure you're logged into supabase.com
2. Click your avatar → Account
3. Verify you're in the correct project

## Success Indicators

Once created, the admin dashboard will:
- ✅ Load without errors
- ✅ Show "Loading participants..." then data
- ✅ Display search and filter options
- ✅ Show real registrations (once users register)

## Need Help?

If the manual SQL fails:
1. Check Supabase status: https://status.supabase.com
2. Try a simpler test:
   ```sql
   CREATE TABLE test_table (id UUID PRIMARY KEY);
   ```
3. If that works, the issue is with specific SQL syntax
4. Copy the error message and check the migration file for syntax issues
