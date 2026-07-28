// Allow importing CSS files as side-effects (e.g. maplibre-gl/dist/maplibre-gl.css).
// TypeScript's bundler moduleResolution does not resolve .css imports by default;
// this ambient declaration makes the tsc pass without changing runtime behaviour
// (Next.js / webpack handle actual CSS loading).
declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}
