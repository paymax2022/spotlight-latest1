/**
 * Image optimization utilities for mobile networks
 * Handles responsive images, WebP support, lazy loading, and compression
 */

/**
 * Image configuration for different screen sizes
 * Breakpoints align with Tailwind: 640px, 768px, 1024px, 1280px
 */
export const IMAGE_BREAKPOINTS = {
  mobile: 640,
  tablet: 768,
  desktop: 1024,
  wide: 1280,
};

export const IMAGE_SIZES = '(max-width: 640px) 100vw, (max-width: 1024px) 90vw, 1024px';

/**
 * Generate responsive image srcset for lazy loading
 *
 * @param basePath - Path to image without extension (e.g., '/exams/practice')
 * @param widths - Array of widths to generate (default: [320, 640, 768, 1024, 1280])
 * @returns srcSet string for <img> tag
 *
 * @example
 * const srcSet = generateResponsiveSrcSet('/exams/practice');
 * // Returns: /exams/practice-320w.jpg 320w, /exams/practice-640w.jpg 640w, ...
 */
export function generateResponsiveSrcSet(basePath: string, widths?: number[]): string {
  const defaultWidths = widths || [320, 640, 768, 1024, 1280];
  return defaultWidths
    .map((width) => `${basePath}-${width}w.jpg ${width}w`)
    .join(', ');
}

/**
 * Generate WebP and JPEG fallback srcset
 * Modern browsers use WebP (smaller), older browsers fall back to JPEG
 *
 * @param basePath - Path to image without extension
 * @returns srcSet string with WebP format
 *
 * @example
 * const srcSet = generateWebPSrcSet('/exams/practice');
 * // Returns WebP srcset with JPEG fallback
 */
export function generateWebPSrcSet(basePath: string, widths?: number[]): string {
  const defaultWidths = widths || [320, 640, 768, 1024, 1280];
  return defaultWidths
    .map((width) => `${basePath}-${width}w.webp ${width}w`)
    .join(', ');
}

/**
 * Picture element HTML with WebP + JPEG fallback
 *
 * @example
 * <picture>
 *   <source srcSet={generateWebPSrcSet(...)} type="image/webp" />
 *   <img srcSet={generateResponsiveSrcSet(...)} alt="..." />
 * </picture>
 */

/**
 * Calculate optimal image quality based on device
 * Mobile devices get lower quality to save bandwidth
 *
 * @param isMobile - Whether on mobile device
 * @param isSlowNetwork - Whether on slow network (3G, etc)
 * @returns JPEG quality (0-100)
 */
export function getOptimalImageQuality(isMobile: boolean, isSlowNetwork: boolean): number {
  if (isSlowNetwork) return 60; // Highly compressed for slow networks
  if (isMobile) return 75; // Optimized for mobile
  return 85; // Higher quality for desktop
}

/**
 * Generate optimized image URL with query parameters
 * Compatible with Cloudflare Image Optimization or similar
 *
 * @example
 * const url = optimizeImageURL('/exams/practice.jpg', 640, 75);
 * // Returns: /exams/practice.jpg?w=640&q=75&auto=format
 */
export function optimizeImageURL(
  imagePath: string,
  width?: number,
  quality?: number,
  format?: 'auto' | 'webp' | 'jpeg'
): string {
  const params = new URLSearchParams();
  if (width) params.set('w', String(width));
  if (quality) params.set('q', String(quality));
  params.set('auto', format || 'format');

  return `${imagePath}?${params.toString()}`;
}

/**
 * Lazy load image with placeholder
 * Use for images below the fold
 *
 * @example
 * <img
 *   src="/placeholder.jpg"
 *   srcSet={generateResponsiveSrcSet('/exams/practice')}
 *   loading="lazy"
 *   alt="Exam"
 * />
 */
export const LAZY_LOADING_CONFIG = {
  loading: 'lazy' as const,
  decoding: 'async' as const,
};

/**
 * Preload critical images
 * Use for above-the-fold images
 *
 * @example
 * <link rel="preload" as="image" href="/hero.jpg" />
 */
export function getPreloadLink(imagePath: string, type?: 'image/webp' | 'image/jpeg'): string {
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'image';
  link.href = imagePath;
  if (type) link.type = type;
  return link.outerHTML;
}

/**
 * Prefetch non-critical images (next question, etc)
 * Lower priority than preload
 */
export function prefetchImages(imagePaths: string[]): void {
  if (typeof document === 'undefined') return;

  imagePaths.forEach((path) => {
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.as = 'image';
    link.href = path;
    document.head.appendChild(link);
  });
}

/**
 * Get image dimensions for aspect ratio preservation
 * Prevents CLS (Cumulative Layout Shift)
 *
 * @example
 * const { width, height } = getImageDimensions('16:9');
 * return (
 *   <div style={{ aspectRatio: '16/9' }}>
 *     <img src="..." />
 *   </div>
 * );
 */
export function getImageDimensions(
  aspectRatio: '16:9' | '4:3' | '1:1' | '9:16' = '4:3'
): { width: number; height: number } {
  const ratios: Record<string, [number, number]> = {
    '16:9': [16, 9],
    '4:3': [4, 3],
    '1:1': [1, 1],
    '9:16': [9, 16],
  };

  const [w, h] = ratios[aspectRatio];
  return { width: w, height: h };
}

/**
 * React component props for responsive images
 */
export interface ResponsiveImageProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  sizes?: string;
  priority?: boolean; // Use for LCP images
  className?: string;
}

/**
 * Detect WebP support in browser
 * Cache result for performance
 */
let webpSupported: boolean | null = null;

export function supportsWebP(): boolean {
  if (webpSupported !== null) return webpSupported;

  if (typeof document === 'undefined') {
    return false;
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    webpSupported = canvas.toDataURL('image/webp').indexOf('image/webp') === 5;
  } catch (err) {
    webpSupported = false;
  }

  return webpSupported;
}

/**
 * Get optimal image format based on browser support
 */
export function getOptimalImageFormat(isMobile: boolean): 'webp' | 'jpeg' {
  if (!isMobile) return 'webp'; // Desktop browsers support WebP
  return supportsWebP() ? 'webp' : 'jpeg';
}

/**
 * Image compression settings for different scenarios
 */
export const COMPRESSION_PROFILES = {
  // High quality for desktop, high-end mobile
  high: { quality: 85, format: 'webp' as const },

  // Balanced quality for typical mobile usage
  medium: { quality: 75, format: 'webp' as const },

  // Aggressive compression for slow networks
  low: { quality: 60, format: 'jpeg' as const },

  // Thumbnail quality for thumbnails/avatars
  thumbnail: { quality: 70, format: 'webp' as const },
};

/**
 * Choose compression profile based on conditions
 */
export function chooseCompressionProfile(
  isMobile: boolean,
  isSlowNetwork: boolean
): (typeof COMPRESSION_PROFILES)[keyof typeof COMPRESSION_PROFILES] {
  if (isSlowNetwork) return COMPRESSION_PROFILES.low;
  if (isMobile) return COMPRESSION_PROFILES.medium;
  return COMPRESSION_PROFILES.high;
}
