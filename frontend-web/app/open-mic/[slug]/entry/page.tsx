import { redirect } from 'next/navigation';

export default async function OpenMicEntryIndexPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/open-mic/${slug}/entries`);
}
