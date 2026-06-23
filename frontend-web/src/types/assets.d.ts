// Ambient declarations for side-effect asset imports (e.g. MapLibre GL's CSS).
// Next.js/webpack handle these at build time; this satisfies `tsc --noEmit`.
declare module '*.css';
