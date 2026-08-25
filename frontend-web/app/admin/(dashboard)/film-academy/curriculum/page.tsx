import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/src/lib/auth/server';
import CurriculumManager from '@/components/academy/admin/CurriculumManager';

export const dynamic = 'force-dynamic';

export default async function AcademyCurriculumPage() {
  try {
    await requireAdmin();
  } catch {
    redirect('/login?next=/admin/film-academy/curriculum');
  }

  return (
    <div className="max-w-6xl mx-auto px-4 pb-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl text-foreground">Curriculum</h1>
          <p className="text-foreground/50 mt-1">
            Modules, lessons and assignments. Learners see these in the app once published.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/film-academy/submissions" className="btn-outline py-2 px-4 text-sm">
            Submissions
          </Link>
          <Link href="/admin/film-academy" className="btn-outline py-2 px-4 text-sm">
            Back to Film Academy
          </Link>
        </div>
      </div>

      <CurriculumManager />
    </div>
  );
}
