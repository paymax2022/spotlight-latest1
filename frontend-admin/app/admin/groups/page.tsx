import { redirect } from 'next/navigation';

// /admin/groups had no page of its own, so it fell through to the catch-all
// app/admin/[...slug] "Module In Transition" bridge — which offered an
// "Open Legacy Module" link to ${NEXT_PUBLIC_LEGACY_ADMIN_BASE_URL}/admin/groups,
// i.e. http://localhost:4028. Nothing listens on 4028; the legacy admin is
// retired. The module IS migrated (dashboard + group list live below this
// path), so the section index should land on it instead of advertising a dead
// port. Other unmigrated routes still use the bridge — this only claims
// /admin/groups.
export default function GroupsIndexPage() {
  redirect('/admin/groups/dashboard');
}
