// Chat and raise-hand over LiveKit data messages. Pure and SDK-free so it is unit-tested.
//
// Trust model: a data message is broadcast by an ATTENDEE, so everything in it is hostile.
//  - WHO sent it comes only from LiveKit's participant (the authenticated identity), never from
//    the payload: a payload "from" is ignored.
//  - text is sanitised (controls, bidi overrides, zero-width characters) before it is shown;
//  - sizes, ids and the list length are bounded; malformed input is dropped silently.

export const CHAT_TOPIC = 'lk.chat.v1';
export const HAND_TOPIC = 'lk.hand.v1';
export const MAX_CHAT_LEN = 500;
export const MAX_PAYLOAD_BYTES = 2560; // 500 chars at up to 4 bytes + envelope
const MAX_NAME_LEN = 40;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export interface ChatMessage {
  id: string;
  /** LiveKit identity of the sender (the platform user id). */
  from: string;
  name: string;
  body: string;
  at: number;
  self: boolean;
}

export interface Sender {
  identity: string;
  name?: string | null;
}

// Code points removed outright: C0/C1 controls, zero-width and bidi formatting characters, and
// the BOM. Tab, newline and the Unicode line/paragraph separators are turned into spaces first.
function isStripped(c: number): boolean {
  return (
    c <= 0x1f || (c >= 0x7f && c <= 0x9f) ||
    (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) ||
    (c >= 0x2060 && c <= 0x2064) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff
  );
}

const isSpaceLike = (c: number) => (c >= 0x09 && c <= 0x0d) || c === 0x2028 || c === 0x2029;

/** Removes control, bidi-override, zero-width and separator characters; collapses whitespace. */
export function sanitizeText(input: string): string {
  let out = '';
  for (const ch of input) {
    const c = ch.codePointAt(0) ?? 0;
    if (isSpaceLike(c)) out += ' ';
    else if (!isStripped(c)) out += ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

const encode = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

function parse(payload: Uint8Array): Record<string, unknown> | null {
  if (!payload || payload.length === 0 || payload.length > MAX_PAYLOAD_BYTES) return null;
  try {
    const v = JSON.parse(new TextDecoder().decode(payload)) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function displayName(sender: Sender): string {
  const n = sanitizeText(sender.name ?? '').slice(0, MAX_NAME_LEN);
  return n || 'Participant'; // never fall back to the raw identity (a user id)
}

/** Encodes a chat message, or null when it is empty, too long, or the id is unsafe. */
export function encodeChat(body: string, id: string): Uint8Array<ArrayBuffer> | null {
  if (!ID_RE.test(id)) return null;
  const text = sanitizeText(body);
  if (!text || text.length > MAX_CHAT_LEN) return null;
  const bytes = encode({ t: 'chat', id, body: text });
  return bytes.length <= MAX_PAYLOAD_BYTES ? bytes : null;
}

/** Decodes an incoming chat message. null = drop it. */
export function decodeChat(payload: Uint8Array, sender: Sender | undefined, now: number): ChatMessage | null {
  if (!sender || !sender.identity) return null;
  const o = parse(payload);
  if (!o || o.t !== 'chat' || typeof o.id !== 'string' || !ID_RE.test(o.id) || typeof o.body !== 'string') return null;
  const body = sanitizeText(o.body);
  if (!body || body.length > MAX_CHAT_LEN) return null;
  return { id: o.id, from: sender.identity, name: displayName(sender), body, at: now, self: false };
}

export function encodeHand(up: boolean): Uint8Array<ArrayBuffer> {
  return encode({ t: 'hand', up: up === true });
}

export interface HandEvent {
  identity: string;
  name: string;
  up: boolean;
}

export function decodeHand(payload: Uint8Array, sender: Sender | undefined): HandEvent | null {
  if (!sender || !sender.identity) return null;
  const o = parse(payload);
  if (!o || o.t !== 'hand' || typeof o.up !== 'boolean') return null;
  return { identity: sender.identity, name: displayName(sender), up: o.up };
}

/** Sliding-window limiter for what THIS device sends. Returns true when sending is allowed. */
export function createRateLimiter(opts: { max: number; windowMs: number }, now: () => number = Date.now): () => boolean {
  let stamps: number[] = [];
  return () => {
    const t = now();
    stamps = stamps.filter((s) => t - s < opts.windowMs);
    if (stamps.length >= opts.max) return false;
    stamps.push(t);
    return true;
  };
}

/** Appends in arrival order, drops a repeat of the same sender+id, and keeps only the newest `max`. */
export function appendChat(list: ChatMessage[], msg: ChatMessage, max: number): ChatMessage[] {
  if (list.some((m) => m.from === msg.from && m.id === msg.id)) return list;
  const next = [...list, msg];
  return next.length > max ? next.slice(next.length - max) : next;
}

export type Hands = Record<string, { name: string }>;

export function applyHand(hands: Hands, evt: HandEvent | { identity: string; left: true }): Hands {
  const next = { ...hands };
  if ('left' in evt) {
    delete next[evt.identity];
  } else if (evt.up) {
    next[evt.identity] = { name: evt.name };
  } else {
    delete next[evt.identity];
  }
  return next;
}
