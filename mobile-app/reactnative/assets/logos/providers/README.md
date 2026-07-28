# Bundled provider logos

Drop provider logo images **here** (`mobile-app/reactnative/assets/logos/providers/`).
They are rendered by `<ProviderLogo>` with **zero network traffic** — instant,
offline, and no external favicon fetches.

## How it works

1. Add a file named `<key>.png` (see the key list below).
2. Uncomment / add the matching line in
   `src/constants/providerLogoAssets.ts` (React Native `require()` must be a
   static path, and the file must exist or the bundler fails — add both together).
3. `<ProviderLogo>` checks this bundled map **first**; if no bundled logo exists it
   falls back to the VTPass logo, then a remote icon, then the branded badge.

## Image guidance

- Format: **PNG with a transparent background** (SVG is not required-loadable by
  React Native `<Image>` without extra config; PNG is simplest).
- Size: square-ish, ~**256×256** (or provide `@2x` / `@3x` variants:
  `mtn.png`, `mtn@2x.png`, `mtn@3x.png`).
- Trim whitespace; the component adds its own padding/rounding.

## Filename keys (name each file `<key>.png`)

Telco:
- `mtn.png`, `airtel.png`, `glo.png`, `9mobile.png`, `smile.png`, `spectranet.png`

Cable TV:
- `dstv.png`, `gotv.png`, `startime.png`, `showmax.png`

Electricity DISCOs:
- `eko.png`, `ikeja.png`, `abuja.png`, `portharcourt.png`, `kano.png`, `jos.png`,
  `ibadan.png`, `kaduna.png`, `enugu.png`, `benin.png`, `aba.png`, `yola.png`

Education:
- `waec.png`, `jamb.png`, `neco.png`

> Keys come from `src/constants/providerBrands.ts` (the first token in each
> provider's `match` list). Add a new provider there first if you need one not
> listed above.

## Licensing note

Use logos you have the right to distribute (official brand/press-kit assets or
your VTPass-provided images). Bundling third-party trademarks in a shipped app is
a brand/legal decision — confirm usage rights before release.
