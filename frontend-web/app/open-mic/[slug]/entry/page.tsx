import { redirect } from 'next/navigation';

export default function OpenMicEntryIndexPage({ params }: { params: { slug: string } }) {
  redirect(`/open-mic/${params.slug}/entries`);
}
