// Server layout for the public voting page — the primary share surface.
// The page itself is a client component ('use client') and cannot export
// metadata, so generateMetadata lives here; a layout's metadata applies to
// the child page beneath it.
//
// Fail-closed: any fetch/lookup failure returns generic Spotlight OG tags
// instead of breaking the page render.

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { createAdminClient } from '@/lib/supabase/server';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.spotlightng.com';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_OG_IMAGE = '/assets/img/shape/banner-home.png';

function absoluteUrl(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl) return null;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${SITE_URL}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

function fallbackMetadata(pageUrl: string): Metadata {
  const title = 'Vote on Spotlight';
  const description =
    'Vote for your favourite contestants on Spotlight — live voting, leaderboards, and talent discovery.';
  const image = absoluteUrl(DEFAULT_OG_IMAGE) as string;
  return {
    title,
    description,
    alternates: { canonical: pageUrl },
    openGraph: {
      title,
      description,
      url: pageUrl,
      siteName: 'Spotlight',
      type: 'website',
      images: [{ url: image }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ contestSlug: string; contestantSlug: string }>;
}): Promise<Metadata> {
  const { contestSlug, contestantSlug } = await params;
  const pageUrl = `${SITE_URL}/vote/${contestSlug}/${contestantSlug}`;

  try {
    const supabase = createAdminClient();

    // Same two-step resolution as /api/vote-page: contest by slug, then
    // contestant by voting_link_slug (or UUID fallback for share links that
    // carry the raw contestant id).
    const { data: contest } = await supabase
      .from('contests')
      .select('id, name, banner_image_url')
      .eq('slug', contestSlug)
      .maybeSingle();
    if (!contest) return fallbackMetadata(pageUrl);

    const CONTESTANT_COLS = 'id, name, stage_name, bio, photo_url';
    let contestant: any = null;

    const { data: bySlug } = await supabase
      .from('contestants')
      .select(CONTESTANT_COLS)
      .eq('contest_id', (contest as any).id)
      .eq('voting_link_slug', contestantSlug)
      .maybeSingle();

    if (bySlug) {
      contestant = bySlug;
    } else if (UUID_RE.test(contestantSlug)) {
      const { data: byId } = await supabase
        .from('contestants')
        .select(CONTESTANT_COLS)
        .eq('id', contestantSlug)
        .eq('contest_id', (contest as any).id)
        .maybeSingle();
      contestant = byId;
    }

    if (!contestant) return fallbackMetadata(pageUrl);

    const name = contestant.name ?? contestant.stage_name ?? 'Contestant';
    const contestName = (contest as any).name as string;
    const title = `Vote for ${name} — ${contestName} | Spotlight`;
    const bio = typeof contestant.bio === 'string' ? contestant.bio.trim() : '';
    const description = bio
      ? bio.length > 157
        ? `${bio.slice(0, 157)}…`
        : bio
      : `Vote for ${name} in ${contestName} on Spotlight. Every vote counts — support your favourite talent now.`;
    const image = absoluteUrl(contestant.photo_url ?? (contest as any).banner_image_url ?? DEFAULT_OG_IMAGE);

    return {
      title,
      description,
      alternates: { canonical: pageUrl },
      openGraph: {
        title,
        description,
        url: pageUrl,
        siteName: 'Spotlight',
        type: 'website',
        ...(image ? { images: [{ url: image }] } : {}),
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        ...(image ? { images: [image] } : {}),
      },
    };
  } catch {
    return fallbackMetadata(pageUrl);
  }
}

export default function VoteContestantLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
