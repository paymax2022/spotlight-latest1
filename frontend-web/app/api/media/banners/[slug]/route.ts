// ── Marketing banner media resolver ───────────────────────────────────────────
// GET /api/media/banners/:slug → a short-lived presigned R2 URL for one
// whitelisted marketing banner, plus the intrinsic dimensions the client needs to
// reserve layout space before the image loads.
//
// Why a resolver and not a public bucket URL: `spotlight-openmic-songs` is the
// ONLY R2 bucket in the account, and it also holds estate documents, insurance
// documents and marketplace photos. Turning on an r2.dev public domain would
// expose every one of those to anyone who can guess a key, so the bucket stays
// private and reads go through a presigned GET — the same pattern every other R2
// read in this repo uses (estate/association download-url, marketplace thumbs).
//
// The slug registry is a closed whitelist: a caller can never steer this at an
// arbitrary object key, which is what makes the route safe to leave
// unauthenticated. Banners are public marketing art, not user data.

import { NextRequest, NextResponse } from 'next/server';
import { createR2DownloadUrl, hasR2Config } from '@/lib/storage/r2';

export const dynamic = 'force-dynamic';

// Presign TTL. Kept comfortably longer than the client's cache window so an
// in-flight render never holds a URL that expires mid-load.
const BANNER_URL_TTL_SECONDS = 60 * 60;

type Banner = {
  key: string;
  width: number;
  height: number;
  /** Alt text — screen readers get the banner's message, not "image". */
  alt: string;
};

// Object keys are versioned (`-v1`) because they are uploaded with
// `Cache-Control: immutable`: replacing the artwork means a new `-v2` key here,
// never an overwrite of a key already cached on devices and at the edge.
const BANNERS: Record<string, Banner> = {
  'health-vet': {
    key: 'marketing/banners/health-vet-hero-v1.jpg',
    width: 1536,
    height: 576,
    alt: 'Spotlight Veterinary Services — happy pets, healthier lives. Expert care for your pets, anytime, anywhere.',
  },
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const banner = BANNERS[slug];
  if (!banner) {
    return NextResponse.json({ error: 'Unknown banner' }, { status: 404 });
  }

  // Fail closed rather than fabricating a URL: an unconfigured environment
  // should render the page without its banner, not with a broken image.
  if (!hasR2Config()) {
    return NextResponse.json({ error: 'Media storage is not configured' }, { status: 503 });
  }

  try {
    const url = await createR2DownloadUrl({
      key: banner.key,
      fileName: banner.key.split('/').pop(),
      disposition: 'inline',
      expiresIn: BANNER_URL_TTL_SECONDS,
    });

    return NextResponse.json({
      slug,
      url,
      width: banner.width,
      height: banner.height,
      aspectRatio: banner.width / banner.height,
      alt: banner.alt,
      expiresAt: new Date(Date.now() + BANNER_URL_TTL_SECONDS * 1000).toISOString(),
    });
  } catch (err) {
    console.error('[media.banners] presign failed', { slug, err });
    return NextResponse.json({ error: 'Could not resolve banner' }, { status: 502 });
  }
}
