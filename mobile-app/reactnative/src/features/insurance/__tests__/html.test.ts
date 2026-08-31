// Pure-logic unit tests for the provider-HTML → renderable-blocks parser.
//   node --experimental-strip-types --test src/features/insurance/__tests__/html.test.ts
//
// MyCover authors key_benefits / full_benefits / how_it_works / how_to_claim in
// a rich-text editor, so they arrive as HTML. React Native has no
// dangerouslySetInnerHTML, and putting raw markup in a <Text> shows a person a
// literal "<p>". The parser turns it into a block list drawn with real
// components, allow-list style: every tag is stripped and only the structure we
// recognise survives.
//
// ⚠️ NOTE ON THE SENTINELS. The parser marks block boundaries with sentinels
// delimited by U+E000 ('\uE000PARA\uE000', '\uE000BULLET\uE000',
// '\uE000HEAD\uE000'), NOT by spaces. That is deliberate and load-bearing:
// U+E000 is a Private Use Area codepoint no rich-text editor emits, so an
// ACCIDENTAL collision with real copy is impossible. Space-delimited markers
// would fragment any benefit blurb containing the literal word "PARA" — the
// collision tests at the bottom of this file exist to keep that property.
//
// These were NUL bytes originally. NUL is effectively unforgeable, but it made
// html.ts read as a BINARY file to file(1) and to every grep with binary
// detection, which skipped it SILENTLY — a blank grep indistinguishable from a
// real no-match. U+E000 restored greppability but, being a reachable codepoint,
// was briefly forgeable. That is now closed: the parser SCRUBS the sentinel
// from the input before it inserts any markers, and builds it via
// String.fromCharCode so no PUA literal sits in the source. Both properties
// hold at once — unforgeable AND greppable. The last two tests pin that.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeEntities,
  parseHtmlBlocks,
  stripTags,
  toBulletList,
} from '../live/html.ts';

// ── decodeEntities ──────────────────────────────────────────────────────────

test('decodeEntities handles the entities a rich-text editor actually emits', () => {
  assert.equal(decodeEntities('Fire &amp; burglary'), 'Fire & burglary');
  assert.equal(decodeEntities('cover&nbsp;you'), 'cover you');
  assert.equal(decodeEntities('&ldquo;all risks&rdquo;'), '“all risks”');
  assert.equal(decodeEntities('30&ndash;60 days'), '30–60 days');
});

test('decodeEntities resolves numeric and hex references to the naira sign', () => {
  // Premiums in provider copy are frequently written as &#8358; / &#x20A6;.
  assert.equal(decodeEntities('&#8358;5,000'), '₦5,000');
  assert.equal(decodeEntities('&#x20A6;5,000'), '₦5,000');
});

test('decodeEntities leaves an unknown entity untouched rather than eating it', () => {
  // Dropping it would silently corrupt copy; leaving it is visible and debuggable.
  assert.equal(decodeEntities('&foo; &amp;'), '&foo; &');
});

test('decodeEntities rejects out-of-range code points instead of throwing', () => {
  assert.equal(decodeEntities('&#0;'), '&#0;');
  assert.equal(decodeEntities('&#1114112;'), '&#1114112;');
});

// ── stripTags ───────────────────────────────────────────────────────────────

test('stripTags removes markup and collapses the whitespace it leaves behind', () => {
  assert.equal(stripTags('<p>Covers <strong>theft</strong></p>'), 'Covers theft');
  assert.equal(stripTags('<p style="color:red">hi</p>'), 'hi');
});

test('stripTags drops script and style bodies, not just their tags', () => {
  // Stripping only the tags would leave the script SOURCE as visible copy.
  assert.equal(stripTags('<script>alert(1)</script>ok'), 'ok');
  assert.equal(stripTags('<style>.a{color:red}</style>ok'), 'ok');
});

test('stripTags strips BEFORE decoding, so escaped markup stays inert text', () => {
  // This ordering is the security-relevant part: decode-then-strip would turn
  // &lt;script&gt; into a real tag that the stripper had already walked past.
  // The output is plain text bound for a <Text>, so a literal "<script>" here
  // renders as characters and is never markup.
  assert.equal(
    stripTags('&lt;script&gt;alert(1)&lt;/script&gt;'),
    '<script>alert(1)</script>',
  );
});

test('stripTags survives empty and nullish input', () => {
  assert.equal(stripTags(''), '');
  // @ts-expect-error — runtime robustness.
  assert.equal(stripTags(null), '');
  // @ts-expect-error — runtime robustness.
  assert.equal(stripTags(undefined), '');
});

// ── parseHtmlBlocks ─────────────────────────────────────────────────────────

test('parseHtmlBlocks turns list items into bullets', () => {
  assert.deepEqual(
    parseHtmlBlocks('<ul><li>Theft</li><li>Screen damage</li></ul>'),
    [
      { kind: 'bullet', text: 'Theft' },
      { kind: 'bullet', text: 'Screen damage' },
    ],
  );
});

test('parseHtmlBlocks distinguishes headings from paragraphs', () => {
  assert.deepEqual(parseHtmlBlocks('<h2>Benefits</h2><p>Covers loss.</p>'), [
    { kind: 'heading', text: 'Benefits' },
    { kind: 'paragraph', text: 'Covers loss.' },
  ]);
});

test('parseHtmlBlocks treats <br> as a block boundary', () => {
  assert.deepEqual(parseHtmlBlocks('a<br/>b'), [
    { kind: 'paragraph', text: 'a' },
    { kind: 'paragraph', text: 'b' },
  ]);
});

test('parseHtmlBlocks drops duplicate copy', () => {
  // The live catalog genuinely repeats the same sentence two or three times in
  // one field; rendering it three times looks like a bug to the reader.
  assert.deepEqual(parseHtmlBlocks('<p>Same</p><p>Same</p><p>Other</p>'), [
    { kind: 'paragraph', text: 'Same' },
    { kind: 'paragraph', text: 'Other' },
  ]);
});

test('parseHtmlBlocks dedupes case-insensitively', () => {
  assert.equal(parseHtmlBlocks('<p>Covers theft</p><p>COVERS THEFT</p>').length, 1);
});

test('parseHtmlBlocks honours maxBlocks for a preview card', () => {
  assert.equal(parseHtmlBlocks('<p>a</p><p>b</p><p>c</p>', { maxBlocks: 2 }).length, 2);
});

test('parseHtmlBlocks returns nothing for empty or whitespace-only input', () => {
  assert.deepEqual(parseHtmlBlocks(''), []);
  assert.deepEqual(parseHtmlBlocks('   '), []);
  assert.deepEqual(parseHtmlBlocks('<p></p>'), []);
  // @ts-expect-error — runtime robustness.
  assert.deepEqual(parseHtmlBlocks(null), []);
});

test('parseHtmlBlocks discards executable and embedded content entirely', () => {
  for (const hostile of [
    '<p>ok</p><script>alert(1)</script>',
    '<p>ok</p><iframe src="http://x"></iframe>',
    '<p>ok</p><object data="x"></object>',
    '<p>ok</p><embed src="x">',
    '<p>ok</p><!-- sneaky -->',
  ]) {
    const blocks = parseHtmlBlocks(hostile);
    assert.deepEqual(blocks, [{ kind: 'paragraph', text: 'ok' }], `leaked from: ${hostile}`);
  }
});

test('parseHtmlBlocks never emits a block containing a tag', () => {
  const blocks = parseHtmlBlocks(
    '<div><p>Covers <em>accidental</em> damage</p><ul><li>Theft</li></ul></div>',
  );
  for (const b of blocks) {
    assert.ok(!/[<>]/.test(b.text), `block kept markup: ${b.text}`);
  }
});

// ── sentinel collision resistance (the NUL-delimiter property) ─────────────

test('literal "PARA" in provider copy does not split a block', () => {
  // REGRESSION GUARD. With space-delimited ' PARA ' markers this input splits
  // into "Cover for" + "gliding trips". The NUL delimiters make that impossible.
  assert.deepEqual(parseHtmlBlocks('<p>Cover for PARA gliding trips</p>'), [
    { kind: 'paragraph', text: 'Cover for PARA gliding trips' },
  ]);
});

test('literal "BULLET" or "HEAD" in copy does not change a block kind', () => {
  assert.deepEqual(parseHtmlBlocks('<p>We use BULLET points here</p>'), [
    { kind: 'paragraph', text: 'We use BULLET points here' },
  ]);
  assert.deepEqual(parseHtmlBlocks('<p>HEAD office cover</p>'), [
    { kind: 'paragraph', text: 'HEAD office cover' },
  ]);
});

test('a stray sentinel codepoint is scrubbed from provider copy', () => {
  // The input is stripped of the sentinel BEFORE any marker is inserted, so a
  // stray U+E000 neither forges a boundary nor leaks into the rendered string
  // as an invisible glyph. Built via fromCharCode rather than pasted: a literal
  // PUA character does not survive a round trip through every editor.
  const S = String.fromCharCode(0xe000);
  assert.deepEqual(parseHtmlBlocks(`<p>Cover ${S} for you</p>`), [
    { kind: 'paragraph', text: 'Cover for you' },
  ]);
});

test('a forged sentinel can neither split a block nor hijack its kind', () => {
  // The attack this closes: provider copy that reproduces the marker exactly.
  // Any in-band sentinel is forgeable unless the input is scrubbed first, and
  // U+E000 — unlike the NUL it replaced — is a codepoint a provider can emit.
  const S = String.fromCharCode(0xe000);

  // A crafted PARA marker does not split: one block, and the bare word survives
  // as ordinary text rather than being honoured as a boundary.
  assert.deepEqual(parseHtmlBlocks(`<p>Cover ${S}PARA${S} for you</p>`), [
    { kind: 'paragraph', text: 'Cover PARA for you' },
  ]);

  // A crafted BULLET marker cannot promote a paragraph into a bullet.
  assert.deepEqual(parseHtmlBlocks(`<p>${S}BULLET${S}hijacked</p>`), [
    { kind: 'paragraph', text: 'BULLEThijacked' },
  ]);
});

// ── toBulletList ────────────────────────────────────────────────────────────

test('toBulletList prefers real list items when the copy has them', () => {
  assert.deepEqual(toBulletList('<ul><li>One</li><li>Two</li></ul>'), ['One', 'Two']);
});

test('toBulletList falls back to sentences for run-on prose', () => {
  // Many products ship their whole benefit list as a single <p>.
  assert.deepEqual(
    toBulletList('<p>Covers accidental damage. Covers theft nationwide.</p>'),
    ['Covers accidental damage.', 'Covers theft nationwide.'],
  );
});

test('toBulletList drops sentence fragments too short to be a benefit', () => {
  assert.deepEqual(
    toBulletList('<p>Free tow. Covers accidental damage everywhere.</p>'),
    ['Covers accidental damage everywhere.'],
  );
});

test('toBulletList respects the limit in both the bullet and prose paths', () => {
  const many = '<ul>' + Array.from({ length: 10 }, (_, i) => `<li>Item ${i}</li>`).join('') + '</ul>';
  assert.equal(toBulletList(many, 3).length, 3);

  const prose =
    '<p>' +
    Array.from({ length: 10 }, (_, i) => `Benefit number ${i} is included here.`).join(' ') +
    '</p>';
  assert.equal(toBulletList(prose, 3).length, 3);
});

test('toBulletList returns an empty list rather than throwing on empty input', () => {
  assert.deepEqual(toBulletList(''), []);
  assert.deepEqual(toBulletList('<p></p>'), []);
  // @ts-expect-error — runtime robustness.
  assert.deepEqual(toBulletList(null), []);
});
