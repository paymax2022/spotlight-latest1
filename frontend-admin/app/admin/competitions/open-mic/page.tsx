/**
 * This page duplicated a real console: it wrote monthly "editions" into the
 * generic `contests` table via the Go backend (competitions.OpenMic /
 * CreateOpenMic → CompetitionSupabaseRepository, filtering contest_type =
 * one_beat_one_verse) — a different, disconnected data model from the actual
 * Open Mic pipeline (applications, submissions, judging, finale playlist,
 * payments, fraud alerts), which lives in frontend-web's Supabase-backed
 * openmic/persistence and is already served here as the Path A console at
 * /admin/open-mic (admin consolidation slice 4; see
 * docs/adr/ADR-047-admin-console-consolidation-path-a.md and
 * src/services/openMicAdminService.ts). Redirecting rather than deleting the
 * route so any stale bookmark/link still lands somewhere useful.
 */
import { redirect } from 'next/navigation';

export default function AdminOpenMicCompetitionsPage() {
  redirect('/admin/open-mic');
}
