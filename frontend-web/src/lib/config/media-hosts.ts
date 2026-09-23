export const allowedRemoteImageHostnames = [
  'images.unsplash.com',
  'images.pexels.com',
  'images.pixabay.com',
  'img.rocket.new',
  // Cloudinary delivery host for moderated/background-removed contestant
  // photo cutouts (G-IMG pipeline, see src/lib/media/cloudinary.ts). Without
  // this, imageCompositor's fetchImageBuffer refuses to fetch Cloudinary URLs.
  'res.cloudinary.com',
] as const;

export function isAllowedRemoteImageUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      allowedRemoteImageHostnames.includes(
        parsed.hostname as (typeof allowedRemoteImageHostnames)[number]
      )
    );
  } catch {
    return false;
  }
}
