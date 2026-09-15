import { NextResponse } from 'next/server';
import { assertR2ObjectExists, createR2DownloadUrl, hasR2Config } from '@/src/lib/storage/r2';

/**
 * Serve a health-module promo banner (pharmacy, doctor, lab, vet, ...).
 *
 * PUBLIC by design — these are marketing images shown to every user on the
 * health home screens, not gated content. Only `health/banners/` keys are
 * served, matched against a fixed filename shape, so this route can never be
 * turned into a reader for anything else in the shared media bucket.
 *
 * Assets are uploaded out-of-band (there is no admin upload form for these
 * yet, unlike contest banners) — this route only serves what already exists
 * at `health/banners/<filename>` in R2.
 */
const FILENAME_RE = /^[a-z0-9-]+\.(png|jpg|jpeg|webp)$/;

export async function GET(_request: Request, ctx: { params: Promise<{ filename: string }> }) {
  const { filename } = await ctx.params;
  if (!FILENAME_RE.test(filename)) return new NextResponse('Not found', { status: 404 });
  const objectKey = `health/banners/${filename}`;

  if (!hasR2Config()) return new NextResponse('Not found', { status: 404 });

  try {
    await assertR2ObjectExists(objectKey);
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }

  const signedUrl = await createR2DownloadUrl({ key: objectKey, fileName: filename, disposition: 'inline' });
  return NextResponse.redirect(signedUrl, { status: 302 });
}
