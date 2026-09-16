// Service-role Supabase client for server-side admin operations.
//
// The voting-bridge and v2 vote routes import `@/lib/supabase/admin`; the
// actual factory has always lived in `./server`. This module is the missing
// resolution target — a re-export, not a second client, so there is exactly
// one place that constructs the service-role client.
export { createAdminClient } from './server';
