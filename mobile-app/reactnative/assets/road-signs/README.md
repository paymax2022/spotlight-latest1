# Nigerian road & traffic signs (SVG library)

100 individual, self-contained SVG road/traffic signs used in Nigeria (FRSC Highway
Code — standard Vienna/UK-convention shapes). Each sign is a clean vector with the
human label in its `<title>`/`<desc>` only — **not printed on the sign face** — so
the same asset is safe to use as a quiz *question* image (the label is the answer).
Signs that intrinsically carry text/numbers keep them (STOP, speed limits, limit
values, P/H/i glyphs).

## Layout

```
road-signs/
├── manifest.json          # merged index of ALL 100 signs [{key,label,category,file}]
├── warning/     (32)  index.json   triangular, red border, black symbol
├── regulatory/  (26)  index.json   circular red (prohibitory); STOP octagon; give-way
├── mandatory/   (16)  index.json   solid blue circle, white symbol
├── informative/ (18)  index.json   rectangular blue/green guide signs
└── markings/     (8)  index.json   top-down road-surface markings
```

Each `index.json` (and the merged `manifest.json`) entry:
`{ "key": "no-overtaking", "label": "No overtaking", "category": "regulatory", "file": "no-overtaking.svg" }`

## SVG conventions

- `viewBox="0 0 240 240"`, `role="img"`, `aria-labelledby="t"`, `<title>` + `<desc>`.
- No external references, no `<image>`, no required fonts (a common sans stack is used
  only for intrinsic numerals/letters). Frame colours: red `#C81E2D`, blue `#0B5FB0`,
  green `#0A7D33`, symbol black `#141414`, asphalt `#4A4A4A`.

## Using these as arena-quiz question images

The Naija Driver quiz supports a per-question `image_url` (see
`backend/internal/arena/quiz` + migration `20260922001000`). 18 questions in
`supabase/migrations/20260922002000_naija_driver_frsc_supplement.sql` carry a
`-- SIGN: '<name>'` comment marking which sign to attach.

Two ways to wire them up:
1. **Hosted (recommended for the quiz):** upload the SVGs (or PNG renders) to your CDN
   / R2 bucket and set `arena_quiz_question.image_url` to the URL. React Native
   `<Image>` and the admin `<img>` both take a URL. (Rasterize to PNG if you don't add
   an SVG loader.)
2. **Bundled in-app:** add `react-native-svg` + `react-native-svg-transformer` and
   `require()` the SVGs via `manifest.json` (zero network, like the provider logos).

Match a `-- SIGN: 'No overtaking'` question to the `no-overtaking` key in `manifest.json`.

## Notes

Some pictograms (animals, road-works, boat/opening-bridge, buses/lorries) are
simplified but instantly recognisable silhouettes rather than pixel-faithful official
artwork. They are original vector drawings of the standard public sign designs.
