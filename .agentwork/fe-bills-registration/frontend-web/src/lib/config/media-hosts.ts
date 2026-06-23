export const allowedRemoteImageHostnames = [
  'images.unsplash.com',
  'images.pexels.com',
  'images.pixabay.com',
  'img.rocket.new',
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
