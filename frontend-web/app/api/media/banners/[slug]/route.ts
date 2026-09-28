// ── Marketing banner media resolver ───────────────────────────────────────────
// GET /api/media/banners/:slug → a descriptor for one whitelisted marketing
// banner, plus the intrinsic dimensions the client needs to reserve layout
// space before the image loads.
//
// Two backing stores, both closed whitelists keyed by slug — a caller can
// never steer this at an arbitrary object/public ID, which is what makes the
// route safe to leave unauthenticated (banners are public marketing art, not
// user data):
//
//  • Cloudinary (`cloudinaryPublicId`, preferred going forward) — the client
//    (src/lib/cloudinary.ts) builds the actual delivery URL itself, picking
//    the width bucket ITS viewport needs (f_auto,q_auto,w_<bucket>). Nothing
//    to presign: Cloudinary delivery URLs are public and long-cached by
//    design, so this route just returns the public ID and dimensions.
//  • Cloudflare R2 (`key`, legacy) — `spotlight-openmic-songs` is the ONLY R2
//    bucket in the account and also holds estate/insurance/marketplace
//    files, so a public r2.dev domain isn't an option; this path still mints
//    a short-lived presigned GET, same pattern every other R2 read in this
//    repo uses.
//
// Either way: replacing artwork means a NEW public ID / object key here,
// never overwriting one already cached on devices and at the edge.

import { NextRequest, NextResponse } from 'next/server';
import { createR2DownloadUrl, hasR2Config } from '@/lib/storage/r2';

export const dynamic = 'force-dynamic';

// Presign TTL for the R2 path. Kept comfortably longer than the client's
// cache window so an in-flight render never holds a URL that expires mid-load.
const BANNER_URL_TTL_SECONDS = 60 * 60;

type Dimensions = { width: number; height: number; alt: string };

type CloudinaryBanner = Dimensions & { cloudinaryPublicId: string };
type R2Banner = Dimensions & { key: string };
type Banner = CloudinaryBanner | R2Banner;

function isR2Banner(b: Banner): b is R2Banner {
  return 'key' in b;
}

// Uploaded out-of-band (no in-app upload flow yet) and registered here by
// hand — same precedent the R2 entries below already set.
const BANNERS: Record<string, Banner> = {
  'health-vet': {
    key: 'marketing/banners/health-vet-hero-v1.jpg',
    width: 1536,
    height: 576,
    alt: 'Spotlight Veterinary Services — happy pets, healthier lives. Expert care for your pets, anytime, anywhere.',
  },
  // Cloudinary banners — uploaded to the SPOTLIGHT/Banners/ folder 2026-09-25,
  // all natively 2048x768 (8:3, matching the fallback aspect ratio RemoteBanner
  // already used before any of these existed).
  'home-hero': {
    cloudinaryPublicId: 'SPOTLIGHT/Banners/ChatGPT_Image_Sep_25_2026_09_27_19_AM_ywlasa',
    width: 2048, height: 768,
    alt: 'Spotlight — one app for money, contests, community and more.',
  },
  'property-management': {
    cloudinaryPublicId: 'SPOTLIGHT/Banners/banner-property-mgt_iosk9y',
    width: 2048, height: 768,
    alt: 'Property Management — list, manage and grow your rental portfolio.',
  },
  'crypto-trading': {
    cloudinaryPublicId: 'SPOTLIGHT/Banners/banner-crypto_r5jzau',
    width: 2048, height: 768,
    alt: 'Crypto Trading — buy, sell and track digital assets.',
  },
  'refer-earn': {
    cloudinaryPublicId: 'SPOTLIGHT/Banners/banner-referral_pon9f7',
    width: 2048, height: 768,
    alt: 'Refer & Earn — invite friends and earn rewards.',
  },
  restaurant: {
    cloudinaryPublicId: 'SPOTLIGHT/Banners/Banner-restaurant_ux7yx0',
    width: 2048, height: 768,
    alt: 'Restaurant — order food from your favourite spots.',
  },
  association: {
    cloudinaryPublicId: 'SPOTLIGHT/Banners/banner-association_survj3',
    width: 2048, height: 768,
    alt: 'Association — manage dues, meetings and members in one place.',
  },
  'film-academy': {
    cloudinaryPublicId: 'SPOTLIGHT/Banners/banner-film-academy_ckx3hl',
    width: 2048, height: 768,
    alt: 'Spotlight Film Academy — learn from industry professionals.',
  },
  'utility-bills': {
    cloudinaryPublicId: 'SPOTLIGHT/Banners/Banner-utility-bills_ivqjcv',
    width: 2048, height: 768,
    alt: 'Utility Bills — pay electricity, airtime, data and more, instantly.',
  },
  ride: {
    cloudinaryPublicId: 'SPOTLIGHT/Banners/banner-ride_w49acw',
    width: 2048, height: 768,
    alt: 'Ride — book a trip anywhere, anytime.',
  },
  insurance: {
    cloudinaryPublicId: 'SPOTLIGHT/Banners/banner-insirance_rzqljt',
    width: 2048, height: 768,
    alt: 'Insurance — protect what matters, at the right price.',
  },
  connect: {
    cloudinaryPublicId: 'SPOTLIGHT/Banners/banner-connect_epyebw',
    width: 2048, height: 768,
    alt: 'Connect — meet, chat and go live with your community.',
  },
  crowdfunding: {
    cloudinaryPublicId: 'SPOTLIGHT/Banners/banner-crowdfunding_n6mcap',
    width: 2048, height: 768,
    alt: 'Crowdfunding — back a cause or raise funds for your own.',
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

  const aspectRatio = banner.width / banner.height;

  if (!isR2Banner(banner)) {
    // Cloudinary path: no presign, no expiry — the client builds its own
    // responsive delivery URL from the public ID.
    return NextResponse.json({
      slug,
      cloudinaryPublicId: banner.cloudinaryPublicId,
      width: banner.width,
      height: banner.height,
      aspectRatio,
      alt: banner.alt,
    });
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
      aspectRatio,
      alt: banner.alt,
      expiresAt: new Date(Date.now() + BANNER_URL_TTL_SECONDS * 1000).toISOString(),
    });
  } catch (err) {
    console.error('[media.banners] presign failed', { slug, err });
    return NextResponse.json({ error: 'Could not resolve banner' }, { status: 502 });
  }
}
