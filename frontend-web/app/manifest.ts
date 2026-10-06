import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Spotlight',
    short_name: 'Spotlight',
    description:
      'Spotlight discovers, trains, promotes, and connects emerging talents through auditions, bootcamps, reality TV, public voting, media exposure, sponsorship, and post-show career pathways.',
    start_url: '/',
    display: 'standalone',
    // App theme tokens (tailwind.config.js): bg #0D0D0D, accent-gold #D4A843.
    background_color: '#0D0D0D',
    theme_color: '#D4A843',
    icons: [
      // public/icons/* are rasterized from the brand mark in
      // public/assets/img/favicon.svg — no square PNGs shipped before this.
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/assets/img/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/favicon.ico', sizes: 'any', type: 'image/x-icon' },
    ],
  };
}
