// ── Insurance (live) — HTML → renderable blocks ─────────────────────────────
// PURE. No `@/` imports, no React.
//
// MyCover returns `key_benefits`, `full_benefits`, `how_it_works` and
// `how_to_claim` as HTML strings authored in a rich-text editor — <p>, <ul>/<li>,
// <strong>, <br>, &amp; entities, and occasional inline style attributes. React
// Native has no `dangerouslySetInnerHTML`, and shipping the raw markup into a
// <Text> shows a person literal "<p>" tags.
//
// So we parse it into a small block list the UI draws with real components. The
// parser is deliberately allow-list based: EVERY tag is stripped, and only the
// structure we recognise (paragraph vs list item vs heading) survives. Nothing
// from the provider is ever interpreted as markup, which is also what keeps a
// hostile catalog entry from injecting anything into the screen.

// Block boundaries are marked with a private-use sentinel (U+E000) rather than a
// word like " PARA ". A space-delimited marker collides with real copy — a
// benefit blurb containing the literal word "PARA" would be split in half — and
// provider HTML can never contain U+E000, so the sentinel is unambiguous.
//
// It is U+E000 and not NUL for a boring but expensive reason: a NUL makes the
// whole file register as binary, and grep then prints NOTHING and exits 1. A
// blank grep that means "I gave up" is indistinguishable from one that means
// "not present", and that costs someone an afternoon eventually.

export type HtmlBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullet'; text: string };

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  bull: '•',
  naira: '₦',
};

/** Decode the HTML entities a rich-text editor actually emits. */
export function decodeEntities(input: string): string {
  return String(input ?? '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Strip every tag and collapse whitespace. Used for one-line summaries. */
export function stripTags(input: string): string {
  return decodeEntities(
    String(input ?? '')
      .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse a provider HTML string into blocks.
 *
 * Block boundaries come from </p>, </li>, </h1..6>, <br> and </div>; list items
 * become bullets, headings become headings, everything else is a paragraph.
 * Empty blocks and duplicate consecutive blocks are dropped — the live catalog
 * is full of copy repeated three times in one field.
 */
const SENTINEL = String.fromCharCode(0xe000);

export function parseHtmlBlocks(input: string, opts?: { maxBlocks?: number }): HtmlBlock[] {
  // Strip the sentinel from provider copy BEFORE marking. The sentinel is a
  // private-use codepoint, so unlike a NUL it IS reachable by any provider that
  // emits PUA characters: without this, copy containing the sentinel could forge
  // a boundary (splitting a block) or hijack a block kind, and a bare sentinel
  // survived into the rendered <Text> as an invisible glyph. Provider copy has no
  // legitimate use for it, so dropping it is lossless.
  const raw = String(input ?? '').split(SENTINEL).join('');
  if (!raw.trim()) return [];

  // Drop anything executable or presentational outright.
  const cleaned = raw
    .replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  // Mark the boundaries we care about, tagging list items and headings.
  const marked = cleaned
    .replace(/<\s*li[^>]*>/gi, `${SENTINEL}BULLET${SENTINEL}`)
    .replace(/<\s*h[1-6][^>]*>/gi, `${SENTINEL}HEAD${SENTINEL}`)
    .replace(/<\s*br\s*\/?\s*>/gi, `${SENTINEL}PARA${SENTINEL}`)
    .replace(/<\s*\/\s*(p|li|div|h[1-6]|ul|ol|tr)\s*>/gi, `${SENTINEL}PARA${SENTINEL}`)
    .replace(/<\s*p[^>]*>/gi, `${SENTINEL}PARA${SENTINEL}`);

  const blocks: HtmlBlock[] = [];
  const seen = new Set<string>();

  for (const chunk of marked.split(`${SENTINEL}PARA${SENTINEL}`)) {
    let kind: HtmlBlock['kind'] = 'paragraph';
    let body = chunk;
    if (body.includes(`${SENTINEL}BULLET${SENTINEL}`)) {
      kind = 'bullet';
      body = body.replace(new RegExp(`${SENTINEL}BULLET${SENTINEL}`,'g'), ' ');
    }
    if (body.includes(`${SENTINEL}HEAD${SENTINEL}`)) {
      kind = 'heading';
      body = body.replace(new RegExp(`${SENTINEL}HEAD${SENTINEL}`,'g'), ' ');
    }
    const text = stripTags(body).replace(/^[••\-–—]\s*/, '').trim();
    if (!text) continue;
    const dedupeKey = text.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    blocks.push({ kind, text });
    if (opts?.maxBlocks && blocks.length >= opts.maxBlocks) break;
  }

  return blocks;
}

/**
 * Best-effort bullet list for a compact "what's covered" card: prefer real list
 * items, and fall back to splitting a single run-on paragraph into sentences so
 * a product whose benefits are one long <p> still reads as a list.
 */
export function toBulletList(input: string, limit = 6): string[] {
  const blocks = parseHtmlBlocks(input);
  const bullets = blocks.filter((b) => b.kind === 'bullet').map((b) => b.text);
  if (bullets.length) return bullets.slice(0, limit);

  const prose = blocks
    .filter((b) => b.kind === 'paragraph')
    .map((b) => b.text)
    .join(' ');
  if (!prose) return [];

  const sentences = prose
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const s of sentences) {
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(s);
    if (unique.length >= limit) break;
  }
  return unique;
}
