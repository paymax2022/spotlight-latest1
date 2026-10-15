import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_TOPIC, HAND_TOPIC, MAX_CHAT_LEN, sanitizeText, encodeChat, decodeChat, encodeHand, decodeHand,
  createRateLimiter, createSenderLimiter, appendChat, applyHand,
} from '../dataMessages.ts';

const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
const alice = { identity: 'user-alice', name: 'Alice' };

test('topics are versioned and distinct', () => {
  assert.notEqual(CHAT_TOPIC, HAND_TOPIC);
  assert.match(CHAT_TOPIC, /v1$/);
});

test('sanitizeText strips controls, bidi/zero-width characters and collapses whitespace', () => {
  assert.equal(sanitizeText('  hi \n\t there  '), 'hi there');
  assert.equal(sanitizeText('a\u202eb\u200bc\u2066d'), 'abcd');
  assert.equal(sanitizeText('\u0000\u0007x'), 'x');
  assert.equal(sanitizeText('   '), '');
});

test('encodeChat refuses empty, blank and over-long messages', () => {
  assert.equal(encodeChat('', 'id1'), null);
  assert.equal(encodeChat('   \n ', 'id1'), null);
  assert.equal(encodeChat('x'.repeat(MAX_CHAT_LEN + 1), 'id1'), null);
  assert.equal(encodeChat('hello', 'bad id!'), null, 'ids are restricted so they cannot smuggle structure');
  assert.ok(encodeChat('x'.repeat(MAX_CHAT_LEN), 'id1'));
});

test('a chat message round-trips and the SENDER comes from LiveKit, never the payload', () => {
  const bytes = encodeChat('Can you repeat that?', 'm1')!;
  const m = decodeChat(bytes, alice, 1000)!;
  assert.equal(m.body, 'Can you repeat that?');
  assert.equal(m.from, 'user-alice');
  assert.equal(m.name, 'Alice');
  assert.equal(m.at, 1000);
  // A forged "from" inside the payload is ignored.
  const forged = enc({ t: 'chat', id: 'm2', body: 'hi', from: 'teacher', name: 'The Teacher' });
  const f = decodeChat(forged, alice, 1)!;
  assert.equal(f.from, 'user-alice');
  assert.equal(f.name, 'Alice');
});

test('a message with no known sender is dropped (server or unknown origin)', () => {
  assert.equal(decodeChat(encodeChat('hi', 'm1')!, undefined, 1), null);
  assert.equal(decodeChat(encodeChat('hi', 'm1')!, { identity: '' }, 1), null);
});

test('a missing display name falls back to a neutral label, not the raw identity', () => {
  const m = decodeChat(encodeChat('hi', 'm1')!, { identity: 'user-9f1c' }, 1)!;
  assert.equal(m.name, 'Participant');
});

test('malformed, oversized and mistyped payloads are dropped', () => {
  const big = new Uint8Array(4096).fill(120);
  const cases: Uint8Array[] = [
    new Uint8Array([]), new TextEncoder().encode('not json'), enc([1, 2]), enc('str'), enc(null), enc({}),
    enc({ t: 'chat' }), enc({ t: 'chat', id: 'a', body: 5 }), enc({ t: 'hand', up: true }), // wrong type for chat
    enc({ t: 'chat', id: 'a', body: 'x'.repeat(MAX_CHAT_LEN + 1) }), enc({ t: 'chat', id: 'a', body: '\u200b\u202e' }), big,
  ];
  cases.forEach((c, i) => assert.equal(decodeChat(c, alice, 1), null, `case ${i}`));
});

test('incoming bodies are sanitised before they can reach the screen', () => {
  const m = decodeChat(enc({ t: 'chat', id: 'a', body: 'hi\u202e there\u0000' }), alice, 1)!;
  assert.equal(m.body, 'hi there');
});

test('hand messages round-trip and need a boolean', () => {
  assert.deepEqual(decodeHand(encodeHand(true), alice), { identity: 'user-alice', name: 'Alice', up: true });
  assert.deepEqual(decodeHand(encodeHand(false), alice), { identity: 'user-alice', name: 'Alice', up: false });
  assert.equal(decodeHand(enc({ t: 'hand', up: 'yes' }), alice), null);
  assert.equal(decodeHand(enc({ t: 'chat', id: 'a', body: 'x' }), alice), null);
  assert.equal(decodeHand(encodeHand(true), undefined), null);
});

test('rate limiter allows a burst then blocks until the window passes', () => {
  let now = 0;
  const allow = createRateLimiter({ max: 3, windowMs: 1000 }, () => now);
  assert.deepEqual([allow(), allow(), allow(), allow()], [true, true, true, false]);
  now = 999;
  assert.equal(allow(), false);
  now = 1001;
  assert.equal(allow(), true);
});

test('the message list is bounded, de-duplicated per sender, and ordered', () => {
  const mk = (from: string, id: string, at: number) => ({ id, from, name: from, body: id, at, self: false });
  let list = [] as ReturnType<typeof mk>[];
  list = appendChat(list, mk('a', '1', 1), 3);
  list = appendChat(list, mk('a', '1', 2), 3); // duplicate of the same sender+id
  assert.equal(list.length, 1);
  list = appendChat(list, mk('b', '1', 3), 3); // same id, different sender: a different message
  assert.equal(list.length, 2);
  list = appendChat(list, mk('a', '2', 4), 3);
  list = appendChat(list, mk('a', '3', 5), 3);
  assert.equal(list.length, 3, 'bounded');
  assert.deepEqual(list.map((m) => m.at), [3, 4, 5], 'oldest dropped first');
});

test('raised hands are tracked per identity and cleared when lowered or when the person leaves', () => {
  let hands = applyHand({}, { identity: 'a', name: 'Ann', up: true });
  hands = applyHand(hands, { identity: 'b', name: 'Bo', up: true });
  assert.deepEqual(Object.keys(hands).sort(), ['a', 'b']);
  hands = applyHand(hands, { identity: 'a', name: 'Ann', up: false });
  assert.deepEqual(Object.keys(hands), ['b']);
  assert.deepEqual(applyHand(hands, { identity: 'b', left: true }), {});
});

test('more invisible and spoof-capable characters are stripped', () => {
  const cp = (...c: number[]) => String.fromCodePoint(...c);
  assert.equal(sanitizeText('a' + cp(0x061c) + 'b'), 'ab');            // Arabic letter mark
  assert.equal(sanitizeText('a' + cp(0x00ad) + 'b'), 'ab');            // soft hyphen
  assert.equal(sanitizeText('a' + cp(0x034f) + 'b'), 'ab');            // combining grapheme joiner
  assert.equal(sanitizeText('a' + cp(0x115f, 0x3164) + 'b'), 'ab');    // hangul fillers
  assert.equal(sanitizeText('a' + cp(0xfe0f) + 'b'), 'ab');            // variation selector
  assert.equal(sanitizeText('a' + cp(0xe0041, 0xe007f) + 'b'), 'ab'); // tag characters
});

test('combining-mark stacking is limited', () => {
  const zalgo = 'e' + '\u0301'.repeat(40);
  const out = sanitizeText(zalgo);
  assert.ok([...out].length <= 4, `kept ${[...out].length} code points`);
});

test('a display name is cut on a character boundary, never inside a surrogate pair', () => {
  const name = '😀'.repeat(60);
  const m = decodeChat(encodeChat('hi', 'm1')!, { identity: 'u', name }, 1)!;
  assert.ok(!/[\uD800-\uDBFF]$/.test(m.name), 'ends with a lone high surrogate');
  assert.ok([...m.name].length <= 40);
});

test('the per-sender receive limiter caps what any one remote can cost the UI', () => {
  let now = 0;
  const allow = createSenderLimiter({ max: 3, windowMs: 1000, maxSenders: 2 }, () => now);
  assert.deepEqual([allow('a'), allow('a'), allow('a'), allow('a')], [true, true, true, false]);
  assert.equal(allow('b'), true, 'another sender is unaffected');
  now = 1001;
  assert.equal(allow('a'), true, 'the window slides');
});

test('the receive limiter does not grow without bound under many identities', () => {
  const allow = createSenderLimiter({ max: 1, windowMs: 10_000, maxSenders: 3 }, () => 0);
  for (let i = 0; i < 50; i++) allow('id' + i);
  assert.equal(allow('id49'), false, 'recent senders are still tracked');
  assert.equal(allow('id0'), true, 'the oldest entries were evicted to stay bounded');
});
