import OpenMicCompetitionView from '@/components/openmic/competition/OpenMicCompetitionView';
import { loadOpenMicEditionSteps } from '@/src/features/openmic/active-edition';
import './open-mic.css';

export const dynamic = 'force-dynamic';

/**
 * Server read, client shell: the five steps carry live edition state (beat,
 * windows, standings) that has to come from Supabase, while the page keeps the
 * hash-opened accordions, the lounge dialog and the carousel exactly as they
 * were. Metadata stays in layout.tsx.
 */
export default async function OpenMicCompetitionPage() {
  const data = await loadOpenMicEditionSteps();
  return <OpenMicCompetitionView data={data} />;
}
