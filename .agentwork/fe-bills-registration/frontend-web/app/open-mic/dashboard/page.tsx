import Link from 'next/link';
import { listContests, listSubmissions } from '@/src/server/openmic/persistence';

export const dynamic = 'force-dynamic';

export default async function OpenMicArtistDashboardPage() {
  const contests = await listContests();
  const submissions = await listSubmissions();

  return (
    <main className="container py-5">
      <h1>Artist Open Mic Dashboard</h1>
      <p>Track active monthly editions, beat access, song status, and voting progression.</p>

      <section className="my-4 p-4 border rounded bg-white">
        <h3>Active Monthly Contests</h3>
        <ul className="mb-0">
          {contests.map((contest) => (
            <li key={contest.id}>
              {contest.title} - {contest.status.replaceAll('_', ' ')} -{' '}
              <Link href={`/open-mic/${contest.slug}/enter`}>Enter / Submit</Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="my-4 p-4 border rounded bg-white">
        <h3>Recent Song Submissions</h3>
        <ul className="mb-0">
          {submissions.slice(0, 20).map((entry) => (
            <li key={entry.id}>
              {entry.songTitle} - {entry.stageName} - {entry.status.replaceAll('_', ' ')} - Votes: {entry.voteCount}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

